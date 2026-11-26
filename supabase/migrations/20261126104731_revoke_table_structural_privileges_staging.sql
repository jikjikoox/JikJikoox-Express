-- Applied to Express staging on 2026-11-26.
-- Prevent anon/authenticated from using table-structural privileges that bypass RLS.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
