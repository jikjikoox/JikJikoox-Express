import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_TRANSITIONS,
  isTransitionAllowed,
  MISSION_STATUS_META,
} from '../src/lib/missionWorkflow';
import {
  buildDemoMissions,
  buildDemoNotifications,
  DEMO_COURIER_PROFILE,
} from '../src/data/demo/mockCourierData';
import type { MissionStatus } from '../src/types/delivery';

const ROOT = process.cwd();
const firestoreRules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const storageRules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
const demoSource = fs.readFileSync(path.join(ROOT, 'src/data/demo/mockCourierData.ts'), 'utf8');
const contextSource = fs.readFileSync(path.join(ROOT, 'src/context/CourierAppContext.tsx'), 'utf8');

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function runCheck(id: string, name: string, fn: () => void) {
  try {
    fn();
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

// 1. Default deny & zero permissive rules
runCheck('S01', 'Firestore rules : refus global par défaut et aucune règle permissive', () => {
  assert.match(firestoreRules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.doesNotMatch(firestoreRules, /allow\s+(read|write|read,\s*write)\s*:\s*if\s+true\s*;/);
});

// 2. No hardcoded admin email in rules or frontend
runCheck('S02', 'Rôle administrateur : aucun email codé en dur, collection /admins serveur-only', () => {
  assert.doesNotMatch(firestoreRules, /token\.email\s*==\s*['"][^'"]+@/);
  assert.match(firestoreRules, /match \/admins\/\{adminUid\}[\s\S]*?allow list, create, update, delete: if false;/);
  assert.match(firestoreRules, /exists\(\/databases\/\$\(database\)\/documents\/admins\/\$\(request\.auth\.uid\)\)/);
});

// 3. Pending courier onboarding (cannot self-activate to active)
runCheck('S03', 'Inscription livreur : statut initial obligatoirement pending et isAvailable=false', () => {
  assert.match(firestoreRules, /incoming\(\)\.accountStatus == 'pending'/);
  assert.match(firestoreRules, /incoming\(\)\.isAvailable == false/);
  assert.match(contextSource, /accountStatus:\s*'pending'/);
  assert.match(contextSource, /isAvailable:\s*false/);
});

// 4. Active courier enforcement across missions, events, proofs, notifications
runCheck('S04', 'Contrôle livreur actif : isActiveCourier() exigé sur missions, events, proofs, notifications', () => {
  assert.match(firestoreRules, /function isActiveCourier\(\)[\s\S]*?accountStatus == 'active'/);
  const occurrences = firestoreRules.match(/isActiveCourier\(\)/g) ?? [];
  assert.ok(occurrences.length >= 10, `Attendu >= 10 garde-fous isActiveCourier(), trouvé ${occurrences.length}`);
});

// 5. Courier cannot create or delete missions or notifications
runCheck('S05', 'Missions & notifications : création/suppression strictement réservées à isAdmin()', () => {
  const missionBlock = firestoreRules.split('match /missions/{missionId}')[1].split('match /delivery_events/{eventId}')[0];
  assert.match(missionBlock, /allow create:[\s\S]*?isAdmin\(\);/);
  assert.doesNotMatch(missionBlock, /demo_sandbox/);
  assert.match(missionBlock, /allow delete:\s*if\s+isValidId\(missionId\)\s*&&\s*isAdmin\(\);/);
});

// 6. Operational mirror: couriers cannot mutate /missions directly in Firestore (backend-only writes)
runCheck('S06', 'Miroir Firestore missions : lecture seule livreur, écritures réservées backend/isAdmin()', () => {
  const missionBlock = firestoreRules.split('match /missions/{missionId}')[1].split('match /delivery_events/{eventId}')[0];
  assert.match(missionBlock, /allow create:[\s\S]*?isAdmin\(\);/);
  assert.match(missionBlock, /allow update:[\s\S]*?isAdmin\(\);/);
  assert.match(missionBlock, /allow delete:\s*if\s+isValidId\(missionId\)\s*&&\s*isAdmin\(\);/);
  assert.doesNotMatch(missionBlock, /isAllowedMissionTransition/);
  assert.match(missionBlock, /incoming\(\)\.orderNumber == existing\(\)\.orderNumber/);
});

// 7. Immutable delivery_events & delivery_proofs (backend-only create, update/delete forbidden)
runCheck('S07', 'Immuabilité preuves & historique : création backend/isAdmin() uniquement, update/delete interdits', () => {
  const eventsBlock = firestoreRules.split('match /delivery_events/{eventId}')[1].split('match /delivery_proofs/{proofId}')[0];
  const proofsBlock = firestoreRules.split('match /delivery_proofs/{proofId}')[1].split('match /notifications/{notificationId}')[0];
  assert.match(eventsBlock, /allow create:[\s\S]*?isAdmin\(\);/);
  assert.match(eventsBlock, /allow update, delete: if false;/);
  assert.match(proofsBlock, /allow create:[\s\S]*?isAdmin\(\);/);
  assert.match(proofsBlock, /allow update, delete: if false;/);
});

// 8. Firebase Storage delivery proof paths must be client-denied (Supabase signed upload only).
runCheck('S08', 'Firebase Storage : uploads de preuve bloqués côté client; upload via URL Supabase signée', () => {
  assert.match(storageRules, /match \/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  const proofBlock = storageRules.split('match /delivery_proofs/{courierId}/{missionId}/{fileName}')[1].split('match /courier_avatars')[0];
  assert.match(proofBlock, /allow read, write: if false;/);
  assert.doesNotMatch(proofBlock, /allow create|allow update|request\.resource/);
  assert.match(contextSource, /prepareDeliveryProofUpload/);
  assert.match(contextSource, /uploadPhotoToSignedUrl/);
});

// 9. Workflow state machine: valid path allowed, shortcuts & terminal mutations blocked// 9. Workflow state machine: valid path allowed, shortcuts & terminal mutations blocked
runCheck('S09', 'Machine à états : transitions valides acceptées, sauts et états terminaux refusés', () => {
  assert.equal(isTransitionAllowed('ASSIGNED', 'ACCEPTED'), true);
  assert.equal(isTransitionAllowed('ACCEPTED', 'PICKED_UP'), true);
  assert.equal(isTransitionAllowed('PICKED_UP', 'IN_TRANSIT'), true);
  assert.equal(isTransitionAllowed('IN_TRANSIT', 'ARRIVED'), true);
  assert.equal(isTransitionAllowed('ARRIVED', 'DELIVERED'), true);
  assert.equal(isTransitionAllowed('ARRIVED', 'FAILED'), true);
  assert.equal(isTransitionAllowed('FAILED', 'RETURN_REQUIRED'), true);
  assert.equal(isTransitionAllowed('RETURN_REQUIRED', 'RETURNED'), true);

  // Sauts interdits
  assert.equal(isTransitionAllowed('ASSIGNED', 'DELIVERED'), false);
  assert.equal(isTransitionAllowed('ASSIGNED', 'IN_TRANSIT'), false);
  assert.equal(isTransitionAllowed('ACCEPTED', 'ARRIVED'), false);
  assert.equal(isTransitionAllowed('PICKED_UP', 'DELIVERED'), false);

  // États terminaux verrouillés
  const terminalStatuses: MissionStatus[] = ['DELIVERED', 'REFUSED', 'RETURNED', 'CANCELLED'];
  const allStatuses = Object.keys(MISSION_STATUS_META) as MissionStatus[];
  for (const term of terminalStatuses) {
    assert.equal(ALLOWED_TRANSITIONS[term].length, 0);
    for (const next of allStatuses) {
      assert.equal(isTransitionAllowed(term, next), false);
    }
  }
});

// 10. Strict demo mode isolation (zero Firebase imports, local_demo tag, rejected by Firestore rules)
runCheck('S10', 'Mode démonstration Dakar : isolation locale totale sans écriture Firestore', () => {
  assert.doesNotMatch(demoSource, /firebase\/firestore|firebase\/auth|\.\.\/lib\/firebase/);
  assert.doesNotMatch(contextSource, /seedSandboxDataInFirestore/);

  const demoMissions = buildDemoMissions(DEMO_COURIER_PROFILE.uid);
  const demoNotifs = buildDemoNotifications(DEMO_COURIER_PROFILE.uid);
  assert.ok(demoMissions.length > 0);
  assert.ok(demoNotifs.length > 0);
  assert.ok(demoMissions.every((m) => m.dataSource === 'local_demo'));
  assert.ok(demoNotifs.every((n) => n.dataSource === 'local_demo'));

  // Firestore rules strictly require supabase_sync
  assert.match(firestoreRules, /data\.dataSource == 'supabase_sync'/);
});

const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.length - passedCount;

for (const r of results) {
  console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
console.log(`\nRésumé : ${passedCount}/${results.length} PASS, ${failedCount} FAIL`);

if (failedCount > 0) {
  process.exit(1);
}
