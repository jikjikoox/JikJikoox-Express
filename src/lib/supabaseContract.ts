import type {
  AccountStatus,
  CourierNotification,
  CourierProfile,
  DeliveryMission,
  MissionStatus,
  ProofSubmission,
  VehicleType,
} from '../types/delivery';

/**
 * Contrat typé entre JikJikoox Express (frontend) et les Supabase Edge Functions.
 *
 * ARCHITECTURE IMPÉRATIVE :
 * - Supabase reste la source officielle pour les commandes, affectations, montants et preuves.
 * - Chaque requête authentifiée transmet `Authorization: Bearer <FIREBASE_ID_TOKEN>`.
 * - Le backend vérifie cryptographiquement le jeton Firebase (RS256, JWKS Google)
 *   et déduit l'identité du livreur uniquement depuis le claim `sub` vérifié.
 * - Le frontend ne détient aucun secret Supabase Service Role ni Firebase Admin.
 */

export interface SupabaseStatusSyncPayload {
  missionId: string;
  orderNumber: string;
  nextStatus: MissionStatus;
  proof?: ProofSubmission;
  failureReason?: string;
  clientTimestampIso: string;
  idempotencyKey?: string;
}

export interface SupabaseSyncResult {
  synced: boolean;
  mode: 'live_backend' | 'pending_backend_connection';
  message: string;
  code?: string;
  idempotentReplay?: boolean;
  firestoreSynced?: boolean;
}

export interface EdgeErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface DriverProfileEdgeResponse {
  ok: true;
  profile: {
    id: string;
    firebase_uid: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
    photo_url: string | null;
    vehicle_type: VehicleType;
    vehicle_plate: string | null;
    work_zone: string;
    role: 'courier';
    account_status: AccountStatus;
    is_available: boolean;
    notifications_enabled: boolean;
    push_sound_enabled: boolean;
    fcm_token: string | null;
    created_at: string;
    updated_at: string;
  };
}

