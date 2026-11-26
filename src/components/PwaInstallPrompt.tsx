import { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { firebasePublicConfig } from '../lib/firebase';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const workerConfig = new URLSearchParams({
        apiKey: firebasePublicConfig.apiKey || '',
        authDomain: firebasePublicConfig.authDomain || '',
        projectId: firebasePublicConfig.projectId || '',
        storageBucket: firebasePublicConfig.storageBucket || '',
        messagingSenderId: firebasePublicConfig.messagingSenderId || '',
        appId: firebasePublicConfig.appId || '',
      });
      navigator.serviceWorker.register(`/firebase-messaging-sw.js?${workerConfig.toString()}`).catch((error) => {
        console.error('JikJikoox Express PWA: service worker registration failed', error);
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setInstallEvent(null);
    } else if (isIos) {
      setShowIosHelp(true);
    }
  };

  return (
    <>
      {offline && <div role="status" className="fixed top-0 inset-x-0 z-[100] bg-[#8A5600] text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2"><WifiOff size={15}/> Mode hors connexion — les actions de livraison nécessitent Internet.</div>}
      {!installed && !dismissed && (installEvent || isIos) && (
        <div className="fixed bottom-4 inset-x-3 sm:left-auto sm:right-5 sm:w-[360px] z-[90] rounded-2xl bg-white border border-[#D6D1C4] shadow-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ECF7EE] text-[#0E6E2D] flex items-center justify-center shrink-0"><Download size={20}/></div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm text-[#141413]">Installer JikJikoox Express</p>
              <p className="text-xs text-[#5A5851] mt-1">Ajoutez l’application à l’écran d’accueil pour y accéder rapidement.</p>
              <button type="button" onClick={install} className="mt-3 rounded-lg bg-[#0E6E2D] text-white px-4 py-2 text-xs font-semibold">{isIos && !installEvent ? 'Comment installer' : 'Installer l’application'}</button>
            </div>
            <button type="button" onClick={()=>setDismissed(true)} aria-label="Fermer" className="text-[#77736A] p-1"><X size={17}/></button>
          </div>
          {showIosHelp && <div className="mt-3 p-3 rounded-lg bg-[#F7F6F2] text-xs text-[#5A5851]">Sur Safari : touchez <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>, et confirmez avec <strong>Ajouter</strong>.</div>}
        </div>
      )}
    </>
  );
}
