-- ============================================================================
-- JikJikoox Express — Migration SQL ADDITIVE #2 (GPS, Preuves vérifiées, FCM & Admin)
-- Version : 20261125000002
--
-- GARANTIES ÉCOSYSTÈME :
-- - 100 % additive et non destructive (aucune table existante JikJikoox modifiée/supprimée).
-- - Toutes les nouvelles tables sont préfixées `express_` avec RLS activée.
-- - Aucune politique permissive anon/authenticated : écriture et lecture contrôlées
--   exclusivement par les Supabase Edge Functions authentifiées (Firebase JWT RS256).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Historique GPS immuable des livreurs pendant une mission active
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_driver_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.express_drivers(id) ON DELETE RESTRICT,
  driver_firebase_uid TEXT NOT NULL,
  delivery_id UUID NOT NULL REFERENCES public.express_deliveries(id) ON DELETE RESTRICT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters IS NULL OR (accuracy_meters >= 0 AND accuracy_meters <= 10000)),
  speed_mps DOUBLE PRECISION CHECK (speed_mps IS NULL OR (speed_mps >= 0 AND speed_mps <= 120)),
  heading DOUBLE PRECISION CHECK (heading IS NULL OR (heading >= 0 AND heading <= 360)),
  recorded_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_driver_locations_driver_recorded
  ON public.express_driver_locations (driver_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_express_driver_locations_delivery_recorded
  ON public.express_driver_locations (delivery_id, recorded_at DESC);

DROP TRIGGER IF EXISTS trg_express_driver_locations_immutable ON public.express_driver_locations;
CREATE TRIGGER trg_express_driver_locations_immutable
  BEFORE UPDATE OR DELETE ON public.express_driver_locations
  FOR EACH ROW EXECUTE FUNCTION public.express_forbid_mutation();

-- ----------------------------------------------------------------------------
-- 2. Dernière position GPS connue par livreur (lecture rapide carte Admin)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_driver_last_locations (
  driver_id UUID PRIMARY KEY REFERENCES public.express_drivers(id) ON DELETE CASCADE,
  driver_firebase_uid TEXT NOT NULL UNIQUE,
  delivery_id UUID REFERENCES public.express_deliveries(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters IS NULL OR (accuracy_meters >= 0 AND accuracy_meters <= 10000)),
  speed_mps DOUBLE PRECISION CHECK (speed_mps IS NULL OR (speed_mps >= 0 AND speed_mps <= 120)),
  heading DOUBLE PRECISION CHECK (heading IS NULL OR (heading >= 0 AND heading <= 360)),
  recorded_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_express_driver_last_locations_updated
  ON public.express_driver_last_locations (updated_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Registre serveur des administrateurs autorisés à consulter la flotte GPS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.express_admins (
  firebase_uid TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. Extensions additives sur les tables express_* existantes
-- ----------------------------------------------------------------------------
ALTER TABLE public.express_delivery_proofs
  ADD COLUMN IF NOT EXISTS upload_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.express_delivery_proofs
  ADD COLUMN IF NOT EXISTS upload_verified_at TIMESTAMPTZ;

ALTER TABLE public.express_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_express_notifications_dedupe_key
  ON public.express_notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.express_drivers
  ADD COLUMN IF NOT EXISTS fcm_token_invalidated_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 5. Mise à jour rétrocompatible de express_apply_delivery_transition
--    - Prend en charge p_proof_id (preuve photo vérifiée créée par delivery-proof)
--      afin d'éviter tout doublon dans express_delivery_proofs.
--    - Enregistre optionnellement p_gps_lat / p_gps_lng sur la preuve.
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
  p_cod_confirmed BOOLEAN DEFAULT FALSE,
  p_proof_id UUID DEFAULT NULL,
  p_gps_lat DOUBLE PRECISION DEFAULT NULL,
  p_gps_lng DOUBLE PRECISION DEFAULT NULL
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
  v_verified_proof public.express_delivery_proofs%ROWTYPE;
  v_prev_status TEXT;
  v_allowed BOOLEAN := FALSE;
  v_event_id UUID;
  v_has_verified_proof BOOLEAN := FALSE;
BEGIN
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

  SELECT * INTO v_driver
  FROM public.express_drivers
  WHERE firebase_uid = p_driver_firebase_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRIVER_NOT_FOUND';
  END IF;

  IF v_driver.role <> 'courier' OR v_driver.account_status <> 'active' THEN
    RAISE EXCEPTION 'DRIVER_NOT_ACTIVE:%', v_driver.account_status;
  END IF;

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

    IF p_proof_id IS NOT NULL THEN
      SELECT * INTO v_verified_proof
      FROM public.express_delivery_proofs
      WHERE id = p_proof_id
        AND delivery_id = v_delivery.id
        AND driver_id = v_driver.id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'PROOF_NOT_FOUND_OR_FORBIDDEN';
      END IF;
      v_has_verified_proof := TRUE;
    END IF;
  END IF;

  IF p_next_status IN ('FAILED', 'REFUSED') THEN
    IF p_failure_reason IS NULL OR char_length(trim(p_failure_reason)) < 3 THEN
      RAISE EXCEPTION 'FAILURE_REASON_REQUIRED';
    END IF;
  END IF;

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
      'cod_confirmed', COALESCE(p_cod_confirmed, FALSE),
      'proof_id', p_proof_id
    )
  )
  RETURNING id INTO v_event_id;

  IF p_next_status = 'DELIVERED' AND NOT v_has_verified_proof THEN
    INSERT INTO public.express_delivery_proofs (
      delivery_id,
      order_id,
      driver_id,
      driver_firebase_uid,
      recipient_name,
      proof_code,
      proof_note,
      cod_collected_confirmed,
      gps_lat,
      gps_lng,
      upload_verified
    ) VALUES (
      v_delivery.id,
      v_delivery.order_id,
      v_driver.id,
      p_driver_firebase_uid,
      trim(p_recipient_name),
      NULLIF(trim(p_proof_code), ''),
      NULLIF(trim(p_proof_note), ''),
      COALESCE(p_cod_confirmed, FALSE),
      p_gps_lat,
      p_gps_lng,
      FALSE
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
-- 6. Row-Level Security (RLS) activée partout — accès direct interdit
-- ----------------------------------------------------------------------------
ALTER TABLE public.express_driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_driver_last_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.express_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, DOUBLE PRECISION, DOUBLE PRECISION
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, DOUBLE PRECISION, DOUBLE PRECISION
) TO service_role;