export interface DriverDeliveriesEdgeResponse {
  ok: true;
  deliveries: Array<{
    id: string;
    mission_code: string;
    order_id: string;
    order_number: string;
    driver_firebase_uid: string;
    customer_name: string;
    customer_phone: string;
    delivery_address: string;
    delivery_zone: string;
    pickup_name: string;
    pickup_address: string;
    gps_lat: number | null;
    gps_lng: number | null;
    items_summary: Array<{ name: string; quantity: number; unit?: string }>;
    item_count: number;
    payment_mode: 'cod' | 'prepaid';
    cod_amount: number;
    estimated_fee: number;
    instructions: string;
    status: MissionStatus;
    recipient_name: string | null;
    proof_code: string | null;
    proof_note: string | null;
    failure_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

export interface DeliveryActionEdgeResponse {
  ok: true;
  deliveryId: string;
  status: MissionStatus;
  eventId: string;
  syncVersion: number;
  idempotentReplay: boolean;
  firestoreSynced: boolean;
  notificationSynced: boolean;
}

export interface DeliveryProofRequest {
  action?: 'prepare-upload' | 'confirm-proof';
  deliveryId: string;
  recipientName: string;
  proofId?: string;
  storagePath?: string | null;
  proofCode?: string;
  proofNote?: string;
  codCollectedConfirmed: boolean;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSizeBytes?: number;
  gpsLat?: number;
  gpsLng?: number;
}

export interface DeliveryProofPrepareResponse {
  ok: true;
  phase: 'upload_prepared';
  proofId: string;
  storagePath: string;
  signedUploadUrl: string;
  expiresAtIso: string;
}

export interface DeliveryProofConfirmResponse {
  ok: true;
  phase: 'confirmed';
  proofId: string;
  storagePath: string | null;
  uploadVerified: boolean;
  createdAt: string;
}

export interface DeliveryProofEdgeResponse {
  ok: true;
  phase?: 'upload_prepared' | 'confirmed';
  proofId: string;
  storagePath: string | null;
  signedUploadUrl?: string | null;
  expiresAtIso?: string | null;
  uploadVerified?: boolean;
  createdAt?: string;
}

export interface DriverLocationRequest {
  deliveryId: string;
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  recordedAtIso: string;
  idempotencyKey?: string;
}

export interface DriverLocationEdgeResponse {
  ok: true;
  locationId: string | null;
  deliveryId: string;
  recordedAtIso: string;
  idempotentReplay: boolean;
  throttled: boolean;
}

export interface AdminFleetLocationsEdgeResponse {
  ok: true;
  generatedAtIso: string;
  activeCount: number;
  drivers: Array<{
    driverId: string;
    driverFirebaseUid: string;
    driverName: string;
    driverPhone: string;
    vehicleType: VehicleType;
    workZone: string;
    isAvailable: boolean;
    activeDeliveryId: string | null;
    orderNumber: string | null;
    deliveryStatus: MissionStatus | null;
    deliveryZone: string | null;
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    speedMps: number | null;
    headingDeg: number | null;
    recordedAtIso: string;
    updatedAtIso: string;
  }>;
}

export interface DriverNotificationsEdgeResponse {
  ok: true;
  notifications: Array<{
    id: string;
    driver_firebase_uid: string;
    delivery_id: string | null;
    category: CourierNotification['category'];
    title: string;
    body: string;
    is_read: boolean;
    created_at: string;
    read_at: string | null;
  }>;
}

export type AdminDriverRow = DriverProfileEdgeResponse['profile'];

export interface AdminDriversListEdgeResponse {
  ok: true;
  counts: {
    total: number;
    pending: number;
    active: number;
    suspended: number;
    disabled: number;
  };
  drivers: AdminDriverRow[];
}

export interface AdminDriverUpdateEdgeResponse {
  ok: true;
  driver: AdminDriverRow;
  reviewedBy: string;
}

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

const CONFIGURED_FUNCTIONS_BASE_URL = (
  metaEnv?.VITE_SUPABASE_FUNCTIONS_URL ||
  metaEnv?.VITE_JIKJIKOOX_API_BASE_URL ||
  ''
).trim();

const IS_STAGING_BUILD =
  metaEnv?.VITE_APP_ENV === 'staging' ||
  metaEnv?.MODE === 'staging';

const PRODUCTION_FUNCTIONS_BASE_URL =
  'https://dllafwvyfjodblxhshko.supabase.co/functions/v1';

// Production bundles must not retain the isolated staging Supabase URL.
const FUNCTIONS_BASE_URL = (
  IS_STAGING_BUILD
    ? CONFIGURED_FUNCTIONS_BASE_URL
    : CONFIGURED_FUNCTIONS_BASE_URL.includes('bwicndbbxvthbddiacks')
      ? (metaEnv?.MODE === 'production' ? PRODUCTION_FUNCTIONS_BASE_URL : '')
      : (CONFIGURED_FUNCTIONS_BASE_URL || (metaEnv?.MODE === 'production' ? PRODUCTION_FUNCTIONS_BASE_URL : ''))
)
  .trim()
  .replace(/\/+$/, '');

export function getSupabaseFunctionsBaseUrl(): string {
  return FUNCTIONS_BASE_URL;
}

export function isSupabaseBackendConfigured(): boolean {
  return (
    FUNCTIONS_BASE_URL.startsWith('https://') &&
    !FUNCTIONS_BASE_URL.includes('YOUR_PROJECT_REF') &&
    !FUNCTIONS_BASE_URL.includes('example.com')
  );
}

export function buildIdempotencyKey(missionId: string, nextStatus: MissionStatus): string {
  const safeId = missionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `act_${safeId}_${nextStatus}_${Date.now()}_${rand}`;
}

export function mapEdgeDriverToProfile(
  row: DriverProfileEdgeResponse['profile']
): CourierProfile {
  return {
    uid: row.firebase_uid,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    photoUrl: row.photo_url ?? undefined,
    vehicleType: row.vehicle_type,
    vehiclePlate: row.vehicle_plate ?? undefined,
    workZone: row.work_zone,
    isAvailable: row.is_available,
    role: 'courier',
    accountStatus: row.account_status,
    notificationsEnabled: row.notifications_enabled,
    pushSoundEnabled: row.push_sound_enabled,
    fcmTokenStatus: row.fcm_token ? 'registered' : 'pending',
    createdAtIso: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

export function mapEdgeDeliveryToMission(
  row: DriverDeliveriesEdgeResponse['deliveries'][number]
): DeliveryMission {
  return {
    missionId: row.id,
    orderNumber: row.order_number,
    courierId: row.driver_firebase_uid,
    dataSource: 'supabase_sync',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryZone: row.delivery_zone,
    pickupName: row.pickup_name,
    pickupAddress: row.pickup_address,
    gpsLat: row.gps_lat ?? undefined,
    gpsLng: row.gps_lng ?? undefined,
    itemsSummary: Array.isArray(row.items_summary) ? row.items_summary : [],
    itemCount: row.item_count,
    paymentMode: row.payment_mode,
    codAmount: Number(row.cod_amount),
    estimatedFee: Number(row.estimated_fee),
    instructions: row.instructions || '',
    status: row.status,
    recipientName: row.recipient_name ?? undefined,
    proofCode: row.proof_code ?? undefined,
    proofNote: row.proof_note ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    events: [
      {
        status: row.status,
        label: `Statut officiel Supabase : ${row.status}`,
        timestampIso: row.updated_at,
        actor: 'system',
      },
    ],
    createdAtIso: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

export function mapEdgeNotificationToClient(
  row: DriverNotificationsEdgeResponse['notifications'][number]
): CourierNotification {
  return {
    notificationId: row.id,
    courierId: row.driver_firebase_uid,
    dataSource: 'supabase_sync',
    category: row.category,
    title: row.title,
    body: row.body,
    missionId: row.delivery_id ?? undefined,
    isRead: row.is_read,
    createdAtIso: row.created_at,
    readAtIso: row.read_at ?? undefined,
  };
}

/**
 * Conservé pour compatibilité ascendante : délègue vers l'Edge Function `delivery-action`.
 */
export async function dispatchMissionTransitionToBackend(
  payload: SupabaseStatusSyncPayload,
  firebaseIdToken: string | null
): Promise<SupabaseSyncResult> {
  if (!isSupabaseBackendConfigured()) {
    return {
      synced: false,
      mode: 'pending_backend_connection',
      code: 'BACKEND_NOT_CONFIGURED',
      message:
        'Backend Supabase non configuré dans cet environnement (configurez VITE_SUPABASE_FUNCTIONS_URL pour les missions réelles).',
    };
  }
  if (!firebaseIdToken) {
    return {
      synced: false,
      mode: 'live_backend',
      code: 'TOKEN_MISSING',
      message: 'Session Firebase expirée. Veuillez vous reconnecter.',
    };
  }

  const idempotencyKey =
    payload.idempotencyKey || buildIdempotencyKey(payload.missionId, payload.nextStatus);

  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/delivery-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firebaseIdToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        deliveryId: payload.missionId,
        nextStatus: payload.nextStatus,
        idempotencyKey,
        proof: payload.proof,
        failureReason: payload.failureReason,
      }),
    });

    const data = (await response.json().catch(() => null)) as
      | DeliveryActionEdgeResponse
      | EdgeErrorPayload
      | null;

    if (!response.ok || !data || !data.ok) {
      const errCode = data && !data.ok ? data.error.code : `HTTP_${response.status}`;
      const errMsg =
        data && !data.ok
          ? data.error.message
          : 'Impossible de valider cette action côté serveur.';
      return {
        synced: false,
        mode: 'live_backend',
        code: errCode,
        message: errMsg,
      };
    }

    return {
      synced: true,
      mode: 'live_backend',
      idempotentReplay: data.idempotentReplay,
      firestoreSynced: data.firestoreSynced,
      message: 'Statut validé et enregistré dans Supabase.',
    };
  } catch {
    return {
      synced: false,
      mode: 'live_backend',
      code: 'NETWORK_UNREACHABLE',
      message: 'Serveur JikJikoox inaccessible. Vérifiez votre connexion réseau.',
    };
  }
}
