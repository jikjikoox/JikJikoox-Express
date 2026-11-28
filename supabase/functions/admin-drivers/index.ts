/**
 * Supabase Edge Function : admin-drivers
 * Gestion administrative stricte des candidatures et comptes livreurs (`express_drivers`).
 *
 * Sécurité :
 * - Vérification cryptographique du Firebase ID Token (RS256, email vérifié exigé).
 * - Contrôle serveur strict contre `public.express_admins` (`is_active = true`).
 * - Un livreur non administrateur reçoit systématiquement `403 ADMIN_REQUIRED`.
 * - Les statuts modifiables sont uniquement `active`, `suspended`, `disabled`.
 * - Toute suspension ou désactivation force `is_available = false`.
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
  type DriverRecord,
  fetchActiveAdminByFirebaseUid,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';

const ALLOWED_FILTER_STATUSES = new Set(['pending', 'active', 'suspended', 'disabled']);
const ALLOWED_TARGET_STATUSES = new Set(['active', 'suspended', 'disabled']);

export async function handleAdminDriversRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, {
      projectId: env.firebaseProjectId,
      requireVerifiedEmail: true,
    });

    const admin = await fetchActiveAdminByFirebaseUid(env, verified.uid, verified.email);
    assertAuthorizedAdmin(admin);

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const statusFilter = url.searchParams.get('status')?.trim().toLowerCase() || '';
      if (statusFilter && !ALLOWED_FILTER_STATUSES.has(statusFilter)) {
        return errorResponse('INVALID_STATUS_FILTER', 'Filtre de statut invalide.', 400, cors);
      }

      const query = statusFilter
        ? `/rest/v1/express_drivers?account_status=eq.${encodeURIComponent(statusFilter)}&order=created_at.desc`
        : '/rest/v1/express_drivers?order=created_at.desc';

      const listRes = await supabaseRest<DriverRecord[]>(env, query);
      if (!listRes.ok || !Array.isArray(listRes.data)) {
        return errorResponse('DRIVERS_FETCH_FAILED', 'Impossible de charger la liste des livreurs.', 500, cors);
      }

      const drivers = listRes.data;
      const counts = {
        total: drivers.length,
        pending: drivers.filter((d) => d.account_status === 'pending').length,
        active: drivers.filter((d) => d.account_status === 'active').length,
        suspended: drivers.filter((d) => d.account_status === 'suspended').length,
        disabled: drivers.filter((d) => d.account_status === 'disabled').length,
      };

      return jsonResponse({ ok: true, counts, drivers }, 200, cors);
    }

    if (req.method === 'PATCH') {
      const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') {
        return errorResponse('INVALID_BODY', 'Corps JSON invalide.', 400, cors);
      }

      const driverId = typeof raw.driverId === 'string' ? raw.driverId.trim() : '';
      const accountStatus =
        typeof raw.accountStatus === 'string' ? raw.accountStatus.trim().toLowerCase() : '';

      if (!driverId || driverId.length > 100) {
        return errorResponse('INVALID_DRIVER_ID', 'Identifiant livreur requis.', 400, cors);
      }
      if (!ALLOWED_TARGET_STATUSES.has(accountStatus)) {
        return errorResponse(
          'INVALID_TARGET_STATUS',
          'Le statut cible doit être active, suspended ou disabled.',
          400,
          cors
        );
      }

      const patchPayload: Record<string, unknown> = {
        account_status: accountStatus,
        updated_at: new Date().toISOString(),
      };
      if (accountStatus !== 'active') {
        patchPayload.is_available = false;
      }

      const updated = await supabaseRest<DriverRecord[]>(
        env,
        `/rest/v1/express_drivers?id=eq.${encodeURIComponent(driverId)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patchPayload),
        }
      );

      if (!updated.ok) {
        return errorResponse('DRIVER_STATUS_UPDATE_FAILED', 'Mise à jour administrative impossible.', 500, cors);
      }
      if (!updated.data?.[0]) {
        return errorResponse('DRIVER_NOT_FOUND', 'Livreur introuvable.', 404, cors);
      }

      return jsonResponse(
        {
          ok: true,
          driver: updated.data[0],
          reviewedBy: verified.email,
        },
        200,
        cors
      );
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors de la validation livreur.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleAdminDriversRequest);
}
