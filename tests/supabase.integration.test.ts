/**
 * Suite de tests automatisés — Intégration JikJikoox Express <-> Supabase (20 scénarios)
 *
 * Exécute de vraies vérifications cryptographiques RS256 (Web Crypto API),
 * la validation métier autoritaire backend, la synchronisation Firestore/FCM résiliente,
 * la politique d'upload de preuves, la résilience réseau `expressApi` et l'isolation Démo.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FIREBASE_PROJECT_ID,
  FirebaseAuthError,
  verifyFirebaseIdToken,
  type JwkKeyResolver,
} from '../supabase/functions/_shared/firebaseAuth.ts';
import {
  assertAuthorizedActiveDriver,
  DriverAuthorizationError,
  type DriverRecord,
} from '../supabase/functions/_shared/supabaseAdmin.ts';
import {
  validateDeliveryAction,
  type DeliveryRecordForValidation,
} from '../supabase/functions/_shared/workflow.ts';
import {
  buildMinimizedFirestoreMissionDocument,
  dispatchFcmNotificationSafe,
  syncMissionToFirestoreWithRetry,
  type FirebaseServiceAccountConfig,
  type FirestoreMissionMirrorInput,
} from '../supabase/functions/_shared/firestoreSync.ts';
import {
  isSignedUrlExpired,
  SIGNED_UPLOAD_TTL_SECONDS,
  validateProofUploadMetadata,
} from '../supabase/functions/delivery-proof/index.ts';
import { createExpressApiClient, ExpressApiError } from '../src/services/expressApi.ts';
import { buildDemoMissions, DEMO_COURIER_PROFILE } from '../src/data/demo/mockCourierData.ts';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

async function runScenario(id: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ id, name, passed: true });
  } catch (err) {
    results.push({
      id,
      name,
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generateRsaFixture() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const b64Pkcs8 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64Pkcs8}\n-----END PRIVATE KEY-----`;

  const kid = 'test-firebase-kid-2026';
  const resolver: JwkKeyResolver = {
    async getKey(requestedKid: string): Promise<CryptoKey | null> {
      return requestedKid === kid ? keyPair.publicKey : null;
    },
  };

  async function signJwt(
    payloadOverrides: Record<string, unknown> = {},
    headerOverrides: Record<string, unknown> = {}
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid, ...headerOverrides };
    const payload = {
      iss: `https://securetoken.google.com/${DEFAULT_FIREBASE_PROJECT_ID}`,
      aud: DEFAULT_FIREBASE_PROJECT_ID,
      sub: 'uid_livreur_a',
      email: 'moussa.diallo@jikjikoox.sn',
      email_verified: true,
      auth_time: now - 120,
      iat: now - 60,
      exp: now + 3600,
      ...payloadOverrides,
    };

    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signingInput);
    const encodedSig = toBase64Url(new Uint8Array(sigBuffer));
    return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
  }

  return { keyPair, privateKeyPem, resolver, signJwt };
}

function makeDriver(overrides: Partial<DriverRecord> = {}): DriverRecord {
  return {
    id: 'drv-uuid-001',
    firebase_uid: 'uid_livreur_a',
    email: 'moussa.diallo@jikjikoox.sn',
    first_name: 'Moussa',
    last_name: 'Diallo',
    phone: '+221 77 123 45 67',
    photo_url: null,
    vehicle_type: 'moto',
    vehicle_plate: 'DK-4821-AJ',
    work_zone: 'Dakar Plateau',
    role: 'courier',
    account_status: 'active',
    is_available: true,
    notifications_enabled: true,
    push_sound_enabled: true,
    fcm_token: 'fcm-token-demo-001',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<DeliveryRecordForValidation> = {}): DeliveryRecordForValidation {
  return {
    id: 'deliv-uuid-1001',
    driverFirebaseUid: 'uid_livreur_a',
    status: 'ASSIGNED',
    paymentMode: 'cod',
    codAmount: 18500,
    ...overrides,
  };
}

function makeMirrorInput(): FirestoreMissionMirrorInput {
  return {
    missionId: 'deliv-uuid-1001',
    orderNumber: 'JKX-2026-9041',
    courierId: 'uid_livreur_a',
    customerName: 'Awa Ndiaye',
    customerPhone: '+221 77 888 12 34',
    deliveryAddress: 'Immeuble Kébé, Plateau',
    deliveryZone: 'Dakar Plateau',
    pickupName: 'Atelier Thiéboudienne Bio',
    pickupAddress: 'Rue Carnot, Dakar',
    itemsSummary: [{ name: 'Huile d’arachide artisanale', quantity: 2, unit: 'L' }],
    itemCount: 2,
    paymentMode: 'cod',
    codAmount: 18500,
    estimatedFee: 2000,
    instructions: 'Appeler à la barrière',
    status: 'ACCEPTED',
    syncVersion: 2,
    updatedAtIso: new Date().toISOString(),
  };
}

async function main() {
  const rsa = await generateRsaFixture();
  const serviceAccount: FirebaseServiceAccountConfig = {
    projectId: DEFAULT_FIREBASE_PROJECT_ID,
    databaseId: 'ai-studio-eb90a3f1-6fee-48a3-8c68-e411d0bf546d',
    clientEmail: 'express-sync@livraisonjikjikoox.iam.gserviceaccount.com',
    privateKeyPem: rsa.privateKeyPem,
  };

  // 1. Token Firebase valide (RS256)
  await runScenario('T01', 'Token Firebase RS256 valide accepté avec UID vérifié', async () => {
    const token = await rsa.signJwt();
    const verified = await verifyFirebaseIdToken(token, {
      projectId: DEFAULT_FIREBASE_PROJECT_ID,
      resolver: rsa.resolver,
    });
    assert.equal(verified.uid, 'uid_livreur_a');
    assert.equal(verified.emailVerified, true);
  });

  // 2. Token expiré
  await runScenario('T02', 'Token Firebase expiré refusé (TOKEN_EXPIRED)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await rsa.signJwt({ iat: now - 7200, exp: now - 3600 });
    await assert.rejects(
      () =>
        verifyFirebaseIdToken(expiredToken, {
          projectId: DEFAULT_FIREBASE_PROJECT_ID,
          resolver: rsa.resolver,
        }),
      (err: unknown) => err instanceof FirebaseAuthError && err.code === 'TOKEN_EXPIRED'
    );
  });

  // 3. Token invalide / signature altérée
  await runScenario('T03', 'Token avec signature altérée refusé (TOKEN_SIGNATURE_INVALID)', async () => {
    const token = await rsa.signJwt();
    const parts = token.split('.');
    const tamperedPayload = toBase64Url(
      JSON.stringify({
        iss: `https://securetoken.google.com/${DEFAULT_FIREBASE_PROJECT_ID}`,
        aud: DEFAULT_FIREBASE_PROJECT_ID,
        sub: 'uid_attaquant',
        email: 'attacker@evil.test',
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000) - 10,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    await assert.rejects(
      () =>
        verifyFirebaseIdToken(forgedToken, {
          projectId: DEFAULT_FIREBASE_PROJECT_ID,
          resolver: rsa.resolver,
        }),
      (err: unknown) => err instanceof FirebaseAuthError && err.code === 'TOKEN_SIGNATURE_INVALID'
    );
  });

  // 4. Token d'un autre projet Firebase
  await runScenario('T04', 'Token issu d’un autre projet Firebase refusé (TOKEN_ISSUER_MISMATCH)', async () => {
    const wrongProjectToken = await rsa.signJwt({
      iss: 'https://securetoken.google.com/autre-projet-malveillant',
      aud: 'autre-projet-malveillant',
    });
    await assert.rejects(
      () =>
        verifyFirebaseIdToken(wrongProjectToken, {
          projectId: DEFAULT_FIREBASE_PROJECT_ID,
          resolver: rsa.resolver,
        }),
      (err: unknown) => err instanceof FirebaseAuthError && err.code === 'TOKEN_ISSUER_MISMATCH'
    );
  });

  // 5. Livreur non autorisé / pending
  await runScenario('T05', 'Livreur en attente (pending) ou inconnu refusé (403)', () => {
    assert.throws(
      () => assertAuthorizedActiveDriver(makeDriver({ account_status: 'pending' })),
      (err: unknown) =>
        err instanceof DriverAuthorizationError && err.code === 'DRIVER_PENDING' && err.httpStatus === 403
    );
    assert.throws(
      () => assertAuthorizedActiveDriver(null),
      (err: unknown) =>
        err instanceof DriverAuthorizationError && err.code === 'DRIVER_NOT_REGISTERED'
    );
  });

  // 6. Livreur suspendu
  await runScenario('T06', 'Livreur suspendu refusé immédiatement (DRIVER_SUSPENDED)', () => {
    assert.throws(
      () => assertAuthorizedActiveDriver(makeDriver({ account_status: 'suspended' })),
      (err: unknown) =>
        err instanceof DriverAuthorizationError &&
        err.code === 'DRIVER_SUSPENDED' &&
        err.httpStatus === 403
    );
  });

  // 7. Livreur A accédant à une mission du livreur B
  await runScenario('T07', 'Livreur A bloqué sur la mission du livreur B (MISSION_FORBIDDEN)', () => {
    const outcome = validateDeliveryAction(
      { deliveryId: 'deliv-uuid-1001', nextStatus: 'ACCEPTED', idempotencyKey: 'key-1' },
      makeDelivery({ driverFirebaseUid: 'uid_livreur_b' }),
      'uid_livreur_a'
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'MISSION_FORBIDDEN');
    assert.equal(outcome.httpStatus, 403);
  });

  // 8. Mission inconnue (404 MISSION_NOT_FOUND)
  await runScenario('T08', 'Mission inconnue retournant 404 MISSION_NOT_FOUND côté service', async () => {
    const api = createExpressApiClient({
      baseUrl: 'https://staging.supabase.co/functions/v1',
      maxRetries: 0,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: 'MISSION_NOT_FOUND', message: 'Introuvable' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        ),
    });

    await assert.rejects(
      () =>
        api.submitDeliveryAction('valid-token', {
          deliveryId: 'unknown-mission',
          nextStatus: 'ACCEPTED',
        }),
      (err: unknown) => err instanceof ExpressApiError && err.code === 'MISSION_NOT_FOUND' && err.status === 404
    );
  });

  // 9. Transition interdite (ASSIGNED -> DELIVERED)
  await runScenario('T09', 'Transition interdite ASSIGNED -> DELIVERED refusée (INVALID_TRANSITION)', () => {
    const outcome = validateDeliveryAction(
      {
        deliveryId: 'deliv-uuid-1001',
        nextStatus: 'DELIVERED',
        idempotencyKey: 'key-shortcut',
        proof: { recipientName: 'Awa Ndiaye', codCollectedConfirmed: true },
      },
      makeDelivery({ status: 'ASSIGNED' }),
      'uid_livreur_a'
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'INVALID_TRANSITION');
    assert.equal(outcome.httpStatus, 422);
  });

  // 10. Double soumission avec idempotencyKey
  await runScenario('T10', 'Double soumission protégée par X-Idempotency-Key (rejeu sans doublon)', async () => {
    const seenKeys = new Set<string>();
    const api = createExpressApiClient({
      baseUrl: 'https://staging.supabase.co/functions/v1',
      fetchImpl: async (_url, init) => {
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        const key = hdrs['X-Idempotency-Key'];
        assert.ok(key, 'En-tête X-Idempotency-Key obligatoire');
        const replayed = seenKeys.has(key);
        seenKeys.add(key);
        return new Response(
          JSON.stringify({
            ok: true,
            idempotentReplay: replayed,
            delivery: { id: 'deliv-uuid-1001', status: 'ACCEPTED' },
            firestoreMirrorSynced: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const fixedKey = 'deliv-uuid-1001:ACCEPTED:fixed-nonce';
    const first = await api.submitDeliveryAction('tok', {
      deliveryId: 'deliv-uuid-1001',
      nextStatus: 'ACCEPTED',
      idempotencyKey: fixedKey,
    });
    const second = await api.submitDeliveryAction('tok', {
      deliveryId: 'deliv-uuid-1001',
      nextStatus: 'ACCEPTED',
      idempotencyKey: fixedKey,
    });

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(seenKeys.size, 1);
  });

  // 11. Échec de synchronisation Firestore (retries bornés, non bloquant)
  await runScenario('T11', 'Échec Firestore : 3 retries bornés + retour non bloquant + PII minimisées', async () => {
    let firestoreCalls = 0;
    const mirrorInput = makeMirrorInput();
    const minimized = buildMinimizedFirestoreMissionDocument(mirrorInput);
    assert.equal('commission' in minimized.fields, false);
    assert.equal('customerEmail' in minimized.fields, false);
    assert.equal('paymentToken' in minimized.fields, false);

    const res = await syncMissionToFirestoreWithRetry(mirrorInput, serviceAccount, {
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return new Response(JSON.stringify({ access_token: 'mock-sa-token' }), { status: 200 });
        }
        firestoreCalls += 1;
        return new Response('Service Unavailable', { status: 503 });
      },
    });

    assert.equal(res.synced, false);
    assert.equal(res.attempts, 3);
    assert.equal(firestoreCalls, 3);
    assert.equal(res.errorMessage, 'FIRESTORE_HTTP_503');
  });

  // 12. Échec d'envoi de notification FCM
  await runScenario('T12', 'Échec FCM géré sans exception ni blocage du workflow', async () => {
    const res = await dispatchFcmNotificationSafe(
      {
        fcmToken: 'fcm-token-demo-001',
        title: 'Nouvelle mission',
        body: 'Course JKX-2026-9041 assignée.',
        missionId: 'deliv-uuid-1001',
        syncVersion: 2,
      },
      serviceAccount,
      {
        fetchImpl: async (url) => {
          if (String(url).includes('oauth2.googleapis.com')) {
            return new Response(JSON.stringify({ access_token: 'mock-sa-token' }), { status: 200 });
          }
          return new Response('FCM error', { status: 500 });
        },
      }
    );

    assert.equal(res.synced, false);
    assert.equal(res.errorMessage, 'FCM_HTTP_500');
  });

  // 13. Upload de preuve non autorisé (MIME interdit, > 5 Mo, nom manquant)
  await runScenario('T13', 'Preuve non autorisée refusée (MIME exécutable, > 5 Mo, réceptionnaire vide)', () => {
    const badMime = validateProofUploadMetadata({
      recipientName: 'Awa Ndiaye',
      mimeType: 'application/x-msdownload',
      fileSizeBytes: 1024,
    });
    assert.equal(badMime.ok, false);
    assert.equal(badMime.code, 'UNSUPPORTED_MEDIA_TYPE');

    const tooLarge = validateProofUploadMetadata({
      recipientName: 'Awa Ndiaye',
      mimeType: 'image/jpeg',
      fileSizeBytes: 6 * 1024 * 1024,
    });
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.code, 'FILE_TOO_LARGE');

    const missingRecipient = validateProofUploadMetadata({
      recipientName: 'A',
      mimeType: 'image/png',
      fileSizeBytes: 250_000,
    });
    assert.equal(missingRecipient.ok, false);
    assert.equal(missingRecipient.code, 'RECIPIENT_REQUIRED');

    const valid = validateProofUploadMetadata({
      recipientName: 'Awa Ndiaye',
      mimeType: 'image/webp',
      fileSizeBytes: 420_000,
    });
    assert.equal(valid.ok, true);
    assert.equal(valid.ext, 'webp');
  });

  // 14. URL signée expirée (TTL <= 120s strictement contrôlé)
  await runScenario('T14', 'URL signée de preuve bornée à 120s et expirée détectée', () => {
    assert.ok(SIGNED_UPLOAD_TTL_SECONDS <= 120);
    const now = Date.now();
    const validIso = new Date(now + 60_000).toISOString();
    const expiredIso = new Date(now - 1_000).toISOString();
    assert.equal(isSignedUrlExpired(validIso, now), false);
    assert.equal(isSignedUrlExpired(expiredIso, now), true);
    assert.equal(isSignedUrlExpired('not-a-date', now), true);
  });

  // 15. Isolation complète du mode démonstration
  await runScenario('T15', 'Mode démonstration isolé : 0 import Supabase/Firebase et 0 appel réseau', () => {
    const demoSource = fs.readFileSync(
      path.join(process.cwd(), 'src/data/demo/mockCourierData.ts'),
      'utf8'
    );
    assert.doesNotMatch(demoSource, /supabase|firebase|expressApi|fetch\(/i);
    const missions = buildDemoMissions(DEMO_COURIER_PROFILE.uid);
    assert.ok(missions.length > 0);
    assert.ok(missions.every((m) => m.dataSource === 'local_demo'));
  });

  // 16. Backend indisponible (erreur réseau)
  await runScenario('T16', 'Backend indisponible : erreur explicite NETWORK_UNREACHABLE', async () => {
    const api = createExpressApiClient({
      baseUrl: 'https://staging.supabase.co/functions/v1',
      maxRetries: 1,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await assert.rejects(
      () => api.fetchDriverDeliveries('valid-token'),
      (err: unknown) => err instanceof ExpressApiError && err.code === 'NETWORK_UNREACHABLE'
    );
  });

  // 17. Réseau mobile instable (retry sur 503 puis succès + timeout géré)
  await runScenario('T17', 'Réseau instable : retry automatique sur 503 réussi + gestion timeout', async () => {
    let calls = 0;
    const flakyApi = createExpressApiClient({
      baseUrl: 'https://staging.supabase.co/functions/v1',
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ ok: false }), { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true, deliveries: [] }), { status: 200 });
      },
    });

    const data = await flakyApi.fetchDriverDeliveries('valid-token');
    assert.equal(data.ok, true);
    assert.equal(calls, 2);

    const slowApi = createExpressApiClient({
      baseUrl: 'https://staging.supabase.co/functions/v1',
      timeoutMs: 25,
      maxRetries: 0,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('Aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }),
    });

    await assert.rejects(
      () => slowApi.fetchDriverDeliveries('valid-token'),
      (err: unknown) => err instanceof ExpressApiError && err.code === 'REQUEST_TIMEOUT'
    );
  });

  // 18. Commande annulée pendant la course
  await runScenario('T18', 'Commande annulée en cours de route : transition bloquée (409 MISSION_LOCKED)', () => {
    const outcome = validateDeliveryAction(
      { deliveryId: 'deliv-uuid-1001', nextStatus: 'ARRIVED', idempotencyKey: 'key-cancel' },
      makeDelivery({ status: 'CANCELLED' }),
      'uid_livreur_a'
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'MISSION_LOCKED');
    assert.equal(outcome.httpStatus, 409);
  });

  // 19. Mission réaffectée à un autre livreur pendant la course
  await runScenario('T19', 'Mission réaffectée à un autre livreur : ancien livreur bloqué (403)', () => {
    const outcome = validateDeliveryAction(
      { deliveryId: 'deliv-uuid-1001', nextStatus: 'IN_TRANSIT', idempotencyKey: 'key-reassign' },
      makeDelivery({ status: 'PICKED_UP', driverFirebaseUid: 'uid_nouveau_livreur' }),
      'uid_livreur_a'
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'MISSION_FORBIDDEN');
    assert.equal(outcome.httpStatus, 403);
  });

  // 20. Tentative de modification des montants financiers
  await runScenario('T20', 'Tentative de falsification codAmount/estimatedFee refusée (FORBIDDEN_FIELDS)', () => {
    const outcome = validateDeliveryAction(
      {
        deliveryId: 'deliv-uuid-1001',
        nextStatus: 'ACCEPTED',
        idempotencyKey: 'key-tamper',
        codAmount: 0,
        estimatedFee: 50000,
      },
      makeDelivery({ status: 'ASSIGNED' }),
      'uid_livreur_a'
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'FORBIDDEN_FIELDS');
    assert.equal(outcome.httpStatus, 400);
  });

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  for (const r of results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`\nRésumé intégration Supabase : ${passedCount}/${results.length} PASS, ${failedCount} FAIL`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

void main();
