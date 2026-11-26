# Guide de provisionnement Staging — JikJikoox Express

> **RÈGLE IMPÉRATIVE** : L’environnement staging doit être **100 % indépendant de la production**.  
> Aucune commande de ce guide ne doit jamais être exécutée sur les projets de production (`livraisonjikjikoox`, `www.jikjikoox.com`, `admin.jikjikoox.com`, `livraison.jikjikoox.com`, ni sur le projet Supabase production).

---

## 1. Différenciation Staging vs Production

| Composant | Production (PROTÉGÉ — NE PAS TOUCHER) | Staging (À PROVISIONNER) |
|---|---|---|
| Domaine Express | `https://livraison.jikjikoox.com` | `https://staging-livraison.jikjikoox.com` |
| Domaine Admin | `https://admin.jikjikoox.com` | Non inclus dans ce déploiement Express staging |
| Projet Firebase | `livraisonjikjikoox` | `jikjikoox-express-staging` (projet staging confirmé) |
| Auth Domain Firebase | `livraisonjikjikoox.firebaseapp.com` | Valeur exacte à relever dans les paramètres de `jikjikoox-express-staging` |
| Storage Bucket Firebase | `livraisonjikjikoox.firebasestorage.app` | Bucket exact à relever dans `jikjikoox-express-staging` |
| Projet Supabase | Marketplace officiel (`dllafwvyfjodblxhshko`) | `jikjikoox-express-staging` — ref `bwicndbbxvthbddiacks` |
| Variable `VITE_APP_ENV` | `production` (ou non staging) | `staging` (active le blocage anti-prod dans `src/lib/firebase.ts`) |
| Fichier env local | Jamais versionné | `.env.staging` (créé à partir de `.env.staging.example`, ignoré par Git) |

---

## 2. Procédure Supabase Staging (10 étapes)

### Étape 1 — Sélectionner le projet Supabase staging existant
1. Utiliser exclusivement le projet `jikjikoox-express-staging` (`bwicndbbxvthbddiacks`, région `eu-west-1`) déjà provisionné.
2. Ne pas créer un nouveau projet et ne jamais sélectionner le projet marketplace `dllafwvyfjodblxhshko`.
3. Avant toute commande, vérifier que le `project-ref` est exactement `bwicndbbxvthbddiacks`.

### Étape 2 — Identifier son URL et ses clés
- Relever uniquement :
  - `Project URL` → servira pour le secret backend `SUPABASE_URL` et pour `VITE_SUPABASE_FUNCTIONS_URL` (`https://bwicndbbxvthbddiacks.supabase.co/functions/v1`).
  - `service_role` key → **exclusivement** pour le secret Edge Function `SUPABASE_SERVICE_ROLE_KEY` (jamais dans le frontend).

### Étape 3 — Exécuter l’inspection en lecture seule (`00_inspect_existing_schema.sql`)
1. Ouvrir le **SQL Editor** du projet **Supabase staging**.
2. Exécuter `supabase/migrations/00_inspect_existing_schema.sql` (requêtes `SELECT` uniquement).

### Étape 4 — Examiner les résultats du schéma
Vérifier :
- Les tables existantes (ex. `orders`, `profiles`, `payments`, `commissions`, `vendors`) si staging est un clone anonymisé de la structure marketplace.
- Qu’aucune table ou fonction préfixée `express_*` n’entre en collision de nom.
- Les triggers, extensions (`pgcrypto`) et politiques RLS déjà présents.

### Étape 5 — Checklist obligatoire AVANT migration
Ne pas appliquer `20261125000001_jikjikoox_express_additive.sql` tant que tous les points ci-dessous ne sont pas cochés :
- [ ] Le `project-ref` Supabase actif est bien celui du projet **staging** (jamais production).
- [ ] `00_inspect_existing_schema.sql` a été exécuté et revu.
- [ ] Aucune table existante `orders`, `payments`, `sellers`, `commissions` n’est modifiée ou supprimée par la migration (vérifié : migration 100 % additive `express_*`).
- [ ] L’extension `pgcrypto` est disponible (`gen_random_uuid()`).
- [ ] Une sauvegarde / snapshot staging existe avant exécution.

### Étape 6 — Appliquer uniquement la migration additive validée
Via Supabase CLI pointée sur le `project-ref` staging (ou SQL Editor staging) :
```bash
supabase link --project-ref bwicndbbxvthbddiacks
supabase db push --linked
```
*(Ou exécuter manuellement `supabase/migrations/20261125000001_jikjikoox_express_additive.sql` dans le SQL Editor du projet staging uniquement.)*

