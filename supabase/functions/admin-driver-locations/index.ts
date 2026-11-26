/**
 * Supabase Edge Function : admin-driver-locations
 * - GET : Retourne la dernière position GPS connue de chaque livreur actif
 *         ainsi que la mission en cours associée, pour la carte d'administration.
 *         Strictement réservée aux comptes listés dans `public.express_admins`.
 */

import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import {
  extractBearerToken,
  FirebaseAuthError,
  verifyFirebaseIdToken,
} from '../_shared/firebaseAuth.ts';
import {
  assertAuthorizedAdmin,
  DriverAuthorizationError,
  fetchActiveAdminByFirebaseUid,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';

interface LastLocationRow {
  driver_id: string;
  driver_firebase_uid: string;
  delivery_id: string | null;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  speed_mps: number | null;
  heading: number | null;
  recorded_at: string;
  updated_at: string;
}

interface DriverSummaryRow {
  id: string;
  firebase_uid: string;
  first_name: string;
  last_name: string;
  phone: string;
  vehicle_type: string;
  work_zone: string;
  account_status: string;
  is_available: boolean;
}

interface DeliverySummaryRow {
  id: string;
  order_number: string;
  status: string;
  delivery_zone: string;
  customer_name: string;
}

export async function handleAdminDriverLocationsRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, { projectId: env.firebaseProjectId });
    assertAuthorizedAdmin(await fetchActiveAdminByFirebaseUid(env, verified.uid));

    const [locRes, driversRes, deliveriesRes] = await Promise.all([
      supabaseRest<LastLocationRow[]>(
        env,
        '/rest/v1/express_driver_last_locations?order=updated_at.desc&limit=200'
      ),
      supabaseRest<DriverSummaryRow[]>(
        env,
        '/rest/v1/express_drivers?account_status=eq.active&select=id,firebase_uid,first_name,last_name,phone,vehicle_type,work_zone,account_status,is_available&limit=200'
      ),
      supabaseRest<DeliverySummaryRow[]>(
        env,
        '/rest/v1/express_deliveries?status=in.(ACCEPTED,PREPARING,PICKED_UP,IN_TRANSIT,ARRIVED)&select=id,order_number,status,delivery_zone,customer_name&limit=200'
      ),
    ]);

    if (!locRes.ok || !driversRes.ok) {
      return errorResponse(
        'FLEET_FETCH_FAILED',
        'Impossible de récupérer les positions des livreurs.',
        502,
        cors
      );
    }

    const driverMap = new Map((driversRes.data ?? []).map((d) => [d.id, d]));
    const deliveryMap = new Map((deliveriesRes.data ?? []).map((m) => [m.id, m]));

    const positions = (locRes.data ?? [])
      .map((loc) => {
        const driver = driverMap.get(loc.driver_id);
        if (!driver) return null;
        const activeMission = loc.delivery_id ? deliveryMap.get(loc.delivery_id) : undefined;
        return {
          driverId: driver.id,
          driverFirebaseUid: driver.firebase_uid,
          driverName: `${driver.first_name} ${driver.last_name}`.trim(),
          driverPhone: driver.phone,
          vehicleType: driver.vehicle_type,
          workZone: driver.work_zone,
          isAvailable: driver.is_available,
          activeDeliveryId: activeMission?.id ?? null,
          orderNumber: activeMission?.order_number ?? null,
          deliveryStatus: activeMission?.status ?? null,
          deliveryZone: activeMission?.delivery_zone ?? null,
          lat: loc.latitude,
          lng: loc.longitude,
          accuracyMeters: loc.accuracy_meters,
          speedMps: loc.speed_mps,
          headingDeg: loc.heading,
          recordedAtIso: loc.recorded_at,
          updatedAtIso: loc.updated_at,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return jsonResponse(
      {
        ok: true,
        generatedAtIso: new Date().toISOString(),
        activeCount: positions.length,
        drivers: positions,
      },
      200,
      cors
    );
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur sur le suivi de flotte.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleAdminDriverLocationsRequest);
}
