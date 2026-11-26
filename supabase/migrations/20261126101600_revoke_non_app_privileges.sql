-- Express staging: revoke table-structural privileges that can bypass RLS.
-- Applied successfully to Express staging as migration
-- revoke_table_structural_privileges_staging.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
