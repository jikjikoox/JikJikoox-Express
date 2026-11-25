# Security Summary

**Reviewed Files**: 21
**Issues Resolved**: 8

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Auto-activation des comptes Google | `firestore.rules`, `src/context/CourierAppContext.tsx` | 176, 154 | Tout utilisateur Google s'inscrivait directement avec `accountStatus: 'active'`, donnant un accès immédiat sans validation administrateur. | Critique | Fixed | Inscription forcée en `accountStatus: 'pending'` et `isAvailable: false` dans `firestore.rules` et l'application, avec écran dédié d'attente d'approbation JikJikoox Admin. |
| Absence de garde `isActiveCourier()` sur les missions | `firestore.rules` | 204–268 | Un livreur suspendu, désactivé ou en attente pouvait encore lire ou tenter de modifier ses missions directement via le SDK Firestore. | Critique | Fixed | Ajout du contrôle serveur `isActiveCourier()` (`role == 'courier' && accountStatus == 'active'`) sur les opérations `get`, `list`, `create` et `update` de `/missions`, `/delivery_events`, `/delivery_proofs` et `/notifications`. |
| Écriture de données démo dans les collections Firestore | `firestore.rules`, `src/context/CourierAppContext.tsx`, `src/pages/DashboardPage.tsx` | 212, 310, 134 | Un livreur pouvait créer/supprimer des documents `demo_sandbox` dans `/missions` et `/notifications`. | Critique | Fixed | Interdiction absolue de `create`/`delete` client sur `/missions` et `/notifications` (`isAdmin()` uniquement) ; suppression de `seedSandboxDataInFirestore()` ; isolation 100 % mémoire locale du mode démonstration (`local_demo`). |
| Droits admin basés sur une adresse email en dur | `firestore.rules` | 33 | `isAdmin()` validait l'accès administrateur à partir d'une adresse email écrite en dur dans les règles. | Critique | Fixed | Remplacement par une collection serveur-only `/admins/{adminUid}` (`allow list, create, update, delete: if false;`) vérifiant `active == true`. |
| Preuves et historique mutables dans le document mission | `firestore.rules`, `src/context/CourierAppContext.tsx` | 221, 415 | Les preuves de livraison et le journal d'événements n'étaient pas isolés dans des collections append-only immuables et la clôture `DELIVERED` ne validait pas `recipientName` dans les règles. | Élevé | Fixed | Création des collections immuables `/delivery_events/{eventId}` et `/delivery_proofs/{proofId}` (`allow update, delete: if false;`), contrôle `events.size() == existing().events.size() + 1`, et validation obligatoire de `recipientName` (`DELIVERED`) et `failureReason` (`FAILED`). |
| Absence de règles Firebase Storage et de fichiers d'indexation | `storage.rules`, `firebase.json`, `firestore.indexes.json` | — | Aucune règle Storage ni configuration d'émulateur / index composites n'était définie pour les futures photos de preuve. | Élevé | Fixed | Création de `storage.rules` (accès privé, images JPEG/PNG/WebP max 5 Mo, `update/delete` interdits), `firebase.json` et `firestore.indexes.json`. |
| Attachement prématuré des listeners Firestore | `src/context/CourierAppContext.tsx`, `src/lib/firebase.ts` | 118, 25 | Les abonnements Firestore démarraient avant confirmation que `accountStatus === 'active'` et le test de connexion s'exécutait même en mode démonstration. | Moyen | Fixed | Découplage des listeners `/missions` et `/notifications` derrière la garde `accountStatus === 'active'`, nettoyage complet à la déconnexion, et déclenchement de `testFirestoreConnection()` uniquement en session Firebase réelle. |
| Validation des URL d'avatar et disponibilité hors compte actif | `firestore.rules`, `src/context/CourierAppContext.tsx` | 53, 390 | `photoUrl` n'était pas restreinte aux schémas sûrs (`https://` ou `/src/assets/`) et un profil non actif n'était pas bloqué en amont des mises à jour. | Moyen | Fixed | Ajout du validateur `isOptionalPhotoUrl()` dans `firestore.rules` et blocage strict de `updateProfile`/`toggleAvailability` hors statut `active`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Secrets & Clés | `.env.example`, `src/lib/firebase.ts`, `src/lib/supabaseContract.ts` | Aucune clé Firebase Admin ni Supabase Service Role dans le frontend ; seules les clés publiques Firebase Web du projet `livraisonjikjikoox` sont utilisées. |
| Isolation PII client | `firestore.rules`, `src/pages/MissionDetailPage.tsx` | Numéro client masqué par défaut (affiché uniquement sur clic pendant une mission active, masqué dès clôture) et accès strictement limité au livreur assigné actif. |
| Intégrité financière | `firestore.rules`, `src/lib/missionWorkflow.ts` | `codAmount`, `estimatedFee`, `paymentMode`, `orderNumber`, `courierId` et `itemsSummary` sont vérifiés immutables à chaque mise à jour de mission. |
| Transitions de statut | `firestore.rules`, `src/lib/missionWorkflow.ts` | Machine à états stricte synchronisée côté règles Firestore et frontend ; états terminaux (`DELIVERED`, `RETURN_REQUIRED`, `CANCELLED`) définitivement verrouillés. |
| Dépendances | `package.json`, `bun.lock` | Audit `bun audit` exécuté : seule une dépendance transitive Node gRPC (`@grpc/grpc-js@1.9.16` dans `@firebase/firestore`, non utilisée dans le navigateur WebChannel) est signalée en suivi. |

