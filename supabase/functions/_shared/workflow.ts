/**
 * Machine à états autoritaire côté backend (Supabase Edge Functions)
 * compatible avec JikJikoox Admin et JikJikoox Express.
 */

export type BackendDeliveryStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'REFUSED'
  | 'FAILED'
  | 'RETURN_REQUIRED'
  | 'RETURNED'
  | 'CANCELLED';

export const TERMINAL_STATUSES: ReadonlySet<BackendDeliveryStatus> = new Set([
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'REFUSED',
]);

export const BACKEND_TRANSITION_GRAPH: Record<
  BackendDeliveryStatus,
  readonly BackendDeliveryStatus[]
> = {
  ASSIGNED: ['ACCEPTED', 'REFUSED'],
  ACCEPTED: ['PREPARING', 'PICKED_UP'],
  PREPARING: ['PICKED_UP'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['DELIVERED', 'FAILED', 'RETURN_REQUIRED'],
  FAILED: ['RETURN_REQUIRED'],
  RETURN_REQUIRED: ['RETURNED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
  REFUSED: [],
};

// Champs strictement interdits dans tout payload envoyé par le livreur
export const FORBIDDEN_CLIENT_FIELDS = [
  'codAmount',
  'cod_amount',
  'estimatedFee',
  'estimated_fee',
  'commission',
  'amount',
  'price',
  'paymentMode',
  'payment_mode',
  'courierId',
  'courier_id',
  'driverId',
  'driver_id',
  'driver_firebase_uid',
  'orderNumber',
  'order_number',
  'orderId',
  'order_id',
  'role',
  'accountStatus',
  'account_status',
  'isAdmin',
] as const;

export interface DeliveryActionRequestBody {
  deliveryId: string;
  nextStatus: BackendDeliveryStatus;
  idempotencyKey: string;
  proof?: {
    recipientName: string;
    proofCode?: string;
    proofNote?: string;
    codCollectedConfirmed?: boolean;
  };
  failureReason?: string;
}

export interface DeliveryRecordForValidation {
  id: string;
  driverFirebaseUid: string;
  status: BackendDeliveryStatus;
  paymentMode: 'cod' | 'prepaid';
  codAmount: number;
}

export interface ValidationOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  httpStatus?: number;
}

export function detectForbiddenFields(rawPayload: Record<string, unknown>): string[] {
  return FORBIDDEN_CLIENT_FIELDS.filter((field) => field in rawPayload);
}

export function validateDeliveryAction(
  rawPayload: Record<string, unknown>,
  delivery: DeliveryRecordForValidation,
  verifiedUid: string
): ValidationOutcome {
  const forbidden = detectForbiddenFields(rawPayload);
  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'FORBIDDEN_FIELDS',
      message: `Modification interdite des champs protégés (${forbidden.join(', ')}).`,
      httpStatus: 400,
    };
  }

  if (delivery.driverFirebaseUid !== verifiedUid) {
    return {
      ok: false,
      code: 'MISSION_FORBIDDEN',
      message: 'Cette mission ne vous est pas attribuée.',
      httpStatus: 403,
    };
  }

  if (TERMINAL_STATUSES.has(delivery.status)) {
    return {
      ok: false,
      code: 'MISSION_LOCKED',
      message: `Mission déjà clôturée (${delivery.status}). Aucune transition autorisée.`,
      httpStatus: 409,
    };
  }

  const nextStatus = rawPayload.nextStatus as BackendDeliveryStatus;
  const allowed = BACKEND_TRANSITION_GRAPH[delivery.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Transition refusée : ${delivery.status} -> ${String(nextStatus)}.`,
      httpStatus: 422,
    };
  }

  if (nextStatus === 'DELIVERED') {
    const proof = rawPayload.proof as DeliveryActionRequestBody['proof'] | undefined;
    const recipient = typeof proof?.recipientName === 'string' ? proof.recipientName.trim() : '';
    if (recipient.length < 2 || recipient.length > 100) {
      return {
        ok: false,
        code: 'RECIPIENT_REQUIRED',
        message: 'Le nom du réceptionnaire (2 à 100 caractères) est requis.',
        httpStatus: 400,
      };
    }
    if (delivery.paymentMode === 'cod' && delivery.codAmount > 0 && proof?.codCollectedConfirmed !== true) {
      return {
        ok: false,
        code: 'COD_CONFIRMATION_REQUIRED',
        message: 'La confirmation d’encaissement COD est obligatoire.',
        httpStatus: 400,
      };
    }
  }

  if (nextStatus === 'FAILED' || nextStatus === 'REFUSED') {
    const reason =
      typeof rawPayload.failureReason === 'string' ? rawPayload.failureReason.trim() : '';
    if (reason.length < 3 || reason.length > 240) {
      return {
        ok: false,
        code: 'FAILURE_REASON_REQUIRED',
        message: 'Un motif structuré (3 à 240 caractères) est obligatoire.',
        httpStatus: 400,
      };
    }
  }

  return { ok: true };
}
