-- ============================================================================
-- MIG_828: Fix ShelterLuv Foster Matching — Email-First, No Name Guessing
-- ============================================================================
-- WORKING_LEDGER ref: DQ-001 (Holiday Duncan false positive foster/trapper)
--
-- PROBLEM:
-- process_shelterluv_animal() (MIG_469, updated MIG_621) uses name-only
-- matching to assign foster roles:
--
--   SELECT person_id FROM sot_people
--   WHERE display_name ILIKE '%' || v_hold_for || '%' LIMIT 1;
--
-- This violates Atlas's core rule: "Never match by name alone."
-- Result: ClinicHQ clinic clients (like Holiday Duncan) get incorrectly
-- assigned foster roles because their name substring-matches a ShelterLuv
-- "Hold For" field.
--
-- FIX:
-- 1. Replace name-only matching with email-first matching using
--    "Foster Person Email" field (ShelterLuv provides it).
-- 2. If no email match, log to shelterluv_unmatched_fosters queue
--    for manual staff review instead of guessing by name.
-- 3. Create audit of existing name-only foster assignments.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_828: Fix ShelterLuv Foster Matching'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: Create queue table for unmatched foster holds
-- ============================================================================

\echo 'Step 1: Creating shelterluv_unmatched_fosters queue table...'

CREATE TABLE IF NOT EXISTS trapper.shelterluv_unmatched_fosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staged_record_id UUID REFERENCES trapper.staged_records(id),
  hold_for_name TEXT NOT NULL,
  foster_email TEXT,
  foster_person_name TEXT,
  cat_id UUID REFERENCES trapper.sot_cats(cat_id),
  cat_name TEXT,
  shelterluv_animal_id TEXT,
  match_attempt TEXT NOT NULL DEFAULT 'no_email',
  -- 'no_email' = ShelterLuv record had no Foster Person Email
  -- 'email_not_found' = Had email but no matching person_identifier
  -- 'name_only_legacy' = Pre-MIG_828 name-only match (flagged for review)
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_person_id UUID REFERENCES trapper.sot_people(person_id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_fosters_unresolved
  ON trapper.shelterluv_unmatched_fosters (created_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE trapper.shelterluv_unmatched_fosters IS
'Queue for ShelterLuv foster holds that could not be matched by email.
Staff can manually resolve these by linking to the correct person.
Created by MIG_828 to replace unsafe name-only matching.';

\echo 'Queue table created.'

-- ============================================================================
-- Step 2: Pre-fix audit — identify existing name-only foster assignments
-- ============================================================================

\echo ''
\echo 'Step 2: Auditing existing ShelterLuv foster role assignments...'

\echo ''
\echo 'People with ShelterLuv-sourced foster roles:'

SELECT
  pr.person_id,
  sp.display_name,
  pr.role_status,
  pr.source_system,
  pr.created_at::date AS role_created,
  EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = pr.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'shelterluv'
  ) AS has_shelterluv_email,
  EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = pr.person_id
      AND pr2.role = 'volunteer'
      AND pr2.role_status = 'active'
  ) AS has_volunteer_role
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role = 'foster'
  AND pr.source_system = 'shelterluv'
  AND sp.merged_into_person_id IS NULL
ORDER BY sp.display_name;

-- ============================================================================
-- Step 3: Replace process_shelterluv_animal with email-first matching
-- ============================================================================

\echo ''
\echo 'Step 3: Replacing process_shelterluv_animal with safe matching...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_animal(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_cat_id UUID;
  v_microchip TEXT;
  v_animal_name TEXT;
  v_sex TEXT;
  v_breed TEXT;
  v_primary_color TEXT;
  v_secondary_color TEXT;
  v_altered_status TEXT;
  v_status TEXT;
  v_hold_reason TEXT;
  v_hold_for TEXT;
  v_foster_person_id UUID;
  v_foster_email TEXT;
  v_foster_person_name TEXT;
  v_is_foster BOOLEAN := false;
  v_fields_recorded INT := 0;
  v_shelterluv_id TEXT;
  v_match_method TEXT := NULL;
