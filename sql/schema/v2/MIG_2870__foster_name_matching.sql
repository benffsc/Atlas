-- MIG_2870: Name-based foster matching for cats without microchips (FFS-265)
--
-- MIG_2865 matched 275 of 2,748 FFSC foster cats via microchip.
-- 1,595 cats have no microchip and 612 have microchips not in ShelterLuv.
--
-- Discovery: ClinicHQ cat names encode foster parent last name in parentheses:
--   "Shelby (Johnson)", "Coco Puff (Felder)", "Herbie (Charleston)"
-- 1,531 of 1,595 no-microchip cats have this pattern.
--
-- Strategy:
-- 1. Extract foster last name from cat name parentheses
-- 2. Match to known foster persons (VH verified + SL event fosters)
-- 3. For unknown fosters, resolve via SL person records (unique last name only)
-- 4. ONLY match when exactly ONE foster person has that last name (safety)
-- 5. Skip ambiguous names (multiple persons, e.g., Johnson with 8 SL persons)
--
-- Cross-referenced against:
-- - VolunteerHub "Approved Foster Parent" / "Approved Forever Foster" groups (95 persons)
-- - ShelterLuv person_cat foster links (75 persons from event processing)
-- - ShelterLuv person records (3,694 persons with email)
--
-- Safety: Uses staging table for auditability. All matches logged. No existing data modified.

BEGIN;

-- =============================================================================
-- Step 1: Add name_match columns to staging table for tracking
-- =============================================================================

ALTER TABLE ops.ffsc_foster_cross_match
  ADD COLUMN IF NOT EXISTS extracted_foster_name TEXT,
  ADD COLUMN IF NOT EXISTS name_match_source TEXT;  -- 'vh_verified', 'sl_event_foster', 'sl_person_unique'

-- =============================================================================
-- Step 2: Extract foster parent name from cat name parentheses
-- =============================================================================

UPDATE ops.ffsc_foster_cross_match fcm
SET extracted_foster_name = LOWER(TRIM((REGEXP_MATCH(c.name, '\(([^)]+)\)'))[1]))
FROM sot.cats c
WHERE c.cat_id = fcm.cat_id
  AND c.name ~ '\([^)]+\)'
  AND fcm.match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
  AND fcm.extracted_foster_name IS NULL;

-- =============================================================================
-- Step 3: Build lookup of known foster persons with unique last names
-- Combines VH verified fosters + SL event-based foster persons.
-- Only includes names with exactly ONE matching person.
-- =============================================================================

DO $$
DECLARE
  v_record RECORD;
  v_person_id UUID;
  v_link_id UUID;
  v_count INT := 0;
  v_skipped INT := 0;
  v_new_persons INT := 0;
  v_ambiguous INT := 0;
