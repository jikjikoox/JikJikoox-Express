import { useEffect, useState } from 'react';
import { Wallet, Receipt, Fuel, Plus, RefreshCw } from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { expressApi } from '../services/expressApi';

type FinanceResponse = { ok:boolean; summary?:{earnedXof:number;approvedExpensesXof:number;pendingExpensesXof:number;estimatedNetXof:number}; entries:Array<{id:string;entry_type:string;category:string;amount:number;status:string;description:string|null;created_at:string}> };
const categories=[['fuel','Carburant'],['oil_change','Vidange'],['maintenance','Entretien / réparation'],['cleaning','Lavage'],['food','Alimentation'],['telecom','Téléphone / Internet'],['other','Autre']];
const fmt=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n)+' FCFA';
export function FinancePage(){
 const {firebaseUser,mode}=useCourierApp();
 const [data,setData]=useState<FinanceResponse|null>(null),[loading,setLoading]=useState(false),[err,setErr]=useState(''),[amount,setAmount]=useState(''),[category,setCategory]=useState('fuel'),[description,setDescription]=useState(''),[sending,setSending]=useState(false),[notice,setNotice]=useState('');
 const reload=async()=>{if(!firebaseUser||mode!=='firebase')return;setLoading(true);setErr('');try{const token=await firebaseUser.getIdToken();setData(await expressApi.fetchDriverFinance(token));}catch(e){setErr(e instanceof Error?e.message:'Chargement impossible');}finally{setLoading(false);}};
 useEffect(()=>{void reload();},[firebaseUser,mode]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!firebaseUser)return;setSending(true);setNotice('');try{const token=await firebaseUser.getIdToken();await expressApi.submitDriverExpense(token,{amount:Number(amount),category,description,idempotencyKey:'exp_'+crypto.randomUUID()});setNotice('Dépense envoyée. Elle reste en attente de validation.');setAmount('');setDescription('');await reload();}catch(ex){setErr(ex instanceof Error?ex.message:'Envoi impossible');}finally{setSending(false);}};
 const labels=Object.fromEntries(categories);
 return <div className="space-y-5">
  <div className="rounded-2xl bg-[#0E6E2D] text-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm opacity-90"><Wallet className="w-5 h-5"/> Portefeuille livreur</div><p className="text-xs mt-3 opacity-80">Solde net estimatif (hors espèces COD à reverser)</p><p className="text-3xl font-black mt-1">{fmt(data?.summary?.estimatedNetXof||0)}</p></div>
  <div className="grid grid-cols-2 gap-3">
   {[['Gains enregistrés',data?.summary?.earnedXof||0],['Dépenses validées',data?.summary?.approvedExpensesXof||0],['En attente',data?.summary?.pendingExpensesXof||0],['Net estimé',data?.summary?.estimatedNetXof||0]].map(([label,val])=><div key={String(label)} className="bg-white border border-[#E5E2D9] rounded-xl p-3"><p className="text-xs text-[#5A5851]">{label}</p><p className="font-bold mt-1">{fmt(Number(val))}</p></div>)}
  </div>
  <section className="bg-white border border-[#E5E2D9] rounded-2xl p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><Receipt className="w-5 h-5"/> Déclarer une dépense</h2><form onSubmit={submit} className="space-y-3">
   <label className="block text-sm font-medium">Montant (FCFA)<input type="number" min="1" max="1000000" step="1" required value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 w-full border border-[#D6D1C4] rounded-xl p-3" placeholder="Ex. 2500"/></label>
   <label className="block text-sm font-medium">Catégorie<select value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 w-full border border-[#D6D1C4] rounded-xl p-3">{categories.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label className="block text-sm font-medium">Note / détail<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full border border-[#D6D1C4] rounded-xl p-3" placeholder="Ex. carburant pour tournée du jour"/></label>
   {notice&&<p className="text-sm text-green-700">{notice}</p>}{err&&<p className="text-sm text-red-700">{err}</p>}
   <button disabled={sending||!amount} className="w-full bg-[#0E6E2D] disabled:opacity-50 text-white rounded-xl p-3 font-semibold flex justify-center gap-2"><Plus className="w-5 h-5"/>{sending?'Envoi...':'Envoyer pour validation'}</button>
  </form></section>
  <section className="bg-white border border-[#E5E2D9] rounded-2xl p-4"><div className="flex justify-between items-center mb-3"><h2 className="font-bold">Historique des mouvements</h2><button onClick={()=>void reload()} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Actualiser"><RefreshCw className="w-4 h-4"/></button></div>{loading?<p className="text-sm text-gray-500">Chargement…</p>:!data?.entries?.length?<p className="text-sm text-gray-500">Aucun mouvement financier pour l’instant.</p>:<div className="divide-y">{data.entries.map(entry=><div key={entry.id} className="py-3 flex justify-between gap-3"><div><p className="font-medium text-sm">{entry.entry_type==='earning'?'Gain livraison':labels[entry.category]||entry.category}</p><p className="text-xs text-gray-500">{entry.description||'—'} · {new Date(entry.created_at).toLocaleDateString('fr-FR')}</p><p className="text-xs mt-1">{entry.status==='pending'?'En attente':entry.status==='approved'?'Validée':entry.status==='rejected'?'Refusée':'Enregistrée'}</p></div><strong className={entry.entry_type==='earning'?'text-green-700':'text-gray-800'}>{entry.entry_type==='earning'?'+':'−'}{fmt(entry.amount)}</strong></div>)}</div>}</section>
 <p className="text-xs text-gray-500">Les frais de livraison affichés sont des montants estimés. Les dépenses ne réduisent le solde qu’après validation. Les paiements COD collectés pour l’entreprise ne sont pas considérés comme des gains.</p>
 </div>;
}