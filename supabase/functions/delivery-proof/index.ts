/**
 * Supabase Edge Function : delivery-proof
 * Flux sécurisé en 2 phases (sans jamais exposer la Service Role Key au frontend) :
 *
 * 1. `action: "prepare-upload"` :
 *    - Vérifie le jeton Firebase ID + statut `active` du livreur + propriété de la mission (`ARRIVED`).
 *    - Valide le nom du réceptionnaire, le type MIME (JPEG/PNG/WebP) et la taille (<= 5 Mo).
 *    - Génère une URL d'upload signée courte durée (120s) vers le bucket privé `delivery-proofs`
 *      avec confinement strict `{firebaseUid}/{deliveryId}/{proofUuid}.{ext}`.
 *    - N'insère PAS encore de ligne dans `express_delivery_proofs` tant que l'upload n'est pas vérifié.
 *
 * 2. `action: "confirm-proof"` :
 *    - Vérifie que le chemin Storage est strictement confiné à ce livreur et cette mission.
 *    - Vérifie auprès de Supabase Storage (HEAD) que le fichier photo existe réellement dans le bucket privé.
 *    - Insère ensuite l'unique enregistrement immuable dans `express_delivery_proofs` avec `upload_verified = true`.
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
  type SupabaseServerEnv,
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

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function isConfinedStoragePath(
  storagePath: string,
  firebaseUid: string,
  deliveryId: string
): boolean {
  if (!storagePath || typeof storagePath !== 'string') return false;
  if (
    storagePath.includes('..') ||
    storagePath.includes('\\') ||
    storagePath.toLowerCase().includes('%2e') ||
    storagePath.startsWith('/')
  ) {
    return false;
  }
  const safeUid = sanitizePathSegment(firebaseUid);
  const safeDelivery = sanitizePathSegment(deliveryId);
  if (!safeUid || !safeDelivery) return false;

  const expectedPrefix = `${safeUid}/${safeDelivery}/`;
  if (!storagePath.startsWith(expectedPrefix)) return false;

  const filePart = storagePath.slice(expectedPrefix.length);
  return /^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filePart);
}

function encodeStoragePath(storagePath: string): string {
  return storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

async function verifyStorageObjectExists(
  env: SupabaseServerEnv,
  storagePath: string
): Promise<{ exists: boolean; contentLength?: number }> {
  try {
    const res = await fetch(
      `${env.supabaseUrl}/storage/v1/object/delivery-proofs/${encodeStoragePath(storagePath)}`,
      {
        method: 'HEAD',
        headers: {
          apikey: env.serviceRoleKey,
          Authorization: `Bearer ${env.serviceRoleKey}`,
        },
      }
    );
    if (!res.ok) {
      return { exists: false };
    }
    const lenHeader = res.headers.get('content-length');
    const contentLength = lenHeader ? Number(lenHeader) : undefined;
    if (typeof contentLength === 'number' && !Number.isNaN(contentLength) && contentLength === 0) {
      return { exists: false, contentLength: 0 };
    }
    return { exists: true, contentLength };
  } catch {
    return { exists: false };
  }
}

function isValidCoord(val: unknown, min: number, max: number): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
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

    const action =
      raw.action === 'confirm-proof'
        ? 'confirm-proof'
        : raw.action === 'prepare-upload'
          ? 'prepare-upload'
          : typeof raw.mimeType === 'string'
            ? 'prepare-upload'
            : 'confirm-proof';

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

    // -------------------------------------------------------------------------
    // PHASE 1 : Préparer l'URL d'upload signée (aucune écriture en base avant confirmation)
    // -------------------------------------------------------------------------
    if (action === 'prepare-upload') {
      if (!metaCheck.ext) {
        return errorResponse(
          'MIME_TYPE_REQUIRED',
          'Le type MIME de la photo (JPEG, PNG ou WebP) est requis pour préparer l’envoi.',
          400,
          cors
        );
      }

      const proofUuid = crypto.randomUUID();
      const safeUid = sanitizePathSegment(verified.uid);
      const safeDelivery = sanitizePathSegment(delivery.id);
      const storagePath = `${safeUid}/${safeDelivery}/${proofUuid}.${metaCheck.ext}`;

      const signRes = await supabaseRest<{ url?: string; token?: string }>(
        env,
        `/storage/v1/object/upload/sign/delivery-proofs/${encodeStoragePath(storagePath)}`,
        {
          method: 'POST',
          body: JSON.stringify({ expiresIn: SIGNED_UPLOAD_TTL_SECONDS }),
        }
      );

      if (!signRes.ok || !signRes.data?.url) {
        return errorResponse(
          'SIGNED_URL_FAILED',
          'Impossible de préparer l’envoi sécurisé de la photo.',
          502,
          cors
        );
      }

      const signedUploadUrl = signRes.data.url.startsWith('http')
        ? signRes.data.url
        : `${env.supabaseUrl}/storage/v1${signRes.data.url}`;
      const expiresAtIso = new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString();

      return jsonResponse(
        {
          ok: true,
          phase: 'upload_prepared',
          proofId: proofUuid,
          storagePath,
          signedUploadUrl,
          expiresAtIso,
        },
        200,
        cors
      );
    }

    // -------------------------------------------------------------------------
    // PHASE 2 : Vérification réelle dans Storage + enregistrement immuable en base
    // -------------------------------------------------------------------------
    const requestedProofId =
      typeof raw.proofId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.proofId.trim())
        ? raw.proofId.trim()
        : crypto.randomUUID();

    const storagePath =
      typeof raw.storagePath === 'string' && raw.storagePath.trim()
        ? raw.storagePath.trim()
        : null;

    let uploadVerified = false;
    let uploadVerifiedAt: string | null = null;

    if (storagePath) {
      if (!isConfinedStoragePath(storagePath, verified.uid, delivery.id)) {
        return errorResponse(
          'INVALID_STORAGE_PATH',
          'Chemin de stockage photo refusé : hors périmètre livreur/mission.',
          403,
          cors
        );
      }

      const storageCheck = await verifyStorageObjectExists(env, storagePath);
      if (!storageCheck.exists) {
        return errorResponse(
          'STORAGE_UPLOAD_NOT_VERIFIED',
          'La photo n’a pas encore été reçue dans le stockage sécurisé. Veuillez relancer l’envoi.',
          409,
          cors
        );
      }

      uploadVerified = true;
      uploadVerifiedAt = new Date().toISOString();
    }

    const gpsLat = isValidCoord(raw.gpsLat, -90, 90) ? raw.gpsLat : null;
    const gpsLng = isValidCoord(raw.gpsLng, -180, 180) ? raw.gpsLng : null;

    const inserted = await supabaseRest<Array<{ id: string; created_at: string }>>(
      env,
      '/rest/v1/express_delivery_proofs',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          id: requestedProofId,
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
          upload_verified: uploadVerified,
          upload_verified_at: uploadVerifiedAt,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
        }),
      }
    );

    if (!inserted.ok || !inserted.data?.[0]) {
      return errorResponse('PROOF_SAVE_FAILED', 'Enregistrement de la preuve impossible.', 500, cors);
    }

    return jsonResponse(
      {
        ok: true,
        phase: 'confirmed',
        proofId: inserted.data[0].id,
        storagePath,
        uploadVerified,
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

const denoRuntime = (
  globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }
).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDeliveryProofRequest);
}
