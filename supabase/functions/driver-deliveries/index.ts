/**
 * Supabase Edge Function : driver-deliveries
 * - GET : Retourne exclusivement les missions attribuées au livreur authentifié
 *         (identifié uniquement par son Firebase UID vérifié — tout paramètre driverId
 *         transmis par le frontend est ignoré/rejeté).
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

export async function handleDriverDeliveriesRequest(req: Request): Promise<Response> {
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

    const driver = assertAuthorizedActiveDriver(
      await fetchDriverByFirebaseUid(env, verified.uid)
    );

    const url = new URL(req.url);
    // Refus explicite si le client tente d'interroger un autre livreur
    const requestedDriverParam = url.searchParams.get('driverId') || url.searchParams.get('courierId');
    if (requestedDriverParam && requestedDriverParam !== verified.uid && requestedDriverParam !== driver.id) {
      return errorResponse(
        'CROSS_DRIVER_FORBIDDEN',
        'Accès interdit aux missions d’un autre livreur.',
        403,
        cors
      );
    }

    const res = await supabaseRest<Record<string, unknown>[]>(
      env,
      `/rest/v1/express_deliveries?driver_id=eq.${encodeURIComponent(
        driver.id
      )}&order=created_at.desc&limit=100`
    );

    if (!res.ok) {
      return errorResponse('DELIVERIES_FETCH_FAILED', 'Impossible de charger vos missions.', 502, cors);
    }

    return jsonResponse({ ok: true, deliveries: res.data ?? [] }, 200, cors);
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors du chargement des missions.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDriverDeliveriesRequest);
}
