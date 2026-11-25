#!/usr/bin/env node
/**
 * Garde-fou anti-production JikJikoox Express (Pré-vol Staging)
 *
 * Vérifie strictement qu'une configuration staging (frontend et/ou backend)
 * ne cible AUCUNE ressource de production avant build, migration ou déploiement.
 *
 * Usage :
 *   node scripts/validate-staging-env.mjs .env.staging
 *   node scripts/validate-staging-env.mjs .env.staging --backend
 *   node scripts/validate-staging-env.mjs --self-test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const PRODUCTION_GUARD_CONSTANTS = Object.freeze({
  forbiddenFirebaseProjects: ['livraisonjikjikoox'],
  forbiddenFirebaseDomains: [
    'livraisonjikjikoox.firebaseapp.com',
    'livraisonjikjikoox.firebasestorage.app',
    'livraisonjikjikoox.web.app',
  ],
  forbiddenFirestoreDatabases: ['ai-studio-eb90a3f1-6fee-48a3-8c68-e411d0bf546d'],
  forbiddenProductionHosts: [
    'livraison.jikjikoox.com',
    'www.jikjikoox.com',
    'admin.jikjikoox.com',
    'jikjikoox.com',
  ],
  forbiddenFrontendKeys: [
    'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'FIREBASE_SERVICE_ACCOUNT_EMAIL',
    'INTERNAL_SYNC_SECRET',
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_FIREBASE_PRIVATE_KEY',
    'VITE_INTERNAL_SYNC_SECRET',
  ],
  requiredFrontendVars: [
    'VITE_APP_ENV',
    'VITE_SUPABASE_FUNCTIONS_URL',
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ],
  requiredBackendVars: [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_PROJECT_ID',
    'FIRESTORE_DATABASE_ID',
    'FIREBASE_SERVICE_ACCOUNT_EMAIL',
    'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'ALLOWED_ORIGINS',
    'INTERNAL_SYNC_SECRET',
  ],
});

export function parseDotEnv(content) {
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

function extractHostname(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isPlaceholder(val) {
  return !val || /YOUR_|REPLACE_ME|CHANGEME|EXAMPLE/i.test(val);
}

/**
 * Valide un dictionnaire de variables staging et retourne { ok, errors, warnings }.
 * Ne retourne JAMAIS de valeurs sensibles dans les messages d'erreur.
 */
