import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import { extractBearerToken, FirebaseAuthError, verifyFirebaseIdToken } from '../_shared/firebaseAuth.ts';
import { assertAuthorizedAdmin, DriverAuthorizationError, fetchActiveAdminByFirebaseUid, fetchDriverByFirebaseUid, readDenoEnv, supabaseRest } from '../_shared/supabaseAdmin.ts';

const BUCKET = 'courier-verification-private';
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const DOCS = new Set(['identity_front','identity_back','license_front','license_back','vehicle_registration_front','vehicle_registration_back','insurance_certificate','profile_photo','address_proof']);
const json = (v: unknown) => JSON.stringify(v);
async function storageRequest(env: ReturnType<typeof readDenoEnv>, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.serviceRoleKey); headers.set('Authorization', `Bearer ${env.serviceRoleKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  return fetch(`${env.supabaseUrl}/storage/v1${path}`, { ...init, headers });
}
export async function handleCourierTrust(req: Request): Promise<Response> {
 const env=readDenoEnv(); const cors=buildCorsHeaders(req.headers.get('origin'),env.allowedOrigins);
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 try {
  const token=extractBearerToken(req.headers.get('authorization'));
  const user=await verifyFirebaseIdToken(token,{projectId:env.firebaseProjectId,requireVerifiedEmail:true});
  const driver=await fetchDriverByFirebaseUid(env,user.uid);
  const url=new URL(req.url);
  if(req.method==='GET') {
   const admin=assertAuthorizedAdmin(await fetchActiveAdminByFirebaseUid(env,user.uid,user.email));
   const driverId=url.searchParams.get('driverId')||'';
   if(!driverId) return errorResponse('DRIVER_ID_REQUIRED','Identifiant candidat requis.',400,cors);
   const d=await supabaseRest<any[]>(env,`/rest/v1/express_drivers?id=eq.${encodeURIComponent(driverId)}&select=*`);
   if(!d.ok||!d.data?.[0]) return errorResponse('DRIVER_NOT_FOUND','Candidat introuvable.',404,cors);
   const docs=await supabaseRest<any[]>(env,`/rest/v1/express_driver_documents?driver_id=eq.${encodeURIComponent(driverId)}&order=uploaded_at.desc`);
   if(!docs.ok) return errorResponse('DOCUMENTS_FETCH_FAILED','Documents indisponibles.',500,cors);
   const signed=[];
   for(const doc of docs.data||[]) {
    const r=await storageRequest(env,`/object/sign/${BUCKET}/${doc.storage_path}`,{method:'POST',body:json({expiresIn:180})});
    if(r.ok){const body=await r.json(); signed.push({...doc,signedUrl:body.signedURL?.startsWith('http')?body.signedURL:`${env.supabaseUrl}/storage/v1${body.signedURL}`});}
    else signed.push({...doc,signedUrl:null});
   }
   return jsonResponse({ok:true,driver:d.data[0],documents:signed,reviewedBy:admin.email},200,cors);
  }
  if(req.method!=='POST') return errorResponse('METHOD_NOT_ALLOWED','Méthode non autorisée.',405,cors);
  const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body) return errorResponse('INVALID_BODY','Corps JSON invalide.',400,cors);
  const action=String(body.action||'');
  if(action==='prepare-upload') {
   if(!driver || driver.account_status!=='pending') return errorResponse('DRIVER_PENDING','Profil candidat en attente requis.',403,cors);
   const type=String(body.documentType||''), mime=String(body.mimeType||''), size=Number(body.fileSizeBytes||0);
   if(!DOCS.has(type)||!TYPES.has(mime)||!Number.isInteger(size)||size<1||size>MAX_BYTES) return errorResponse('INVALID_FILE','Type ou taille de fichier non autorisé.',400,cors);
   const extension=mime==='application/pdf'?'pdf':mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
   const path=`${user.uid}/${crypto.randomUUID()}-${type}.${extension}`;
   const signed=await storageRequest(env,`/object/upload/sign/${BUCKET}/${path}`,{method:'POST',body:json({})});
   if(!signed.ok) return errorResponse('UPLOAD_URL_FAILED','Impossible de préparer le dépôt sécurisé.',502,cors);
   const result=await signed.json();
   const signedUrl=result.signedURL?.startsWith('http')?result.signedURL:`${env.supabaseUrl}/storage/v1${result.signedURL}`;
   return jsonResponse({ok:true,storagePath:path,signedUrl,token:result.token||null},200,cors);
  }
  if(action==='confirm-upload') {
   if(!driver || driver.account_status!=='pending') return errorResponse('DRIVER_PENDING','Profil candidat en attente requis.',403,cors);
   const path=String(body.storagePath||''), type=String(body.documentType||''), mime=String(body.mimeType||''), size=Number(body.fileSizeBytes||0);
   if(!path.startsWith(`${user.uid}/`)||!DOCS.has(type)||!TYPES.has(mime)||!Number.isInteger(size)||size<1||size>MAX_BYTES) return errorResponse('INVALID_DOCUMENT','Document invalide.',400,cors);
   const listing=await storageRequest(env,`/object/list/${BUCKET}`,{method:'POST',body:json({prefix:user.uid,search:path.split('/').pop(),limit:5})});
   if(!listing.ok) return errorResponse('UPLOAD_NOT_FOUND','Fichier non confirmé dans le stockage privé.',400,cors);
   const found=await listing.json();
   if(!Array.isArray(found)||!found.some((f:any)=>f.name===path.split('/').pop())) return errorResponse('UPLOAD_NOT_FOUND','Fichier non confirmé dans le stockage privé.',400,cors);
   const inserted=await supabaseRest<any[]>(env,'/rest/v1/express_driver_documents',{method:'POST',headers:{Prefer:'return=representation'},body:json({driver_id:driver.id,firebase_uid:user.uid,document_type:type,storage_path:path,mime_type:mime,file_size_bytes:size,original_file_name:String(body.fileName||'').slice(0,180)||null,review_status:'pending',issued_at:body.issuedAt||null,expires_at:body.expiresAt||null})});
   if(!inserted.ok||!inserted.data?.[0]) return errorResponse('DOCUMENT_SAVE_FAILED','Impossible d’enregistrer le document.',500,cors);
   return jsonResponse({ok:true,document:inserted.data[0]},201,cors);
  }
  if(action==='submit-application') {
   if(!driver||driver.account_status!=='pending') return errorResponse('DRIVER_PENDING','Profil candidat en attente requis.',403,cors);
   const docs=await supabaseRest<any[]>(env,`/rest/v1/express_driver_documents?driver_id=eq.${encodeURIComponent(driver.id)}&select=document_type,review_status`);
   if(!docs.ok) return errorResponse('DOCUMENTS_FETCH_FAILED','Impossible de contrôler les pièces.',500,cors);
   const submittedTypes=new Set((docs.data||[]).map(x=>x.document_type));
   const requiredForOperationalApproval=['identity_front','identity_back','license_front','license_back','vehicle_registration_front','vehicle_registration_back','insurance_certificate','profile_photo'];
   const missingDocuments=requiredForOperationalApproval.filter(x=>!submittedTypes.has(x));
   const patch={vehicle_plate:String(body.vehiclePlate||'').trim().slice(0,24),residence_address:String(body.residenceAddress||'').trim().slice(0,300),residence_city:String(body.residenceCity||'').trim().slice(0,100),residence_region:String(body.residenceRegion||'').trim().slice(0,100),emergency_contact_name:String(body.emergencyContactName||'').trim().slice(0,120),emergency_contact_relationship:String(body.emergencyContactRelationship||'').trim().slice(0,40),emergency_contact_phone:String(body.emergencyContactPhone||'').trim().slice(0,24),insurance_expires_at:body.insuranceExpiresAt?String(body.insuranceExpiresAt):null,personal_data_consent_at:new Date().toISOString(),verification_status:'submitted',updated_at:new Date().toISOString()};
   if(!patch.residence_address||!patch.residence_city||!patch.emergency_contact_name||!/^\+?[0-9][0-9 .()-]{6,22}$/.test(patch.emergency_contact_phone)) return errorResponse('INVALID_APPLICATION','Adresse ou contact de secours invalide.',400,cors);
   if(submittedTypes.has('insurance_certificate') && (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.insuranceExpiresAt||'')) || String(body.insuranceExpiresAt)<new Date().toISOString().slice(0,10))) return errorResponse('INVALID_INSURANCE_DATES','Les dates d’assurance sont requises et doivent être valides lorsque le certificat est joint.',400,cors);
   const updated=await supabaseRest<any[]>(env,`/rest/v1/express_drivers?id=eq.${encodeURIComponent(driver.id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:json(patch)});
   if(!updated.ok||!updated.data?.[0]) return errorResponse('APPLICATION_SAVE_FAILED','Impossible de soumettre le dossier.',500,cors);
   return jsonResponse({ok:true,profile:updated.data[0],missingDocuments},200,cors);
  }
  if(action==='approve-application') {
   const admin=assertAuthorizedAdmin(await fetchActiveAdminByFirebaseUid(env,user.uid,user.email));
   const driverId=String(body.driverId||'');
   const identityConfirmed=body.identityConfirmed===true, addressConfirmed=body.addressConfirmed===true, engagementAccepted=body.engagementAccepted===true;
   if(!driverId||!identityConfirmed||!addressConfirmed||!engagementAccepted) return errorResponse('MANUAL_CHECKS_REQUIRED','Confirmez identité, adresse et acceptation de l’engagement avant validation.',400,cors);
   const target=await supabaseRest<any[]>(env,`/rest/v1/express_drivers?id=eq.${encodeURIComponent(driverId)}&select=id,insurance_expires_at,verification_status`);
   if(!target.ok||!target.data?.[0]) return errorResponse('DRIVER_NOT_FOUND','Candidat introuvable.',404,cors);
   const docs=await supabaseRest<any[]>(env,`/rest/v1/express_driver_documents?driver_id=eq.${encodeURIComponent(driverId)}&select=document_type,review_status`);
   const required=['identity_front','identity_back','license_front','license_back','vehicle_registration_front','vehicle_registration_back','insurance_certificate','profile_photo'];
   const approved=new Set((docs.data||[]).filter(x=>x.review_status==='approved').map(x=>x.document_type));
   if(!required.every(x=>approved.has(x))) return errorResponse('DOCUMENTS_NOT_APPROVED','Toutes les pièces obligatoires doivent être approuvées individuellement.',409,cors);
   if(!target.data[0].insurance_expires_at||target.data[0].insurance_expires_at<new Date().toISOString().slice(0,10)) return errorResponse('INSURANCE_EXPIRED','Assurance absente ou expirée.',409,cors);
   const updated=await supabaseRest<any[]>(env,`/rest/v1/express_drivers?id=eq.${encodeURIComponent(driverId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:json({verification_status:'verified',engagement_status:'accepted',identity_verified_at:new Date().toISOString(),address_verified_at:new Date().toISOString(),engagement_accepted_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
   if(!updated.ok||!updated.data?.[0]) return errorResponse('APPLICATION_APPROVAL_FAILED','Validation du dossier impossible.',500,cors);
   return jsonResponse({ok:true,driver:updated.data[0],reviewedBy:admin.email},200,cors);
  }
  if(action==='review-document') {
   const admin=assertAuthorizedAdmin(await fetchActiveAdminByFirebaseUid(env,user.uid,user.email));
   const id=String(body.documentId||''), status=String(body.reviewStatus||''), note=String(body.reviewNote||'').slice(0,1000);
   if(!id||!['approved','rejected','replacement_required'].includes(status)) return errorResponse('INVALID_REVIEW','Décision invalide.',400,cors);
   const updated=await supabaseRest<any[]>(env,`/rest/v1/express_driver_documents?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:json({review_status:status,review_note:note||null,reviewed_by_firebase_uid:user.uid,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
   if(!updated.ok||!updated.data?.[0]) return errorResponse('DOCUMENT_REVIEW_FAILED','Validation impossible.',500,cors);
   return jsonResponse({ok:true,document:updated.data[0],reviewedBy:admin.email},200,cors);
  }
  return errorResponse('UNKNOWN_ACTION','Action inconnue.',400,cors);
 } catch(err) {
  if(err instanceof FirebaseAuthError||err instanceof DriverAuthorizationError) return errorResponse(err.code,err.message,err.httpStatus,cors);
  return errorResponse('INTERNAL_ERROR','Erreur pendant le traitement du dossier livreur.',500,cors);
 }
}
const denoRuntime=(globalThis as unknown as {Deno?:{serve(fn:(r:Request)=>Promise<Response>):void}}).Deno;
if(denoRuntime?.serve) denoRuntime.serve(handleCourierTrust);
