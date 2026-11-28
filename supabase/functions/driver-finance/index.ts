import { buildCorsHeaders, jsonResponse, errorResponse } from '../_shared/corsAndResponse.ts';
import { extractBearerToken, verifyFirebaseIdToken } from '../_shared/firebaseAuth.ts';
import { readDenoEnv, supabaseRest, fetchDriverByFirebaseUid, assertAuthorizedActiveDriver } from '../_shared/supabaseAdmin.ts';
const EXPENSE_CATEGORIES = ['fuel','oil_change','maintenance','cleaning','food','telecom','other'];
Deno.serve(async (req:Request) => {
 const env=readDenoEnv(); const cors=buildCorsHeaders(req.headers.get('origin'),env.allowedOrigins);
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 try {
  const token=extractBearerToken(req.headers.get('authorization')); const user=await verifyFirebaseIdToken(token,{projectId:env.firebaseProjectId});
  const driver=await fetchDriverByFirebaseUid(env,user.uid);
  const adminLookup=await supabaseRest<any[]>(env,'/rest/v1/express_admins?firebase_uid=eq.'+encodeURIComponent(user.uid)+'&is_active=eq.true&select=firebase_uid,email,is_active&limit=1');
  const admin=adminLookup.ok&&adminLookup.data?.length===1&&String(adminLookup.data[0].email||'').toLowerCase()===user.email.toLowerCase()?adminLookup.data[0]:null;
  if(req.method==='GET') {
   if(driver) { const authorized=assertAuthorizedActiveDriver(driver);
    const rows=await supabaseRest<any[]>(env,'/rest/v1/express_driver_financial_entries?driver_id=eq.'+authorized.id+'&select=*&order=created_at.desc&limit=200');
    if(!rows.ok) throw new Error('FINANCE_READ_FAILED'); const entries=rows.data||[];
    const sum=(arr:any[])=>arr.reduce((s,e)=>s+Number(e.amount||0),0);
    const earned=sum(entries.filter(e=>e.entry_type==='earning'&&e.status==='posted'));
    const approved=sum(entries.filter(e=>e.entry_type==='expense'&&['approved','posted'].includes(e.status)));
    const pending=sum(entries.filter(e=>e.entry_type==='expense'&&e.status==='pending'));
    return jsonResponse({ok:true,summary:{earnedXof:earned,approvedExpensesXof:approved,pendingExpensesXof:pending,estimatedNetXof:earned-approved},entries},200,cors);
   }
   if(!admin) return errorResponse('ADMIN_REQUIRED','Accès réservé aux administrateurs actifs.',403,cors); const rows=await supabaseRest<any[]>(env,'/rest/v1/express_driver_financial_entries?select=*&order=created_at.desc&limit=500');
   if(!rows.ok) throw new Error('FINANCE_READ_FAILED'); return jsonResponse({ok:true,entries:rows.data||[]},200,cors);
  }
  if(req.method==='POST') {
   const authorized=assertAuthorizedActiveDriver(driver); const body=await req.json().catch(()=>null);
   if(!body||body.action!=='submit-expense') return errorResponse('INVALID_ACTION','Action non autorisée.',400,cors);
   const amount=Number(body.amount), category=String(body.category||''), description=typeof body.description==='string'?body.description.trim().slice(0,500):'';
   if(!Number.isFinite(amount)||amount<=0||amount>1000000||!EXPENSE_CATEGORIES.includes(category)) return errorResponse('INVALID_EXPENSE','Montant ou catégorie invalide.',400,cors);
   const key=String(req.headers.get('x-idempotency-key')||body.idempotencyKey||'').trim(); if(key.length<8||key.length>120) return errorResponse('IDEMPOTENCY_REQUIRED','Clé d’envoi requise.',400,cors);
   const result=await supabaseRest<any[]>(env,'/rest/v1/express_driver_financial_entries?select=id,driver_id,entry_type,category,amount,status,created_at',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({driver_id:authorized.id,entry_type:'expense',category,amount,currency:'XOF',description,receipt_storage_path:null,status:'posted',posted_at:new Date().toISOString(),source_key:'expense:'+authorized.id+':'+key,submitted_by_firebase_uid:user.uid})});
   if(!result.ok) {if(result.status===409) return errorResponse('DUPLICATE_SUBMISSION','Cette dépense a déjà été envoyée.',409,cors); throw new Error('FINANCE_INSERT_FAILED');}
   return jsonResponse({ok:true,entry:result.data?.[0],message:'Dépense enregistrée et déduite immédiatement du portefeuille.'},201,cors);
  }
  if(req.method==='PATCH') {
   if(!admin) return errorResponse('ADMIN_REQUIRED','Accès réservé aux administrateurs actifs.',403,cors); const body=await req.json().catch(()=>null); const id=String(body?.entryId||''),status=String(body?.status||'');
   if(!id||!['approved','rejected','posted'].includes(status)) return errorResponse('INVALID_REVIEW','Révision invalide.',400,cors);
   const result=await supabaseRest<any[]>(env,'/rest/v1/express_driver_financial_entries?id=eq.'+encodeURIComponent(id)+'&entry_type=eq.expense&status=eq.pending&select=id,status,reviewed_at',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status,reviewed_by_firebase_uid:user.uid,reviewed_at:new Date().toISOString(),posted_at:status==='posted'?new Date().toISOString():null})});
   if(!result.ok) throw new Error('FINANCE_REVIEW_FAILED'); if(!result.data?.length) return errorResponse('ENTRY_NOT_PENDING','Mouvement introuvable ou déjà traité.',409,cors);
   return jsonResponse({ok:true,entry:result.data[0],reviewerEmail:admin.email},200,cors);
  }
  return errorResponse('METHOD_NOT_ALLOWED','Méthode non autorisée.',405,cors);
 } catch(e) { const message=e instanceof Error?e.message:'UNKNOWN'; const status=message.includes('TOKEN')||message.includes('EMAIL')?401:message.includes('DRIVER_')||message.includes('ADMIN_')?403:500; return errorResponse('FINANCE_ERROR',status===500?'Une erreur est survenue dans le module financier.':message,status,cors); }
});