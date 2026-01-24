\echo '=== MIG_575: Duplicate Monitoring Infrastructure ==='
\echo 'Creates views and functions for detecting and resolving duplicate people'

-- ============================================================================
-- PART 1: Duplicate detection views
-- ============================================================================

\echo 'Creating duplicate detection views...'

-- Email duplicates
CREATE OR REPLACE VIEW trapper.v_potential_email_duplicates AS
SELECT
    primary_email,
    COUNT(*) as person_count,
    array_agg(person_id ORDER BY created_at) as person_ids,
    array_agg(DISTINCT display_name) as names,
    array_agg(DISTINCT data_source::TEXT) as data_sources,
    MIN(created_at) as earliest_created,
    MAX(created_at) as latest_created
FROM trapper.sot_people
WHERE primary_email IS NOT NULL
  AND merged_into_person_id IS NULL
GROUP BY primary_email
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

COMMENT ON VIEW trapper.v_potential_email_duplicates IS
'Shows people who share the same email address (potential duplicates).
Use merge_duplicate_person() or merge_email_duplicates() to resolve.';

-- Phone duplicates
CREATE OR REPLACE VIEW trapper.v_potential_phone_duplicates AS
SELECT
    primary_phone,
    COUNT(*) as person_count,
    array_agg(person_id ORDER BY created_at) as person_ids,
    array_agg(DISTINCT display_name) as names,
    array_agg(DISTINCT data_source::TEXT) as data_sources,
    MIN(created_at) as earliest_created,
    MAX(created_at) as latest_created
FROM trapper.sot_people
WHERE primary_phone IS NOT NULL
  AND merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist bl
      WHERE bl.phone_norm = primary_phone
  )
GROUP BY primary_phone
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

COMMENT ON VIEW trapper.v_potential_phone_duplicates IS
'Shows people who share the same phone number (potential duplicates or household members).
Excludes blacklisted shared phones.';

-- Names with garbage patterns
CREATE OR REPLACE VIEW trapper.v_names_with_garbage_patterns AS
SELECT
    person_id,
    display_name,
    primary_email,
    primary_phone,
    data_source,
    created_at,
    CASE
        WHEN display_name ~ '[0-9]{9,}' THEN 'microchip_in_name'
        WHEN display_name ~ '(?i)^feral\s*wild' THEN 'shelterluv_internal'
        WHEN display_name ~ '(?i)med\s*hold' THEN 'medical_hold'
        WHEN display_name ~ '(?i)^[0-9]+$' THEN 'only_numbers'
        ELSE 'other_pattern'
    END as pattern_type
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND (
    display_name ~ '[0-9]{9,}'
    OR display_name ~ '(?i)^feral\s*wild'
    OR display_name ~ '(?i)med\s*hold'
    OR display_name ~ '^[0-9]+$'
  )
ORDER BY created_at DESC;

COMMENT ON VIEW trapper.v_names_with_garbage_patterns IS
'Shows people whose names contain microchip numbers or other garbage patterns.
These should be cleaned or merged.';

-- ============================================================================
-- PART 2: Data quality dashboard view
-- ============================================================================

\echo 'Creating data quality summary view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_summary AS
SELECT
    (SELECT COUNT(*) FROM trapper.v_potential_email_duplicates) as email_duplicates,
    (SELECT SUM(person_count - 1) FROM trapper.v_potential_email_duplicates) as email_excess_records,
    (SELECT COUNT(*) FROM trapper.v_potential_phone_duplicates) as phone_duplicates,
    (SELECT SUM(person_count - 1) FROM trapper.v_potential_phone_duplicates) as phone_excess_records,
    (SELECT COUNT(*) FROM trapper.v_names_with_garbage_patterns) as garbage_names,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as active_people,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL) as merged_people,
    (SELECT COUNT(*) FROM trapper.person_merges WHERE created_at > NOW() - INTERVAL '7 days') as merges_last_7_days,
    (SELECT COUNT(*) FROM trapper.person_merges WHERE created_at > NOW() - INTERVAL '24 hours') as merges_last_24h;

