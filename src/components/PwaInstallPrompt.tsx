import { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PwaInstallPrompt() {
  const { isInstalled, isIosSafari, canPromptInstall, canShowInstallAction, isOffline, promptInstall } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  const handleInstall = async () => {
    const result = await promptInstall();
    if (result === 'ios_manual') {
      setShowIosHelp((prev) => !prev);
    }
  };

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

      {!isInstalled && !dismissed && canShowInstallAction && (
        <aside
          aria-label="Installation de l'application"
          className="fixed bottom-20 lg:bottom-5 inset-x-3 sm:left-auto sm:right-5 sm:w-[360px] z-[90] rounded-2xl bg-white border border-[#D6D1C4] shadow-xl p-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ECF7EE] text-[#0E6E2D] flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm text-[#141413]">Installer JikJikoox Express</p>
              <p className="text-xs text-[#5A5851] mt-1 leading-relaxed">
                Ajoutez l’application sur votre écran d’accueil pour accéder à vos missions en plein écran.
              </p>
              <button
                type="button"
                onClick={() => void handleInstall()}
                className="mt-3 min-h-[38px] rounded-lg bg-[#0E6E2D] hover:bg-[#095220] text-white px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {canPromptInstall ? (
                  <>
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Installer l’application</span>
                  </>
                ) : (
                  <>
                    <Share className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Installer sur iPhone / iPad</span>
                  </>
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Fermer la proposition d’installation"
              className="text-[#77736A] hover:text-[#141413] p-1 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {showIosHelp && isIosSafari && !canPromptInstall && (
            <div className="mt-3 p-3 rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] text-xs text-[#5A5851] leading-relaxed">
              Dans Safari : touchez le bouton <strong className="text-[#141413]">Partager</strong>, choisissez{' '}
              <strong className="text-[#141413]">Sur l’écran d’accueil</strong>, puis validez avec{' '}
              <strong className="text-[#141413]">Ajouter</strong>.
            </div>
          )}
        </aside>
      )}
    </>
  );
}
