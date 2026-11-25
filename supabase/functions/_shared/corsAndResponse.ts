/**
 * Gestion CORS stricte (jamais de wildcard `*` sur des endpoints authentifiés)
 * et réponses JSON uniformisées sans fuite de détails techniques internes.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://livraison.jikjikoox.com',
  'https://admin.jikjikoox.com',
];

export function getAllowedOrigins(envAllowed?: string): string[] {
  const configured = (envAllowed ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('https://') || s.startsWith('http://localhost:'));
  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }
  return [...DEFAULT_ALLOWED_ORIGINS];
}

export function buildCorsHeaders(
  origin: string | null,
  envAllowed?: string
): Record<string, string> {
  const allowed = getAllowedOrigins(envAllowed);
  const matchedOrigin = origin && allowed.includes(origin) ? origin : allowed[0];

  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-idempotency-key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status, corsHeaders);
}