export function validateStagingConfig(envMap, options = {}) {
  const { checkBackend = false, prodSupabaseHost = '' } = options;
  const errors = [];
  const warnings = [];

  // 1. Mode staging explicite
  if ((envMap.VITE_APP_ENV || '').toLowerCase() !== 'staging') {
    errors.push('VITE_APP_ENV doit être explicitement défini à "staging".');
  }

  // 2. Présence des variables frontend obligatoires (sans placeholders)
  for (const key of PRODUCTION_GUARD_CONSTANTS.requiredFrontendVars) {
    const val = (envMap[key] || '').trim();
    if (isPlaceholder(val)) {
      errors.push(`Variable frontend staging manquante ou placeholder non remplacé : ${key}.`);
    }
  }

  // 3. Interdiction absolue de secrets backend dans un fichier frontend
  if (!checkBackend) {
    for (const secretKey of PRODUCTION_GUARD_CONSTANTS.forbiddenFrontendKeys) {
      if (secretKey in envMap && envMap[secretKey].trim() !== '') {
        errors.push(`FUITE DE SECRET INTERDITE côté frontend : ${secretKey} ne doit jamais figurer dans le fichier frontend.`);
      }
    }
  }

  // 4. Blocage explicite du projet Firebase de production
  const fbProject = (envMap.VITE_FIREBASE_PROJECT_ID || '').trim().toLowerCase();
  const fbAuthDomain = (envMap.VITE_FIREBASE_AUTH_DOMAIN || '').trim().toLowerCase();
  const fbBucket = (envMap.VITE_FIREBASE_STORAGE_BUCKET || '').trim().toLowerCase();
  const fbDb = (envMap.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '').trim();

  if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirebaseProjects.includes(fbProject)) {
    errors.push(`COLLISION PRODUCTION BLOQUÉE : VITE_FIREBASE_PROJECT_ID pointe sur la production (${fbProject}).`);
  }
  if (fbProject && !fbProject.includes('staging') && !fbProject.includes('stg') && !fbProject.includes('dev')) {
    warnings.push('Convention recommandée : nommer le projet Firebase staging avec le suffixe "-staging".');
  }
  if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirebaseDomains.includes(fbAuthDomain)) {
    errors.push('COLLISION PRODUCTION BLOQUÉE : VITE_FIREBASE_AUTH_DOMAIN pointe sur la production.');
  }
  if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirebaseDomains.includes(fbBucket)) {
    errors.push('COLLISION PRODUCTION BLOQUÉE : VITE_FIREBASE_STORAGE_BUCKET pointe sur la production.');
  }
  if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirestoreDatabases.includes(fbDb)) {
    errors.push('COLLISION PRODUCTION BLOQUÉE : VITE_FIREBASE_FIRESTORE_DATABASE_ID référence la base protégée existante.');
  }

  // 5. Validation URLs Frontend & Supabase Functions
  const appUrl = (envMap.APP_URL || '').trim();
  if (appUrl) {
    const appHost = extractHostname(appUrl);
    if (PRODUCTION_GUARD_CONSTANTS.forbiddenProductionHosts.includes(appHost)) {
      errors.push(`COLLISION PRODUCTION BLOQUÉE : APP_URL pointe sur un domaine de production (${appHost}).`);
    }
  }

  const fnUrl = (envMap.VITE_SUPABASE_FUNCTIONS_URL || '').trim();
  if (fnUrl && !isPlaceholder(fnUrl)) {
    if (!fnUrl.startsWith('https://') || !fnUrl.includes('/functions/v1')) {
      errors.push('VITE_SUPABASE_FUNCTIONS_URL doit être en HTTPS et pointer vers /functions/v1.');
    }
    const fnHost = extractHostname(fnUrl);
    if (PRODUCTION_GUARD_CONSTANTS.forbiddenProductionHosts.includes(fnHost)) {
      errors.push(`COLLISION PRODUCTION BLOQUÉE : VITE_SUPABASE_FUNCTIONS_URL cible un hôte de production (${fnHost}).`);
    }
    if (prodSupabaseHost && fnHost === prodSupabaseHost.toLowerCase()) {
      errors.push('COLLISION PRODUCTION BLOQUÉE : VITE_SUPABASE_FUNCTIONS_URL correspond au projet Supabase de production.');
    }
  }

  // 6. Contrôle optionnel des secrets backend staging (pré-déploiement Edge Functions)
  if (checkBackend) {
    for (const key of PRODUCTION_GUARD_CONSTANTS.requiredBackendVars) {
      const val = (envMap[key] || '').trim();
      if (isPlaceholder(val)) {
        errors.push(`Secret backend staging manquant ou placeholder : ${key}.`);
      }
    }

    const backendFbProject = (envMap.FIREBASE_PROJECT_ID || '').trim().toLowerCase();
    if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirebaseProjects.includes(backendFbProject)) {
      errors.push('COLLISION PRODUCTION BLOQUÉE : FIREBASE_PROJECT_ID backend pointe sur la production.');
    }
    if (fbProject && backendFbProject && fbProject !== backendFbProject) {
      errors.push('INCOHÉRENCE STAGING : VITE_FIREBASE_PROJECT_ID et FIREBASE_PROJECT_ID doivent être identiques.');
    }

    const backendDb = (envMap.FIRESTORE_DATABASE_ID || '').trim();
    if (PRODUCTION_GUARD_CONSTANTS.forbiddenFirestoreDatabases.includes(backendDb)) {
      errors.push('COLLISION PRODUCTION BLOQUÉE : FIRESTORE_DATABASE_ID backend référence la base protégée.');
    }

    const saEmail = (envMap.FIREBASE_SERVICE_ACCOUNT_EMAIL || '').trim().toLowerCase();
    if (saEmail && saEmail.includes('@livraisonjikjikoox.iam.gserviceaccount.com')) {
      errors.push('COLLISION PRODUCTION BLOQUÉE : FIREBASE_SERVICE_ACCOUNT_EMAIL appartient au projet Firebase de production.');
    }

    const allowedOrigins = (envMap.ALLOWED_ORIGINS || '').trim();
    if (allowedOrigins === '*' || allowedOrigins.split(',').some((o) => o.trim() === '*')) {
      errors.push('SÉCURITÉ CORS : ALLOWED_ORIGINS ne doit jamais contenir de wildcard "*".');
    }
    for (const orig of allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean)) {
      const h = extractHostname(orig);
      if (PRODUCTION_GUARD_CONSTANTS.forbiddenProductionHosts.includes(h)) {
        errors.push(`COLLISION PRODUCTION BLOQUÉE : ALLOWED_ORIGINS autorise un domaine de production (${h}).`);
      }
    }

    const sbUrl = (envMap.SUPABASE_URL || '').trim();
    const sbHost = extractHostname(sbUrl);
    if (prodSupabaseHost && sbHost === prodSupabaseHost.toLowerCase()) {
      errors.push('COLLISION PRODUCTION BLOQUÉE : SUPABASE_URL correspond au projet Supabase de production.');
    }
    if (fnUrl && sbUrl && !fnUrl.startsWith(sbUrl.replace(/\/+$/, ''))) {
      errors.push('INCOHÉRENCE STAGING : VITE_SUPABASE_FUNCTIONS_URL ne correspond pas à SUPABASE_URL.');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function runSelfTest() {
  const validStaging = {
    VITE_APP_ENV: 'staging',
    APP_URL: 'https://staging-livraison.jikjikoox.com',
    VITE_SUPABASE_FUNCTIONS_URL: 'https://stgproj123.supabase.co/functions/v1',
    VITE_FIREBASE_API_KEY: 'AIzaSyStagingTestKeyOnlyNotReal12345',
    VITE_FIREBASE_AUTH_DOMAIN: 'livraisonjikjikoox-staging.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'livraisonjikjikoox-staging',
    VITE_FIREBASE_STORAGE_BUCKET: 'livraisonjikjikoox-staging.firebasestorage.app',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '998877665544',
    VITE_FIREBASE_APP_ID: '1:998877665544:web:stagingapp1234',
    VITE_FIREBASE_FIRESTORE_DATABASE_ID: '(default)',
  };

  // 1. Config staging valide -> PASS
  const okRes = validateStagingConfig(validStaging);
  assert.equal(okRes.ok, true, `Attendu valide, erreurs: ${okRes.errors.join('; ')}`);

  // 2. Collision Firebase production -> BLOQUÉ
  const prodFb = validateStagingConfig({
    ...validStaging,
    VITE_FIREBASE_PROJECT_ID: 'livraisonjikjikoox',
  });
  assert.equal(prodFb.ok, false);
  assert.ok(prodFb.errors.some((e) => e.includes('COLLISION PRODUCTION BLOQUÉE')));

  // 3. Collision domaine production -> BLOQUÉ
  const prodDomain = validateStagingConfig({
    ...validStaging,
    APP_URL: 'https://livraison.jikjikoox.com',
  });
  assert.equal(prodDomain.ok, false);
  assert.ok(prodDomain.errors.some((e) => e.includes('COLLISION PRODUCTION BLOQUÉE')));

  // 4. Fuite secret backend côté frontend -> BLOQUÉ
  const secretLeak = validateStagingConfig({
    ...validStaging,
    SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-in-frontend',
  });
  assert.equal(secretLeak.ok, false);
  assert.ok(secretLeak.errors.some((e) => e.includes('FUITE DE SECRET INTERDITE')));

  // 5. Collision Service Account prod + CORS wildcard en mode backend -> BLOQUÉ
  const backendBad = validateStagingConfig(
    {
      ...validStaging,
      SUPABASE_URL: 'https://stgproj123.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'stg-service-role',
      FIREBASE_PROJECT_ID: 'livraisonjikjikoox-staging',
      FIRESTORE_DATABASE_ID: '(default)',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'sync@livraisonjikjikoox.iam.gserviceaccount.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'stg-pk-value',
      ALLOWED_ORIGINS: '*,https://livraison.jikjikoox.com',
      INTERNAL_SYNC_SECRET: 'stg-internal-sync',
    },
    { checkBackend: true, prodSupabaseHost: 'prodproj999.supabase.co' }
  );
  assert.equal(backendBad.ok, false);
  assert.ok(backendBad.errors.some((e) => e.includes('FIREBASE_SERVICE_ACCOUNT_EMAIL')));
  assert.ok(backendBad.errors.some((e) => e.includes('ALLOWED_ORIGINS')));

  // 6. Collision Supabase prod host -> BLOQUÉ
  const sbProd = validateStagingConfig(
    {
      ...validStaging,
      VITE_SUPABASE_FUNCTIONS_URL: 'https://prodproj999.supabase.co/functions/v1',
    },
    { prodSupabaseHost: 'prodproj999.supabase.co' }
  );
  assert.equal(sbProd.ok, false);
  assert.ok(sbProd.errors.some((e) => e.includes('Supabase de production')));

  console.log('[PASS] 6/6 auto-tests du garde-fou anti-production validés.');
}

// Exécution CLI
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    runSelfTest();
    process.exit(0);
  }

  const checkBackend = args.includes('--backend');
  const envFileArg = args.find((a) => !a.startsWith('--')) || '.env.staging';
  const resolvedPath = path.resolve(process.cwd(), envFileArg);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`[BLOQUÉ] Fichier staging introuvable : ${envFileArg}`);
    console.error('Copiez .env.staging.example vers .env.staging et renseignez les valeurs STAGING uniquement.');
    process.exit(1);
  }

  const fileVars = parseDotEnv(fs.readFileSync(resolvedPath, 'utf8'));
  const merged = checkBackend ? { ...fileVars, ...process.env } : fileVars;
  const prodSupabaseHost = (process.env.PROD_SUPABASE_HOST || '').trim();
  const result = validateStagingConfig(merged, { checkBackend, prodSupabaseHost });

  for (const warn of result.warnings) {
    console.warn(`[AVERTISSEMENT] ${warn}`);
  }
  if (!result.ok) {
    console.error('[ÉCHEC VALIDATION STAGING — OPÉRATION BLOQUÉE]');
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log(`[PASS] Configuration staging validée (${envFileArg}) — aucune collision production détectée.`);
}
