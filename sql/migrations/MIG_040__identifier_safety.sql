-- MIG_040__identifier_safety.sql
-- Identifier blocklist and account type classification
--
-- Purpose:
--   1. Blocklist organizational identifiers (FFSC phone/email)
--   2. Classify accounts as person/organization/place/placeholder
--   3. Weaken phone-only matching to require corroborating evidence
--   4. Flag low-confidence merges for review
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_040__identifier_safety.sql

\echo '============================================'
\echo 'MIG_040: Identifier Safety & Account Types'
\echo '============================================'

-- ============================================
-- PART 1: Identifier Blocklist
-- ============================================
\echo ''
\echo 'Creating identifier_blocklist table...'

CREATE TABLE IF NOT EXISTS trapper.identifier_blocklist (
    blocklist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_type TEXT NOT NULL,           -- 'phone', 'email', or '*' for all
    pattern TEXT NOT NULL,           -- value or pattern to match
    pattern_type TEXT NOT NULL DEFAULT 'exact',  -- 'exact', 'prefix', 'suffix', 'domain'
    reason TEXT NOT NULL,            -- why blocklisted
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT current_user,

    CONSTRAINT valid_pattern_type CHECK (pattern_type IN ('exact', 'prefix', 'suffix', 'domain', 'regex'))
);

COMMENT ON TABLE trapper.identifier_blocklist IS
'Identifiers to exclude from person matching. Prevents organizational phones/emails
from incorrectly merging unrelated people into one record.';

CREATE INDEX IF NOT EXISTS idx_identifier_blocklist_type
ON trapper.identifier_blocklist (id_type, pattern_type);

-- ============================================
-- PART 2: Populate initial blocklist
-- ============================================
\echo ''
\echo 'Populating initial blocklist...'

-- FFSC organizational identifiers
INSERT INTO trapper.identifier_blocklist (id_type, pattern, pattern_type, reason) VALUES
-- Main FFSC phone
('phone', '7075767999', 'exact', 'FFSC main organizational phone'),

-- FFSC domain emails
('email', '@forgottenfelines.com', 'suffix', 'FFSC staff email domain - not client identifiers'),

-- Specific staff emails to blocklist (even if domain changes)
('email', 'info@', 'prefix', 'Generic info@ addresses - not personal'),
('email', 'noreply@', 'prefix', 'No-reply addresses - not personal'),
('email', 'admin@', 'prefix', 'Generic admin@ addresses - not personal'),
('email', 'support@', 'prefix', 'Generic support@ addresses - not personal'),
('email', 'contact@', 'prefix', 'Generic contact@ addresses - not personal'),
('email', 'hello@', 'prefix', 'Generic hello@ addresses - not personal'),
('email', 'office@', 'prefix', 'Generic office@ addresses - not personal')

ON CONFLICT DO NOTHING;

-- ============================================
-- PART 3: Blocklist check function
-- ============================================
\echo ''
\echo 'Creating is_identifier_blocklisted function...'

CREATE OR REPLACE FUNCTION trapper.is_identifier_blocklisted(
    p_id_type TEXT,
    p_id_value TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_id_value IS NULL OR TRIM(p_id_value) = '' THEN
        RETURN TRUE;  -- Treat empty as blocklisted
    END IF;

    v_normalized := LOWER(TRIM(p_id_value));

    RETURN EXISTS (
        SELECT 1 FROM trapper.identifier_blocklist
        WHERE (id_type = p_id_type OR id_type = '*')
        AND (
            (pattern_type = 'exact' AND v_normalized = LOWER(pattern))
            OR (pattern_type = 'prefix' AND v_normalized LIKE LOWER(pattern) || '%')
            OR (pattern_type = 'suffix' AND v_normalized LIKE '%' || LOWER(pattern))
            OR (pattern_type = 'domain' AND v_normalized LIKE '%@' || LOWER(pattern))
            OR (pattern_type = 'regex' AND v_normalized ~ pattern)
        )
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_identifier_blocklisted IS
'Returns TRUE if the identifier matches a blocklist pattern.
Used to prevent organizational identifiers from creating incorrect person merges.

Usage: SELECT trapper.is_identifier_blocklisted(''phone'', ''7075767999'');';

-- ============================================
-- PART 4: Account type classification
-- ============================================
\echo ''
\echo 'Adding account_type column to sot_people...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_people' AND column_name = 'account_type'
    ) THEN
        ALTER TABLE trapper.sot_people ADD COLUMN account_type TEXT DEFAULT 'person';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_people' AND column_name = 'account_type_confidence'
    ) THEN
        ALTER TABLE trapper.sot_people ADD COLUMN account_type_confidence NUMERIC(3,2) DEFAULT 1.0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_people' AND column_name = 'account_type_reason'
    ) THEN
        ALTER TABLE trapper.sot_people ADD COLUMN account_type_reason TEXT;
    END IF;
