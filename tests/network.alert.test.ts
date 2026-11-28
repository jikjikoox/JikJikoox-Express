import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createExpressApiClient, ExpressApiError } from '../src/services/expressApi';
import {
  classifySupabaseNetworkError,
  isCriticalSupabaseNetworkError,
} from '../src/lib/supabaseNetworkErrors';

async function runTests() {
  let passed = 0;

  // Test 1: ExpressApiError captures Supabase endpoint name on network failure
  {
    const failingClient = createExpressApiClient({
      baseUrl: 'https://bwicndbbxvthbddiacks.supabase.co/functions/v1',
      maxRetries: 0,
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });

    let caught: unknown;
    try {
      await failingClient.fetchDriverDeliveries('fake-firebase-token');
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof ExpressApiError, 'Expected ExpressApiError');
    assert.equal(caught.code, 'NETWORK_UNREACHABLE');
    assert.equal(caught.endpoint, 'driver-deliveries');
    const classified = classifySupabaseNetworkError(caught, {
      afterConnectionLoss: true,
      hasCachedSnapshot: true,
      isOnline: true,
    });
    assert.ok(classified, 'Expected classified critical network error');
    assert.equal(classified.endpoint, 'driver-deliveries');
    assert.equal(classified.afterConnectionLoss, true);
    assert.equal(classified.hasCachedSnapshot, true);
    assert.match(classified.endpointLabel, /driver-deliveries/);
    assert.match(classified.message, /perte de connexion/i);
    console.log('[PASS] T01 — ExpressApiError et classification après perte de connexion (driver-deliveries)');
    passed++;
  }

  // Test 2: 503 Gateway / Edge Function unavailable is classified as critical network error
  {
    const err503 = new ExpressApiError('HTTP_503', 'Service Unavailable', 503, 'driver-profile');
    assert.equal(isCriticalSupabaseNetworkError(err503), true);
    const classified = classifySupabaseNetworkError(err503, {
      afterConnectionLoss: true,
      hasCachedSnapshot: false,
      isOnline: true,
    });
    assert.ok(classified);
    assert.equal(classified.endpoint, 'driver-profile');
    assert.equal(classified.status, 503);
    assert.match(classified.message, /temporairement indisponibles/i);
    console.log('[PASS] T02 — Erreur 503 Supabase Edge Function classifiée comme critique');
    passed++;
  }

  // Test 3: Offline state overrides message cleanly
  {
    const errOffline = new ExpressApiError(
      'OFFLINE_NO_CONNECTION',
      'Offline',
      0,
      'driver-notifications'
    );
    const classified = classifySupabaseNetworkError(errOffline, {
      afterConnectionLoss: false,
      hasCachedSnapshot: true,
      isOnline: false,
    });
    assert.ok(classified);
    assert.equal(classified.code, 'OFFLINE_NO_CONNECTION');
    assert.equal(classified.afterConnectionLoss, true);
    assert.match(classified.endpointLabel, /driver-notifications/);
    console.log('[PASS] T03 — Coupure hors connexion détectée sur driver-notifications');
    passed++;
  }

  // Test 4: Business/auth errors must NOT trigger critical network alert
  {
    const nonNetworkErrors = [
      new ExpressApiError('TOKEN_EXPIRED', 'Expired', 401, 'driver-profile'),
      new ExpressApiError('DRIVER_NOT_REGISTERED', 'Not found', 404, 'driver-profile'),
      new ExpressApiError('DRIVER_PENDING', 'Pending', 403, 'driver-deliveries'),
      new ExpressApiError('INVALID_TRANSITION', 'Invalid', 400, 'delivery-action'),
    ];
    for (const err of nonNetworkErrors) {
      assert.equal(isCriticalSupabaseNetworkError(err), false, `${err.code} should not be critical network error`);
      assert.equal(
        classifySupabaseNetworkError(err, {
          afterConnectionLoss: true,
          hasCachedSnapshot: false,
          isOnline: true,
        }),
        null
      );
    }
    console.log('[PASS] T04 — Erreurs métier/auth ignorées par l’alerte réseau critique');
    passed++;
  }

  // Test 5: GlobalNetworkAlert is wired directly inside CourierExpressRouter
  {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const routerStart = appSource.indexOf('function CourierExpressRouter()');
    assert.ok(routerStart > -1, 'CourierExpressRouter should exist in src/App.tsx');
    const routerBlock = appSource.slice(routerStart);
    assert.ok(
      routerBlock.includes('<GlobalNetworkAlert />'),
      'GlobalNetworkAlert must be rendered inside CourierExpressRouter'
    );
    console.log('[PASS] T05 — GlobalNetworkAlert intégré directement dans CourierExpressRouter');
    passed++;
  }

  console.log(`\nRésumé Alerte Réseau Supabase : ${passed}/5 PASS, 0 FAIL`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
