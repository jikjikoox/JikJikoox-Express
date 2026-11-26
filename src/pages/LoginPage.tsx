import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, HelpCircle, ShieldCheck, Truck,
} from 'lucide-react';
import { BrandAccentBar, BrandLogo } from '../components/BrandLogo';
import { useCourierApp } from '../context/CourierAppContext';
import { auth } from '../lib/firebase';
import { LOGIN_HERO_IMAGE } from '../lib/mediaAssets';
import { expressApi } from '../services/expressApi';
import type { VehicleType } from '../types/delivery';

const KEY_FEATURES = [
  ['Gestion des missions :', 'réception et consultation des commandes qui vous sont affectées à Dakar et dans les zones de livraison couvertes.'],
  ['Suivi des livraisons :', 'mise à jour des étapes de prise en charge, de collecte, d’acheminement et de remise au client.'],
  ['Géolocalisation GPS :', 'partage de votre position pendant les opérations de livraison, selon les autorisations accordées.'],
  ['Gestion des paiements :', 'suivi des montants à encaisser à la livraison (paiement à la réception / COD), en FCFA.'],
  ['Preuves de livraison :', 'confirmation sécurisée de la remise de la commande.'],
  ['Notifications en temps réel :', 'alertes concernant les nouvelles missions et les changements opérationnels.'],
  ['Tableau de bord :', 'consultation de vos livraisons, de vos performances et de vos activités hebdomadaires.'],
] as const;

type View = 'login' | 'register';

function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte ne correspond à cette adresse e-mail.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Cette adresse e-mail possède déjà un compte. Connectez-vous.',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    'auth/network-request-failed': 'Connexion réseau impossible. Vérifiez Internet.',
  };
  return messages[code] || (error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.');
}

