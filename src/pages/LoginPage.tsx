import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  ShieldCheck,
  Truck,
  UserPlus,
  LogIn,
} from 'lucide-react';
import { BrandAccentBar, BrandLogo } from '../components/BrandLogo';
import { useCourierApp } from '../context/CourierAppContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { auth } from '../lib/firebase';
import { LOGIN_HERO_IMAGE } from '../lib/mediaAssets';
import { DAKAR_ZONES, VEHICLE_LABELS } from '../lib/missionWorkflow';
import { expressApi, ExpressApiError } from '../services/expressApi';
import type { VehicleType } from '../types/delivery';

const KEY_FEATURES = [
  [
    'Gestion des missions :',
    'réception et consultation des commandes qui vous sont affectées à Dakar et dans les zones de livraison couvertes.',
  ],
  [
    'Suivi des livraisons :',
    'mise à jour des étapes de prise en charge, de collecte, d’acheminement et de remise au client.',
  ],
  [
    'Géolocalisation GPS :',
    'partage de votre position pendant les opérations de livraison, selon les autorisations accordées.',
  ],
  [
    'Gestion des paiements :',
    'suivi des montants à encaisser à la livraison (paiement à la réception / COD), en FCFA.',
  ],
  ['Preuves de livraison :', 'confirmation sécurisée de la remise de la commande.'],
  [
    'Notifications en temps réel :',
    'alertes concernant les nouvelles missions et les changements opérationnels.',
  ],
  [
    'Tableau de bord :',
    'consultation de vos livraisons, de vos performances et de vos activités hebdomadaires.',
  ],
] as const;

type View = 'login' | 'register';

export function mapFirebaseAuthError(error: unknown): string {
  if (error instanceof ExpressApiError) {
    return error.message;
  }
  const code = (error as { code?: string })?.code || '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte ne correspond à cette adresse e-mail.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Cette adresse e-mail possède déjà un compte. Connectez-vous.',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
    'auth/network-request-failed': 'Connexion réseau impossible. Vérifiez votre accès Internet.',
  };
  return (
    messages[code] ||
    (error instanceof Error ? error.message : 'Une erreur est survenue. Veuillez réessayer.')
  );
}

