\echo '=== MIG_318: FFSC Data Fixing Registry ==='
\echo 'Creating registry tables for tracking and fixing known bad data patterns'
\echo ''

-- ============================================================================
-- DATA FIXING REGISTRY
-- Tracks known bad data patterns and their fixes
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.data_fixing_patterns (
    pattern_id SERIAL PRIMARY KEY,
    pattern_name TEXT NOT NULL UNIQUE,
    pattern_type TEXT NOT NULL,  -- 'email', 'phone', 'name', 'address', 'organization'

    -- Pattern matching
    pattern_value TEXT,          -- Exact match value
    pattern_regex TEXT,          -- Regex pattern for matching
    pattern_ilike TEXT,          -- ILIKE pattern for matching

    -- Classification
    is_garbage BOOLEAN DEFAULT FALSE,     -- Should be excluded entirely
    is_placeholder BOOLEAN DEFAULT FALSE, -- Placeholder value (none, unknown, etc.)
    is_organization BOOLEAN DEFAULT FALSE, -- Organization pretending to be person
    is_internal BOOLEAN DEFAULT FALSE,    -- FFSC internal account
    is_test BOOLEAN DEFAULT FALSE,        -- Test data

    -- Fix instructions
    fix_action TEXT,             -- 'exclude', 'convert_to_org', 'nullify', 'manual_review'
    fix_notes TEXT,

    -- Stats
    affected_count INT DEFAULT 0,
    last_scanned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.data_fixing_patterns IS
'Registry of known bad data patterns in FFSC data with fix instructions.';

-- ============================================================================
-- KNOWN ORGANIZATION NAMES (should not be matched as people)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.known_organizations (
    org_id SERIAL PRIMARY KEY,
    org_name TEXT NOT NULL,
    org_name_pattern TEXT,       -- ILIKE pattern
    org_type TEXT,               -- 'shelter', 'rescue', 'clinic', 'business', 'ffsc_location'

    -- If this org has cats, link to place instead of person
    linked_place_id UUID REFERENCES trapper.places(place_id),

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_organizations_name ON trapper.known_organizations(org_name);
CREATE INDEX IF NOT EXISTS idx_known_organizations_pattern ON trapper.known_organizations(org_name_pattern);

COMMENT ON TABLE trapper.known_organizations IS
'Registry of known organization names that should not be treated as individual people.';

-- ============================================================================
-- BLACKLISTED EMAIL PATTERNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.email_blacklist_patterns (
    pattern_id SERIAL PRIMARY KEY,
    email_pattern TEXT NOT NULL,
    match_type TEXT NOT NULL,    -- 'exact', 'suffix', 'contains', 'regex'
    reason TEXT NOT NULL,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.email_blacklist_patterns IS
'Patterns for emails that should not be used for identity matching.';

-- ============================================================================
-- POPULATE WITH KNOWN PATTERNS
-- ============================================================================

\echo 'Populating known bad patterns...'

-- Bad email patterns
INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_value, is_placeholder, is_garbage, fix_action, fix_notes)
VALUES
    ('none_email', 'email', 'none', TRUE, FALSE, 'nullify', 'Placeholder for missing email'),
    ('no_email', 'email', 'no', TRUE, FALSE, 'nullify', 'Placeholder for missing email'),
    ('noemail_domain', 'email', NULL, TRUE, FALSE, 'nullify', 'Placeholder domain @noemail.com')
ON CONFLICT (pattern_name) DO NOTHING;

INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_placeholder, fix_action, fix_notes)
VALUES
    ('noemail_at_noemail', 'email', '%@noemail.com', TRUE, 'nullify', 'ClinicHQ placeholder emails'),
    ('petestablish_test', 'email', '%@petestablish%', TRUE, 'nullify', 'PetEstablish test/placeholder emails')
ON CONFLICT (pattern_name) DO NOTHING;

-- Bad name patterns (FFSC locations used as owner names)
INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_organization, is_internal, fix_action, fix_notes)
VALUES
    ('ffsc_location_suffix', 'name', '% Ffsc', TRUE, TRUE, 'convert_to_org', 'FFSC location acting as owner - should link to place'),
    ('ffsc_location_suffix_caps', 'name', '% FFSC', TRUE, TRUE, 'convert_to_org', 'FFSC location acting as owner - should link to place'),
    ('forgotten_felines_lastname', 'name', '%Forgotten Felines%', TRUE, TRUE, 'convert_to_org', 'Organization name in last name field')