### Étape 7 & 8 — Créer le bucket privé `delivery-proofs` et ses permissions
1. Dans **Storage** (projet staging), créer le bucket `delivery-proofs` :
   - **Public bucket** : `OFF` (strictement privé).
   - **File size limit** : `5 MB` (`5242880` octets).
   - **Allowed MIME types** : `image/jpeg`, `image/png`, `image/webp`.
2. Ne créer **aucune politique publique** sur `storage.objects` pour `delivery-proofs` : les uploads passent exclusivement par les URL signées courte durée (`120s`) émises par l’Edge Function `delivery-proof` avec `service_role`.

### Étape 9 — Déployer les Edge Functions sur staging uniquement
```bash
supabase functions deploy driver-profile --project-ref bwicndbbxvthbddiacks --no-verify-jwt
supabase functions deploy driver-deliveries --project-ref bwicndbbxvthbddiacks --no-verify-jwt
supabase functions deploy delivery-action --project-ref bwicndbbxvthbddiacks --no-verify-jwt
supabase functions deploy delivery-proof --project-ref bwicndbbxvthbddiacks --no-verify-jwt
supabase functions deploy driver-notifications --project-ref bwicndbbxvthbddiacks --no-verify-jwt
supabase functions deploy sync-assignment-to-firestore --project-ref bwicndbbxvthbddiacks --no-verify-jwt
```
> **Note `--no-verify-jwt`** : les requêtes portent un **Firebase ID Token RS256** (et non un JWT Supabase Auth). La validation cryptographique RS256 complète est exécutée explicitement dans chaque fonction via `supabase/functions/_shared/firebaseAuth.ts`.

### Étape 10 — Configurer les secrets backend staging
Configurer uniquement sur `bwicndbbxvthbddiacks` (sans jamais stocker de valeurs dans Git) :
```bash
supabase secrets set --project-ref bwicndbbxvthbddiacks \
  SUPABASE_URL="https://bwicndbbxvthbddiacks.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<STAGING_SERVICE_ROLE_KEY>" \
  FIREBASE_PROJECT_ID="jikjikoox-express-staging" \
  FIRESTORE_DATABASE_ID="(default)" \
  FIREBASE_SERVICE_ACCOUNT_EMAIL="<STAGING_SA_EMAIL>" \
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY="<STAGING_SA_PRIVATE_KEY_ESCAPED>" \
  ALLOWED_ORIGINS="https://staging-livraison.jikjikoox.com" \
  INTERNAL_SYNC_SECRET="<RANDOM_32_BYTES_HEX_STAGING>"
```

---

## 3. Procédure Firebase Staging (`jikjikoox-express-staging`)

1. Utiliser le projet Firebase staging déjà créé et confirmé : `jikjikoox-express-staging` (sans lier ni copier les clés de `livraisonjikjikoox`).
2. **Firebase Authentication** : vérifier que Google Sign-In est activé et ajouter `staging-livraison.jikjikoox.com` dans **Authorized domains** du projet staging. Conserver `localhost` uniquement pour les tests locaux.
3. **Cloud Firestore** : créer la base `(default)` en mode production (refus par défaut).
4. **Firebase Storage** : vérifier le bucket réellement associé à `jikjikoox-express-staging` et renseigner son nom exact dans `VITE_FIREBASE_STORAGE_BUCKET`.
5. **Firebase Cloud Messaging (FCM)** : générer une paire de clés Web Push (VAPID) dédiée au projet staging.
6. **Compte de service backend staging** : dans *Paramètres du projet → Comptes de service*, créer un compte de service restreint pour la synchronisation Supabase → Firestore/FCM du projet **`jikjikoox-express-staging` uniquement**.
7. **Déployer règles & index sur staging uniquement** :
   ```bash
   firebase use jikjikoox-express-staging
   firebase deploy --only firestore:rules,firestore:indexes,storage --project jikjikoox-express-staging
   ```

### Configurations de production à NE JAMAIS copier en staging
- Le `projectId` `livraisonjikjikoox`, son `apiKey`, son `appId`, son `oAuthClientId` ou sa `messagingSenderId`.
- La base Firestore `ai-studio-eb90a3f1-6fee-48a3-8c68-e411d0bf546d` ou la base production.
- Le compte de service privé (`@livraisonjikjikoox.iam.gserviceaccount.com`).
- Les domaines autorisés `livraison.jikjikoox.com`, `admin.jikjikoox.com`, `www.jikjikoox.com`.
- Les tokens FCM ou comptes Google des livreurs réels.
- `INTERNAL_SYNC_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY` de production.

---

## 4. Variables d’environnement Frontend & Secrets Backend

### Frontend (`.env.staging` issu de `.env.staging.example` — variables publiques uniquement)
- `VITE_APP_ENV="staging"` (obligatoire : active le verrou anti-production dans `src/lib/firebase.ts`)
- `APP_URL`
- `VITE_SUPABASE_FUNCTIONS_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_FIRESTORE_DATABASE_ID` (optionnel, défaut `"(default)"`)
- `VITE_FIREBASE_VAPID_KEY` (optionnel, pour FCM Web)

