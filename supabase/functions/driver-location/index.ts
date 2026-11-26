/**
 * Supabase Edge Function : driver-location
 * - POST : Reçoit et valide la position GPS en temps réel d'un livreur actif en mission.
 *          Vérifie le jeton Firebase ID (RS256), le statut actif du livreur, la propriété
 *          de la mission active, la validité des coordonnées, l'idempotence et enregistre
 *          l'historique dans `express_driver_locations` + la dernière position dans
 *          `express_driver_last_locations`.
 */

import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import {
  extractBearerToken,
  FirebaseAuthError,
  verifyFirebaseIdToken,
} from '../_shared/firebaseAuth.ts';
import {
  assertAuthorizedActiveDriver,
  DriverAuthorizationError,
  fetchDriverByFirebaseUid,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';

export const ACTIVE_TRACKABLE_STATUSES = new Set([
  'ACCEPTED',
  'PREPARING',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED',
]);

export const MIN_SERVER_LOCATION_INTERVAL_MS = 3_000;

const FORBIDDEN_LOCATION_FIELDS = [
  'driverId',
  'driver_id',
  'driverFirebaseUid',
  'driver_firebase_uid',
  'firebase_uid',
  'role',
  'accountStatus',
] as const;

export interface ValidatedGpsPayload {
  deliveryId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  heading: number | null;
  recordedAtIso: string;
  idempotencyKey: string | null;
}

export function validateGpsPayload(
  raw: Record<string, unknown> | null,
  headerIdempotencyKey?: string | null
): { ok: true; data: ValidatedGpsPayload } | { ok: false; code: string; message: string; httpStatus: number } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'INVALID_BODY', message: 'Corps JSON invalide.', httpStatus: 400 };
  }

  const forbidden = FORBIDDEN_LOCATION_FIELDS.filter((field) => field in raw);
  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'FORBIDDEN_FIELDS',
      message: `Champs d’identité interdits dans le payload GPS (${forbidden.join(', ')}).`,
      httpStatus: 403,
    };
  }

  const deliveryId = typeof raw.deliveryId === 'string' ? raw.deliveryId.trim() : '';
  if (!deliveryId) {
    return {
      ok: false,
      code: 'MISSION_ID_REQUIRED',
      message: 'Identifiant de mission active requis pour la transmission GPS.',
      httpStatus: 400,
    };
  }

  const lat = raw.latitude ?? raw.lat;
  const lng = raw.longitude ?? raw.lng;
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return {
      ok: false,
      code: 'INVALID_COORDINATES',
      message: 'Coordonnées GPS invalides (latitude -90..90, longitude -180..180).',
      httpStatus: 400,
    };
  }

  let accuracyMeters: number | null = null;
  if (raw.accuracyMeters !== undefined && raw.accuracyMeters !== null) {
    if (
      typeof raw.accuracyMeters !== 'number' ||
      !Number.isFinite(raw.accuracyMeters) ||
      raw.accuracyMeters < 0 ||
      raw.accuracyMeters > 10_000
    ) {
      return {
        ok: false,
        code: 'INVALID_ACCURACY',
        message: 'Précision GPS hors limites autorisées (0..10000m).',
        httpStatus: 400,
      };
    }
    accuracyMeters = Math.round(raw.accuracyMeters * 10) / 10;
  }

  let speedMps: number | null = null;
  if (raw.speedMps !== undefined && raw.speedMps !== null) {
    if (
      typeof raw.speedMps !== 'number' ||
      !Number.isFinite(raw.speedMps) ||
      raw.speedMps < 0 ||
      raw.speedMps > 120
    ) {
      return {
        ok: false,
        code: 'INVALID_SPEED',
        message: 'Vitesse GPS invalide (0..120 m/s).',
        httpStatus: 400,
      };
    }
    speedMps = Math.round(raw.speedMps * 100) / 100;
  }

  let heading: number | null = null;
  const rawHeading = raw.heading ?? raw.headingDeg;
  if (rawHeading !== undefined && rawHeading !== null) {
    if (
      typeof rawHeading !== 'number' ||
      !Number.isFinite(rawHeading) ||
      rawHeading < 0 ||
      rawHeading > 360
    ) {
      return {
        ok: false,
        code: 'INVALID_HEADING',
        message: 'Cap GPS invalide (0..360°).',
        httpStatus: 400,
      };
    }
    heading = Math.round(rawHeading * 10) / 10;
  }

  const rawRecordedAt =
    typeof raw.recordedAt === 'string'
      ? raw.recordedAt.trim()
      : typeof raw.recordedAtIso === 'string'
        ? raw.recordedAtIso.trim()
        : '';
  const parsedTime = rawRecordedAt ? Date.parse(rawRecordedAt) : Date.now();
  if (Number.isNaN(parsedTime)) {
    return {
      ok: false,
      code: 'INVALID_TIMESTAMP',
      message: 'Horodatage GPS invalide.',
      httpStatus: 400,
    };
  }
  const nowMs = Date.now();
  // Rejette les dates trop éloignées dans le futur (> 5 min) ou trop anciennes (> 24h)
  if (parsedTime > nowMs + 5 * 60_000 || parsedTime < nowMs - 24 * 3_600_000) {
    return {
      ok: false,
      code: 'TIMESTAMP_OUT_OF_RANGE',
      message: 'Horodatage GPS hors fenêtre temporelle autorisée.',
      httpStatus: 400,
    };
  }

  const rawKey = (headerIdempotencyKey || (typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : ''))
    .trim()
    .slice(0, 128);

  return {
    ok: true,
    data: {
      deliveryId,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      accuracyMeters,
      speedMps,
      heading,
      recordedAtIso: new Date(parsedTime).toISOString(),
      idempotencyKey: rawKey || null,
    },
  };
}

