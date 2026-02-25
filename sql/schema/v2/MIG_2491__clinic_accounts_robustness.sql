-- MIG_2491: Clinic Accounts Robustness Fixes
--
-- Addresses fragile points identified in implementation audit:
-- - Fix 1: Feature flag for gradual rollout
-- - Fix 3: Case-insensitive matching indexes
-- - Fix 7: Functional indexes for name matching
-- - Fix 10: source_created_at provenance field
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2491: Clinic Accounts Robustness'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FEATURE FLAG FUNCTION (Fix 1: CRITICAL)
-- ============================================================================

\echo '1. Creating feature flag function...'

-- This function allows TypeScript routes to gracefully handle cases where
-- MIG_2489 hasn't been applied yet (merged_into_account_id column may not exist)
CREATE OR REPLACE FUNCTION ops.clinic_accounts_v2_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops'
      AND table_name = 'clinic_accounts'
      AND column_name = 'merged_into_account_id'
  );
$$;

COMMENT ON FUNCTION ops.clinic_accounts_v2_enabled IS
'Returns TRUE if MIG_2489 has been applied (clinic_accounts v2 extension).
Use this to conditionally enable v2 features in queries.

TypeScript usage:
  const v2Enabled = await sql`SELECT ops.clinic_accounts_v2_enabled()`;
  const query = v2Enabled
    ? sql`... AND ca.merged_into_account_id IS NULL ...`
    : sql`... -- no merge filter ...`;';

\echo '   Created ops.clinic_accounts_v2_enabled()'

-- ============================================================================
-- 2. CASE-INSENSITIVE INDEXES (Fix 3: HIGH)
-- ============================================================================

\echo ''
\echo '2. Creating case-insensitive matching indexes...'

-- Functional index for name-based matching
-- This allows WHERE LOWER(owner_first_name) = LOWER($1) to use the index
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_name_lower
  ON ops.clinic_accounts (LOWER(owner_first_name), LOWER(owner_last_name))
  WHERE merged_into_account_id IS NULL;

-- Functional index for email matching
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_email_lower
  ON ops.clinic_accounts (LOWER(owner_email))
  WHERE owner_email IS NOT NULL AND merged_into_account_id IS NULL;

-- Index for appointments.client_name matching (used in MIG_2490 backfill)
CREATE INDEX IF NOT EXISTS idx_appointments_client_name_lower
  ON ops.appointments (LOWER(client_name))
  WHERE client_name IS NOT NULL AND owner_account_id IS NULL;

\echo '   Created indexes: name_lower, email_lower, client_name_lower'

-- ============================================================================
-- 3. SOURCE_CREATED_AT PROVENANCE (Fix 10: LOW)
-- ============================================================================

\echo ''
\echo '3. Adding source_created_at provenance field...'

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ;

COMMENT ON COLUMN ops.clinic_accounts.source_created_at IS
'INV-4: When this record was created in the source system (ClinicHQ).
Populated from appointment.appointment_date for backfilled accounts.
Distinguishes "when source saw this" from "when Atlas saw this" (first_seen_at).';

-- Backfill from first_appointment_date for existing accounts
UPDATE ops.clinic_accounts
SET source_created_at = first_appointment_date::TIMESTAMPTZ
WHERE source_created_at IS NULL
  AND first_appointment_date IS NOT NULL;

\echo '   Added source_created_at column and backfilled from first_appointment_date'

-- ============================================================================
-- 4. BACKFILL_BATCH COLUMN FOR ROLLBACK (Fix 8: MEDIUM)
-- ============================================================================

\echo ''
\echo '4. Adding backfill_batch column for rollback support...'

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS backfill_batch TEXT;

COMMENT ON COLUMN ops.clinic_accounts.backfill_batch IS
'Tracks which backfill batch created this account (e.g., "MIG_2490_2026-02-23").
Enables rollback via ops.rollback_backfill() if backfill creates incorrect data.';

CREATE INDEX IF NOT EXISTS idx_clinic_accounts_backfill_batch
  ON ops.clinic_accounts (backfill_batch)
  WHERE backfill_batch IS NOT NULL;

\echo '   Added backfill_batch column with index'

-- ============================================================================
-- 5. ROLLBACK FUNCTION (Fix 8: MEDIUM)
-- ============================================================================

\echo ''
\echo '5. Creating rollback function...'

