import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp, firebasePublicConfig } from './firebase';
import type { PushSupportState } from '../types/delivery';

/**
 * Service Web Push Firebase Cloud Messaging (FCM) pour JikJikoox Express.
 * - Demande explicitement la permission navigateur uniquement à l'action du livreur.
 * - Enregistre le Service Worker `/firebase-messaging-sw.js` avec la configuration Web publique.
 * - Gère la révocation propre du jeton et le fallback in-app si Push n'est pas supporté.
 * - N'invente jamais de clé VAPID : lit uniquement `VITE_FIREBASE_VAPID_KEY`.
 */

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export function getConfiguredVapidKey(): string {
  return (metaEnv.VITE_FIREBASE_VAPID_KEY || '').trim();
}

export function isWebPushEnvironmentSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function detectPushSupportState(): PushSupportState {
  if (!isWebPushEnvironmentSupported()) {
    return 'unsupported';
  }
  if (!getConfiguredVapidKey()) {
    return 'vapid_missing';
  }
  const perm = window.Notification.permission;
  if (perm === 'denied') return 'permission_denied';
  if (perm === 'granted') return 'ready';
  return 'permission_prompt';
}

export interface ForegroundPushPayload {
  title: string;
  body: string;
  missionId?: string;
  category?: string;
}

export interface FcmRegistrationResult {
  ok: boolean;
  token?: string;
  state: PushSupportState;
  message: string;
}

function buildServiceWorkerUrl(): string {
  const params = new URLSearchParams({
    apiKey: firebasePublicConfig.apiKey || '',
    authDomain: firebasePublicConfig.authDomain || '',
    projectId: firebasePublicConfig.projectId || '',
    storageBucket: firebasePublicConfig.storageBucket || '',
    messagingSenderId: firebasePublicConfig.messagingSenderId || '',
    appId: firebasePublicConfig.appId || '',
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export async function registerFcmPushToken(): Promise<FcmRegistrationResult> {
  if (!isWebPushEnvironmentSupported()) {
    return {
      ok: false,
      state: 'unsupported',
      message:
        'Les notifications push navigateur ne sont pas supportées sur cet appareil. Les alertes in-app restent actives.',
    };
  }

  const vapidKey = getConfiguredVapidKey();
  if (!vapidKey) {
    return {
      ok: false,
      state: 'vapid_missing',
      message:
        'Clé Web Push VAPID (VITE_FIREBASE_VAPID_KEY) non configurée dans cet environnement. Les notifications in-app restent actives.',
    };
  }

  const fcmSupported = await isSupported().catch(() => false);
  if (!fcmSupported) {
    return {
      ok: false,
      state: 'unsupported',
      message:
        'Firebase Cloud Messaging n’est pas disponible sur ce navigateur (ex: navigation privée ou iOS hors écran d’accueil).',
    };
  }

  const permission =
    window.Notification.permission === 'granted'
      ? 'granted'
      : await window.Notification.requestPermission();

  if (permission !== 'granted') {
    return {
      ok: false,
      state: permission === 'denied' ? 'permission_denied' : 'permission_prompt',
      message:
        permission === 'denied'
          ? 'Autorisation refusée dans le navigateur. Activez les notifications dans les réglages du site pour recevoir les alertes missions.'
          : 'Autorisation de notifications non confirmée.',
    };
  }

  try {
    const swRegistration = await navigator.serviceWorker.register(buildServiceWorkerUrl(), {
      scope: '/',
    });
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      return {
        ok: false,
        state: 'permission_prompt',
        message: 'Impossible d’obtenir un jeton FCM pour cet appareil. Réessayez dans un instant.',
      };
    }

    return {
      ok: true,
      token,
      state: 'ready',
      message: 'Notifications push activées sur cet appareil.',
    };
  } catch {
    return {
      ok: false,
      state: 'unsupported',
      message:
        'Activation push impossible pour le moment (vérifiez HTTPS et la configuration FCM). Les alertes in-app restent actives.',
    };
  }
}

export async function unregisterFcmPushToken(): Promise<boolean> {
  if (!isWebPushEnvironmentSupported()) return true;
  try {
    const fcmSupported = await isSupported().catch(() => false);
    if (!fcmSupported) return true;
    const messaging = getMessaging(firebaseApp);
    return await deleteToken(messaging);
  } catch {
    return false;
  }
}

export async function subscribeForegroundFcmMessages(
  handler: (payload: ForegroundPushPayload) => void
): Promise<(() => void) | null> {
  if (!isWebPushEnvironmentSupported()) return null;
  if (!getConfiguredVapidKey()) return null;
  const fcmSupported = await isSupported().catch(() => false);
  if (!fcmSupported) return null;

  try {
    const messaging = getMessaging(firebaseApp);
    return onMessage(messaging, (message) => {
      const title =
        message.notification?.title ||
        (typeof message.data?.title === 'string' ? message.data.title : 'JikJikoox Express');
      const body =
        message.notification?.body ||
        (typeof message.data?.body === 'string'
          ? message.data.body
          : 'Nouvelle mise à jour opérationnelle disponible.');
      handler({
        title,
        body,
        missionId: typeof message.data?.missionId === 'string' ? message.data.missionId : undefined,
        category: typeof message.data?.category === 'string' ? message.data.category : undefined,
      });
    });
  } catch {
    return null;
  }
}

/**
 * Signal sonore discret via Web Audio API lorsque le livreur a activé le son des alertes.
 */
export function playPriorityNotificationChime(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 350);
  } catch {
    // Autoplay audio bloqué par le navigateur : silencieux sans erreur
  }
}
