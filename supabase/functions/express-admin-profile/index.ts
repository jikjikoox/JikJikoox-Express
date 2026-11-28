/** Authentifie un administrateur Express et relit son rôle Supabase côté serveur. */
import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import { extractBearerToken, FirebaseAuthError, verifyFirebaseIdToken } from '../_shared/firebaseAuth.ts';
import {
  assertAuthorizedAdmin,
  DriverAuthorizationError,
  fetchActiveAdminByFirebaseUid,
  readDenoEnv,
} from '../_shared/supabaseAdmin.ts';

export async function handleExpressAdminProfileRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, {
      projectId: env.firebaseProjectId,
      requireVerifiedEmail: true,
    });
    const admin = assertAuthorizedAdmin(
      await fetchActiveAdminByFirebaseUid(env, verified.uid)
    );
    if (admin.email.toLowerCase() !== verified.email.toLowerCase()) {
      return errorResponse('ADMIN_IDENTITY_MISMATCH', 'Identité administrateur non concordante.', 403, cors);
    }
    return jsonResponse({
      ok: true,
      isAdmin: true,
      role: admin.role,
      email: admin.email,
      displayName: admin.display_name,
    }, 200, cors);
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Vérification du compte administrateur impossible.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) denoRuntime.serve(handleExpressAdminProfileRequest);