BEGIN

  -- -----------------------------------------------------------------
  -- Phase A: Match to KNOWN foster persons (VH + SL event fosters)
  -- Only when exactly one known foster has that last name.
  -- -----------------------------------------------------------------

  CREATE TEMP TABLE tmp_known_fosters AS
  SELECT DISTINCT p.person_id, LOWER(p.last_name) AS last_name, p.first_name
  FROM sot.people p
  WHERE p.merged_into_person_id IS NULL
    AND (
      EXISTS (SELECT 1 FROM ops.volunteer_roles vr
              WHERE vr.person_id = p.person_id AND vr.role_type = 'foster')
      OR EXISTS (SELECT 1 FROM sot.person_cat pc
                 WHERE pc.person_id = p.person_id AND pc.relationship_type = 'foster')
    );

  -- Filter to unique names only
  CREATE TEMP TABLE tmp_unique_known_fosters AS
  SELECT last_name, (array_agg(person_id))[1] AS person_id, (array_agg(first_name))[1] AS first_name
  FROM tmp_known_fosters
  GROUP BY last_name
  HAVING COUNT(DISTINCT person_id) = 1;

  RAISE NOTICE 'Phase A: % known fosters with unique last names',
    (SELECT COUNT(*) FROM tmp_unique_known_fosters);

  FOR v_record IN
    SELECT fcm.id, fcm.cat_id, fcm.extracted_foster_name, ukf.person_id
    FROM ops.ffsc_foster_cross_match fcm
    JOIN tmp_unique_known_fosters ukf ON ukf.last_name = fcm.extracted_foster_name
    WHERE fcm.match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
      AND fcm.extracted_foster_name IS NOT NULL
      AND fcm.extracted_foster_name <> 'ffsc'  -- skip org name
  LOOP
    BEGIN
      v_link_id := sot.link_person_to_cat(
        v_record.person_id,
        v_record.cat_id,
        'foster',
        'cross_system_match',
        'shelterluv',
        NULL,  -- source_table
        NULL,  -- evidence_detail
        0.6    -- confidence: VH/SL verified foster, name pattern match
      );

      IF v_link_id IS NOT NULL THEN
        UPDATE ops.ffsc_foster_cross_match
        SET foster_person_id = v_record.person_id,
            person_cat_link_id = v_link_id,
            match_status = 'name_matched',
            name_match_source = 'known_foster'
        WHERE id = v_record.id;
        v_count := v_count + 1;
      ELSE
        -- link_person_to_cat returned NULL (conflict)
        UPDATE ops.ffsc_foster_cross_match
        SET foster_person_id = v_record.person_id,
            match_status = 'name_matched',
            name_match_source = 'known_foster'
        WHERE id = v_record.id;
        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Phase A skip cat %: %', v_record.cat_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Phase A: Matched % cats to known fosters (% skipped)', v_count, v_skipped;

  -- -----------------------------------------------------------------
  -- Phase B: Match remaining to SL person records (unique last name)
  -- For foster parent names not in known fosters but with exactly
  -- ONE SL person having that last name + email.
  -- Uses find_or_create_person() to resolve/create the person.
  -- -----------------------------------------------------------------

  CREATE TEMP TABLE tmp_sl_unique_persons AS
  SELECT last_name, MIN(email) AS email, MIN(first_name) AS first_name, MIN(sl_last) AS orig_last_name
  FROM (
    SELECT DISTINCT ON (source_record_id)
      LOWER(payload->>'Lastname') AS last_name,
      payload->>'Lastname' AS sl_last,
      payload->>'Firstname' AS first_name,
      payload->>'Email' AS email,
      source_record_id
    FROM source.shelterluv_raw
    WHERE record_type = 'person'
      AND payload->>'Email' IS NOT NULL
      AND TRIM(payload->>'Email') <> ''
    ORDER BY source_record_id, fetched_at DESC
  ) sub
  GROUP BY last_name
  HAVING COUNT(DISTINCT source_record_id) = 1;

  -- Remove names already handled by Phase A
  DELETE FROM tmp_sl_unique_persons
  WHERE last_name IN (SELECT last_name FROM tmp_unique_known_fosters);

  RAISE NOTICE 'Phase B: % SL persons with unique last names (after filtering known fosters)',
    (SELECT COUNT(*) FROM tmp_sl_unique_persons);

  v_count := 0;
  v_skipped := 0;

  FOR v_record IN
    SELECT fcm.id, fcm.cat_id, fcm.extracted_foster_name,
           slp.email, slp.first_name, slp.orig_last_name
    FROM ops.ffsc_foster_cross_match fcm
    JOIN tmp_sl_unique_persons slp ON slp.last_name = fcm.extracted_foster_name
    WHERE fcm.match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
      AND fcm.extracted_foster_name IS NOT NULL
      AND fcm.extracted_foster_name <> 'ffsc'
  LOOP
    BEGIN
      -- Resolve person via Data Engine
      v_person_id := sot.find_or_create_person(
        v_record.email,
        NULL,
        v_record.first_name,
        v_record.orig_last_name,
        NULL,
        'shelterluv'
      );

      IF v_person_id IS NOT NULL THEN
        v_link_id := sot.link_person_to_cat(
          v_person_id,
          v_record.cat_id,
          'foster',
          'cross_system_match',
          'shelterluv',
          NULL,  -- source_table
          NULL,  -- evidence_detail
          0.4    -- confidence: SL person name match only, not VH-verified
        );

        UPDATE ops.ffsc_foster_cross_match
        SET foster_person_id = v_person_id,
            foster_email = v_record.email,
            foster_first_name = v_record.first_name,
            foster_last_name = v_record.orig_last_name,
            person_cat_link_id = v_link_id,
            match_status = 'name_matched',
            name_match_source = 'sl_person_unique'
        WHERE id = v_record.id;

        v_count := v_count + 1;
        v_new_persons := v_new_persons + 1;
      ELSE
        UPDATE ops.ffsc_foster_cross_match
        SET match_status = 'name_not_resolved'
        WHERE id = v_record.id;
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'Phase B skip cat %: %', v_record.cat_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Phase B: Matched % cats via SL person name (% skipped)', v_count, v_skipped;

  -- -----------------------------------------------------------------
  -- Phase C: Count remaining unmatched for reporting
  -- -----------------------------------------------------------------

  SELECT COUNT(*) INTO v_ambiguous
  FROM ops.ffsc_foster_cross_match
  WHERE match_status IN ('no_microchip', 'no_sl_match', 'no_foster_name', 'no_foster_email')
    AND extracted_foster_name IS NOT NULL;

  RAISE NOTICE 'Remaining unmatched (ambiguous or no SL person): %', v_ambiguous;

  -- Cleanup temp tables
  DROP TABLE tmp_known_fosters;
  DROP TABLE tmp_unique_known_fosters;
  DROP TABLE tmp_sl_unique_persons;

END $$;

-- =============================================================================
-- Step 4: Summary
-- =============================================================================

DO $$
DECLARE
  v_summary RECORD;
BEGIN
  FOR v_summary IN
    SELECT match_status, name_match_source, COUNT(*) AS cnt
    FROM ops.ffsc_foster_cross_match
    GROUP BY match_status, name_match_source
    ORDER BY cnt DESC
  LOOP
    RAISE NOTICE '  % (source: %): %', v_summary.match_status,
      COALESCE(v_summary.name_match_source, '-'), v_summary.cnt;
  END LOOP;

  RAISE NOTICE '---';
  RAISE NOTICE 'Total foster person_cat links: %',
    (SELECT COUNT(*) FROM sot.person_cat WHERE relationship_type = 'foster');
  RAISE NOTICE 'Unique foster persons: %',
    (SELECT COUNT(DISTINCT person_id) FROM sot.person_cat WHERE relationship_type = 'foster');
  RAISE NOTICE 'FFSC foster cats with any foster link: %',
    (SELECT COUNT(*) FROM ops.ffsc_foster_cross_match
     WHERE match_status IN ('matched', 'name_matched'));
END $$;

COMMIT;