ON CONFLICT (pattern_name) DO NOTHING;

-- Placeholder names
INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_value, is_placeholder, is_garbage, fix_action, fix_notes)
VALUES
    ('unknown_unknown', 'name', 'Unknown Unknown', TRUE, FALSE, 'manual_review', 'Placeholder for unknown person')
ON CONFLICT (pattern_name) DO NOTHING;

INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_test, fix_action, fix_notes)
VALUES
    ('test_name', 'name', '%test%', TRUE, 'exclude', 'Test data')
ON CONFLICT (pattern_name) DO NOTHING;

\echo 'Populated email and name patterns'

-- Known organizations (should not be people)
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Forgotten Felines of Sonoma County', '%Forgotten Felines%', 'ffsc', 'Main FFSC organization'),
    ('Animal Medical Center', '%Animal Medical Center%', 'clinic', 'Veterinary clinic'),
    ('Bitten by a Kitten Rescue', '%Bitten by a Kitten%', 'rescue', 'Local rescue organization'),
    ('Cat Rescue of Cloverdale', '%Cat Rescue of Cloverdale%', 'rescue', 'Local rescue organization'),
    ('Dogwood Animal Rescue Project', '%Dogwood Animal Rescue%', 'rescue', 'Local rescue organization'),
    ('Countryside Rescue', '%Countryside Rescue%', 'rescue', 'Local rescue organization'),
    ('Humane Society', '%Humane Society%', 'shelter', 'Animal shelter'),
    ('Animal Services', '%Animal Services%', 'shelter', 'County animal services'),
    ('Petaluma Animal Services', '%Petaluma Animal Services%', 'shelter', 'Petaluma city shelter'),
    ('Sonoma County Animal Services', '%Sonoma County Animal%', 'shelter', 'County animal services')
ON CONFLICT DO NOTHING;

-- FFSC location names that got turned into people
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Comstock Middle School FFSC', '%Comstock Middle School%', 'ffsc_location', 'FFSC field location'),
    ('Redimat FFSC', '%Redimat%', 'ffsc_location', 'FFSC field location'),
    ('Annadel State Park FFSC', '%Annadel State Park%', 'ffsc_location', 'FFSC field location'),
    ('Enphase Energy FFSC', '%Enphase Energy%', 'ffsc_location', 'FFSC field location'),
    ('Petaluma Poultry FFSC', '%Petaluma Poultry%', 'ffsc_location', 'FFSC field location')
ON CONFLICT DO NOTHING;

\echo 'Populated known organizations'

-- Email blacklist patterns
INSERT INTO trapper.email_blacklist_patterns (email_pattern, match_type, reason)
VALUES
    ('@noemail.com', 'suffix', 'ClinicHQ placeholder domain'),
    ('@petestablish.com', 'suffix', 'PetEstablish internal/test'),
    ('none', 'exact', 'Placeholder value'),
    ('no', 'exact', 'Placeholder value'),
    ('unknown@', 'contains', 'Placeholder value'),
    ('test@', 'contains', 'Test email'),
    ('@example.com', 'suffix', 'Example/test domain'),
    ('@example.org', 'suffix', 'Example/test domain')
ON CONFLICT DO NOTHING;

\echo 'Populated email blacklist patterns'

