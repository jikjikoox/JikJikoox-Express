/**
 * Supabase Edge Function interne : sync-assignment-to-firestore
 * Déclenchée par JikJikoox Admin / Webhook DB Supabase lorsqu'une mission est
 * officiellement affectée ou modifiée dans Supabase.
 *
 * Sécurité : Authentification interne stricte par secret serveur (`INTERNAL_SYNC_SECRET`),
 * jamais appelable directement depuis le frontend livreur.
 */

import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import {
  dispatchFcmNotificationSafe,
  type FirebaseServiceAccountConfig,
  syncMissionToFirestoreWithRetry,
} from '../_shared/firestoreSync.ts';
import {
  type DriverRecord,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleSyncAssignmentRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  }

  // Vérification stricte du secret interne serveur-à-serveur
  const headerSecret = req.headers.get('x-internal-sync-secret') || '';
  if (!env.internalSyncSecret || !constantTimeEqual(headerSecret, env.internalSyncSecret)) {
    return errorResponse('UNAUTHORIZED_INTERNAL', 'Accès interne non autorisé.', 401, cors);
  }

  try {
    const raw = (await req.json().catch(() => null)) as { deliveryId?: string } | null;
    const deliveryId = typeof raw?.deliveryId === 'string' ? raw.deliveryId.trim() : '';
    if (!deliveryId) {
      return errorResponse('MISSION_ID_REQUIRED', 'deliveryId requis.', 400, cors);
    }

    const found = await supabaseRest<Array<Record<string, unknown>>>(
      env,
      `/rest/v1/express_deliveries?id=eq.${encodeURIComponent(deliveryId)}&limit=1`
    );
    const delivery = found.data?.[0];
    if (!delivery) {
      return errorResponse('MISSION_NOT_FOUND', 'Affectation introuvable.', 404, cors);
    }

    const driverRes = await supabaseRest<DriverRecord[]>(
      env,
      `/rest/v1/express_drivers?id=eq.${encodeURIComponent(String(delivery.driver_id))}&limit=1`
    );
    const driver = driverRes.data?.[0];
    if (!driver || driver.account_status !== 'active') {
      return errorResponse('DRIVER_NOT_ACTIVE', 'Le livreur attribué n’est pas actif.', 409, cors);
    }

    const saConfig: FirebaseServiceAccountConfig | null =
      env.firebaseClientEmail && env.firebasePrivateKey
        ? {
            projectId: env.firebaseProjectId,
            databaseId: env.firestoreDatabaseId,
            clientEmail: env.firebaseClientEmail,
            privateKeyPem: env.firebasePrivateKey,
          }
        : null;

    const syncVersion = Number(delivery.sync_version || 1);
    const orderNumber = String(delivery.order_number);

    const firestoreRes = await syncMissionToFirestoreWithRetry(
      {
        missionId: deliveryId,
        orderId: String(delivery.order_id || orderNumber),
        orderNumber,
        courierId: driver.firebase_uid,
        customerName: String(delivery.customer_name),
        customerPhone: String(delivery.customer_phone),
        deliveryAddress: String(delivery.delivery_address),
        deliveryZone: String(delivery.delivery_zone),
        pickupName: String(delivery.pickup_name),
        pickupAddress: String(delivery.pickup_address),
        gpsLat: typeof delivery.gps_lat === 'number' ? delivery.gps_lat : null,
        gpsLng: typeof delivery.gps_lng === 'number' ? delivery.gps_lng : null,
        itemsSummary: Array.isArray(delivery.items_summary)
          ? (delivery.items_summary as Array<{ name: string; quantity: number; unit?: string }>)
          : [],
        itemCount: Number(delivery.item_count || 1),
        paymentMode: delivery.payment_mode === 'cod' ? 'cod' : 'prepaid',
        codAmount: Number(delivery.cod_amount || 0),
        estimatedFee: Number(delivery.estimated_fee || 0),
        instructions: String(delivery.instructions || ''),
        status: String(delivery.status),
        syncVersion,
        assignedAtIso: String(delivery.created_at || delivery.updated_at || new Date().toISOString()),
        updatedAtIso: String(delivery.updated_at || new Date().toISOString()),
      },
      saConfig
    );

    await supabaseRest(env, '/rest/v1/express_sync_log', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        sync_key: firestoreRes.syncKey,
        delivery_id: deliveryId,
        target_system: 'firestore',
        sync_version: syncVersion,
        status: firestoreRes.synced ? 'synced' : 'failed',
        attempt_count: firestoreRes.attempts,
        last_error: firestoreRes.errorMessage ?? null,
        synced_at: firestoreRes.synced ? new Date().toISOString() : null,
      }),
    });

    const fcmRes = await dispatchFcmNotificationSafe(
      {
        fcmToken: driver.fcm_token,
        title: `Nouvelle affectation — ${String(delivery.delivery_zone)}`,
        body: `Commande ${orderNumber} prête à être consultée dans JikJikoox Express.`,
        missionId: deliveryId,
        syncVersion,
      },
      saConfig
    );

    await supabaseRest(env, '/rest/v1/express_notifications', {
      method: 'POST',
      body: JSON.stringify({
        driver_id: driver.id,
        driver_firebase_uid: driver.firebase_uid,
        delivery_id: deliveryId,
        category: 'assignment',
        title: `Nouvelle affectation — ${String(delivery.delivery_zone)}`,
        body: `Commande ${orderNumber} attribuée pour ${String(delivery.delivery_address)}.`,
        fcm_dispatch_status: fcmRes.synced ? 'sent' : 'failed',
        fcm_error: fcmRes.errorMessage ?? null,
      }),
    });

    return jsonResponse(
      {
        ok: true,
        deliveryId,
        syncVersion,
        firestore: firestoreRes,
        fcm: fcmRes,
      },
      200,
      cors
    );
  } catch {
    return errorResponse('INTERNAL_ERROR', 'Erreur interne de synchronisation.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleSyncAssignmentRequest);
}
