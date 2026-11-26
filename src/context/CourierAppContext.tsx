import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider, testFirestoreConnection } from '../lib/firebase';
import {
  detectPushSupportState,
  playPriorityNotificationChime,
  registerFcmPushToken,
  subscribeForegroundFcmMessages,
  unregisterFcmPushToken,
} from '../lib/fcmPush';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { isTransitionAllowed, MISSION_STATUS_META } from '../lib/missionWorkflow';
import {
  isSupabaseBackendConfigured,
  mapEdgeDeliveryToMission,
  mapEdgeDriverToProfile,
  mapEdgeNotificationToClient,
} from '../lib/supabaseContract';
import {
  type CourierGpsTrackerState,
  useCourierGpsTracker,
} from '../hooks/useCourierGpsTracker';
import { expressApi, ExpressApiError } from '../services/expressApi';
import { DEFAULT_COURIER_AVATAR } from '../lib/mediaAssets';
import type {
  AccountStatus,
  CourierNotification,
  CourierProfile,
  DeliveryMission,
  MissionEvent,
  MissionStatus,
  ProofSubmission,
  PushSupportState,
  VehicleType,
} from '../types/delivery';

export type SessionMode = 'unauthenticated' | 'firebase' | 'demo';

export interface ToastMessage {
  id: number;
  tone: 'green' | 'yellow' | 'red';
  text: string;
}

export interface ProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  vehicleType?: VehicleType;
  vehiclePlate?: string;
  workZone?: string;
  isAvailable?: boolean;
  notificationsEnabled?: boolean;
  pushSoundEnabled?: boolean;
}

export interface PushNotificationState {
  supportState: PushSupportState;
  busy: boolean;
  tokenRegistered: boolean;
  statusMessage: string | null;
}

export interface ProofPhotoUploadResult {
  proofId: string;
  storagePath: string;
  uploadVerified: boolean;
}

export interface CourierRegistrationInput {
  firstName: string;
  lastName: string;
  phone: string;
  vehicleType: VehicleType;
  workZone: string;
  termsAccepted: boolean;
}

interface CourierAppContextValue {
  mode: SessionMode;
  backendConnected: boolean;
  isOnline: boolean;
  authReady: boolean;
  loadingData: boolean;
  firebaseUser: User | null;
  isAdminUser: boolean;
  profile: CourierProfile | null;
  profileNotFound: boolean;
  missions: DeliveryMission[];
  notifications: CourierNotification[];
  unreadCount: number;
  authError: string | null;
  toast: ToastMessage | null;
  gpsTracker: CourierGpsTrackerState;
  pushState: PushNotificationState;
  dismissToast: () => void;
  showToast: (text: string, tone?: 'green' | 'yellow' | 'red') => void;
  signInWithGoogle: () => Promise<void>;
  completeCourierRegistration: (input: CourierRegistrationInput) => Promise<boolean>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  logout: () => Promise<void>;
  refreshBackendData: () => Promise<void>;
  toggleAvailability: () => Promise<void>;
  updateProfile: (updates: ProfileUpdateInput) => Promise<void>;
  enablePushNotifications: () => Promise<boolean>;
  disablePushNotifications: () => Promise<void>;
  uploadDeliveryProofPhoto: (params: {
    deliveryId: string;
    file: File;
    recipientName: string;
    proofCode?: string;
    proofNote?: string;
    codCollectedConfirmed: boolean;
    onStageChange?: (stage: 'preparing' | 'uploading' | 'confirming') => void;
  }) => Promise<ProofPhotoUploadResult>;
  transitionMission: (
    missionId: string,
    nextStatus: MissionStatus,
    options?: { proof?: ProofSubmission; failureReason?: string }
  ) => Promise<boolean>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const CourierAppContext = createContext<CourierAppContextValue | null>(null);

function tsToIso(value: unknown, fallbackIso?: string): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return fallbackIso ?? new Date().toISOString();
}

function isSafePhotoUrl(url: string | null | undefined): url is string {
  if (!url || url.length > 500) return false;
  return url.startsWith('https://') || url.startsWith('/src/assets/');
}

function normalizeAccountStatus(raw: unknown): AccountStatus {
  if (raw === 'active' || raw === 'suspended' || raw === 'disabled' || raw === 'pending') {
    return raw;
  }
  return 'pending';
}

function parseDisplayName(displayName: string | null | undefined, email: string): {
  firstName: string;
  lastName: string;
} {
  const clean = (displayName || '').trim();
  if (clean.length > 0) {
    const parts = clean.split(/\s+/);
    const firstName = parts[0].slice(0, 60);
    const lastName = (parts.slice(1).join(' ') || 'Livreur').slice(0, 60);
    return { firstName, lastName };
  }
  const emailPrefix = email.split('@')[0] || 'Livreur';
  return {
    firstName: emailPrefix.slice(0, 60),
    lastName: 'JikJikoox',
  };
}

const OFFLINE_SNAPSHOT_PREFIX = 'jikjikoox_express_readonly_snapshot_v1:';

interface ReadOnlyCourierSnapshot {
  profile: CourierProfile;
  missions: DeliveryMission[];
  notifications: CourierNotification[];
  savedAtIso: string;
}

