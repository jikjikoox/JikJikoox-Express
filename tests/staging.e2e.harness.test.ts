/**
 * Harnais de tests End-to-End isolé (Staging Sandbox en mémoire — ZERO appel production)
 *
 * Exécute les VRAIS handlers HTTP des 6 Supabase Edge Functions + `expressApi`
 * contre un double en mémoire strictement isolé (PostgreSQL/PostgREST + Google JWKS
 * + Google OAuth + Firestore REST + FCM v1 + Supabase Storage Sign).
 *
 * Aucune requête réseau externe n'est émise. Aucun secret ou token FCM n'est loggé.
 */

import assert from 'node:assert/strict';
import { handleDriverProfileRequest } from '../supabase/functions/driver-profile/index.ts';
import { handleDriverDeliveriesRequest } from '../supabase/functions/driver-deliveries/index.ts';
import { handleDeliveryActionRequest } from '../supabase/functions/delivery-action/index.ts';
import {
  handleDeliveryProofRequest,
  isSignedUrlExpired,
} from '../supabase/functions/delivery-proof/index.ts';
import { handleDriverNotificationsRequest } from '../supabase/functions/driver-notifications/index.ts';
import { handleDriverLocationRequest } from '../supabase/functions/driver-location/index.ts';
import { handleAdminDriverLocationsRequest } from '../supabase/functions/admin-driver-locations/index.ts';
import { handleExpressAdminProfileRequest } from '../supabase/functions/express-admin-profile/index.ts';
import { handleSyncAssignmentRequest } from '../supabase/functions/sync-assignment-to-firestore/index.ts';
import {
  BACKEND_TRANSITION_GRAPH,
  TERMINAL_STATUSES,
  type BackendDeliveryStatus,
} from '../supabase/functions/_shared/workflow.ts';
import { createExpressApiClient, ExpressApiError } from '../src/services/expressApi.ts';

