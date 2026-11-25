import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { LOGIN_HERO_IMAGE } from '../data/demo/mockCourierData';

export function LoginPage() {
  const { signInWithGoogle, enterDemoMode, authError } = useCourierApp();
  const [signingIn, setSigningIn] = useState(false);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const [heroError, setHeroError] = useState(false);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col lg:grid lg:grid-cols-2">
      {/* Left / Top Editorial Visual Panel */}
      <div className="relative h-56 sm:h-72 lg:h-auto lg:min-h-screen overflow-hidden bg-[#0F6B3E]">
        {!heroError ? (
          <img
            src={LOGIN_HERO_IMAGE}
            alt="Scooter de livraison JikJikoox Express sur une avenue ensoleillée de Dakar"
            referrerPolicy="no-referrer"
            onError={() => setHeroError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#0F6B3E] via-[#0B5531] to-[#111915]" />
        )}

        {/* Measured contrast scrim for WCAG AA readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C1812]/85 via-[#0C1812]/35 to-[#0C1812]/15" />

        {/* Subtle Senegalese top identity bar */}
        <div className="absolute top-0 left-0 right-0 h-1 flex">
          <div className="flex-1 bg-[#0F6B3E]" />
          <div className="flex-1 bg-[#E5A400]" />
          <div className="flex-1 bg-[#C82829]" />
        </div>

        <div className="absolute inset-0 p-6 sm:p-10 lg:p-12 flex flex-col justify-between text-white">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-white text-[#0F6B3E] font-display font-extrabold text-sm flex items-center justify-center shadow-sm">
              JX
            </span>
            <span className="font-display font-extrabold text-lg tracking-tight">
              JikJikoox Express
            </span>
          </div>

          <div className="max-w-md">
            <p className="text-xs font-semibold text-[#FCD34D] mb-2">
              Réseau livraison · Dakar & Sénégal
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight">
              Vos missions locales, claires et maîtrisées sur le terrain.
            </h1>
            <p className="hidden sm:block text-sm text-white/85 mt-3 leading-relaxed">
              Recevez vos affectations JikJikoox, suivez les encaissements à la réception et
              transmettez vos preuves de livraison depuis votre téléphone.
            </p>
          </div>
        </div>
      </div>

      {/* Right / Bottom Authentication Column */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 sm:px-10 lg:px-16 bg-white">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-2xl font-extrabold text-[#111915] tracking-tight">
              Connexion livreur
            </h2>
            <p className="text-sm text-[#586860] mt-1.5 leading-relaxed">
              Accédez à votre espace personnel sécurisé. Chaque session est strictement cloisonnée
              à votre compte livreur.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-xl bg-[#FDF0F0] border border-[#C82829]/25 p-3.5 flex items-start gap-2.5 text-sm text-[#8F1D1E]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{authError}</span>
            </div>
          )}

          {/* Primary Firebase Google Sign-In */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={signingIn}
              className="w-full min-h-[52px] px-5 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F6B3E] focus-visible:ring-offset-2"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#FFFFFF"
                  d="M21.35 11.1h-9.18v2.98h5.3c-.23 1.44-1.66 4.22-5.3 4.22-3.19 0-5.79-2.64-5.79-5.9s2.6-5.9 5.79-5.9c1.82 0 3.04.77 3.74 1.44l2.55-2.46C16.82 3.96 14.71 3 12.17 3 7.1 3 3 7.1 3 12.4s4.1 9.4 9.17 9.4c5.29 0 8.8-3.72 8.8-8.95 0-.6-.06-1.06-.14-1.75z"
                />
              </svg>
              <span>
                {signingIn ? 'Connexion en cours...' : 'Se connecter avec Google'}
              </span>
            </button>

            <div className="relative py-2 flex items-center">
              <div className="flex-1 border-t border-[#E4EAE6]" />
              <span className="px-3 text-xs font-medium text-[#586860]">ou</span>
              <div className="flex-1 border-t border-[#E4EAE6]" />
            </div>

            {/* Explicitly Separated Local Demo Mode */}
            <button
              type="button"
              onClick={enterDemoMode}
              className="w-full min-h-[50px] px-5 rounded-xl bg-[#F6F7F6] hover:bg-[#ECF6F0] border border-[#D5DDD8] text-[#111915] font-semibold text-sm flex items-center justify-between gap-3 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Truck className="w-4 h-4 text-[#0F6B3E] shrink-0" aria-hidden="true" />
                <span>Explorer en mode démonstration</span>
              </span>
              <ArrowRight className="w-4 h-4 text-[#586860] shrink-0" aria-hidden="true" />
            </button>
            <p className="text-xs text-[#586860] leading-relaxed">
              Le mode démonstration charge des courses fictives à Dakar uniquement sur votre
              appareil, sans modifier les bases de production.
            </p>
          </div>

          {/* Recovery & Support Disclosure */}
          <div className="pt-2 border-t border-[#E4EAE6]">
            <button
              type="button"
              onClick={() => setShowRecoveryHelp((v) => !v)}
              className="w-full min-h-[44px] flex items-center justify-between gap-2 text-sm font-medium text-[#586860] hover:text-[#111915] transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <HelpCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Mot de passe oublié ou compte suspendu ?</span>
              </span>
              {showRecoveryHelp ? (
                <ChevronUp className="w-4 h-4 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 shrink-0" />
              )}
            </button>

            {showRecoveryHelp && (
              <div className="mt-2 rounded-xl bg-[#F6F7F6] p-4 text-xs text-[#586860] space-y-2 leading-relaxed">
                <p>
                  <strong className="text-[#111915]">Réinitialisation :</strong> utilisez la
                  récupération de votre compte Google professionnel ou demandez un lien de
                  réactivation auprès de votre coordinateur JikJikoox Admin.
                </p>
                <p>
                  <strong className="text-[#111915]">Support Dispatch Dakar :</strong> disponible du
                  lundi au samedi (08h00 – 20h00) via votre canal opérationnel interne.
                </p>
              </div>
            )}
          </div>

          {/* Trust Footer */}
          <div className="flex items-center gap-2 text-xs text-[#586860] pt-1">
            <ShieldCheck className="w-4 h-4 text-[#0F6B3E] shrink-0" aria-hidden="true" />
            <span>Authentification Firebase · Données isolées par livreur</span>
          </div>
        </div>
      </div>
    </div>
  );
}