function saveReadOnlySnapshot(uid: string, snapshot: ReadOnlyCourierSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${OFFLINE_SNAPSHOT_PREFIX}${uid}`, JSON.stringify(snapshot));
  } catch {
    // Ignore quota errors in restricted storage environments
  }
}

function loadReadOnlySnapshot(uid: string): ReadOnlyCourierSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${OFFLINE_SNAPSHOT_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReadOnlyCourierSnapshot;
    if (!parsed?.profile || parsed.profile.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearAllReadOnlySnapshots() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(OFFLINE_SNAPSHOT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Ignore storage access errors
  }
}

export function CourierAppProvider({ children }: { children: React.ReactNode }) {
  const backendConnected = isSupabaseBackendConfigured();

  const [mode, setMode] = useState<SessionMode>('unauthenticated');
  const [isOnline, setIsOnline] = useState<boolean>(
    () => typeof navigator === 'undefined' || navigator.onLine !== false
  );
  const [authReady, setAuthReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [missions, setMissions] = useState<DeliveryMission[]>([]);
  const [notifications, setNotifications] = useState<CourierNotification[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const showToast = useCallback((text: string, tone: 'green' | 'yellow' | 'red' = 'green') => {
    setToast({ id: Date.now(), tone, text });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 1. Firebase Auth state observer
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user) {
        setMode((prev) => (prev === 'demo' ? 'demo' : 'firebase'));
        setProfileNotFound(false);
        setAuthError(null);
      } else {
        setIsAdminUser(false);
        setProfileNotFound(false);
        clearAllReadOnlySnapshots();
        setMode((prev) => {
          if (prev === 'demo') return 'demo';
          setProfile(null);
          setMissions([]);
          setNotifications([]);
          return 'unauthenticated';
        });
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Chargement officiel depuis les Supabase Edge Functions (si configuré)
  const refreshBackendData = useCallback(async () => {
    if (mode !== 'firebase' || !firebaseUser || !backendConnected) return;

    const loadWithToken = async (forceRefresh: boolean) => {
      const idToken = await firebaseUser.getIdToken(forceRefresh);
      const profileRes = await expressApi.fetchDriverProfile(idToken);
      const mappedProfile = mapEdgeDriverToProfile(profileRes.profile);
      setProfileNotFound(false);
      setProfile(mappedProfile);

      if (mappedProfile.accountStatus === 'active') {
        const [delivRes, notifRes] = await Promise.all([
          expressApi.fetchDriverDeliveries(idToken),
          expressApi.fetchNotifications(idToken),
        ]);
        const mappedMissions = delivRes.deliveries.map(mapEdgeDeliveryToMission);
        const mappedNotifications = notifRes.notifications.map(mapEdgeNotificationToClient);
        setMissions(mappedMissions);
        setNotifications(mappedNotifications);
        saveReadOnlySnapshot(firebaseUser.uid, {
          profile: mappedProfile,
          missions: mappedMissions,
          notifications: mappedNotifications,
          savedAtIso: new Date().toISOString(),
        });
      } else {
        setMissions([]);
        setNotifications([]);
      }
    };

    try {
      await loadWithToken(false);
    } catch (err) {
      if (err instanceof ExpressApiError) {
        if (err.status === 404 && err.code === 'DRIVER_NOT_REGISTERED') {
          setProfile(null);
          setMissions([]);
          setNotifications([]);
          setProfileNotFound(true);
          return;
        }
        if (err.status === 401 && (err.code === 'TOKEN_EXPIRED' || err.code === 'TOKEN_INVALID')) {
          try {
            await loadWithToken(true);
            return;
          } catch {
            clearAllReadOnlySnapshots();
            await signOut(auth).catch(() => undefined);
            setMode('unauthenticated');
            setProfile(null);
            setMissions([]);
            setNotifications([]);
            setAuthError('Votre session a expiré. Veuillez vous reconnecter.');
            return;
          }
        }
        if (err.code === 'OFFLINE_NO_CONNECTION' || err.code === 'NETWORK_UNREACHABLE') {
          const cached = loadReadOnlySnapshot(firebaseUser.uid);
          if (cached) {
            setProfile(cached.profile);
            setMissions(cached.missions);
            setNotifications(cached.notifications);
            showToast(
              'Mode hors connexion : affichage des dernières missions chargées (lecture seule).',
              'yellow'
            );
            return;
          }
        }
        showToast(err.message, 'red');
      }
    }
  }, [mode, firebaseUser, backendConnected, showToast]);

  // 2. Profil livreur : Supabase Edge Function en priorité si configuré, sinon miroir Firestore
  useEffect(() => {
    if (mode !== 'firebase' || !firebaseUser) {
      return;
    }

    const uid = firebaseUser.uid;
    let active = true;
    setLoadingData(true);

    if (backendConnected) {
      void (async () => {
        try {
          const adminCheck = getDoc(doc(db, 'admins', uid))
            .then((snap) => {
              if (active) setIsAdminUser(snap.exists() && snap.data()?.active === true);
            })
            .catch(() => {
              if (active) setIsAdminUser(false);
            });
          await Promise.all([refreshBackendData(), adminCheck]);
        } finally {
          if (active) setLoadingData(false);
        }
      })();
      return () => {
        active = false;
      };
    }

    void testFirestoreConnection();

    const checkAdminRecord = async () => {
      try {
        const adminSnap = await getDoc(doc(db, 'admins', uid));
        if (active) {
          setIsAdminUser(adminSnap.exists() && adminSnap.data()?.active === true);
        }
      } catch {
        if (active) setIsAdminUser(false);
      }
    };
    void checkAdminRecord();

    const courierRef = doc(db, 'couriers', uid);

    const ensureCourierRegistration = async () => {
      try {
        const snap = await getDoc(courierRef);
        if (!snap.exists() && active) {
          const email = firebaseUser.email;
          if (!email || !firebaseUser.emailVerified) {
            setAuthError('Votre adresse email Google doit être vérifiée pour accéder au service.');
            setLoadingData(false);
            return;
          }
          const { firstName, lastName } = parseDisplayName(firebaseUser.displayName, email);
          const safePhoto = isSafePhotoUrl(firebaseUser.photoURL)
            ? firebaseUser.photoURL
            : DEFAULT_COURIER_AVATAR;

          await setDoc(courierRef, {
            uid,
            firstName,
            lastName,
            email: email.slice(0, 160),
            phone: '+221 77 000 00 00',
            photoUrl: safePhoto,
            vehicleType: 'scooter',
            vehiclePlate: 'DK-0000-JK',
            workZone: 'Dakar Plateau',
            isAvailable: false,
            role: 'courier',
            accountStatus: 'pending',
            notificationsEnabled: true,
            pushSoundEnabled: true,
            fcmTokenStatus: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `couriers/${uid}`);
      }
    };

    void ensureCourierRegistration();

    const unsubProfile = onSnapshot(
      courierRef,
      (snap) => {
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data();
          const safePhoto = isSafePhotoUrl(typeof data.photoUrl === 'string' ? data.photoUrl : null)
            ? String(data.photoUrl)
            : DEFAULT_COURIER_AVATAR;

          setProfile({
            uid: String(data.uid ?? uid),
            firstName: String(data.firstName ?? 'Livreur'),
            lastName: String(data.lastName ?? ''),
            email: String(data.email ?? firebaseUser.email ?? ''),
            phone: String(data.phone ?? '+221 77 000 00 00'),
            photoUrl: safePhoto,
            vehicleType: (data.vehicleType as VehicleType) ?? 'scooter',
            vehiclePlate: typeof data.vehiclePlate === 'string' ? data.vehiclePlate : undefined,
            workZone: String(data.workZone ?? 'Dakar Plateau'),
            isAvailable: Boolean(data.isAvailable),
            role: 'courier',
            accountStatus: normalizeAccountStatus(data.accountStatus),
            notificationsEnabled: Boolean(data.notificationsEnabled),
            pushSoundEnabled: Boolean(data.pushSoundEnabled),
            fcmTokenStatus:
              data.fcmTokenStatus === 'registered' || data.fcmTokenStatus === 'pending'
                ? data.fcmTokenStatus
                : 'unregistered',
            createdAtIso: tsToIso(data.createdAt),
            updatedAtIso: tsToIso(data.updatedAt),
          });
        }
        setLoadingData(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `couriers/${uid}`);
      }
    );

    return () => {
      active = false;
      unsubProfile();
    };
  }, [mode, firebaseUser, backendConnected, refreshBackendData]);

  // 3. Miroir opérationnel temps réel Firestore (LECTURE SEULE pour missions)
  const isAuthorizedActiveCourier =
    mode === 'firebase' && Boolean(firebaseUser) && profile?.accountStatus === 'active';

  useEffect(() => {
    if (!isAuthorizedActiveCourier || !firebaseUser) {
      if (mode === 'firebase') {
        setMissions([]);
        setNotifications([]);
      }
      return;
    }

    const uid = firebaseUser.uid;
    let active = true;

    const missionsQuery = query(collection(db, 'missions'), where('courierId', '==', uid));
    const unsubMissions = onSnapshot(
      missionsQuery,
      (snapshot) => {
        if (!active || (backendConnected && snapshot.empty)) return;
        const list: DeliveryMission[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            missionId: String(data.missionId ?? d.id),
            orderNumber: String(data.orderNumber ?? ''),
            courierId: String(data.courierId ?? uid),
            dataSource: 'supabase_sync',
            customerName: String(data.customerName ?? ''),
            customerPhone: String(data.customerPhone ?? ''),
            deliveryAddress: String(data.deliveryAddress ?? ''),
            deliveryZone: String(data.deliveryZone ?? ''),
            pickupName: String(data.pickupName ?? ''),
            pickupAddress: String(data.pickupAddress ?? ''),
            gpsLat: typeof data.gpsLat === 'number' ? data.gpsLat : undefined,
            gpsLng: typeof data.gpsLng === 'number' ? data.gpsLng : undefined,
            itemsSummary: Array.isArray(data.itemsSummary) ? data.itemsSummary : [],
            itemCount: typeof data.itemCount === 'number' ? data.itemCount : 1,
            paymentMode: data.paymentMode === 'cod' ? 'cod' : 'prepaid',
            codAmount: typeof data.codAmount === 'number' ? data.codAmount : 0,
            estimatedFee: typeof data.estimatedFee === 'number' ? data.estimatedFee : 0,
            instructions: String(data.instructions ?? ''),
            status: (data.status as MissionStatus) ?? 'ASSIGNED',
            proofCode: typeof data.proofCode === 'string' ? data.proofCode : undefined,
            proofNote: typeof data.proofNote === 'string' ? data.proofNote : undefined,
            recipientName: typeof data.recipientName === 'string' ? data.recipientName : undefined,
            failureReason: typeof data.failureReason === 'string' ? data.failureReason : undefined,
            events: Array.isArray(data.events) ? data.events : [],
            createdAtIso: tsToIso(data.createdAt),
            updatedAtIso: tsToIso(data.updatedAt),
          };
        });
        list.sort((a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime());
        setMissions(list);
      },
      (error) => {
        if (!backendConnected) {
          handleFirestoreError(error, OperationType.LIST, 'missions');
        }
      }
    );

    const notifsQuery = query(collection(db, 'notifications'), where('courierId', '==', uid));
    const unsubNotifs = onSnapshot(
      notifsQuery,
      (snapshot) => {
        if (!active || (backendConnected && snapshot.empty)) return;
        const list: CourierNotification[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            notificationId: String(data.notificationId ?? d.id),
            courierId: String(data.courierId ?? uid),
            dataSource: 'supabase_sync',
            category: data.category ?? 'operational',
            title: String(data.title ?? ''),
            body: String(data.body ?? ''),
            missionId: typeof data.missionId === 'string' ? data.missionId : undefined,
            isRead: Boolean(data.isRead),
            createdAtIso: tsToIso(data.createdAt),
            readAtIso: data.readAt ? tsToIso(data.readAt) : undefined,
          };
        });
        list.sort((a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime());
        setNotifications(list);
      },
      (error) => {
        if (!backendConnected) {
          handleFirestoreError(error, OperationType.LIST, 'notifications');
        }
      }
    );

    return () => {
      active = false;
      unsubMissions();
      unsubNotifs();
    };
  }, [isAuthorizedActiveCourier, firebaseUser, mode, backendConnected]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setMode('firebase');
      showToast('Authentification Google réussie.', 'green');
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setAuthError('Fenêtre de connexion fermée avant validation.');
      } else {
        setAuthError('Impossible de finaliser la connexion Google. Veuillez réessayer.');
      }
    }
  }, [showToast]);

  const completeCourierRegistration = useCallback(
    async (input: CourierRegistrationInput): Promise<boolean> => {
      if (!firebaseUser) return false;
      if (!backendConnected) {
        showToast('Backend Supabase non configuré : inscription serveur indisponible.', 'red');
        return false;
      }
      try {
        const idToken = await firebaseUser.getIdToken(true);
        const res = await expressApi.registerDriver(idToken, {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone.trim(),
          vehicleType: input.vehicleType,
          workZone: input.workZone.trim(),
          termsAccepted: input.termsAccepted,
        });
        const mapped = mapEdgeDriverToProfile(res.profile);
        setProfile(mapped);
        setProfileNotFound(false);
        showToast(
          'Votre candidature livreur est enregistrée et en attente de validation administrative.',
          'green'
        );
        return true;
      } catch (err) {
        const message =
          err instanceof ExpressApiError
            ? err.message
            : 'Impossible de finaliser la création du profil livreur.';
        showToast(message, 'red');
        return false;
      }
    },
    [firebaseUser, backendConnected, showToast]
  );

  // Mode démonstration 100 % local en mémoire — ZERO appel Supabase / Firebase (chargé à la demande)
  const enterDemoMode = useCallback(() => {
    setAuthError(null);
    setProfileNotFound(false);
    setLoadingData(true);
    void import('../data/demo/mockCourierData')
      .then(({ buildDemoMissions, buildDemoNotifications, DEMO_COURIER_PROFILE }) => {
        setMode('demo');
        setProfile({ ...DEMO_COURIER_PROFILE });
        setMissions(buildDemoMissions(DEMO_COURIER_PROFILE.uid));
        setNotifications(buildDemoNotifications(DEMO_COURIER_PROFILE.uid));
        showToast('Mode démonstration local activé (données Dakar isolées).', 'yellow');
      })
      .finally(() => {
        setLoadingData(false);
      });
  }, [showToast]);

  const exitDemoMode = useCallback(() => {
    setProfile(null);
    setProfileNotFound(false);
    setMissions([]);
    setNotifications([]);
    setMode(firebaseUser ? 'firebase' : 'unauthenticated');
  }, [firebaseUser]);

  const gpsTrackingEnabled =
    mode === 'demo' || (mode === 'firebase' && Boolean(firebaseUser) && profile?.accountStatus === 'active');

  const gpsTracker = useCourierGpsTracker({
    enabled: gpsTrackingEnabled,
    mode,
    backendConnected,
    firebaseUser,
    missions,
    onNotify: showToast,
  });

  const [pushSupportState, setPushSupportState] = useState<PushSupportState>(() =>
    detectPushSupportState()
  );
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(null);

  // Écoute des notifications FCM en premier plan (foreground)
  useEffect(() => {
    if (
      mode !== 'firebase' ||
      !firebaseUser ||
      profile?.accountStatus !== 'active' ||
      profile?.notificationsEnabled === false
    ) {
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let active = true;

    void subscribeForegroundFcmMessages((payload) => {
      if (!active) return;
      showToast(`${payload.title} — ${payload.body}`, 'green');
      if (profile.pushSoundEnabled) {
        playPriorityNotificationChime();
      }
      if (backendConnected) {
        void refreshBackendData();
      }
    }).then((unsub) => {
      if (!active) {
        unsub?.();
        return;
      }
      unsubscribe = unsub;
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    mode,
    firebaseUser,
    profile?.accountStatus,
    profile?.notificationsEnabled,
    profile?.pushSoundEnabled,
    backendConnected,
    refreshBackendData,
    showToast,
  ]);

  const enablePushNotifications = useCallback(async (): Promise<boolean> => {
    setPushBusy(true);
    setPushStatusMessage(null);
    try {
      if (mode === 'demo') {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                notificationsEnabled: true,
                fcmTokenStatus: 'registered',
                updatedAtIso: new Date().toISOString(),
              }
            : null
        );
        setPushSupportState('ready');
        setPushStatusMessage('Alertes push simulées en mode démonstration local.');
        showToast('Alertes missions activées (mode démonstration).', 'green');
        return true;
      }

      if (mode !== 'firebase' || !firebaseUser || profile?.accountStatus !== 'active') {
        showToast('Activation réservée aux livreurs actifs connectés.', 'red');
        return false;
      }

      const reg = await registerFcmPushToken();
      setPushSupportState(reg.state);
      setPushStatusMessage(reg.message);

      if (!reg.ok || !reg.token) {
        showToast(reg.message, reg.state === 'permission_denied' ? 'red' : 'yellow');
        return false;
      }

      if (backendConnected) {
        const idToken = await firebaseUser.getIdToken();
        const res = await expressApi.updateDriverProfile(idToken, {
          notificationsEnabled: true,
          fcmToken: reg.token,
        });
        setProfile(mapEdgeDriverToProfile(res.profile));
      } else {
        await updateDoc(doc(db, 'couriers', firebaseUser.uid), {
          notificationsEnabled: true,
          fcmTokenStatus: 'registered',
          updatedAt: serverTimestamp(),
        });
      }

      showToast('Notifications push FCM activées sur cet appareil.', 'green');
      return true;
    } catch (err) {
      const msg =
        err instanceof ExpressApiError
          ? err.message
          : 'Impossible d’enregistrer les notifications push.';
      setPushStatusMessage(msg);
      showToast(msg, 'red');
      return false;
    } finally {
      setPushBusy(false);
    }
  }, [mode, firebaseUser, profile?.accountStatus, backendConnected, showToast]);

  const disablePushNotifications = useCallback(async () => {
    setPushBusy(true);
    try {
      if (mode === 'demo') {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                notificationsEnabled: false,
                fcmTokenStatus: 'unregistered',
                updatedAtIso: new Date().toISOString(),
              }
            : null
        );
        setPushStatusMessage('Notifications push désactivées (mode démo).');
        showToast('Notifications push désactivées.', 'yellow');
        return;
      }

      await unregisterFcmPushToken();
      if (mode === 'firebase' && firebaseUser && profile?.accountStatus === 'active') {
        if (backendConnected) {
          const idToken = await firebaseUser.getIdToken();
          const res = await expressApi.updateDriverProfile(idToken, {
            notificationsEnabled: false,
            fcmToken: null,
          });
          setProfile(mapEdgeDriverToProfile(res.profile));
        } else {
          await updateDoc(doc(db, 'couriers', firebaseUser.uid), {
            notificationsEnabled: false,
            fcmTokenStatus: 'unregistered',
            updatedAt: serverTimestamp(),
          });
        }
      }
      setPushSupportState(detectPushSupportState());
      setPushStatusMessage('Notifications push désactivées sur cet appareil.');
      showToast('Notifications push désactivées.', 'yellow');
    } catch (err) {
      showToast(
        err instanceof ExpressApiError
          ? err.message
          : 'Erreur lors de la désactivation des notifications.',
        'red'
      );
    } finally {
      setPushBusy(false);
    }
  }, [mode, firebaseUser, profile?.accountStatus, backendConnected, showToast]);

  const uploadDeliveryProofPhoto = useCallback(
    async (params: {
      deliveryId: string;
      file: File;
      recipientName: string;
      proofCode?: string;
      proofNote?: string;
      codCollectedConfirmed: boolean;
      onStageChange?: (stage: 'preparing' | 'uploading' | 'confirming') => void;
    }): Promise<ProofPhotoUploadResult> => {
      const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowedMimes.has(params.file.type)) {
        throw new Error('Format non supporté. Utilisez uniquement une image JPEG, PNG ou WebP.');
      }
      if (params.file.size <= 0 || params.file.size > 5 * 1024 * 1024) {
        throw new Error('La photo de preuve doit faire au maximum 5 Mo.');
      }

      if (mode === 'demo') {
        params.onStageChange?.('preparing');
        params.onStageChange?.('uploading');
        params.onStageChange?.('confirming');
        return {
          proofId: `demo_proof_${Date.now()}`,
          storagePath: `demo/${params.deliveryId}/${params.file.name}`,
          uploadVerified: true,
        };
      }

      if (mode !== 'firebase' || !firebaseUser || profile?.accountStatus !== 'active') {
        throw new Error('Authentification livreur actif requise pour transmettre la photo.');
      }
      if (!backendConnected) {
        throw new Error(
          'Backend Supabase non configuré : impossible de téléverser la photo de preuve.'
        );
      }

      const idToken = await firebaseUser.getIdToken();
      const mimeType = params.file.type as 'image/jpeg' | 'image/png' | 'image/webp';

      // Étape 1 : Demander une URL signée courte durée (aucune ligne en base tant que non uploadé)
      params.onStageChange?.('preparing');
      const prepared = await expressApi.prepareDeliveryProofUpload(idToken, {
        deliveryId: params.deliveryId,
        recipientName: params.recipientName,
        proofCode: params.proofCode,
        proofNote: params.proofNote,
        codCollectedConfirmed: params.codCollectedConfirmed,
        mimeType,
        fileSizeBytes: params.file.size,
      });

      // Étape 2 : Envoi binaire direct vers Supabase Private Storage via l'URL signée
      params.onStageChange?.('uploading');
      await expressApi.uploadPhotoToSignedUrl(prepared.signedUploadUrl, params.file, mimeType);

      // Étape 3 : Confirmation serveur (HEAD Storage + INSERT immuable vérifié)
      params.onStageChange?.('confirming');
      const confirmed = await expressApi.confirmDeliveryProof(idToken, {
        deliveryId: params.deliveryId,
        proofId: prepared.proofId,
        storagePath: prepared.storagePath,
        recipientName: params.recipientName,
        proofCode: params.proofCode,
        proofNote: params.proofNote,
        codCollectedConfirmed: params.codCollectedConfirmed,
        mimeType,
        fileSizeBytes: params.file.size,
        gpsLat: gpsTracker.lastFix?.lat,
        gpsLng: gpsTracker.lastFix?.lng,
      });

      return {
        proofId: confirmed.proofId,
        storagePath: confirmed.storagePath ?? prepared.storagePath,
        uploadVerified: confirmed.uploadVerified,
      };
    },
    [mode, firebaseUser, profile?.accountStatus, backendConnected, gpsTracker.lastFix]
  );

  const logout = useCallback(async () => {
    gpsTracker.stopTracking();
    clearAllReadOnlySnapshots();
    if (firebaseUser) {
      await signOut(auth);
    }
    setMode('unauthenticated');
    setIsAdminUser(false);
    setProfile(null);
    setProfileNotFound(false);
    setMissions([]);
    setNotifications([]);
    showToast('Session clôturée en toute sécurité.', 'green');
  }, [firebaseUser, gpsTracker, showToast]);

  const updateProfile = useCallback(
    async (updates: ProfileUpdateInput) => {
      if (!profile) return;

      const clean: ProfileUpdateInput = {};
      if (typeof updates.firstName === 'string' && updates.firstName.trim()) {
        clean.firstName = updates.firstName.trim().slice(0, 60);
      }
      if (typeof updates.lastName === 'string' && updates.lastName.trim()) {
        clean.lastName = updates.lastName.trim().slice(0, 60);
      }
      if (typeof updates.phone === 'string' && updates.phone.trim().length >= 7) {
        clean.phone = updates.phone.trim().slice(0, 24);
      }
      if (updates.vehicleType) clean.vehicleType = updates.vehicleType;
      if (typeof updates.vehiclePlate === 'string') {
        clean.vehiclePlate = updates.vehiclePlate.trim().slice(0, 24);
      }
      if (typeof updates.workZone === 'string' && updates.workZone.trim().length >= 2) {
        clean.workZone = updates.workZone.trim().slice(0, 80);
      }
      if (typeof updates.isAvailable === 'boolean') clean.isAvailable = updates.isAvailable;
      if (typeof updates.notificationsEnabled === 'boolean') {
        clean.notificationsEnabled = updates.notificationsEnabled;
      }
      if (typeof updates.pushSoundEnabled === 'boolean') {
        clean.pushSoundEnabled = updates.pushSoundEnabled;
      }

      if (mode === 'demo') {
        setProfile((prev) =>
          prev ? { ...prev, ...clean, updatedAtIso: new Date().toISOString() } : null
        );
        showToast('Profil mis à jour (mode démonstration local).', 'green');
        return;
      }

      if (mode !== 'firebase' || !firebaseUser || profile.accountStatus !== 'active') {
        showToast('Modification refusée : compte livreur non actif.', 'red');
        return;
      }

      if (backendConnected) {
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await expressApi.updateDriverProfile(idToken, clean);
          setProfile(mapEdgeDriverToProfile(res.profile));
          showToast('Paramètres enregistrés dans JikJikoox.', 'green');
        } catch (err) {
          showToast(
            err instanceof ExpressApiError ? err.message : 'Erreur lors de la sauvegarde.',
            'red'
          );
        }
        return;
      }

      const path = `couriers/${firebaseUser.uid}`;
      try {
        await updateDoc(doc(db, 'couriers', firebaseUser.uid), {
          ...clean,
          updatedAt: serverTimestamp(),
        });
        showToast('Paramètres enregistrés.', 'green');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    },
    [mode, profile, firebaseUser, backendConnected, showToast]
  );

  const toggleAvailability = useCallback(async () => {
    if (!profile) return;
    if (mode === 'firebase' && profile.accountStatus !== 'active') {
      showToast('Votre compte doit être validé par JikJikoox Admin.', 'red');
      return;
    }
    const next = !profile.isAvailable;
    await updateProfile({ isAvailable: next });
    showToast(
      next ? 'Statut : Disponible pour de nouvelles missions.' : 'Statut : Indisponible (pause).',
      next ? 'green' : 'yellow'
    );
  }, [mode, profile, updateProfile, showToast]);

  const inFlightTransitionsRef = useRef<Set<string>>(new Set());

  const transitionMission = useCallback(
    async (
      missionId: string,
      nextStatus: MissionStatus,
      options?: { proof?: ProofSubmission; failureReason?: string }
    ): Promise<boolean> => {
      if (inFlightTransitionsRef.current.has(missionId)) {
        return false;
      }
      const target = missions.find((m) => m.missionId === missionId);
      if (!target) return false;

      if (!isTransitionAllowed(target.status, nextStatus)) {
        showToast('Transition de statut non autorisée par le protocole.', 'red');
        return false;
      }

      if (nextStatus === 'DELIVERED') {
        const rec = options?.proof?.recipientName?.trim() ?? '';
        if (rec.length < 2) {
          showToast('Le nom du réceptionnaire est obligatoire pour confirmer la livraison.', 'red');
          return false;
        }
        if (
          target.paymentMode === 'cod' &&
          target.codAmount > 0 &&
          !options?.proof?.codCollectedConfirmed
        ) {
          showToast('Veuillez confirmer l’encaissement COD avant de clôturer.', 'red');
          return false;
        }
      }

      if (nextStatus === 'FAILED') {
        const reason = options?.failureReason?.trim() ?? '';
        if (reason.length < 3) {
          showToast('Un motif d’échec détaillé est obligatoire.', 'red');
          return false;
        }
      }

      const nowIso = new Date().toISOString();
      const statusLabel = MISSION_STATUS_META[nextStatus].label;

      let eventLabel = `Statut passé à : ${statusLabel}`;
      if (nextStatus === 'DELIVERED' && options?.proof) {
        eventLabel = `Livraison confirmée — remis à ${options.proof.recipientName.trim()}`;
      } else if (nextStatus === 'FAILED' && options?.failureReason) {
        eventLabel = `Échec signalé : ${options.failureReason.trim()}`;
      }

      // 1. Mode démonstration local : strictement en mémoire, aucun appel réseau
      if (mode === 'demo') {
        const newEvent: MissionEvent = {
          status: nextStatus,
          label: eventLabel.slice(0, 200),
          timestampIso: nowIso,
          actor: 'courier',
          ...(options?.proof?.proofNote?.trim()
            ? { note: options.proof.proofNote.trim().slice(0, 300) }
            : {}),
        };
        setMissions((prev) =>
          prev.map((m) =>
            m.missionId === missionId
              ? {
                  ...m,
                  status: nextStatus,
                  events: [...m.events, newEvent].slice(-20),
                  recipientName: options?.proof?.recipientName?.trim() || m.recipientName,
                  proofCode: options?.proof?.proofCode?.trim() || m.proofCode,
                  proofNote: options?.proof?.proofNote?.trim() || m.proofNote,
                  failureReason: options?.failureReason?.trim() || m.failureReason,
                  updatedAtIso: nowIso,
                }
              : m
          )
        );
        if (nextStatus === 'DELIVERED') {
          setNotifications((prev) => [
            {
              notificationId: `ntf_demo_${Date.now()}`,
              courierId: target.courierId,
              dataSource: 'local_demo',
              category: 'confirmation',
              title: `Livraison confirmée — ${target.orderNumber}`,
              body: `Preuve enregistrée localement (mode démo) pour ${target.deliveryZone}.`,
              missionId,
              isRead: false,
              createdAtIso: nowIso,
            },
            ...prev,
          ]);
        }
        showToast(`${target.orderNumber} : ${statusLabel}.`, nextStatus === 'FAILED' ? 'red' : 'green');
        return true;
      }

      // 2. Mode réel : TOUTES les transitions passent obligatoirement par l'Edge Function Supabase
      if (mode !== 'firebase' || !firebaseUser || profile?.accountStatus !== 'active') {
        showToast('Action refusée : autorisation livreur actif requise.', 'red');
        return false;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast(
          nextStatus === 'DELIVERED'
            ? 'Mode hors connexion : impossible de confirmer une livraison sans connexion Internet vérifiée.'
            : 'Mode hors connexion : reconnectez-vous pour synchroniser le statut de la mission.',
          'red'
        );
        return false;
      }

      if (!backendConnected) {
        showToast(
          'Les transitions réelles nécessitent la connexion aux Edge Functions Supabase (configurez VITE_SUPABASE_FUNCTIONS_URL).',
          'yellow'
        );
        return false;
      }

      inFlightTransitionsRef.current.add(missionId);
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await expressApi.submitDeliveryAction(idToken, {
          deliveryId: missionId,
          nextStatus,
          label: eventLabel,
          proof: options?.proof,
          failureReason: options?.failureReason,
        });

        await refreshBackendData();
        showToast(
          res.idempotentReplay
            ? `${target.orderNumber} : action déjà enregistrée.`
            : `${target.orderNumber} : ${statusLabel}.`,
          nextStatus === 'FAILED' ? 'red' : 'green'
        );
        return true;
      } catch (err) {
        showToast(
          err instanceof ExpressApiError
            ? err.message
            : 'Erreur lors de la validation serveur de la mission.',
          'red'
        );
        return false;
      } finally {
        inFlightTransitionsRef.current.delete(missionId);
      }
    },
    [missions, mode, firebaseUser, profile, backendConnected, refreshBackendData, showToast]
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      const target = notifications.find((n) => n.notificationId === notificationId);
      if (!target || target.isRead) return;

      if (mode === 'demo') {
        const nowIso = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) =>
            n.notificationId === notificationId ? { ...n, isRead: true, readAtIso: nowIso } : n
          )
        );
        return;
      }

      if (mode !== 'firebase' || !firebaseUser || profile?.accountStatus !== 'active') return;

      if (backendConnected) {
        try {
          const idToken = await firebaseUser.getIdToken();
          await expressApi.markNotificationRead(idToken, notificationId);
          setNotifications((prev) =>
            prev.map((n) =>
              n.notificationId === notificationId
                ? { ...n, isRead: true, readAtIso: new Date().toISOString() }
                : n
            )
          );
        } catch {
          // silencieux pour ne pas interrompre la navigation vers la mission
        }
        return;
      }

      const path = `notifications/${notificationId}`;
      try {
        await updateDoc(doc(db, 'notifications', notificationId), {
          isRead: true,
          readAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    },
    [notifications, mode, firebaseUser, profile, backendConnected]
  );

  const markAllNotificationsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.isRead);
    if (unread.length === 0) return;

    if (mode === 'demo') {
      const nowIso = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAtIso: nowIso }))
      );
      showToast('Toutes les notifications sont marquées comme lues.', 'green');
      return;
    }

    if (mode !== 'firebase' || !firebaseUser || profile?.accountStatus !== 'active') return;

    if (backendConnected) {
      try {
        const idToken = await firebaseUser.getIdToken();
        await expressApi.markAllNotificationsRead(idToken);
        const nowIso = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAtIso: nowIso }))
        );
        showToast('Toutes les notifications sont marquées comme lues.', 'green');
      } catch (err) {
        showToast(
          err instanceof ExpressApiError ? err.message : 'Erreur lors de la mise à jour.',
          'red'
        );
      }
      return;
    }

    const batch = writeBatch(db);
    unread.forEach((n) => {
      batch.update(doc(db, 'notifications', n.notificationId), {
        isRead: true,
        readAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
      showToast('Toutes les notifications sont marquées comme lues.', 'green');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notifications/batch-read');
    }
  }, [notifications, mode, firebaseUser, profile, backendConnected, showToast]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const pushState = useMemo<PushNotificationState>(
    () => ({
      supportState: pushSupportState,
      busy: pushBusy,
      tokenRegistered: profile?.fcmTokenStatus === 'registered',
      statusMessage: pushStatusMessage,
    }),
    [pushSupportState, pushBusy, profile?.fcmTokenStatus, pushStatusMessage]
  );

  const value = useMemo<CourierAppContextValue>(
    () => ({
      mode,
      backendConnected,
      isOnline,
      authReady,
      loadingData,
      firebaseUser,
      isAdminUser,
      profile,
      profileNotFound,
      missions,
      notifications,
      unreadCount,
      authError,
      toast,
      gpsTracker,
      pushState,
      dismissToast,
      showToast,
      signInWithGoogle,
      completeCourierRegistration,
      enterDemoMode,
      exitDemoMode,
      logout,
      refreshBackendData,
      toggleAvailability,
      updateProfile,
      enablePushNotifications,
      disablePushNotifications,
      uploadDeliveryProofPhoto,
      transitionMission,
      markNotificationRead,
      markAllNotificationsRead,
    }),
    [
      mode,
      backendConnected,
      isOnline,
      authReady,
      loadingData,
      firebaseUser,
      isAdminUser,
      profile,
      profileNotFound,
      missions,
      notifications,
      unreadCount,
      authError,
      toast,
      gpsTracker,
      pushState,
      dismissToast,
      showToast,
      signInWithGoogle,
      completeCourierRegistration,
      enterDemoMode,
      exitDemoMode,
      logout,
      refreshBackendData,
      toggleAvailability,
      updateProfile,
      enablePushNotifications,
      disablePushNotifications,
      uploadDeliveryProofPhoto,
      transitionMission,
      markNotificationRead,
      markAllNotificationsRead,
    ]
  );

  return <CourierAppContext.Provider value={value}>{children}</CourierAppContext.Provider>;
}

export function useCourierApp(): CourierAppContextValue {
  const ctx = useContext(CourierAppContext);
  if (!ctx) {
    throw new Error('useCourierApp doit être utilisé dans CourierAppProvider.');
  }
  return ctx;
}
