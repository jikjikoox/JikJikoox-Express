/**
 * Supabase Edge Function : delivery-proof
 * - POST : Valide l'attribution de la mission (`ARRIVED`), le type MIME et la taille (<= 5 Mo),
 *          puis génère une URL d'upload signée courte durée (120s) dans le bucket privé
 *          `delivery-proofs` et enregistre les métadonnées immuables.
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

const ALLOWED_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const SIGNED_UPLOAD_TTL_SECONDS = 120;

export function isSignedUrlExpired(expiresAtIso: string, nowMs = Date.now()): boolean {
  const expiresMs = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresMs)) return true;
  return nowMs >= expiresMs;
}

export function validateProofUploadMetadata(input: {
  mimeType?: string;
  fileSizeBytes?: number;
  recipientName?: string;
}): { ok: boolean; code?: string; message?: string; ext?: string } {
  const recipient = (input.recipientName || '').trim();
  if (recipient.length < 2 || recipient.length > 100) {
    return {
      ok: false,
      code: 'RECIPIENT_REQUIRED',
      message: 'Le nom du réceptionnaire (2 à 100 caractères) est requis.',
    };
  }
  if (input.mimeType) {
    const ext = ALLOWED_MIME_EXT[input.mimeType];
    if (!ext) {
      return {
        ok: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Formats acceptés : JPEG, PNG ou WebP uniquement.',
      };
    }
    if (
      typeof input.fileSizeBytes !== 'number' ||
      input.fileSizeBytes <= 0 ||
      input.fileSizeBytes > MAX_FILE_SIZE_BYTES
    ) {
      return {
        ok: false,
        code: 'FILE_TOO_LARGE',
        message: 'La photo de preuve ne doit pas dépasser 5 Mo.',
      };
    }
    return { ok: true, ext };
  }
  return { ok: true };
}

export async function handleDeliveryProofRequest(req: Request): Promise<Response> {
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
      return errorResponse('INVALID_BODY', 'Corps JSON invalide.', 400, cors);
    }

    const deliveryId = typeof raw.deliveryId === 'string' ? raw.deliveryId.trim() : '';
    if (!deliveryId) {
      return errorResponse('MISSION_ID_REQUIRED', 'Identifiant de mission requis.', 400, cors);
    }

    const metaCheck = validateProofUploadMetadata({
      mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
      fileSizeBytes: typeof raw.fileSizeBytes === 'number' ? raw.fileSizeBytes : undefined,
      recipientName: typeof raw.recipientName === 'string' ? raw.recipientName : undefined,
    });
    if (!metaCheck.ok) {
      return errorResponse(metaCheck.code!, metaCheck.message!, 400, cors);
    }

    const found = await supabaseRest<
      Array<{
        id: string;
        order_id: string;
        driver_id: string;
        driver_firebase_uid: string;
        status: string;
        payment_mode: 'cod' | 'prepaid';
        cod_amount: number;
      }>
    >(
      env,
      `/rest/v1/express_deliveries?id=eq.${encodeURIComponent(deliveryId)}&limit=1`
    );

    const delivery = found.data?.[0];
    if (!delivery) {
      return errorResponse('MISSION_NOT_FOUND', 'Mission introuvable.', 404, cors);
    }
    if (delivery.driver_id !== driver.id || delivery.driver_firebase_uid !== verified.uid) {
      return errorResponse('MISSION_FORBIDDEN', 'Preuve refusée : mission non attribuée.', 403, cors);
    }
    if (delivery.status !== 'ARRIVED') {
      return errorResponse(
        'INVALID_STATUS_FOR_PROOF',
        'La preuve ne peut être transmise qu’une fois arrivé chez le client.',
        422,
        cors
      );
    }

    const proofUuid = crypto.randomUUID();
    let storagePath: string | null = null;
    let signedUploadUrl: string | null = null;
    let expiresAtIso: string | null = null;

    if (metaCheck.ext) {
      // Confinement strict du chemin Storage par livreur et mission
      const safeUid = verified.uid.replace(/[^a-zA-Z0-9_-]/g, '');
      const safeDelivery = delivery.id.replace(/[^a-zA-Z0-9_-]/g, '');
      storagePath = `${safeUid}/${safeDelivery}/${proofUuid}.${metaCheck.ext}`;

      const signRes = await supabaseRest<{ url?: string; token?: string }>(
        env,
        `/storage/v1/object/upload/sign/delivery-proofs/${encodeURIComponent(storagePath)}`,
        {
          method: 'POST',
          body: JSON.stringify({ expiresIn: SIGNED_UPLOAD_TTL_SECONDS }),
        }
      );

      if (!signRes.ok || !signRes.data?.url) {
        return errorResponse('SIGNED_URL_FAILED', 'Impossible de préparer l’envoi sécurisé de la photo.', 502, cors);
      }
      signedUploadUrl = `${env.supabaseUrl}/storage/v1${signRes.data.url}`;
      expiresAtIso = new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString();
    }

    const inserted = await supabaseRest<Array<{ id: string; created_at: string }>>(
      env,
      '/rest/v1/express_delivery_proofs',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          id: proofUuid,
          delivery_id: delivery.id,
          order_id: delivery.order_id,
          driver_id: driver.id,
          driver_firebase_uid: verified.uid,
          recipient_name: String(raw.recipientName).trim().slice(0, 100),
          proof_code: typeof raw.proofCode === 'string' ? raw.proofCode.trim().slice(0, 32) : null,
          proof_note: typeof raw.proofNote === 'string' ? raw.proofNote.trim().slice(0, 300) : null,
          storage_bucket: 'delivery-proofs',
          storage_path: storagePath,
          mime_type: typeof raw.mimeType === 'string' ? raw.mimeType : null,
          file_size_bytes: typeof raw.fileSizeBytes === 'number' ? raw.fileSizeBytes : null,
          cod_collected_confirmed: raw.codCollectedConfirmed === true,
        }),
      }
    );

    if (!inserted.ok || !inserted.data?.[0]) {
      return errorResponse('PROOF_SAVE_FAILED', 'Enregistrement de la preuve impossible.', 500, cors);
    }

    return jsonResponse(
      {
        ok: true,
        proofId: inserted.data[0].id,
        storagePath,
        signedUploadUrl,
        expiresAtIso,
        createdAt: inserted.data[0].created_at,
      },
      201,
      cors
    );
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors de la création de preuve.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDeliveryProofRequest);
}
