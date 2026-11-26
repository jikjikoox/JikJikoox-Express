/**
 * Supabase Edge Function : driver-profile
 * - GET   : Récupère le profil officiel du livreur authentifié (crée une demande `pending`
 *           au premier passage si absent, jamais auto-activé).
 * - PATCH : Met à jour uniquement les préférences opérationnelles autorisées d'un livreur `active`.
 */

import { buildCorsHeaders, errorResponse, jsonResponse } from '../_shared/corsAndResponse.ts';
import {
  extractBearerToken,
  FirebaseAuthError,
  verifyFirebaseIdToken,
} from '../_shared/firebaseAuth.ts';
import {
  assertAuthorizedActiveDriver,
  DriverAuthorizationError,
  type DriverRecord,
  fetchDriverByFirebaseUid,
  readDenoEnv,
  supabaseRest,
} from '../_shared/supabaseAdmin.ts';

const ALLOWED_VEHICLES = new Set(['moto', 'scooter', 'voiture', 'velo', 'tricycle']);

export async function handleDriverProfileRequest(req: Request): Promise<Response> {
  const env = readDenoEnv();
  const cors = buildCorsHeaders(req.headers.get('origin'), env.allowedOrigins);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseIdToken(token, {
      projectId: env.firebaseProjectId,
      requireVerifiedEmail: req.method !== 'POST',
    });

    let driver = await fetchDriverByFirebaseUid(env, verified.uid);

    if (req.method === 'POST') {
      const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const firstName = typeof raw?.firstName === 'string' ? raw.firstName.trim() : '';
      const lastName = typeof raw?.lastName === 'string' ? raw.lastName.trim() : '';
      const phone = typeof raw?.phone === 'string' ? raw.phone.trim() : '';
      const vehicleType = typeof raw?.vehicleType === 'string' ? raw.vehicleType : 'scooter';
      const workZone = typeof raw?.workZone === 'string' ? raw.workZone.trim() : 'Dakar';
      if (
        !raw || firstName.length < 2 || firstName.length > 60 ||
        lastName.length < 2 || lastName.length > 60 ||
        phone.length < 8 || phone.length > 24 ||
        !/^\\+?[0-9][0-9 .()-]{6,22}$/.test(phone) ||
        !ALLOWED_VEHICLES.has(vehicleType) || workZone.length < 2 || workZone.length > 80
      ) {
        return errorResponse('INVALID_REGISTRATION', 'Vérifiez les informations de votre inscription.', 400, cors);
      }

      const registration = {
        first_name: firstName,
        last_name: lastName,
        phone,
        vehicle_type: vehicleType,
        work_zone: workZone,
        email: verified.email.slice(0, 160),
        photo_url: verified.picture?.startsWith('https://') ? verified.picture.slice(0, 500) : null,
        role: 'courier',
        account_status: 'pending',
        is_available: false,
      };

      if (driver) {
        if (driver.email.toLowerCase() !== verified.email.toLowerCase() || driver.account_status !== 'pending') {
          return errorResponse('REGISTRATION_ALREADY_EXISTS', 'Ce compte livreur est déjà enregistré ou son statut ne permet pas cette modification.', 409, cors);
        }
        const updated = await supabaseRest<DriverRecord[]>(env,
          `/rest/v1/express_drivers?firebase_uid=eq.${encodeURIComponent(verified.uid)}&account_status=eq.pending`,
          { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(registration) }
        );
        if (!updated.ok || !updated.data?.[0]) {
          return errorResponse('PROFILE_REGISTRATION_FAILED', 'Impossible de compléter votre profil livreur.', 500, cors);
        }
        driver = updated.data[0];
      } else {
        const created = await supabaseRest<DriverRecord[]>(env, '/rest/v1/express_drivers', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            firebase_uid: verified.uid,
            ...registration,
          }),
        });
        if (!created.ok || !created.data?.[0]) {
          return errorResponse('PROFILE_REGISTRATION_FAILED', 'Impossible de créer votre profil livreur.', 500, cors);
        }
        driver = created.data[0];
      }
      return jsonResponse({ ok: true, profile: driver }, 201, cors);
    }

    if (req.method === 'GET') {
      if (!driver) {
        // Premier passage : enregistrement strictement en statut 'pending' (validation Admin requise)
        const parts = (verified.name || verified.email.split('@')[0] || 'Livreur').trim().split(/\s+/);
        const created = await supabaseRest<DriverRecord[]>(env, '/rest/v1/express_drivers', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            firebase_uid: verified.uid,
            email: verified.email.slice(0, 160),
            first_name: (parts[0] || 'Livreur').slice(0, 60),
            last_name: (parts.slice(1).join(' ') || 'JikJikoox').slice(0, 60),
            phone: '+221 77 000 00 00',
            photo_url: verified.picture?.startsWith('https://') ? verified.picture.slice(0, 500) : null,
            role: 'courier',
            account_status: 'pending',
            is_available: false,
          }),
        });
        if (!created.ok || !created.data?.[0]) {
          return errorResponse('PROFILE_INIT_FAILED', 'Impossible d’initialiser votre profil.', 500, cors);
        }
        driver = created.data[0];
      }

      return jsonResponse({ ok: true, profile: driver }, 200, cors);
    }

    if (req.method === 'PATCH') {
      const activeDriver = assertAuthorizedActiveDriver(driver);
      const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') {
        return errorResponse('INVALID_BODY', 'Corps JSON invalide.', 400, cors);
      }

      // Blocage explicite de toute tentative d'élévation de privilèges
      if ('role' in raw || 'account_status' in raw || 'accountStatus' in raw || 'firebase_uid' in raw) {
        return errorResponse('FORBIDDEN_FIELDS', 'Modification des champs de rôle/statut interdite.', 403, cors);
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof raw.firstName === 'string' && raw.firstName.trim()) {
        patch.first_name = raw.firstName.trim().slice(0, 60);
      }
      if (typeof raw.lastName === 'string' && raw.lastName.trim()) {
        patch.last_name = raw.lastName.trim().slice(0, 60);
      }
      if (typeof raw.phone === 'string' && raw.phone.trim().length >= 7) {
        patch.phone = raw.phone.trim().slice(0, 24);
      }
      if (typeof raw.vehicleType === 'string' && ALLOWED_VEHICLES.has(raw.vehicleType)) {
        patch.vehicle_type = raw.vehicleType;
      }
      if (typeof raw.vehiclePlate === 'string') {
        patch.vehicle_plate = raw.vehiclePlate.trim().slice(0, 24);
      }
      if (typeof raw.workZone === 'string' && raw.workZone.trim().length >= 2) {
        patch.work_zone = raw.workZone.trim().slice(0, 80);
      }
      if (typeof raw.isAvailable === 'boolean') {
        patch.is_available = raw.isAvailable;
      }
      if (typeof raw.notificationsEnabled === 'boolean') {
        patch.notifications_enabled = raw.notificationsEnabled;
      }
      if (typeof raw.pushSoundEnabled === 'boolean') {
        patch.push_sound_enabled = raw.pushSoundEnabled;
      }
      if (raw.fcmToken === null || raw.fcmToken === '') {
        patch.fcm_token = null;
        patch.fcm_token_updated_at = new Date().toISOString();
        patch.fcm_token_invalidated_at = null;
      } else if (typeof raw.fcmToken === 'string' && raw.fcmToken.trim().length > 20) {
        patch.fcm_token = raw.fcmToken.trim().slice(0, 512);
        patch.fcm_token_updated_at = new Date().toISOString();
        patch.fcm_token_invalidated_at = null;
      }

      const updated = await supabaseRest<DriverRecord[]>(
        env,
        `/rest/v1/express_drivers?id=eq.${encodeURIComponent(activeDriver.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        }
      );

      if (!updated.ok || !updated.data?.[0]) {
        return errorResponse('PROFILE_UPDATE_FAILED', 'Mise à jour du profil impossible.', 500, cors);
      }
      return jsonResponse({ ok: true, profile: updated.data[0] }, 200, cors);
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Méthode HTTP non autorisée.', 405, cors);
  } catch (err) {
    if (err instanceof FirebaseAuthError || err instanceof DriverAuthorizationError) {
      return errorResponse(err.code, err.message, err.httpStatus, cors);
    }
    return errorResponse('INTERNAL_ERROR', 'Erreur serveur lors de l’accès au profil.', 500, cors);
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve(fn: (r: Request) => Promise<Response>): void } }).Deno;
if (denoRuntime?.serve) {
  denoRuntime.serve(handleDriverProfileRequest);
}
