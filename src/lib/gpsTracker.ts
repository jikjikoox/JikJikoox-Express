import type { GpsPositionSnapshot, MissionStatus } from '../types/delivery';
import type { DriverLocationRequest } from './supabaseContract';

/**
 * Moteur pur de filtrage, limitation de fréquence (batterie/data mobile)
 * et file d'attente hors ligne pour le suivi GPS des livreurs JikJikoox Express.
 */

export const TRACKABLE_MISSION_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'ACCEPTED',
  'PREPARING',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED',
]);

export interface GpsThrottleConfig {
  /** Délai minimal entre 2 envois même en cas de déplacement rapide (ms) */
  minIntervalMs: number;
  /** Délai maximal avant d'envoyer un heartbeat même à l'arrêt (ms) */
  maxIntervalMs: number;
  /** Distance minimale parcourue pour déclencher un nouvel envoi avant maxIntervalMs (m) */
  minDistanceMeters: number;
  /** Précision maximale tolérée (m) — rejette les sauts Wi-Fi/antenne aberrants */
  maxAccuracyMeters: number;
}

export const DEFAULT_GPS_THROTTLE: GpsThrottleConfig = {
  minIntervalMs: 5_000,
  maxIntervalMs: 12_000,
  minDistanceMeters: 25,
  maxAccuracyMeters: 500,
};

export function isMissionTrackableStatus(status: MissionStatus): boolean {
  return TRACKABLE_MISSION_STATUSES.has(status);
}

/**
 * Distance géodésique Haversine en mètres entre deux coordonnées WGS84.
 */
export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Détermine si un point GPS doit être transmis au serveur afin d'économiser
 * la batterie et le forfait mobile tout en assurant un suivi fluide.
 */
export function shouldTransmitGpsFix(
  lastSent: GpsPositionSnapshot | null,
  nextFix: GpsPositionSnapshot,
  config: GpsThrottleConfig = DEFAULT_GPS_THROTTLE
): { send: boolean; reason: string } {
  if (
    !Number.isFinite(nextFix.lat) ||
    !Number.isFinite(nextFix.lng) ||
    nextFix.lat < -90 ||
    nextFix.lat > 90 ||
    nextFix.lng < -180 ||
    nextFix.lng > 180
  ) {
    return { send: false, reason: 'invalid_coordinates' };
  }

  if (
    typeof nextFix.accuracyMeters === 'number' &&
    nextFix.accuracyMeters > config.maxAccuracyMeters
  ) {
    return { send: false, reason: 'low_accuracy_ignored' };
  }

  if (!lastSent) {
    return { send: true, reason: 'initial_fix' };
  }

  const lastMs = Date.parse(lastSent.recordedAtIso);
  const nextMs = Date.parse(nextFix.recordedAtIso);
  const elapsedMs = Number.isNaN(lastMs) || Number.isNaN(nextMs) ? config.maxIntervalMs : nextMs - lastMs;

  if (elapsedMs < config.minIntervalMs) {
    return { send: false, reason: 'min_interval_throttle' };
  }

  if (elapsedMs >= config.maxIntervalMs) {
    return { send: true, reason: 'heartbeat_interval' };
  }

  const distanceMeters = haversineDistanceMeters(lastSent, nextFix);
  if (distanceMeters >= config.minDistanceMeters) {
    return { send: true, reason: 'distance_threshold' };
  }

  return { send: false, reason: 'stationary_throttle' };
}

export function buildGpsIdempotencyKey(deliveryId: string, recordedAtIso: string): string {
  const safeDelivery = deliveryId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28);
  const ts = Date.parse(recordedAtIso);
  const bucket = Number.isNaN(ts) ? Date.now() : Math.floor(ts / 1000);
  return `gps_${safeDelivery}_${bucket}`;
}

/**
 * File d'attente bornée pour conserver les derniers points GPS en cas de coupure 3G/4G
 * et les rejouer dans l'ordre dès le retour du réseau (avec idempotence garantie).
 */
export class GpsOfflineQueue {
  private readonly maxItems: number;
  private items: DriverLocationRequest[] = [];

  constructor(maxItems = 20) {
    this.maxItems = Math.max(1, maxItems);
  }

  enqueue(point: DriverLocationRequest): void {
    const key =
      point.idempotencyKey || buildGpsIdempotencyKey(point.deliveryId, point.recordedAtIso);
    const normalized: DriverLocationRequest = { ...point, idempotencyKey: key };

    if (this.items.some((existing) => existing.idempotencyKey === key)) {
      return;
    }
    this.items.push(normalized);
    if (this.items.length > this.maxItems) {
      // Conserve les points les plus récents pour ne pas saturer la mémoire mobile
      this.items = this.items.slice(this.items.length - this.maxItems);
    }
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  peekAll(): DriverLocationRequest[] {
    return [...this.items];
  }

  async flush(
    sender: (point: DriverLocationRequest) => Promise<void>
  ): Promise<{ sent: number; remaining: number }> {
    let sent = 0;
    while (this.items.length > 0) {
      const next = this.items[0];
      try {
        await sender(next);
        this.items.shift();
        sent++;
      } catch {
        break;
      }
    }
    return { sent, remaining: this.items.length };
  }
}
