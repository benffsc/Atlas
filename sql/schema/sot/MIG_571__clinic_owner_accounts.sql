\echo ''
\echo '=============================================='
\echo 'MIG_571: Clinic Owner Accounts Table'
\echo '=============================================='
\echo ''
\echo 'Creates a separate table for pseudo-profiles (addresses, orgs,'
\echo 'apartments used as owner names in ClinicHQ data).'
\echo ''
\echo 'This keeps sot_people clean for REAL people only.'
\echo ''

-- ============================================================================
-- PART 1: Create clinic_owner_accounts table
-- ============================================================================

\echo 'Creating clinic_owner_accounts table...'

CREATE TABLE IF NOT EXISTS trapper.clinic_owner_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display info
  display_name TEXT NOT NULL,
  canonical_name TEXT,  -- AI-researched proper name

  -- Account type
  account_type TEXT NOT NULL DEFAULT 'unknown' CHECK (account_type IN (
    'address',           -- Street address used as owner name
    'apartment_complex', -- Apartment complex name
    'organization',      -- Business/school/church/etc
    'unknown'            -- Needs classification
  )),

  -- Links to other entities
  linked_place_id UUID REFERENCES trapper.places(place_id),
  linked_org_id INTEGER REFERENCES trapper.known_organizations(org_id),

  -- For suffix records: who brought the cat (FFSC or SCAS)
  brought_by TEXT,

  -- AI research fields
  ai_researched_at TIMESTAMPTZ,
  ai_research_notes TEXT,
  ai_confidence NUMERIC(3,2),
  needs_verification BOOLEAN DEFAULT false,

  -- Source tracking
  original_person_id UUID,  -- The sot_people record this came from
  source_system TEXT DEFAULT 'clinichq',
  source_display_names TEXT[] DEFAULT '{}',  -- All variations seen

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.clinic_owner_accounts IS
'Pseudo-profiles for ClinicHQ owner names that are not real people.
Includes addresses used as owner names, organizations, and apartment complexes.
These are kept separate from sot_people to maintain clean people data.';

COMMENT ON COLUMN trapper.clinic_owner_accounts.display_name IS 'Original name as it appeared in ClinicHQ';
COMMENT ON COLUMN trapper.clinic_owner_accounts.canonical_name IS 'AI-researched official/proper name';
COMMENT ON COLUMN trapper.clinic_owner_accounts.account_type IS 'Type of entity: address, apartment_complex, organization, unknown';
COMMENT ON COLUMN trapper.clinic_owner_accounts.brought_by IS 'FFSC or SCAS if the suffix was present (indicates who brought the cat)';
COMMENT ON COLUMN trapper.clinic_owner_accounts.ai_researched_at IS 'When AI last researched this account';
COMMENT ON COLUMN trapper.clinic_owner_accounts.source_display_names IS 'All name variations seen (for deduplication)';

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

\echo 'Creating indexes...'

-- Index for fast lookup by display name
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_display_name
  ON trapper.clinic_owner_accounts(lower(display_name));

-- Index for lookup by canonical name (for dedup)
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_canonical
  ON trapper.clinic_owner_accounts(lower(canonical_name))
  WHERE canonical_name IS NOT NULL;

-- Index for accounts needing research
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_needs_research
  ON trapper.clinic_owner_accounts(ai_researched_at)
  WHERE ai_researched_at IS NULL;

-- Index for accounts by type
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_type
  ON trapper.clinic_owner_accounts(account_type);

-- Index for linked places
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_place
  ON trapper.clinic_owner_accounts(linked_place_id)
  WHERE linked_place_id IS NOT NULL;

-- Index for original person ID (for migration tracking)
CREATE INDEX IF NOT EXISTS idx_clinic_owner_accounts_original_person
  ON trapper.clinic_owner_accounts(original_person_id)
  WHERE original_person_id IS NOT NULL;

-- ============================================================================
-- PART 3: Add owner_account_id to sot_appointments
-- ============================================================================

\echo 'Adding owner_account_id to sot_appointments...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS owner_account_id UUID REFERENCES trapper.clinic_owner_accounts(account_id);

COMMENT ON COLUMN trapper.sot_appointments.owner_account_id IS
'Reference to clinic_owner_accounts for pseudo-profiles (addresses, orgs).
Use this when person_id would point to a non-person entity.';