interface CheckResult {
  group: string;
  id: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

async function check(group: string, id: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ group, id, name, passed: true });
  } catch (err) {
    results.push({
      group,
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
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function setupIsolatedStagingEnvironment() {
  const projectId = 'livraisonjikjikoox-staging-isolated';
  const dbId = 'staging-isolated-db';
  const internalSecret = 'staging-only-internal-secret-999';
  const supabaseBase = 'https://staging-isolated.local';
  const kid = 'stg-rsa-kid-01';

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

  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(
    String.fromCharCode(...new Uint8Array(pkcs8))
  )}\n-----END PRIVATE KEY-----`;

  async function issueToken(
    uid: string,
    email: string,
    overrides: Record<string, unknown> = {}
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const payload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: uid,
      email,
      email_verified: true,
      name: `Livreur ${uid}`,
      auth_time: now - 100,
      iat: now - 30,
      exp: now + 3600,
      ...overrides,
    };
    const h = toBase64Url(JSON.stringify(header));
    const p = toBase64Url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(`${h}.${p}`)
    );
    return `${h}.${p}.${toBase64Url(new Uint8Array(sig))}`;
  }

  // État en mémoire strictement isolé (Supabase + Firestore + FCM + Storage)
  const nowIso = new Date().toISOString();
  const state = {
    failFirestoreNextCalls: 0,
    failFcmNextCalls: 0,
    drivers: new Map<string, Record<string, unknown>>([
      [
        'drv-stg-001',
        {
          id: 'drv-stg-001',
          firebase_uid: 'uid_staging_driver_a',
          email: 'driver.a.staging@jikjikoox.test',
          first_name: 'Moussa',
          last_name: 'Staging A',
          phone: '+221 77 000 00 01',
          photo_url: null,
          vehicle_type: 'moto',
          vehicle_plate: 'STG-001-DK',
          work_zone: 'Almadies & Ngor',
          role: 'courier',
          account_status: 'active',
          is_available: true,
          notifications_enabled: true,
          push_sound_enabled: true,
          fcm_token: 'redacted-staging-fcm-token-a',
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
      [
        'drv-stg-002',
        {
          id: 'drv-stg-002',
          firebase_uid: 'uid_staging_driver_b',
          email: 'driver.b.staging@jikjikoox.test',
          first_name: 'Ibrahima',
          last_name: 'Staging B',
          phone: '+221 77 000 00 02',
          photo_url: null,
          vehicle_type: 'scooter',
          vehicle_plate: 'STG-002-DK',
          work_zone: 'Dakar Plateau',
          role: 'courier',
          account_status: 'active',
          is_available: true,
          notifications_enabled: true,
          push_sound_enabled: true,
          fcm_token: 'redacted-staging-fcm-token-b',
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
      [
        'drv-stg-003',
        {
          id: 'drv-stg-003',
          firebase_uid: 'uid_staging_suspended',
          email: 'suspended.staging@jikjikoox.test',
          first_name: 'Compte',
          last_name: 'Suspendu',
          phone: '+221 77 000 00 03',
          photo_url: null,
          vehicle_type: 'moto',
          vehicle_plate: null,
          work_zone: 'Pikine',
          role: 'courier',
          account_status: 'suspended',
          is_available: false,
          notifications_enabled: true,
          push_sound_enabled: true,
          fcm_token: null,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
    ]),
    admins: new Map<string, Record<string, unknown>>([
      ['uid_staging_admin', {
        firebase_uid: 'uid_staging_admin',
        email: 'admin.staging@jikjikoox.test',
        display_name: 'Admin QA',
        is_active: true,
        supabase_user_id: 'user_staging_admin',
      }],
    ]),
    profiles: new Map<string, Record<string, unknown>>([
      ['user_staging_admin', {
        user_id: 'user_staging_admin',
        role: 'admin',
        is_active: true,
        email: 'admin.staging@jikjikoox.test',
      }],
    ]),
    driverLocations: [] as Array<Record<string, unknown>>,
    lastLocations: new Map<string, Record<string, unknown>>(),
    deliveries: new Map<string, Record<string, unknown>>([
      [
        'dlv-stg-0001',
        {
          id: 'dlv-stg-0001',
          mission_code: 'MSN-STG-0001',
          order_id: 'ord-stg-2026-0001',
          order_number: 'JKX-STG-0001',
          driver_id: 'drv-stg-001',
          driver_firebase_uid: 'uid_staging_driver_a',
          customer_name: 'Fatou Test Staging',
          customer_phone: '+221 77 000 99 01',
          delivery_address: 'Point Test Almadies Zone 12, Dakar',
          delivery_zone: 'Almadies & Ngor',
          pickup_name: 'Marchand Test JikJikoox',
          pickup_address: 'Point Relais Test Point E, Dakar',
          gps_lat: 14.7456,
          gps_lng: -17.5142,
          items_summary: [{ name: 'Coffret Bissap Test QA', quantity: 2, unit: 'bouteilles' }],
          item_count: 2,
          payment_mode: 'cod',
          cod_amount: 12500,
          estimated_fee: 1500,
          instructions: 'Commande de test QA — ne pas expédier',
          status: 'ASSIGNED',
          recipient_name: null,
          proof_code: null,
          proof_note: null,
          failure_reason: null,
          sync_version: 1,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
      [
        'dlv-stg-0002',
        {
          id: 'dlv-stg-0002',
          mission_code: 'MSN-STG-0002',
          order_id: 'ord-stg-2026-0002',
          order_number: 'JKX-STG-0002',
          driver_id: 'drv-stg-002',
          driver_firebase_uid: 'uid_staging_driver_b',
          customer_name: 'Amadou Test Staging B',
          customer_phone: '+221 77 000 99 02',
          delivery_address: 'Point Test Plateau, Dakar',
          delivery_zone: 'Dakar Plateau',
          pickup_name: 'Marchand Test Plateau',
          pickup_address: 'Rue Test, Dakar',
          gps_lat: 14.6708,
          gps_lng: -17.438,
          items_summary: [{ name: 'Mangues séchées Test QA', quantity: 1, unit: 'pack' }],
          item_count: 1,
          payment_mode: 'prepaid',
          cod_amount: 0,
          estimated_fee: 1500,
          instructions: 'Mission réservée au Livreur B',
          status: 'ASSIGNED',
          recipient_name: null,
          proof_code: null,
          proof_note: null,
          failure_reason: null,
          sync_version: 1,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
      [
        'dlv-stg-0003-failpath',
        {
          id: 'dlv-stg-0003-failpath',
          mission_code: 'MSN-STG-0003',
          order_id: 'ord-stg-2026-0003',
          order_number: 'JKX-STG-0003',
          driver_id: 'drv-stg-001',
          driver_firebase_uid: 'uid_staging_driver_a',
          customer_name: 'Client Absent Test QA',
          customer_phone: '+221 77 000 99 03',
          delivery_address: 'Point Test Mermoz, Dakar',
          delivery_zone: 'Mermoz & Sacré-Cœur',
          pickup_name: 'Marchand Test Mermoz',
          pickup_address: 'Point Relais Mermoz',
          gps_lat: 14.712,
          gps_lng: -17.475,
          items_summary: [{ name: 'Café Touba Test QA', quantity: 1, unit: 'sachet' }],
          item_count: 1,
          payment_mode: 'prepaid',
          cod_amount: 0,
          estimated_fee: 1500,
          instructions: 'Scénario échec puis retour',
          status: 'ARRIVED',
          recipient_name: null,
          proof_code: null,
          proof_note: null,
          failure_reason: null,
          sync_version: 5,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
    ]),
    events: [] as Array<Record<string, unknown>>,
    proofs: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    syncLogs: new Map<string, Record<string, unknown>>(),
    firestoreDocs: new Map<string, Record<string, unknown>>(),
    fcmDispatches: [] as Array<{ missionId: string; title: string }>,
  };

  // Inject Deno.env shim pour les Edge Functions
  const envMap: Record<string, string> = {
    SUPABASE_URL: supabaseBase,
    SUPABASE_SERVICE_ROLE_KEY: 'staging-isolated-service-role-key',
    FIREBASE_PROJECT_ID: projectId,
    FIRESTORE_DATABASE_ID: dbId,
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'sync-staging@livraisonjikjikoox-staging.iam.gserviceaccount.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKeyPem,
    ALLOWED_ORIGINS: 'https://staging-livraison.jikjikoox.com',
    INTERNAL_SYNC_SECRET: internalSecret,
  };

  (globalThis as unknown as { Deno?: unknown }).Deno = {
    env: {
      get: (k: string) => envMap[k],
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : '';

    // 1. Google JWKS (clés publiques Firebase)
    if (urlStr.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) {
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // 2. Google OAuth Service Account token exchange
    if (urlStr === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'staging-isolated-google-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Firestore REST API (miroir opérationnel)
    if (urlStr.startsWith('https://firestore.googleapis.com/v1/')) {
      if (state.failFirestoreNextCalls > 0) {
        state.failFirestoreNextCalls -= 1;
        return new Response('Firestore Temporary Unavailable', { status: 503 });
      }
      const docId = decodeURIComponent(urlStr.split('/documents/missions/')[1] || '');
      const parsed = JSON.parse(rawBody) as { fields: Record<string, unknown> };
      state.firestoreDocs.set(docId, parsed.fields);
      return new Response(JSON.stringify({ name: docId }), { status: 200 });
    }

    // 4. FCM v1 API
    if (urlStr.startsWith('https://fcm.googleapis.com/v1/')) {
      if (state.failFcmNextCalls > 0) {
        state.failFcmNextCalls -= 1;
        return new Response('FCM Temporary Error', { status: 500 });
      }
      const parsed = JSON.parse(rawBody) as {
        message: { notification: { title: string }; data: { missionId: string } };
      };
      state.fcmDispatches.push({
        missionId: parsed.message.data.missionId,
        title: parsed.message.notification.title,
      });
      return new Response(JSON.stringify({ name: 'projects/staging/messages/msg-1' }), { status: 200 });
    }

    // 5. Supabase Storage signed upload URL
    if (urlStr.startsWith(`${supabaseBase}/storage/v1/object/upload/sign/delivery-proofs/`)) {
      const encodedPath = urlStr.split('/sign/delivery-proofs/')[1];
      return new Response(
        JSON.stringify({
          url: `/object/upload/sign/delivery-proofs/${encodedPath}?token=stg-short-ttl-token`,
          token: 'stg-short-ttl-token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Supabase PostgREST + RPC
    if (urlStr.startsWith(`${supabaseBase}/rest/v1/`)) {
      const parsedUrl = new URL(urlStr);
      const tablePath = parsedUrl.pathname.replace('/rest/v1/', '');

      if (tablePath === 'express_admins' && method === 'GET') {
        const uidFilter = parsedUrl.searchParams.get('firebase_uid')?.replace(/^eq\./, '');
        const activeFilter = parsedUrl.searchParams.get('is_active')?.replace(/^eq\./, '');
        const rows = [...state.admins.values()].filter((a) => (!uidFilter || a.firebase_uid === uidFilter) && (!activeFilter || String(a.is_active) === activeFilter));
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (tablePath === 'profiles' && method === 'GET') {
        const userIdFilter = parsedUrl.searchParams.get('user_id')?.replace(/^eq\./, '');
        const activeFilter = parsedUrl.searchParams.get('is_active')?.replace(/^eq\\./, '');
        const rows = [...state.profiles.values()].filter((p) => (!userIdFilter || p.user_id === userIdFilter) && (!activeFilter || String(p.is_active) === activeFilter));
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (tablePath === 'express_drivers') {
        if (method === 'GET') {
          const uidFilter = parsedUrl.searchParams.get('firebase_uid')?.replace(/^eq\./, '');
          const idFilter = parsedUrl.searchParams.get('id')?.replace(/^eq\./, '');
          const statusFilter = parsedUrl.searchParams.get('account_status')?.replace(/^eq\./, '');
          const rows = [...state.drivers.values()].filter(
            (d) => (!uidFilter || d.firebase_uid === uidFilter) && (!idFilter || d.id === idFilter) && (!statusFilter || d.account_status === statusFilter)
          );
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const newId = `drv-stg-${state.drivers.size + 1}`;
          const created = {
            id: newId,
            vehicle_type: 'scooter',
            vehicle_plate: null,
            work_zone: 'Dakar Plateau',
            notifications_enabled: true,
            push_sound_enabled: true,
            fcm_token: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...body,
          };
          state.drivers.set(newId, created);
          return new Response(JSON.stringify([created]), { status: 201 });
        }
        if (method === 'PATCH') {
          const idFilter = parsedUrl.searchParams.get('id')?.replace(/^eq\./, '') || '';
          const existing = state.drivers.get(idFilter);
          if (!existing) return new Response(JSON.stringify([]), { status: 200 });
          const updated = { ...existing, ...(JSON.parse(rawBody) as Record<string, unknown>) };
          state.drivers.set(idFilter, updated);
          return new Response(JSON.stringify([updated]), { status: 200 });
        }
      }

      if (tablePath === 'express_driver_locations') {
        if (method === 'GET') {
          const keyFilter = parsedUrl.searchParams.get('idempotency_key')?.replace(/^eq\./, '');
          const driverFilter = parsedUrl.searchParams.get('driver_id')?.replace(/^eq\./, '');
          const rows = state.driverLocations.filter((loc) => (!keyFilter || loc.idempotency_key === keyFilter) && (!driverFilter || loc.driver_id === driverFilter));
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const row = { id: `gps-stg-${state.driverLocations.length + 1}`, recorded_at: body.recorded_at, ...body };
          state.driverLocations.push(row);
          return new Response(JSON.stringify([row]), { status: 201 });
        }
      }

      if (tablePath === 'express_driver_last_locations') {
        if (method === 'GET') {
          const driverFilter = parsedUrl.searchParams.get('driver_id')?.replace(/^eq\./, '');
          const rows = [...state.lastLocations.values()].filter((loc) => !driverFilter || loc.driver_id === driverFilter);
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          state.lastLocations.set(String(body.driver_id), body);
          return new Response(JSON.stringify([body]), { status: 201 });
        }
      }

      if (tablePath === 'express_deliveries' && method === 'GET') {
        const idFilter = parsedUrl.searchParams.get('id')?.replace(/^eq\./, '');
        const drvFilter = parsedUrl.searchParams.get('driver_id')?.replace(/^eq\./, '');
        const rows = [...state.deliveries.values()].filter(
          (d) => (!idFilter || d.id === idFilter) && (!drvFilter || d.driver_id === drvFilter)
        );
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (tablePath === 'express_delivery_events' && method === 'GET') {
        const idemFilter = parsedUrl.searchParams.get('idempotency_key')?.replace(/^eq\./, '');
        const dlvFilter = parsedUrl.searchParams.get('delivery_id')?.replace(/^eq\./, '');
        const uidFilter = parsedUrl.searchParams.get('driver_firebase_uid')?.replace(/^eq\./, '');
        const rows = state.events.filter(
          (ev) =>
            (!idemFilter || ev.idempotency_key === idemFilter) &&
            (!dlvFilter || ev.delivery_id === dlvFilter) &&
            (!uidFilter || ev.driver_firebase_uid === uidFilter)
        );
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (tablePath === 'rpc/express_apply_delivery_transition' && method === 'POST') {
        const p = JSON.parse(rawBody) as Record<string, unknown>;
        const deliveryId = String(p.p_delivery_id);
        const uid = String(p.p_driver_firebase_uid);
        const nextStatus = p.p_next_status as BackendDeliveryStatus;
        const idemKey = p.p_idempotency_key ? String(p.p_idempotency_key) : null;

        const delivery = state.deliveries.get(deliveryId);
        if (!delivery) return new Response('MISSION_NOT_FOUND', { status: 400 });
        if (delivery.driver_firebase_uid !== uid) return new Response('MISSION_FORBIDDEN', { status: 400 });

        if (idemKey) {
          const existingEv = state.events.find(
            (e) => e.idempotency_key === idemKey && e.delivery_id === deliveryId
          );
          if (existingEv) {
            return new Response(
              JSON.stringify({
                idempotent_replay: true,
                event_id: existingEv.id,
                delivery_id: deliveryId,
                status: delivery.status,
                sync_version: delivery.sync_version,
                updated_at: delivery.updated_at,
              }),
              { status: 200 }
            );
          }
        }

        const prevStatus = delivery.status as BackendDeliveryStatus;
        if (TERMINAL_STATUSES.has(prevStatus)) return new Response('MISSION_TERMINAL', { status: 400 });
        if (!BACKEND_TRANSITION_GRAPH[prevStatus].includes(nextStatus)) {
          return new Response('INVALID_TRANSITION', { status: 400 });
        }

        const ts = new Date().toISOString();
        const nextSync = Number(delivery.sync_version) + 1;
        delivery.status = nextStatus;
        delivery.sync_version = nextSync;
        delivery.updated_at = ts;
        if (p.p_recipient_name) delivery.recipient_name = p.p_recipient_name;
        if (p.p_proof_code) delivery.proof_code = p.p_proof_code;
        if (p.p_proof_note) delivery.proof_note = p.p_proof_note;
        if (p.p_failure_reason) delivery.failure_reason = p.p_failure_reason;

        const evId = `evt-stg-${state.events.length + 1}`;
        state.events.push({
          id: evId,
          delivery_id: deliveryId,
          order_id: delivery.order_id,
          driver_firebase_uid: uid,
          previous_status: prevStatus,
          next_status: nextStatus,
          label: p.p_label,
          actor: 'courier',
          idempotency_key: idemKey,
          created_at: ts,
        });

        return new Response(
          JSON.stringify({
            idempotent_replay: false,
            event_id: evId,
            delivery_id: deliveryId,
            status: nextStatus,
            sync_version: nextSync,
            updated_at: ts,
          }),
          { status: 200 }
        );
      }

      if (tablePath === 'express_delivery_proofs' && method === 'POST') {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        const rec = { ...body, created_at: new Date().toISOString() };
        state.proofs.push(rec);
        return new Response(JSON.stringify([rec]), { status: 201 });
      }

      if (tablePath === 'express_sync_log' && method === 'POST') {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        state.syncLogs.set(String(body.sync_key), body);
        return new Response(JSON.stringify([body]), { status: 201 });
      }

      if (tablePath === 'express_notifications') {
        if (method === 'GET') {
          const drvFilter = parsedUrl.searchParams.get('driver_id')?.replace(/^eq\./, '');
          const rows = state.notifications.filter((n) => !drvFilter || n.driver_id === drvFilter);
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const rec = {
            id: `ntf-stg-${state.notifications.length + 1}`,
            is_read: false,
            read_at: null,
            created_at: new Date().toISOString(),
            ...body,
          };
          state.notifications.push(rec);
          return new Response(JSON.stringify([rec]), { status: 201 });
        }
        if (method === 'PATCH') {
          const idFilter = parsedUrl.searchParams.get('id')?.replace(/^eq\./, '');
          const drvFilter = parsedUrl.searchParams.get('driver_id')?.replace(/^eq\./, '');
          const patch = JSON.parse(rawBody) as Record<string, unknown>;
          for (const n of state.notifications) {
            if ((!idFilter || n.id === idFilter) && (!drvFilter || n.driver_id === drvFilter)) {
              Object.assign(n, patch);
            }
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }
    }

    throw new Error(`Appel réseau externe bloqué par l'isolation staging : ${method} ${urlStr}`);
  }) as typeof fetch;

  return {
    state,
    issueToken,
    internalSecret,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function main() {
  const env = await setupIsolatedStagingEnvironment();
  const origin = 'https://staging-livraison.jikjikoox.com';

  try {
    const tokenA = await env.issueToken('uid_staging_driver_a', 'driver.a.staging@jikjikoox.test');
    const tokenB = await env.issueToken('uid_staging_driver_b', 'driver.b.staging@jikjikoox.test');
    const tokenAdmin = await env.issueToken('uid_staging_admin', 'admin.staging@jikjikoox.test');
    const tokenSuspended = await env.issueToken(
      'uid_staging_suspended',
      'suspended.staging@jikjikoox.test'
    );
    const tokenNewUser = await env.issueToken(
      'uid_staging_new_google',
      'nouveau.staging@jikjikoox.test'
    );
    const expiredToken = await env.issueToken('uid_staging_driver_a', 'driver.a.staging@jikjikoox.test', {
      exp: Math.floor(Date.now() / 1000) - 600,
      iat: Math.floor(Date.now() / 1000) - 1200,
    });

    // =========================================================================
    // TEST 1 — AUTHENTIFICATION
    // =========================================================================
    await check('Test 1 — Auth', 'E01', 'Livreur actif authentifié via Firebase RS256 JWKS charge son profil', async () => {
      const res = await handleDriverProfileRequest(
        new Request('https://stg/driver-profile', {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokenA}`, Origin: origin },
        })
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; profile: { account_status: string; id: string } };
      assert.equal(body.ok, true);
      assert.equal(body.profile.id, 'drv-stg-001');
      assert.equal(body.profile.account_status, 'active');
    });

    await check('Test 1 — Auth', 'E02', 'Nouveau compte Google inscrit en pending (jamais auto-activé) et bloqué sur /driver-deliveries', async () => {
      const profRes = await handleDriverProfileRequest(
        new Request('https://stg/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenNewUser}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName: 'Nouveau', lastName: 'Livreur QA', phone: '+221 77 000 00 04', vehicleType: 'scooter', workZone: 'Dakar' }),
        })
      );
      assert.equal(profRes.status, 201);
      const prof = (await profRes.json()) as { profile: { account_status: string; is_available: boolean } };
      assert.equal(prof.profile.account_status, 'pending');
      assert.equal(prof.profile.is_available, false);

      const delivRes = await handleDriverDeliveriesRequest(
        new Request('https://stg/driver-deliveries', {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokenNewUser}` },
        })
      );
      assert.equal(delivRes.status, 403);
    });

    await check('Test 1 — Auth', 'E03', 'Session expirée, token absent ou signature altérée rejetés en 401', async () => {
      const noTok = await handleDriverDeliveriesRequest(new Request('https://stg/driver-deliveries'));
      assert.equal(noTok.status, 401);

      const expRes = await handleDriverDeliveriesRequest(
        new Request('https://stg/driver-deliveries', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        })
      );
      assert.equal(expRes.status, 401);

      const badSig = `${tokenA.slice(0, -4)}XXXX`;
      const badRes = await handleDriverDeliveriesRequest(
        new Request('https://stg/driver-deliveries', {
          headers: { Authorization: `Bearer ${badSig}` },
        })
      );
      assert.equal(badRes.status, 401);
    });

    await check('Test GPS & Admin — Auth', 'E12', 'GPS et carte de flotte refusent les appels sans token Firebase (401)', async () => {
      const gps = await handleDriverLocationRequest(new Request('https://stg/driver-location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryId: 'dlv-stg-0001', latitude: 14.7, longitude: -17.4 }) }));
      assert.equal(gps.status, 401);
      const map = await handleAdminDriverLocationsRequest(new Request('https://stg/admin-driver-locations'));
      assert.equal(map.status, 401);
    });

    await check('Test GPS & Admin — Auth', 'E13', 'Un livreur authentifié mais non-admin est refusé sur la carte de flotte (403)', async () => {
      const res = await handleAdminDriverLocationsRequest(new Request('https://stg/admin-driver-locations', { headers: { Authorization: `Bearer ${tokenA}` } }));
      assert.equal(res.status, 403);
    });

    // =========================================================================
    // TEST 2 & 3 — AFFECTATION ADMIN & SYNCHRONISATION FIRESTORE
    // =========================================================================
    await check('Test 2/3 — Admin & Sync', 'E04', 'Endpoint interne sync-assignment refusé sans INTERNAL_SYNC_SECRET (401)', async () => {
      const res = await handleSyncAssignmentRequest(
        new Request('https://stg/sync-assignment-to-firestore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId: 'dlv-stg-0001' }),
        })
      );
      assert.equal(res.status, 401);
    });

    await check('Test 2/3 — Admin & Sync', 'E05', 'Affectation officielle synchronisée vers Firestore (deliveryId, orderId, driverId, status, assignedAt, updatedAt) + FCM', async () => {
      const res = await handleSyncAssignmentRequest(
        new Request('https://stg/sync-assignment-to-firestore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Sync-Secret': env.internalSecret,
          },
          body: JSON.stringify({ deliveryId: 'dlv-stg-0001' }),
        })
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        firestore: { synced: boolean; syncKey: string };
        fcm: { synced: boolean };
      };
      assert.equal(body.ok, true);
      assert.equal(body.firestore.synced, true);
      assert.equal(body.fcm.synced, true);

      const fsDoc = env.state.firestoreDocs.get('dlv-stg-0001') as Record<string, Record<string, string>>;
      assert.ok(fsDoc, 'Document Firestore miroir présent sous l’ID canonique dlv-stg-0001');
      assert.equal(fsDoc.deliveryId.stringValue, 'dlv-stg-0001');
      assert.equal(fsDoc.orderId.stringValue, 'ord-stg-2026-0001');
      assert.equal(fsDoc.driverId.stringValue, 'uid_staging_driver_a');
      assert.equal(fsDoc.status.stringValue, 'ASSIGNED');
      assert.ok(fsDoc.assignedAt.timestampValue);
      assert.ok(fsDoc.updatedAt.timestampValue);
    });

    await check('Test 3 — Sync Firestore', 'E06', 'Idempotence sur synchronisation répétée & résilience avec retry lors d’une panne transitoire Firestore', async () => {
      env.state.failFirestoreNextCalls = 2; // 2 échecs 503 puis succès à la 3e tentative
      const res = await handleSyncAssignmentRequest(
        new Request('https://stg/sync-assignment-to-firestore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Sync-Secret': env.internalSecret,
          },
          body: JSON.stringify({ deliveryId: 'dlv-stg-0001' }),
        })
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { firestore: { synced: boolean; attempts: number } };
      assert.equal(body.firestore.synced, true);
      assert.equal(body.firestore.attempts, 3);
      assert.equal(env.state.firestoreDocs.size, 1, 'Aucun doublon créé dans Firestore');
    });

    // =========================================================================
    // TEST 4 — NOTIFICATIONS PUSH (ISOLÉ)
    // =========================================================================
    await check('Test 4 — Notifications', 'E07', 'Notification créée, listée et marquée lue pour le livreur A uniquement', async () => {
      assert.ok(env.state.fcmDispatches.some((d) => d.missionId === 'dlv-stg-0001'));
      const listRes = await handleDriverNotificationsRequest(
        new Request('https://stg/driver-notifications', {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokenA}` },
        })
      );
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as { notifications: Array<{ id: string; is_read: boolean }> };
      assert.ok(listBody.notifications.length >= 1);

      const firstId = listBody.notifications[0].id;
      const markRes = await handleDriverNotificationsRequest(
        new Request('https://stg/driver-notifications', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: firstId }),
        })
      );
      assert.equal(markRes.status, 200);
      assert.equal(env.state.notifications[0].is_read, true);
    });

    // =========================================================================
    // TEST 5 & 6 — PARCOURS LIVREUR COMPLET + PREUVE DE LIVRAISON
    // =========================================================================
    await check('Test 6 — Preuve', 'E08', 'Soumission de preuve bloquée avant le statut ARRIVED (422)', async () => {
      const res = await handleDeliveryProofRequest(
        new Request('https://stg/delivery-proof', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            recipientName: 'Fatou Test Staging',
            mimeType: 'image/jpeg',
            fileSizeBytes: 120_000,
          }),
        })
      );
      assert.equal(res.status, 422);
    });

    await check('Test 5 — Parcours', 'E09', 'Parcours complet ASSIGNED -> ACCEPTED -> PICKED_UP -> IN_TRANSIT -> ARRIVED cohérent sur 3 systèmes', async () => {
      const steps: BackendDeliveryStatus[] = ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'];
      for (const nextStatus of steps) {
        const res = await handleDeliveryActionRequest(
          new Request('https://stg/delivery-action', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenA}`,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': `stg-step-${nextStatus}`,
            },
            body: JSON.stringify({ deliveryId: 'dlv-stg-0001', nextStatus }),
          })
        );
        assert.equal(res.status, 200, `Échec étape ${nextStatus}`);
        const data = (await res.json()) as { status: string; firestoreSynced: boolean };
        assert.equal(data.status, nextStatus);
        assert.equal(data.firestoreSynced, true);

        // Cohérence Supabase <-> Firestore
        const sbRow = env.state.deliveries.get('dlv-stg-0001')!;
        const fsDoc = env.state.firestoreDocs.get('dlv-stg-0001') as Record<string, Record<string, string>>;
        assert.equal(sbRow.status, nextStatus);
        assert.equal(fsDoc.status.stringValue, nextStatus);
      }
    });

    await check('Test GPS — Mission active', 'E14', 'Livreur A envoie une position GPS valide; historique et dernière position sont enregistrés', async () => {
      const gpsRes = await handleDriverLocationRequest(new Request('https://stg/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': 'gps-stg-unique-001' },
        body: JSON.stringify({ deliveryId: 'dlv-stg-0001', latitude: 14.7456, longitude: -17.5142, accuracyMeters: 8, speedMps: 2.4, heading: 91, recordedAtIso: new Date().toISOString() }),
      }));
      assert.equal(gpsRes.status, 201);
      assert.equal(env.state.driverLocations.length, 1);
      assert.equal(env.state.lastLocations.get('drv-stg-001')?.latitude, 14.7456);
    });

    await check('Test GPS — Isolation', 'E15', 'Livreur A ne peut envoyer une position sur la mission du Livreur B (403)', async () => {
      const res = await handleDriverLocationRequest(new Request('https://stg/driver-location', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: 'dlv-stg-0002', latitude: 14.7, longitude: -17.4 }),
      }));
      assert.equal(res.status, 403);
    });

    await check('Test Admin — Identité et rôle Supabase', 'E17', 'Admin Firebase lié à un profil Supabase actif reçoit son rôle exact', async () => {
      const res = await handleExpressAdminProfileRequest(new Request('https://stg/express-admin-profile', {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      }));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; isAdmin: boolean; role: string; email: string };
      assert.equal(body.ok, true);
      assert.equal(body.isAdmin, true);
      assert.equal(body.role, 'admin');
      assert.equal(body.email, 'admin.staging@jikjikoox.test');
    });

    await check('Test Admin — Carte de flotte', 'E16', 'Admin staging authentifié voit la position GPS enregistrée; endpoint renvoie 200', async () => {
      const res = await handleAdminDriverLocationsRequest(new Request('https://stg/admin-driver-locations', { headers: { Authorization: `Bearer ${tokenAdmin}` } }));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; activeCount: number; drivers: Array<{ driverId: string; lat: number; lng: number }> };
      assert.equal(body.ok, true);
      assert.equal(body.activeCount, 1);
      assert.equal(body.drivers[0].driverId, 'drv-stg-001');
      assert.equal(body.drivers[0].lat, 14.7456);
      assert.equal(body.drivers[0].lng, -17.5142);
    });

    await check('Test 6 — Preuve', 'E10', 'Préparation upload preuve autorisée à ARRIVED (MIME/taille validés, chemin confiné, URL signée TTL 120s) et refusée à Livreur B', async () => {
      // Livreur B bloqué (403)
      const crossProof = await handleDeliveryProofRequest(
        new Request('https://stg/delivery-proof', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            recipientName: 'Usurpateur',
            mimeType: 'image/jpeg',
            fileSizeBytes: 50_000,
          }),
        })
      );
      assert.equal(crossProof.status, 403);

      // Fichier trop volumineux (> 5 Mo) refusé (400)
      const hugeRes = await handleDeliveryProofRequest(
        new Request('https://stg/delivery-proof', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            recipientName: 'Fatou Test Staging',
            mimeType: 'image/jpeg',
            fileSizeBytes: 7 * 1024 * 1024,
          }),
        })
      );
      assert.equal(hugeRes.status, 400);

      // Upload valide par Livreur A (201)
      const okRes = await handleDeliveryProofRequest(
        new Request('https://stg/delivery-proof', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            recipientName: 'Fatou Test Staging',
            proofCode: '4921',
            mimeType: 'image/jpeg',
            fileSizeBytes: 340_000,
            codCollectedConfirmed: true,
          }),
        })
      );
      assert.equal(okRes.status, 200);
      const proof = (await okRes.json()) as {
        storagePath: string;
        signedUploadUrl: string;
        expiresAtIso: string;
      };
      assert.ok(proof.storagePath.startsWith('uid_staging_driver_a/dlv-stg-0001/'));
      assert.ok(proof.signedUploadUrl.includes('/storage/v1/object/upload/sign/delivery-proofs/'));
      assert.equal(isSignedUrlExpired(proof.expiresAtIso), false);
      assert.equal(isSignedUrlExpired(proof.expiresAtIso, Date.now() + 125_000), true);
    });

    await check('Test 5 & 7 — Clôture & Idempotence', 'E11', 'Clôture DELIVERED + double soumission idempotente (200 replay) + seconde tentative nouvelle clé bloquée (409)', async () => {
      const deliverKey = 'stg-deliver-idempotent-001';
      const first = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenA}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': deliverKey,
          },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            nextStatus: 'DELIVERED',
            proof: { recipientName: 'Fatou Test Staging', proofCode: '4921', codCollectedConfirmed: true },
          }),
        })
      );
      assert.equal(first.status, 200);
      const firstData = (await first.json()) as { idempotentReplay: boolean; status: string };
      assert.equal(firstData.idempotentReplay, false);
      assert.equal(firstData.status, 'DELIVERED');

      const eventsCountBeforeReplay = env.state.events.length;

      // Double soumission avec la MÊME clé d'idempotence (retry réseau mobile)
      const replay = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenA}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': deliverKey,
          },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            nextStatus: 'DELIVERED',
            proof: { recipientName: 'Fatou Test Staging', proofCode: '4921', codCollectedConfirmed: true },
          }),
        })
      );
      assert.equal(replay.status, 200);
      const replayData = (await replay.json()) as { idempotentReplay: boolean; status: string };
      assert.equal(replayData.idempotentReplay, true);
      assert.equal(env.state.events.length, eventsCountBeforeReplay, 'Aucun événement dupliqué');

      // Nouvelle tentative avec une AUTRE clé sur mission clôturée -> 409 MISSION_LOCKED
      const repeat = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenA}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'different-key-after-close',
          },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0001',
            nextStatus: 'FAILED',
            failureReason: 'Tentative tardive',
          }),
        })
      );
      assert.equal(repeat.status, 409);
    });

    // =========================================================================
    // TEST 7 — SÉCURITÉ & ISOLATION LIVREUR A vs LIVREUR B
    // =========================================================================
    await check('Test 7 — Sécurité', 'E12', 'Livreur A bloqué sur les missions de B, sur les champs financiers/driverId/orderId et élévation profil', async () => {
      // Query param usurpation
      const crossList = await handleDriverDeliveriesRequest(
        new Request('https://stg/driver-deliveries?driverId=uid_staging_driver_b', {
          headers: { Authorization: `Bearer ${tokenA}` },
        })
      );
      assert.equal(crossList.status, 403);

      // Mutation mission de B par A
      const crossMut = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId: 'dlv-stg-0002', nextStatus: 'ACCEPTED' }),
        })
      );
      assert.equal(crossMut.status, 403);

      // Falsification driverId / orderId / codAmount
      const tamper = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0002',
            nextStatus: 'ACCEPTED',
            codAmount: 0,
            driverId: 'uid_staging_driver_a',
            orderId: 'fake-order',
          }),
        })
      );
      assert.equal(tamper.status, 400);

      // Utilisateur suspendu bloqué
      const suspRes = await handleDriverDeliveriesRequest(
        new Request('https://stg/driver-deliveries', {
          headers: { Authorization: `Bearer ${tokenSuspended}` },
        })
      );
      assert.equal(suspRes.status, 403);

      // Tentative d'élévation de privilège dans PATCH driver-profile
      const privEsc = await handleDriverProfileRequest(
        new Request('https://stg/driver-profile', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin', accountStatus: 'active' }),
        })
      );
      assert.equal(privEsc.status, 403);
    });

    // =========================================================================
    // TEST 8 — ÉCHECS OPÉRATIONNELS (HORS-LIGNE, PANNE FIRESTORE/FCM NON BLOQUANTE)
    // =========================================================================
    await check('Test 8 — Résilience', 'E13', 'Panne totale Firestore (3x503) + panne FCM ne bloquent pas la transition officielle Supabase', async () => {
      env.state.failFirestoreNextCalls = 5;
      env.state.failFcmNextCalls = 2;

      const res = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenB}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'stg-b-accept-resilient',
          },
          body: JSON.stringify({ deliveryId: 'dlv-stg-0002', nextStatus: 'ACCEPTED' }),
        })
      );
      assert.equal(res.status, 200);
      const data = (await res.json()) as { status: string; firestoreSynced: boolean };
      assert.equal(data.status, 'ACCEPTED');
      assert.equal(data.firestoreSynced, false);
      // Journalisé en failed dans express_sync_log pour réconciliation ultérieure
      const logEntry = env.state.syncLogs.get('firestore:dlv-stg-0002:v2');
      assert.equal(logEntry?.status, 'failed');
      env.state.failFirestoreNextCalls = 0;
      env.state.failFcmNextCalls = 0;
    });

    await check('Test 8 — Résilience', 'E14', 'Détection immédiate Internet coupé (navigator.onLine === false -> OFFLINE_NO_CONNECTION)', async () => {
      const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });
      try {
        const api = createExpressApiClient({
          baseUrl: 'https://staging.local/functions/v1',
          fetchImpl: async () => {
            throw new Error('Ne doit pas être appelé hors-ligne');
          },
        });
        await assert.rejects(
          () => api.fetchDriverDeliveries('tok'),
          (err: unknown) => err instanceof ExpressApiError && err.code === 'OFFLINE_NO_CONNECTION'
        );
      } finally {
        if (origDesc) Object.defineProperty(globalThis, 'navigator', origDesc);
      }
    });

    // =========================================================================
    // TEST 9 — HISTORIQUE & ADMIN (ÉCHEC -> RETOUR NÉCESSAIRE -> RETOURNÉ)
    // =========================================================================
    await check('Test 9 — Historique Admin', 'E15', 'Parcours échec/retour (ARRIVED -> FAILED -> RETURN_REQUIRED -> RETURNED) tracé et horodaté côté serveur', async () => {
      const r1 = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0003-failpath',
            nextStatus: 'FAILED',
            failureReason: 'Client absent au point de rendez-vous',
          }),
        })
      );
      assert.equal(r1.status, 200);

      const r2 = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0003-failpath',
            nextStatus: 'RETURN_REQUIRED',
          }),
        })
      );
      assert.equal(r2.status, 200);

      const r3 = await handleDeliveryActionRequest(
        new Request('https://stg/delivery-action', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: 'dlv-stg-0003-failpath',
            nextStatus: 'RETURNED',
          }),
        })
      );
      assert.equal(r3.status, 200);

      const dlv3Events = env.state.events.filter((e) => e.delivery_id === 'dlv-stg-0003-failpath');
      assert.deepEqual(
        dlv3Events.map((e) => e.next_status),
        ['FAILED', 'RETURN_REQUIRED', 'RETURNED']
      );
      assert.ok(dlv3Events.every((e) => typeof e.created_at === 'string' && e.created_at.length > 10));
    });
  } finally {
    env.restore();
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(
      `[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} (${r.group}) — ${r.name}${r.detail ? ` (${r.detail})` : ''}`
    );
  }
  console.log(`\nRésumé harnais Staging E2E isolé : ${passed}/${results.length} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

void main();
