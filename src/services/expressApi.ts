import {
  type AdminDriversListEdgeResponse,
  type AdminDriverUpdateEdgeResponse,
  type AdminFleetLocationsEdgeResponse,
  buildIdempotencyKey,
  type DeliveryActionEdgeResponse,
  type DeliveryProofConfirmResponse,
  type DeliveryProofEdgeResponse,
  type DeliveryProofPrepareResponse,
  type DeliveryProofRequest,
  type DriverDeliveriesEdgeResponse,
  type DriverLocationEdgeResponse,
  type DriverLocationRequest,
  type DriverNotificationsEdgeResponse,
  type DriverProfileEdgeResponse,
  type EdgeErrorPayload,
  getSupabaseFunctionsBaseUrl,
  isSupabaseBackendConfigured,
} from '../lib/supabaseContract';
import type { AccountStatus, MissionStatus, ProofSubmission, VehicleType } from '../types/delivery';

/**
 * Service frontend centralisé JikJikoox Express -> Supabase Edge Functions.
 *
 * Architecture : UI -> Hooks -> expressApi (Services) -> Edge Functions -> Supabase
 * - Transmet systématiquement `Authorization: Bearer <FIREBASE_ID_TOKEN>`
 * - Gère timeout réseau (12s), retry borné sur erreurs transitoires 502/503/504,
 *   et clés d'idempotence (`X-Idempotency-Key`) sur les mutations.
 * - Ne s'exécute jamais en mode démonstration local.
 */

export class ExpressApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly endpoint?: string;

  constructor(code: string, message: string, status: number, endpoint?: string) {
    super(message);
    this.name = 'ExpressApiError';
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
  }
}

export interface ExpressApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_EXPIRED: 'Votre session a expiré. Veuillez vous reconnecter.',
  TOKEN_INVALID: 'Authentification invalide. Veuillez vous reconnecter.',
  EMAIL_NOT_VERIFIED: 'Veuillez confirmer votre adresse e-mail via le lien reçu avant de continuer.',
  DRIVER_NOT_REGISTERED: 'Aucun profil livreur n’est encore associé à ce compte.',
  DRIVER_PENDING: 'Votre compte est en attente de validation.',
  DRIVER_SUSPENDED: 'Votre compte livreur est temporairement suspendu.',
  DRIVER_DISABLED: 'Votre compte livreur est désactivé.',
  TERMS_REQUIRED: 'Vous devez accepter les conditions d’utilisation pour créer votre compte.',
  REGISTRATION_ALREADY_EXISTS: 'Un profil livreur existe déjà pour ce compte.',
  ADMIN_REQUIRED: 'Accès réservé aux administrateurs JikJikoox Express.',
  ADMIN_FORBIDDEN: 'Accès réservé aux administrateurs JikJikoox Express.',
  MISSION_FORBIDDEN: 'Cette mission ne vous est pas attribuée.',
  MISSION_NOT_FOUND: 'Mission introuvable.',
  MISSION_LOCKED: 'Cette mission est déjà clôturée ou annulée.',
  MISSION_NOT_ACTIVE_FOR_GPS: 'Suivi GPS arrêté : cette mission n’est plus en cours.',
  INVALID_TRANSITION: 'Cette étape n’est pas autorisée dans l’état actuel de la mission.',
  FORBIDDEN_FIELDS: 'Action refusée : certains champs ne sont pas modifiables.',
  STORAGE_UPLOAD_NOT_VERIFIED:
    'La photo n’a pas encore été confirmée dans le stockage sécurisé. Réessayez l’envoi.',
  PHOTO_UPLOAD_FAILED:
    'Échec de l’envoi sécurisé de la photo. Vérifiez votre connexion puis réessayez.',
  OFFLINE_NO_CONNECTION:
    'Aucune connexion Internet détectée. Vérifiez vos données mobiles puis réessayez.',
  NETWORK_UNREACHABLE: 'Connexion au serveur impossible. Vérifiez votre réseau mobile.',
  REQUEST_TIMEOUT: 'Le serveur met trop de temps à répondre. Réessayez dans un instant.',
};

function translateErrorMessage(code: string, fallback: string): string {
  return FRIENDLY_ERROR_MESSAGES[code] || fallback;
}