CREATE INDEX IF NOT EXISTS idx_sot_appointments_owner_account
  ON trapper.sot_appointments(owner_account_id)
  WHERE owner_account_id IS NOT NULL;

-- ============================================================================
-- PART 4: Create classify_owner_name() function
-- ============================================================================

\echo 'Creating classify_owner_name() function...'

CREATE OR REPLACE FUNCTION trapper.classify_owner_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN 'unknown';
  END IF;

  -- Strip FFSC/SCAS suffix first
  cleaned := regexp_replace(trim(p_name), '\s+(ffsc|scas)$', '', 'i');

  -- 1. Check for exact known org matches (IS the org, not just contains suffix)
  IF cleaned ~* '^(ffsc|forgotten felines)' OR cleaned ~* '^(scas|sonoma county animal)' THEN
    RETURN 'known_org';
  END IF;

  -- 2. Check for address patterns (highest priority for classification)
  IF cleaned ~* '^\d+\s+' THEN
    RETURN 'address';
  END IF;

  IF cleaned ~* '\b(road|lane|ave|avenue|street|st|blvd|boulevard|dr|drive|way|rd|ct|court|ln|pl|place)\b' THEN
    RETURN 'address';
  END IF;

  IF cleaned ~* '\b(block of)\b' THEN
    RETURN 'address';
  END IF;

  -- 3. Check for apartment complex patterns (should be places, not orgs)
  IF cleaned ~* '\b(apartments?|village|terrace|manor|gardens?|heights|towers?|plaza|residences?)\b' THEN
    RETURN 'apartment_complex';
  END IF;

  IF cleaned ~* '\b(senior|living|housing)\s+(center|community|complex)\b' THEN
    RETURN 'apartment_complex';
  END IF;

  -- 4. Check for organization patterns
  IF cleaned ~* '\b(school|middle school|high school|elementary|academy)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(church|hospital|clinic|shelter|rescue)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(corp|inc|llc|company|ltd)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(park|rec|recreation|center|centre)\b' THEN
    RETURN 'organization';
  END IF;

  -- 5. Check for typical person name pattern: "FirstName LastName"
  IF cleaned ~* '^[A-Z][a-z]+\s+[A-Z][a-z]+$' THEN
    RETURN 'likely_person';
  END IF;

  -- 6. Check for first/last name with middle initial: "John A Smith"
  IF cleaned ~* '^[A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+$' THEN
    RETURN 'likely_person';
  END IF;

  -- Default: unknown - needs AI classification
  RETURN 'unknown';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.classify_owner_name IS
'Classifies a ClinicHQ owner name as likely_person, address, apartment_complex, organization, known_org, or unknown.
Strips FFSC/SCAS suffix before classification. Used to route to sot_people vs clinic_owner_accounts.';

-- ============================================================================
-- PART 5: Create extract_brought_by() function
-- ============================================================================

\echo 'Creating extract_brought_by() function...'

