-- ============================================================================
-- JikJikoox Express — Script d'inspection LECTURE SEULE du schéma Supabase
-- Exécuter en staging / SQL Editor AVANT d'appliquer toute migration additive
-- afin de vérifier les tables, colonnes, statuts et triggers déjà existants.
-- ============================================================================

-- 1. Lister toutes les tables publiques existantes
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Inspecter les colonnes des tables liées aux commandes, livreurs et paiements
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name ILIKE '%order%'
    OR table_name ILIKE '%deliver%'
    OR table_name ILIKE '%driver%'
    OR table_name ILIKE '%courier%'
    OR table_name ILIKE '%livreur%'
    OR table_name ILIKE '%payment%'
  )
ORDER BY table_name, ordinal_position;

-- 3. Lister les types ENUM existants (statuts commandes / livraisons)
SELECT t.typname AS enum_name, e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;

-- 4. Lister les triggers et fonctions SQL existants
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 5. Lister les politiques RLS existantes
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