COMMENT ON VIEW trapper.v_data_quality_summary IS
'Summary of data quality metrics for monitoring.
Shows duplicate counts, garbage names, and merge activity.';

-- ============================================================================
-- PART 3: Batch merge function for email duplicates
-- ============================================================================

\echo 'Creating batch merge function...'

CREATE OR REPLACE FUNCTION trapper.merge_email_duplicates(
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    emails_found INT,
    people_to_merge INT,
    merges_executed INT,
    errors INT,
    sample_merges JSONB
) AS $$
DECLARE
    v_emails_found INT := 0;
    v_people_to_merge INT := 0;
    v_merges_executed INT := 0;
    v_errors INT := 0;
    v_sample_merges JSONB := '[]'::JSONB;
    v_dup RECORD;
    v_person_id UUID;
    v_canonical_id UUID;
    v_result JSONB;
    v_sample_count INT := 0;
BEGIN
    -- Count duplicates
    SELECT COUNT(*), COALESCE(SUM(person_count - 1), 0)::INT
    INTO v_emails_found, v_people_to_merge
    FROM trapper.v_potential_email_duplicates;

    IF NOT p_dry_run THEN
        FOR v_dup IN
            SELECT primary_email, person_ids, names
            FROM trapper.v_potential_email_duplicates
        LOOP
            -- First person is canonical (oldest)
            v_canonical_id := v_dup.person_ids[1];

            -- Merge all others into canonical
            FOREACH v_person_id IN ARRAY v_dup.person_ids[2:] LOOP
                BEGIN
                    v_result := trapper.merge_duplicate_person(v_canonical_id, v_person_id, 'auto_email_dedup');
                    IF (v_result->>'success')::BOOLEAN THEN
                        v_merges_executed := v_merges_executed + 1;

                        -- Track sample merges (first 5)
                        IF v_sample_count < 5 THEN
                            v_sample_merges := v_sample_merges || jsonb_build_object(
                                'email', v_dup.primary_email,
                                'canonical', v_canonical_id,
                                'merged', v_person_id
                            );
                            v_sample_count := v_sample_count + 1;
                        END IF;
                    ELSE
                        v_errors := v_errors + 1;
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    v_errors := v_errors + 1;
                    RAISE WARNING 'Error merging % into %: %', v_person_id, v_canonical_id, SQLERRM;
                END;
            END LOOP;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_emails_found, v_people_to_merge, v_merges_executed, v_errors, v_sample_merges;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_email_duplicates IS
'Batch merges all people who share the same email address.
Keeps the oldest person (earliest created_at) as canonical.
Use p_dry_run=TRUE to preview without making changes.
Returns counts and sample of merges performed.';

-- ============================================================================
-- PART 4: Function to clean garbage names
-- ============================================================================

\echo 'Creating batch name cleaning function...'

CREATE OR REPLACE FUNCTION trapper.clean_garbage_names(
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    names_found INT,
    names_cleaned INT,
    names_unchanged INT,
    errors INT,
    sample_changes JSONB
) AS $$
DECLARE
    v_names_found INT := 0;
    v_names_cleaned INT := 0;
    v_names_unchanged INT := 0;
    v_errors INT := 0;
    v_sample_changes JSONB := '[]'::JSONB;
    v_rec RECORD;
    v_cleaned_name TEXT;
    v_sample_count INT := 0;
