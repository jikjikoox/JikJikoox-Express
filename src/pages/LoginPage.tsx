import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { BrandAccentBar, BrandLogo } from '../components/BrandLogo';
import { useCourierApp } from '../context/CourierAppContext';
import { LOGIN_HERO_IMAGE } from '../lib/mediaAssets';

const KEY_FEATURES: { title: string; description: string }[] = [
  {
    title: 'Gestion des missions :',
    description:
      'réception et consultation des commandes qui vous sont affectées à Dakar et dans les zones de livraison couvertes.',
  },
  {
    title: 'Suivi des livraisons :',
    description:
      'mise à jour des étapes de prise en charge, de collecte, d’acheminement et de remise au client.',
  },
  {
    title: 'Géolocalisation GPS :',
    description:
      'partage de votre position pendant les opérations de livraison, selon les autorisations accordées.',
  },
  {
    title: 'Gestion des paiements :',
    description:
      'suivi des montants à encaisser à la livraison (paiement à la réception / COD), en FCFA.',
  },
  {
    title: 'Preuves de livraison :',
    description: 'confirmation sécurisée de la remise de la commande.',
  },
  {
    title: 'Notifications en temps réel :',
    description: 'alertes concernant les nouvelles missions et les changements opérationnels.',
  },
  {
    title: 'Tableau de bord :',
    description:
      'consultation de vos livraisons, de vos performances et de vos activités hebdomadaires.',
  },
];

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
      <div className="relative overflow-hidden bg-[#141413] flex flex-col lg:min-h-screen">
        {!heroError ? (
          <img
            src={LOGIN_HERO_IMAGE}
            alt="Scooter de livraison JikJikoox Express sur une avenue ensoleillée de Dakar"
            referrerPolicy="no-referrer"
            onError={() => setHeroError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#0E6E2D] via-[#141413] to-[#652214]" />
        )}

        {/* Measured contrast scrim for WCAG AA readability across all viewports */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#141413]/72 via-[#141413]/84 to-[#141413]/95" />

        {/* Signature JikJikoox leaf palette identity bar */}
        <BrandAccentBar className="relative z-10 shrink-0" />

        <div className="relative z-10 flex-1 px-5 py-6 sm:px-10 sm:py-9 lg:px-12 lg:py-10 flex flex-col justify-between gap-6 text-white">
          <BrandLogo size="md" showWordmark inverted />

          <div className="max-w-xl space-y-5">
            <div className="space-y-2.5">
              <h1 className="text-2xl sm:text-3xl lg:text-[2rem] font-extrabold leading-tight tracking-tight text-white">
                JikJikoox Express — Espace Livreur
              </h1>
              <p className="text-sm sm:text-base font-bold text-[#F4A61D] leading-snug">
                L’application professionnelle de livraison et de suivi des commandes JikJikoox au
                Sénégal.
              </p>
              <p className="text-sm text-white/90 leading-relaxed">
                Bienvenue dans votre espace de travail dédié à la gestion de vos livraisons.
                Consultez vos missions, organisez vos déplacements et suivez vos performances
                depuis une interface simple et sécurisée.
              </p>
            </div>

            <section aria-labelledby="key-features-heading" className="pt-4 border-t border-white/15 space-y-3">
              <h2
                id="key-features-heading"
                className="text-xs font-bold uppercase tracking-wider text-[#F4A61D]"
              >
                Fonctionnalités clés
              </h2>
              <ul className="space-y-2 text-[13px] sm:text-sm text-white/90 leading-snug">
                {KEY_FEATURES.map((feature) => (
                  <li key={feature.title} className="flex items-start gap-2.5">
                    <CheckCircle2
                      className="w-4 h-4 text-[#4ADE80] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>
                      <strong className="font-semibold text-white">{feature.title}</strong>{' '}
                      {feature.description}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="pt-3 border-t border-white/15 text-sm font-bold text-white leading-snug">
              JikJikoox Express — Chaque commande, une livraison suivie et maîtrisée.
            </p>
          </div>
        </div>
      </div>

      {/* Right / Bottom Authentication Column */}
      <div className="flex-1 flex items-center justify-center px-5 py-8 sm:px-10 lg:px-16 bg-white">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-4">
            <div className="hidden lg:block">
              <BrandLogo size="md" showWordmark subtitle="Espace livreur officiel" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-[#141413] tracking-tight">
                Connexion livreur
              </h2>
              <p className="text-sm text-[#5A5851] mt-1.5 leading-relaxed">
                Accédez à votre espace personnel sécurisé. Chaque session est strictement cloisonnée
                à votre compte livreur.
              </p>
            </div>
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-xl bg-[#FDF0EE] border border-[#C6241B]/25 p-3.5 flex items-start gap-2.5 text-sm text-[#921A14]"
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
              className="w-full min-h-[52px] px-5 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E6E2D] focus-visible:ring-offset-2"
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
              <div className="flex-1 border-t border-[#E5E2D9]" />
              <span className="px-3 text-xs font-medium text-[#5A5851]">ou</span>
              <div className="flex-1 border-t border-[#E5E2D9]" />
            </div>

            {/* Explicitly Separated Local Demo Mode */}
            <button
              type="button"
              onClick={enterDemoMode}
              className="w-full min-h-[50px] px-5 rounded-xl bg-[#F7F6F2] hover:bg-[#ECF7EE] border border-[#D6D1C4] text-[#141413] font-semibold text-sm flex items-center justify-between gap-3 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Truck className="w-4 h-4 text-[#0E6E2D] shrink-0" aria-hidden="true" />
                <span>Explorer en mode démonstration</span>
              </span>
              <ArrowRight className="w-4 h-4 text-[#5A5851] shrink-0" aria-hidden="true" />
            </button>
            <p className="text-xs text-[#5A5851] leading-relaxed">
              Le mode démonstration charge des courses fictives à Dakar uniquement sur votre
              appareil, sans modifier les bases de production.
            </p>
          </div>

          {/* Recovery & Support Disclosure */}
          <div className="pt-2 border-t border-[#E5E2D9]">
            <button
              type="button"
              onClick={() => setShowRecoveryHelp((v) => !v)}
              className="w-full min-h-[44px] flex items-center justify-between gap-2 text-sm font-medium text-[#5A5851] hover:text-[#141413] transition-colors cursor-pointer"
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
              <div className="mt-2 rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] p-4 text-xs text-[#5A5851] space-y-2 leading-relaxed">
                <p>
                  <strong className="text-[#141413]">Réinitialisation :</strong> utilisez la
                  récupération de votre compte Google professionnel ou demandez un lien de
                  réactivation auprès de votre coordinateur JikJikoox Admin.
                </p>
                <p>
                  <strong className="text-[#141413]">Support Dispatch Dakar :</strong> disponible du
                  lundi au samedi (08h00 – 20h00) via votre canal opérationnel interne.
                </p>
              </div>
            )}
          </div>

          {/* Trust Footer */}
          <div className="flex items-center gap-2 text-xs text-[#5A5851] pt-1">
            <ShieldCheck className="w-4 h-4 text-[#0E6E2D] shrink-0" aria-hidden="true" />
            <span>Authentification Firebase · Données isolées par livreur</span>
          </div>
        </div>
      </div>
    </div>
  );
}
