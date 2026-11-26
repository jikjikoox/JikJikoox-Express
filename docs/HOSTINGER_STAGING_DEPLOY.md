# Déploiement Hostinger — JikJikoox Express Staging

## Cible verrouillée

- Domaine : `staging-livraison.jikjikoox.com`
- Dépôt GitHub : `jikjikoox/JikJikoox-Express`
- Branche : `main` (aucune branche de déploiement séparée)
- Répertoire du dépôt : racine (`/`)
- Type : application Node.js / Express qui sert le build Vite
- Runtime : Node.js `22.13+` (ou `24.12+`)
- Build : `npm run build`
- Démarrage : `node server.js`
- Port : lire `process.env.PORT` (Hostinger l'injecte)
- Health check : `/healthz`

## Pré-requis côté Hostinger

1. Le plan doit prendre en charge les applications Node.js (Business ou Cloud).
2. Le sous-domaine `staging-livraison.jikjikoox.com` doit être ajouté comme site séparé et pointer vers son propre espace d'application.
3. Dans hPanel, ouvrir Websites → Manage → Advanced → Git, connecter GitHub si nécessaire, sélectionner le dépôt ci-dessus, la branche `main` et le répertoire racine.
4. Vérifier que le type de site est bien Node.js, et non un simple hébergement statique/PHP.
5. Régler la version Node sur 22.13+ (ou 24.12+).
6. Configurer la commande de build `npm run build` et la commande de démarrage `node server.js`.
7. Activer l'auto-déploiement Git seulement après validation de l'application Node.js staging. Les pushes sur `main` déclencheront alors le déploiement sur ce sous-domaine staging uniquement.

> La connexion initiale GitHub dans hPanel nécessite une autorisation interactive du propriétaire du compte Hostinger. Ne pas la faire pointer vers `livraison.jikjikoox.com`, le domaine de production.

## Variables d'environnement frontend à définir sur Hostinger

Les variables `VITE_*` sont intégrées au bundle pendant le build : après toute modification, relancer un build.

- `VITE_APP_ENV=staging`
- `APP_URL=https://staging-livraison.jikjikoox.com`
- `VITE_SUPABASE_FUNCTIONS_URL=https://bwicndbbxvthbddiacks.supabase.co/functions/v1`
- `VITE_FIREBASE_PROJECT_ID=jikjikoox-express-staging`
- `VITE_FIREBASE_API_KEY` — valeur Web API key du projet Firebase staging
- `VITE_FIREBASE_AUTH_DOMAIN` — valeur exacte des paramètres Firebase staging
- `VITE_FIREBASE_STORAGE_BUCKET` — valeur exacte du bucket Firebase staging
- `VITE_FIREBASE_MESSAGING_SENDER_ID` — valeur exacte Firebase staging
- `VITE_FIREBASE_APP_ID` — valeur exacte de l'application Web Firebase staging
- `VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)`
- `VITE_FIREBASE_VAPID_KEY` — facultatif, clé Web Push du projet staging

Ne pas copier les valeurs Firebase de production. Les valeurs exactes autres que le project ID doivent être lues dans les paramètres du projet Firebase `jikjikoox-express-staging`.

Avant de modifier les variables, relever la liste complète des variables déjà présentes dans Hostinger. Ne pas remplacer tout l'ensemble en supprimant des variables existantes.

## Secrets backend — Supabase staging uniquement

Ces secrets ne doivent jamais être définis en variables `VITE_*`, ni exposés au navigateur. Ils sont gérés dans Supabase Edge Function Secrets du projet `bwicndbbxvthbddiacks` :

- `SUPABASE_URL=https://bwicndbbxvthbddiacks.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID=jikjikoox-express-staging`
- `FIRESTORE_DATABASE_ID=(default)`
- `FIREBASE_SERVICE_ACCOUNT_EMAIL`
- `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `ALLOWED_ORIGINS=https://staging-livraison.jikjikoox.com`
- `INTERNAL_SYNC_SECRET`

Ne jamais mettre de clé privée, service role ou secret interne dans GitHub, dans `.env.staging.example` ou dans le bundle frontend.

## Contrôles après déploiement

1. Ouvrir `https://staging-livraison.jikjikoox.com/healthz` et vérifier `200` avec `distReady: true`.
2. Ouvrir `https://staging-livraison.jikjikoox.com/` et vérifier que l'interface Express est servie, pas une page par défaut Hostinger.
3. Dans les outils développeur du navigateur, vérifier qu'aucune erreur de configuration Firebase ou CORS n'apparaît.
4. Tester connexion Google avec le compte livreur staging, lecture du profil, bascule disponible/indisponible et déconnexion.
5. Affecter une mission fictive au compte de test, vérifier sa réception via Firestore `onSnapshot`, puis exécuter les transitions jusqu'à livraison/retour.
6. Vérifier les notifications FCM uniquement avec les appareils de test staging.

## État actuel

Le code Node.js/Express et le endpoint `/healthz` existent dans `main`. La CI GitHub valide le build standard et les contrôles de sécurité. Le déploiement Hostinger et la vérification d'une session Firebase réelle restent à effectuer après la connexion interactive de GitHub dans hPanel et la saisie des valeurs Firebase staging exactes.
