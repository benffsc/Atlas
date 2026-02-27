-- MIG_2550__clinichq_client_notes.sql
-- Add ClinicHQ client ID and notes columns to ops.clinic_accounts
-- Enables notes ingestion from scraped ClinicHQ data and gap analysis

\echo '=============================================='
\echo 'MIG_2550: ClinicHQ Client Notes'
\echo '=============================================='

-- ============================================================================
-- PART 1: Add columns to ops.clinic_accounts
-- ============================================================================

\echo '1. Adding clinichq_client_id column...'

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS clinichq_client_id BIGINT;

COMMENT ON COLUMN ops.clinic_accounts.clinichq_client_id IS
'The ClinicHQ internal client ID. Used for deduplication and gap analysis.';

\echo '2. Adding notes columns...'

ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS quick_notes TEXT,
ADD COLUMN IF NOT EXISTS long_notes TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT,
ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN ops.clinic_accounts.quick_notes IS
'Quick Notes field from ClinicHQ - brief flags/reminders about the client';
COMMENT ON COLUMN ops.clinic_accounts.long_notes IS
'Long Notes field from ClinicHQ - detailed history and context';
COMMENT ON COLUMN ops.clinic_accounts.tags IS
'Tags field from ClinicHQ - categorization labels';
COMMENT ON COLUMN ops.clinic_accounts.notes_updated_at IS
'When the notes were last updated from ClinicHQ scrape';

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

\echo '3. Creating indexes...'

-- Unique index on clinichq_client_id for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_accounts_clinichq_client_id
ON ops.clinic_accounts(clinichq_client_id)
WHERE clinichq_client_id IS NOT NULL;

-- Full-text search index on notes for Tippy queries
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_notes_fts
ON ops.clinic_accounts
USING gin(to_tsvector('english', COALESCE(quick_notes, '') || ' ' || COALESCE(long_notes, '')))
WHERE quick_notes IS NOT NULL OR long_notes IS NOT NULL;

-- Index for finding accounts with notes
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_has_notes
ON ops.clinic_accounts(notes_updated_at DESC NULLS LAST)
WHERE quick_notes IS NOT NULL OR long_notes IS NOT NULL;

-- ============================================================================
-- PART 3: Matching function
-- ============================================================================

\echo '4. Creating matching function...'

CREATE OR REPLACE FUNCTION ops.match_clinichq_client(
  p_clinichq_client_id BIGINT,
  p_name TEXT,
  p_email TEXT,
  p_cell_phone TEXT,
  p_other_phone TEXT,
  p_address TEXT
) RETURNS UUID AS $$
DECLARE
  v_account_id UUID;
  v_norm_email TEXT;
  v_norm_cell TEXT;
  v_norm_other TEXT;
BEGIN
  -- 1. Already matched by client_id?
  IF p_clinichq_client_id IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE clinichq_client_id = p_clinichq_client_id
    AND merged_into_account_id IS NULL;
    IF FOUND THEN RETURN v_account_id; END IF;
  END IF;

  -- Normalize identifiers
  v_norm_email := LOWER(TRIM(NULLIF(p_email, '')));
  v_norm_cell := sot.norm_phone_us(p_cell_phone);
  v_norm_other := sot.norm_phone_us(p_other_phone);

  -- 2. Match by email (strongest identifier)
  IF v_norm_email IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE LOWER(owner_email) = v_norm_email
    AND merged_into_account_id IS NULL
    LIMIT 1;
    IF FOUND THEN RETURN v_account_id; END IF;
  END IF;

  -- 3. Match by phone
  IF v_norm_cell IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE sot.norm_phone_us(owner_phone) = v_norm_cell
    AND merged_into_account_id IS NULL
    LIMIT 1;
    IF FOUND THEN RETURN v_account_id; END IF;
  END IF;

  IF v_norm_other IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE sot.norm_phone_us(owner_phone) = v_norm_other
    AND merged_into_account_id IS NULL
    LIMIT 1;
    IF FOUND THEN RETURN v_account_id; END IF;
  END IF;

  -- 4. Match by display name (for pseudo-profiles like "1000 Sunset Ave FFSC")
  IF p_name IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM ops.clinic_accounts
    WHERE LOWER(display_name) = LOWER(TRIM(p_name))
    AND merged_into_account_id IS NULL
    LIMIT 1;
    IF FOUND THEN RETURN v_account_id; END IF;
  END IF;

  -- No match found
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_clinichq_client IS
'Matches a ClinicHQ client record to an existing clinic_accounts record.
Priority: client_id > email > phone > display_name.
Returns NULL if no match found.';