BEGIN
  -- Get the staged record
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staged record not found');
  END IF;

  -- Extract cat fields
  v_microchip := COALESCE(
    v_record.payload->>'Microchip Number',
    v_record.payload->>'Microchip'
  );

  -- Handle scientific notation in microchip
  IF v_microchip ~ '^[0-9.]+E\+[0-9]+$' THEN
    v_microchip := TRIM(TO_CHAR(v_microchip::NUMERIC, '999999999999999'));
  END IF;

  v_animal_name := COALESCE(
    v_record.payload->>'Name',
    v_record.payload->>'Animal Name'
  );

  v_sex := v_record.payload->>'Sex';
  v_breed := v_record.payload->>'Breed';
  v_primary_color := v_record.payload->>'Color';
  v_secondary_color := v_record.payload->>'Secondary Color';
  v_altered_status := CASE
    WHEN (v_record.payload->>'Altered')::boolean = true THEN 'altered'
    WHEN (v_record.payload->>'Altered')::boolean = false THEN 'intact'
    ELSE NULL
  END;
  v_status := v_record.payload->>'Status';
  v_hold_reason := v_record.payload->>'Hold Reason';
  v_hold_for := v_record.payload->>'Hold For';
  v_shelterluv_id := v_record.payload->>'Internal-ID';

  -- Extract foster person email and name from ShelterLuv fields
  v_foster_email := NULLIF(TRIM(v_record.payload->>'Foster Person Email'), '');
  v_foster_person_name := NULLIF(TRIM(v_record.payload->>'Foster Person Name'), '');

  -- Detect foster from status/hold fields
  v_is_foster := (
    v_status ILIKE '%foster%'
    OR v_hold_reason ILIKE '%foster%'
    OR v_hold_for IS NOT NULL AND v_hold_for != ''
  );

  -- Find or create cat by microchip
  IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 9 THEN
    v_cat_id := trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_animal_name,
      p_sex := v_sex,
      p_breed := v_breed,
      p_source_system := 'shelterluv'
    );

    -- Add ShelterLuv ID as identifier if available
    IF v_shelterluv_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'shelterluv_id', v_shelterluv_id, 'shelterluv')
      ON CONFLICT (cat_id, id_type, id_value) DO NOTHING;
    END IF;

    -- Record field sources for multi-source transparency (MIG_620)
    v_fields_recorded := trapper.record_cat_field_sources_batch(
      p_cat_id := v_cat_id,
      p_source_system := 'shelterluv',
      p_source_record_id := v_shelterluv_id,
      p_name := v_animal_name,
      p_breed := v_breed,
      p_sex := v_sex,
      p_primary_color := v_primary_color,
      p_secondary_color := v_secondary_color,
      p_altered_status := v_altered_status
    );

  ELSE
    -- No microchip - try to find by ShelterLuv ID
    IF v_shelterluv_id IS NOT NULL THEN
      SELECT ci.cat_id INTO v_cat_id
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_id'
        AND ci.id_value = v_shelterluv_id;
    END IF;
  END IF;

  -- ================================================================
  -- FOSTER MATCHING — EMAIL-FIRST (MIG_828 fix)
  -- ================================================================
  -- OLD (vulnerable): name-only ILIKE matching against sot_people
  -- NEW (safe): email-first via person_identifiers, queue if no match
  -- ================================================================

  IF v_is_foster AND (v_hold_for IS NOT NULL OR v_foster_email IS NOT NULL) THEN

    -- Strategy 1: Match by Foster Person Email (HIGH confidence)
    IF v_foster_email IS NOT NULL THEN
      SELECT pi.person_id INTO v_foster_person_id
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = LOWER(v_foster_email)
        AND sp.merged_into_person_id IS NULL
      LIMIT 1;

      IF v_foster_person_id IS NOT NULL THEN
        v_match_method := 'email';
      END IF;
    END IF;

    -- Strategy 2: If email didn't match, try phone from foster person fields
    -- (ShelterLuv People records may have phone linked via Foster Person ID)
    -- For now, skip to queue — phone matching would require additional lookup

    -- If matched by email, create foster role and relationship
    IF v_foster_person_id IS NOT NULL AND v_cat_id IS NOT NULL THEN
      -- Assign foster role (high confidence — email-verified)
      PERFORM trapper.assign_person_role(v_foster_person_id, 'foster', 'shelterluv');

      -- Create fosterer relationship to cat
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      ) VALUES (
        v_foster_person_id, v_cat_id, 'fosterer', 'high',
        'shelterluv', 'animals'
      ) ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;

    ELSE
      -- NO MATCH: Queue for manual review instead of guessing by name
      INSERT INTO trapper.shelterluv_unmatched_fosters (
        staged_record_id,
        hold_for_name,
        foster_email,
        foster_person_name,
        cat_id,
        cat_name,
        shelterluv_animal_id,
        match_attempt
      ) VALUES (
        p_staged_record_id,
        COALESCE(v_hold_for, v_foster_person_name, 'unknown'),
        v_foster_email,
        v_foster_person_name,
        v_cat_id,
        v_animal_name,
        v_shelterluv_id,
        CASE
          WHEN v_foster_email IS NULL THEN 'no_email'
          ELSE 'email_not_found'
        END
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Mark as processed
  UPDATE trapper.staged_records
  SET is_processed = true,
      processed_at = NOW(),
      processor_name = 'process_shelterluv_animal',
      resulting_entity_type = CASE WHEN v_cat_id IS NOT NULL THEN 'cat' ELSE NULL END,
      resulting_entity_id = v_cat_id
  WHERE id = p_staged_record_id;

  RETURN jsonb_build_object(
    'success', true,
    'cat_id', v_cat_id,
    'is_foster', v_is_foster,
    'foster_person_id', v_foster_person_id,
    'foster_match_method', v_match_method,
    'fields_recorded', v_fields_recorded
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_animal IS
'Unified Data Engine processor for ShelterLuv animal records.
Creates cats via microchip, detects foster status, creates foster relationships.
MIG_828: Uses email-first matching for fosters (never name-only).
Unmatched fosters queued in shelterluv_unmatched_fosters for manual review.';

-- ============================================================================
-- Step 4: Flag existing name-only foster assignments for review
-- ============================================================================

\echo ''
\echo 'Step 4: Flagging existing name-only foster assignments for review...'

-- People with ShelterLuv foster roles who do NOT have a ShelterLuv email
-- in person_identifiers are likely name-only matches
INSERT INTO trapper.shelterluv_unmatched_fosters (
  hold_for_name,
  foster_email,
  match_attempt,
  resolved_person_id
)
SELECT
  sp.display_name,
  (
    SELECT pi.id_value_norm
    FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
    LIMIT 1
  ),
  'name_only_legacy',
  sp.person_id
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.role = 'foster'
  AND pr.source_system = 'shelterluv'
  AND sp.merged_into_person_id IS NULL
  -- Only flag if they DON'T have a shelterluv-sourced email
  -- (meaning they were likely matched by name, not email)
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = sp.person_id
      AND pi.id_type = 'email'
      AND pi.source_system = 'shelterluv'
  )
  -- And they don't have a volunteer role (business rule violation signal)
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = sp.person_id
      AND pr2.role = 'volunteer'
      AND pr2.role_status = 'active'
  )