END $$;

COMMENT ON COLUMN trapper.sot_people.account_type IS
'Classification of this record: person, organization, place, placeholder, internal_project, duplicate_marker';

CREATE INDEX IF NOT EXISTS idx_sot_people_account_type
ON trapper.sot_people (account_type) WHERE merged_into_person_id IS NULL;

-- ============================================
-- PART 5: Account type inference function
-- ============================================
\echo ''
\echo 'Creating infer_account_type function...'

CREATE OR REPLACE FUNCTION trapper.infer_account_type(p_display_name TEXT)
RETURNS TABLE (
    account_type TEXT,
    confidence NUMERIC,
    reason TEXT
) AS $$
DECLARE
    v_name TEXT;
BEGIN
    v_name := COALESCE(p_display_name, '');

    -- FFSC internal patterns (check BEFORE duplicated name pattern)
    IF v_name ~* 'ffsc|forgotten felines' THEN
        IF v_name ~* 'barn cat program|relocation program|foster' THEN
            RETURN QUERY SELECT 'internal_project'::TEXT, 0.90::NUMERIC, 'FFSC program name'::TEXT;
        ELSE
            RETURN QUERY SELECT 'internal_project'::TEXT, 0.80::NUMERIC, 'Contains FFSC reference'::TEXT;
        END IF;
        RETURN;
    END IF;

    -- Barn cat program without FFSC name
    IF v_name ~* 'barn cat program' THEN
        RETURN QUERY SELECT 'internal_project'::TEXT, 0.90::NUMERIC, 'FFSC program name'::TEXT;
        RETURN;
    END IF;

    -- Duplicate report pattern
    IF v_name ~* '^duplicate report' THEN
        RETURN QUERY SELECT 'duplicate_marker'::TEXT, 0.95::NUMERIC, 'Duplicate report marker'::TEXT;
        RETURN;
    END IF;

    -- Organization patterns
    IF v_name ~* '(middle school|elementary school|high school|charter school|university|college)' THEN
        RETURN QUERY SELECT 'organization'::TEXT, 0.90::NUMERIC, 'Educational institution'::TEXT;
        RETURN;
    END IF;

    IF v_name ~* '(kitten rescue|feline rescue|cat rescue|animal rescue|animal shelter|humane society)' THEN
        RETURN QUERY SELECT 'organization'::TEXT, 0.90::NUMERIC, 'Animal welfare organization'::TEXT;
        RETURN;
    END IF;

    IF v_name ~* '(landfill|fairgrounds|transit|county |city of )' THEN
        RETURN QUERY SELECT 'organization'::TEXT, 0.85::NUMERIC, 'Government/municipal entity'::TEXT;
        RETURN;
    END IF;

    -- Place patterns (apartments, mobile homes, etc.)
    IF v_name ~* '(apartments?|apts?\.?|mobile home|mhp|villa royal|manor|estates|heights)' THEN
        -- Avoid false positives like "Maria Villagomez"
        IF v_name !~* '^[a-z]+ [a-z]+(ez|ez|a|o)$' THEN
            RETURN QUERY SELECT 'place'::TEXT, 0.85::NUMERIC, 'Residential complex name'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Business patterns
    IF v_name ~* '(corporation|corp\.?|inc\.?|llc|company|co\.|enterprises|industries|supply|services)' THEN
        RETURN QUERY SELECT 'organization'::TEXT, 0.85::NUMERIC, 'Business entity'::TEXT;
        RETURN;
    END IF;

    -- Farm/ranch patterns
    IF v_name ~* '(ranch|farm|winery|vineyard|dairy)' AND v_name ~ '^(.{3,}) \1$' THEN
        RETURN QUERY SELECT 'place'::TEXT, 0.85::NUMERIC, 'Agricultural business'::TEXT;
        RETURN;
    END IF;

    -- Duplicated name pattern (e.g., "Casini Ranch Casini Ranch")
    -- This is a strong signal of a business/place - check AFTER specific patterns
    IF v_name ~ '^(.{3,}) \1$' THEN
        RETURN QUERY SELECT 'place'::TEXT, 0.95::NUMERIC, 'Duplicated name pattern (business/place)'::TEXT;
        RETURN;
    END IF;

    -- Default: likely a real person
    RETURN QUERY SELECT 'person'::TEXT, 0.70::NUMERIC, 'No non-person patterns detected'::TEXT;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.infer_account_type IS