-- ============================================================================
-- PART 4: Upsert function
-- ============================================================================

\echo '5. Creating upsert function...'

CREATE OR REPLACE FUNCTION ops.upsert_clinichq_notes(
  p_clinichq_client_id BIGINT,
  p_name TEXT,
  p_email TEXT,
  p_cell_phone TEXT,
  p_other_phone TEXT,
  p_address TEXT,
  p_quick_notes TEXT,
  p_long_notes TEXT,
  p_tags TEXT
) RETURNS TABLE (
  account_id UUID,
  action TEXT  -- 'updated', 'created', or 'skipped'
) AS $$
DECLARE
  v_account_id UUID;
  v_action TEXT;
  v_account_type TEXT;
BEGIN
  -- Skip if no meaningful data
  IF p_clinichq_client_id IS NULL AND TRIM(COALESCE(p_name, '')) = '' THEN
    RETURN QUERY SELECT NULL::UUID, 'skipped'::TEXT;
    RETURN;
  END IF;

  -- Find existing account
  v_account_id := ops.match_clinichq_client(
    p_clinichq_client_id, p_name, p_email,
    p_cell_phone, p_other_phone, p_address
  );

  IF v_account_id IS NOT NULL THEN
    -- Update existing with notes + client_id
    UPDATE ops.clinic_accounts SET
      clinichq_client_id = COALESCE(clinichq_client_id, p_clinichq_client_id),
      quick_notes = COALESCE(NULLIF(TRIM(p_quick_notes), ''), quick_notes),
      long_notes = COALESCE(NULLIF(TRIM(p_long_notes), ''), long_notes),
      tags = COALESCE(NULLIF(TRIM(p_tags), ''), tags),
      notes_updated_at = NOW(),
      updated_at = NOW()
    WHERE clinic_accounts.account_id = v_account_id;
    v_action := 'updated';
  ELSE
    -- Determine account type
    v_account_type := CASE
      WHEN p_name ~ '^\d+\s+' THEN 'address'
      WHEN p_name ~* '\s+(FFSC|SCAS)$' THEN 'site_name'
      WHEN p_name ~* 'Forgotten Felines|Sonoma County Animal' THEN 'organization'
      ELSE 'unknown'
    END;

    -- Create new clinic account
    INSERT INTO ops.clinic_accounts (
      clinichq_client_id,
      display_name,
      owner_first_name,
      owner_last_name,
      owner_email,
      owner_phone,
      owner_address,
      quick_notes,
      long_notes,
      tags,
      notes_updated_at,
      source_system,
      account_type
    ) VALUES (
      p_clinichq_client_id,
      TRIM(p_name),
      SPLIT_PART(TRIM(p_name), ' ', 1),
      NULLIF(SUBSTRING(TRIM(p_name) FROM POSITION(' ' IN TRIM(p_name)) + 1), ''),
      NULLIF(TRIM(p_email), ''),
      COALESCE(NULLIF(TRIM(p_cell_phone), ''), NULLIF(TRIM(p_other_phone), '')),
      NULLIF(TRIM(p_address), ''),
      NULLIF(TRIM(p_quick_notes), ''),
      NULLIF(TRIM(p_long_notes), ''),
      NULLIF(TRIM(p_tags), ''),
      NOW(),
      'clinichq',
      v_account_type
    )
    RETURNING clinic_accounts.account_id INTO v_account_id;
    v_action := 'created';
  END IF;

  RETURN QUERY SELECT v_account_id, v_action;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.upsert_clinichq_notes IS
'Upserts ClinicHQ client notes into clinic_accounts.
Matches existing accounts by client_id, email, phone, or display_name.
Creates new account if no match found.
Returns account_id and action taken (updated/created/skipped).';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_2550 Complete!'
\echo '=============================================='
\echo ''
\echo 'Added columns:'
\echo '  - clinichq_client_id (BIGINT) - ClinicHQ internal ID'
\echo '  - quick_notes (TEXT) - Brief notes/flags'
\echo '  - long_notes (TEXT) - Detailed history'
\echo '  - tags (TEXT) - Categorization labels'
\echo '  - notes_updated_at (TIMESTAMPTZ) - Last update timestamp'
\echo ''
\echo 'Created functions:'
\echo '  - ops.match_clinichq_client() - Match by client_id/email/phone/name'
\echo '  - ops.upsert_clinichq_notes() - Upsert notes with matching'
\echo ''
\echo 'Next: Run clinichq_notes_ingest.ts to import notes from CSV'
\echo ''
