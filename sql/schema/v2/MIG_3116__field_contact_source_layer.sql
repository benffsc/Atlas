-- MIG_3116: Field Contact Source Layer — contact info lives on the relationship row
--
-- Problem: Name-only field contacts (e.g., "Ruben" with no phone) create ghost
-- sot.people records — no identifiers, can't dedup, useless detail pages.
--
-- Fix: Apply the clinic_accounts pattern to field contacts:
--   - Store raw contact info directly on ops.request_related_people
--   - Make person_id nullable (set when resolvable, NULL when not)
--   - Display uses COALESCE (person data if resolved, contact columns if not)
--   - "Enrich" action later triggers resolution
--
-- Depends on: MIG_3115 (referred_by_person_id, info_completeness already added)
-- Fixes FFS-1421

BEGIN;

-- ============================================================================
-- 1. Add raw contact columns to request_related_people
-- ============================================================================

\echo '1. Adding contact columns to ops.request_related_people...'

ALTER TABLE ops.request_related_people
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone2 TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_address TEXT;

-- ============================================================================
-- 2. Make person_id nullable
-- ============================================================================

\echo '2. Making person_id nullable...'

ALTER TABLE ops.request_related_people
  ALTER COLUMN person_id DROP NOT NULL;

-- ============================================================================
-- 3. Replace unique constraint to handle NULL person_id
-- ============================================================================
-- Old: UNIQUE (request_id, person_id, relationship_type) — NULLs are distinct,
-- so multiple name-only contacts would all pass. We need two constraints:
--   a) Resolved contacts: unique on (request_id, person_id, relationship_type) WHERE person_id IS NOT NULL
--   b) Unresolved contacts: unique on (request_id, contact_name, relationship_type) WHERE person_id IS NULL

\echo '3. Replacing unique constraint...'

ALTER TABLE ops.request_related_people
  DROP CONSTRAINT IF EXISTS request_related_people_request_id_person_id_relationship__key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rrp_resolved_unique
  ON ops.request_related_people (request_id, person_id, relationship_type)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rrp_unresolved_unique
  ON ops.request_related_people (request_id, contact_name, relationship_type)
  WHERE person_id IS NULL;

-- ============================================================================
-- 4. Backfill contact_name from existing linked people
-- ============================================================================

\echo '4. Backfilling contact_name from sot.people for existing rows...'

UPDATE ops.request_related_people rrp
SET contact_name = p.display_name
FROM sot.people p
WHERE p.person_id = rrp.person_id
  AND rrp.contact_name IS NULL;

-- ============================================================================
-- 5. Add CHECK: either person_id or contact_name must be set
-- ============================================================================

\echo '5. Adding CHECK constraint...'

ALTER TABLE ops.request_related_people
  ADD CONSTRAINT rrp_must_have_identity
  CHECK (person_id IS NOT NULL OR contact_name IS NOT NULL);

-- ============================================================================
-- Verify
-- ============================================================================

\echo ''
\echo 'Verifying...'

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'request_related_people'
  AND column_name IN ('person_id', 'contact_name', 'contact_phone', 'contact_email', 'contact_address')
ORDER BY ordinal_position;

\echo 'MIG_3116 complete.'

COMMIT;
