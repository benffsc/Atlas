\echo '=== MIG_577: Data Quality Maintenance Functions ==='
\echo 'Provides repeatable functions for ongoing data quality maintenance'

-- ============================================================================
-- PART 1: Function to clean duplicated names ("Name Name" patterns)
-- ============================================================================

\echo 'Creating clean_duplicated_display_names function...'

CREATE OR REPLACE FUNCTION trapper.clean_duplicated_display_names(
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    names_found INT,
    names_cleaned INT,
    sample_changes JSONB
) AS $$
DECLARE
    v_names_found INT := 0;
    v_names_cleaned INT := 0;
    v_sample_changes JSONB := '[]'::JSONB;
    v_rec RECORD;
    v_sample_count INT := 0;
BEGIN
    -- Count duplicated names
    SELECT COUNT(*) INTO v_names_found
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND display_name ~ '^(.{3,})\s+\1$';

    IF NOT p_dry_run THEN
        FOR v_rec IN
            SELECT person_id, display_name
            FROM trapper.sot_people
            WHERE merged_into_person_id IS NULL
              AND display_name ~ '^(.{3,})\s+\1$'
        LOOP
            UPDATE trapper.sot_people
            SET display_name = REGEXP_REPLACE(display_name, '^(.+?)\s+\1$', '\1'),
                updated_at = NOW()
            WHERE person_id = v_rec.person_id;

            v_names_cleaned := v_names_cleaned + 1;

            IF v_sample_count < 5 THEN
                v_sample_changes := v_sample_changes || jsonb_build_object(
                    'person_id', v_rec.person_id,
                    'old_name', v_rec.display_name,
                    'new_name', REGEXP_REPLACE(v_rec.display_name, '^(.+?)\s+\1$', '\1')
                );
                v_sample_count := v_sample_count + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_names_found, v_names_cleaned, v_sample_changes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.clean_duplicated_display_names IS
'Cleans person display_names that have duplicated patterns like "Business Name Business Name".
Use p_dry_run=TRUE to preview without making changes.';

-- ============================================================================
-- PART 2: Function to auto-resolve high-confidence pending reviews
-- ============================================================================

\echo 'Creating auto_resolve_high_confidence_reviews function...'

CREATE OR REPLACE FUNCTION trapper.auto_resolve_high_confidence_reviews(
    p_min_score NUMERIC DEFAULT 0.70,
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    reviews_found INT,
    reviews_merged INT,
    reviews_skipped INT,
    errors INT,
    sample_merges JSONB
) AS $$
DECLARE
    v_found INT := 0;
    v_merged INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_sample_merges JSONB := '[]'::JSONB;
    v_rec RECORD;
    v_result JSONB;
    v_sample_count INT := 0;
