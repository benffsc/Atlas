-- MIG_251: Identity Resolution with Source Confidence
--
-- Problem: When a web submission comes in with a shared email (e.g., family members),
-- the system auto-links to the existing person without checking if the names match.
-- This causes erroneous merging (Jane Smith linked to John Smith's record).
--
-- Solution:
--   1. Source confidence scoring - web_intake is high confidence, clinichq is lower
--   2. Name mismatch detection - compare names before auto-linking by email/phone
--   3. Potential duplicate flagging - create new person but flag the conflict
--
-- Identity Resolution Rules (after this migration):
--   - Email match + similar name (>0.5 similarity) → link to existing
--   - Email match + different name → create new person, flag as potential duplicate
--   - Phone match + similar name → link to existing
--   - Phone match + different name → create new person, flag as potential duplicate
--   - No match → create new person
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_251__identity_resolution_confidence.sql

\echo ''
\echo '=============================================='
\echo 'MIG_251: Identity Resolution with Source Confidence'
\echo '=============================================='
\echo ''

-- Ensure pg_trgm extension for similarity scoring
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. Source Confidence Table
-- ============================================================

\echo '1. Creating source_confidence table...'

CREATE TABLE IF NOT EXISTS trapper.source_confidence (
    source_system TEXT PRIMARY KEY,
    confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.source_confidence IS
'Confidence scores for different data sources.
Higher score = more trustworthy data.
Used in identity resolution to decide when to link vs create new records.';

-- Seed confidence values
INSERT INTO trapper.source_confidence (source_system, confidence_score, description) VALUES
    ('web_intake', 0.95, 'User submitted directly via web form - highest confidence'),
    ('atlas_ui', 0.90, 'Staff entered via Atlas UI - high confidence'),
    ('airtable', 0.70, 'Imported from Airtable - medium confidence'),
    ('clinichq', 0.50, 'ClinicHQ data - lower confidence (cats booked under location for microchip tracking)'),
    ('manual', 0.85, 'Manual data entry by staff')
ON CONFLICT (source_system) DO UPDATE SET
    confidence_score = EXCLUDED.confidence_score,
    description = EXCLUDED.description;

-- ============================================================
-- 2. Potential Duplicate Tracking
-- ============================================================

\echo '2. Creating potential_person_duplicates table...'

CREATE TABLE IF NOT EXISTS trapper.potential_person_duplicates (
    duplicate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The new person created (may be a duplicate)
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    -- The existing person this might be a duplicate of
    potential_match_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    -- Why we flagged this
    match_type TEXT NOT NULL, -- 'email_name_mismatch', 'phone_name_mismatch'
    matched_identifier TEXT, -- The email or phone that matched
    -- Names for quick review
    new_name TEXT NOT NULL,
    existing_name TEXT NOT NULL,
    name_similarity NUMERIC(4,3), -- 0.000 to 1.000
    -- Source info
    new_source_system TEXT,
    existing_source_system TEXT,
    new_confidence NUMERIC(3,2),
    existing_confidence NUMERIC(3,2),
    -- Resolution
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'merged', 'kept_separate', 'dismissed'
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT,
    -- Tracking
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_potential_duplicate UNIQUE (person_id, potential_match_id)
);

CREATE INDEX IF NOT EXISTS idx_potential_duplicates_status
    ON trapper.potential_person_duplicates(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_potential_duplicates_person
    ON trapper.potential_person_duplicates(person_id);

COMMENT ON TABLE trapper.potential_person_duplicates IS
'Tracks potential duplicate people flagged during identity resolution.
When a new submission has matching email/phone but different name,
we create a new person and log the potential duplicate for staff review.';

-- ============================================================
-- 3. Helper Function: Name Similarity Check
-- ============================================================

\echo '3. Creating name_similarity function...'

CREATE OR REPLACE FUNCTION trapper.name_similarity(
    p_name1 TEXT,
    p_name2 TEXT
) RETURNS NUMERIC AS $$
DECLARE
    v_name1 TEXT;
    v_name2 TEXT;
    v_sim NUMERIC;
BEGIN
    -- Normalize names for comparison
    v_name1 := LOWER(TRIM(COALESCE(p_name1, '')));
    v_name2 := LOWER(TRIM(COALESCE(p_name2, '')));

    -- Empty names don't match
    IF v_name1 = '' OR v_name2 = '' THEN
        RETURN 0;
    END IF;

    -- Use trigram similarity
    v_sim := similarity(v_name1, v_name2);

    RETURN v_sim;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.name_similarity IS
'Computes name similarity score between 0 and 1 using trigram matching.
Used to detect if two names likely refer to the same person.
Score > 0.5 typically means same person, < 0.5 means likely different people.';

-- ============================================================
-- 4. Helper Function: Get Source Confidence
-- ============================================================

\echo '4. Creating get_source_confidence function...'

CREATE OR REPLACE FUNCTION trapper.get_source_confidence(p_source_system TEXT)
RETURNS NUMERIC AS $$
BEGIN
    RETURN COALESCE(
        (SELECT confidence_score FROM trapper.source_confidence WHERE source_system = p_source_system),
        0.50  -- Default confidence for unknown sources
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 5. Updated find_or_create_person with Name Checking
-- ============================================================

\echo '5. Updating find_or_create_person with name mismatch detection...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'web_intake'
)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
    v_existing_person RECORD;
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_name_sim NUMERIC;
    v_new_confidence NUMERIC;
    v_existing_confidence NUMERIC;
    v_similarity_threshold NUMERIC := 0.5;  -- Names below this are considered different people
BEGIN
    v_email_norm := LOWER(TRIM(NULLIF(p_email, '')));
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_display_name := TRIM(CONCAT_WS(' ', NULLIF(TRIM(p_first_name), ''), NULLIF(TRIM(p_last_name), '')));
    v_new_confidence := trapper.get_source_confidence(p_source_system);

    -- REJECT internal accounts - they should not become people
    IF trapper.is_internal_account(v_display_name) THEN
        RETURN NULL;
    END IF;
    IF v_email_norm IS NOT NULL AND v_email_norm LIKE '%@forgottenfelines.org' THEN
        RETURN NULL;
    END IF;

    -- Must have at least email OR phone
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        RETURN NULL;
    END IF;

    -- Try to find by email first
    IF v_email_norm IS NOT NULL THEN
        SELECT
            p.person_id,
            p.display_name,
            COALESCE(p.data_source::TEXT, 'unknown') AS source_system
        INTO v_existing_person
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
          AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_existing_person.person_id IS NOT NULL THEN
            -- Check name similarity
            v_name_sim := trapper.name_similarity(v_display_name, v_existing_person.display_name);
            v_existing_confidence := trapper.get_source_confidence(v_existing_person.source_system);

            IF v_name_sim >= v_similarity_threshold THEN
                -- Names are similar enough - same person
                RETURN trapper.canonical_person_id(v_existing_person.person_id);
            ELSE
                -- Names are different - likely different people sharing email
                -- Create new person and flag potential duplicate
                RAISE NOTICE 'Email match but name mismatch: "%" vs "%" (similarity: %)',
                    v_display_name, v_existing_person.display_name, v_name_sim;

                -- Only create new if we have a valid name
                IF trapper.is_valid_person_name(v_display_name) THEN
                    -- Create new person
                    INSERT INTO trapper.sot_people (display_name, source_system, is_canonical)
                    VALUES (v_display_name, p_source_system, TRUE)
                    RETURNING person_id INTO v_person_id;

                    -- Add email identifier to new person
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                    VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                    ON CONFLICT DO NOTHING;

                    -- Add phone if available
                    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
                        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
                            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system)
                            ON CONFLICT DO NOTHING;
                        END IF;
                    END IF;

                    -- Flag as potential duplicate for review
                    INSERT INTO trapper.potential_person_duplicates (
                        person_id, potential_match_id, match_type, matched_identifier,
                        new_name, existing_name, name_similarity,
                        new_source_system, existing_source_system,
                        new_confidence, existing_confidence
                    ) VALUES (
                        v_person_id, v_existing_person.person_id, 'email_name_mismatch', v_email_norm,
                        v_display_name, v_existing_person.display_name, v_name_sim,
                        p_source_system, v_existing_person.source_system,
                        v_new_confidence, v_existing_confidence
                    ) ON CONFLICT DO NOTHING;

                    RETURN v_person_id;
                ELSE
                    -- No valid name, can't create - fall back to existing
                    RETURN trapper.canonical_person_id(v_existing_person.person_id);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Try to find by phone
    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
            SELECT
                p.person_id,
                p.display_name,
                COALESCE(p.data_source::TEXT, 'unknown') AS source_system
            INTO v_existing_person
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people p ON p.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_phone_norm
              AND p.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_existing_person.person_id IS NOT NULL THEN
                -- Check name similarity
                v_name_sim := trapper.name_similarity(v_display_name, v_existing_person.display_name);
                v_existing_confidence := trapper.get_source_confidence(v_existing_person.source_system);

                IF v_name_sim >= v_similarity_threshold THEN
                    -- Names are similar enough - same person
                    v_person_id := trapper.canonical_person_id(v_existing_person.person_id);

                    -- Add email if we matched by phone
                    IF v_email_norm IS NOT NULL THEN
                        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                        VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                        ON CONFLICT DO NOTHING;
                    END IF;

                    RETURN v_person_id;
                ELSE
                    -- Names are different - likely different people sharing phone
                    RAISE NOTICE 'Phone match but name mismatch: "%" vs "%" (similarity: %)',
                        v_display_name, v_existing_person.display_name, v_name_sim;

                    IF trapper.is_valid_person_name(v_display_name) THEN
                        -- Create new person
                        INSERT INTO trapper.sot_people (display_name, source_system, is_canonical)
                        VALUES (v_display_name, p_source_system, TRUE)
                        RETURNING person_id INTO v_person_id;

                        -- Add identifiers
                        IF v_email_norm IS NOT NULL THEN
                            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                            VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system)
                            ON CONFLICT DO NOTHING;
                        END IF;

                        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                        VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system)
                        ON CONFLICT DO NOTHING;

                        -- Flag as potential duplicate
                        INSERT INTO trapper.potential_person_duplicates (
                            person_id, potential_match_id, match_type, matched_identifier,
                            new_name, existing_name, name_similarity,
                            new_source_system, existing_source_system,
                            new_confidence, existing_confidence
                        ) VALUES (
                            v_person_id, v_existing_person.person_id, 'phone_name_mismatch', v_phone_norm,
                            v_display_name, v_existing_person.display_name, v_name_sim,
                            p_source_system, v_existing_person.source_system,
                            v_new_confidence, v_existing_confidence
                        ) ON CONFLICT DO NOTHING;

                        RETURN v_person_id;
                    ELSE
                        RETURN trapper.canonical_person_id(v_existing_person.person_id);
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    -- Must have valid name to create new person
    IF NOT trapper.is_valid_person_name(v_display_name) THEN
        RETURN NULL;
    END IF;

    -- Create new person (no match found)
    INSERT INTO trapper.sot_people (display_name, source_system, is_canonical)
    VALUES (v_display_name, p_source_system, TRUE)
    RETURNING person_id INTO v_person_id;

    -- Add identifiers
    IF v_email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
        VALUES (v_person_id, 'email', p_email, v_email_norm, p_source_system, 'find_or_create');
    END IF;

    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        IF NOT EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_phone_norm) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
            VALUES (v_person_id, 'phone', p_phone, v_phone_norm, p_source_system, 'find_or_create');
        END IF;
    END IF;

    IF p_address IS NOT NULL AND TRIM(p_address) != '' THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system, source_table)
        VALUES (v_person_id, 'address', p_address, LOWER(TRIM(p_address)), p_source_system, 'find_or_create')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'Creates/finds people with name mismatch detection.
