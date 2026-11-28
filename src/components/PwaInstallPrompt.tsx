import { useEffect, useState } from 'react';
import { CheckCircle2, Download, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const DISMISS_STORAGE_KEY = 'jikjikoox_pwa_snackbar_dismissed_v1';

export function PwaInstallPrompt() {
  const { isInstalled, canPromptInstall, isOffline, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (!justInstalled) return;
    const timer = window.setTimeout(() => setJustInstalled(false), 4000);
    return () => window.clearTimeout(timer);
  }, [justInstalled]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore storage restriction
    }
  };

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setJustInstalled(true);
      } else if (outcome === 'dismissed') {
        handleDismiss();
      }
    } finally {
      setInstalling(false);
    }
  };

  const showInstallSnackbar = !isInstalled && !dismissed && canPromptInstall;

  return (
    <>
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-[100] bg-[#8A5600] text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm"
        >
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            Mode hors connexion — consultation en lecture seule. La confirmation d’une livraison nécessite Internet.
          </span>
        </div>
      )}

      {justInstalled && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[76px] lg:bottom-5 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-[95] sm:w-auto sm:max-w-md rounded-2xl bg-[#0E6E2D] text-white px-4 py-3 shadow-2xl border border-white/15 flex items-center gap-2.5 text-sm font-semibold"
        >
          <CheckCircle2 className="w-5 h-5 text-[#F4A61D] shrink-0" aria-hidden="true" />
          <span>JikJikoox Express a été ajoutée à votre écran d’accueil.</span>
        </div>
      )}

      {showInstallSnackbar && (
        <div
          role="region"
          aria-live="polite"
          aria-label="Installation de l’application JikJikoox Express"
          className="fixed bottom-[76px] lg:bottom-5 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg z-[90] overflow-hidden rounded-2xl bg-[#141413] text-white border border-white/12 shadow-2xl"
        >
          <div className="h-[3px] w-full flex" aria-hidden="true">
            <span className="flex-1 bg-[#0E6E2D]" />
            <span className="flex-1 bg-[#F4A61D]" />
            <span className="flex-1 bg-[#C6241B]" />
          </div>

          <div className="px-3.5 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 border border-white/20">
              {!logoError ? (
                <img
                  src="/assets/aistudio/unnamed_a49eff38.png"
                  alt="Logo JikJikoox Express"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Download className="w-5 h-5 text-[#0E6E2D]" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight text-white truncate">
                Installer JikJikoox Express
              </p>
              <p className="text-xs text-white/75 mt-0.5 leading-snug line-clamp-2">
                Ajoutez l’app sur l’écran d’accueil pour un accès rapide en plein écran.
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{installing ? 'Ouverture...' : 'Installer'}</span>
              </button>

              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Fermer la suggestion d’installation"
                className="min-w-[36px] min-h-[36px] rounded-xl text-white/65 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
