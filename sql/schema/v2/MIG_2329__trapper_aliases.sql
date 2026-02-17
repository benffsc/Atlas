-- MIG_2329__trapper_aliases.sql
-- Create trapper_aliases table for master list trapper name resolution
-- Part of clinic day ground truth workflow

-- Create table if not exists
CREATE TABLE IF NOT EXISTS ops.trapper_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES sot.people(person_id),
  alias_name TEXT NOT NULL,
  alias_type TEXT DEFAULT 'first_name' CHECK (alias_type IN ('first_name', 'nickname', 'display_name', 'manual')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(person_id, alias_name)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_trapper_aliases_person ON ops.trapper_aliases(person_id);
CREATE INDEX IF NOT EXISTS idx_trapper_aliases_name ON ops.trapper_aliases(LOWER(alias_name));

-- Populate from volunteers with trapper/coordinator roles (V2 uses ops.volunteers)
INSERT INTO ops.trapper_aliases (person_id, alias_name, alias_type)
SELECT DISTINCT
  p.person_id,
  COALESCE(NULLIF(p.first_name, ''), SPLIT_PART(p.display_name, ' ', 1)) AS alias_name,
  'first_name'
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND COALESCE(NULLIF(p.first_name, ''), SPLIT_PART(p.display_name, ' ', 1)) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM ops.volunteers v
    WHERE v.person_id = p.person_id
      AND (v.is_trapper = TRUE OR v.is_coordinator = TRUE)
      AND v.status = 'active'
  )
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- Also add display names as aliases
INSERT INTO ops.trapper_aliases (person_id, alias_name, alias_type)
SELECT DISTINCT
  p.person_id,
  p.display_name,
  'display_name'
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND p.display_name IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM ops.volunteers v
    WHERE v.person_id = p.person_id
      AND (v.is_trapper = TRUE OR v.is_coordinator = TRUE)
      AND v.status = 'active'
  )
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- Also populate from request_trapper_assignments (trappers with actual assignments)
INSERT INTO ops.trapper_aliases (person_id, alias_name, alias_type)
SELECT DISTINCT
  p.person_id,
  COALESCE(NULLIF(p.first_name, ''), SPLIT_PART(p.display_name, ' ', 1)) AS alias_name,
  'first_name'
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND COALESCE(NULLIF(p.first_name, ''), SPLIT_PART(p.display_name, ' ', 1)) IS NOT NULL
  AND TRIM(COALESCE(NULLIF(p.first_name, ''), SPLIT_PART(p.display_name, ' ', 1))) != ''
  AND EXISTS (
    SELECT 1 FROM ops.request_trapper_assignments rta
    WHERE rta.trapper_person_id = p.person_id
  )
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- Display names from request_trapper_assignments
INSERT INTO ops.trapper_aliases (person_id, alias_name, alias_type)
SELECT DISTINCT
  p.person_id,
  p.display_name,
  'display_name'
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND p.display_name IS NOT NULL
  AND TRIM(p.display_name) != ''
  AND EXISTS (
    SELECT 1 FROM ops.request_trapper_assignments rta
    WHERE rta.trapper_person_id = p.person_id
  )
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- Drop and recreate function to fix parameter name conflict
DROP FUNCTION IF EXISTS ops.resolve_trapper_alias(TEXT);

-- Function to resolve a trapper alias to person_id
CREATE OR REPLACE FUNCTION ops.resolve_trapper_alias(p_alias TEXT)
RETURNS UUID AS $$
DECLARE
  v_person_id UUID;
BEGIN
  IF p_alias IS NULL OR TRIM(p_alias) = '' THEN
    RETURN NULL;
  END IF;

  -- Try exact match first (case-insensitive)
  SELECT person_id INTO v_person_id
  FROM ops.trapper_aliases
  WHERE LOWER(alias_name) = LOWER(TRIM(p_alias))
    AND is_active = TRUE
  LIMIT 1;

  IF v_person_id IS NOT NULL THEN
    RETURN v_person_id;
  END IF;

  -- Try fuzzy match with similarity > 0.7
  SELECT person_id INTO v_person_id
  FROM ops.trapper_aliases
  WHERE is_active = TRUE
    AND similarity(LOWER(alias_name), LOWER(TRIM(p_alias))) > 0.7
  ORDER BY similarity(LOWER(alias_name), LOWER(TRIM(p_alias))) DESC
  LIMIT 1;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE ops.trapper_aliases IS 'Maps trapper first names/nicknames to person_ids for master list matching';
COMMENT ON FUNCTION ops.resolve_trapper_alias IS 'Resolves a trapper alias (e.g., "Crystal") to a person_id using exact or fuzzy matching';