CREATE OR REPLACE FUNCTION ops.rollback_backfill(p_batch_prefix TEXT)
RETURNS TABLE(accounts_deleted INTEGER, appointments_unlinked INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_accounts_deleted INTEGER;
  v_appointments_unlinked INTEGER;
BEGIN
  -- First, unlink appointments from accounts being deleted
  WITH unlinked AS (
    UPDATE ops.appointments
    SET owner_account_id = NULL
    WHERE owner_account_id IN (
      SELECT account_id FROM ops.clinic_accounts
      WHERE backfill_batch LIKE p_batch_prefix || '%'
    )
    RETURNING appointment_id
  )
  SELECT COUNT(*) INTO v_appointments_unlinked FROM unlinked;

  -- Then delete the backfilled accounts
  WITH deleted AS (
    DELETE FROM ops.clinic_accounts
    WHERE backfill_batch LIKE p_batch_prefix || '%'
    RETURNING account_id
  )
  SELECT COUNT(*) INTO v_accounts_deleted FROM deleted;

  RETURN QUERY SELECT v_accounts_deleted, v_appointments_unlinked;
END;
$$;

COMMENT ON FUNCTION ops.rollback_backfill IS
'Rollback a specific backfill batch by prefix.

Usage: SELECT * FROM ops.rollback_backfill(''MIG_2490_2026-02-23'');

WARNING: This removes accounts and unlinks appointments. Use with caution.
Only affects accounts created by backfill (those with backfill_batch set).

Returns:
  accounts_deleted: Number of clinic_accounts removed
  appointments_unlinked: Number of appointments with owner_account_id set to NULL';

\echo '   Created ops.rollback_backfill() function'

-- ============================================================================
-- 6. NAME PARSING FUNCTION (Fix 2: HIGH)
-- ============================================================================

\echo ''
\echo '6. Creating robust name parsing function...'

CREATE OR REPLACE FUNCTION sot.parse_client_name(p_full_name TEXT)
RETURNS TABLE(first_name TEXT, last_name TEXT)
LANGUAGE sql IMMUTABLE AS $$
  WITH parts AS (
    SELECT
      string_to_array(TRIM(COALESCE(p_full_name, '')), ' ') as name_parts
  )
  SELECT
    -- First name: first element
    NULLIF(TRIM(name_parts[1]), '') as first_name,
    -- Last name: LAST element (not second - handles middle names correctly)
    CASE
      WHEN array_length(name_parts, 1) > 1
      THEN NULLIF(TRIM(name_parts[array_length(name_parts, 1)]), '')
      ELSE NULL
    END as last_name
  FROM parts;
$$;

COMMENT ON FUNCTION sot.parse_client_name IS
'Parses full name into first/last. Takes LAST word as last_name (not second word).
This handles middle names correctly.

Examples:
- "Mary Jo Smith" -> first="Mary", last="Smith" (middle name skipped, but preserved in display_name)
- "John Smith Jr" -> first="John", last="Jr" (suffix handling - acceptable)
- "Madonna" -> first="Madonna", last=NULL (single name)
- "Dr. Jane Doe" -> first="Dr.", last="Doe" (prefix handling - acceptable)
- "" or NULL -> first=NULL, last=NULL

Note: The original full name is always preserved in display_name or client_name.
This function is just for approximate first/last extraction for matching purposes.';

\echo '   Created sot.parse_client_name() function'

-- ============================================================================
-- 7. FUZZY MATCHING SUPPORT (Fix 2: HIGH - Optional Enhancement)
-- ============================================================================

\echo ''
\echo '7. Setting up fuzzy matching support...'

-- Enable pg_trgm extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create trigram index on display_name for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_display_name_trgm
  ON ops.clinic_accounts USING gin (display_name gin_trgm_ops)
  WHERE merged_into_account_id IS NULL;

-- Create function to find similar accounts
CREATE OR REPLACE FUNCTION ops.find_similar_accounts(
  p_name TEXT,
  p_threshold REAL DEFAULT 0.3,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE(account_id UUID, display_name TEXT, similarity_score REAL)
LANGUAGE sql STABLE AS $$
  SELECT
    ca.account_id,
    ca.display_name,
    similarity(ca.display_name, p_name) as similarity_score
  FROM ops.clinic_accounts ca
  WHERE ca.merged_into_account_id IS NULL
    AND similarity(ca.display_name, p_name) > p_threshold
  ORDER BY similarity_score DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION ops.find_similar_accounts IS
'Find clinic_accounts with similar display_name using trigram matching.

Usage: SELECT * FROM ops.find_similar_accounts(''Jon Smith'');
Returns accounts like "John Smith", "Jon Smyth", etc.

Parameters:
  p_name: Name to search for
  p_threshold: Minimum similarity score (0.0-1.0), default 0.3
  p_limit: Maximum results to return, default 5

Use this for deduplication review and fuzzy name matching.';

\echo '   Created fuzzy matching infrastructure'

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '8a. Feature flag status:'
SELECT ops.clinic_accounts_v2_enabled() as v2_enabled;

\echo ''
\echo '8b. New columns on clinic_accounts:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'clinic_accounts'
  AND column_name IN ('source_created_at', 'backfill_batch')
ORDER BY column_name;

\echo ''
\echo '8c. New indexes:'
SELECT indexname FROM pg_indexes
WHERE schemaname = 'ops' AND tablename = 'clinic_accounts'
  AND indexname LIKE '%lower%' OR indexname LIKE '%trgm%' OR indexname LIKE '%backfill%'
ORDER BY indexname;

\echo ''
\echo '8d. Name parsing test:'
SELECT * FROM sot.parse_client_name('Mary Jo Smith');
SELECT * FROM sot.parse_client_name('John Smith Jr');
SELECT * FROM sot.parse_client_name('Madonna');

\echo ''
\echo '8e. Fuzzy matching test (if accounts exist):'
SELECT * FROM ops.find_similar_accounts('Smith', 0.2, 3);

-- ============================================================================
-- 9. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2491 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Robustness fixes applied:'
\echo '  Fix 1: ops.clinic_accounts_v2_enabled() feature flag'
\echo '  Fix 3: Case-insensitive indexes (name_lower, email_lower)'
\echo '  Fix 7: Functional indexes for matching'
\echo '  Fix 8: backfill_batch + ops.rollback_backfill()'
\echo '  Fix 10: source_created_at provenance column'
\echo ''
\echo 'New functions:'
\echo '  - sot.parse_client_name(): Robust first/last parsing'
\echo '  - ops.find_similar_accounts(): Fuzzy name matching'
\echo '  - ops.rollback_backfill(): Undo backfill batches'
\echo ''
\echo 'Next: Update MIG_2490 to use these fixes'
\echo ''