'Infers account type from display name patterns.
Returns: account_type (person/organization/place/placeholder/internal_project/duplicate_marker),
confidence score, and reason.';

-- ============================================
-- PART 6: Batch update account types
-- ============================================
\echo ''
\echo 'Creating update_account_types function...'

CREATE OR REPLACE FUNCTION trapper.update_account_types(
    p_only_unclassified BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    updated_count INT,
    by_type JSONB
) AS $$
DECLARE
    v_updated INT := 0;
    v_by_type JSONB := '{}'::JSONB;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT
            sp.person_id,
            sp.display_name,
            (trapper.infer_account_type(sp.display_name)).*
        FROM trapper.sot_people sp
        WHERE sp.merged_into_person_id IS NULL
        AND (
            NOT p_only_unclassified
            OR sp.account_type IS NULL
            OR sp.account_type = 'person'
        )
    LOOP
        -- Only update if not already set to the same value with higher confidence
        UPDATE trapper.sot_people
        SET
            account_type = v_rec.account_type,
            account_type_confidence = v_rec.confidence,
            account_type_reason = v_rec.reason
        WHERE person_id = v_rec.person_id
        AND (
            account_type IS NULL
            OR account_type = 'person'
            OR account_type_confidence < v_rec.confidence
        );

        IF FOUND THEN
            v_updated := v_updated + 1;
            v_by_type := v_by_type || jsonb_build_object(
                v_rec.account_type,
                COALESCE((v_by_type->>v_rec.account_type)::INT, 0) + 1
            );
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_updated, v_by_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_account_types IS
'Batch updates account_type for all people based on display name patterns.
Set p_only_unclassified=FALSE to reclassify all records.';

-- ============================================
-- PART 7: Match confidence flag
-- ============================================
\echo ''
\echo 'Adding needs_review column to person_match_candidates...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'person_match_candidates' AND column_name = 'needs_review'
    ) THEN
        ALTER TABLE trapper.person_match_candidates ADD COLUMN needs_review BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'person_match_candidates' AND column_name = 'review_reason'
    ) THEN
        ALTER TABLE trapper.person_match_candidates ADD COLUMN review_reason TEXT;
    END IF;
END $$;

COMMENT ON COLUMN trapper.person_match_candidates.needs_review IS
'TRUE if this match should be manually reviewed before accepting.
Set when matching is based only on phone without name similarity.';

-- ============================================
-- PART 8: Updated person identifier creation
-- ============================================
\echo ''
\echo 'Creating safe_create_person_identifier function...'

CREATE OR REPLACE FUNCTION trapper.safe_create_person_identifier(
    p_person_id UUID,
    p_id_type TEXT,
    p_id_value TEXT,
    p_id_value_raw TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT NULL,
    p_source_table TEXT DEFAULT NULL,
    p_staged_record_id UUID DEFAULT NULL
)
RETURNS TABLE (
    created BOOLEAN,
    blocked BOOLEAN,
    reason TEXT
) AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    -- Normalize the value
    v_normalized := LOWER(TRIM(COALESCE(p_id_value, '')));

    IF v_normalized = '' THEN
        RETURN QUERY SELECT FALSE, TRUE, 'Empty identifier value';
        RETURN;
    END IF;

    -- Check blocklist
    IF trapper.is_identifier_blocklisted(p_id_type, v_normalized) THEN
        RETURN QUERY SELECT FALSE, TRUE, 'Identifier is blocklisted';
        RETURN;
    END IF;

    -- Try to insert
    BEGIN
        INSERT INTO trapper.person_identifiers (
            person_id, id_type, id_value_norm, id_value_raw,
            source_system, source_table, staged_record_id, confidence
        ) VALUES (
            p_person_id, p_id_type, v_normalized, COALESCE(p_id_value_raw, p_id_value),
            p_source_system, p_source_table, p_staged_record_id, 1.0
        )
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;

        IF FOUND THEN
            RETURN QUERY SELECT TRUE, FALSE, 'Identifier created';
        ELSE
            RETURN QUERY SELECT FALSE, FALSE, 'Identifier already exists for another person';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT FALSE, FALSE, 'Error: ' || SQLERRM;
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.safe_create_person_identifier IS
'Creates a person identifier only if it passes blocklist check.
Returns created status, blocked status, and reason.';

