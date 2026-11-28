#!/usr/bin/env node
/**
 * Diagnostic Firebase Authentication — JikJikoox Express
 *
 * Vérifie directement via Firebase Identity Toolkit (clé Web publique uniquement) :
 * 1. Si le fournisseur Adresse e-mail / Mot de passe est activé (absence de PASSWORD_LOGIN_DISABLED)
 * 2. Si le domaine cible (par défaut livraison.jikjikoox.com) figure dans authorizedDomains
 *
 * Usage :
 *   node scripts/check-firebase-auth.mjs
 *   node scripts/check-firebase-auth.mjs --domain livraison.jikjikoox.com
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const domainIdx = args.indexOf('--domain');
const expectedDomain =
  domainIdx !== -1 && args[domainIdx + 1]
    ? args[domainIdx + 1].trim().toLowerCase()
    : 'livraison.jikjikoox.com';

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const apiKey = (process.env.VITE_FIREBASE_API_KEY || config.apiKey || '').trim();
const projectId = (process.env.VITE_FIREBASE_PROJECT_ID || config.projectId || '').trim();

if (!apiKey || !/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) {
  console.error('[ERREUR] Clé API Web Firebase invalide ou absente.');
  process.exit(1);
}

console.log(`Projet Firebase vérifié : ${projectId}`);

let hasFailures = false;

// 1. Vérification des domaines autorisés
try {
  const projRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`
  );
  const projJson = await projRes.json();
  const domains = Array.isArray(projJson.authorizedDomains) ? projJson.authorizedDomains : [];
  console.log('Domaines autorisés actuels :', domains.join(', ') || '(aucun)');
  if (!domains.includes(expectedDomain)) {
    hasFailures = true;
    console.error(
      `[MANQUANT] Le domaine "${expectedDomain}" n'est pas dans authorizedDomains.`
    );
    console.error(
      `  -> Ajoutez-le sur : https://console.firebase.google.com/project/${projectId}/authentication/settings`
    );
  } else {
    console.log(`[OK] Le domaine "${expectedDomain}" est bien autorisé.`);
  }
} catch (err) {
  hasFailures = true;
  console.error('[ERREUR] Impossible de vérifier authorizedDomains :', err.message);
}

// 2. Vérification du fournisseur Email / Password (sans créer ni modifier de compte)
try {
  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'diagnostic-probe-nonexistent@jikjikoox.invalid',
        password: 'DiagnosticProbePassword!2026',
        returnSecureToken: true,
      }),
    }
  );
  const authJson = await authRes.json();
  const msg = String(authJson?.error?.message || '');

  if (msg.includes('PASSWORD_LOGIN_DISABLED') || msg.includes('OPERATION_NOT_ALLOWED')) {
    hasFailures = true;
    console.error(
      `[BLOQUÉ] Le fournisseur Email/Mot de passe est DÉSACTIVÉ (${msg}) -> cause directe de auth/operation-not-allowed.`
    );
    console.error(
      `  -> Activez-le sur : https://console.firebase.google.com/project/${projectId}/authentication/providers`
    );
  } else {
    console.log(
      `[OK] Le fournisseur Email/Mot de passe est ACTIF (réponse attendue sur compte fictif : ${msg || authRes.status}).`
    );
  }
} catch (err) {
  hasFailures = true;
  console.error('[ERREUR] Impossible de sonder signInWithPassword :', err.message);
}

if (hasFailures) {
  process.exit(1);
}
console.log('[PASS] Configuration Firebase Authentication prête pour la connexion e-mail/mot de passe et Google.');
