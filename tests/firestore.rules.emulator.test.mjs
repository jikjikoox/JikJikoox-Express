/**
 * Suite de tests Firebase Emulator Suite — 13 scénarios de sécurité Firestore
 *
 * Prérequis d'exécution (machine équipée de Java JDK 17+ et @firebase/rules-unit-testing) :
 *   npm install --save-dev @firebase/rules-unit-testing
 *   firebase emulators:exec "node tests/firestore.rules.emulator.test.mjs"
 */

import test from 'node:test';
import fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'livraisonjikjikoox-test';
const rules = fs.readFileSync('firestore.rules', 'utf8');

let testEnv;

const baseCourier = (uid, accountStatus) => ({
  uid,
  firstName: 'Moussa',
  lastName: 'Diop',
  email: `${uid}@jikjikoox.com`,
  phone: '+221 77 482 19 30',
  photoUrl: '/src/assets/images/courier_avatar_1795601739751.jpg',
  vehicleType: 'scooter',
  vehiclePlate: 'DK-4821-AM',
  workZone: 'Dakar Plateau',
  isAvailable: accountStatus === 'active',
  role: 'courier',
  accountStatus,
  notificationsEnabled: true,
  pushSoundEnabled: true,
  fcmTokenStatus: 'registered',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const baseMission = (missionId, courierId, status = 'ASSIGNED') => ({
  missionId,
  orderNumber: 'JKX-2026-9001',
  courierId,
  dataSource: 'supabase_sync',
  customerName: 'Aïssatou Ndiaye',
  customerPhone: '+221 77 615 44 18',
  deliveryAddress: 'Avenue Peytavin, Dakar Plateau',
  deliveryZone: 'Dakar Plateau',
  pickupName: 'Maison Teranga Bio',
  pickupAddress: 'Point E, Dakar',
  itemsSummary: [{ name: 'Bissap 1L', quantity: 2 }],
  itemCount: 2,
  paymentMode: 'cod',
  codAmount: 18500,
  estimatedFee: 2000,
  instructions: 'Appeler devant le portail.',
  status,
  events: [{ status: 'ASSIGNED', label: 'Affectée', timestampIso: new Date().toISOString(), actor: 'system' }],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, 'couriers', 'driverA'), baseCourier('driverA', 'active'));
    await setDoc(doc(adminDb, 'couriers', 'driverB'), baseCourier('driverB', 'active'));
    await setDoc(doc(adminDb, 'couriers', 'driverSuspended'), baseCourier('driverSuspended', 'suspended'));
    await setDoc(doc(adminDb, 'couriers', 'driverPending'), baseCourier('driverPending', 'pending'));

    await setDoc(doc(adminDb, 'missions', 'm_driverA'), baseMission('m_driverA', 'driverA', 'ASSIGNED'));
    await setDoc(doc(adminDb, 'missions', 'm_driverB'), baseMission('m_driverB', 'driverB', 'ASSIGNED'));
    await setDoc(doc(adminDb, 'missions', 'm_suspended'), baseMission('m_suspended', 'driverSuspended', 'ASSIGNED'));
    await setDoc(doc(adminDb, 'missions', 'm_pending'), baseMission('m_pending', 'driverPending', 'ASSIGNED'));
    await setDoc(doc(adminDb, 'missions', 'm_delivered'), {
      ...baseMission('m_delivered', 'driverA', 'DELIVERED'),
      recipientName: 'Aïssatou Ndiaye',
    });

    await setDoc(doc(adminDb, 'delivery_proofs', 'prf_01'), {
      proofId: 'prf_01',
      missionId: 'm_delivered',
      orderNumber: 'JKX-2026-9001',
      courierId: 'driverA',
      recipientName: 'Aïssatou Ndiaye',
      codCollectedConfirmed: true,
      createdAt: serverTimestamp(),
    });
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

const verifiedCtx = (uid) =>
  testEnv.authenticatedContext(uid, { email: `${uid}@jikjikoox.com`, email_verified: true });

test('1. Utilisateur non connecté : refus', async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauthDb, 'missions', 'm_driverA')));
  await assertFails(getDoc(doc(unauthDb, 'couriers', 'driverA')));
});