BEGIN
    -- Count pending high-confidence reviews
    SELECT COUNT(*) INTO v_found
    FROM trapper.data_engine_match_decisions
    WHERE decision_type = 'review_pending'
      AND review_status = 'pending'
      AND top_candidate_score >= p_min_score
      AND resulting_person_id IS NOT NULL
      AND top_candidate_person_id IS NOT NULL
      AND resulting_person_id != top_candidate_person_id;

    IF NOT p_dry_run THEN
        FOR v_rec IN
            SELECT
                decision_id,
                resulting_person_id,
                top_candidate_person_id,
                top_candidate_score,
                incoming_name
            FROM trapper.data_engine_match_decisions
            WHERE decision_type = 'review_pending'
              AND review_status = 'pending'
              AND top_candidate_score >= p_min_score
              AND resulting_person_id IS NOT NULL
              AND top_candidate_person_id IS NOT NULL
              AND resulting_person_id != top_candidate_person_id
        LOOP
            BEGIN
                -- Check if either person is already merged
                IF EXISTS (
                    SELECT 1 FROM trapper.sot_people
                    WHERE person_id = v_rec.resulting_person_id AND merged_into_person_id IS NOT NULL
                ) OR EXISTS (
                    SELECT 1 FROM trapper.sot_people
                    WHERE person_id = v_rec.top_candidate_person_id AND merged_into_person_id IS NOT NULL
                ) THEN
                    UPDATE trapper.data_engine_match_decisions
                    SET review_status = 'merged',
                        review_notes = 'Already merged by prior operation',
                        reviewed_at = NOW(),
                        reviewed_by = 'system_auto_resolve'
                    WHERE decision_id = v_rec.decision_id;
                    v_skipped := v_skipped + 1;
                    CONTINUE;
                END IF;

                -- Merge the new person into the candidate
                v_result := trapper.merge_duplicate_person(
                    v_rec.top_candidate_person_id,
                    v_rec.resulting_person_id,
                    'auto_review_high_confidence'
                );

                IF (v_result->>'success')::BOOLEAN THEN
                    UPDATE trapper.data_engine_match_decisions
                    SET review_status = 'merged',
                        review_notes = 'Auto-merged (score=' || v_rec.top_candidate_score::TEXT || ')',
                        reviewed_at = NOW(),
                        reviewed_by = 'system_auto_resolve'
                    WHERE decision_id = v_rec.decision_id;

                    v_merged := v_merged + 1;

                    IF v_sample_count < 5 THEN
                        v_sample_merges := v_sample_merges || jsonb_build_object(
                            'name', v_rec.incoming_name,
                            'score', v_rec.top_candidate_score,
                            'canonical', v_rec.top_candidate_person_id,
                            'merged', v_rec.resulting_person_id
                        );
                        v_sample_count := v_sample_count + 1;
                    END IF;
                ELSE
                    v_errors := v_errors + 1;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_errors := v_errors + 1;
            END;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_found, v_merged, v_skipped, v_errors, v_sample_merges;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.auto_resolve_high_confidence_reviews IS
'Auto-resolves pending reviews with score >= threshold by merging.
Default threshold is 0.70 (70% confidence).
Use p_dry_run=TRUE to preview without making changes.';

-- ============================================================================
-- PART 3: Function to mark self-referential reviews as not_required
-- ============================================================================

\echo 'Creating fix_self_referential_reviews function...'

CREATE OR REPLACE FUNCTION trapper.fix_self_referential_reviews()
RETURNS INT AS $$
DECLARE
    v_fixed INT;
BEGIN
    UPDATE trapper.data_engine_match_decisions
    SET review_status = 'not_required',
        review_notes = 'Data anomaly: resulting_person equals candidate',
        reviewed_at = NOW(),
        reviewed_by = 'system_auto_resolve'
    WHERE decision_type = 'review_pending'
      AND review_status = 'pending'
      AND resulting_person_id = top_candidate_person_id;

    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RETURN v_fixed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.fix_self_referential_reviews IS
'Marks review_pending decisions where resulting_person equals candidate as not_required.
These are data anomalies that cannot be merged.';

-- ============================================================================
-- PART 3b: Function to fix reviews with NULL resulting_person
-- ============================================================================

\echo 'Creating fix_null_result_reviews function...'

CREATE OR REPLACE FUNCTION trapper.fix_null_result_reviews()
RETURNS INT AS $$
DECLARE
    v_fixed INT;
BEGIN
    -- Fix reviews where no person was created
    UPDATE trapper.data_engine_match_decisions
    SET review_status = 'not_required',
        review_notes = 'No person created - nothing to merge',
        reviewed_at = NOW(),
        reviewed_by = 'system_auto_resolve'
    WHERE decision_type = 'review_pending'
      AND review_status = 'pending'
      AND resulting_person_id IS NULL;

    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RETURN v_fixed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.fix_null_result_reviews IS
'Marks review_pending decisions where no person was created as not_required.
These decisions asked whether to link a record but no new entity was created.';

-- ============================================================================
-- PART 3c: Function to fix reviews where candidate is already merged
-- ============================================================================

\echo 'Creating fix_merged_candidate_reviews function...'

