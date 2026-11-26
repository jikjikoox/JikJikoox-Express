import assert from 'node:assert/strict';
import {
  buildDemoParcelQrPayload,
  parseParcelQrPayload,
  validateParcelQrForMission,
} from '../src/lib/qrParcelValidation';

const sampleMission = {
  missionId: 'msn_demo_01',
  orderNumber: 'JKX-2026-8412',
};

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

test('Valide un numéro de commande brut (insensible à la casse et aux espaces)', () => {
  const res = validateParcelQrForMission('  jkx-2026-8412  ', sampleMission);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.matchedBy, 'orderNumber');
    assert.equal(res.proofCodeValue, 'QR:JKX-2026-8412');
    assert.ok(res.proofCodeValue.length <= 32);
  }
});

test('Valide un QR code JSON contenant un code de remise', () => {
  const payload = JSON.stringify({
    orderNumber: 'JKX-2026-8412',
    missionId: 'msn_demo_01',
    code: '4829',
  });
  const res = validateParcelQrForMission(payload, sampleMission);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.proofCodeValue, '4829');
    assert.match(res.verificationNote, /scan QR/);
  }
});

test('Valide une URL de suivi JikJikoox avec paramètres', () => {
  const res = validateParcelQrForMission(
    'https://livraison.jikjikoox.com/track/JKX-2026-8412?otp=9041',
    sampleMission
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.proofCodeValue, '9041');
  }
});

test('Valide le format délimité JKX|ORDER|CODE et préfixé JKX:ORDER', () => {
  const piped = validateParcelQrForMission('JKX|JKX-2026-8412|7731', sampleMission);
  assert.equal(piped.ok, true);
  if (piped.ok) assert.equal(piped.proofCodeValue, '7731');

  const prefixed = validateParcelQrForMission('JKX:JKX-2026-8412', sampleMission);
  assert.equal(prefixed.ok, true);
});

test('Valide la charge utile du mode Démonstration', () => {
  const payload = buildDemoParcelQrPayload(sampleMission);
  const res = validateParcelQrForMission(payload, sampleMission);
  assert.equal(res.ok, true);
});

test('Rejette un QR code appartenant à un autre colis', () => {
  const res = validateParcelQrForMission('JKX-2026-9999', sampleMission);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.message, /JKX-2026-9999/);
    assert.match(res.message, /JKX-2026-8412/);
  }
});

test('Rejette un QR code vide et tronque les codes > 32 caractères', () => {
  const empty = validateParcelQrForMission('   ', sampleMission);
  assert.equal(empty.ok, false);

  const parsed = parseParcelQrPayload(
    JSON.stringify({ orderNumber: 'JKX-2026-8412', code: 'A'.repeat(60) })
  );
  assert.equal(parsed.orderNumber, 'JKX-2026-8412');
  const longCode = validateParcelQrForMission(
    JSON.stringify({ orderNumber: 'JKX-2026-8412', code: 'A'.repeat(60) }),
    sampleMission
  );
  assert.equal(longCode.ok, true);
  if (longCode.ok) {
    assert.equal(longCode.proofCodeValue.length, 32);
  }
});

console.log(`ALL ${passed} QR PARCEL VALIDATION TESTS PASSED`);