export async function handleDriverLocationRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, { projectId: env.firebaseProjectId });
    const driver = assertAuthorizedActiveDriver(
      await fetchDriverByFirebaseUid(env, verified.uid)
    );

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const checked = validateGpsPayload(raw, req.headers.get('x-idempotency-key'));
    if (!checked.ok) {
      return errorResponse(checked.code, checked.message, checked.httpStatus, cors);
    }

    const payload = checked.data;

    // 1. Vérifier que la mission appartient au livreur ET est en cours
    const found = await supabaseRest<
      Array<{ id: string; driver_id: string; driver_firebase_uid: string; status: string }>
    >(
      env,
      `/rest/v1/express_deliveries?id=eq.${encodeURIComponent(payload.deliveryId)}&limit=1`
    );

    const delivery = found.data?.[0];
    if (!delivery) {
      return errorResponse('MISSION_NOT_FOUND', 'Mission introuvable.', 404, cors);
    }
    if (delivery.driver_id !== driver.id || delivery.driver_firebase_uid !== verified.uid) {
      return errorResponse(
        'MISSION_FORBIDDEN',
        'Transmission GPS refusée : cette mission ne vous est pas attribuée.',
        403,
        cors
      );
    }
    if (!ACTIVE_TRACKABLE_STATUSES.has(delivery.status)) {
      return errorResponse(
        'MISSION_NOT_TRACKABLE',
        'Le suivi GPS n’est autorisé que pendant une mission active.',
        409,
        cors
      );
    }

    // 2. Idempotence (protège contre les doubles transmissions en reprise réseau)
    if (payload.idempotencyKey) {
      const existing = await supabaseRest<Array<{ id: string }>>(
        env,
        `/rest/v1/express_driver_locations?idempotency_key=eq.${encodeURIComponent(
          payload.idempotencyKey
        )}&driver_id=eq.${encodeURIComponent(driver.id)}&limit=1`
      );
      if (existing.data?.[0]) {
        return jsonResponse(
          {
            ok: true,
            idempotentReplay: true,
            locationId: existing.data[0].id,
            recordedAt: payload.recordedAtIso,
          },
          200,
          cors
        );
      }
    }

    // 3. Protection anti-rafale serveur (cadence minimale 3s sur dernier point)
    const lastRes = await supabaseRest<Array<{ recorded_at: string }>>(
      env,
      `/rest/v1/express_driver_last_locations?driver_id=eq.${encodeURIComponent(driver.id)}&limit=1`
    );
    const lastRecorded = lastRes.data?.[0]?.recorded_at;
    if (lastRecorded) {
      const diffMs = Math.abs(Date.parse(payload.recordedAtIso) - Date.parse(lastRecorded));
      if (Number.isFinite(diffMs) && diffMs < MIN_SERVER_LOCATION_INTERVAL_MS) {
        return jsonResponse(
          {
            ok: true,
            throttled: true,
            recordedAt: lastRecorded,
          },
          200,
          cors
        );
      }
    }

    // 4. Insertion immuable dans l'historique GPS
    const inserted = await supabaseRest<Array<{ id: string; recorded_at: string }>>(
      env,
      '/rest/v1/express_driver_locations',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          driver_id: driver.id,
          driver_firebase_uid: verified.uid,
          delivery_id: delivery.id,
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy_meters: payload.accuracyMeters,
          speed_mps: payload.speedMps,
          heading: payload.heading,
          recorded_at: payload.recordedAtIso,
          idempotency_key: payload.idempotencyKey,
        }),
      }
    );

    if (!inserted.ok || !inserted.data?.[0]) {
      return errorResponse('LOCATION_SAVE_FAILED', 'Enregistrement GPS impossible.', 500, cors);
    }

    // 5. Upsert de la dernière position connue pour la carte d'administration
    const nowIso = new Date().toISOString();
    await supabaseRest(env, '/rest/v1/express_driver_last_locations', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        driver_id: driver.id,
        driver_firebase_uid: verified.uid,
        delivery_id: delivery.id,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy_meters: payload.accuracyMeters,
        speed_mps: payload.speedMps,
        heading: payload.heading,
        recorded_at: payload.recordedAtIso,
        updated_at: nowIso,
      }),
    });

    return jsonResponse(
      {
        ok: true,
        idempotentReplay: false,
        locationId: inserted.data[0].id,
        recordedAt: inserted.data[0].recorded_at,
      },
      201,
      cors
    );
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors de la mise à jour GPS.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDriverLocationRequest);
}