-- ============================================
-- PART 9: View for blocklisted identifiers in use
-- ============================================
\echo ''
\echo 'Creating v_blocklisted_identifiers_in_use view...'

CREATE OR REPLACE VIEW trapper.v_blocklisted_identifiers_in_use AS
SELECT
    pi.identifier_id,
    pi.person_id,
    sp.display_name,
    pi.id_type,
    pi.id_value_norm,
    bl.reason as blocklist_reason
FROM trapper.person_identifiers pi
JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
CROSS JOIN LATERAL (
    SELECT reason FROM trapper.identifier_blocklist bl
    WHERE (bl.id_type = pi.id_type::TEXT OR bl.id_type = '*')
    AND (
        (bl.pattern_type = 'exact' AND pi.id_value_norm = LOWER(bl.pattern))
        OR (bl.pattern_type = 'prefix' AND pi.id_value_norm LIKE LOWER(bl.pattern) || '%')
        OR (bl.pattern_type = 'suffix' AND pi.id_value_norm LIKE '%' || LOWER(bl.pattern))
        OR (bl.pattern_type = 'domain' AND pi.id_value_norm LIKE '%@' || LOWER(bl.pattern))
    )
    LIMIT 1
) bl
WHERE sp.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_blocklisted_identifiers_in_use IS
'Shows identifiers currently in use that match blocklist patterns.
These may need cleanup - the identifier links are potentially incorrect.';

-- ============================================
-- PART 10: View for account type summary
-- ============================================
\echo ''
\echo 'Creating v_account_type_summary view...'

CREATE OR REPLACE VIEW trapper.v_account_type_summary AS
SELECT
    COALESCE(account_type, 'unclassified') as account_type,
    COUNT(*) as count,
    ROUND(AVG(account_type_confidence), 2) as avg_confidence
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY account_type
ORDER BY count DESC;

COMMENT ON VIEW trapper.v_account_type_summary IS
'Summary of people records by account type classification.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_040 Complete'
\echo '============================================'

\echo ''
\echo 'Testing blocklist function:'
SELECT
    '7075767999' as identifier,
    trapper.is_identifier_blocklisted('phone', '7075767999') as is_blocked,
    'FFSC phone' as expected;

SELECT
    'info@forgottenfelines.com' as identifier,
    trapper.is_identifier_blocklisted('email', 'info@forgottenfelines.com') as is_blocked,
    'FFSC email' as expected;

SELECT
    'someone@gmail.com' as identifier,
    trapper.is_identifier_blocklisted('email', 'someone@gmail.com') as is_blocked,
    'Should NOT be blocked' as expected;

\echo ''
\echo 'Testing account type inference:'
SELECT (trapper.infer_account_type('Casini Ranch Casini Ranch')).*;
SELECT (trapper.infer_account_type('Barn Cat Program Barn Cat Program')).*;
SELECT (trapper.infer_account_type('Duplicate Report Kate Spellman')).*;
SELECT (trapper.infer_account_type('Susan Smith')).*;

\echo ''
\echo 'Blocklisted identifiers currently in use:'
SELECT * FROM trapper.v_blocklisted_identifiers_in_use LIMIT 10;

\echo ''
\echo 'To backfill account types, run:'
\echo '  SELECT * FROM trapper.update_account_types();'
\echo ''
\echo 'To see account type summary:'
\echo '  SELECT * FROM trapper.v_account_type_summary;'
\echo ''