CREATE OR REPLACE FUNCTION trapper.extract_brought_by(p_name TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Extract FFSC or SCAS suffix
  IF p_name ~* '\s+ffsc$' THEN
    RETURN 'FFSC';
  ELSIF p_name ~* '\s+scas$' THEN
    RETURN 'SCAS';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_brought_by IS
'Extracts the "brought by" organization from a ClinicHQ owner name suffix.
Returns "FFSC" or "SCAS" if present, NULL otherwise.';

-- ============================================================================
-- PART 6: Create strip_brought_by_suffix() function
-- ============================================================================

\echo 'Creating strip_brought_by_suffix() function...'

CREATE OR REPLACE FUNCTION trapper.strip_brought_by_suffix(p_name TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Remove trailing FFSC/SCAS
  RETURN trim(regexp_replace(p_name, '\s+(ffsc|scas)$', '', 'i'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.strip_brought_by_suffix IS
'Strips the FFSC/SCAS suffix from a ClinicHQ owner name.
"Comstock Middle School FFSC" → "Comstock Middle School"';

-- ============================================================================
-- PART 7: Create find_or_create_clinic_account() function
-- ============================================================================

\echo 'Creating find_or_create_clinic_account() function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_clinic_account(
  p_display_name TEXT,
  p_account_type TEXT DEFAULT NULL,
  p_brought_by TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
  v_account_id UUID;
  v_canonical TEXT;
  v_classified_type TEXT;
  v_extracted_brought_by TEXT;
  v_stripped_name TEXT;
BEGIN
  IF p_display_name IS NULL OR trim(p_display_name) = '' THEN
    RETURN NULL;
  END IF;

  -- Extract brought_by if not provided
  v_extracted_brought_by := COALESCE(p_brought_by, trapper.extract_brought_by(p_display_name));

  -- Strip suffix for matching
  v_stripped_name := trapper.strip_brought_by_suffix(p_display_name);

  -- Normalize for matching
  v_canonical := lower(trim(v_stripped_name));

  -- Check for existing by display_name or canonical
  SELECT account_id INTO v_account_id
  FROM trapper.clinic_owner_accounts
  WHERE lower(display_name) = v_canonical
     OR lower(canonical_name) = v_canonical
     OR lower(trim(p_display_name)) = ANY(
          SELECT lower(unnest(source_display_names))
        );

  IF FOUND THEN
    -- Add display name variant if new
    UPDATE trapper.clinic_owner_accounts
    SET source_display_names = CASE
          WHEN NOT (p_display_name = ANY(source_display_names))
          THEN array_append(source_display_names, p_display_name)
          ELSE source_display_names
        END,
        updated_at = NOW()
    WHERE account_id = v_account_id;
    RETURN v_account_id;
  END IF;

  -- Classify if not provided
  v_classified_type := COALESCE(
    p_account_type,
    CASE trapper.classify_owner_name(v_stripped_name)
      WHEN 'address' THEN 'address'
      WHEN 'apartment_complex' THEN 'apartment_complex'
      WHEN 'organization' THEN 'organization'
      WHEN 'known_org' THEN 'organization'
      ELSE 'unknown'
    END
  );

  -- Create new account
  INSERT INTO trapper.clinic_owner_accounts (
    display_name,
    canonical_name,
    account_type,
    brought_by,
    source_system,
    source_display_names
  ) VALUES (
    v_stripped_name,  -- Store without suffix
    NULL,  -- Will be set by AI research
    v_classified_type,
    v_extracted_brought_by,
    p_source_system,
    ARRAY[p_display_name]  -- Keep original with suffix for tracking
  )
  RETURNING account_id INTO v_account_id;

  RETURN v_account_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_clinic_account IS
'Creates or finds a clinic_owner_accounts record for a pseudo-profile.
Strips FFSC/SCAS suffix, classifies account type, and handles deduplication.
Use this for ClinicHQ owner names that are not real people.';

-- ============================================================================
-- PART 8: Create monitoring views
-- ============================================================================

\echo 'Creating monitoring views...'

-- View of accounts needing research
CREATE OR REPLACE VIEW trapper.v_clinic_accounts_pending_research AS
SELECT
  account_id,
  display_name,
  account_type,
  brought_by,
  created_at
FROM trapper.clinic_owner_accounts
WHERE ai_researched_at IS NULL
ORDER BY created_at;

COMMENT ON VIEW trapper.v_clinic_accounts_pending_research IS
'Clinic owner accounts that have not been researched by AI yet.';

-- View of account statistics
CREATE OR REPLACE VIEW trapper.v_clinic_accounts_stats AS
SELECT
  account_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE ai_researched_at IS NOT NULL) as researched,
  COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL) as linked_to_place,
  COUNT(*) FILTER (WHERE linked_org_id IS NOT NULL) as linked_to_org,
  COUNT(*) FILTER (WHERE brought_by IS NOT NULL) as has_brought_by
FROM trapper.clinic_owner_accounts
GROUP BY account_type
ORDER BY total DESC;

COMMENT ON VIEW trapper.v_clinic_accounts_stats IS
'Statistics on clinic owner accounts by type.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_571 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - clinic_owner_accounts table'
\echo '  - owner_account_id column on sot_appointments'
\echo '  - classify_owner_name() function'
\echo '  - extract_brought_by() function'
\echo '  - strip_brought_by_suffix() function'
\echo '  - find_or_create_clinic_account() function'
\echo '  - v_clinic_accounts_pending_research view'
\echo '  - v_clinic_accounts_stats view'
\echo ''
\echo 'Next: Run MIG_572 to migrate existing pseudo-profiles'
\echo ''