-- ============================================================================
-- HELPER FUNCTION: Check if email is blacklisted
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.is_blacklisted_email(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_email IS NULL OR p_email = '' THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM trapper.email_blacklist_patterns
        WHERE is_active = TRUE
          AND (
              (match_type = 'exact' AND LOWER(p_email) = LOWER(email_pattern)) OR
              (match_type = 'suffix' AND LOWER(p_email) LIKE '%' || LOWER(email_pattern)) OR
              (match_type = 'contains' AND LOWER(p_email) LIKE '%' || LOWER(email_pattern) || '%')
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_blacklisted_email IS
'Checks if an email matches known blacklist patterns (placeholders, test emails, etc.)';

-- ============================================================================
-- HELPER FUNCTION: Check if name is organization
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.is_organization_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL OR p_name = '' THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM trapper.known_organizations
        WHERE p_name ILIKE org_name_pattern
    ) OR EXISTS (
        SELECT 1 FROM trapper.data_fixing_patterns
        WHERE pattern_type = 'name'
          AND is_organization = TRUE
          AND (
              (pattern_value IS NOT NULL AND p_name = pattern_value) OR
              (pattern_ilike IS NOT NULL AND p_name ILIKE pattern_ilike)
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_organization_name IS
'Checks if a name matches known organization patterns (should not be treated as a person).';

-- ============================================================================
-- UPDATE is_valid_person_name TO USE REGISTRY
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.is_valid_person_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Basic validation
    IF p_name IS NULL OR TRIM(p_name) = '' OR LENGTH(TRIM(p_name)) < 2 THEN
        RETURN FALSE;
    END IF;

    -- Check against known bad patterns
    IF trapper.is_garbage_name(p_name) THEN
        RETURN FALSE;
    END IF;

    -- Check against organization names
    IF trapper.is_organization_name(p_name) THEN
        RETURN FALSE;
    END IF;

    -- Check against internal accounts
    IF trapper.is_internal_account(p_name) THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_valid_person_name IS
'Enhanced validation using the data fixing registry. Returns FALSE for garbage names, organizations, and internal accounts.';

-- ============================================================================
-- VIEW: Data Quality Summary
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_data_quality_summary AS
SELECT
    -- Email quality
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE owner_email IS NOT NULL AND NOT trapper.is_blacklisted_email(owner_email)) as valid_emails,
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE owner_email IS NOT NULL AND trapper.is_blacklisted_email(owner_email)) as blacklisted_emails,

    -- Name quality
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND trapper.is_valid_person_name(display_name)) as valid_people,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND NOT trapper.is_valid_person_name(display_name)) as invalid_people,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND trapper.is_organization_name(display_name)) as org_as_people,

    -- Pattern counts
    (SELECT COUNT(*) FROM trapper.data_fixing_patterns) as total_patterns,
    (SELECT COUNT(*) FROM trapper.known_organizations) as known_organizations,
    (SELECT COUNT(*) FROM trapper.email_blacklist_patterns WHERE is_active) as email_blacklist_rules;

COMMENT ON VIEW trapper.v_data_quality_summary IS
'Summary of data quality metrics based on the fixing registry.';

-- ============================================================================
-- UPDATE COUNTS IN REGISTRY
-- ============================================================================

\echo 'Updating affected counts...'

UPDATE trapper.data_fixing_patterns p
SET affected_count = (
    SELECT COUNT(*) FROM trapper.sot_appointments
    WHERE owner_email IS NOT NULL
      AND (
          (p.pattern_value IS NOT NULL AND owner_email = p.pattern_value) OR
          (p.pattern_ilike IS NOT NULL AND owner_email ILIKE p.pattern_ilike)
      )
),
last_scanned_at = NOW()
WHERE p.pattern_type = 'email';

UPDATE trapper.data_fixing_patterns p
SET affected_count = (
    SELECT COUNT(*) FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND (
          (p.pattern_value IS NOT NULL AND display_name = p.pattern_value) OR
          (p.pattern_ilike IS NOT NULL AND display_name ILIKE p.pattern_ilike)
      )
),
last_scanned_at = NOW()
WHERE p.pattern_type = 'name';

\echo ''
\echo '=== Summary of Bad Patterns ==='
SELECT pattern_name, pattern_type, affected_count, fix_action
FROM trapper.data_fixing_patterns
WHERE affected_count > 0
ORDER BY affected_count DESC;

\echo ''
\echo '=== Data Quality Summary ==='
SELECT * FROM trapper.v_data_quality_summary;

\echo ''
\echo '=== MIG_318 Complete ==='
\echo 'Created:'
\echo '  - data_fixing_patterns table (bad data pattern registry)'
\echo '  - known_organizations table (org names not to treat as people)'
\echo '  - email_blacklist_patterns table'
\echo '  - is_blacklisted_email() function'
\echo '  - is_organization_name() function'
\echo '  - Updated is_valid_person_name() to use registry'
\echo '  - v_data_quality_summary view'
\echo ''
