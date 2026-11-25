/**
 * Synchronisation unidirectionnelle sécurisée : Supabase -> Firestore (miroir opérationnel)
 * + Dispatch FCM v1 (Firebase Cloud Messaging) côté backend uniquement.
 *
 * - Authentification Google Service Account via JWT RS256 signé en Web Crypto (`crypto.subtle`)
 * - Minimisation stricte des PII client envoyées vers Firestore
 * - Idempotence par syncKey + retry exponentiel borné (3 tentatives max)
 * - Ne bloque jamais la transaction officielle Supabase en cas d'échec Firestore/FCM :
 *   retourne un résultat structuré pour journalisation dans `express_sync_log` et réconciliation.
 */

export interface FirestoreMissionMirrorInput {
  missionId: string;
  orderId?: string;
  orderNumber: string;
  courierId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryZone: string;
  pickupName: string;
  pickupAddress: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  itemsSummary: Array<{ name: string; quantity: number; unit?: string }>;
  itemCount: number;
  paymentMode: 'cod' | 'prepaid';
  codAmount: number;
  estimatedFee: number;
  instructions: string;
  status: string;
  syncVersion: number;
  recipientName?: string | null;
  proofCode?: string | null;
  proofNote?: string | null;
  failureReason?: string | null;
  assignedAtIso?: string;
  updatedAtIso: string;
}

export interface SyncExecutionResult {
  synced: boolean;
  attempts: number;
  syncKey: string;
  errorMessage?: string;
}

export interface FirebaseServiceAccountConfig {
  projectId: string;
  databaseId: string;
  clientEmail: string;
  privateKeyPem: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getGoogleAccessToken(
  cfg: FirebaseServiceAccountConfig,
  scopes: string[],
  fetchImpl: typeof fetch
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  );
  const claimSet = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: cfg.clientEmail,
        scope: scopes.join(' '),
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(cfg.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claimSet}`)
  );

  const assertion = `${header}.${claimSet}.${toBase64Url(new Uint8Array(sig))}`;

  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GOOGLE_OAUTH_FAILED:${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('GOOGLE_OAUTH_NO_TOKEN');
  }
  return tokenJson.access_token;
}

/**
 * Construit le document Firestore minimal (aucune donnée financière interne,
 * aucun token de paiement Bictorys/Wave, aucun email client).
 */
export function buildMinimizedFirestoreMissionDocument(input: FirestoreMissionMirrorInput) {
  const assignedIso = input.assignedAtIso || input.updatedAtIso;
  const fields: Record<string, unknown> = {
    missionId: { stringValue: input.missionId },
    deliveryId: { stringValue: input.missionId },
    orderId: { stringValue: (input.orderId || input.orderNumber).slice(0, 64) },
    orderNumber: { stringValue: input.orderNumber },
    courierId: { stringValue: input.courierId },
    driverId: { stringValue: input.courierId },
    dataSource: { stringValue: 'supabase_sync' },
    customerName: { stringValue: input.customerName.slice(0, 100) },
    customerPhone: { stringValue: input.customerPhone.slice(0, 24) },
    deliveryAddress: { stringValue: input.deliveryAddress.slice(0, 240) },
    deliveryZone: { stringValue: input.deliveryZone.slice(0, 80) },
    pickupName: { stringValue: input.pickupName.slice(0, 120) },
    pickupAddress: { stringValue: input.pickupAddress.slice(0, 240) },
    itemCount: { integerValue: String(Math.max(1, input.itemCount)) },
    paymentMode: { stringValue: input.paymentMode },
    codAmount: { doubleValue: Number(input.codAmount) },
    estimatedFee: { doubleValue: Number(input.estimatedFee) },
    instructions: { stringValue: (input.instructions || '').slice(0, 400) },
    status: { stringValue: input.status },
    itemsSummary: {
      arrayValue: {
        values: input.itemsSummary.slice(0, 25).map((item) => ({
          mapValue: {
            fields: {
              name: { stringValue: item.name.slice(0, 120) },
              quantity: { integerValue: String(item.quantity) },
              ...(item.unit ? { unit: { stringValue: item.unit.slice(0, 30) } } : {}),
            },
          },
        })),
      },
    },
    events: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: {
                status: { stringValue: input.status },
                label: { stringValue: `Statut officiel : ${input.status}` },
                timestampIso: { stringValue: input.updatedAtIso },
                actor: { stringValue: 'system' },
              },
            },
          },
        ],
      },
    },
    assignedAt: { timestampValue: assignedIso },
    createdAt: { timestampValue: assignedIso },
    updatedAt: { timestampValue: input.updatedAtIso },
  };

  if (typeof input.gpsLat === 'number') fields.gpsLat = { doubleValue: input.gpsLat };
  if (typeof input.gpsLng === 'number') fields.gpsLng = { doubleValue: input.gpsLng };
  if (input.recipientName) fields.recipientName = { stringValue: input.recipientName.slice(0, 100) };
  if (input.proofCode) fields.proofCode = { stringValue: input.proofCode.slice(0, 32) };
  if (input.proofNote) fields.proofNote = { stringValue: input.proofNote.slice(0, 300) };
  if (input.failureReason) fields.failureReason = { stringValue: input.failureReason.slice(0, 240) };

  return { fields };
}

export function buildSyncKey(missionId: string, syncVersion: number, target: 'firestore' | 'fcm'): string {
  return `${target}:${missionId}:v${syncVersion}`;
}

export async function syncMissionToFirestoreWithRetry(
  mission: FirestoreMissionMirrorInput,
  cfg: FirebaseServiceAccountConfig | null,
  options: { fetchImpl?: typeof fetch; maxAttempts?: number; retryDelayMs?: number } = {}
): Promise<SyncExecutionResult> {
  const syncKey = buildSyncKey(mission.missionId, mission.syncVersion, 'firestore');
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 150;

  if (!cfg || !cfg.clientEmail || !cfg.privateKeyPem) {
    return {
      synced: false,
      attempts: 0,
      syncKey,
      errorMessage: 'FIREBASE_SERVICE_ACCOUNT_NOT_CONFIGURED',
    };
  }

  let lastError = 'UNKNOWN_SYNC_ERROR';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const accessToken = await getGoogleAccessToken(
        cfg,
        ['https://www.googleapis.com/auth/datastore'],
        fetchImpl
      );

      const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        cfg.projectId
      )}/databases/${encodeURIComponent(cfg.databaseId)}/documents/missions/${encodeURIComponent(
        mission.missionId
      )}`;