BEGIN
    -- Count garbage names
    SELECT COUNT(*) INTO v_names_found
    FROM trapper.v_names_with_garbage_patterns;

    IF NOT p_dry_run THEN
        FOR v_rec IN
            SELECT person_id, display_name, primary_email
            FROM trapper.v_names_with_garbage_patterns
        LOOP
            BEGIN
                v_cleaned_name := trapper.clean_person_name(v_rec.display_name);

                IF v_cleaned_name IS NOT NULL AND v_cleaned_name != '' AND v_cleaned_name != v_rec.display_name THEN
                    UPDATE trapper.sot_people
                    SET display_name = v_cleaned_name,
                        updated_at = NOW()
                    WHERE person_id = v_rec.person_id;

                    v_names_cleaned := v_names_cleaned + 1;

                    -- Track sample changes (first 5)
                    IF v_sample_count < 5 THEN
                        v_sample_changes := v_sample_changes || jsonb_build_object(
                            'person_id', v_rec.person_id,
                            'old_name', v_rec.display_name,
                            'new_name', v_cleaned_name
                        );
                        v_sample_count := v_sample_count + 1;
                    END IF;
                ELSE
                    v_names_unchanged := v_names_unchanged + 1;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_errors := v_errors + 1;
                RAISE WARNING 'Error cleaning name for %: %', v_rec.person_id, SQLERRM;
            END;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_names_found, v_names_cleaned, v_names_unchanged, v_errors, v_sample_changes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.clean_garbage_names IS
'Batch cleans all display_names that contain garbage patterns (microchips, etc.).
Uses clean_person_name() to strip garbage while preserving meaningful name parts.
Use p_dry_run=TRUE to preview without making changes.';

-- ============================================================================
-- PART 5: Add views to Tippy catalog
-- ============================================================================

\echo 'Adding views to Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
    ('v_potential_email_duplicates', 'data_quality',
     'Shows people who share the same email address (potential duplicates). Includes person_ids array for merging.',
     ARRAY['primary_email', 'person_count', 'names'], ARRAY['primary_email'],
     ARRAY['Are there duplicate people?', 'Which emails have multiple people?', 'How many duplicates exist?']),
    ('v_potential_phone_duplicates', 'data_quality',
     'Shows people who share the same phone number. May be duplicates or household members sharing a phone.',
     ARRAY['primary_phone', 'person_count', 'names'], ARRAY['primary_phone'],
     ARRAY['Who shares phone numbers?', 'Are there phone duplicates?']),
    ('v_names_with_garbage_patterns', 'data_quality',
     'Shows people whose names contain microchip numbers, ShelterLuv codes, or other garbage patterns that need cleaning.',
     ARRAY['person_id', 'display_name', 'pattern_type'], ARRAY['pattern_type', 'data_source'],
     ARRAY['Are there names with microchips?', 'Which names have garbage data?', 'Are there bad names to clean?']),
    ('v_data_quality_summary', 'data_quality',
     'Summary dashboard of data quality: duplicate counts (email/phone), garbage names, active vs merged people, recent merge activity.',
     ARRAY['email_duplicates', 'phone_duplicates', 'garbage_names', 'active_people', 'merged_people'], ARRAY[],
     ARRAY['How is data quality?', 'Are there data problems?', 'How many duplicates?', 'What is the duplicate count?'])
ON CONFLICT (view_name) DO UPDATE SET
    description = EXCLUDED.description,
    key_columns = EXCLUDED.key_columns,
    filter_columns = EXCLUDED.filter_columns,
    example_questions = EXCLUDED.example_questions,
    updated_at = NOW();

-- ============================================================================
-- PART 6: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Current data quality summary:'
SELECT * FROM trapper.v_data_quality_summary;

\echo ''
\echo 'Duplicate detection views created:'
SELECT view_name, description
FROM trapper.tippy_view_catalog
WHERE category = 'data_quality'
ORDER BY view_name;

\echo ''
\echo 'MIG_575 complete: Duplicate monitoring infrastructure added'
\echo 'Available tools:'
\echo '  - v_potential_email_duplicates: Find email duplicates'
\echo '  - v_potential_phone_duplicates: Find phone duplicates'
\echo '  - v_names_with_garbage_patterns: Find names needing cleanup'
\echo '  - v_data_quality_summary: Dashboard metrics'
\echo '  - merge_email_duplicates(dry_run): Batch merge by email'
\echo '  - clean_garbage_names(dry_run): Batch clean names'
