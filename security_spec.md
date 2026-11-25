# Security Specification — JikJikoox Express (Post-Audit v2)

## 1. Invariants de sécurité (Zero-Trust)
1. **Autorisation obligatoire avant accès terrain :** Tout nouveau compte Google s'enregistre exclusivement en statut `accountStatus: 'pending'` (`isAvailable: false`). Seul un administrateur présent dans `/admins/{uid}` (`active == true`) peut activer un livreur.
2. **Contrôle serveur du rôle administrateur :** Aucune adresse email codée en dur ni champ modifiable par le client ne confère de droits administrateur. `/admins/{uid}` est `allow create, update, delete: if false;`.
3. **Isolation stricte par livreur actif (`isActiveCourier()`) :** Un utilisateur non connecté, `pending`, `suspended`, ou `disabled` est bloqué par les règles Firestore sur `/missions`, `/delivery_events`, `/delivery_proofs` et `/notifications`. Un livreur A ne peut jamais lire ou modifier les ressources du livreur B.
4. **Source de vérité financière protégée :** Un livreur ne peut jamais créer/supprimer une mission ni modifier `codAmount`, `estimatedFee`, `paymentMode`, `orderNumber`, `courierId`, `itemsSummary`, `customerName`, `customerPhone`, `deliveryAddress`.
5. **Workflow contrôlé & immuabilité des preuves/historique :**
   - Transitions strictement contrôlées (`ASSIGNED -> ACCEPTED -> PREPARING|PICKED_UP -> IN_TRANSIT -> ARRIVED -> DELIVERED|FAILED|RETURN_REQUIRED`).
   - Clôture `DELIVERED` impossible sans `recipientName` (2..100 car.) ; clôture `FAILED` impossible sans `failureReason` (3..240 car.).
   - `/delivery_events/{eventId}` et `/delivery_proofs/{proofId}` sont **100 % immuables** (`allow update, delete: if false;`).
6. **Isolation absolue du mode démonstration :** Les données Dakar fictives résident exclusivement en mémoire locale (`src/data/demo/`). Aucun appel Firestore ni aucune écriture `demo_sandbox` n'est autorisée dans les collections opérationnelles.

## 2. Les 12 scénarios de test de sécurité (Phase 8)
1. Utilisateur non connecté : refus sur toutes les collections.
2. Livreur actif : accès lecture/transition autorisé uniquement à ses propres missions.
3. Livreur A : refus d'accès aux missions du livreur B (`get`, `list`, `update`).
4. Livreur suspendu : refus sur `/missions`, `/delivery_events`, `/delivery_proofs`, `/notifications` et mise à jour de profil.
5. Utilisateur en attente (`pending`) : refus des missions réelles et impossibilité de s'auto-activer.
6. Livreur : refus de modifier `codAmount` ou `estimatedFee`.
7. Livreur : refus de modifier `courierId` (réattribution).
8. Livreur : refus de créer une mission (`allow create` admin-only).
9. Livreur : refus de supprimer ou modifier rétroactivement une preuve (`/delivery_proofs`) ou un événement (`/delivery_events`).
10. Livreur : refus de modifier son `role` ou son `accountStatus` ou d'écrire dans `/admins`.
11. Mode démonstration : zéro écriture/lecture Firestore réelle, isolation locale totale.
12. Mission terminée (`DELIVERED`, `RETURN_REQUIRED`, `CANCELLED`) : toute nouvelle transition refusée.
