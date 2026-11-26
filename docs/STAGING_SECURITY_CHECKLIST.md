# Checklist Sécurité Staging — JikJikoox Express

Utiliser cette checklist comme porte **Go / No-Go** avant toute action sur l’environnement staging.

---

## 1. Isolation absolue Staging vs Production
- [ ] Projet Firebase staging distinct (`jikjikoox-express-staging`), **jamais** `livraisonjikjikoox`.
- [ ] Projet Supabase staging distinct (`<STAGING_PROJECT_REF>`), **jamais** le projet Supabase marketplace de production.
- [ ] Domaines autorisés strictement staging (`staging-livraison.jikjikoox.com`).
- [ ] `npm run validate:staging -- .env.staging` exécuté et **PASS** (0 erreur).
- [ ] `PROD_SUPABASE_HOST="<prod-ref>.supabase.co" npm run validate:staging -- .env.staging --backend` exécuté et **PASS**.
- [ ] Aucun fichier `.env.staging`, `.env.local` ou clé privée `.json`/`.pem` suivi par Git (`git status` propre).

## 2. Pré-migration Base de données Supabase Staging
- [ ] `supabase/migrations/00_inspect_existing_schema.sql` exécuté sur staging et résultat archivé.
- [ ] Absence de conflit avec les tables marketplace existantes (`orders`, `payments`, `vendors`, `commissions`).
- [ ] `20261125000001_jikjikoox_express_additive.sql` appliquée **uniquement sur staging**.
- [ ] RLS actif en refus par défaut sur toutes les tables `express_*`.
- [ ] Triggers d’immuabilité `express_forbid_mutation` vérifiés sur `express_delivery_events` et `express_delivery_proofs`.

## 3. Sécurité Storage & Preuves de livraison
- [ ] Bucket Supabase `delivery-proofs` configuré en **privé** (`Public: OFF`), limite `5 Mo`, MIME `image/jpeg`, `image/png`, `image/webp`.
- [ ] Aucune règle publique sur `storage.objects` pour `delivery-proofs`.
- [ ] URLs signées générées par `delivery-proof` bornées à `120s` maximum et confinées par `<firebase_uid>/<delivery_id>/`.
- [ ] Règles `storage.rules` déployées sur `jikjikoox-express-staging` uniquement (`allow update, delete: if false` sur `/delivery_proofs`).

## 4. Sécurité Edge Functions & Firebase Rules
- [ ] Toutes les Edge Functions vérifient la signature cryptographique RS256 du Firebase ID Token avec `FIREBASE_PROJECT_ID=livraisonjikjikoox-staging`.
- [ ] `ALLOWED_ORIGINS` ne contient ni `*` ni aucun domaine de production.
- [ ] `INTERNAL_SYNC_SECRET` est généré aléatoirement (32+ octets) et différent de toute future clé de production.
- [ ] `npm run lint:rules` → **PASS** (0 erreur).
- [ ] `firebase emulators:exec "node tests/firestore.rules.emulator.test.mjs"` exécuté avec JDK 17+ → **13/13 PASS**.

## 5. Sécurité Frontend & Build Staging
- [ ] `npm run build:staging` réussit sans erreur TypeScript ni Vite.
- [ ] Aucun secret backend (`SUPABASE_SERVICE_ROLE_KEY`, `BEGIN PRIVATE KEY`, `INTERNAL_SYNC_SECRET`) présent dans `dist/`.
- [ ] Le mode démonstration Dakar reste 100 % isolé en mémoire locale (0 appel réseau).
- [ ] Aucune notification FCM envoyée à un vrai livreur.
