-- ============================================================================
-- JikJikoox Express — Migration SQL 100 % ADDITIVE et NON DESTRUCTIVE
-- Version : 20261125000001
--
-- GARANTIES ÉCOSYSTÈME :
-- - Aucune table existante de JikJikoox Web, Admin, Bictorys ou Wave n'est
--   modifiée, renommée ou supprimée.
-- - Toutes les tables créées sont préfixées `express_` et isolées par RLS
--   (refus par défaut pour anon/authenticated ; écriture exclusive via
--   Supabase Edge Functions authentifiées avec validation Firebase JWT).
-- - Les journaux `express_delivery_events` et `express_delivery_proofs` sont
--   protégés contre UPDATE et DELETE par triggers SQL PostgreSQL.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Livreurs officiels JikJikoox Express
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 60),
  phone TEXT NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 24),
  photo_url TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'scooter'
    CHECK (vehicle_type IN ('moto', 'scooter', 'voiture', 'velo', 'tricycle')),
  vehicle_plate TEXT,
  work_zone TEXT NOT NULL DEFAULT 'Dakar Plateau',
  role TEXT NOT NULL DEFAULT 'courier' CHECK (role IN ('courier')),
  account_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (account_status IN ('pending', 'active', 'suspended', 'disabled')),
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  fcm_token TEXT,
  fcm_token_updated_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_drivers_status
  ON public.express_drivers (account_status);