test('2. Livreur actif : accès à ses propres missions', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertSucceeds(getDoc(doc(dbA, 'missions', 'm_driverA')));
  await assertSucceeds(
    getDocs(query(collection(dbA, 'missions'), where('courierId', '==', 'driverA')))
  );
});

test('3. Livreur A : refus d’accès aux missions du livreur B', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(getDoc(doc(dbA, 'missions', 'm_driverB')));
  await assertFails(
    getDocs(query(collection(dbA, 'missions'), where('courierId', '==', 'driverB')))
  );
});

test('4. Livreur suspendu : refus', async () => {
  const dbSusp = verifiedCtx('driverSuspended').firestore();
  await assertFails(getDoc(doc(dbSusp, 'missions', 'm_suspended')));
  await assertFails(
    updateDoc(doc(dbSusp, 'couriers', 'driverSuspended'), {
      isAvailable: true,
      updatedAt: serverTimestamp(),
    })
  );
});

test('5. Utilisateur en attente (pending) : refus des missions réelles et auto-activation', async () => {
  const dbPend = verifiedCtx('driverPending').firestore();
  await assertFails(getDoc(doc(dbPend, 'missions', 'm_pending')));
  await assertFails(
    updateDoc(doc(dbPend, 'couriers', 'driverPending'), {
      accountStatus: 'active',
      updatedAt: serverTimestamp(),
    })
  );
});

test('6. Livreur : refus de modifier les montants (codAmount / estimatedFee)', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    updateDoc(doc(dbA, 'missions', 'm_driverA'), {
      codAmount: 0,
      updatedAt: serverTimestamp(),
    })
  );
});

test('7. Livreur : refus de modifier l’attribution (courierId)', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    updateDoc(doc(dbA, 'missions', 'm_driverB'), {
      courierId: 'driverA',
      updatedAt: serverTimestamp(),
    })
  );
});

test('8. Livreur : refus de créer une mission', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    setDoc(doc(dbA, 'missions', 'm_forged'), baseMission('m_forged', 'driverA', 'ASSIGNED'))
  );
});

test('9. Livreur : refus de supprimer ou modifier une preuve de livraison', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(deleteDoc(doc(dbA, 'delivery_proofs', 'prf_01')));
  await assertFails(
    updateDoc(doc(dbA, 'delivery_proofs', 'prf_01'), { recipientName: 'Modifié' })
  );
});

test('10. Livreur : refus de modifier son rôle ou d’écrire dans /admins', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    updateDoc(doc(dbA, 'couriers', 'driverA'), {
      role: 'admin',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    setDoc(doc(dbA, 'admins', 'driverA'), { uid: 'driverA', active: true, grantedAt: serverTimestamp() })
  );
});

test('11. Mode démonstration : rejet absolu de données local_demo dans Firestore', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    setDoc(doc(dbA, 'missions', 'm_demo_attempt'), {
      ...baseMission('m_demo_attempt', 'driverA', 'ASSIGNED'),
      dataSource: 'local_demo',
    })
  );
});

test('12. Mission terminée : transitions interdites refusées', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    updateDoc(doc(dbA, 'missions', 'm_delivered'), {
      status: 'IN_TRANSIT',
      updatedAt: serverTimestamp(),
    })
  );
});

test('13. Miroir lecture seule : un livreur actif ne peut pas modifier le statut directement dans Firestore', async () => {
  const dbA = verifiedCtx('driverA').firestore();
  await assertFails(
    updateDoc(doc(dbA, 'missions', 'm_driverA'), {
      status: 'ACCEPTED',
      updatedAt: serverTimestamp(),
    })
  );
});
