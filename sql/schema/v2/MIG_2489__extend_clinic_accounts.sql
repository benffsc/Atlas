-- MIG_2489: Extend ops.clinic_accounts for ALL ClinicHQ Owners
--
-- DATA_GAP_053: Original client names lost during identity resolution
-- Example: Elisha Togneri books using shared email, gets linked to Michael Togneri
--
-- SOLUTION: Extend ops.clinic_accounts to store ALL owners (not just pseudo-profiles)
-- This creates a SOURCE TRACKING LAYER separate from identity resolution.
--
-- BEFORE: clinic_accounts only for orgs/addresses, owner_account_id only set for pseudo-profiles
-- AFTER: clinic_accounts for ALL owners, owner_account_id set for ALL appointments
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2489: Extend Clinic Accounts'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD NEW COLUMNS TO OPS.CLINIC_ACCOUNTS
-- ============================================================================

\echo '1. Adding new columns to ops.clinic_accounts...'

-- Merge chain for deduplication (INV-1: No Data Disappears)
ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS merged_into_account_id UUID REFERENCES ops.clinic_accounts(account_id);

-- Source record ID for deduplication (INV-4: Provenance Required)
ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS source_record_id TEXT;

-- Household link (Phase 2)
ALTER TABLE ops.clinic_accounts
ADD COLUMN IF NOT EXISTS household_id UUID;

-- Owner first/last name columns may not exist if MIG_2002 wasn't run
-- or may have different names. Let's ensure consistency
DO $$
BEGIN
  -- Check if we need to add owner_first_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'clinic_accounts' AND column_name = 'owner_first_name'
  ) THEN
    ALTER TABLE ops.clinic_accounts ADD COLUMN owner_first_name TEXT;
    ALTER TABLE ops.clinic_accounts ADD COLUMN owner_last_name TEXT;
    ALTER TABLE ops.clinic_accounts ADD COLUMN owner_city TEXT;
    ALTER TABLE ops.clinic_accounts ADD COLUMN owner_zip TEXT;
  END IF;
END $$;

\echo '   Added: merged_into_account_id, source_record_id, household_id'

-- ============================================================================
-- 2. EXPAND ACCOUNT_TYPE CONSTRAINT FOR REAL PEOPLE
-- ============================================================================

\echo ''
\echo '2. Expanding account_type constraint...'

-- Drop existing constraint
ALTER TABLE ops.clinic_accounts DROP CONSTRAINT IF EXISTS clinic_accounts_account_type_check;

-- Add expanded constraint including real people types
ALTER TABLE ops.clinic_accounts ADD CONSTRAINT clinic_accounts_account_type_check
  CHECK (account_type IN (
    -- Existing pseudo-profile types
    'organization',      -- Known org (shelter, rescue, vet clinic)
    'site_name',         -- Trapping site name (Silveira Ranch, etc.)
    'address',           -- Address as name (5403 San Antonio Road)
    'partial_name',      -- First name only, no identifiers
    'unknown',           -- Unclassified
    -- NEW: Real people types
    'resident',          -- Regular resident/owner
    'colony_caretaker',  -- Manages a colony
    'community_trapper', -- Community trapper (Tier 2/3)
    'rescue_operator'    -- Runs a home-based rescue
  ));

\echo '   Added account_types: resident, colony_caretaker, community_trapper, rescue_operator'

-- ============================================================================
-- 3. CREATE INDEXES
-- ============================================================================

\echo ''
\echo '3. Creating indexes...'

-- Merge-aware index (INV-7: Merge-Aware Queries)
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_active
  ON ops.clinic_accounts(account_id) WHERE merged_into_account_id IS NULL;