ON CONFLICT DO NOTHING;

\echo 'Legacy name-only matches flagged for review.'

-- ============================================================================
-- Step 5: Verification
-- ============================================================================

\echo ''
\echo 'Step 5: Verification...'

\echo ''
\echo 'Unmatched fosters queue:'
SELECT match_attempt, COUNT(*) AS count
FROM trapper.shelterluv_unmatched_fosters
WHERE resolved_at IS NULL
GROUP BY match_attempt
ORDER BY match_attempt;

\echo ''
\echo 'Test: process_shelterluv_animal no longer uses name matching'
\echo '(function replaced — name-only ILIKE removed, email-first in place)'

\echo ''
\echo '============================================================'
\echo 'MIG_828 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'CHANGES:'
\echo '  1. Created shelterluv_unmatched_fosters queue table'
\echo '  2. Replaced process_shelterluv_animal foster matching:'
\echo '     OLD: display_name ILIKE name (unsafe name-only match)'
\echo '     NEW: email-first via person_identifiers (safe)'
\echo '  3. Unmatched fosters queued for manual review'
\echo '  4. Flagged legacy name-only matches for audit'
\echo ''
\echo 'CONFIDENCE CHANGE:'
\echo '  Old fosterer relationships: confidence = medium (name guess)'
\echo '  New fosterer relationships: confidence = high (email verified)'
\echo ''
\echo '=== MIG_828 Complete ==='