If email/phone matches but name is significantly different (similarity < 0.5),
creates a new person and flags as potential duplicate for staff review.
Uses source confidence scoring to track data quality.';

-- ============================================================
-- 6. View for Pending Potential Duplicates
-- ============================================================

\echo '6. Creating view for pending duplicates...'

CREATE OR REPLACE VIEW trapper.v_pending_person_duplicates AS
SELECT
    pd.duplicate_id,
    pd.person_id AS new_person_id,
    pd.new_name,
    pd.potential_match_id AS existing_person_id,
    pd.existing_name,
    pd.match_type,
    pd.matched_identifier,
    pd.name_similarity,
    pd.new_source_system,
    pd.existing_source_system,
    pd.new_confidence,
    pd.existing_confidence,
    pd.created_at,
    -- Additional context
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pd.person_id) AS new_person_requests,
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pd.potential_match_id) AS existing_person_requests,
    (SELECT COUNT(*) FROM trapper.web_intake_submissions s WHERE s.matched_person_id = pd.person_id) AS new_person_submissions,
    (SELECT COUNT(*) FROM trapper.web_intake_submissions s WHERE s.matched_person_id = pd.potential_match_id) AS existing_person_submissions
FROM trapper.potential_person_duplicates pd
WHERE pd.status = 'pending'
ORDER BY pd.created_at DESC;

