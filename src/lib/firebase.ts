import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import defaultFirebaseConfig from '../../firebase-applet-config.json';

const PROTECTED_PROD_PROJECT_ID = 'livraisonjikjikoox';
const PROTECTED_PROD_AUTH_DOMAIN = 'livraisonjikjikoox.firebaseapp.com';
const PROTECTED_PROD_STORAGE_BUCKET = 'livraisonjikjikoox.firebasestorage.app';

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const appEnv = (metaEnv.VITE_APP_ENV || '').trim().toLowerCase();

const hasStagingFirebaseOverrides = Boolean(
  metaEnv.VITE_FIREBASE_PROJECT_ID?.trim() && metaEnv.VITE_FIREBASE_API_KEY?.trim()
);

function resolveFirebaseConfig() {
  if (appEnv === 'staging') {
    const projectId = (metaEnv.VITE_FIREBASE_PROJECT_ID || '').trim();
    const apiKey = (metaEnv.VITE_FIREBASE_API_KEY || '').trim();
    const authDomain = (metaEnv.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
    const storageBucket = (metaEnv.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
    const messagingSenderId = (metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
    const appId = (metaEnv.VITE_FIREBASE_APP_ID || '').trim();
    const firestoreDatabaseId = (metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '(default)').trim();

    if (!projectId || !apiKey || !authDomain || !storageBucket || !messagingSenderId || !appId) {
      throw new Error(
        'STAGING_CONFIG_INCOMPLETE: Les variables VITE_FIREBASE_* de staging sont obligatoires lorsque VITE_APP_ENV=staging.'
      );
    }
    if (
      projectId === PROTECTED_PROD_PROJECT_ID ||
      authDomain === PROTECTED_PROD_AUTH_DOMAIN ||
      storageBucket === PROTECTED_PROD_STORAGE_BUCKET
    ) {
      throw new Error(
        'STAGING_PROD_COLLISION_BLOCKED: Refus d’initialiser le mode staging sur le projet Firebase de production (livraisonjikjikoox).'
      );
    }

    return {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      firestoreDatabaseId,
    };
  }

  if (hasStagingFirebaseOverrides) {
    return {
      apiKey: metaEnv.VITE_FIREBASE_API_KEY!.trim(),
      authDomain: (metaEnv.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.authDomain).trim(),
      projectId: metaEnv.VITE_FIREBASE_PROJECT_ID!.trim(),
      storageBucket: (
        metaEnv.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.storageBucket
      ).trim(),
      messagingSenderId: (
        metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId
      ).trim(),
      appId: (metaEnv.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.appId).trim(),
      firestoreDatabaseId: (
        metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || defaultFirebaseConfig.firestoreDatabaseId
      ).trim(),
    };
  }

  return defaultFirebaseConfig;
}

const firebaseConfig = resolveFirebaseConfig();

export const firebaseApp = initializeApp(firebaseConfig);
const app = firebaseApp;

export const firebasePublicConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
};

export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const firebaseProjectInfo = {
  environment: appEnv || 'default',
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
  authDomain: firebaseConfig.authDomain,
};

let connectionTested = false;

/**
 * Vérification de connectivité Firestore déclenchée uniquement après authentification
 * Firebase réelle (jamais appelée en mode démonstration local).
 */
export async function testFirestoreConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Configuration Firebase : client Firestore hors ligne.');
      return false;
    }
    // Une erreur permission-denied confirme que Firestore répond en ligne.
    return true;
  }
}