export function createExpressApiClient(options: ExpressApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? getSupabaseFunctionsBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxRetries = options.maxRetries ?? 2;

  async function request<T>(
    functionName: string,
    idToken: string,
    init: {
      method: 'GET' | 'POST' | 'PATCH';
      body?: Record<string, unknown>;
      idempotencyKey?: string;
      retryable?: boolean;
    }
  ): Promise<T> {
    if (!baseUrl) {
      throw new ExpressApiError(
        'BACKEND_NOT_CONFIGURED',
        'L’URL des Edge Functions Supabase n’est pas encore configurée.',
        503,
        functionName
      );
    }
    if (!idToken) {
      throw new ExpressApiError(
        'TOKEN_MISSING',
        'Session Firebase requise pour contacter le serveur.',
        401,
        functionName
      );
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ExpressApiError(
        'OFFLINE_NO_CONNECTION',
        FRIENDLY_ERROR_MESSAGES.OFFLINE_NO_CONNECTION,
        0,
        functionName
      );
    }

    const attemptsAllowed = init.retryable ? maxRetries + 1 : 1;
    let lastError: ExpressApiError | null = null;

    for (let attempt = 1; attempt <= attemptsAllowed; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${idToken}`,
        };
        if (init.body) headers['Content-Type'] = 'application/json';
        if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey;

        const res = await fetchImpl(`${baseUrl}/${functionName}`, {
          method: init.method,
          headers,
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const parsed = (await res.json().catch(() => null)) as
          | (T & { ok?: boolean })
          | EdgeErrorPayload
          | null;

        if (res.ok && parsed && parsed.ok !== false) {
          return parsed as T;
        }

        const errCode =
          parsed && 'error' in parsed && parsed.error?.code
            ? parsed.error.code
            : `HTTP_${res.status}`;
        const rawMsg =
          parsed && 'error' in parsed && parsed.error?.message
            ? parsed.error.message
            : parsed && 'error' in parsed && typeof parsed.error === 'string'
              ? parsed.error
              : 'Erreur serveur JikJikoox.';

        lastError = new ExpressApiError(
          errCode,
          translateErrorMessage(errCode, rawMsg),
          res.status,
          functionName
        );

        const isTransient = res.status === 502 || res.status === 503 || res.status === 504;
        if (!isTransient || attempt === attemptsAllowed) {
          throw lastError;
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ExpressApiError) {
          throw err;
        }
        const isAbort = err instanceof Error && err.name === 'AbortError';
        lastError = new ExpressApiError(
          isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_UNREACHABLE',
          translateErrorMessage(
            isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_UNREACHABLE',
            'Serveur inaccessible.'
          ),
          0,
          functionName
        );
        if (attempt === attemptsAllowed) {
          throw lastError;
        }
      }
    }

    throw (
      lastError ??
      new ExpressApiError(
        'NETWORK_UNREACHABLE',
        'Serveur JikJikoox inaccessible.',
        0,
        functionName
      )
    );
  }

  return {
    isConfigured: () => Boolean(baseUrl) && (options.baseUrl ? true : isSupabaseBackendConfigured()),

    fetchAdminProfile(idToken: string) {
      return request<{
        ok: true;
        isAdmin: true;
        role: 'admin' | 'super_admin';
        email: string;
        displayName: string | null;
      }>('express-admin-profile', idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    fetchDriverProfile(idToken: string) {
      return request<DriverProfileEdgeResponse>('driver-profile', idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    registerDriver(
      idToken: string,
      registration: {
        firstName: string;
        lastName: string;
        phone: string;
        vehicleType: VehicleType;
        workZone: string;
        termsAccepted: boolean;
      }
    ) {
      return request<DriverProfileEdgeResponse>('driver-profile', idToken, {
        method: 'POST',
        body: registration,
        retryable: false,
      });
    },

    updateDriverProfile(
      idToken: string,
      updates: {
        firstName?: string;
        lastName?: string;
        phone?: string;
        vehicleType?: VehicleType;
        vehiclePlate?: string;
        workZone?: string;
        isAvailable?: boolean;
        notificationsEnabled?: boolean;
        pushSoundEnabled?: boolean;
        fcmToken?: string | null;
      }
    ) {
      return request<DriverProfileEdgeResponse>('driver-profile', idToken, {
        method: 'PATCH',
        body: updates,
        retryable: false,
      });
    },

    confirmCodQrPayment(idToken: string, params: { token: string; amount: number; orderReference: string }) {
      return request<{ ok: true; message: string; order_reference: string; amount: number; currency: string; payment_id: string; confirmed_at: string }>(
        'express-cod-payment-confirm',
        idToken,
        { method: 'POST', body: { token: params.token, amount: params.amount, order_reference: params.orderReference }, retryable: false }
      );
    },

    fetchDriverFinance(idToken: string) {
      return request<any>('driver-finance', idToken, { method: 'GET', retryable: true });
    },

    submitDriverExpense(
      idToken: string,
      payload: { amount: number; category: string; description: string; idempotencyKey: string }
    ) {
      return request<any>('driver-finance', idToken, {
        method: 'POST',
        body: { action: 'submit-expense', ...payload },
        idempotencyKey: payload.idempotencyKey,
        retryable: false,
      });
    },

    fetchDriverMetrics(idToken: string) {
      return request<{
        ok: true;
        generatedAt: string;
        deliveredCount: number;
        totalFees: number;
        gpsDistanceKm: number;
        gpsCoverageCount: number;
        zones: Array<{ zone: string; deliveries: number; fees: number; distanceKm: number }>;
        trips: Array<{ deliveryId: string; orderNumber: string; zone: string; fee: number; distanceKm: number; completedAt: string | null }>;
      }>('driver-metrics', idToken, { method: 'GET', retryable: true });
    },

    fetchDriverDeliveries(idToken: string) {
      return request<DriverDeliveriesEdgeResponse>('driver-deliveries', idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    submitDeliveryAction(
      idToken: string,
      params: {
        deliveryId: string;
        nextStatus: MissionStatus;
        label?: string;
        proof?: ProofSubmission;
        failureReason?: string;
        idempotencyKey?: string;
      }
    ) {
      const idempotencyKey =
        params.idempotencyKey || buildIdempotencyKey(params.deliveryId, params.nextStatus);
      return request<DeliveryActionEdgeResponse>('delivery-action', idToken, {
        method: 'POST',
        idempotencyKey,
        retryable: true, // Sûr grâce à la clé d'idempotence serveur !
        body: {
          deliveryId: params.deliveryId,
          nextStatus: params.nextStatus,
          idempotencyKey,
          label: params.label,
          proof: params.proof,
          failureReason: params.failureReason,
        },
      });
    },

    /** Phase 1 : Demande une URL signée courte durée (120s) sans écrire encore en base */
    prepareDeliveryProofUpload(
      idToken: string,
      payload: Omit<DeliveryProofRequest, 'action'> & {
        mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
        fileSizeBytes: number;
      }
    ) {
      return request<DeliveryProofPrepareResponse>('delivery-proof', idToken, {
        method: 'POST',
        body: {
          ...payload,
          action: 'prepare-upload',
        },
        retryable: false,
      });
    },

    /** Phase 2 : Envoi binaire direct vers l'URL signée Supabase Storage (aucune clé secrète) */
    async uploadPhotoToSignedUrl(
      signedUploadUrl: string,
      file: Blob,
      mimeType: string
    ): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 20_000));
      try {
        const res = await fetchImpl(signedUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'x-upsert': 'false',
          },
          body: file,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          throw new ExpressApiError(
            'PHOTO_UPLOAD_FAILED',
            FRIENDLY_ERROR_MESSAGES.PHOTO_UPLOAD_FAILED,
            res.status
          );
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ExpressApiError) throw err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        throw new ExpressApiError(
          isAbort ? 'REQUEST_TIMEOUT' : 'PHOTO_UPLOAD_FAILED',
          isAbort
            ? FRIENDLY_ERROR_MESSAGES.REQUEST_TIMEOUT
            : FRIENDLY_ERROR_MESSAGES.PHOTO_UPLOAD_FAILED,
          0
        );
      }
    },

    /** Phase 3 : Confirme l'existence réelle du fichier dans Storage et enregistre la preuve immuable */
    confirmDeliveryProof(
      idToken: string,
      payload: Omit<DeliveryProofRequest, 'action'>
    ) {
      return request<DeliveryProofConfirmResponse>('delivery-proof', idToken, {
        method: 'POST',
        body: {
          ...payload,
          action: 'confirm-proof',
        },
        retryable: true,
      });
    },

    createDeliveryProof(idToken: string, payload: DeliveryProofRequest) {
      return request<DeliveryProofEdgeResponse>('delivery-proof', idToken, {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
        retryable: false,
      });
    },

    /** Envoi GPS temps réel pendant une mission active */
    sendDriverLocation(idToken: string, payload: DriverLocationRequest) {
      const idempotencyKey =
        payload.idempotencyKey ||
        `gps_${payload.deliveryId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}_${Date.parse(payload.recordedAtIso) || Date.now()}`;
      return request<DriverLocationEdgeResponse>('driver-location', idToken, {
        method: 'POST',
        idempotencyKey,
        retryable: true,
        body: {
          ...payload,
          idempotencyKey,
        },
      });
    },

    /** Carte temps réel réservée aux administrateurs autorisés */
    fetchAdminFleetLocations(idToken: string) {
      return request<AdminFleetLocationsEdgeResponse>('admin-driver-locations', idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    /** Gestion administrative des comptes livreurs (validation, refus, suspension) */
    fetchAdminDrivers(idToken: string, status?: AccountStatus) {
      const path = status ? `admin-drivers?status=${encodeURIComponent(status)}` : 'admin-drivers';
      return request<AdminDriversListEdgeResponse>(path, idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    updateAdminDriverStatus(
      idToken: string,
      payload: {
        driverId: string;
        accountStatus: 'active' | 'suspended' | 'disabled';
      }
    ) {
      return request<AdminDriverUpdateEdgeResponse>('admin-drivers', idToken, {
        method: 'PATCH',
        body: payload,
        retryable: false,
      });
    },

    fetchNotifications(idToken: string) {
      return request<DriverNotificationsEdgeResponse>('driver-notifications', idToken, {
        method: 'GET',
        retryable: true,
      });
    },

    markNotificationRead(idToken: string, notificationId: string) {
      return request<{ ok: true }>('driver-notifications', idToken, {
        method: 'POST',
        body: { notificationId },
        retryable: true,
      });
    },

    markAllNotificationsRead(idToken: string) {
      return request<{ ok: true }>('driver-notifications', idToken, {
        method: 'POST',
        body: { markAll: true },
        retryable: true,
      });
    },
  };
}

export const expressApi = createExpressApiClient();