### Validation pré-vol anti-production
```bash
npm run validate:staging -- .env.staging
# Pour vérifier aussi la cohérence avec les variables backend staging :
PROD_SUPABASE_HOST="<prod-ref>.supabase.co" npm run validate:staging -- .env.staging --backend
# Build staging protégé par validation préalable :
npm run build:staging
```

### Secrets Backend (Supabase Staging uniquement — vérifiés dans le code)
Tous les 8 secrets suivants sont effectivement utilisés dans `supabase/functions/_shared/supabaseAdmin.ts` :
1. `SUPABASE_URL` — requis (PostgREST, RPC, Storage sign).
2. `SUPABASE_SERVICE_ROLE_KEY` — requis (accès serveur RLS bypass contrôlé).
3. `FIREBASE_PROJECT_ID` — requis en staging (`jikjikoox-express-staging` ; sans lui le code retombe sur la valeur par défaut de production `livraisonjikjikoox`, donc **obligatoire**).
4. `FIRESTORE_DATABASE_ID` — requis (`(default)` en staging).
5. `FIREBASE_SERVICE_ACCOUNT_EMAIL` — requis pour synchroniser Firestore et envoyer FCM v1.
6. `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` — requis (clé PKCS#8 du compte de service staging uniquement).
7. `ALLOWED_ORIGINS` — requis (CORS strict staging uniquement ; ne jamais mettre `*` ni de domaine prod).
8. `INTERNAL_SYNC_SECRET` — requis par `sync-assignment-to-firestore` (comparaison à temps constant).

---

## 5. Création manuelle des comptes & données de test (STAGING UNIQUEMENT)

1. Créer 4 comptes Google dédiés aux tests QA (ou comptes Auth staging) et récupérer leur `firebase_uid` dans Firebase Console (`jikjikoox-express-staging`).
2. Insérer les 4 profils dans `public.express_drivers` (**Supabase staging uniquement**) :
   - **Livreur A** : `account_status = 'active'`, `is_available = true`, `work_zone = 'Almadies & Ngor'`
   - **Livreur B** : `account_status = 'active'`, `is_available = true`, `work_zone = 'Dakar Plateau'`
   - **Livreur C** : `account_status = 'suspended'`, `is_available = false`
   - **Livreur D** : `account_status = 'pending'`, `is_available = false` (ou laisser se connecter une première fois pour vérifier la création automatique en `pending`)
3. Synchroniser les 4 documents correspondants dans Firestore staging `/couriers/{firebase_uid}` avec exactement le même `accountStatus` et `role: 'courier'`.
4. Insérer une **mission fictive** dans `public.express_deliveries` (staging uniquement) :
   - `mission_code`: `MSN-STG-0001`
   - `order_id`: `ord-stg-2026-0001`, `order_number`: `JKX-STG-0001`
   - `driver_id` / `driver_firebase_uid`: ceux du **Livreur A**
   - `customer_name`: `Fatou Test Staging`, `customer_phone`: `+221 77 000 99 01`
   - `delivery_address`: `Point Test Almadies Zone 12, Dakar`
   - `items_summary`: `[{"name":"Coffret Bissap Test QA","quantity":2,"unit":"bouteilles"}]`
   - `payment_mode`: `'cod'`, `cod_amount`: `12500`, `estimated_fee`: `1500`, `status`: `'ASSIGNED'`
5. Déclencher `POST https://<STAGING_REF>.supabase.co/functions/v1/sync-assignment-to-firestore` avec `X-Internal-Sync-Secret` staging et `{ "deliveryId": "<uuid>" }` pour vérifier l’apparition dans Firestore staging et l’envoi FCM test.
6. Préparer une image JPEG factice (`< 500 Ko`, ex. `proof-test-staging.jpg`) pour le test d’upload de preuve.

---

## 6. Firebase Emulator Suite (Java JDK 17+)

Sur une machine disposant de **Java JDK 17+** (`java -version`) et **Node.js 20+** :

1. Installer la dépendance de test des règles (si absente) :
   ```bash
   npm install --save-dev @firebase/rules-unit-testing
   ```
2. Vérifier la syntaxe des règles :
   ```bash
   npm run lint:rules
   ```
3. Exécuter la suite officielle (13 scénarios couvrant isolation livreurs, pending/suspended, anti-falsification, preuve immuable et miroir lecture seule) :
   ```bash
   firebase emulators:exec "node tests/firestore.rules.emulator.test.mjs"
   ```
   *(Équivalent : `npm run test:emulator`.)*
