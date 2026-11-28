import { ExpressApiError } from '../services/expressApi';

export interface CriticalSupabaseNetworkError {
  code: string;
  message: string;
  endpoint?: string;
  endpointLabel: string;
  status?: number;
  occurredAtIso: string;
  afterConnectionLoss: boolean;
  hasCachedSnapshot: boolean;
}

const SUPABASE_ENDPOINT_LABELS: Record<string, string> = {
  'driver-profile': 'Profil livreur (driver-profile)',
  'driver-deliveries': 'Missions de livraison (driver-deliveries)',
  'driver-notifications': 'Alertes et notifications (driver-notifications)',
  'admin-drivers': 'Validation livreurs (admin-drivers)',
  'admin-driver-locations': 'Suivi GPS flotte (admin-driver-locations)',
};

const CRITICAL_NETWORK_CODES = new Set([
  'OFFLINE_NO_CONNECTION',
  'NETWORK_UNREACHABLE',
  'REQUEST_TIMEOUT',
]);

const CRITICAL_GATEWAY_STATUSES = new Set([0, 502, 503, 504]);

const NON_NETWORK_AUTH_CODES = new Set([
  'TOKEN_MISSING',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'EMAIL_NOT_VERIFIED',
  'DRIVER_NOT_REGISTERED',
  'DRIVER_PENDING',
  'DRIVER_SUSPENDED',
  'DRIVER_DISABLED',
  'ADMIN_REQUIRED',
  'ADMIN_FORBIDDEN',
  'BACKEND_NOT_CONFIGURED',
]);

export function formatSupabaseEndpointLabel(endpoint?: string): string {
  if (!endpoint) return 'Fonctions Supabase Express';
  const clean = endpoint.split('?')[0].trim();
  return SUPABASE_ENDPOINT_LABELS[clean] ?? `Fonction Supabase (${clean})`;
}

export function isCriticalSupabaseNetworkError(err: unknown): boolean {
  if (err instanceof ExpressApiError) {
    if (NON_NETWORK_AUTH_CODES.has(err.code)) {
      return false;
    }
    if (CRITICAL_NETWORK_CODES.has(err.code)) {
      return true;
    }
    if (CRITICAL_GATEWAY_STATUSES.has(err.status)) {
      return true;
    }
    return false;
  }

  if (err instanceof Error) {
    const rawCode = (err as { code?: string }).code ?? '';
    if (rawCode === 'auth/network-request-failed') {
      return true;
    }
    const msg = `${err.name} ${err.message}`.toLowerCase();
    return (
      err.name === 'AbortError' ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('err_network') ||
      msg.includes('err_internet_disconnected')
    );
  }

  return false;
}

export function classifySupabaseNetworkError(
  err: unknown,
  options: {
    endpoint?: string;
    afterConnectionLoss: boolean;
    hasCachedSnapshot: boolean;
    isOnline?: boolean;
  }
): CriticalSupabaseNetworkError | null {
  if (!isCriticalSupabaseNetworkError(err)) {
    return null;
  }

  const browserOnline =
    options.isOnline ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  let code = 'NETWORK_UNREACHABLE';
  let status: number | undefined = 0;
  let endpoint = options.endpoint;
  let baseMessage =
    'Impossible de charger vos données depuis les fonctions Supabase. Vérifiez votre connexion puis réessayez.';

  if (err instanceof ExpressApiError) {
    code = err.code;
    status = err.status;
    endpoint = err.endpoint || options.endpoint;
    baseMessage = err.message || baseMessage;
  } else if (err instanceof Error) {
    const rawCode = (err as { code?: string }).code;
    if (rawCode === 'auth/network-request-failed') {
      code = 'NETWORK_UNREACHABLE';
    } else if (err.name === 'AbortError') {
      code = 'REQUEST_TIMEOUT';
    }
  }

  if (!browserOnline) {
    code = 'OFFLINE_NO_CONNECTION';
    baseMessage =
      'Connexion Internet interrompue : les données en direct des fonctions Supabase n’ont pas pu être chargées.';
  } else if (options.afterConnectionLoss) {
    if (code === 'REQUEST_TIMEOUT') {
      baseMessage =
        'La reconnexion aux fonctions Supabase a expiré après la perte de réseau. Relancez la synchronisation.';
    } else if (status === 502 || status === 503 || status === 504) {
      baseMessage =
        'Les fonctions Supabase sont temporairement indisponibles suite à la reprise de connexion. Réessayez dans quelques secondes.';
    } else {
      baseMessage =
        'La synchronisation avec les fonctions Supabase a échoué après la perte de connexion. Vérifiez la stabilité du réseau puis réessayez.';
    }
  }

  return {
    code,
    message: baseMessage,
    endpoint,
    endpointLabel: formatSupabaseEndpointLabel(endpoint),
    status,
    occurredAtIso: new Date().toISOString(),
    afterConnectionLoss: options.afterConnectionLoss || !browserOnline,
    hasCachedSnapshot: options.hasCachedSnapshot,
  };
}