-- Source deduplication index
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_accounts_source
  ON ops.clinic_accounts(source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- Resolved person lookup
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_resolved_person
  ON ops.clinic_accounts(resolved_person_id)
  WHERE resolved_person_id IS NOT NULL AND merged_into_account_id IS NULL;

-- Household grouping (Phase 2)
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_household
  ON ops.clinic_accounts(household_id)
  WHERE household_id IS NOT NULL AND merged_into_account_id IS NULL;

\echo '   Created indexes: active, source, resolved_person, household'

-- ============================================================================
-- 4. ADD COLUMN COMMENTS
-- ============================================================================

\echo ''
\echo '4. Adding column comments...'

COMMENT ON COLUMN ops.clinic_accounts.merged_into_account_id IS
'INV-1: Merge chain for account deduplication. If set, this account was merged into another.
Use WHERE merged_into_account_id IS NULL in all queries.';

COMMENT ON COLUMN ops.clinic_accounts.source_record_id IS
'INV-4: Original record ID in source system (e.g., ClinicHQ appointment Number).
Used for deduplication across imports.';

COMMENT ON COLUMN ops.clinic_accounts.household_id IS
'Phase 2: Links to sot.households. Groups accounts that share email/phone (family members).
Example: Elisha and Michael Togneri both use michaeltogneri@yahoo.com.';

COMMENT ON COLUMN ops.clinic_accounts.account_type IS
'Account classification:
- organization: Known org (shelter, rescue, vet clinic)
- site_name: Trapping site name (Silveira Ranch)
- address: Address used as name (5403 San Antonio Road)
- partial_name: First name only, no identifiers
- unknown: Unclassified
- resident: Regular resident/cat owner (NEW)
- colony_caretaker: Colony manager (NEW)
- community_trapper: Tier 2/3 trapper (NEW)
- rescue_operator: Runs home-based rescue (NEW)';

COMMENT ON TABLE ops.clinic_accounts IS
'OPS Layer: ClinicHQ owner accounts - preserves WHO BOOKED separately from identity resolution.

DATA_GAP_053 Fix: Now stores ALL owners (not just pseudo-profiles):
- Real people: account_type = resident/colony_caretaker/etc., resolved_person_id set
- Pseudo-profiles: account_type = organization/site_name/address, resolved_person_id NULL

Usage:
- appointment.owner_account_id = "Who booked" (original client name)
- appointment.person_id = "Who this resolved to" (via Data Engine)
- Multiple accounts can resolve to same person (household/shared email)';

-- ============================================================================
-- 5. CREATE SOT.HOUSEHOLDS TABLE (Phase 2 prep)
-- ============================================================================

\echo ''
\echo '5. Creating sot.households table...'

CREATE TABLE IF NOT EXISTS sot.households (
  household_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Household identity
  display_name TEXT,                   -- "The Togneri Family"
  primary_address TEXT,

  -- Shared identifiers (email/phone used by multiple family members)
  shared_email TEXT,
  shared_phone TEXT,

  -- Primary contact
  primary_account_id UUID REFERENCES ops.clinic_accounts(account_id),

  -- Detection metadata
  detection_reason TEXT,               -- "shared_email", "same_address", "manual"
  detected_at TIMESTAMPTZ DEFAULT NOW(),

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_households_shared_email ON sot.households(shared_email)
  WHERE shared_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_households_shared_phone ON sot.households(shared_phone)
  WHERE shared_phone IS NOT NULL;

COMMENT ON TABLE sot.households IS
'Phase 2: Tracks family/household relationships.
Groups accounts that share email/phone identifiers.
Does NOT merge people - keeps them distinct but related.

Example:
- household: "The Togneri Family", shared_email: michaeltogneri@yahoo.com
- accounts: Elisha Togneri, Michael Togneri (both linked to this household)
- people: Michael Togneri (resolved via Data Engine)';

-- Add foreign key from clinic_accounts to households
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clinic_accounts_household_id_fkey'
  ) THEN
    ALTER TABLE ops.clinic_accounts
    ADD CONSTRAINT clinic_accounts_household_id_fkey
    FOREIGN KEY (household_id) REFERENCES sot.households(household_id);
  END IF;
END $$;

\echo '   Created sot.households with FK from ops.clinic_accounts'

-- ============================================================================
-- 6. CREATE OPS.TRAPPER_CONTRACTS TABLE (Phase 3 prep)
-- ============================================================================

\echo ''
\echo '6. Creating ops.trapper_contracts table...'

CREATE TABLE IF NOT EXISTS ops.trapper_contracts (
  contract_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who signed
  person_id UUID NOT NULL REFERENCES sot.people(person_id),

  -- Contract details
  contract_type TEXT NOT NULL CHECK (contract_type IN (
    'ffsc_volunteer',      -- Full volunteer agreement (VolunteerHub Approved Trappers)
    'community_limited',   -- Limited to specific areas (Tier 2)
    'colony_caretaker',    -- Colony-specific agreement
    'rescue_partnership'   -- Rescue org agreement
  )),

  -- Geographic scope
  service_area_description TEXT,       -- "Cloverdale area only"
  service_place_ids UUID[],            -- Links to sot.places

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'expired', 'terminated')),
  signed_date DATE,
  expiration_date DATE,

  -- Contract notes
  contract_notes TEXT,

  -- INV-4: Provenance
  source_system TEXT DEFAULT 'atlas_ui',
  source_record_id TEXT,               -- Airtable record ID for migrated contracts
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trapper_contracts_person
  ON ops.trapper_contracts(person_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_trapper_contracts_type
  ON ops.trapper_contracts(contract_type);
CREATE INDEX IF NOT EXISTS idx_trapper_contracts_active
  ON ops.trapper_contracts(status) WHERE status = 'active';

COMMENT ON TABLE ops.trapper_contracts IS
'Phase 3: Atlas-native trapper contract management (replaces Airtable).

Trapper Source Authority:
- Tier 1 (FFSC): VolunteerHub "Approved Trappers" → sot.person_roles
- Tier 2 (Community): ops.trapper_contracts with type = community_limited
- Tier 3 (Unofficial): detect_unofficial_trappers() → manual review

Migration Path:
1. Existing Airtable community trappers → import here
2. New community trappers → onboard via Atlas UI
3. Airtable becomes read-only archive';

\echo '   Created ops.trapper_contracts'

-- ============================================================================
-- 7. CREATE UPSERT FUNCTION FOR ALL OWNERS
-- ============================================================================

\echo ''
\echo '7. Creating ops.upsert_clinic_account_for_owner()...'

CREATE OR REPLACE FUNCTION ops.upsert_clinic_account_for_owner(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_resolved_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_account_id UUID;
  v_classification TEXT;
  v_account_type TEXT;
BEGIN
  -- Classify the owner name
  v_classification := sot.classify_owner_name(p_first_name, p_last_name);

  -- Fix 6: Map classification to account_type (with NULL safety)
  v_account_type := CASE COALESCE(v_classification, 'unknown')
    WHEN 'address' THEN 'address'
    WHEN 'organization' THEN 'organization'
    WHEN 'known_org' THEN 'organization'
    WHEN 'apartment_complex' THEN 'site_name'
    WHEN 'likely_person' THEN 'resident'
    ELSE 'unknown'
  END;

  -- Fix 5: ATOMIC UPSERT using INSERT ON CONFLICT
  -- This prevents race conditions where two concurrent requests both SELECT NULL
  -- and both attempt to INSERT, creating duplicates.

  -- Primary dedup key: source_record_id (if available)
  IF p_source_record_id IS NOT NULL THEN
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, resolved_person_id, source_system, source_record_id,
      first_appointment_date, last_appointment_date, appointment_count
    ) VALUES (
      p_first_name, p_last_name, p_email, p_phone, p_address,
      v_account_type, p_resolved_person_id, 'clinichq', p_source_record_id,
      CURRENT_DATE, CURRENT_DATE, 1
    )
    ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
    DO UPDATE SET
      appointment_count = COALESCE(ops.clinic_accounts.appointment_count, 0) + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      resolved_person_id = COALESCE(ops.clinic_accounts.resolved_person_id, EXCLUDED.resolved_person_id),
      updated_at = NOW()
    RETURNING account_id INTO v_account_id;

    RETURN v_account_id;
  END IF;

  -- Fallback: dedup by name + contact (case-insensitive - Fix 3)
  -- Try INSERT first, handle conflict
  INSERT INTO ops.clinic_accounts (
    owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
    account_type, resolved_person_id, source_system,
    first_appointment_date, last_appointment_date, appointment_count
  ) VALUES (
    p_first_name, p_last_name, p_email, p_phone, p_address,
    v_account_type, p_resolved_person_id, 'clinichq',
    CURRENT_DATE, CURRENT_DATE, 1
  )
  ON CONFLICT DO NOTHING
  RETURNING account_id INTO v_account_id;

  -- If INSERT succeeded (no conflict), we're done
  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  -- INSERT failed due to conflict - find the existing account (case-insensitive - Fix 3)
  SELECT account_id INTO v_account_id
  FROM ops.clinic_accounts
  WHERE LOWER(owner_first_name) = LOWER(p_first_name)
    AND LOWER(COALESCE(owner_last_name, '')) = LOWER(COALESCE(p_last_name, ''))
    AND (
      (p_email IS NOT NULL AND LOWER(owner_email) = LOWER(p_email))
      OR (p_phone IS NOT NULL AND owner_phone = p_phone)
      OR (p_email IS NULL AND p_phone IS NULL AND owner_email IS NULL AND owner_phone IS NULL)
    )
    AND merged_into_account_id IS NULL
  LIMIT 1;

  -- Update statistics on the existing account
  IF v_account_id IS NOT NULL THEN
    UPDATE ops.clinic_accounts
    SET appointment_count = COALESCE(appointment_count, 0) + 1,
        last_seen_at = NOW(),
        last_appointment_date = CURRENT_DATE,
        resolved_person_id = COALESCE(resolved_person_id, p_resolved_person_id),
        updated_at = NOW()
    WHERE account_id = v_account_id;
  END IF;

  RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION ops.upsert_clinic_account_for_owner IS
'Creates or updates a clinic_account for ANY ClinicHQ owner (not just pseudo-profiles).

DATA_GAP_053 Fix: This function is called for ALL owners during ingest:
- Real people: account_type = resident, resolved_person_id set
- Pseudo-profiles: account_type = organization/site_name/address

Robustness fixes applied:
- Fix 3: Case-insensitive name/email matching with LOWER()
- Fix 5: Atomic upsert using INSERT ON CONFLICT (prevents race conditions)
- Fix 6: NULL-safe classification with COALESCE

Returns account_id for linking to appointment.owner_account_id.';

-- ============================================================================
-- 8. CREATE VIEWS
-- ============================================================================

\echo ''
\echo '8. Creating views...'

-- Account appointments view
CREATE OR REPLACE VIEW ops.v_account_appointments AS
SELECT
  ca.account_id,
  ca.display_name as account_name,
  ca.account_type,
  ca.resolved_person_id,
  p.display_name as resolved_person_name,
  h.display_name as household_name,
  a.appointment_id,
  a.appointment_date,
  a.cat_id,
  c.name as cat_name
FROM ops.clinic_accounts ca
LEFT JOIN sot.people p ON p.person_id = ca.resolved_person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.households h ON h.household_id = ca.household_id
LEFT JOIN ops.appointments a ON a.owner_account_id = ca.account_id
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
WHERE ca.merged_into_account_id IS NULL;

COMMENT ON VIEW ops.v_account_appointments IS
'Clinic accounts with their appointments, resolved person, and household.
Use to see "Who booked" vs "Who this resolved to" distinction.';

-- Community trappers view
CREATE OR REPLACE VIEW ops.v_community_trappers AS
SELECT
  tc.contract_id,
  p.person_id,
  p.display_name as trapper_name,
  tc.contract_type,
  tc.service_area_description,
  tc.service_place_ids,
  tc.status,
  tc.signed_date,
  tc.expiration_date,
  -- From trapper_profiles if exists
  tp.trapper_type as profile_type,
  tp.is_active as profile_active,
  tp.rescue_name
FROM ops.trapper_contracts tc
JOIN sot.people p ON p.person_id = tc.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.trapper_profiles tp ON tp.person_id = tc.person_id
WHERE tc.status = 'active';

COMMENT ON VIEW ops.v_community_trappers IS
'Active community trappers with their contracts.
Joins trapper_contracts with trapper_profiles for full context.';

\echo '   Created views: v_account_appointments, v_community_trappers'

-- ============================================================================
-- 9. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'ops.clinic_accounts columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'clinic_accounts'
ORDER BY ordinal_position;

\echo ''
\echo 'Account type constraint values:'
SELECT pg_get_constraintdef(oid) as constraint_def
FROM pg_constraint
WHERE conname = 'clinic_accounts_account_type_check';

\echo ''
\echo 'sot.households columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'households'
ORDER BY ordinal_position;

\echo ''
\echo 'ops.trapper_contracts columns:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'trapper_contracts'
ORDER BY ordinal_position;

-- ============================================================================
-- 10. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2489 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Extended ops.clinic_accounts with:'
\echo '  - merged_into_account_id: Merge chain (INV-1)'
\echo '  - source_record_id: Dedup key (INV-4)'
\echo '  - household_id: Family grouping (Phase 2)'
\echo '  - New account_types: resident, colony_caretaker, community_trapper, rescue_operator'
\echo ''
\echo 'Created new tables:'
\echo '  - sot.households: Family/household relationships'
\echo '  - ops.trapper_contracts: Community trapper contracts (replaces Airtable)'
\echo ''
\echo 'Created functions:'
\echo '  - ops.upsert_clinic_account_for_owner(): Create account for ANY owner'
\echo ''
\echo 'Next: Run MIG_2490 to backfill clinic_accounts for existing appointments'
\echo ''