      const payload = buildMinimizedFirestoreMissionDocument(mission);
      const res = await fetchImpl(docUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return { synced: true, attempts: attempt, syncKey };
      }

      lastError = `FIRESTORE_HTTP_${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'FIRESTORE_NETWORK_ERROR';
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  return { synced: false, attempts: maxAttempts, syncKey, errorMessage: lastError };
}

export async function dispatchFcmNotificationSafe(
  params: {
    fcmToken: string | null | undefined;
    title: string;
    body: string;
    missionId: string;
    syncVersion: number;
  },
  cfg: FirebaseServiceAccountConfig | null,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<SyncExecutionResult> {
  const syncKey = buildSyncKey(params.missionId, params.syncVersion, 'fcm');
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!params.fcmToken) {
    return { synced: false, attempts: 0, syncKey, errorMessage: 'FCM_TOKEN_MISSING' };
  }
  if (!cfg || !cfg.clientEmail || !cfg.privateKeyPem) {
    return {
      synced: false,
      attempts: 0,
      syncKey,
      errorMessage: 'FIREBASE_SERVICE_ACCOUNT_NOT_CONFIGURED',
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(
      cfg,
      ['https://www.googleapis.com/auth/firebase.messaging'],
      fetchImpl
    );

    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/messages:send`;

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: params.fcmToken,
          notification: {
            title: params.title.slice(0, 120),
            body: params.body.slice(0, 400),
          },
          data: {
            missionId: params.missionId,
            syncVersion: String(params.syncVersion),
          },
        },
      }),
    });

    if (!res.ok) {
      return { synced: false, attempts: 1, syncKey, errorMessage: `FCM_HTTP_${res.status}` };
    }
    return { synced: true, attempts: 1, syncKey };
  } catch (err) {
    return {
      synced: false,
      attempts: 1,
      syncKey,
      errorMessage: err instanceof Error ? err.message : 'FCM_NETWORK_ERROR',
    };
  }
}
