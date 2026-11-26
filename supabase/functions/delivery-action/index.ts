/**
 * Supabase Edge Function : delivery-action
 * - POST : Valide et applique de manière transactionnelle une transition de statut livreur
 *          dans Supabase (`express_apply_delivery_transition` avec verrou FOR UPDATE et idempotence),
 *          puis synchronise le miroir opérationnel Firestore et journalise tout échec de synchro.
 */

import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import {
  extractBearerToken,
  FirebaseAuthError,
  verifyFirebaseIdToken,
} from '../_shared/firebaseAuth.ts';
import {
  dispatchFcmNotificationSafe,
  type FirebaseServiceAccountConfig,
  syncMissionToFirestoreWithRetry,
} from '../_shared/firestoreSync.ts';
import {
  assertAuthorizedActiveDriver,
  DriverAuthorizationError,
  fetchDriverByFirebaseUid,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';
import {
  type BackendDeliveryStatus,
  detectForbiddenFields,
  validateDeliveryAction,
} from '../_shared/workflow.ts';

interface DeliveryRow {
  id: string;
  mission_code: string;
  order_id: string;
  order_number: string;
  driver_id: string;
  driver_firebase_uid: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_zone: string;
  pickup_name: string;
  pickup_address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  items_summary: Array<{ name: string; quantity: number; unit?: string }>;
  item_count: number;
  payment_mode: 'cod' | 'prepaid';
  cod_amount: number;
  estimated_fee: number;
  instructions: string;
  status: BackendDeliveryStatus;
  recipient_name: string | null;
  proof_code: string | null;
  proof_note: string | null;
  failure_reason: string | null;
  sync_version: number;
  created_at?: string;
  updated_at: string;
}

export async function handleDeliveryActionRequest(req: Request): Promise<Response> {
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
    if (!raw || typeof raw !== 'object') {
      return errorResponse('INVALID_BODY', 'Requête JSON invalide.', 400, cors);
    }

    const deliveryId = typeof raw.deliveryId === 'string' ? raw.deliveryId.trim() : '';
    if (!deliveryId) {
      return errorResponse('MISSION_ID_REQUIRED', 'Identifiant de mission manquant.', 400, cors);
    }

    const idempotencyKey = (
      req.headers.get('x-idempotency-key') ||
      (typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : '')
    )
      .trim()
      .slice(0, 128);

    // 1. Charger la mission officielle depuis Supabase
    const found = await supabaseRest<DeliveryRow[]>(
      env,
      `/rest/v1/express_deliveries?id=eq.${encodeURIComponent(deliveryId)}&limit=1`
    );
    const delivery = found.data?.[0];
    if (!delivery) {
      return errorResponse('MISSION_NOT_FOUND', 'Mission introuvable.', 404, cors);
    }

    // 1b. Rejet immédiat des champs protégés et vérification de propriété avant rejeu idempotent
    const forbidden = detectForbiddenFields(raw);
    if (forbidden.length > 0) {
      return errorResponse(
        'FORBIDDEN_FIELDS',
        `Modification interdite des champs protégés (${forbidden.join(', ')}).`,
        400,
        cors
      );
    }
    if (delivery.driver_firebase_uid !== verified.uid) {
      return errorResponse('MISSION_FORBIDDEN', 'Cette mission ne vous est pas attribuée.', 403, cors);
    }

    // 1c. Vérification d'idempotence AVANT rejet de statut (gère retries réseau après succès)
    if (idempotencyKey) {
      const existingEvRes = await supabaseRest<
        Array<{ id: string; next_status: BackendDeliveryStatus }>
      >(
        env,
        `/rest/v1/express_delivery_events?idempotency_key=eq.${encodeURIComponent(
          idempotencyKey
        )}&delivery_id=eq.${encodeURIComponent(delivery.id)}&driver_firebase_uid=eq.${encodeURIComponent(
          verified.uid
        )}&limit=1`
      );
      const existingEv = existingEvRes.data?.[0];
      if (existingEv) {
        return jsonResponse(
          {
            ok: true,
            deliveryId: delivery.id,
            status: delivery.status,
            eventId: existingEv.id,
            syncVersion: delivery.sync_version,
            idempotentReplay: true,
            firestoreSynced: true,
            notificationSynced: true,
          },
          200,
          cors
        );
      }
    }

    // 2. Validation métier stricte côté serveur avant appel RPC
    const validation = validateDeliveryAction(
      raw,
      {
        id: delivery.id,
        driverFirebaseUid: delivery.driver_firebase_uid,
        status: delivery.status,
        paymentMode: delivery.payment_mode,
        codAmount: Number(delivery.cod_amount),
      },
      verified.uid
    );
    if (!validation.ok) {
      return errorResponse(
        validation.code || 'VALIDATION_FAILED',
        validation.message || 'Action non autorisée.',
        validation.httpStatus || 400,
        cors
      );
    }

    const proof = (raw.proof as Record<string, unknown> | undefined) ?? undefined;
    const nextStatus = raw.nextStatus as BackendDeliveryStatus;

    // 3. Transaction atomique PostgreSQL avec verrou FOR UPDATE + idempotence
    const proofId =
      typeof proof?.proofId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proof.proofId.trim())
        ? proof.proofId.trim()
        : null;
    const proofGpsLat =
      typeof proof?.gpsLat === 'number' && Number.isFinite(proof.gpsLat) ? proof.gpsLat : null;
    const proofGpsLng =
      typeof proof?.gpsLng === 'number' && Number.isFinite(proof.gpsLng) ? proof.gpsLng : null;

    const rpcRes = await supabaseRest<{
      idempotent_replay: boolean;
      event_id: string;
      delivery_id: string;
      status: BackendDeliveryStatus;
      sync_version: number;
      updated_at?: string;
    }>(env, '/rest/v1/rpc/express_apply_delivery_transition', {
      method: 'POST',
      body: JSON.stringify({
        p_delivery_id: delivery.id,
        p_driver_firebase_uid: verified.uid,
        p_next_status: nextStatus,
        p_idempotency_key: idempotencyKey || null,
        p_label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : nextStatus,
        p_recipient_name: typeof proof?.recipientName === 'string' ? proof.recipientName : null,
        p_proof_code: typeof proof?.proofCode === 'string' ? proof.proofCode : null,
        p_proof_note: typeof proof?.proofNote === 'string' ? proof.proofNote : null,
        p_failure_reason: typeof raw.failureReason === 'string' ? raw.failureReason : null,
        p_cod_confirmed: proof?.codCollectedConfirmed === true,
        p_proof_id: proofId,
        p_gps_lat: proofGpsLat,
        p_gps_lng: proofGpsLng,
      }),
    });

    if (!rpcRes.ok || !rpcRes.data) {
      const errText = rpcRes.errorText || '';
      if (errText.includes('MISSION_TERMINAL')) {
        return errorResponse('MISSION_LOCKED', 'Mission déjà clôturée ou annulée.', 409, cors);
      }
      if (errText.includes('MISSION_FORBIDDEN')) {
        return errorResponse('MISSION_FORBIDDEN', 'Affectation modifiée ou non autorisée.', 403, cors);
      }
      if (errText.includes('INVALID_TRANSITION')) {
        return errorResponse('INVALID_TRANSITION', 'Transition de statut non autorisée.', 422, cors);
      }
      return errorResponse('TRANSITION_FAILED', 'Échec de validation serveur.', 500, cors);
    }

    // 4. Synchronisation vers le miroir opérationnel Firestore (non bloquante pour la source officielle)
    const saConfig: FirebaseServiceAccountConfig | null =
      env.firebaseClientEmail && env.firebasePrivateKey
        ? {
            projectId: env.firebaseProjectId,
            databaseId: env.firestoreDatabaseId,
            clientEmail: env.firebaseClientEmail,
            privateKeyPem: env.firebasePrivateKey,
          }
        : null;

    const syncResult = await syncMissionToFirestoreWithRetry(
      {
        missionId: delivery.id,
        orderId: delivery.order_id,
        orderNumber: delivery.order_number,
        courierId: delivery.driver_firebase_uid,
        customerName: delivery.customer_name,
        customerPhone: delivery.customer_phone,
        deliveryAddress: delivery.delivery_address,
        deliveryZone: delivery.delivery_zone,
        pickupName: delivery.pickup_name,
        pickupAddress: delivery.pickup_address,
        gpsLat: delivery.gps_lat,
        gpsLng: delivery.gps_lng,
        itemsSummary: delivery.items_summary,
        itemCount: delivery.item_count,
        paymentMode: delivery.payment_mode,
        codAmount: Number(delivery.cod_amount),
        estimatedFee: Number(delivery.estimated_fee),
        instructions: delivery.instructions,
        status: rpcRes.data.status,
        syncVersion: rpcRes.data.sync_version,
        recipientName:
          typeof proof?.recipientName === 'string' ? proof.recipientName : delivery.recipient_name,
        proofCode: typeof proof?.proofCode === 'string' ? proof.proofCode : delivery.proof_code,
        proofNote: typeof proof?.proofNote === 'string' ? proof.proofNote : delivery.proof_note,
        failureReason:
          typeof raw.failureReason === 'string' ? raw.failureReason : delivery.failure_reason,
        assignedAtIso: delivery.created_at || delivery.updated_at,
        updatedAtIso: rpcRes.data.updated_at || new Date().toISOString(),
      },
      saConfig
    );

    // Journalisation idempotente de la synchro Firestore
    await supabaseRest(env, '/rest/v1/express_sync_log', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        sync_key: syncResult.syncKey,
        delivery_id: delivery.id,
        target_system: 'firestore',
        sync_version: rpcRes.data.sync_version,
        status: syncResult.synced ? 'synced' : 'failed',
        attempt_count: syncResult.attempts,
        last_error: syncResult.errorMessage ?? null,
        synced_at: syncResult.synced ? new Date().toISOString() : null,
      }),
    });

    // Notification de confirmation FCM lors d'une livraison clôturée
    let notificationSynced = true;
    if (
      rpcRes.data.status === 'DELIVERED' &&
      !rpcRes.data.idempotent_replay &&
      driver.notifications_enabled !== false
    ) {
      const confirmationDedupeKey = `confirmation:${delivery.id}:v${rpcRes.data.sync_version}`;
      const fcmRes = await dispatchFcmNotificationSafe(
        {
          fcmToken: driver.fcm_token,
          title: `Livraison confirmée — ${delivery.order_number}`,
          body: `Preuve enregistrée pour ${delivery.delivery_zone}.`,
          missionId: delivery.id,
          syncVersion: rpcRes.data.sync_version,
          category: 'confirmation',
          dedupeKey: confirmationDedupeKey,
        },
        saConfig
      );
      notificationSynced = fcmRes.synced;

      // Nettoyage automatique si le jeton FCM a expiré ou été révoqué par le navigateur
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

    return jsonResponse(
      {
        ok: true,
        deliveryId: delivery.id,
        status: rpcRes.data.status,
        eventId: rpcRes.data.event_id,
        syncVersion: rpcRes.data.sync_version,
        idempotentReplay: rpcRes.data.idempotent_replay,
        firestoreSynced: syncResult.synced,
        notificationSynced,
      },
      200,
      cors
    );
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors de la mise à jour de mission.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDeliveryActionRequest);
}
