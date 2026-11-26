import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  buildGpsIdempotencyKey,
  GpsOfflineQueue,
  isMissionTrackableStatus,
  shouldTransmitGpsFix,
} from '../lib/gpsTracker';
import { expressApi, ExpressApiError } from '../services/expressApi';
import type {
  DeliveryMission,
  GpsPermissionState,
  GpsPositionSnapshot,
} from '../types/delivery';

export interface CourierGpsTrackerState {
  permissionState: GpsPermissionState;
  isTracking: boolean;
  activeTrackedMission: DeliveryMission | null;
  lastFix: GpsPositionSnapshot | null;
  queuedCount: number;
  lastSyncIso: string | null;
  lastError: string | null;
  requestGpsPermission: () => void;
  stopTracking: () => void;
}

interface UseCourierGpsTrackerParams {
  enabled: boolean;
  mode: 'unauthenticated' | 'firebase' | 'demo';
  backendConnected: boolean;
  firebaseUser: User | null;
  missions: DeliveryMission[];
  onNotify?: (text: string, tone?: 'green' | 'yellow' | 'red') => void;
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 5_000,
};

/**
 * Suivi GPS temps réel basé sur `navigator.geolocation.watchPosition()`.
 * - Ne démarre JAMAIS sans consentement explicite et uniquement pendant une mission active.
 * - S'arrête immédiatement dès la clôture/annulation de la mission ou la déconnexion.
 * - Applique un throttling batterie/data et une file hors ligne avec retry idempotent.
 */
