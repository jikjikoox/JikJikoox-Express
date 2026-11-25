/**
 * Supabase Edge Function : driver-notifications
 * - GET  : Liste les notifications opérationnelles du livreur authentifié.
 * - POST : Marque une ou toutes les notifications comme lues (cloisonnement strict par driver_id).
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

export async function handleDriverNotificationsRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, { projectId: env.firebaseProjectId });
    const driver = assertAuthorizedActiveDriver(
      await fetchDriverByFirebaseUid(env, verified.uid)
    );

    if (req.method === 'GET') {
      const res = await supabaseRest<Record<string, unknown>[]>(
        env,
        `/rest/v1/express_notifications?driver_id=eq.${encodeURIComponent(
          driver.id
        )}&order=created_at.desc&limit=50`
      );
      if (!res.ok) {
        return errorResponse('NOTIFICATIONS_FETCH_FAILED', 'Chargement des notifications impossible.', 502, cors);
      }
      return jsonResponse({ ok: true, notifications: res.data ?? [] }, 200, cors);
    }

    if (req.method === 'POST') {
      const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const nowIso = new Date().toISOString();

      if (raw?.markAll === true) {
        const res = await supabaseRest(
          env,
          `/rest/v1/express_notifications?driver_id=eq.${encodeURIComponent(
            driver.id
          )}&is_read=eq.false`,
          {
            method: 'PATCH',
            body: JSON.stringify({ is_read: true, read_at: nowIso }),
          }
        );
        if (!res.ok) {
          return errorResponse('MARK_READ_FAILED', 'Mise à jour impossible.', 500, cors);
        }
        return jsonResponse({ ok: true, markedAll: true }, 200, cors);
      }

      const notificationId =
        typeof raw?.notificationId === 'string' ? raw.notificationId.trim() : '';
      if (!notificationId) {
        return errorResponse('NOTIFICATION_ID_REQUIRED', 'Identifiant notification manquant.', 400, cors);
      }

      const res = await supabaseRest(
        env,
        `/rest/v1/express_notifications?id=eq.${encodeURIComponent(
          notificationId
        )}&driver_id=eq.${encodeURIComponent(driver.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ is_read: true, read_at: nowIso }),
        }
      );
      if (!res.ok) {
        return errorResponse('MARK_READ_FAILED', 'Mise à jour impossible.', 500, cors);
      }
      return jsonResponse({ ok: true, notificationId, isRead: true }, 200, cors);
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur sur les notifications.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDriverNotificationsRequest);
}
