/**
 * Suite de tests complète — JikJikoox Express (GPS temps réel, Photo preuve vérifiée, FCM Web Push)
 * Couvre les 11 exigences de test obligatoires sans toucher aux projets Firebase/Supabase de production.
 *
 * Exécution : `npx tsx tests/express.features.test.ts` ou `npm run test:features`
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { handleDriverLocationRequest, validateGpsPayload } from '../supabase/functions/driver-location/index.ts';
import { handleAdminDriverLocationsRequest } from '../supabase/functions/admin-driver-locations/index.ts';
import {
  handleDeliveryProofRequest,
  isConfinedStoragePath,
  isSignedUrlExpired,
  validateProofUploadMetadata,
} from '../supabase/functions/delivery-proof/index.ts';
import { handleDeliveryActionRequest } from '../supabase/functions/delivery-action/index.ts';
import { handleSyncAssignmentRequest } from '../supabase/functions/sync-assignment-to-firestore/index.ts';
import { handleDriverProfileRequest } from '../supabase/functions/driver-profile/index.ts';
import {
  buildGpsIdempotencyKey,
  GpsOfflineQueue,
  haversineDistanceMeters,
  isMissionTrackableStatus,
  shouldTransmitGpsFix,
} from '../src/lib/gpsTracker.ts';
import { detectPushSupportState } from '../src/lib/fcmPush.ts';
import { createExpressApiClient } from '../src/services/expressApi.ts';

const TEST_PROJECT_ID = 'jikjikoox-staging-test';
const TEST_SUPABASE_URL = 'https://staging-mock.supabase.co';
const TEST_INTERNAL_SECRET = 'staging-internal-sync-secret-test-12345';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
const TEST_KID = 'express-feat-kid-01';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signFirebaseToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: TEST_KID };
  const payload = {
    iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
    aud: TEST_PROJECT_ID,
    iat: now - 30,
    auth_time: now - 30,
    exp: now + 3600,
    email_verified: true,
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = cryptoSign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

// Configure mock Deno env for Edge Function handlers running under Node/tsx
function installMockEnv() {
  const envMap: Record<string, string> = {
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real',
    FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
    FIRESTORE_DATABASE_ID: '(default)',
    ALLOWED_ORIGINS: 'https://livraison.jikjikoox.com',
    INTERNAL_SYNC_SECRET: TEST_INTERNAL_SECRET,
  };
  (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno = {
    env: {
      get: (k: string) => envMap[k],
    },
  };
}

interface MockDbState {
  drivers: Record<string, Record<string, unknown>>;
  admins: Record<string, Record<string, unknown>>;
  deliveries: Record<string, Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  lastLocations: Record<string, Record<string, unknown>>;
  proofs: Array<Record<string, unknown>>;
  storageObjects: Set<string>;
  notifications: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  fcmCalls: number;
  forceFcmUnregistered: boolean;
}

function createInitialMockDb(): MockDbState {
  return {
    drivers: {
      'uid-courier-1': {
        id: 'drv-uuid-1',
        firebase_uid: 'uid-courier-1',
        email: 'mamadou@jikjikoox.sn',
        first_name: 'Mamadou',
        last_name: 'Diop',
        phone: '+221 77 412 89 30',
        vehicle_type: 'scooter',
        work_zone: 'Dakar Plateau',
        role: 'courier',
        account_status: 'active',
        is_available: true,
        notifications_enabled: true,
        push_sound_enabled: true,
        fcm_token: 'fcm_valid_token_courier_1_xxxxxxxxxxxxxxxxxxxx',
        fcm_token_invalidated_at: null,
      },
      'uid-courier-2': {
        id: 'drv-uuid-2',
        firebase_uid: 'uid-courier-2',
        email: 'cheikh@jikjikoox.sn',
        first_name: 'Cheikh',
        last_name: 'Sy',
        phone: '+221 77 620 14 08',
        vehicle_type: 'moto',
        work_zone: 'Almadies',
        role: 'courier',
        account_status: 'active',
        is_available: true,
        notifications_enabled: true,
        push_sound_enabled: true,
        fcm_token: 'fcm_valid_token_courier_2_xxxxxxxxxxxxxxxxxxxx',
        fcm_token_invalidated_at: null,
      },
      'uid-suspended': {
        id: 'drv-uuid-3',
        firebase_uid: 'uid-suspended',
        email: 'suspendu@jikjikoox.sn',
        first_name: 'Ibrahima',
        last_name: 'Ndiaye',
        phone: '+221 77 111 22 33',
        vehicle_type: 'moto',
        work_zone: 'Mermoz',
        role: 'courier',
        account_status: 'suspended',
        is_available: false,
        notifications_enabled: true,
        push_sound_enabled: true,
        fcm_token: null,
      },
    },
    admins: {
      'uid-admin-1': {
        firebase_uid: 'uid-admin-1',
        email: 'admin@jikjikoox.sn',
        display_name: 'Superviseur Dakar',
        is_active: true,
      },
    },
    deliveries: {
      'del-active-transit': {
        id: 'del-active-transit',
        mission_code: 'MIS-001',
        order_id: 'ord-001',
        order_number: 'JKX-2026-9001',
        driver_id: 'drv-uuid-1',
        driver_firebase_uid: 'uid-courier-1',
        customer_name: 'Aïssatou Ndiaye',
        customer_phone: '+221 77 500 11 22',
        delivery_address: 'Avenue Senghor, Plateau',
        delivery_zone: 'Dakar Plateau',
        pickup_name: 'Marché Kermel',
        pickup_address: 'Rue de Thiong',
        gps_lat: 14.6696,
        gps_lng: -17.4381,
        items_summary: [{ name: 'Colis Express', quantity: 1 }],
        item_count: 1,
        payment_mode: 'prepaid',
        cod_amount: 0,
        estimated_fee: 2000,
        instructions: 'Appeler en arrivant',
        status: 'IN_TRANSIT',
        sync_version: 2,
        updated_at: new Date().toISOString(),
      },
      'del-arrived-proof': {
        id: 'del-arrived-proof',
        mission_code: 'MIS-002',
        order_id: 'ord-002',
        order_number: 'JKX-2026-9002',
        driver_id: 'drv-uuid-1',
        driver_firebase_uid: 'uid-courier-1',
        customer_name: 'Fatou Sall',
        customer_phone: '+221 77 888 99 00',
        delivery_address: 'Route des Almadies',
        delivery_zone: 'Almadies',
        pickup_name: 'Point Relais Point E',
        pickup_address: 'Avenue Cheikh Anta Diop',
        gps_lat: 14.7453,
        gps_lng: -17.5138,
        items_summary: [{ name: 'Chaussures', quantity: 1 }],
        item_count: 1,
        payment_mode: 'cod',
        cod_amount: 15000,
        estimated_fee: 2500,
        instructions: 'Remise en main propre',
        status: 'ARRIVED',
        sync_version: 4,
        updated_at: new Date().toISOString(),
      },
      'del-completed': {
        id: 'del-completed',
        mission_code: 'MIS-003',
        order_id: 'ord-003',
        order_number: 'JKX-2026-9003',
        driver_id: 'drv-uuid-1',
        driver_firebase_uid: 'uid-courier-1',
        customer_name: 'Modou Fall',
        customer_phone: '+221 77 222 33 44',
        delivery_address: 'Mermoz',
        delivery_zone: 'Mermoz',
        pickup_name: 'Entrepôt Liberté 6',
        pickup_address: 'Liberté 6',
        gps_lat: 14.7064,
        gps_lng: -17.4709,
        items_summary: [],
        item_count: 1,
        payment_mode: 'prepaid',
        cod_amount: 0,
        estimated_fee: 1500,
        instructions: '',
        status: 'DELIVERED',
        sync_version: 5,
        updated_at: new Date().toISOString(),
      },
    },
    locations: [],
    lastLocations: {},
    proofs: [],
    storageObjects: new Set(),
    notifications: [],
    events: [],
    fcmCalls: 0,
    forceFcmUnregistered: false,
  };
}

function installMockFetch(db: MockDbState) {
  const mockFetch: typeof fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const url = new URL(urlStr);

    // 1. Google JWKS endpoint for RS256 Firebase token verification
    if (url.hostname === 'www.googleapis.com' && url.pathname.includes('jwk')) {
      return new Response(
        JSON.stringify({ keys: [{ ...testJwk, kid: TEST_KID, alg: 'RS256', use: 'sig' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' } }
      );
    }

    // 2. Mock OAuth token for FCM / Firestore
    if (url.hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({ access_token: 'mock-google-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Mock FCM v1 send endpoint
    if (url.hostname === 'fcm.googleapis.com') {
      db.fcmCalls += 1;
      if (db.forceFcmUnregistered) {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: 'Requested entity was not found.',
              status: 'NOT_FOUND',
              details: [{ errorCode: 'UNREGISTERED' }],
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ name: 'projects/test/messages/msg-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Mock Firestore REST mirror write
    if (url.hostname === 'firestore.googleapis.com') {
      return new Response(JSON.stringify({ name: 'projects/test/documents/missions/mock' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Mock Supabase Storage signed URL creation, PUT upload, and HEAD verification
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/delivery-proofs/')) {
      const storagePath = decodeURIComponent(
        url.pathname.replace('/storage/v1/object/upload/sign/delivery-proofs/', '')
      );
      return new Response(
        JSON.stringify({
          url: `/object/upload/signed-direct/delivery-proofs/${storagePath}?token=mock-signed-token`,
          token: 'mock-signed-token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname.startsWith('/storage/v1/object/upload/signed-direct/delivery-proofs/') && method === 'PUT') {
      const storagePath = decodeURIComponent(
        url.pathname.replace('/storage/v1/object/upload/signed-direct/delivery-proofs/', '')
      );
      db.storageObjects.add(storagePath);
      return new Response(JSON.stringify({ Key: storagePath }), { status: 200 });
    }

    if (url.pathname.startsWith('/storage/v1/object/delivery-proofs/') && method === 'HEAD') {
      const storagePath = decodeURIComponent(
        url.pathname.replace('/storage/v1/object/delivery-proofs/', '')
      );
      if (db.storageObjects.has(storagePath)) {
        return new Response(null, { status: 200, headers: { 'content-length': '20480' } });
      }
      return new Response(null, { status: 404 });
    }

    // 6. Mock Supabase PostgREST tables & RPC
    const bodyObj =
      typeof init?.body === 'string' && init.body.length > 0
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;

    if (url.pathname === '/rest/v1/express_drivers') {
      if (method === 'GET') {
        const uidFilter = url.searchParams.get('firebase_uid');
        const idFilter = url.searchParams.get('id');
        const statusFilter = url.searchParams.get('account_status');
        let rows = Object.values(db.drivers);
        if (uidFilter?.startsWith('eq.')) {
          rows = rows.filter((r) => r.firebase_uid === uidFilter.slice(3));
        }
        if (idFilter?.startsWith('eq.')) {
          rows = rows.filter((r) => r.id === idFilter.slice(3));
        }
        if (statusFilter?.startsWith('eq.')) {
          rows = rows.filter((r) => r.account_status === statusFilter.slice(3));
        }
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === 'PATCH' && bodyObj) {
        const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '');
        const found = Object.values(db.drivers).find((d) => d.id === idFilter);
        if (found) {
          Object.assign(found, bodyObj);
          return new Response(JSON.stringify([found]), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
    }

    if (url.pathname === '/rest/v1/express_admins' && method === 'GET') {
      const uidFilter = url.searchParams.get('firebase_uid')?.replace(/^eq\./, '');
      const adm = uidFilter ? db.admins[uidFilter] : undefined;
      return new Response(JSON.stringify(adm ? [adm] : []), { status: 200 });
    }

    if (url.pathname === '/rest/v1/express_deliveries' && method === 'GET') {
      const idFilter = url.searchParams.get('id')?.replace(/^eq\./, '');
      const statusIn = url.searchParams.get('status');
      let rows = Object.values(db.deliveries);
      if (idFilter) rows = rows.filter((d) => d.id === idFilter);
      if (statusIn?.startsWith('in.(')) {
        const allowed = new Set(statusIn.slice(4, -1).split(','));
        rows = rows.filter((d) => allowed.has(String(d.status)));
      }
      return new Response(JSON.stringify(rows), { status: 200 });
    }

    if (url.pathname === '/rest/v1/express_driver_locations') {
      if (method === 'GET') {
        const idem = url.searchParams.get('idempotency_key')?.replace(/^eq\./, '');
        const rows = idem ? db.locations.filter((l) => l.idempotency_key === idem) : db.locations;
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === 'POST' && bodyObj) {
        const row = { id: `loc-${db.locations.length + 1}`, ...bodyObj };
        db.locations.push(row);
        return new Response(JSON.stringify([row]), { status: 201 });
      }
    }

    if (url.pathname === '/rest/v1/express_driver_last_locations') {
      if (method === 'GET') {
        const driverId = url.searchParams.get('driver_id')?.replace(/^eq\./, '');
        const rows = driverId
          ? db.lastLocations[driverId]
            ? [db.lastLocations[driverId]]
            : []
          : Object.values(db.lastLocations);
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === 'POST' && bodyObj) {
        db.lastLocations[String(bodyObj.driver_id)] = { ...bodyObj };
        return new Response(JSON.stringify([bodyObj]), { status: 201 });
      }
    }

    if (url.pathname === '/rest/v1/express_delivery_proofs' && method === 'POST' && bodyObj) {
      const row = { created_at: new Date().toISOString(), ...bodyObj };
      db.proofs.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }

    if (url.pathname === '/rest/v1/express_delivery_events' && method === 'GET') {
      const idem = url.searchParams.get('idempotency_key')?.replace(/^eq\./, '');
      const delId = url.searchParams.get('delivery_id')?.replace(/^eq\./, '');
      const rows = db.events.filter(
        (e) => (!idem || e.idempotency_key === idem) && (!delId || e.delivery_id === delId)
      );
      return new Response(JSON.stringify(rows), { status: 200 });
    }

    if (url.pathname === '/rest/v1/rpc/express_apply_delivery_transition' && method === 'POST' && bodyObj) {
      const del = db.deliveries[String(bodyObj.p_delivery_id)];
      if (!del) return new Response('MISSION_NOT_FOUND', { status: 404 });
      const evId = `ev-${db.events.length + 1}`;
      del.status = bodyObj.p_next_status;
      del.sync_version = Number(del.sync_version || 1) + 1;
      del.updated_at = new Date().toISOString();
      db.events.push({
        id: evId,
        delivery_id: del.id,
        idempotency_key: bodyObj.p_idempotency_key,
        next_status: bodyObj.p_next_status,
        proof_id: bodyObj.p_proof_id ?? null,
      });
      // Reuses existing verified proof if p_proof_id was supplied (no duplicate proof row!)
      if (bodyObj.p_next_status === 'DELIVERED' && !bodyObj.p_proof_id) {
        db.proofs.push({
          id: `auto-proof-${db.proofs.length + 1}`,
          delivery_id: del.id,
          recipient_name: bodyObj.p_recipient_name,
          upload_verified: false,
        });
      }
      return new Response(
        JSON.stringify({
          idempotent_replay: false,
          event_id: evId,
          delivery_id: del.id,
          status: del.status,
          sync_version: del.sync_version,
          updated_at: del.updated_at,
        }),
        { status: 200 }
      );
    }

    if (url.pathname === '/rest/v1/express_sync_log' && method === 'POST') {
      return new Response(JSON.stringify([{ ok: true }]), { status: 201 });
    }

    if (url.pathname === '/rest/v1/express_notifications') {
      if (method === 'GET') {
        const dedupeKey = url.searchParams.get('dedupe_key')?.replace(/^eq\./, '');
        const rows = dedupeKey
          ? db.notifications.filter((n) => n.dedupe_key === dedupeKey)
          : db.notifications;
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === 'POST' && bodyObj) {
        const row = { id: `ntf-${db.notifications.length + 1}`, ...bodyObj };
        db.notifications.push(row);
        return new Response(JSON.stringify([row]), { status: 201 });
      }
    }

    return new Response(JSON.stringify({ error: `Unhandled mock URL: ${method} ${urlStr}` }), {
      status: 500,
    });
  };

  globalThis.fetch = mockFetch;
  return mockFetch;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.stack || err.message : String(err)}`);
  }
}

async function runAll() {
  console.log('\n=== Tests Fonctionnalités JikJikoox Express (GPS, Photo Preuve, FCM Push) ===\n');
  installMockEnv();

  const tokenCourier1 = signFirebaseToken({ sub: 'uid-courier-1', email: 'mamadou@jikjikoox.sn' });
  const tokenCourier2 = signFirebaseToken({ sub: 'uid-courier-2', email: 'cheikh@jikjikoox.sn' });
  const tokenSuspended = signFirebaseToken({ sub: 'uid-suspended', email: 'suspendu@jikjikoox.sn' });
  const tokenAdmin = signFirebaseToken({ sub: 'uid-admin-1', email: 'admin@jikjikoox.sn' });
  const tokenExpired = signFirebaseToken({
    sub: 'uid-courier-1',
    email: 'mamadou@jikjikoox.sn',
    exp: Math.floor(Date.now() / 1000) - 60,
  });

  // 1. Authentification livreur
  await test('1. Auth livreur : rejette un jeton absent (401) ou expiré (401)', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);

    const resNoAuth = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', { method: 'POST', body: '{}' })
    );
    assert.equal(resNoAuth.status, 401);

    const resExpired = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenExpired}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: 'del-active-transit', lat: 14.67, lng: -17.44 }),
      })
    );
    assert.equal(resExpired.status, 401);
  });

  // 2. Refus livreur suspendu
  await test('2. Refus livreur suspendu : bloque GPS et preuve photo avec 403 DRIVER_SUSPENDED', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);

    const resGps = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSuspended}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: 'del-active-transit', lat: 14.67, lng: -17.44 }),
      })
    );
    assert.equal(resGps.status, 403);
    const bodyGps = (await resGps.json()) as { error: { code: string } };
    assert.equal(bodyGps.error.code, 'DRIVER_SUSPENDED');

    const resProof = await handleDeliveryProofRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSuspended}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare-upload',
          deliveryId: 'del-arrived-proof',
          recipientName: 'Fatou Sall',
          mimeType: 'image/jpeg',
          fileSizeBytes: 50_000,
        }),
      })
    );
    assert.equal(resProof.status, 403);
  });

  // 3. Refus accès/modification d'une mission d'un autre livreur
  await test('3. Isolation inter-livreurs : livreur 2 bloqué (403) sur GPS et preuve de la mission du livreur 1', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);

    const resGps = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: 'del-active-transit', lat: 14.67, lng: -17.44 }),
      })
    );
    assert.equal(resGps.status, 403);

    const resProof = await handleDeliveryProofRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare-upload',
          deliveryId: 'del-arrived-proof',
          recipientName: 'Fatou Sall',
          mimeType: 'image/jpeg',
          fileSizeBytes: 50_000,
        }),
      })
    );
    assert.equal(resProof.status, 403);
  });

  // 4. Enregistrement de positions GPS + validation
  await test('4. GPS temps réel : enregistre position valide, refuse hors plage, usurpation et mission clôturée', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);

    assert.equal(validateGpsPayload({ deliveryId: 'del-active-transit', lat: 95, lng: -17.44 }).ok, false);
    assert.equal(
      validateGpsPayload({ deliveryId: 'del-active-transit', lat: 14.67, lng: -17.44, accuracyMeters: 15 }).ok,
      true
    );

    // Enregistrement valide sur mission IN_TRANSIT
    const resOk = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCourier1}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': 'gps_test_1',
        },
        body: JSON.stringify({
          deliveryId: 'del-active-transit',
          lat: 14.6698,
          lng: -17.4385,
          accuracyMeters: 12,
          speedMps: 6.4,
          headingDeg: 110,
          recordedAtIso: new Date().toISOString(),
        }),
      })
    );
    assert.equal(resOk.status, 201);
    assert.equal(db.locations.length, 1);
    assert.ok(db.lastLocations['drv-uuid-1']);

    // Rejet sur usurpation de driver_id
    const resSpoof = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: 'del-active-transit',
          driver_id: 'drv-uuid-2',
          lat: 14.67,
          lng: -17.44,
        }),
      })
    );
    assert.equal(resSpoof.status, 403);

    // Rejet sur mission déjà DELIVERED
    const resClosed = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: 'del-completed',
          lat: 14.7064,
          lng: -17.4709,
        }),
      })
    );
    assert.equal(resClosed.status, 409);
  });

  // 5. Protection des données GPS (Admin uniquement)
  await test('5. Carte Admin GPS : refuse un livreur normal (403) et autorise un admin actif (200)', async () => {
    const db = createInitialMockDb();
    db.lastLocations['drv-uuid-1'] = {
      driver_id: 'drv-uuid-1',
      driver_firebase_uid: 'uid-courier-1',
      delivery_id: 'del-active-transit',
      latitude: 14.6698,
      longitude: -17.4385,
      accuracy_meters: 12,
      speed_mps: 6.4,
      heading: 110,
      recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    installMockFetch(db);

    const resCourier = await handleAdminDriverLocationsRequest(
      new Request('https://staging.supabase.co/functions/v1/admin-driver-locations', {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenCourier1}` },
      })
    );
    assert.equal(resCourier.status, 403);

    const resAdmin = await handleAdminDriverLocationsRequest(
      new Request('https://staging.supabase.co/functions/v1/admin-driver-locations', {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      })
    );
    assert.equal(resAdmin.status, 200);
    const fleet = (await resAdmin.json()) as {
      ok: true;
      activeCount: number;
      drivers: Array<{ driverName: string; orderNumber: string; lat: number }>;
    };
    assert.equal(fleet.activeCount, 1);
    assert.equal(fleet.drivers[0].driverName, 'Mamadou Diop');
    assert.equal(fleet.drivers[0].orderNumber, 'JKX-2026-9001');
  });

  // 6. Upload réel simulé d'une photo de preuve + refus si upload absent + confinement de chemin
  await test('6. Photo preuve en 2 phases : prepare-upload (0 écriture DB) -> PUT Storage -> confirm-proof (HEAD vérifié)', async () => {
    const db = createInitialMockDb();
    const mockFetch = installMockFetch(db);

    // Vérification confinement chemin Storage
    assert.equal(isConfinedStoragePath('uid-courier-1/del-arrived-proof/abc-123.jpg', 'uid-courier-1', 'del-arrived-proof'), true);
    assert.equal(isConfinedStoragePath('../uid-courier-2/del-arrived-proof/abc.jpg', 'uid-courier-1', 'del-arrived-proof'), false);
    assert.equal(isConfinedStoragePath('uid-courier-2/del-arrived-proof/abc.jpg', 'uid-courier-1', 'del-arrived-proof'), false);

    // Phase 1 : prepare-upload
    const prepRes = await handleDeliveryProofRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare-upload',
          deliveryId: 'del-arrived-proof',
          recipientName: 'Fatou Sall',
          mimeType: 'image/jpeg',
          fileSizeBytes: 20_480,
          codCollectedConfirmed: true,
        }),
      })
    );
    assert.equal(prepRes.status, 200);
    const prepData = (await prepRes.json()) as {
      ok: true;
      phase: string;
      proofId: string;
      storagePath: string;
      signedUploadUrl: string;
      expiresAtIso: string;
    };
    assert.equal(prepData.phase, 'upload_prepared');
    assert.equal(db.proofs.length, 0, 'Aucune ligne DB ne doit être créée avant confirmation de l’upload Storage');
    assert.equal(isSignedUrlExpired(prepData.expiresAtIso), false);

    // Tentative de confirmation AVANT upload réel -> doit échouer avec 409 STORAGE_UPLOAD_NOT_VERIFIED
    const prematureConfirm = await handleDeliveryProofRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm-proof',
          deliveryId: 'del-arrived-proof',
          proofId: prepData.proofId,
          storagePath: prepData.storagePath,
          recipientName: 'Fatou Sall',
          mimeType: 'image/jpeg',
          fileSizeBytes: 20_480,
          codCollectedConfirmed: true,
        }),
      })
    );
    assert.equal(prematureConfirm.status, 409);
    assert.equal(db.proofs.length, 0);

    // Phase 2 : PUT réel vers l'URL signée via expressApi
    const apiClient = createExpressApiClient({
      baseUrl: `${TEST_SUPABASE_URL}/functions/v1`,
      fetchImpl: mockFetch,
    });
    const fakeJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    await apiClient.uploadPhotoToSignedUrl(prepData.signedUploadUrl, fakeJpeg, 'image/jpeg');

    // Phase 3 : confirm-proof après upload vérifié -> 201 + upload_verified = true
    const confirmRes = await handleDeliveryProofRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm-proof',
          deliveryId: 'del-arrived-proof',
          proofId: prepData.proofId,
          storagePath: prepData.storagePath,
          recipientName: 'Fatou Sall',
          mimeType: 'image/jpeg',
          fileSizeBytes: 20_480,
          codCollectedConfirmed: true,
          gpsLat: 14.7453,
          gpsLng: -17.5138,
        }),
      })
    );
    assert.equal(confirmRes.status, 201);
    const confirmData = (await confirmRes.json()) as {
      ok: true;
      phase: string;
      proofId: string;
      uploadVerified: boolean;
    };
    assert.equal(confirmData.uploadVerified, true);
    assert.equal(db.proofs.length, 1);
    assert.equal(db.proofs[0].upload_verified, true);
  });

  // 7. Validation métadonnées preuve de livraison
  await test('7. Validation preuve : rejette MIME non image, fichier > 5 Mo et réceptionnaire vide', () => {
    assert.equal(
      validateProofUploadMetadata({ recipientName: 'A', mimeType: 'image/jpeg', fileSizeBytes: 1000 }).code,
      'RECIPIENT_REQUIRED'
    );
    assert.equal(
      validateProofUploadMetadata({ recipientName: 'Fatou Sall', mimeType: 'application/pdf', fileSizeBytes: 1000 }).code,
      'UNSUPPORTED_MEDIA_TYPE'
    );
    assert.equal(
      validateProofUploadMetadata({
        recipientName: 'Fatou Sall',
        mimeType: 'image/png',
        fileSizeBytes: 6 * 1024 * 1024,
      }).code,
      'FILE_TOO_LARGE'
    );
    assert.equal(
      validateProofUploadMetadata({ recipientName: 'Fatou Sall', mimeType: 'image/webp', fileSizeBytes: 250_000 }).ok,
      true
    );
  });

  // 8. Notifications FCM : déduplication + nettoyage jeton invalide/expiré + révocation profil
  await test('8. Notifications FCM : anti-doublon dedupe_key, nettoyage auto jeton UNREGISTERED et révocation', async () => {
    const db = createInitialMockDb();
    // Active un Service Account factice pour déclencher l'appel FCM mocké
    const prevEnv = (globalThis as unknown as { Deno: { env: { get(k: string): string | undefined } } }).Deno.env.get;
    const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    (globalThis as unknown as { Deno: { env: { get(k: string): string | undefined } } }).Deno = {
      env: {
        get: (k: string) => {
          if (k === 'FIREBASE_SERVICE_ACCOUNT_EMAIL') return 'firebase-adminsdk@test.iam.gserviceaccount.com';
          if (k === 'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY') return privPem;
          return prevEnv(k);
        },
      },
    };
    installMockFetch(db);

    // 1er envoi -> envoyé + stocké dans express_notifications
    const first = await handleSyncAssignmentRequest(
      new Request('https://staging.supabase.co/functions/v1/sync-assignment-to-firestore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-sync-secret': TEST_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          deliveryId: 'del-active-transit',
          eventCategory: 'modification',
          dedupeKey: 'mod:del-active-transit:v2',
        }),
      })
    );
    assert.equal(first.status, 200);
    assert.equal(db.fcmCalls, 1);
    assert.equal(db.notifications.length, 1);

    // 2ème envoi identique -> dédupliqué, 0 nouvel appel FCM
    const second = await handleSyncAssignmentRequest(
      new Request('https://staging.supabase.co/functions/v1/sync-assignment-to-firestore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-sync-secret': TEST_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          deliveryId: 'del-active-transit',
          eventCategory: 'modification',
          dedupeKey: 'mod:del-active-transit:v2',
        }),
      })
    );
    assert.equal(second.status, 200);
    const secondJson = (await second.json()) as { deduplicated: boolean };
    assert.equal(secondJson.deduplicated, true);
    assert.equal(db.fcmCalls, 1);

    // 3ème envoi avec jeton UNREGISTERED -> nettoyage automatique de fcm_token = null
    db.forceFcmUnregistered = true;
    const third = await handleSyncAssignmentRequest(
      new Request('https://staging.supabase.co/functions/v1/sync-assignment-to-firestore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-sync-secret': TEST_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          deliveryId: 'del-active-transit',
          eventCategory: 'instruction',
          dedupeKey: 'inst:del-active-transit:v2',
        }),
      })
    );
    assert.equal(third.status, 200);
    assert.equal(db.drivers['uid-courier-1'].fcm_token, null);
    assert.ok(db.drivers['uid-courier-1'].fcm_token_invalidated_at);

    // Révocation explicite via driver-profile PATCH fcmToken: null
    db.drivers['uid-courier-1'].fcm_token = 'fcm_fresh_token_12345678901234567890';
    const revokeRes = await handleDriverProfileRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenCourier1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: false, fcmToken: null }),
      })
    );
    assert.equal(revokeRes.status, 200);
    assert.equal(db.drivers['uid-courier-1'].fcm_token, null);

    // Restaurer env sans service account pour les tests suivants
    installMockEnv();
  });

  // 9. Transitions de statuts avec réutilisation de proofId vérifié (sans duplication)
  await test('9. Transition DELIVERED : réutilise proofId vérifié sans dupliquer express_delivery_proofs', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);
    const verifiedProofId = '11111111-2222-4333-8444-555555555555';
    db.proofs.push({
      id: verifiedProofId,
      delivery_id: 'del-arrived-proof',
      upload_verified: true,
    });

    const res = await handleDeliveryActionRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-action', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenCourier1}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': 'deliver_with_photo_1',
        },
        body: JSON.stringify({
          deliveryId: 'del-arrived-proof',
          nextStatus: 'DELIVERED',
          proof: {
            proofId: verifiedProofId,
            recipientName: 'Fatou Sall',
            codCollectedConfirmed: true,
            gpsLat: 14.7453,
            gpsLng: -17.5138,
          },
        }),
      })
    );
    assert.equal(res.status, 200);
    assert.equal(db.deliveries['del-arrived-proof'].status, 'DELIVERED');
    assert.equal(db.proofs.length, 1, 'Ne doit pas créer une 2ème ligne de preuve');
  });

  // 10. Idempotence en cas de double transmission (GPS + Action livraison)
  await test('10. Idempotence double transmission : rejeu GPS et rejeu transition sans doublon', async () => {
    const db = createInitialMockDb();
    installMockFetch(db);

    const gpsHeaders = {
      Authorization: `Bearer ${tokenCourier1}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'gps_double_send_key',
    };
    const gpsBody = JSON.stringify({
      deliveryId: 'del-active-transit',
      lat: 14.6701,
      lng: -17.439,
      recordedAtIso: new Date().toISOString(),
    });

    const firstGps = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: gpsHeaders,
        body: gpsBody,
      })
    );
    assert.equal(firstGps.status, 201);

    const replayGps = await handleDriverLocationRequest(
      new Request('https://staging.supabase.co/functions/v1/driver-location', {
        method: 'POST',
        headers: gpsHeaders,
        body: gpsBody,
      })
    );
    assert.equal(replayGps.status, 200);
    const replayGpsData = (await replayGps.json()) as { idempotentReplay: boolean };
    assert.equal(replayGpsData.idempotentReplay, true);
    assert.equal(db.locations.length, 1);

    // Double transition delivery-action
    const actHeaders = {
      Authorization: `Bearer ${tokenCourier1}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'act_double_arrived_key',
    };
    const actBody = JSON.stringify({ deliveryId: 'del-active-transit', nextStatus: 'ARRIVED' });

    const firstAct = await handleDeliveryActionRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-action', {
        method: 'POST',
        headers: actHeaders,
        body: actBody,
      })
    );
    assert.equal(firstAct.status, 200);

    const replayAct = await handleDeliveryActionRequest(
      new Request('https://staging.supabase.co/functions/v1/delivery-action', {
        method: 'POST',
        headers: actHeaders,
        body: actBody,
      })
    );
    assert.equal(replayAct.status, 200);
    const replayActData = (await replayAct.json()) as { idempotentReplay: boolean };
    assert.equal(replayActData.idempotentReplay, true);
  });

  // 11. Comportement mobile : throttling GPS, file hors ligne, et fallback Push navigateur
  await test('11. Comportement mobile : throttling batterie/data, file GPS hors ligne et fallback Push', async () => {
    assert.equal(isMissionTrackableStatus('IN_TRANSIT'), true);
    assert.equal(isMissionTrackableStatus('DELIVERED'), false);
    assert.equal(isMissionTrackableStatus('ASSIGNED'), false);

    // Distance Plateau -> Almadies (~11 km)
    const dist = haversineDistanceMeters(
      { lat: 14.6696, lng: -17.4381 },
      { lat: 14.7453, lng: -17.5138 }
    );
    assert.ok(dist > 10_000 && dist < 13_000);

    const t0 = new Date(Date.now() - 20_000).toISOString();
    const fix0 = {
      lat: 14.6696,
      lng: -17.4381,
      accuracyMeters: 15,
      speedMps: 5,
      headingDeg: 90,
      recordedAtIso: t0,
    };

    // 1er point toujours envoyé
    assert.equal(shouldTransmitGpsFix(null, fix0).send, true);

    // Point trop proche temporellement (2s < 5s) -> throttlé
    const fixTooSoon = { ...fix0, lat: 14.671, recordedAtIso: new Date(Date.parse(t0) + 2_000).toISOString() };
    assert.equal(shouldTransmitGpsFix(fix0, fixTooSoon).send, false);

    // Point immobile après 7s (< 25m et < 12s) -> throttlé
    const fixStationary = { ...fix0, recordedAtIso: new Date(Date.parse(t0) + 7_000).toISOString() };
    assert.equal(shouldTransmitGpsFix(fix0, fixStationary).send, false);

    // Point après 6s ayant bougé de > 60m -> envoyé
    const fixMoved = { ...fix0, lat: 14.6703, recordedAtIso: new Date(Date.parse(t0) + 6_000).toISOString() };
    assert.equal(shouldTransmitGpsFix(fix0, fixMoved).send, true);

    // Précision aberrante (800m > 500m) -> ignoré
    const fixNoisy = { ...fix0, accuracyMeters: 800, recordedAtIso: new Date(Date.parse(t0) + 15_000).toISOString() };
    assert.equal(shouldTransmitGpsFix(fix0, fixNoisy).send, false);

    // File hors ligne bornée + déduplication + reprise réseau
    const queue = new GpsOfflineQueue(3);
    for (let i = 0; i < 5; i++) {
      const iso = new Date(Date.now() + i * 5000).toISOString();
      queue.enqueue({
        deliveryId: 'del-active-transit',
        lat: 14.67 + i * 0.001,
        lng: -17.44,
        recordedAtIso: iso,
        idempotencyKey: buildGpsIdempotencyKey('del-active-transit', iso),
      });
    }
    assert.equal(queue.size(), 3, 'La file mobile doit rester bornée pour économiser la mémoire');

    const sentKeys: string[] = [];
    const flushRes = await queue.flush(async (pt) => {
      sentKeys.push(pt.idempotencyKey!);
    });
    assert.equal(flushRes.sent, 3);
    assert.equal(flushRes.remaining, 0);

    // Fallback propre lorsque Push API est indisponible (environnement Node / navigateur non supporté)
    assert.equal(detectPushSupportState(), 'unsupported');
  });

  console.log(`\nRésultat : ${passed} réussis, ${failed} échoués.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

void runAll();
