-- Keep the marketplace order's delivery_status synchronized with Express missions.
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
  v_order public.orders%ROWTYPE;
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

    -- Sécurité alcool : le livreur doit avoir un contrôle physique positif récent.
    SELECT * INTO v_order FROM public.orders WHERE id = v_delivery.order_id::UUID;
    IF FOUND AND v_order.contains_alcohol THEN
      IF NOT EXISTS (
        SELECT 1
        FROM (
          SELECT outcome, recipient_identity_verified, recipient_age_confirmed, intoxication_observed
          FROM public.alcohol_delivery_checks
          WHERE order_id = v_order.id
          ORDER BY checked_at DESC
          LIMIT 1
        ) latest_check
        WHERE latest_check.outcome = 'passed'
          AND latest_check.recipient_identity_verified = TRUE
          AND latest_check.recipient_age_confirmed = TRUE
          AND latest_check.intoxication_observed = FALSE
      ) THEN
        RAISE EXCEPTION 'ALCOHOL_DELIVERY_CHECK_REQUIRED';
      END IF;
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

  -- Synchronisation du suivi de livraison sur la commande principale.
  -- Le statut de commande et les champs de paiement restent indépendants.
  UPDATE public.orders
  SET delivery_status = CASE p_next_status
    WHEN 'ACCEPTED' THEN 'accepted'
    WHEN 'PREPARING' THEN 'preparing'
    WHEN 'PICKED_UP' THEN 'picked_up'
    WHEN 'IN_TRANSIT' THEN 'in_transit'
    WHEN 'ARRIVED' THEN 'arrived'
    WHEN 'DELIVERED' THEN 'delivered'
    WHEN 'FAILED' THEN 'failed'
    WHEN 'REFUSED' THEN 'refused'
    WHEN 'RETURN_REQUIRED' THEN 'return_required'
    WHEN 'RETURNED' THEN 'returned'
    WHEN 'CANCELLED' THEN 'cancelled'
    ELSE delivery_status
  END,
  updated_at = NOW()
  WHERE id = v_delivery.order_id::UUID;

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

REVOKE ALL ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, DOUBLE PRECISION, DOUBLE PRECISION
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_apply_delivery_transition(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, DOUBLE PRECISION, DOUBLE PRECISION
) TO service_role;
