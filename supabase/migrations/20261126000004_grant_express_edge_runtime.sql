-- Grants explicites pour les Edge Functions Express utilisant service_role.
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.express_drivers,
  public.express_deliveries,
  public.express_delivery_events,
  public.express_delivery_proofs,
  public.express_notifications,
  public.express_sync_log,
  public.express_driver_locations,
  public.express_driver_last_locations,
  public.express_admins
TO service_role;
