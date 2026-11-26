-- JikJikoox Express production assignment RPC (additive).
CREATE OR REPLACE FUNCTION public.express_admin_assign_delivery(
  p_order_id UUID,
  p_driver_id UUID,
  p_actor_uid UUID,
  p_pickup_name TEXT,
  p_pickup_address TEXT,
  p_instructions TEXT DEFAULT '',
  p_reassign BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_driver public.express_drivers%ROWTYPE;
  v_zone public.delivery_zones%ROWTYPE;
  v_existing public.express_deliveries%ROWTYPE;
  v_delivery public.express_deliveries%ROWTYPE;
  v_items JSONB;
  v_item_count INTEGER;
  v_payment_mode TEXT;
  v_cod_amount NUMERIC(12,2);
  v_delivery_zone TEXT;
  v_delivery_address TEXT;
BEGIN
  IF p_actor_uid IS NULL OR NULLIF(trim(p_pickup_name), '') IS NULL
     OR NULLIF(trim(p_pickup_address), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT_INPUT';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  IF lower(coalesce(v_order.status, '')) IN ('cancelled','canceled','delivered','refunded') THEN
    RAISE EXCEPTION 'ORDER_NOT_DISPATCHABLE';
  END IF;
  IF lower(coalesce(v_order.delivery_status, '')) IN ('delivered','cancelled','canceled') THEN
    RAISE EXCEPTION 'ORDER_NOT_DISPATCHABLE';
  END IF;

  SELECT * INTO v_driver FROM public.express_drivers WHERE id = p_driver_id FOR UPDATE;
  IF NOT FOUND OR v_driver.account_status <> 'active' THEN
    RAISE EXCEPTION 'DRIVER_NOT_ACTIVE';
  END IF;
  IF NOT v_driver.is_available THEN
    RAISE EXCEPTION 'DRIVER_NOT_AVAILABLE';
  END IF;

  SELECT * INTO v_existing
  FROM public.express_deliveries
  WHERE order_id = p_order_id::TEXT
    AND status NOT IN ('DELIVERED','RETURNED','CANCELLED','REFUSED')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF NOT p_reassign THEN RAISE EXCEPTION 'ACTIVE_MISSION_EXISTS'; END IF;
    UPDATE public.express_deliveries
    SET status = 'CANCELLED', sync_version = sync_version + 1, updated_at = NOW()
    WHERE id = v_existing.id;
    INSERT INTO public.express_delivery_events (
      delivery_id, order_id, driver_id, driver_firebase_uid, event_type,
      previous_status, new_status, actor_uid, actor_role, metadata
    ) VALUES (
      v_existing.id, v_existing.order_id, v_existing.driver_id,
      v_existing.driver_firebase_uid, 'ADMIN_REASSIGNMENT',
      v_existing.status, 'CANCELLED', p_actor_uid::TEXT, 'admin',
      jsonb_build_object('reason','Mission réaffectée depuis Admin')
    );
  END IF;

  SELECT * INTO v_zone FROM public.delivery_zones WHERE id = v_order.delivery_zone_id;

  v_delivery_address := concat_ws(', ',
    NULLIF(trim(v_order.address), ''),
    NULLIF(trim(v_order.district), ''),
    NULLIF(trim(v_order.city), ''),
    NULLIF(trim(v_order.region), '')
  );
  IF v_delivery_address = '' THEN
    v_delivery_address := NULLIF(trim(coalesce(v_order.shipping_address->>'address','')), '');
  END IF;
  IF v_delivery_address IS NULL THEN RAISE EXCEPTION 'DELIVERY_ADDRESS_REQUIRED'; END IF;

  IF lower(coalesce(v_order.payment_method,'')) IN ('cod','cash_on_delivery','cash on delivery','contre remboursement') THEN
    v_payment_mode := 'cod';
    v_cod_amount := greatest(coalesce(v_order.total_amount,0),0);
  ELSIF lower(coalesce(v_order.payment_status,'')) IN ('paid','succeeded','completed','settled','success') THEN
    v_payment_mode := 'prepaid';
    v_cod_amount := 0;
  ELSE
    RAISE EXCEPTION 'PAYMENT_NOT_READY_FOR_DISPATCH';
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_name', oi.product_name,
      'product_variant', oi.product_variant,
      'quantity', oi.quantity,
      'sku', oi.sku,
      'subtotal', oi.subtotal
    ) ORDER BY oi.created_at), '[]'::JSONB),
    COALESCE(sum(oi.quantity),0)::INTEGER
  INTO v_items, v_item_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  IF v_item_count = 0 THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'product_name', v_order.product_name,
      'product_variant', v_order.product_variant,
      'quantity', v_order.quantity
    ));
    v_item_count := greatest(coalesce(v_order.quantity,1),1);
  END IF;

  v_delivery_zone := COALESCE(NULLIF(trim(v_zone.zone_name), ''),
                              NULLIF(trim(v_order.city), ''),
                              NULLIF(trim(v_order.region), ''),
                              'Dakar');

  INSERT INTO public.express_deliveries (
    mission_code, order_id, order_number, driver_id, driver_firebase_uid,
    customer_name, customer_phone, delivery_address, delivery_zone,
    pickup_name, pickup_address, items_summary, item_count,
    payment_mode, cod_amount, estimated_fee, instructions, status
  ) VALUES (
    'JEX-' || upper(substr(replace(gen_random_uuid()::TEXT,'-',''),1,10)),
    p_order_id::TEXT, v_order.order_number, v_driver.id, v_driver.firebase_uid,
    v_order.customer_name, v_order.phone, v_delivery_address, v_delivery_zone,
    trim(p_pickup_name), trim(p_pickup_address), v_items, v_item_count,
    v_payment_mode, v_cod_amount, greatest(coalesce(v_order.delivery_fee,0),0),
    left(coalesce(p_instructions,''),1000), 'ASSIGNED'
  ) RETURNING * INTO v_delivery;

  INSERT INTO public.express_delivery_events (
    delivery_id, order_id, driver_id, driver_firebase_uid, event_type,
    previous_status, new_status, actor_uid, actor_role, metadata
  ) VALUES (
    v_delivery.id, v_delivery.order_id, v_driver.id, v_driver.firebase_uid,
    'MISSION_ASSIGNED', 'UNASSIGNED', 'ASSIGNED', p_actor_uid::TEXT, 'admin',
    jsonb_build_object('order_number',v_order.order_number,'mission_code',v_delivery.mission_code)
  );

  UPDATE public.orders
  SET delivery_status = 'assigned', updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'delivery_id', v_delivery.id,
    'mission_code', v_delivery.mission_code,
    'order_id', v_delivery.order_id,
    'driver_id', v_driver.id,
    'driver_firebase_uid', v_driver.firebase_uid,
    'status', v_delivery.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.express_admin_assign_delivery(UUID,UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_admin_assign_delivery(UUID,UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN)
  TO service_role;
