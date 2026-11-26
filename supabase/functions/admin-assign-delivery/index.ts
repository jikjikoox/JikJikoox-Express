const denoRuntime = (globalThis as unknown as {
  Deno?: {
    env: { get(key: string): string | undefined };
    serve(handler: (req: Request) => Promise<Response>): void;
  };
}).Deno;
const getEnv = (key: string) => denoRuntime?.env.get(key) || "";

const corsHeaders = (origin: string | null) => {
  const configured = (getEnv("CORS_ALLOWED_ORIGINS") || "https://admin.jikjikoox.com")
    .split(",").map((v: string) => v.trim()).filter(Boolean);
  const allowedOrigin = origin && configured.includes(origin) ? origin : configured[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
};

const json = (body: unknown, status = 200, headers: Record<string,string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const fail = (code: string, message: string, status: number, headers: Record<string,string>) =>
  json({ ok: false, code, message }, status, headers);

const handleRequest = async (req: Request): Promise<Response> => {
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Méthode non autorisée.", 405, headers);

  const supabaseUrl = getEnv("SUPABASE_URL") || "";
  const anonKey = getEnv("SUPABASE_ANON_KEY") || "";
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return fail("SERVER_CONFIGURATION_ERROR", "Configuration serveur incomplète.", 500, headers);
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return fail("UNAUTHORIZED", "Session administrateur requise.", 401, headers);

    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return fail("UNAUTHORIZED", "Session invalide ou expirée.", 401, headers);
    const authUser = await authRes.json();
    const userId = String(authUser?.id || "");
    if (!userId) return fail("UNAUTHORIZED", "Identité administrateur introuvable.", 401, headers);

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,is_active&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!profileRes.ok) return fail("ADMIN_PROFILE_CHECK_FAILED", "Vérification des droits impossible.", 502, headers);
    const profiles = await profileRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const allowedRoles = new Set(["super_admin", "admin", "logistics_manager"]);
    if (!profile || profile.is_active !== true || !allowedRoles.has(String(profile.role))) {
      return fail("FORBIDDEN", "Droits logistiques insuffisants.", 403, headers);
    }

    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object") return fail("INVALID_BODY", "Corps de requête invalide.", 400, headers);
    const action = String(raw.action || "");

    if (action === "list_drivers") {
      const driversRes = await fetch(
        `${supabaseUrl}/rest/v1/express_drivers?account_status=eq.active&is_available=eq.true&select=id,first_name,last_name,phone,vehicle_type,work_zone,is_available&order=first_name.asc`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      if (!driversRes.ok) return fail("DRIVERS_FETCH_FAILED", "Impossible de charger les livreurs disponibles.", 502, headers);
      return json({ ok: true, drivers: await driversRes.json() }, 200, headers);
    }

    if (action !== "assign" && action !== "reassign") {
      return fail("INVALID_ACTION", "Action inconnue.", 400, headers);
    }
    const orderId = String(raw.orderId || "");
    const driverId = String(raw.driverId || "");
    const pickupName = String(raw.pickupName || "").trim();
    const pickupAddress = String(raw.pickupAddress || "").trim();
    const instructions = typeof raw.instructions === "string" ? raw.instructions.slice(0, 1000) : "";
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(orderId) || !uuidPattern.test(driverId) ||
        pickupName.length < 2 || pickupName.length > 100 ||
        pickupAddress.length < 5 || pickupAddress.length > 300) {
      return fail("INVALID_ASSIGNMENT_INPUT", "Commande, livreur ou point de collecte invalide.", 400, headers);
    }

    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/express_admin_assign_delivery`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_order_id: orderId,
        p_driver_id: driverId,
        p_actor_uid: userId,
        p_pickup_name: pickupName,
        p_pickup_address: pickupAddress,
        p_instructions: instructions,
        p_reassign: action === "reassign",
      }),
    });
    const rpcBody = await rpcRes.json().catch(() => null);
    if (!rpcRes.ok) {
      const message = String(rpcBody?.message || rpcBody?.details || "");
      const mapping: Record<string, [string,string,number]> = {
        ORDER_NOT_FOUND: ["ORDER_NOT_FOUND", "Commande introuvable.", 404],
        ORDER_NOT_DISPATCHABLE: ["ORDER_NOT_DISPATCHABLE", "Cette commande ne peut pas être affectée.", 409],
        DRIVER_NOT_ACTIVE: ["DRIVER_NOT_ACTIVE", "Ce livreur n’est pas actif.", 409],
        DRIVER_NOT_AVAILABLE: ["DRIVER_NOT_AVAILABLE", "Ce livreur n’est pas disponible.", 409],
        ACTIVE_MISSION_EXISTS: ["ACTIVE_MISSION_EXISTS", "Une mission active existe déjà pour cette commande.", 409],
        PAYMENT_NOT_READY_FOR_DISPATCH: ["PAYMENT_NOT_READY", "Le paiement doit être confirmé avant l’expédition, sauf commande COD.", 409],
        DELIVERY_ADDRESS_REQUIRED: ["DELIVERY_ADDRESS_REQUIRED", "Adresse de livraison manquante.", 422],
      };
      const matched = Object.entries(mapping).find(([key]) => message.includes(key));
      if (matched) return fail(matched[1][0], matched[1][1], matched[1][2], headers);
      return fail("ASSIGNMENT_FAILED", "L’affectation n’a pas pu être enregistrée.", 502, headers);
    }
    return json({ ok: true, assignment: rpcBody }, 201, headers);
  } catch {
    return fail("INTERNAL_ERROR", "Erreur interne du service d’affectation.", 500, headers);
  }
};

if (denoRuntime?.serve) denoRuntime.serve(handleRequest);