export function useCourierGpsTracker({
  enabled,
  mode,
  backendConnected,
  firebaseUser,
  missions,
  onNotify,
}: UseCourierGpsTrackerParams): CourierGpsTrackerState {
  const isSupported =
    typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const [permissionState, setPermissionState] = useState<GpsPermissionState>(() =>
    isSupported ? 'prompt' : 'unsupported'
  );
  const [userActivated, setUserActivated] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [lastFix, setLastFix] = useState<GpsPositionSnapshot | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<GpsPositionSnapshot | null>(null);
  const offlineQueueRef = useRef<GpsOfflineQueue>(new GpsOfflineQueue(20));
  const flushingRef = useRef(false);

  // Sélectionne la mission active prioritaire (en cours de trajet ou arrivée en premier)
  const activeTrackedMission = useMemo(() => {
    if (!enabled) return null;
    const trackable = missions.filter((m) => isMissionTrackableStatus(m.status));
    if (trackable.length === 0) return null;
    const priorityOrder: Record<string, number> = {
      ARRIVED: 0,
      IN_TRANSIT: 1,
      PICKED_UP: 2,
      PREPARING: 3,
      ACCEPTED: 4,
    };
    return [...trackable].sort(
      (a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9)
    )[0];
  }, [enabled, missions]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && isSupported) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setUserActivated(false);
  }, [isSupported]);

  // Lecture passive de l'état de permission navigateur (ne déclenche aucune pop-up)
  useEffect(() => {
    if (!isSupported || !navigator.permissions?.query) return;
    let mounted = true;
    let statusObj: PermissionStatus | null = null;

    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!mounted) return;
        statusObj = status;
        const syncPerm = () => {
          if (!mounted) return;
          if (status.state === 'granted') setPermissionState('granted');
          else if (status.state === 'denied') setPermissionState('denied');
          else setPermissionState('prompt');
        };
        syncPerm();
        status.onchange = syncPerm;
      })
      .catch(() => {
        // Safari/certains navigateurs mobiles ne supportent pas permissions.query('geolocation')
      });

    return () => {
      mounted = false;
      if (statusObj) statusObj.onchange = null;
    };
  }, [isSupported]);

  const flushOfflineQueue = useCallback(async () => {
    if (flushingRef.current) return;
    if (mode !== 'firebase' || !backendConnected || !firebaseUser) return;
    if (offlineQueueRef.current.size() === 0) return;

    flushingRef.current = true;
    try {
      const idToken = await firebaseUser.getIdToken();
      const result = await offlineQueueRef.current.flush(async (point) => {
        await expressApi.sendDriverLocation(idToken, point);
      });
      setQueuedCount(result.remaining);
      if (result.sent > 0) {
        setLastSyncIso(new Date().toISOString());
        setLastError(null);
      }
    } catch {
      // Garde les points en file d'attente pour le prochain retour réseau
    } finally {
      flushingRef.current = false;
    }
  }, [mode, backendConnected, firebaseUser]);

  // Reprise automatique des envois en attente dès le retour de la connexion mobile
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      void flushOfflineQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushOfflineQueue]);

  // Arrêt immédiat si déconnexion ou plus aucune mission active
  useEffect(() => {
    if (!enabled || !activeTrackedMission) {
      if (watchIdRef.current !== null && isSupported) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsTracking(false);
      lastSentRef.current = null;
      if (!enabled) {
        offlineQueueRef.current.clear();
        setQueuedCount(0);
        setLastFix(null);
        setLastError(null);
        setUserActivated(false);
      }
    }
  }, [enabled, activeTrackedMission, isSupported]);

  // Boucle `watchPosition()` active uniquement si mission active + consentement accordé
  const shouldWatch =
    isSupported &&
    enabled &&
    Boolean(activeTrackedMission) &&
    (permissionState === 'granted' || userActivated);

  useEffect(() => {
    if (!shouldWatch || !activeTrackedMission) {
      if (watchIdRef.current !== null && isSupported) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsTracking(false);
      return;
    }

    const missionId = activeTrackedMission.missionId;
    setIsTracking(true);
    setLastError(null);

    const handlePosition = (pos: GeolocationPosition) => {
      setPermissionState('granted');
      const recordedAtIso = new Date(pos.timestamp || Date.now()).toISOString();
      const fix: GpsPositionSnapshot = {
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        accuracyMeters:
          typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
            ? Math.round(pos.coords.accuracy)
            : null,
        speedMps:
          typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0
            ? Number(pos.coords.speed.toFixed(2))
            : null,
        headingDeg:
          typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading) && pos.coords.heading >= 0
            ? Number(pos.coords.heading.toFixed(1))
            : null,
        recordedAtIso,
      };

      setLastFix(fix);
      setLastError(null);

      const decision = shouldTransmitGpsFix(lastSentRef.current, fix);
      if (!decision.send) return;

      lastSentRef.current = fix;

      // Mode démo ou backend non configuré : suivi local uniquement sans appel réseau
      if (mode !== 'firebase' || !backendConnected || !firebaseUser) {
        setLastSyncIso(recordedAtIso);
        return;
      }

      const payload = {
        deliveryId: missionId,
        lat: fix.lat,
        lng: fix.lng,
        accuracyMeters: fix.accuracyMeters,
        speedMps: fix.speedMps,
        headingDeg: fix.headingDeg,
        recordedAtIso,
        idempotencyKey: buildGpsIdempotencyKey(missionId, recordedAtIso),
      };

      void (async () => {
        try {
          const idToken = await firebaseUser.getIdToken();
          await expressApi.sendDriverLocation(idToken, payload);
          setLastSyncIso(new Date().toISOString());
          if (offlineQueueRef.current.size() > 0) {
            await flushOfflineQueue();
          }
        } catch (err) {
          if (
            err instanceof ExpressApiError &&
            (err.code === 'MISSION_NOT_ACTIVE_FOR_GPS' ||
              err.code === 'MISSION_FORBIDDEN' ||
              err.code === 'DRIVER_SUSPENDED' ||
              err.code === 'DRIVER_DISABLED')
          ) {
            stopTracking();
            setLastError(err.message);
            return;
          }
          // Erreur réseau / hors ligne : mise en file d'attente bornée pour rejeu automatique
          offlineQueueRef.current.enqueue(payload);
          setQueuedCount(offlineQueueRef.current.size());
          setLastError('Réseau instable : position mise en attente de synchronisation.');
        }
      })();
    };

    const handleGeoError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setPermissionState('denied');
        setUserActivated(false);
        setIsTracking(false);
        setLastError(
          'Autorisation GPS refusée. Activez la localisation dans les paramètres de votre navigateur pour le suivi de mission.'
        );
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        setLastError('Signal GPS momentanément indisponible. Nouvelle tentative en cours...');
      } else if (err.code === err.TIMEOUT) {
        setLastError('Acquisition GPS lente. Maintenez l’appareil dégagé si possible.');
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleGeoError,
      WATCH_OPTIONS
    );
    watchIdRef.current = watchId;

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (watchIdRef.current === watchId) {
        watchIdRef.current = null;
      }
      setIsTracking(false);
    };
  }, [
    shouldWatch,
    activeTrackedMission,
    isSupported,
    mode,
    backendConnected,
    firebaseUser,
    flushOfflineQueue,
    stopTracking,
  ]);

  const requestGpsPermission = useCallback(() => {
    if (!isSupported) {
      setPermissionState('unsupported');
      setLastError('La géolocalisation n’est pas disponible sur ce navigateur.');
      onNotify?.('Géolocalisation non disponible sur cet appareil.', 'yellow');
      return;
    }
    if (!activeTrackedMission) {
      onNotify?.(
        'Le suivi GPS s’active uniquement lorsque vous avez une mission en cours.',
        'yellow'
      );
      return;
    }

    setLastError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPermissionState('granted');
        setUserActivated(true);
        setLastFix({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracyMeters:
            typeof pos.coords.accuracy === 'number' ? Math.round(pos.coords.accuracy) : null,
          speedMps:
            typeof pos.coords.speed === 'number' && pos.coords.speed >= 0
              ? Number(pos.coords.speed.toFixed(2))
              : null,
          headingDeg:
            typeof pos.coords.heading === 'number' && pos.coords.heading >= 0
              ? Number(pos.coords.heading.toFixed(1))
              : null,
          recordedAtIso: new Date(pos.timestamp || Date.now()).toISOString(),
        });
        onNotify?.('Suivi GPS activé pour votre mission en cours.', 'green');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionState('denied');
          setLastError('Autorisation GPS refusée par le navigateur.');
          onNotify?.(
            'Autorisation GPS refusée. Activez la localisation dans les réglages du navigateur.',
            'red'
          );
        } else {
          setUserActivated(true);
          setLastError('Signal GPS en cours d’acquisition...');
        }
      },
      WATCH_OPTIONS
    );
  }, [isSupported, activeTrackedMission, onNotify]);

  return {
    permissionState,
    isTracking,
    activeTrackedMission,
    lastFix,
    queuedCount,
    lastSyncIso,
    lastError,
    requestGpsPermission,
    stopTracking,
  };
}