CREATE OR REPLACE FUNCTION trapper.fix_merged_candidate_reviews()
RETURNS INT AS $$
DECLARE
    v_fixed INT;
BEGIN
    UPDATE trapper.data_engine_match_decisions
    SET review_status = 'merged',
        review_notes = 'Candidate already merged elsewhere',
        reviewed_at = NOW(),
        reviewed_by = 'system_auto_resolve'
    WHERE decision_type = 'review_pending'
      AND review_status = 'pending'
      AND top_candidate_person_id IN (
          SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
      );

    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RETURN v_fixed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.fix_merged_candidate_reviews IS
'Marks review_pending decisions where the candidate person was already merged as merged.
These cannot be actioned since the candidate no longer exists as a distinct entity.';

-- ============================================================================
-- PART 4: Function to clean cat garbage names
-- ============================================================================

\echo 'Creating clean_cat_garbage_names function...'

CREATE OR REPLACE FUNCTION trapper.clean_cat_garbage_names(
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    names_found INT,
    names_cleaned INT,
    sample_changes JSONB
) AS $$
DECLARE
    v_names_found INT := 0;
    v_names_cleaned INT := 0;
    v_sample_changes JSONB := '[]'::JSONB;
    v_rec RECORD;
    v_clean_name TEXT;
    v_sample_count INT := 0;
BEGIN
    -- Count garbage cat names (microchips, clinic IDs)
    SELECT COUNT(*) INTO v_names_found
    FROM trapper.sot_cats
    WHERE display_name ~ '[0-9]{9,}'
       OR display_name ~* 'unknown\s*\(clinic';

    IF NOT p_dry_run THEN
        FOR v_rec IN
            SELECT cat_id, display_name
            FROM trapper.sot_cats
            WHERE display_name ~ '[0-9]{9,}'
               OR display_name ~* 'unknown\s*\(clinic'
        LOOP
            v_clean_name := COALESCE(NULLIF(trapper.clean_cat_name(v_rec.display_name), ''), 'Unknown');

            IF v_clean_name != v_rec.display_name THEN
                UPDATE trapper.sot_cats
                SET display_name = v_clean_name,
                    updated_at = NOW()
                WHERE cat_id = v_rec.cat_id;

                v_names_cleaned := v_names_cleaned + 1;

                IF v_sample_count < 5 THEN
                    v_sample_changes := v_sample_changes || jsonb_build_object(
                        'cat_id', v_rec.cat_id,
                        'old_name', v_rec.display_name,
                        'new_name', v_clean_name
                    );
                    v_sample_count := v_sample_count + 1;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_names_found, v_names_cleaned, v_sample_changes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.clean_cat_garbage_names IS
'Cleans cat display_names that contain microchip numbers or clinic IDs.
Use p_dry_run=TRUE to preview without making changes.';

-- ============================================================================
-- PART 5: Master maintenance function
-- ============================================================================

\echo 'Creating run_data_quality_maintenance function...'

CREATE OR REPLACE FUNCTION trapper.run_data_quality_maintenance(
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    task TEXT,
    found INT,
    fixed INT,
    errors INT
) AS $$
DECLARE
    v_result RECORD;
    v_fixed INT;
