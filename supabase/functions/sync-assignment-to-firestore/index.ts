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
    const raw = (await req.json().catch(() => null)) as {
      deliveryId?: string;
      eventCategory?: 'assignment' | 'modification' | 'cancellation' | 'instruction' | 'operational';
      title?: string;
      body?: string;
      dedupeKey?: string;
    } | null;
    const deliveryId = typeof raw?.deliveryId === 'string' ? raw.deliveryId.trim() : '';
    if (!deliveryId) {
      return errorResponse('MISSION_ID_REQUIRED', 'deliveryId requis.', 400, cors);
    }

    const ALLOWED_CATEGORIES = new Set([
      'assignment',
      'modification',
      'cancellation',
      'instruction',
      'operational',
    ]);
    const eventCategory =
      typeof raw?.eventCategory === 'string' && ALLOWED_CATEGORIES.has(raw.eventCategory)
        ? raw.eventCategory
        : 'assignment';

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
    const deliveryZone = String(delivery.delivery_zone || 'Dakar');
    const deliveryAddress = String(delivery.delivery_address || '');

    const firestoreRes = await syncMissionToFirestoreWithRetry(
      {
        missionId: deliveryId,
        orderId: String(delivery.order_id || orderNumber),
        orderNumber,
        courierId: driver.firebase_uid,
        customerName: String(delivery.customer_name),
        customerPhone: String(delivery.customer_phone),
        deliveryAddress,
        deliveryZone,
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

    const defaultTemplates: Record<string, { title: string; body: string }> = {
      assignment: {
        title: `Nouvelle affectation — ${deliveryZone}`,
        body: `Commande ${orderNumber} attribuée pour ${deliveryAddress}.`,
      },
      modification: {
        title: `Mission mise à jour — ${orderNumber}`,
        body: `Les informations de la commande ${orderNumber} (${deliveryZone}) ont été modifiées.`,
      },
      cancellation: {
        title: `Mission annulée — ${orderNumber}`,
        body: `La livraison ${orderNumber} (${deliveryZone}) a été annulée par la coordination.`,
      },
      instruction: {
        title: `Instruction importante — ${orderNumber}`,
        body: String(delivery.instructions || `Nouvelle consigne sur la commande ${orderNumber}.`).slice(0, 220),
      },
      operational: {
        title: `Message opérationnel — ${orderNumber}`,
        body: `Consultez la mission ${orderNumber} dans JikJikoox Express.`,
      },
    };

    const notifTitle =
      typeof raw?.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 120)
        : defaultTemplates[eventCategory].title;
    const notifBody =
      typeof raw?.body === 'string' && raw.body.trim()
        ? raw.body.trim().slice(0, 240)
        : defaultTemplates[eventCategory].body;
    const dedupeKey =
      typeof raw?.dedupeKey === 'string' && raw.dedupeKey.trim()
        ? raw.dedupeKey.trim().slice(0, 128)
        : `${eventCategory}:${deliveryId}:v${syncVersion}`;

    // Anti-doublon strict : ne pas renvoyer un push déjà envoyé pour cette clé métier
    const existingNotifRes = await supabaseRest<Array<{ id: string }>>(
      env,
      `/rest/v1/express_notifications?dedupe_key=eq.${encodeURIComponent(dedupeKey)}&limit=1`
    );
    if (existingNotifRes.data && existingNotifRes.data.length > 0) {
      return jsonResponse(
        {
          ok: true,
          deliveryId,
          syncVersion,
          deduplicated: true,
          dedupeKey,
          firestore: firestoreRes,
          fcm: { synced: true, skippedDuplicate: true },
        },
        200,
        cors
      );
    }

    let fcmDispatchStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
    let fcmRes: { synced: boolean; errorMessage?: string; tokenInvalid?: boolean } = {
      synced: false,
      errorMessage: 'NOTIFICATIONS_DISABLED',
    };

    if (driver.notifications_enabled !== false) {
      fcmRes = await dispatchFcmNotificationSafe(
        {
          fcmToken: driver.fcm_token,
          title: notifTitle,
          body: notifBody,
          missionId: deliveryId,
          syncVersion,
          category: eventCategory,
          dedupeKey,
        },
        saConfig
      );
      fcmDispatchStatus = fcmRes.synced ? 'sent' : driver.fcm_token ? 'failed' : 'skipped';

      // Nettoyage automatique des jetons FCM invalides/expirés (404 / UNREGISTERED)
      if (fcmRes.tokenInvalid) {
        const nowIso = new Date().toISOString();
        await supabaseRest(
          env,
          `/rest/v1/express_drivers?id=eq.${encodeURIComponent(driver.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              fcm_token: null,
              fcm_token_invalidated_at: nowIso,
              updated_at: nowIso,
            }),
          }
        );
      }
    }

    await supabaseRest(env, '/rest/v1/express_notifications', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({
        driver_id: driver.id,
        driver_firebase_uid: driver.firebase_uid,
        delivery_id: deliveryId,
        category: eventCategory,
        title: notifTitle,
        body: notifBody,
        dedupe_key: dedupeKey,
        fcm_dispatch_status: fcmDispatchStatus,
        fcm_error: fcmRes.errorMessage ?? null,
      }),
    });

    return jsonResponse(
      {
        ok: true,
        deliveryId,
        syncVersion,
        deduplicated: false,
        dedupeKey,
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
