-- MIG_563: Foster Parent Name Extraction and Linking
--
-- Extracts foster parent last names from cat names like "Asher (Canepa)"
-- and links them to VolunteerHub approved foster parents.
--
-- Dependencies: MIG_560-562 (categories), MIG_907 (link_foster_parent_to_cat)

\echo ''
\echo '========================================================'
\echo 'MIG_563: Foster Parent Name Extraction and Linking'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Extract Foster Parent Name Function
-- ============================================================

\echo 'Creating extract_foster_parent_from_name() function...'

CREATE OR REPLACE FUNCTION trapper.extract_foster_parent_from_name(
  p_animal_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_match TEXT[];
  v_extracted TEXT;
BEGIN
  IF p_animal_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Match pattern: "CatName (FosterLastName)" or "CatName (LastName, FirstName)"
  -- Captures the content inside the last set of parentheses
  v_match := regexp_match(p_animal_name, '\(([^)]+)\)\s*$');

  IF v_match IS NULL OR v_match[1] IS NULL THEN
    RETURN NULL;
  END IF;

  v_extracted := TRIM(v_match[1]);

  -- If comma-separated (e.g., "Canepa, John"), take just the last name part
  IF v_extracted LIKE '%,%' THEN
    v_extracted := TRIM(SPLIT_PART(v_extracted, ',', 1));
  END IF;

  -- Skip if it looks like a note rather than a name
  -- (contains common note words)
  IF v_extracted ~* '\m(feral|stray|community|tnr|foster|rescued|outdoor|pregnant|lactating)\M' THEN
    RETURN NULL;
  END IF;

  -- Skip if too short or too long for a name
  IF LENGTH(v_extracted) < 2 OR LENGTH(v_extracted) > 30 THEN
    RETURN NULL;
  END IF;

  RETURN v_extracted;
END;
$$;

COMMENT ON FUNCTION trapper.extract_foster_parent_from_name IS
'Extracts foster parent last name from cat names like "Asher (Canepa)".
Returns NULL if no valid name found or if the parenthetical content
looks like a note rather than a name.';

-- ============================================================
-- PART 2: Link Foster Parents from Animal Names
-- ============================================================

\echo 'Creating link_foster_parents_from_animal_names() function...'

CREATE OR REPLACE FUNCTION trapper.link_foster_parents_from_animal_names(
  p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
  processed INT,
  linked INT,
  not_found INT,
  already_linked INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_processed INT := 0;
  v_linked INT := 0;
  v_not_found INT := 0;
  v_already_linked INT := 0;
  v_rec RECORD;
  v_foster_name TEXT;
  v_result UUID;
BEGIN
  -- Find foster program appointments with cats that don't have foster relationships
  FOR v_rec IN
    SELECT DISTINCT
      a.appointment_id,
      a.cat_id,
      sr.payload->>'Animal Name' as animal_name
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr
      ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
    WHERE a.appointment_source_category = 'foster_program'
      AND a.cat_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr
        WHERE pcr.cat_id = a.cat_id
          AND pcr.relationship_type = 'foster'
      )
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    -- Extract foster parent name from animal name
    v_foster_name := trapper.extract_foster_parent_from_name(v_rec.animal_name);

    IF v_foster_name IS NOT NULL THEN
      -- Try to link using existing function from MIG_907
      BEGIN
        v_result := trapper.link_foster_parent_to_cat(
          v_foster_name,
          v_rec.cat_id,
          v_rec.appointment_id
        );

        IF v_result IS NOT NULL THEN
          v_linked := v_linked + 1;
        ELSE
          v_not_found := v_not_found + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Function may not exist yet or error
        v_not_found := v_not_found + 1;
      END;
    ELSE
      v_not_found := v_not_found + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_linked, v_not_found, v_already_linked;
END;
$$;

COMMENT ON FUNCTION trapper.link_foster_parents_from_animal_names IS
'Links foster cats to their foster parents by extracting last names from
animal names like "Asher (Canepa)" and matching against VolunteerHub fosters.

Run periodically to link new foster appointments.
Returns: (processed, linked, not_found, already_linked)';

-- ============================================================
-- PART 3: View for Unlinked Foster Cats
-- ============================================================

\echo 'Creating v_unlinked_foster_cats view...'

CREATE OR REPLACE VIEW trapper.v_unlinked_foster_cats AS
SELECT
  a.appointment_id,
  a.appointment_date,
  a.appointment_number,
  c.cat_id,
  c.display_name as cat_name,
  sr.payload->>'Animal Name' as booked_name,
  trapper.extract_foster_parent_from_name(sr.payload->>'Animal Name') as extracted_foster_name
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
  AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.staged_records sr
  ON sr.source_row_id = a.source_record_id
  AND sr.source_system = 'clinichq'
WHERE a.appointment_source_category = 'foster_program'
  AND a.cat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_cat_relationships pcr
    WHERE pcr.cat_id = a.cat_id
      AND pcr.relationship_type = 'foster'
  )
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW trapper.v_unlinked_foster_cats IS
'Foster program cats that have not yet been linked to a foster parent.
Shows the extracted foster name for manual review/matching.';

-- ============================================================
-- PART 4: Run Initial Linking
-- ============================================================

\echo ''
\echo 'Running initial foster parent linking...'

DO $$
DECLARE
  v_result RECORD;
  v_total_linked INT := 0;
  v_iteration INT := 0;
BEGIN
  LOOP
    v_iteration := v_iteration + 1;

    SELECT * INTO v_result
    FROM trapper.link_foster_parents_from_animal_names(500);

    v_total_linked := v_total_linked + v_result.linked;

    RAISE NOTICE 'Iteration %: processed=%, linked=%, not_found=%',
      v_iteration, v_result.processed, v_result.linked, v_result.not_found;

    -- Exit when no more to process
    EXIT WHEN v_result.processed = 0;

    -- Safety limit
    EXIT WHEN v_iteration > 50;
  END LOOP;

  RAISE NOTICE 'Foster linking complete. Total linked: %', v_total_linked;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Foster Parent Linkage Stats:'

SELECT
  'Total foster program cats' as metric,
  COUNT(DISTINCT a.cat_id)::TEXT as value
FROM trapper.sot_appointments a
WHERE a.appointment_source_category = 'foster_program'
  AND a.cat_id IS NOT NULL

UNION ALL

SELECT
  'Linked to foster parent' as metric,
  COUNT(DISTINCT pcr.cat_id)::TEXT as value
FROM trapper.sot_appointments a
JOIN trapper.person_cat_relationships pcr ON pcr.cat_id = a.cat_id
  AND pcr.relationship_type = 'foster'
WHERE a.appointment_source_category = 'foster_program'

UNION ALL

SELECT
  'Unlinked foster cats' as metric,
  COUNT(*)::TEXT as value
FROM trapper.v_unlinked_foster_cats;

\echo ''
\echo 'Sample of unlinked foster cats (for review):'

SELECT * FROM trapper.v_unlinked_foster_cats LIMIT 10;

\echo ''
\echo '========================================================'
\echo 'MIG_563 Complete!'
\echo '========================================================'
\echo ''
