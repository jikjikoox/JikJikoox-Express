-- Applied to Express staging on 2026-11-26.
-- Minimum service_role table privileges needed by Express Edge Functions.
GRANT SELECT ON TABLE public.express_admins TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.express_driver_last_locations TO service_role;
GRANT SELECT, INSERT ON TABLE public.express_driver_locations TO service_role;
