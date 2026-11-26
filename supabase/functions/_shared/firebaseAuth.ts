/**
 * Validation cryptographique explicite du Firebase ID Token (RS256)
 * compatible Deno (Supabase Edge Functions) et Node 22+ (tests automatisés).
 *
 * Vérifie strictement :
 * - Signature cryptographique RS256 contre les clés JWKS officielles Google
 *   (avec cache respectant Cache-Control et rotation automatique si kid inconnu)
 * - Header alg === 'RS256' et kid présent
 * - Issuer === https://securetoken.google.com/<FIREBASE_PROJECT_ID>
 * - Audience === <FIREBASE_PROJECT_ID> (livraisonjikjikoox)
 * - Expiration (exp), émission (iat), auth_time
 * - Subject (sub) non vide = UID vérifié
 * - email_verified === true
 */

export const GOOGLE_FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export const DEFAULT_FIREBASE_PROJECT_ID = 'livraisonjikjikoox';

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  authTime: number;
  issuedAt: number;
  expiresAt: number;
}

export class FirebaseAuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 401) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface JwkKeyResolver {
  getKey(kid: string, forceRefresh: boolean): Promise<CryptoKey | null>;
}

interface GoogleJwk extends JsonWebKey {
  kid: string;
  alg?: string;
  use?: string;
}

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJsonSegment<T>(segment: string): T {
  try {
    const bytes = base64UrlToUint8Array(segment);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    throw new FirebaseAuthError('TOKEN_MALFORMED', 'Jeton d’authentification mal formé.');
  }
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 3600;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 60 ? Math.min(parsed, 21600) : 3600;
}

/**
 * Résolveur JWKS officiel Google avec mise en cache bornée et rotation automatique.
 */
export function createGoogleJwksResolver(
  fetchImpl?: typeof fetch,
  jwksUrl = GOOGLE_FIREBASE_JWKS_URL
): JwkKeyResolver {
  let cachedKeys = new Map<string, CryptoKey>();
  let cacheExpiresAtMs = 0;

  async function refreshKeys(): Promise<void> {
    const activeFetch = fetchImpl ?? globalThis.fetch;
    const response = await activeFetch(jwksUrl, { method: 'GET' });
    if (!response.ok) {
      throw new FirebaseAuthError(
        'JWKS_UNAVAILABLE',
        'Impossible de récupérer les clés publiques Firebase.',
        503
      );
    }

    const body = (await response.json()) as { keys?: GoogleJwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new FirebaseAuthError('JWKS_EMPTY', 'Clés publiques Firebase invalides.', 503);
    }

    const nextMap = new Map<string, CryptoKey>();
    for (const jwk of body.keys) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      nextMap.set(jwk.kid, key);
    }

    const maxAgeSec = parseMaxAgeSeconds(response.headers.get('cache-control'));
    cachedKeys = nextMap;
    cacheExpiresAtMs = Date.now() + maxAgeSec * 1000;
  }

  return {
    async getKey(kid: string, forceRefresh: boolean): Promise<CryptoKey | null> {
      const now = Date.now();
      if (forceRefresh || now >= cacheExpiresAtMs || cachedKeys.size === 0) {
        await refreshKeys();
      }
      const existing = cachedKeys.get(kid);
      if (existing) return existing;

      // Rotation de clé détectée : forcer un rafraîchissement unique si ce n'est pas déjà fait
      if (!forceRefresh) {
        await refreshKeys();
        return cachedKeys.get(kid) ?? null;
      }
      return null;
    },
  };
}

const defaultResolver = createGoogleJwksResolver();

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new FirebaseAuthError(
      'TOKEN_MISSING',
      'En-tête Authorization Bearer manquant.'
    );
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length > 8192) {
    throw new FirebaseAuthError('TOKEN_INVALID', 'Jeton Bearer invalide.');
  }
  return token;
}

export interface VerifyFirebaseTokenOptions {
  projectId?: string;
  resolver?: JwkKeyResolver;
  nowSeconds?: number;
  clockSkewSeconds?: number;
  requireVerifiedEmail?: boolean;
}

export async function verifyFirebaseIdToken(
  token: string,
  options: VerifyFirebaseTokenOptions = {}
): Promise<VerifiedFirebaseToken> {
  const projectId = options.projectId || DEFAULT_FIREBASE_PROJECT_ID;
  const resolver = options.resolver || defaultResolver;
  const nowSec = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 30;

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new FirebaseAuthError('TOKEN_MALFORMED', 'Format JWT invalide.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJsonSegment<{ alg?: string; kid?: string; typ?: string }>(headerB64);
  const payload = decodeJsonSegment<Record<string, unknown>>(payloadB64);

  if (header.alg !== 'RS256') {
    throw new FirebaseAuthError('TOKEN_ALG_INVALID', 'Algorithme JWT non autorisé.');
  }
  if (typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 128) {
    throw new FirebaseAuthError('TOKEN_KID_MISSING', 'Identifiant de clé (kid) manquant.');
  }

  // Validation des claims avant vérification crypto ou après : toujours vérifier la signature !
  const publicKey = await resolver.getKey(header.kid, false);
  if (!publicKey) {
    throw new FirebaseAuthError('TOKEN_KEY_UNKNOWN', 'Clé de signature Firebase inconnue.');
  }

  const signedBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(signatureB64);

  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes,
    signedBytes
  );

  if (!validSignature) {
    throw new FirebaseAuthError('TOKEN_SIGNATURE_INVALID', 'Signature cryptographique invalide.');
  }

  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIssuer) {
    throw new FirebaseAuthError('TOKEN_ISSUER_MISMATCH', 'Émetteur Firebase non autorisé.');
  }
  if (payload.aud !== projectId) {
    throw new FirebaseAuthError('TOKEN_AUDIENCE_MISMATCH', 'Projet Firebase non autorisé.');
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : 0;

  if (exp <= nowSec - skew) {
    throw new FirebaseAuthError('TOKEN_EXPIRED', 'Session expirée. Veuillez vous reconnecter.');
  }
  if (iat > nowSec + skew || authTime > nowSec + skew) {
    throw new FirebaseAuthError('TOKEN_FUTURE_TIMESTAMP', 'Horodatage du jeton incohérent.');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 128) {
    throw new FirebaseAuthError('TOKEN_SUBJECT_INVALID', 'Identifiant utilisateur (sub) invalide.');
  }

  const email = typeof payload.email === 'string' ? payload.email : '';
  const emailVerified = payload.email_verified === true;
  if (!email || (options.requireVerifiedEmail !== false && !emailVerified)) {
    throw new FirebaseAuthError(
      'EMAIL_NOT_VERIFIED',
      'Votre adresse email Google doit être vérifiée.',
      403
    );
  }

  return {
    uid: sub,
    email,
    emailVerified,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    authTime,
    issuedAt: iat,
    expiresAt: exp,
  };
}