BEGIN
    -- 1. Fix self-referential reviews
    IF NOT p_dry_run THEN
        v_fixed := trapper.fix_self_referential_reviews();
    ELSE
        SELECT COUNT(*) INTO v_fixed
        FROM trapper.data_engine_match_decisions
        WHERE decision_type = 'review_pending'
          AND review_status = 'pending'
          AND resulting_person_id = top_candidate_person_id;
    END IF;
    RETURN QUERY SELECT 'self_referential_reviews'::TEXT, v_fixed,
                        CASE WHEN p_dry_run THEN 0 ELSE v_fixed END, 0;

    -- 1b. Fix NULL result reviews
    IF NOT p_dry_run THEN
        v_fixed := trapper.fix_null_result_reviews();
    ELSE
        SELECT COUNT(*) INTO v_fixed
        FROM trapper.data_engine_match_decisions
        WHERE decision_type = 'review_pending'
          AND review_status = 'pending'
          AND resulting_person_id IS NULL;
    END IF;
    RETURN QUERY SELECT 'null_result_reviews'::TEXT, v_fixed,
                        CASE WHEN p_dry_run THEN 0 ELSE v_fixed END, 0;

    -- 1c. Fix merged candidate reviews
    IF NOT p_dry_run THEN
        v_fixed := trapper.fix_merged_candidate_reviews();
    ELSE
        SELECT COUNT(*) INTO v_fixed
        FROM trapper.data_engine_match_decisions
        WHERE decision_type = 'review_pending'
          AND review_status = 'pending'
          AND top_candidate_person_id IN (
              SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
          );
    END IF;
    RETURN QUERY SELECT 'merged_candidate_reviews'::TEXT, v_fixed,
                        CASE WHEN p_dry_run THEN 0 ELSE v_fixed END, 0;

    -- 2. Auto-resolve high-confidence reviews
    SELECT * INTO v_result FROM trapper.auto_resolve_high_confidence_reviews(0.70, p_dry_run);
    RETURN QUERY SELECT 'high_confidence_reviews'::TEXT, v_result.reviews_found,
                        v_result.reviews_merged + v_result.reviews_skipped, v_result.errors;

    -- 3. Clean duplicated names
    SELECT * INTO v_result FROM trapper.clean_duplicated_display_names(p_dry_run);
    RETURN QUERY SELECT 'duplicated_person_names'::TEXT, v_result.names_found,
                        v_result.names_cleaned, 0;

    -- 4. Merge phone duplicates (same name only)
    SELECT * INTO v_result FROM trapper.merge_phone_duplicates(p_dry_run);
    RETURN QUERY SELECT 'phone_duplicates_same_name'::TEXT, v_result.phones_found,
                        v_result.merges_executed, v_result.errors;

    -- 5. Clean garbage names
    SELECT * INTO v_result FROM trapper.clean_garbage_names(p_dry_run);
    RETURN QUERY SELECT 'garbage_person_names'::TEXT, v_result.names_found,
                        v_result.names_cleaned, v_result.errors;

    -- 6. Clean cat garbage names
    SELECT * INTO v_result FROM trapper.clean_cat_garbage_names(p_dry_run);
    RETURN QUERY SELECT 'garbage_cat_names'::TEXT, v_result.names_found,
                        v_result.names_cleaned, 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_data_quality_maintenance IS
'Master function that runs all data quality maintenance tasks.
Use p_dry_run=TRUE to preview all changes without making them.
Call with p_dry_run=FALSE to execute fixes.

Tasks performed:
1. Fix self-referential review decisions
2. Auto-resolve high-confidence pending reviews (0.70+)
3. Clean duplicated person names ("Name Name" patterns)
4. Merge phone duplicates with same name
5. Clean garbage person names (microchips, etc.)
6. Clean garbage cat names (microchips, clinic IDs)';

-- ============================================================================
-- PART 6: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

-- Show what maintenance would do (dry run)
\echo 'Dry run of maintenance tasks:'
SELECT * FROM trapper.run_data_quality_maintenance(TRUE);

\echo ''
\echo 'MIG_577 complete: Data quality maintenance functions created'
\echo 'Available functions:'
\echo '  - run_data_quality_maintenance(dry_run) - Master function for all tasks'
\echo '  - clean_duplicated_display_names(dry_run) - Fix "Name Name" patterns'
\echo '  - auto_resolve_high_confidence_reviews(min_score, dry_run) - Resolve 0.70+ reviews'
\echo '  - fix_self_referential_reviews() - Fix review anomalies'
\echo '  - clean_cat_garbage_names(dry_run) - Clean cat microchip names'
\echo ''
\echo 'Usage: SELECT * FROM trapper.run_data_quality_maintenance(FALSE);'
