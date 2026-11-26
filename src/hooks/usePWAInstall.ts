import { useCallback, useEffect, useState } from 'react';
import { firebasePublicConfig } from '../lib/firebase';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredInstallEvent: BeforeInstallPromptEvent | null = null;
let swRegistrationStarted = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return isIos && isSafari;
}

function ensureGlobalPwaListeners() {
  if (typeof window === 'undefined') return;
  const win = window as Window & { __jikjikooxPwaListenersBound?: boolean };
  if (win.__jikjikooxPwaListenersBound) return;
  win.__jikjikooxPwaListenersBound = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallEvent = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallEvent = null;
    notifyListeners();
  });

  if (!swRegistrationStarted && 'serviceWorker' in navigator && window.isSecureContext) {
    swRegistrationStarted = true;
    const workerConfig = new URLSearchParams({
      apiKey: firebasePublicConfig.apiKey || '',
      authDomain: firebasePublicConfig.authDomain || '',
      projectId: firebasePublicConfig.projectId || '',
      storageBucket: firebasePublicConfig.storageBucket || '',
      messagingSenderId: firebasePublicConfig.messagingSenderId || '',
      appId: firebasePublicConfig.appId || '',
    });
    navigator.serviceWorker
      .register(`/firebase-messaging-sw.js?${workerConfig.toString()}`, { scope: '/' })
      .catch((error) => {
        console.error('JikJikoox Express PWA: échec enregistrement Service Worker', error);
      });
  }
}

export interface PwaInstallState {
  isInstalled: boolean;
  isIosSafari: boolean;
  canPromptInstall: boolean;
  canShowInstallAction: boolean;
  isOffline: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'ios_manual' | 'unavailable'>;
}

export function usePWAInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectStandalone());
  const [hasPrompt, setHasPrompt] = useState<boolean>(() => Boolean(deferredInstallEvent));
  const [isOffline, setIsOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const isIosSafari = detectIosSafari();

  useEffect(() => {
    ensureGlobalPwaListeners();

    const sync = () => {
      setIsInstalled(detectStandalone());
      setHasPrompt(Boolean(deferredInstallEvent));
    };

    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    const media = window.matchMedia('(display-mode: standalone)');
    const onMediaChange = () => sync();

    listeners.add(sync);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    media.addEventListener?.('change', onMediaChange);
    sync();

    return () => {
      listeners.delete(sync);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      media.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (isInstalled) return 'unavailable' as const;
    if (deferredInstallEvent) {
      const promptEvent = deferredInstallEvent;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      deferredInstallEvent = null;
      notifyListeners();
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      return choice.outcome;
    }
    if (isIosSafari) {
      return 'ios_manual' as const;
    }
    return 'unavailable' as const;
  }, [isInstalled, isIosSafari]);

  return {
    isInstalled,
    isIosSafari,
    canPromptInstall: !isInstalled && hasPrompt,
    canShowInstallAction: !isInstalled && (hasPrompt || isIosSafari),
    isOffline,
    promptInstall,
  };
}