export function LoginPage() {
  const { signInWithGoogle, enterDemoMode, authError, refreshBackendData } = useCourierApp();
  const { canShowInstallAction, canPromptInstall, isIosSafari, promptInstall } = usePWAInstall();

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+221 ');
  const [vehicleType, setVehicleType] = useState<VehicleType>('scooter');
  const [workZone, setWorkZone] = useState<string>(DAKAR_ZONES[0]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [heroError, setHeroError] = useState(false);

  const switchView = (next: View) => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Veuillez saisir une adresse e-mail valide.');
      return;
    }

    if (view === 'register') {
      if (firstName.trim().length < 2 || lastName.trim().length < 2) {
        setError('Renseignez votre prénom et votre nom (2 caractères minimum).');
        return;
      }
      if (phone.replace(/[^0-9]/g, '').length < 8) {
        setError('Saisissez un numéro de téléphone valide avec indicatif international (ex. +221 77 ...).');
        return;
      }
      if (password.length < 6) {
        setError('Le mot de passe doit contenir au moins 6 caractères.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Les deux mots de passe ne correspondent pas.');
        return;
      }
      if (!termsAccepted) {
        setError('Vous devez accepter les conditions d’utilisation de JikJikoox Express.');
        return;
      }
    }

    setBusy(true);
    try {
      if (view === 'login') {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
        return;
      }

      // Gestion propre des créations partielles : si le compte Firebase a déjà été créé lors d'un essai précédent
      // dont l'enregistrement Supabase avait échoué, on réutilise `auth.currentUser` pour terminer le profil.
      let user =
        auth.currentUser && auth.currentUser.email?.toLowerCase() === cleanEmail
          ? auth.currentUser
          : null;

      if (!user) {
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        user = credential.user;
        await updateProfile(user, { displayName: `${firstName.trim()} ${lastName.trim()}` });
      }

      const token = await user.getIdToken(true);
      await expressApi.registerDriver(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        vehicleType,
        workZone: workZone.trim(),
        termsAccepted: true,
      });

      if (!user.emailVerified) {
        await sendEmailVerification(user).catch(() => undefined);
      }

      await refreshBackendData();
      setNotice(
        'Votre demande d’inscription a été enregistrée. Votre compte est en attente de validation par JikJikoox Admin.'
      );
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithGoogle();
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Saisissez votre adresse e-mail dans le champ ci-dessus pour recevoir le lien de réinitialisation.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setNotice('Un lien de réinitialisation de mot de passe vient d’être envoyé à votre adresse e-mail.');
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleInstallClick = async () => {
    const outcome = await promptInstall();
    if (outcome === 'ios_manual') {
      setShowIosGuide((prev) => !prev);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col lg:grid lg:grid-cols-2">
      {/* Left / Top Editorial Presentation Panel (Validated Copy Preserved) */}
      <div className="relative overflow-hidden bg-[#141413] flex flex-col lg:min-h-screen">
        {!heroError ? (
          <img
            src={LOGIN_HERO_IMAGE}
            alt="Livraison JikJikoox Express à Dakar"
            referrerPolicy="no-referrer"
            onError={() => setHeroError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0E6E2D] via-[#141413] to-[#652214]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#141413]/72 via-[#141413]/84 to-[#141413]/95" />
        <BrandAccentBar className="relative z-10 shrink-0" />

        <div className="relative z-10 flex-1 px-5 py-6 sm:px-10 sm:py-9 lg:px-12 lg:py-10 flex flex-col justify-between gap-6 text-white">
          <div className="flex items-center justify-between gap-3">
            <BrandLogo size="md" showWordmark inverted />
            {canShowInstallAction && (
              <button
                type="button"
                onClick={() => void handleInstallClick()}
                className="min-h-[38px] px-3.5 rounded-xl bg-white/12 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Installer l’application</span>
              </button>
            )}
          </div>

          <div className="max-w-xl space-y-5">
            <div className="space-y-2.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                JikJikoox Express — Espace Livreur
              </h1>
              <p className="text-sm sm:text-base font-bold text-[#F4A61D]">
                L’application professionnelle de livraison et de suivi des commandes JikJikoox au Sénégal.
              </p>
              <p className="text-sm text-white/90 leading-relaxed">
                Bienvenue dans votre espace de travail dédié à la gestion de vos livraisons. Consultez vos
                missions, organisez vos déplacements et suivez vos performances depuis une interface simple et
                sécurisée.
              </p>
            </div>

            {/* Primary Navigation CTAs directly linked to presentation */}
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                onClick={() => switchView('login')}
                className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                  view === 'login'
                    ? 'bg-[#0E6E2D] text-white'
                    : 'bg-white/10 hover:bg-white/18 text-white border border-white/20'
                }`}
              >
                <LogIn className="w-4 h-4" aria-hidden="true" />
                <span>Se connecter</span>
              </button>
              <button
                type="button"
                onClick={() => switchView('register')}
                className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                  view === 'register'
                    ? 'bg-[#F4A61D] text-[#141413]'
                    : 'bg-white/10 hover:bg-white/18 text-white border border-white/20'
                }`}
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>Créer un compte livreur</span>
              </button>
            </div>

            <section className="pt-4 border-t border-white/15 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#F4A61D]">
                Fonctionnalités clés
              </h2>
              <ul className="space-y-2 text-[13px] sm:text-sm text-white/90 leading-snug">
                {KEY_FEATURES.map(([title, description]) => (
                  <li key={title} className="flex items-start gap-2.5">
                    <CheckCircle2
                      className="w-4 h-4 text-[#4ADE80] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>
                      <strong className="text-white">{title}</strong> {description}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="pt-3 border-t border-white/15 text-sm font-bold">
              JikJikoox Express — Chaque commande, une livraison suivie et maîtrisée.
            </p>
          </div>
        </div>
      </div>

      {/* Right / Bottom Auth & Registration Panel */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 sm:px-10 lg:px-16 bg-white">
        <div className="w-full max-w-md space-y-5">
          <div className="hidden lg:block">
            <BrandLogo size="md" showWordmark subtitle="Espace livreur officiel" />
          </div>

          {/* Clear Two-Button Mode Switcher */}
          <div
            role="tablist"
            aria-label="Authentification livreur"
            className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#F7F6F2] border border-[#E5E2D9]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'login'}
              onClick={() => switchView('login')}
              className={`min-h-[42px] px-3 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                view === 'login'
                  ? 'bg-[#0E6E2D] text-white shadow-2xs'
                  : 'text-[#5A5851] hover:text-[#141413]'
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'register'}
              onClick={() => switchView('register')}
              className={`min-h-[42px] px-3 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                view === 'register'
                  ? 'bg-[#0E6E2D] text-white shadow-2xs'
                  : 'text-[#5A5851] hover:text-[#141413]'
              }`}
            >
              Créer un compte livreur
            </button>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold text-[#141413]">
              {view === 'login' ? 'Connexion livreur' : 'Créer un compte livreur'}
            </h2>
            <p className="text-sm text-[#5A5851] mt-1">
              {view === 'login'
                ? 'Accédez à vos missions, vos encaissements FCFA et vos preuves de livraison.'
                : 'Complétez votre candidature. Votre compte sera vérifié par JikJikoox Admin avant activation.'}
            </p>
          </div>

          {(error || authError) && (
            <div
              role="alert"
              className="rounded-xl bg-[#FDF0EE] border border-[#C6241B]/25 p-3.5 flex gap-2 text-sm text-[#921A14]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error || authError}</span>
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="rounded-xl bg-[#ECF7EE] border border-[#0E6E2D]/20 p-3.5 text-sm text-[#095220]"
            >
              {notice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {view === 'register' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-[#5A5851]">
                    Prénom
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                      placeholder="Ex. Moussa"
                      className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] px-3 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-[#5A5851]">
                    Nom
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                      placeholder="Ex. Diallo"
                      className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] px-3 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                    />
                  </label>
                </div>

                <label className="block text-xs font-semibold text-[#5A5851]">
                  Téléphone (avec indicatif international)
                  <input
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    placeholder="+221 77 000 00 00"
                    className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] px-3 font-mono text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-[#5A5851]">
                    Type de véhicule
                    <select
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                      className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] bg-white px-3 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                    >
                      {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((key) => (
                        <option key={key} value={key}>
                          {VEHICLE_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-[#5A5851]">
                    Zone de travail souhaitée
                    <select
                      value={workZone}
                      onChange={(e) => setWorkZone(e.target.value)}
                      className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] bg-white px-3 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                    >
                      {DAKAR_ZONES.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            <label className="block text-xs font-semibold text-[#5A5851]">
              Adresse e-mail
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="nom@exemple.com"
                className="mt-1 w-full h-11 rounded-xl border border-[#D6D1C4] px-3 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </label>

            <label className="block text-xs font-semibold text-[#5A5851]">
              Mot de passe
              <span className="relative mt-1 block">
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                  className="w-full h-11 rounded-xl border border-[#D6D1C4] px-3 pr-11 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-2.5 p-1 text-[#5A5851] hover:text-[#141413] cursor-pointer"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </span>
            </label>

            {view === 'register' && (
              <>
                <label className="block text-xs font-semibold text-[#5A5851]">
                  Confirmation du mot de passe
                  <span className="relative mt-1 block">
                    <input
                      required
                      type={showConfirmPassword ? 'text' : 'password'}
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full h-11 rounded-xl border border-[#D6D1C4] px-3 pr-11 text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute right-3 top-2.5 p-1 text-[#5A5851] hover:text-[#141413] cursor-pointer"
                      aria-label={
                        showConfirmPassword
                          ? 'Masquer la confirmation du mot de passe'
                          : 'Afficher la confirmation du mot de passe'
                      }
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 pt-1 text-xs text-[#5A5851] leading-relaxed cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[#D6D1C4] accent-[#0E6E2D] shrink-0"
                  />
                  <span>
                    J’accepte les{' '}
                    <strong className="text-[#141413]">conditions d’utilisation de JikJikoox Express</strong>{' '}
                    et je comprends que mon compte doit être validé par un administrateur avant toute prise de
                    mission.
                  </span>
                </label>
              </>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[50px] rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>
                {busy
                  ? 'Veuillez patienter...'
                  : view === 'login'
                  ? 'Se connecter'
                  : 'Créer mon compte livreur'}
              </span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          {view === 'login' && (
            <div className="flex flex-wrap justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={busy}
                className="text-[#0E6E2D] font-semibold hover:underline cursor-pointer"
              >
                Mot de passe oublié ?
              </button>
              <button
                type="button"
                onClick={() => switchView('register')}
                className="text-[#0E6E2D] font-semibold hover:underline cursor-pointer"
              >
                Créer un compte livreur
              </button>
            </div>
          )}

          {view === 'register' && (
            <button
              type="button"
              onClick={() => switchView('login')}
              className="text-sm text-[#0E6E2D] font-semibold hover:underline cursor-pointer"
            >
              Déjà inscrit ? Se connecter
            </button>
          )}

          {view === 'login' && (
            <div className="space-y-3 border-t border-[#E5E2D9] pt-4">
              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={busy}
                className="w-full min-h-[48px] rounded-xl border border-[#D6D1C4] hover:bg-[#F7F6F2] text-[#141413] font-semibold text-sm disabled:opacity-60 transition-colors cursor-pointer"
              >
                Continuer avec Google
              </button>
              <button
                type="button"
                onClick={enterDemoMode}
                className="w-full min-h-[48px] rounded-xl bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#D6D1C4] text-[#141413] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Truck className="w-4 h-4 text-[#0E6E2D]" aria-hidden="true" />
                <span>Explorer en mode démonstration</span>
              </button>
            </div>
          )}

          {showIosGuide && isIosSafari && !canPromptInstall && (
            <div className="rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] p-3.5 text-xs text-[#5A5851] leading-relaxed">
              Pour installer sur iPhone/iPad via Safari : touchez{' '}
              <strong className="text-[#141413]">Partager</strong>, puis{' '}
              <strong className="text-[#141413]">Sur l’écran d’accueil</strong> et{' '}
              <strong className="text-[#141413]">Ajouter</strong>.
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-[#5A5851] pt-1">
            <ShieldCheck className="w-4 h-4 text-[#0E6E2D] shrink-0" aria-hidden="true" />
            <span>Authentification Firebase · Validation administrative obligatoire</span>
          </div>
          <p className="text-xs text-[#77736A] flex items-center gap-2">
            <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>En cas de blocage ou de changement d’appareil, contactez le support JikJikoox.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
