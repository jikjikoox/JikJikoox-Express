import { useMemo, useState, type FormEvent } from 'react';
import { LogOut, ShieldCheck, UploadCloud } from 'lucide-react';
import { BrandAccentBar, BrandLogo } from '../components/BrandLogo';
import { useCourierApp } from '../context/CourierAppContext';
import { DAKAR_ZONES, VEHICLE_LABELS } from '../lib/missionWorkflow';
import { getSupabaseFunctionsBaseUrl } from '../lib/supabaseContract';
import type { VehicleType } from '../types/delivery';

const DOCUMENTS = [
 {key:'identity_front',label:"Carte d'identité — recto",required:false,activationRequired:true},
 {key:'identity_back',label:"Carte d'identité — verso",required:false,activationRequired:true},
 {key:'license_front',label:'Permis de conduire — recto',required:false,activationRequired:true},
 {key:'license_back',label:'Permis de conduire — verso',required:false,activationRequired:true},
 {key:'vehicle_registration_front',label:'Carte grise — recto',required:false,activationRequired:true},
 {key:'vehicle_registration_back',label:'Carte grise — verso',required:false,activationRequired:true},
 {key:'insurance_certificate',label:"Attestation d'assurance",required:false,activationRequired:true},
 {key:'profile_photo',label:'Photo personnelle récente',required:false,activationRequired:true},
 {key:'address_proof',label:'Justificatif de domicile',required:false,activationRequired:false},
] as const;
type DocKey = typeof DOCUMENTS[number]['key'];
const MAX_SIZE=10*1024*1024;
const MIME=['image/jpeg','image/png','image/webp','application/pdf'];
const field='mt-1 w-full min-h-11 rounded-xl border border-[#D6D1C4] bg-white px-3 text-sm text-[#141413]';
export function CourierApplicationPage(){
 const {firebaseUser,profile,completeCourierRegistration,logout}=useCourierApp();
 const display=(firebaseUser?.displayName||'').trim().split(/\s+/);
 const [firstName,setFirstName]=useState(profile?.firstName||display[0]||'');
 const [lastName,setLastName]=useState(profile?.lastName||display.slice(1).join(' '));
 const [phone,setPhone]=useState(profile?.phone||'+221 ');
 const [vehicleType,setVehicleType]=useState<VehicleType>(profile?.vehicleType||'scooter');
 const [workZone,setWorkZone]=useState(profile?.workZone||DAKAR_ZONES[0]);
 const [plate,setPlate]=useState(profile?.vehiclePlate||'');
 const [address,setAddress]=useState('');
 const [city,setCity]=useState('Dakar');
 const [region,setRegion]=useState('Dakar');
 const [emergencyName,setEmergencyName]=useState('');
 const [emergencyRelation,setEmergencyRelation]=useState('Mère');
 const [emergencyPhone,setEmergencyPhone]=useState('+221 ');
 const [insuranceStart,setInsuranceStart]=useState('');
 const [insuranceExpiry,setInsuranceExpiry]=useState('');
 const [files,setFiles]=useState<Partial<Record<DocKey,File>>>({});
 const [accepted,setAccepted]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [progress,setProgress]=useState('');
 const selectedCount=useMemo(()=>Object.keys(files).length,[files]);
 const today=new Date().toISOString().slice(0,10);
 async function callTrust(token:string,body:Record<string,unknown>){
  const base=getSupabaseFunctionsBaseUrl().replace(/\/+$/,'');
  if(!base) throw new Error('Connexion au serveur Supabase indisponible.');
  const response=await fetch(base+'/courier-trust',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!payload?.ok) throw new Error(payload?.error?.message||payload?.error||'Une erreur serveur est survenue.');
  return payload;
 }
 async function submit(e:FormEvent){
  e.preventDefault();setError('');
  if(!firebaseUser){setError('Connectez-vous avec votre compte Google.');return;}
    if(!accepted){setError('Vous devez accepter les conditions et le traitement sécurisé des documents.');return;}
  if(files.insurance_certificate && (!insuranceStart || !insuranceExpiry || insuranceExpiry<today || insuranceExpiry<insuranceStart)){setError("Si vous joignez l'assurance, ses dates doivent être valides et non expirées.");return;}
  setBusy(true);
  try{
   const ok=await completeCourierRegistration({firstName,lastName,phone,vehicleType,workZone,termsAccepted:true});
   if(!ok) throw new Error("Le profil initial n'a pas pu être enregistré.");
   const token=await firebaseUser.getIdToken(true);
   for(const doc of DOCUMENTS){
    const file=files[doc.key];if(!file)continue;
    if(file.size<1||file.size>MAX_SIZE||!MIME.includes(file.type)) throw new Error('Fichier non autorisé : '+doc.label+'. Formats acceptés : JPG, PNG, WEBP ou PDF (10 Mo maximum).');
    setProgress('Préparation : '+doc.label);
    const prepared=await callTrust(token,{action:'prepare-upload',documentType:doc.key,mimeType:file.type,fileSizeBytes:file.size});
    setProgress('Envoi : '+doc.label);
    const upload=await fetch(prepared.signedUrl,{method:'PUT',headers:{'Content-Type':file.type,'x-upsert':'false'},body:file});
    if(!upload.ok) throw new Error("Échec de l'envoi : "+doc.label);
    setProgress('Vérification : '+doc.label);
    await callTrust(token,{action:'confirm-upload',storagePath:prepared.storagePath,documentType:doc.key,mimeType:file.type,fileSizeBytes:file.size,fileName:file.name,issuedAt:doc.key==='insurance_certificate'?insuranceStart:null,expiresAt:doc.key==='insurance_certificate'?insuranceExpiry:null});
   }
   setProgress('Soumission du dossier');
   await callTrust(token,{action:'submit-application',residenceAddress:address,residenceCity:city,residenceRegion:region,emergencyContactName:emergencyName,emergencyContactRelationship:emergencyRelation,emergencyContactPhone:emergencyPhone,vehiclePlate:plate,insuranceIssuedAt:insuranceStart,insuranceExpiresAt:insuranceExpiry});
   const missingDocs=DOCUMENTS.filter(d=>d.activationRequired&&!files[d.key]).map(d=>d.label);
   setProgress(missingDocs.length ? `Candidature enregistrée. ${missingDocs.length} document(s) restent à fournir : ${missingDocs.join(' ; ')}. Votre dossier reste en attente de vérification.` : 'Dossier complet envoyé. Votre candidature sera examinée par JikJikoox.');
  }catch(err){setError(err instanceof Error?err.message:'Impossible de soumettre le dossier.');}
  finally{setBusy(false);}
 }
 return <div className="min-h-screen bg-[#F7F6F2] px-4 py-6 sm:py-10"><div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[#E5E2D9] bg-white shadow-sm"><BrandAccentBar/><div className="space-y-6 p-5 sm:p-8">
  <div className="flex justify-center"><BrandLogo size="md" showWordmark/></div>
  <div className="text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#EAF4EC] text-[#0E6E2D]"><ShieldCheck/></div><h1 className="text-2xl font-extrabold text-[#141413]">{profile?'Compléter mon dossier livreur':'Candidature livreur JikJikoox Express'}</h1><p className="mt-2 text-sm leading-6 text-[#5A5851]">La confiance fait notre différence. Vous pouvez compléter votre dossier progressivement. Les missions restent verrouillées jusqu’aux vérifications et validations requises.</p><p className="mt-1 text-xs text-[#77736A]">{firebaseUser?.email}</p></div>
  <form onSubmit={submit} className="space-y-6">
   <section className="space-y-3"><h2 className="font-bold text-[#141413]">1. Identité et contact</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Prénom<input className={field} required minLength={2} value={firstName} onChange={e=>setFirstName(e.target.value)}/></label><label className="text-xs font-semibold">Nom<input className={field} required minLength={2} value={lastName} onChange={e=>setLastName(e.target.value)}/></label><label className="text-xs font-semibold">Téléphone principal<input className={field} required type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="text-xs font-semibold">Véhicule<select className={field} value={vehicleType} onChange={e=>setVehicleType(e.target.value as VehicleType)}>{(Object.keys(VEHICLE_LABELS) as VehicleType[]).map(k=><option key={k} value={k}>{VEHICLE_LABELS[k]}</option>)}</select></label><label className="text-xs font-semibold">Immatriculation<input className={field} required value={plate} onChange={e=>setPlate(e.target.value)} placeholder="DK-0000-XX"/></label><label className="text-xs font-semibold">Zone de travail<select className={field} value={workZone} onChange={e=>setWorkZone(e.target.value)}>{DAKAR_ZONES.map(z=><option key={z}>{z}</option>)}</select></label></div></section>
   <section className="space-y-3"><h2 className="font-bold text-[#141413]">2. Adresse de résidence</h2><label className="block text-xs font-semibold">Adresse complète<input className={field} required value={address} onChange={e=>setAddress(e.target.value)} placeholder="Quartier, rue, repère"/></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Ville<input className={field} required value={city} onChange={e=>setCity(e.target.value)}/></label><label className="text-xs font-semibold">Région<input className={field} required value={region} onChange={e=>setRegion(e.target.value)}/></label></div></section>
   <section className="space-y-3"><h2 className="font-bold text-[#141413]">3. Documents justificatifs</h2><p className="text-xs leading-5 text-[#77736A]">Vous pouvez soumettre votre candidature même si certains documents sont temporairement indisponibles (ex. permis ou carte grise en cours de délivrance). Ajoutez-les dès que vous les obtenez. Les pièces et leur validité seront contrôlées avant l'autorisation de prendre des missions. Photos nettes recto/verso ou PDF. JPG, PNG, WEBP ou PDF — 10 Mo maximum par fichier. Stockage privé et accès réservé aux personnes autorisées.</p><div className="grid gap-3 sm:grid-cols-2">{DOCUMENTS.map(d=><label key={d.key} className="rounded-xl border border-[#E5E2D9] p-3 text-xs font-semibold text-[#45433D]"><span className="flex items-center justify-between gap-2">{d.label}{d.required&&<span className="text-red-600">Obligatoire</span>}{d.activationRequired&&<span className="text-[#8A5600]">Requis avant activation</span>}{!d.activationRequired&&<span className="text-[#77736A]">Facultatif</span>}</span><input className="mt-2 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required={d.required} onChange={e=>setFiles(prev=>({...prev,[d.key]:e.target.files?.[0]}))}/>{files[d.key]&&<span className="mt-1 block truncate text-[11px] font-normal text-[#0E6E2D]">{files[d.key]?.name}</span>}</label>)}</div><p className="text-xs text-[#77736A]">{selectedCount} document(s) sélectionné(s) sur {DOCUMENTS.length} catégories.</p></section>
   <section className="space-y-3"><h2 className="font-bold text-[#141413]">4. Assurance du véhicule</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Date de début<input className={field} type="date" required value={insuranceStart} onChange={e=>setInsuranceStart(e.target.value)}/></label><label className="text-xs font-semibold">Date d'expiration<input className={field} type="date" required min={today} value={insuranceExpiry} onChange={e=>setInsuranceExpiry(e.target.value)}/></label></div></section>
   <section className="space-y-3"><h2 className="font-bold text-[#141413]">5. Contact de secours</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Nom complet<input className={field} required value={emergencyName} onChange={e=>setEmergencyName(e.target.value)}/></label><label className="text-xs font-semibold">Lien<select className={field} value={emergencyRelation} onChange={e=>setEmergencyRelation(e.target.value)}>{['Mère','Père','Conjoint(e)','Frère','Grand-frère','Sœur','Autre proche'].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-semibold sm:col-span-2">Téléphone de secours<input className={field} required type="tel" value={emergencyPhone} onChange={e=>setEmergencyPhone(e.target.value)}/></label></div></section>
   <label className="flex items-start gap-3 text-xs leading-5 text-[#5A5851]"><input className="mt-1" type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} required/><span>Je certifie l'exactitude des informations, accepte les conditions de candidature et consens au traitement sécurisé de mes documents pour la vérification de confiance JikJikoox Express.</span></label>
   {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
   {progress&&<p aria-live="polite" className="text-sm text-[#0E6E2D]">{progress}</p>}
   <button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0E6E2D] px-4 font-bold text-white disabled:opacity-60"><UploadCloud size={18}/>{busy?'Envoi sécurisé en cours…':'Soumettre mon dossier de candidature'}</button>
  </form>
  <button onClick={()=>void logout()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#D6D1C4] py-3 text-sm font-semibold"><LogOut size={16}/>Se déconnecter</button>
 </div></div></div>;
}
