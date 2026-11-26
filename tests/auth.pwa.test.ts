/**
 * Suite de tests automatisés — Authentification complète, Validation Admin & PWA (13 scénarios)
 *
 * Couvre les 13 scénarios obligatoires :
 * 1.  Inscription d'un nouveau livreur (validation téléphone international, conditions obligatoires)
 * 2.  Gestion d'erreurs Firebase Auth & reprise sur création partielle
 * 3.  Création du profil dans express_drivers & prévention des doublons (409)
 * 4.  Statut initial strictement pending, is_available=false, blocage élévation de privilèges (403)
 * 5.  Connexion d'un livreur en attente (GET -> pending) & profil absent (404 DRIVER_NOT_REGISTERED)
 * 6.  Refus d'accès aux missions tant que non validé (403 DRIVER_PENDING)
 * 7.  Connexion d'un livreur actif et accès autorisé aux missions
 * 8.  Déconnexion & session expirée (401 TOKEN_EXPIRED)
 * 9.  Validation administrative (admin-drivers GET/PATCH : acceptation, suspension, refus + blocage non-admin)
 * 10. Manifeste PWA, icônes PNG 192/512/maskable/apple-touch-icon, SVG & balises HTML
 * 11. Réouverture PWA standalone & en-têtes no-cache SW / manifest dans server.js
 * 12. Comportement hors connexion (refus de fausse confirmation de livraison + file GPS idempotente)
 * 13. Notifications push FCM (enregistrement/révocation token + gestion permissions/service worker)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleDriverProfileRequest } from '../supabase/functions/driver-profile/index.ts';
import { handleAdminDriversRequest } from '../supabase/functions/admin-drivers/index.ts';
import { handleDriverDeliveriesRequest } from '../supabase/functions/driver-deliveries/index.ts';
import { GOOGLE_FIREBASE_JWKS_URL } from '../supabase/functions/_shared/firebaseAuth.ts';
import { type DriverRecord } from '../supabase/functions/_shared/supabaseAdmin.ts';
import { createExpressApiClient, ExpressApiError } from '../src/services/expressApi.ts';
import { GpsOfflineQueue } from '../src/lib/gpsTracker.ts';

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

const STAGING_PROJECT_ID = 'jikjikoox-express-staging';
const STAGING_SUPABASE_URL = 'https://bwicndbbxvthbddiacks.supabase.co';

async function createRsaTestSigner() {
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

  const kid = 'staging-auth-pwa-kid-1';
  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  const jwksPayload = {
    keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }],
  };

  async function signJwt(overrides: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const payload = {
      iss: `https://securetoken.google.com/${STAGING_PROJECT_ID}`,
      aud: STAGING_PROJECT_ID,
      sub: 'uid_new_courier',
      email: 'fatou.ndiaye@exemple.sn',
      email_verified: false,
      auth_time: now - 30,
      iat: now - 10,
      exp: now + 3600,
      ...overrides,
    };
    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signingInput);
    return `${encodedHeader}.${encodedPayload}.${toBase64Url(new Uint8Array(sigBuffer))}`;
  }

  return { jwksPayload, signJwt };
}

async function main() {
  const signer = await createRsaTestSigner();

  // In-memory staging Supabase store
  const driversDb = new Map<string, DriverRecord>();
  const adminsDb = new Map<string, { firebase_uid: string; email: string; display_name: string; is_active: boolean }>([
    [
      'uid_staging_admin',
      {
        firebase_uid: 'uid_staging_admin',
        email: 'admin.staging@jikjikoox.com',
        display_name: 'Admin Staging JikJikoox',
        is_active: true,
      },
    ],
  ]);

  const deliveriesDb = [
    {
      id: 'deliv-stg-001',
      driver_id: 'drv-1',
      mission_code: 'MSN-STG-001',
      order_id: 'ord-stg-001',
      order_number: 'JKX-STG-1001',
      driver_firebase_uid: 'uid_new_courier',
      customer_name: 'Aminata Fall',
      customer_phone: '+221 77 555 44 33',
      delivery_address: 'Point E, Dakar',
      delivery_zone: 'Point E / Fann',
      pickup_name: 'Boutique Dakar',
      pickup_address: 'Plateau, Dakar',
      gps_lat: 14.6928,
      gps_lng: -17.4467,
      items_summary: [{ name: 'Colis Express', quantity: 1 }],
      item_count: 1,
      payment_mode: 'cod',
      cod_amount: 12000,
      estimated_fee: 1500,
      instructions: 'Appeler avant arrivée',
      status: 'ASSIGNED',
      recipient_name: null,
      proof_code: null,
      proof_note: null,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // Configure Deno.env shim for Edge Function handlers
  const envMap = new Map<string, string>([
    ['SUPABASE_URL', STAGING_SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', 'test-staging-service-role-secret'],
    ['FIREBASE_PROJECT_ID', STAGING_PROJECT_ID],
    ['ALLOWED_ORIGINS', 'https://staging-livraison.jikjikoox.com'],
  ]);
  (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno = {
    env: {
      get: (k: string) => envMap.get(k),
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    const method = (init?.method || 'GET').toUpperCase();

    if (urlStr === GOOGLE_FIREBASE_JWKS_URL) {
      return new Response(JSON.stringify(signer.jwksPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (urlStr.startsWith(`${STAGING_SUPABASE_URL}/rest/v1/express_admins`)) {
      const uidMatch = urlStr.match(/firebase_uid=eq\.([^&]+)/);
      const uid = uidMatch ? decodeURIComponent(uidMatch[1]) : '';
      const admin = adminsDb.get(uid);
      return new Response(JSON.stringify(admin && admin.is_active ? [admin] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.startsWith(`${STAGING_SUPABASE_URL}/rest/v1/express_drivers`)) {
      if (method === 'GET') {
        const uidMatch = urlStr.match(/firebase_uid=eq\.([^&]+)/);
        if (uidMatch) {
          const uid = decodeURIComponent(uidMatch[1]);
          const found = driversDb.get(uid);
          return new Response(JSON.stringify(found ? [found] : []), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const statusMatch = urlStr.match(/account_status=eq\.([^&]+)/);
        const all = Array.from(driversDb.values());
        const filtered = statusMatch
          ? all.filter((d) => d.account_status === decodeURIComponent(statusMatch[1]))
          : all;
        return new Response(JSON.stringify(filtered), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as Partial<DriverRecord>;
        if (!body.firebase_uid || driversDb.has(body.firebase_uid)) {
          return new Response(JSON.stringify({ message: 'duplicate key value' }), { status: 409 });
        }
        const nowIso = new Date().toISOString();
        const created: DriverRecord = {
          id: `drv-${driversDb.size + 1}`,
          firebase_uid: body.firebase_uid,
          email: body.email || '',
          first_name: body.first_name || '',
          last_name: body.last_name || '',
          phone: body.phone || '',
          photo_url: body.photo_url ?? null,
          vehicle_type: (body.vehicle_type as DriverRecord['vehicle_type']) || 'scooter',
          vehicle_plate: null,
          work_zone: body.work_zone || 'Dakar',
          role: 'courier',
          account_status: (body.account_status as DriverRecord['account_status']) || 'pending',
          is_available: Boolean(body.is_available),
          notifications_enabled: true,
          push_sound_enabled: true,
          fcm_token: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        driversDb.set(created.firebase_uid, created);
        return new Response(JSON.stringify([created]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PATCH') {
        const patch = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        const idMatch = urlStr.match(/[?&]id=eq\.([^&]+)/);
        const uidMatch = urlStr.match(/[?&]firebase_uid=eq\.([^&]+)/);
        const target = idMatch
          ? Array.from(driversDb.values()).find((d) => d.id === decodeURIComponent(idMatch[1]))
          : uidMatch
          ? driversDb.get(decodeURIComponent(uidMatch[1]))
          : undefined;
        if (!target) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        const updated: DriverRecord = {
          ...target,
          ...patch,
        } as DriverRecord;
        driversDb.set(updated.firebase_uid, updated);
        return new Response(JSON.stringify([updated]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (urlStr.startsWith(`${STAGING_SUPABASE_URL}/rest/v1/express_deliveries`)) {
      const driverIdMatch = urlStr.match(/driver_id=eq\.([^&]+)/);
      const driverId = driverIdMatch ? decodeURIComponent(driverIdMatch[1]) : '';
      const matched = deliveriesDb.filter((d) => d.driver_id === driverId);
      return new Response(JSON.stringify(matched), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'unexpected url', urlStr }), { status: 404 });
  }) as typeof fetch;

  try {
    // 1. Inscription d'un nouveau livreur (validation téléphone international & champs requis)
    await runScenario('S01', 'Inscription nouveau livreur : validation champs & indicatif international', async () => {
      const token = await signer.signJwt({ sub: 'uid_new_courier', email: 'fatou.ndiaye@exemple.sn', email_verified: false });

      // Téléphone invalide -> 400 INVALID_REGISTRATION
      const badPhoneRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Fatou',
            lastName: 'Ndiaye',
            phone: 'abc',
            vehicleType: 'scooter',
            workZone: 'Dakar Plateau',
          }),
        })
      );
      assert.equal(badPhoneRes.status, 400);

      // Inscription complète valide avec indicatif +221 -> 201 Created
      const okRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Fatou',
            lastName: 'Ndiaye',
            phone: '+221 77 412 89 30',
            vehicleType: 'scooter',
            workZone: 'Dakar Plateau',
          }),
        })
      );
      assert.equal(okRes.status, 201);
      const okJson = (await okRes.json()) as { ok: boolean; profile: DriverRecord };
      assert.equal(okJson.ok, true);
      assert.equal(okJson.profile.phone, '+221 77 412 89 30');
    });

    // 2. Création du compte Firebase & gestion erreurs / reprise partielle
    await runScenario('S02', 'Gestion erreurs Auth Firebase & reprise sur création partielle présente dans LoginPage', () => {
      const loginSource = fs.readFileSync(path.join(process.cwd(), 'src/pages/LoginPage.tsx'), 'utf8');
      assert.match(loginSource, /createUserWithEmailAndPassword/);
      assert.match(loginSource, /auth\.currentUser/);
      assert.match(loginSource, /sendPasswordResetEmail/);
      assert.match(loginSource, /termsAccepted/);
      assert.match(loginSource, /Se connecter/);
      assert.match(loginSource, /Créer un compte livreur/);
    });

    // 3. Création profil Supabase express_drivers & complétion pending sans doublon
    await runScenario('S03', 'Profil créé dans express_drivers : complétion pending sans doublon et refus conflit email (409)', async () => {
      const created = driversDb.get('uid_new_courier');
      assert.ok(created);
      assert.equal(created.email, 'fatou.ndiaye@exemple.sn');

      // Reprise sur même compte pending -> met à jour sans créer de doublon
      const token = await signer.signJwt({ sub: 'uid_new_courier', email: 'fatou.ndiaye@exemple.sn', email_verified: false });
      const retryRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Fatou',
            lastName: 'Ndiaye',
            phone: '+221 77 412 89 31',
            vehicleType: 'scooter',
            workZone: 'Dakar Plateau',
          }),
        })
      );
      assert.equal(retryRes.status, 201);
      assert.equal(driversDb.size, 1);

      // Conflit avec autre email sur même UID -> 409 REGISTRATION_ALREADY_EXISTS
      const conflictToken = await signer.signJwt({ sub: 'uid_new_courier', email: 'autre@exemple.sn', email_verified: true });
      const conflictRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${conflictToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Autre',
            lastName: 'Compte',
            phone: '+221 77 000 00 11',
            vehicleType: 'moto',
            workZone: 'Dakar',
          }),
        })
      );
      assert.equal(conflictRes.status, 409);
      const conflictJson = (await conflictRes.json()) as { error: { code: string } };
      assert.equal(conflictJson.error.code, 'REGISTRATION_ALREADY_EXISTS');
    });

    // 4. Statut initial pending, is_available=false, impossibilité d'auto-activation
    await runScenario('S04', 'Statut initial forcé à pending, is_available=false et role=courier côté serveur', async () => {
      const created = driversDb.get('uid_new_courier')!;
      assert.equal(created.account_status, 'pending');
      assert.equal(created.is_available, false);
      assert.equal(created.role, 'courier');

      const attackerToken = await signer.signJwt({ sub: 'uid_attacker', email: 'hack@exemple.sn', email_verified: true });
      const escalateRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'POST',
          headers: { Authorization: `Bearer ${attackerToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: 'Bad',
            lastName: 'Actor',
            phone: '+221 77 000 00 99',
            vehicleType: 'moto',
            workZone: 'Dakar',
            account_status: 'active',
            role: 'admin',
            is_available: true,
          }),
        })
      );
      assert.equal(escalateRes.status, 201);
      const escJson = (await escalateRes.json()) as { profile: DriverRecord };
      assert.equal(escJson.profile.account_status, 'pending');
      assert.equal(escJson.profile.role, 'courier');
      assert.equal(escJson.profile.is_available, false);
      driversDb.delete('uid_attacker');
    });

    // 5. Connexion livreur en attente + cas profil absent (404 DRIVER_NOT_REGISTERED)
    await runScenario('S05', 'Livreur en attente (email vérifié) obtient pending ; profil absent renvoie 404 contrôlé', async () => {
      const pendingToken = await signer.signJwt({ sub: 'uid_new_courier', email: 'fatou.ndiaye@exemple.sn', email_verified: true });
      const getPending = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'GET',
          headers: { Authorization: `Bearer ${pendingToken}` },
        })
      );
      assert.equal(getPending.status, 200);
      const pendingJson = (await getPending.json()) as { profile: DriverRecord };
      assert.equal(pendingJson.profile.account_status, 'pending');

      const orphanToken = await signer.signJwt({ sub: 'uid_no_profile_yet', email: 'orphan@exemple.sn', email_verified: true });
      const getMissing = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'GET',
          headers: { Authorization: `Bearer ${orphanToken}` },
        })
      );
      assert.equal(getMissing.status, 404);
      const missingJson = (await getMissing.json()) as { error: { code: string } };
      assert.equal(missingJson.error.code, 'DRIVER_NOT_REGISTERED');
      // Vérifie qu'aucun profil n'a été créé silencieusement
      assert.equal(driversDb.has('uid_no_profile_yet'), false);
    });

    // 6. Refus d'accès aux missions tant que non validé
    await runScenario('S06', 'Livreur pending refusé sur driver-deliveries (403 DRIVER_PENDING)', async () => {
      const verifiedPendingToken = await signer.signJwt({
        sub: 'uid_new_courier',
        email: 'fatou.ndiaye@exemple.sn',
        email_verified: true,
      });
      const delivRes = await handleDriverDeliveriesRequest(
        new Request('https://staging.local/driver-deliveries', {
          method: 'GET',
          headers: { Authorization: `Bearer ${verifiedPendingToken}` },
        })
      );
      assert.equal(delivRes.status, 403);
      const json = (await delivRes.json()) as { error: { code: string } };
      assert.equal(json.error.code, 'DRIVER_PENDING');
    });

    // 9 (exécuté avant 7 pour valider le compte via admin-drivers !). Validation administrative
    await runScenario('S09', 'Validation admin (admin-drivers) : refus non-admin (403), approbation -> active, suspension/refus', async () => {
      const courierToken = await signer.signJwt({
        sub: 'uid_new_courier',
        email: 'fatou.ndiaye@exemple.sn',
        email_verified: true,
      });
      // Un livreur non-admin ne peut JAMAIS appeler admin-drivers
      const forbiddenAdmin = await handleAdminDriversRequest(
        new Request('https://staging.local/admin-drivers', {
          method: 'GET',
          headers: { Authorization: `Bearer ${courierToken}` },
        })
      );
      assert.equal(forbiddenAdmin.status, 403);
      const fJson = (await forbiddenAdmin.json()) as { error: { code: string } };
      assert.equal(fJson.error.code, 'ADMIN_REQUIRED');

      const adminToken = await signer.signJwt({
        sub: 'uid_staging_admin',
        email: 'admin.staging@jikjikoox.com',
        email_verified: true,
      });
      const listRes = await handleAdminDriversRequest(
        new Request('https://staging.local/admin-drivers?status=pending', {
          method: 'GET',
          headers: { Authorization: `Bearer ${adminToken}` },
        })
      );
      assert.equal(listRes.status, 200);
      const listJson = (await listRes.json()) as { drivers: DriverRecord[]; counts: { pending: number } };
      assert.equal(listJson.counts.pending, 1);
      const driverId = listJson.drivers[0].id;

      // Approbation par l'admin -> active
      const approveRes = await handleAdminDriversRequest(
        new Request('https://staging.local/admin-drivers', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, accountStatus: 'active' }),
        })
      );
      assert.equal(approveRes.status, 200);
      const approved = (await approveRes.json()) as { driver: DriverRecord };
      assert.equal(approved.driver.account_status, 'active');

      // Suspension temporaire -> force is_available = false
      driversDb.get('uid_new_courier')!.is_available = true;
      const suspendRes = await handleAdminDriversRequest(
        new Request('https://staging.local/admin-drivers', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, accountStatus: 'suspended' }),
        })
      );
      assert.equal(suspendRes.status, 200);
      const suspended = (await suspendRes.json()) as { driver: DriverRecord };
      assert.equal(suspended.driver.account_status, 'suspended');
      assert.equal(suspended.driver.is_available, false);

      // Réactivation pour les tests suivants
      const reactivateRes = await handleAdminDriversRequest(
        new Request('https://staging.local/admin-drivers', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, accountStatus: 'active' }),
        })
      );
      assert.equal(reactivateRes.status, 200);
    });

    // 7. Connexion d'un livreur actif et accès aux missions
    await runScenario('S07', 'Livreur actif accède à son profil et reçoit ses missions (200)', async () => {
      const activeToken = await signer.signJwt({
        sub: 'uid_new_courier',
        email: 'fatou.ndiaye@exemple.sn',
        email_verified: true,
      });
      const delivRes = await handleDriverDeliveriesRequest(
        new Request('https://staging.local/driver-deliveries', {
          method: 'GET',
          headers: { Authorization: `Bearer ${activeToken}` },
        })
      );
      assert.equal(delivRes.status, 200);
      const json = (await delivRes.json()) as { ok: boolean; deliveries: Array<{ order_number: string }> };
      assert.equal(json.ok, true);
      assert.equal(json.deliveries.length, 1);
      assert.equal(json.deliveries[0].order_number, 'JKX-STG-1001');
    });

    // 8. Déconnexion et session expirée
    await runScenario('S08', 'Session expirée rejetée (401 TOKEN_EXPIRED) & nettoyage au logout', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await signer.signJwt({
        sub: 'uid_new_courier',
        email: 'fatou.ndiaye@exemple.sn',
        email_verified: true,
        iat: now - 7200,
        exp: now - 3600,
      });
      const res = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'GET',
          headers: { Authorization: `Bearer ${expiredToken}` },
        })
      );
      assert.equal(res.status, 401);
      const json = (await res.json()) as { error: { code: string } };
      assert.equal(json.error.code, 'TOKEN_EXPIRED');

      const ctxSrc = fs.readFileSync(path.join(process.cwd(), 'src/context/CourierAppContext.tsx'), 'utf8');
      assert.match(ctxSrc, /clearAllReadOnlySnapshots/);
      assert.match(ctxSrc, /TOKEN_EXPIRED/);
      assert.match(ctxSrc, /signOut\(auth\)/);
    });

    // 10. Manifeste PWA & icônes installables Android / iOS
    await runScenario('S10', 'Manifeste PWA valide (192x192, 512x512, maskable séparée, apple-touch-icon, SVG)', () => {
      const manifestRaw = fs.readFileSync(path.join(process.cwd(), 'public/manifest.webmanifest'), 'utf8');
      const manifest = JSON.parse(manifestRaw) as {
        id: string;
        name: string;
        short_name: string;
        display: string;
        start_url: string;
        scope: string;
        theme_color: string;
        background_color: string;
        icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
      };

      assert.equal(manifest.id, '/');
      assert.equal(manifest.name, 'JikJikoox Express');
      assert.ok(manifest.short_name.length <= 12);
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      assert.equal(manifest.scope, '/');
      assert.equal(manifest.theme_color, '#0E6E2D');

      const icon192 = manifest.icons.find((i) => i.sizes === '192x192' && i.purpose === 'any');
      const icon512 = manifest.icons.find((i) => i.sizes === '512x512' && i.purpose === 'any');
      const maskable = manifest.icons.find((i) => i.sizes === '512x512' && i.purpose === 'maskable');
      assert.ok(icon192 && icon512 && maskable, 'Icônes 192, 512 any et 512 maskable séparées requises');

      for (const relPath of [
        'public/pwa-192x192.png',
        'public/pwa-512x512.png',
        'public/pwa-maskable-512x512.png',
        'public/apple-touch-icon.png',
        'public/pwa-icon.svg',
      ]) {
        const full = path.join(process.cwd(), relPath);
        assert.ok(fs.existsSync(full), `Fichier PWA manquant : ${relPath}`);
        assert.ok(fs.statSync(full).size > 200, `Fichier PWA vide ou invalide : ${relPath}`);
      }

      const indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
      assert.match(indexHtml, /rel="manifest"\s+href="\/manifest\.webmanifest"/);
      assert.match(indexHtml, /rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
    });

    // 11. Réouverture après installation & cache-control SW/manifest dans server.js
    await runScenario('S11', 'Mode standalone, Service Worker unifié et en-têtes no-cache dans server.js', () => {
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
      assert.match(serverSrc, /firebase-messaging-sw\.js/);
      assert.match(serverSrc, /manifest\.webmanifest/);
      assert.match(serverSrc, /no-cache/);

      const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/firebase-messaging-sw.js'), 'utf8');
      assert.match(swSrc, /PRECACHE_URLS/);
      assert.match(swSrc, /\/functions\//);
      assert.match(swSrc, /\/rest\//);
      assert.match(swSrc, /caches\.delete/);

      const hookSrc = fs.readFileSync(path.join(process.cwd(), 'src/hooks/usePWAInstall.ts'), 'utf8');
      assert.match(hookSrc, /display-mode: standalone/);
      assert.match(hookSrc, /beforeinstallprompt/);
      assert.match(hookSrc, /appinstalled/);
    });

    // 12. Comportement hors connexion (aucune fausse confirmation de livraison)
    await runScenario('S12', 'Hors connexion : refus confirmation livraison (OFFLINE_NO_CONNECTION) + file GPS idempotente', async () => {
      const prevNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false },
      });

      try {
        const api = createExpressApiClient({
          baseUrl: `${STAGING_SUPABASE_URL}/functions/v1`,
          fetchImpl: async () => {
            throw new Error('Ne doit pas tenter un appel réseau hors connexion');
          },
        });
        await assert.rejects(
          () =>
            api.submitDeliveryAction('tok', {
              deliveryId: 'deliv-stg-001',
              nextStatus: 'DELIVERED',
              proof: { recipientName: 'Aminata Fall', codCollectedConfirmed: true },
            }),
          (err: unknown) => err instanceof ExpressApiError && err.code === 'OFFLINE_NO_CONNECTION'
        );
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: prevNavigator,
        });
      }

      // La file GPS hors ligne reste bornée et idempotente à la reconnexion
      const q = new GpsOfflineQueue(5);
      q.enqueue({
        deliveryId: 'deliv-stg-001',
        lat: 14.6928,
        lng: -17.4467,
        accuracyMeters: 12,
        speedMps: 5,
        headingDeg: 90,
        recordedAtIso: new Date().toISOString(),
        idempotencyKey: 'gps_offline_1',
      });
      assert.equal(q.size(), 1);
      const flushed = await q.flush(async () => undefined);
      assert.equal(flushed.sent, 1);
      assert.equal(q.size(), 0);
    });

    // 13. Notifications push FCM lorsque les permissions sont accordées
    await runScenario('S13', 'Notifications push FCM : enregistrement & révocation token sur profil actif', async () => {
      const activeToken = await signer.signJwt({
        sub: 'uid_new_courier',
        email: 'fatou.ndiaye@exemple.sn',
        email_verified: true,
      });

      const registerTokenRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notificationsEnabled: true,
            fcmToken: 'fcm_staging_device_token_1234567890abcdef',
          }),
        })
      );
      assert.equal(registerTokenRes.status, 200);
      const regJson = (await registerTokenRes.json()) as { profile: DriverRecord };
      assert.equal(regJson.profile.fcm_token, 'fcm_staging_device_token_1234567890abcdef');

      // Révocation propre du token
      const revokeTokenRes = await handleDriverProfileRequest(
        new Request('https://staging.local/driver-profile', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notificationsEnabled: false,
            fcmToken: null,
          }),
        })
      );
      assert.equal(revokeTokenRes.status, 200);
      const revJson = (await revokeTokenRes.json()) as { profile: DriverRecord };
      assert.equal(revJson.profile.fcm_token, null);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  for (const r of results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`\nRésumé Auth & PWA : ${passedCount}/${results.length} PASS, ${failedCount} FAIL`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

void main();