-- ----------------------------------------------------------------------------
-- 2. Affectations & missions de livraison (liées aux commandes officielles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_code TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  driver_id UUID NOT NULL REFERENCES public.express_drivers(id) ON DELETE RESTRICT,
  driver_firebase_uid TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_zone TEXT NOT NULL,
  pickup_name TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  items_summary JSONB NOT NULL DEFAULT '[]'::JSONB,
  item_count INTEGER NOT NULL DEFAULT 1 CHECK (item_count >= 1),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cod', 'prepaid')),
  cod_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  estimated_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (estimated_fee >= 0),
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (
    status IN (
      'ASSIGNED',
      'ACCEPTED',
      'PREPARING',
      'PICKED_UP',
      'IN_TRANSIT',
      'ARRIVED',
      'DELIVERED',
      'REFUSED',
      'FAILED',
      'RETURN_REQUIRED',
      'RETURNED',
      'CANCELLED'
    )
  ),
  recipient_name TEXT,
  proof_code TEXT,
  proof_note TEXT,
  failure_reason TEXT,
  sync_version INTEGER NOT NULL DEFAULT 1,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_deliveries_driver_uid_created
  ON public.express_deliveries (driver_firebase_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_express_deliveries_order_id
  ON public.express_deliveries (order_id);

CREATE INDEX IF NOT EXISTS idx_express_deliveries_status
  ON public.express_deliveries (status);

-- ----------------------------------------------------------------------------
-- 3. Journal d'événements IMMUABLE (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.express_deliveries(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  driver_id UUID NOT NULL REFERENCES public.express_drivers(id) ON DELETE RESTRICT,
  driver_firebase_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'courier' CHECK (actor_role IN ('courier', 'admin', 'system')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_delivery_events_delivery
  ON public.express_delivery_events (delivery_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Preuves de livraison IMMUABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_delivery_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.express_deliveries(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  driver_id UUID NOT NULL REFERENCES public.express_drivers(id) ON DELETE RESTRICT,
  driver_firebase_uid TEXT NOT NULL,
  recipient_name TEXT NOT NULL CHECK (char_length(recipient_name) BETWEEN 2 AND 100),
  proof_code TEXT,
  proof_note TEXT,
  signature_data_hash TEXT,
  storage_bucket TEXT NOT NULL DEFAULT 'delivery-proofs',
  storage_path TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER CHECK (file_size_bytes IS NULL OR (file_size_bytes > 0 AND file_size_bytes <= 5242880)),
  cod_collected_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_delivery_proofs_delivery
  ON public.express_delivery_proofs (delivery_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Notifications opérationnelles livreur
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.express_drivers(id) ON DELETE RESTRICT,
  driver_firebase_uid TEXT NOT NULL,
  delivery_id UUID REFERENCES public.express_deliveries(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (
    category IN ('assignment', 'modification', 'cancellation', 'instruction', 'operational', 'confirmation')
  ),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 2 AND 400),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  fcm_dispatch_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (fcm_dispatch_status IN ('pending', 'sent', 'failed', 'skipped')),
  fcm_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_notifications_driver_created
  ON public.express_notifications (driver_firebase_uid, created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Journal de synchronisation Supabase -> Firestore (Idempotence & Retry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_key TEXT NOT NULL UNIQUE,
  delivery_id UUID NOT NULL REFERENCES public.express_deliveries(id) ON DELETE RESTRICT,
  target_system TEXT NOT NULL CHECK (target_system IN ('firestore', 'fcm')),
  sync_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_sync_log_status
  ON public.express_sync_log (status, updated_at ASC);

-- ----------------------------------------------------------------------------
-- 7. Triggers d'immuabilité absolue sur events & proofs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Immutability violation: % cannot be modified or deleted', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_express_delivery_events_immutable ON public.express_delivery_events;
CREATE TRIGGER trg_express_delivery_events_immutable
  BEFORE UPDATE OR DELETE ON public.express_delivery_events
  FOR EACH ROW EXECUTE FUNCTION public.express_forbid_mutation();

DROP TRIGGER IF EXISTS trg_express_delivery_proofs_immutable ON public.express_delivery_proofs;
CREATE TRIGGER trg_express_delivery_proofs_immutable
  BEFORE UPDATE OR DELETE ON public.express_delivery_proofs
  FOR EACH ROW EXECUTE FUNCTION public.express_forbid_mutation();

-- ----------------------------------------------------------------------------
-- 8. Fonction transactionnelle atomique avec verrouillage FOR UPDATE + Idempotence
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_apply_delivery_transition(
  p_delivery_id UUID,
  p_driver_firebase_uid TEXT,
  p_next_status TEXT,
  p_idempotency_key TEXT,
  p_label TEXT,
  p_recipient_name TEXT DEFAULT NULL,
  p_proof_code TEXT DEFAULT NULL,
  p_proof_note TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL,
  p_cod_confirmed BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_event public.express_delivery_events%ROWTYPE;
  v_delivery public.express_deliveries%ROWTYPE;
  v_driver public.express_drivers%ROWTYPE;
  v_prev_status TEXT;
  v_allowed BOOLEAN := FALSE;
  v_event_id UUID;
BEGIN
  -- 1. Idempotence : si cette clé a déjà été traitée, retourner la réponse existante sans doublon
  IF p_idempotency_key IS NOT NULL AND char_length(p_idempotency_key) > 0 THEN
    SELECT * INTO v_existing_event
    FROM public.express_delivery_events
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      SELECT * INTO v_delivery FROM public.express_deliveries WHERE id = v_existing_event.delivery_id;
      RETURN jsonb_build_object(
        'idempotent_replay', TRUE,
        'event_id', v_existing_event.id,
        'delivery_id', v_delivery.id,
        'status', v_delivery.status,
        'sync_version', v_delivery.sync_version
      );
    END IF;
  END IF;

  -- 2. Vérifier que le livreur est actif et autorisé
  SELECT * INTO v_driver
  FROM public.express_drivers
  WHERE firebase_uid = p_driver_firebase_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRIVER_NOT_FOUND';
  END IF;

  IF v_driver.role <> 'courier' OR v_driver.account_status <> 'active' THEN
    RAISE EXCEPTION 'DRIVER_NOT_ACTIVE:%', v_driver.account_status;
  END IF;

  -- 3. Verrouiller la ligne de livraison (protection concurrence / annulation simultanée)
  SELECT * INTO v_delivery
  FROM public.express_deliveries
  WHERE id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MISSION_NOT_FOUND';
  END IF;

  IF v_delivery.driver_id <> v_driver.id OR v_delivery.driver_firebase_uid <> p_driver_firebase_uid THEN
    RAISE EXCEPTION 'MISSION_FORBIDDEN';
  END IF;

  IF v_delivery.status IN ('DELIVERED', 'RETURNED', 'CANCELLED', 'REFUSED') THEN
    RAISE EXCEPTION 'MISSION_TERMINAL:%', v_delivery.status;
  END IF;

  v_prev_status := v_delivery.status;

  -- 4. Machine à états serveur autoritaire
  v_allowed := (
    (v_prev_status = 'ASSIGNED' AND p_next_status IN ('ACCEPTED', 'REFUSED')) OR
    (v_prev_status = 'ACCEPTED' AND p_next_status IN ('PREPARING', 'PICKED_UP')) OR
    (v_prev_status = 'PREPARING' AND p_next_status = 'PICKED_UP') OR
    (v_prev_status = 'PICKED_UP' AND p_next_status = 'IN_TRANSIT') OR
    (v_prev_status = 'IN_TRANSIT' AND p_next_status = 'ARRIVED') OR
    (v_prev_status = 'ARRIVED' AND p_next_status IN ('DELIVERED', 'FAILED', 'RETURN_REQUIRED')) OR
    (v_prev_status = 'FAILED' AND p_next_status = 'RETURN_REQUIRED') OR
    (v_prev_status = 'RETURN_REQUIRED' AND p_next_status = 'RETURNED')
  );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'INVALID_TRANSITION:%->%', v_prev_status, p_next_status;
  END IF;

  IF p_next_status = 'DELIVERED' THEN
    IF p_recipient_name IS NULL OR char_length(trim(p_recipient_name)) < 2 THEN
      RAISE EXCEPTION 'RECIPIENT_REQUIRED';
    END IF;
    IF v_delivery.payment_mode = 'cod' AND v_delivery.cod_amount > 0 AND NOT COALESCE(p_cod_confirmed, FALSE) THEN
      RAISE EXCEPTION 'COD_CONFIRMATION_REQUIRED';
    END IF;
  END IF;

  IF p_next_status IN ('FAILED', 'REFUSED') THEN
    IF p_failure_reason IS NULL OR char_length(trim(p_failure_reason)) < 3 THEN
      RAISE EXCEPTION 'FAILURE_REASON_REQUIRED';
    END IF;
  END IF;

  -- 5. Mise à jour officielle atomique + incrément sync_version
  UPDATE public.express_deliveries
  SET
    status = p_next_status,
    recipient_name = COALESCE(NULLIF(trim(p_recipient_name), ''), recipient_name),
    proof_code = COALESCE(NULLIF(trim(p_proof_code), ''), proof_code),
    proof_note = COALESCE(NULLIF(trim(p_proof_note), ''), proof_note),
    failure_reason = COALESCE(NULLIF(trim(p_failure_reason), ''), failure_reason),
    sync_version = sync_version + 1,
    updated_at = NOW()
  WHERE id = v_delivery.id
  RETURNING * INTO v_delivery;

  -- 6. Enregistrement de l'événement immuable avec le vrai statut précédent
  INSERT INTO public.express_delivery_events (
    delivery_id,
    order_id,
    driver_id,
    driver_firebase_uid,
    event_type,
    previous_status,
    new_status,
    actor_uid,
    actor_role,
    idempotency_key,
    metadata
  ) VALUES (
    v_delivery.id,
    v_delivery.order_id,
    v_driver.id,
    p_driver_firebase_uid,
    'STATUS_TRANSITION',
    v_prev_status,
    p_next_status,
    p_driver_firebase_uid,
    'courier',
    NULLIF(trim(p_idempotency_key), ''),
    jsonb_build_object(
      'label', COALESCE(p_label, p_next_status),
      'failure_reason', p_failure_reason,
      'cod_confirmed', COALESCE(p_cod_confirmed, FALSE)
    )
  )
  RETURNING id INTO v_event_id;

  -- 7. Si DELIVERED, créer la preuve officielle immuable dans la même transaction
  IF p_next_status = 'DELIVERED' THEN
    INSERT INTO public.express_delivery_proofs (
      delivery_id,
      order_id,
      driver_id,
      driver_firebase_uid,
      recipient_name,
      proof_code,
      proof_note,
      cod_collected_confirmed
    ) VALUES (
      v_delivery.id,
      v_delivery.order_id,
      v_driver.id,
      p_driver_firebase_uid,
      trim(p_recipient_name),
      NULLIF(trim(p_proof_code), ''),
      NULLIF(trim(p_proof_note), ''),
      COALESCE(p_cod_confirmed, FALSE)
    );
  END IF;

  RETURN jsonb_build_object(
    'idempotent_replay', FALSE,
    'event_id', v_event_id,
    'delivery_id', v_delivery.id,
    'status', v_delivery.status,
    'sync_version', v_delivery.sync_version,
    'updated_at', v_delivery.updated_at
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Row-Level Security (RLS) — Refus total client direct (Edge Functions only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.express_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_delivery_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_sync_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO service_role;
