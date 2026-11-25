# Plan de Tests Staging End-to-End — JikJikoox Express

Ce plan formalise la campagne QA réelle à exécuter une fois l’environnement staging provisionné selon `docs/STAGING_SETUP.md` et validé selon `docs/STAGING_SECURITY_CHECKLIST.md`.

---

## 1. Jeu de données Staging requis (100 % fictif)

| Entité | Identifiant Staging | Statut / Rôle | Usage |
|---|---|---|---|
| Livreur A | `driver-a-staging` | `active` (`is_available: true`) | Parcours nominal, preuves, isolation |
| Livreur B | `driver-b-staging` | `active` (`is_available: true`) | Tests d’accès croisés (A vs B) |
| Livreur C | `driver-c-staging` | `suspended` (`is_available: false`) | Vérification blocage immédiat (`403`) |
| Livreur D | `driver-d-staging` | `pending` (`is_available: false`) | Vérification attente approbation Admin |
| Commande fictive 1 | `ord-stg-2026-0001` (`JKX-STG-0001`) | `ASSIGNED` → Livreur A | Parcours nominal COD (`12 500 FCFA`) |
| Commande fictive 2 | `ord-stg-2026-0002` (`JKX-STG-0002`) | `ASSIGNED` → Livreur B | Cible des tentatives d’intrusion de A |
| Commande fictive 3 | `ord-stg-2026-0003` (`JKX-STG-0003`) | `ASSIGNED` → Livreur A | Parcours échec → retour (`FAILED → RETURN_REQUIRED → RETURNED`) |
| Produit / Adresse | `Coffret Bissap Test QA × 2` | `Point Test Almadies Zone 12, Dakar` | Données fictives non expédiées |
| Fichier preuve | `proof-test-staging.jpg` (`< 500 Ko`) | Image JPEG factice | Upload signé bucket `delivery-proofs` |

---

## 2. Scénarios de tests à exécuter sur Staging

### Test 1 — Authentification (Google + Firebase + Edge Functions)
- Connexion Google **Livreur A** → réception Firebase ID Token → `GET driver-profile` renvoie `200` (`account_status: 'active'`).
- Connexion Google **Livreur D** → création automatique en `pending`, accès missions refusé (`403 DRIVER_PENDING`).
- Connexion Google **Livreur C** (`suspended`) → accès missions refusé (`403 DRIVER_SUSPENDED`).
- Déconnexion → accès privé invalidé ; reconnexion OK ; jeton expiré/invalide → `401`.

### Test 2 — Affectation officielle (Admin Staging → Supabase)
- Affectation de `JKX-STG-0001` au Livreur A dans Supabase staging.
- Vérifier `express_deliveries` (`status = 'ASSIGNED'`, horodatage, `driver_id`, `order_id`).
- Déclencher `sync-assignment-to-firestore` avec `X-Internal-Sync-Secret` staging (`200`).

### Test 3 — Synchronisation Firestore & Idempotence
- Vérifier présence du document `/missions/<deliveryId>` dans Firestore staging avec `deliveryId`, `orderId`, `driverId`, `status`, `assignedAt`, `updatedAt`.
- Rejouer `sync-assignment-to-firestore` 2 fois → aucun doublon créé, `express_sync_log` mis à jour de façon idempotente.
- Tester réaffectation et annulation depuis Supabase staging → reflet dans Firestore staging.

### Test 4 — Notifications Push (FCM Staging)
- Autoriser les notifications sur un appareil de test connecté en **Livreur A**.
- Vérifier enregistrement du token FCM (sans jamais l’afficher dans les logs).
- Affecter une mission test → vérifier réception push, clic ouvrant la mission, et marquage lu via `driver-notifications`.

### Test 5 — Parcours Livreur complet (`JKX-STG-0001`)
Exécuter pas à pas dans JikJikoox Express staging :
1. Réception (`ASSIGNED`) → 2. Consultation détails → 3. `ACCEPTED` → 4. `PICKED_UP` → 5. `IN_TRANSIT` → 6. `ARRIVED` → 7. Preuve de livraison → 8. `DELIVERED` → 9. Vérification historique.
À chaque étape, vérifier la concordance exacte entre :
- Interface Express
- `express_deliveries` + `express_delivery_events` (Supabase staging)
- `/missions/<deliveryId>` (Firestore staging)

### Test 6 — Preuve de livraison & Storage privé
- Tenter `POST delivery-proof` avant `ARRIVED` → refus `422`.
- Tenter fichier `> 5 Mo` ou MIME `.exe`/`.pdf` → refus `400`.
- À `ARRIVED`, soumettre `proof-test-staging.jpg` → `201`, URL signée reçue (TTL `120s`), upload PUT réussi, métadonnées dans `express_delivery_proofs`.
- Vérifier après `> 120s` que l’URL signée est rejetée par Storage.
- Vérifier que **Livreur B** reçoit `403` et qu’un `UPDATE`/`DELETE` sur `express_delivery_proofs` échoue (trigger SQL).

### Test 7 — Sécurité & Isolation (Livreur A vs Livreur B)
- Livreur A appelle `GET driver-deliveries?driverId=<uid_B>` → `403`.
- Livreur A tente `POST delivery-action` sur `JKX-STG-0002` (Livreur B) → `403`.
- Livreur A tente de falsifier `codAmount`, `estimatedFee`, `driverId`, `orderId` → `400 FORBIDDEN_FIELDS`.
- Livreur A tente d’écrire directement dans Firestore `/missions/<id>` → `PERMISSION_DENIED`.
- Double soumission `DELIVERED` avec même `X-Idempotency-Key` → `200 idempotentReplay: true` (0 doublon).
- Nouvelle soumission sur mission clôturée avec nouvelle clé → `409 MISSION_LOCKED`.

### Test 8 — Échecs opérationnels
- Couper Internet sur mobile → message clair (`OFFLINE_NO_CONNECTION`), aucune corruption d’état.
- Simuler double clic rapide → seconde soumission ignorée par verrou in-flight.
- Simuler annulation/réaffectation pendant la course → blocage propre (`409` / `403`) avec message compréhensible.

### Test 9 — Historique & Supervision Admin Staging
- Sur `JKX-STG-0003`, exécuter `ARRIVED → FAILED → RETURN_REQUIRED → RETURNED`.
- Vérifier dans Supabase/Admin staging la chronologie complète horodatée côté serveur.

### Test 10 — Validation Build & Emulateur
```bash
npm run lint
npm run lint:rules
npm run validate:staging -- .env.staging
npm run test:security
npm run test:supabase
npm run test:staging:harness
firebase emulators:exec "node tests/firestore.rules.emulator.test.mjs"
npm run build:staging
```