export function LoginPage() {
  const { signInWithGoogle, enterDemoMode, authError } = useCourierApp();
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+221 ');
  const [vehicleType, setVehicleType] = useState<VehicleType>('scooter');
  const [workZone, setWorkZone] = useState('Dakar');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [heroError, setHeroError] = useState(false);

  const switchView = (next: View) => {
    setView(next); setError(null); setNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    if (view === 'register') {
      if (firstName.trim().length < 2 || lastName.trim().length < 2) {
        setError('Renseignez votre prénom et votre nom (2 caractères minimum).'); return;
      }
      if (password.length < 6) { setError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
      if (password !== confirmPassword) { setError('Les deux mots de passe ne correspondent pas.'); return; }
      if (phone.replace(/[^0-9]/g, '').length < 8) { setError('Saisissez un numéro de téléphone valide avec indicatif.'); return; }
    }
    setBusy(true);
    try {
      if (view === 'login') {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
        return;
      }
      const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      await updateProfile(credential.user, { displayName: `${firstName.trim()} ${lastName.trim()}` });
      const token = await credential.user.getIdToken(true);
      await expressApi.registerDriver(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        vehicleType,
        workZone: workZone.trim(),
      });
      await sendEmailVerification(credential.user);
      setNotice('Votre demande d’inscription est enregistrée. Vérifiez votre boîte e-mail pour confirmer votre adresse. Votre compte reste en attente de validation par JikJikoox Admin.');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setBusy(true); setError(null);
    try { await signInWithGoogle(); }
    finally { setBusy(false); }
  };

  const handleReset = async () => {
    setError(null); setNotice(null);
    if (!email.trim()) { setError('Saisissez votre adresse e-mail pour recevoir le lien de réinitialisation.'); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setNotice('Un lien de réinitialisation vient d’être envoyé à votre adresse e-mail.');
    } catch (err) { setError(friendlyAuthError(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col lg:grid lg:grid-cols-2">
      <div className="relative overflow-hidden bg-[#141413] flex flex-col lg:min-h-screen">
        {!heroError ? <img src={LOGIN_HERO_IMAGE} alt="Livraison JikJikoox Express à Dakar" onError={() => setHeroError(true)} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-[#0E6E2D] via-[#141413] to-[#652214]" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#141413]/72 via-[#141413]/84 to-[#141413]/95" />
        <BrandAccentBar className="relative z-10 shrink-0" />
        <div className="relative z-10 flex-1 px-5 py-6 sm:px-10 sm:py-9 lg:px-12 lg:py-10 flex flex-col justify-between gap-6 text-white">
          <BrandLogo size="md" showWordmark inverted />
          <div className="max-w-xl space-y-5">
            <div className="space-y-2.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">JikJikoox Express — Espace Livreur</h1>
              <p className="text-sm sm:text-base font-bold text-[#F4A61D]">L’application professionnelle de livraison et de suivi des commandes JikJikoox au Sénégal.</p>
              <p className="text-sm text-white/90 leading-relaxed">Bienvenue dans votre espace de travail dédié à la gestion de vos livraisons. Consultez vos missions, organisez vos déplacements et suivez vos performances depuis une interface simple et sécurisée.</p>
            </div>
            <section className="pt-4 border-t border-white/15 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#F4A61D]">Fonctionnalités clés</h2>
              <ul className="space-y-2 text-[13px] sm:text-sm text-white/90 leading-snug">
                {KEY_FEATURES.map(([title, description]) => <li key={title} className="flex items-start gap-2.5"><CheckCircle2 className="w-4 h-4 text-[#4ADE80] shrink-0 mt-0.5" aria-hidden="true" /><span><strong className="text-white">{title}</strong> {description}</span></li>)}
              </ul>
            </section>
            <p className="pt-3 border-t border-white/15 text-sm font-bold">JikJikoox Express — Chaque commande, une livraison suivie et maîtrisée.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-5 py-8 sm:px-10 lg:px-16 bg-white">
        <div className="w-full max-w-md space-y-5">
          <div className="hidden lg:block"><BrandLogo size="md" showWordmark subtitle="Espace livreur officiel" /></div>
          <div>
            <h2 className="text-2xl font-extrabold text-[#141413]">{view === 'login' ? 'Connexion livreur' : 'Créer un compte livreur'}</h2>
            <p className="text-sm text-[#5A5851] mt-1.5">{view === 'login' ? 'Connectez-vous à votre espace personnel sécurisé.' : 'Soumettez votre candidature. Votre compte sera vérifié par JikJikoox Admin.'}</p>
          </div>

          {(error || authError) && <div role="alert" className="rounded-xl bg-[#FDF0EE] border border-[#C6241B]/25 p-3.5 flex gap-2 text-sm text-[#921A14]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error || authError}</div>}
          {notice && <div role="status" className="rounded-xl bg-[#ECF7EE] border border-[#0E6E2D]/20 p-3.5 text-sm text-[#095220]">{notice}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            {view === 'register' && <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-[#5A5851]">Prénom<input required minLength={2} value={firstName} onChange={e=>setFirstName(e.target.value)} autoComplete="given-name" className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>
                <label className="text-xs font-semibold text-[#5A5851]">Nom<input required minLength={2} value={lastName} onChange={e=>setLastName(e.target.value)} autoComplete="family-name" className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>
              </div>
              <label className="block text-xs font-semibold text-[#5A5851]">Téléphone<input required value={phone} onChange={e=>setPhone(e.target.value)} autoComplete="tel" placeholder="+221 77 000 00 00" className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-[#5A5851]">Véhicule<select value={vehicleType} onChange={e=>setVehicleType(e.target.value as VehicleType)} className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-2 text-sm text-[#141413]"><option value="scooter">Scooter</option><option value="moto">Moto</option><option value="voiture">Voiture</option><option value="velo">Vélo</option><option value="tricycle">Tricycle</option></select></label>
                <label className="text-xs font-semibold text-[#5A5851]">Zone souhaitée<input required value={workZone} onChange={e=>setWorkZone(e.target.value)} className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>
              </div>
            </>}
            <label className="block text-xs font-semibold text-[#5A5851]">Adresse e-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>
            <label className="block text-xs font-semibold text-[#5A5851]">Mot de passe<span className="relative mt-1 block"><input required type={showPassword ? 'text' : 'password'} minLength={6} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} className="w-full h-11 rounded-lg border border-[#D6D1C4] px-3 pr-11 text-sm text-[#141413]" /><button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-3 text-[#5A5851]" aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
            {view === 'register' && <label className="block text-xs font-semibold text-[#5A5851]">Confirmer le mot de passe<input required type="password" minLength={6} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" className="mt-1 w-full h-11 rounded-lg border border-[#D6D1C4] px-3 text-sm text-[#141413]" /></label>}
            <button disabled={busy} className="w-full min-h-[50px] rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2">{busy ? 'Veuillez patienter...' : view === 'login' ? 'Se connecter' : 'Envoyer ma demande d’inscription'}<ArrowRight size={17}/></button>
          </form>

          {view === 'login' && <div className="flex flex-wrap justify-between gap-3 text-sm"><button type="button" onClick={handleReset} disabled={busy} className="text-[#0E6E2D] font-semibold hover:underline">Mot de passe oublié ?</button><button type="button" onClick={()=>switchView('register')} className="text-[#0E6E2D] font-semibold hover:underline">Créer un compte</button></div>}
          {view === 'register' && <button type="button" onClick={()=>switchView('login')} className="text-sm text-[#0E6E2D] font-semibold hover:underline">Déjà inscrit ? Se connecter</button>}

          {view === 'login' && <div className="space-y-3 border-t border-[#E5E2D9] pt-4">
            <button type="button" onClick={handleGoogleLogin} disabled={busy} className="w-full min-h-[48px] rounded-xl border border-[#D6D1C4] text-[#141413] font-semibold text-sm disabled:opacity-60">Continuer avec Google</button>
            <button type="button" onClick={enterDemoMode} className="w-full min-h-[48px] rounded-xl bg-[#F7F6F2] border border-[#D6D1C4] text-[#141413] font-semibold text-sm flex items-center justify-center gap-2"><Truck size={17}/> Explorer en mode démonstration</button>
          </div>}
          <div className="flex items-center gap-2 text-xs text-[#5A5851] pt-1"><ShieldCheck className="w-4 h-4 text-[#0E6E2D]"/><span>Authentification Firebase · Validation administrative obligatoire</span></div>
          <p className="text-xs text-[#77736A] flex items-center gap-2"><HelpCircle size={14}/> En cas de blocage, contactez le support JikJikoox.</p>
        </div>
      </div>
    </div>
  );
}