COMMENT ON VIEW trapper.v_pending_person_duplicates IS
'Shows potential duplicate people pending staff review.
Includes context about how many requests/submissions each person has.';

-- ============================================================
-- 7. Function to Resolve Duplicate
-- ============================================================

\echo '7. Creating resolve_person_duplicate function...'

CREATE OR REPLACE FUNCTION trapper.resolve_person_duplicate(
    p_duplicate_id UUID,
    p_action TEXT,  -- 'merge', 'keep_separate', 'dismiss'
    p_resolved_by TEXT DEFAULT 'staff',
    p_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_dup RECORD;
BEGIN
    SELECT * INTO v_dup FROM trapper.potential_person_duplicates WHERE duplicate_id = p_duplicate_id;

    IF v_dup IS NULL THEN
        RAISE EXCEPTION 'Duplicate record not found: %', p_duplicate_id;
    END IF;

    IF v_dup.status != 'pending' THEN
        RAISE EXCEPTION 'Duplicate already resolved with status: %', v_dup.status;
    END IF;

    IF p_action = 'merge' THEN
        -- Merge the new person into the existing one
        -- The new person (likely from web intake) gets merged into existing
        PERFORM trapper.merge_people(v_dup.person_id, v_dup.potential_match_id, 'duplicate_resolution', p_resolved_by);

        UPDATE trapper.potential_person_duplicates
        SET status = 'merged', resolved_at = NOW(), resolved_by = p_resolved_by, resolution_notes = p_notes
        WHERE duplicate_id = p_duplicate_id;

    ELSIF p_action = 'keep_separate' THEN
        -- Confirmed as different people
        UPDATE trapper.potential_person_duplicates
        SET status = 'kept_separate', resolved_at = NOW(), resolved_by = p_resolved_by, resolution_notes = p_notes
        WHERE duplicate_id = p_duplicate_id;

    ELSIF p_action = 'dismiss' THEN
        -- Dismiss without action
        UPDATE trapper.potential_person_duplicates
        SET status = 'dismissed', resolved_at = NOW(), resolved_by = p_resolved_by, resolution_notes = p_notes
        WHERE duplicate_id = p_duplicate_id;

    ELSE
        RAISE EXCEPTION 'Invalid action: %. Use merge, keep_separate, or dismiss', p_action;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.resolve_person_duplicate IS
'Resolves a potential duplicate person record.
Actions: merge (combine records), keep_separate (confirmed different), dismiss (ignore).';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_251 Complete!'
\echo ''
\echo 'What changed:'
\echo '  - source_confidence table: Tracks trust level per data source'
\echo '  - potential_person_duplicates table: Flags conflicts for review'
\echo '  - find_or_create_person: Now checks name similarity before linking'
\echo '  - v_pending_person_duplicates: View for staff to review conflicts'
\echo '  - resolve_person_duplicate: Function to resolve flagged duplicates'
\echo ''
\echo 'Identity Resolution Rules:'
\echo '  - Email/phone match + similar name (>0.5) = link to existing'
\echo '  - Email/phone match + different name (<0.5) = create new, flag for review'
\echo '  - No match = create new person'
\echo ''
\echo 'Source Confidence Scores:'
\echo '  - web_intake: 0.95 (highest - user submitted directly)'
\echo '  - atlas_ui: 0.90 (staff entered)'
\echo '  - airtable: 0.70 (imported)'
\echo '  - clinichq: 0.50 (lower - cats booked under location)'
\echo ''
