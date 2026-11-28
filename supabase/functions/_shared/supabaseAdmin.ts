/**
 * Accès serveur Supabase (Service Role strictement côté Edge Functions)
 * et vérification centralisée d'autorisation du livreur après validation Firebase JWT.
 */

export interface DriverRecord {
  id: string;
  firebase_uid: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  photo_url: string | null;
  vehicle_type: 'moto' | 'scooter' | 'voiture' | 'velo' | 'tricycle';
  vehicle_plate: string | null;
  work_zone: string;
  role: 'courier';
  account_status: 'pending' | 'active' | 'suspended' | 'disabled';
  is_available: boolean;
  notifications_enabled: boolean;
  push_sound_enabled: boolean;
  fcm_token: string | null;
  created_at: string;
  updated_at: string;
}

export class DriverAuthorizationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 403) {
    super(message);
    this.name = 'DriverAuthorizationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function assertAuthorizedActiveDriver(driver: DriverRecord | null): DriverRecord {
  if (!driver) {
    throw new DriverAuthorizationError(
      'DRIVER_NOT_REGISTERED',
      'Compte livreur introuvable dans JikJikoox Admin.',
      403
    );
  }
  if (driver.role !== 'courier') {
    throw new DriverAuthorizationError(
      'ROLE_FORBIDDEN',
      'Rôle insuffisant pour accéder à JikJikoox Express.',
      403
    );
  }
  if (driver.account_status === 'pending') {
    throw new DriverAuthorizationError(
      'DRIVER_PENDING',
      'Votre compte livreur est en attente de validation par JikJikoox Admin.',
      403
    );
  }
  if (driver.account_status === 'suspended') {
    throw new DriverAuthorizationError(
      'DRIVER_SUSPENDED',
      'Votre compte livreur est temporairement suspendu.',
      403
    );
  }
  if (driver.account_status === 'disabled') {
    throw new DriverAuthorizationError(
      'DRIVER_DISABLED',
      'Votre compte livreur est désactivé.',
      403
    );
  }
  return driver;
}

/**
 * Helper d'appel REST PostgREST / Storage / RPC Supabase côté Edge Functions
 * utilisant exclusivement `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` issus de Deno.env.
 */
export interface SupabaseServerEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  firebaseClientEmail?: string;
  firebasePrivateKey?: string;
  allowedOrigins?: string;
  internalSyncSecret?: string;
}

export function readDenoEnv(): SupabaseServerEnv {
  const env = (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env;
  const get = (key: string) => env?.get(key) ?? '';

  const supabaseUrl = get('SUPABASE_URL');
  const serviceRoleKey = get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_ENV_MISSING');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    serviceRoleKey,
    firebaseProjectId: get('FIREBASE_PROJECT_ID') || 'livraisonjikjikoox',
    firestoreDatabaseId: get('FIRESTORE_DATABASE_ID') || '(default)',
    firebaseClientEmail: get('FIREBASE_SERVICE_ACCOUNT_EMAIL') || undefined,
    firebasePrivateKey: get('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY')?.replace(/\\n/g, '\n') || undefined,
    allowedOrigins: get('ALLOWED_ORIGINS') || undefined,
    internalSyncSecret: get('INTERNAL_SYNC_SECRET') || undefined,
  };
}

export async function supabaseRest<T>(
  env: SupabaseServerEnv,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T | null; errorText?: string }> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.serviceRoleKey);
  headers.set('Authorization', `Bearer ${env.serviceRoleKey}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${env.supabaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, data: null, errorText: text };
  }

  if (res.status === 204) {
    return { ok: true, status: 204, data: null };
  }
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data };
}

export async function fetchDriverByFirebaseUid(
  env: SupabaseServerEnv,
  firebaseUid: string
): Promise<DriverRecord | null> {
  const res = await supabaseRest<DriverRecord[]>(
    env,
    `/rest/v1/express_drivers?firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
    return null;
  }
  return res.data[0];
}

export interface AdminRecord {
  firebase_uid: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  supabase_user_id: string;
  role: 'admin' | 'super_admin';
}

/**
 * L'identité Firebase n'accorde aucun rôle à elle seule.
 * L'UID doit être explicitement lié à un profil Supabase actif,
 * dont le rôle est relu côté serveur à chaque requête administrative.
 */
export async function fetchActiveAdminByFirebaseUid(
  env: SupabaseServerEnv,
  firebaseUid: string
): Promise<AdminRecord | null> {
  const res = await supabaseRest<Omit<AdminRecord, 'role'>[]>(
    env,
    `/rest/v1/express_admins?firebase_uid=eq.${encodeURIComponent(firebaseUid)}&is_active=eq.true&select=firebase_uid,email,display_name,is_active,supabase_user_id&limit=1`
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length !== 1) {
    return null;
  }

  const mapping = res.data[0];
  if (!mapping.supabase_user_id || mapping.email.toLowerCase() === '') {
    return null;
  }

  const profileRes = await supabaseRest<Array<{ role: string; email: string | null }>>(
    env,
    `/rest/v1/profiles?user_id=eq.${encodeURIComponent(mapping.supabase_user_id)}&is_active=eq.true&select=role,email&limit=1`
  );
  if (!profileRes.ok || !Array.isArray(profileRes.data) || profileRes.data.length !== 1) {
    return null;
  }

  const profile = profileRes.data[0];
  if (
    (profile.role !== 'admin' && profile.role !== 'super_admin') ||
    !profile.email ||
    profile.email.toLowerCase() !== mapping.email.toLowerCase()
  ) {
    return null;
  }

  return { ...mapping, role: profile.role };
}

export function assertAuthorizedAdmin(admin: AdminRecord | null): AdminRecord {
  if (!admin || !admin.is_active) {
    throw new DriverAuthorizationError(
      'ADMIN_REQUIRED',
      'Accès réservé aux administrateurs JikJikoox Express.',
      403
    );
  }
  return admin;
}