---

## PoC Verification

### 1. Auto-activation d'un compte Google externe sans approbation Admin

#### Summary
| Field | Value |
|---|---|
| Issue Type | Contournement d'autorisation à l'inscription |
| Impact | Critique |
| Affected File | `firestore.rules:218`, `src/context/CourierAppContext.tsx:218` |
| Test Scenario | Un utilisateur Google externe crée `/couriers/{uid}` avec `{ role: "courier", accountStatus: "active", isAvailable: true }` puis tente de lire `/missions`. |

#### How It Was Fixed
La règle `allow create` sur `/couriers/{courierId}` exige désormais `accountStatus == 'pending'` et `isAvailable == false` pour toute auto-inscription, et `/missions` impose `isActiveCourier()`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Le client envoie `setDoc(/couriers/extUid, { accountStatus: 'active', ... })` | La requête atteint `match /couriers/{courierId}` (`firestore.rules:218`) |
| 2 | `isAdmin()` est `false` (absent de `/admins/extUid`) ; la branche livreur vérifie `incoming().accountStatus == 'pending'` | Condition évaluée à `false` |
| 3 | Même si l'utilisateur s'enregistre correctement en `pending`, toute lecture de `/missions` évalue `isActiveCourier()` (`firestore.rules:42`) | `accountStatus == 'active'` est `false` → **PERMISSION_DENIED** |

#### Conclusion
**Fix Verified** — Un compte Google non approuvé par JikJikoox Admin ne peut ni s'auto-activer ni accéder aux missions réelles.

### 2. Création d'une fausse mission ou modification du montant COD par un livreur actif

#### Summary
| Field | Value |
|---|---|
| Issue Type | Intégrité financière & création non autorisée de missions |
| Impact | Critique |
| Affected File | `firestore.rules:267`, `firestore.rules:288` |
| Test Scenario | Un livreur actif tente (a) `setDoc(/missions/fake_1, { dataSource: 'local_demo', ... })` ou (b) `updateDoc(/missions/m_1, { status: 'ACCEPTED', codAmount: 0 })`. |

#### How It Was Fixed
`allow create` sur `/missions/{missionId}` est restreint à `isAdmin()`, et `allow update` exige `incoming().codAmount == existing().codAmount` ainsi que `affectedKeys().hasOnly(['status', 'proofCode', 'proofNote', 'recipientName', 'failureReason', 'events', 'updatedAt'])`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Cas (a) : `setDoc(/missions/fake_1, ...)` arrive sur `allow create` (`firestore.rules:267`) | `isValidMission` rejette `dataSource != 'supabase_sync'` ET `isAdmin()` est `false` → **PERMISSION_DENIED** |
| 2 | Cas (b) : `updateDoc(/missions/m_1, { codAmount: 0, ... })` arrive sur `allow update` (`firestore.rules:288`) | `incoming().codAmount == existing().codAmount` échoue et `codAmount` est absent de `affectedKeys().hasOnly(...)` → **PERMISSION_DENIED** |

#### Conclusion
**Fix Verified** — Aucun livreur ne peut créer une mission factice ni altérer les montants financiers issus de Supabase.

### 3. Suppression ou modification rétroactive d'une preuve de livraison

#### Summary
| Field | Value |
|---|---|
| Issue Type | Altération d'archive probatoire |
| Impact | Élevé |
| Affected File | `firestore.rules:354`, `storage.rules:42` |
| Test Scenario | Un livreur actif tente `deleteDoc(/delivery_proofs/prf_01)` ou `updateDoc(/delivery_proofs/prf_01, { recipientName: 'Autre' })` après clôture. |

#### How It Was Fixed
Les collections `/delivery_proofs/{proofId}` et `/delivery_events/{eventId}` ainsi que le chemin Storage `/delivery_proofs/{courierId}/{missionId}/{fileName}` imposent `allow update, delete: if false;`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | La requête `deleteDoc` ou `updateDoc` arrive sur `match /delivery_proofs/{proofId}` (`firestore.rules:354`) | Évalue `allow update, delete: if false;` |
| 2 | Même logique sur les fichiers photo (`storage.rules:42`) | **PERMISSION_DENIED** immédiat |

#### Conclusion
**Fix Verified** — Une fois soumises, les preuves de livraison et l'historique des transitions sont strictement immuables.

---

## Intégration Backend Supabase — Sécurité & Vérification

### Safeguards Verified (Connexion JikJikoox Express <-> Supabase)
| Area | File | How It's Protected |
|---|---|---|
| Validation cryptographique Firebase JWT | `supabase/functions/_shared/firebaseAuth.ts` | Vérification complète RS256 via Web Crypto (`crypto.subtle`) contre les clés JWKS officielles Google avec gestion `Cache-Control` et rotation sur `kid` inconnu ; contrôle strict `iss`, `aud` (`livraisonjikjikoox`), `exp`, `iat`, `auth_time`, `sub`, `email_verified`. |
| Autorisation livreur côté serveur | `supabase/functions/_shared/supabaseAdmin.ts` | Contrôle systématique dans `express_drivers` après vérification du jeton : refus immédiat (`403`) si compte inconnu, `pending`, `suspended`, `disabled` ou rôle != `courier`. |
| Isolation des missions & transitions | `supabase/functions/_shared/workflow.ts`, `supabase/migrations/20261125000001_jikjikoox_express_additive.sql` | Machine à états autoritaire + verrouillage ligne PostgreSQL (`SELECT ... FOR UPDATE`), rejet des champs financiers (`codAmount`, `estimatedFee`, `courierId`, `orderNumber`, `role`), verrouillage des états terminaux, clé d'idempotence `X-Idempotency-Key`. |
| Miroir Firestore lecture seule | `firestore.rules`, `supabase/functions/_shared/firestoreSync.ts` | `/missions`, `/delivery_events` et `/delivery_proofs` passés en écriture exclusivement backend/admin dans `firestore.rules` ; synchronisation unidirectionnelle Supabase -> Firestore avec minimisation des PII, 3 retries bornés et résilience non bloquante. |
| Preuves & URL signées | `supabase/functions/delivery-proof/index.ts`, `supabase/migrations/20261125000001_jikjikoox_express_additive.sql` | Validation statut `ARRIVED`, propriétaire, MIME (`jpeg/png/webp`), taille `<= 5 Mo`, confinement chemin Storage, URL signée courte durée (`120s`) et triggers SQL d'immuabilité (`express_forbid_mutation`). |
| Exécution des tests automatisés | `tests/security.logic.test.ts`, `tests/supabase.integration.test.ts` | 10/10 contrôles de règles/logique PASS et 20/20 scénarios d'intégration Supabase PASS (`npx tsx`), ESLint `firestore.rules` PASS, `tsc --noEmit` PASS, `vite build` PASS. |

