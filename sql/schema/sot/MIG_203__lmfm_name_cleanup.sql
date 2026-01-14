-- MIG_203: LMFM Name Cleanup
-- Little Mama Feline Mission is a partner org whose members have "LMFM" prefix in ClinicHQ
-- This migration normalizes these names and links people properly
--
-- Pattern: "LMFM John Smith" in first AND last name fields
-- Fix: Extract real name "John Smith", find/create person, link to cats

\echo '=============================================='
\echo 'MIG_203: LMFM Name Cleanup'
\echo '=============================================='

-- ============================================
-- PART 1: Add LMFM to exclusion patterns
-- ============================================

\echo 'Adding LMFM to name normalization rules...'

-- Add as prefix to strip (not reject)
INSERT INTO trapper.identity_name_exclusions (pattern_type, pattern_value, field, reason)
VALUES
  ('prefix', 'lmfm ', 'first', 'Little Mama Feline Mission org prefix - strip when normalizing'),
  ('prefix', 'lmfm ', 'last', 'Little Mama Feline Mission org prefix - strip when normalizing')
ON CONFLICT DO NOTHING;

-- ============================================
-- PART 2: Create helper function to normalize LMFM names
-- ============================================

\echo 'Creating LMFM name normalizer...'

CREATE OR REPLACE FUNCTION trapper.normalize_lmfm_name(p_name TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;

  -- Strip LMFM prefix (case insensitive)
  IF LOWER(p_name) LIKE 'lmfm %' THEN
    RETURN TRIM(SUBSTRING(p_name FROM 6));
  END IF;

  RETURN TRIM(p_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- PART 3: Process LMFM records
-- ============================================

\echo 'Processing LMFM records...'

DO $$
DECLARE
  v_rec RECORD;
  v_person_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_display_name TEXT;
  v_phone_norm TEXT;
  v_existing_person_id UUID;
  v_processed INT := 0;
  v_linked INT := 0;
  v_created INT := 0;
BEGIN
  -- Find all LMFM owner_info records
  FOR v_rec IN
    SELECT DISTINCT
      payload->>'Owner First Name' as raw_first,
      payload->>'Owner Last Name' as raw_last,
      payload->>'Owner Cell Phone' as phone,
      payload->>'Owner Email Address' as email
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
      AND (payload->>'Owner First Name' ILIKE 'lmfm %'
           OR payload->>'Owner Last Name' ILIKE 'lmfm %')
  LOOP
    v_processed := v_processed + 1;

    -- Normalize names
    v_first_name := trapper.normalize_lmfm_name(v_rec.raw_first);
    v_last_name := trapper.normalize_lmfm_name(v_rec.raw_last);

    -- Handle case where both first and last are identical
    IF v_first_name = v_last_name AND v_first_name IS NOT NULL THEN
      -- Split into first and last
      v_display_name := v_first_name;
      DECLARE
        v_parts TEXT[];
      BEGIN
        v_parts := STRING_TO_ARRAY(v_first_name, ' ');
        IF ARRAY_LENGTH(v_parts, 1) >= 2 THEN
          v_first_name := v_parts[1];
          v_last_name := ARRAY_TO_STRING(v_parts[2:], ' ');
        ELSE
          v_last_name := NULL;
        END IF;
      END;
    ELSE
      v_display_name := TRIM(CONCAT_WS(' ', NULLIF(v_first_name, ''), NULLIF(v_last_name, '')));
    END IF;

    -- Normalize phone
    v_phone_norm := trapper.norm_phone_us(v_rec.phone);

    -- Skip if we can't identify the person
    IF v_display_name IS NULL OR v_display_name = '' THEN
      CONTINUE;
    END IF;

    -- Try to find existing person by phone
    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
      SELECT pi.person_id INTO v_existing_person_id
      FROM trapper.person_identifiers pi
      WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
      LIMIT 1;
    END IF;

    -- Try to find by exact name match if no phone match
    IF v_existing_person_id IS NULL THEN
      SELECT p.person_id INTO v_existing_person_id
      FROM trapper.sot_people p
      WHERE LOWER(p.display_name) = LOWER(v_display_name)
        AND p.merged_into_person_id IS NULL
      LIMIT 1;
    END IF;

    IF v_existing_person_id IS NOT NULL THEN
      v_person_id := v_existing_person_id;
      v_linked := v_linked + 1;

      -- Add phone identifier if not exists
      IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
        VALUES (v_person_id, 'phone', v_phone_norm, v_rec.phone, 'clinichq', 'lmfm_cleanup')
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;
    ELSE
      -- Create new person
      INSERT INTO trapper.sot_people (display_name, entity_type, data_source, is_canonical)
      VALUES (v_display_name, 'person', 'clinichq', TRUE)
      RETURNING person_id INTO v_person_id;
      v_created := v_created + 1;

      -- Add phone identifier
      IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table)
        VALUES (v_person_id, 'phone', v_phone_norm, v_rec.phone, 'clinichq', 'lmfm_cleanup')
        ON CONFLICT (id_type, id_value_norm) DO NOTHING;
      END IF;
    END IF;

  END LOOP;

  RAISE NOTICE 'LMFM cleanup: processed %, linked %, created %', v_processed, v_linked, v_created;
END;
$$;

-- ============================================
-- PART 4: Link cats to cleaned up people
-- ============================================

\echo 'Linking cats to LMFM people...'

DO $$
DECLARE
  v_rec RECORD;
  v_person_id UUID;
  v_cat_id UUID;
  v_phone_norm TEXT;
  v_linked INT := 0;
BEGIN
  -- Find cats with LMFM owners that aren't linked
  FOR v_rec IN
    SELECT
      sr.payload->>'Owner First Name' as raw_first,
      sr.payload->>'Owner Cell Phone' as phone,
      sr.payload->>'Microchip' as microchip,
      sr.payload->>'Cat Name' as cat_name
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table IN ('cat_info', 'upcoming_appointments')
      AND (sr.payload->>'Owner First Name' ILIKE 'lmfm %')
      AND sr.payload->>'Microchip' IS NOT NULL
      AND sr.payload->>'Microchip' != ''
  LOOP
    -- Find cat by microchip
    SELECT c.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip' AND ci.id_value = v_rec.microchip
    LIMIT 1;

    IF v_cat_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Find person by phone
    v_phone_norm := trapper.norm_phone_us(v_rec.phone);
    IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 10 THEN
      SELECT pi.person_id INTO v_person_id
      FROM trapper.person_identifiers pi
      WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
      LIMIT 1;
    END IF;

    IF v_person_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Create relationship
    INSERT INTO trapper.person_cat_relationships (person_id, cat_id, relationship_type, confidence, source_system, source_table)
    VALUES (v_person_id, v_cat_id, 'brought_by', 'high', 'clinichq', 'lmfm_cleanup')
    ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING;

    v_linked := v_linked + 1;
  END LOOP;

  RAISE NOTICE 'LMFM cat linking: % cats linked to people', v_linked;
END;
$$;

-- ============================================
-- PART 5: Create organization record for LMFM
-- ============================================

\echo 'Creating LMFM organization record...'

INSERT INTO trapper.organizations (org_name, org_type, notes)
VALUES (
  'Little Mama Feline Mission',
  'rescue',
  'Partner rescue organization. Members have "LMFM" prefix in ClinicHQ records.'
)
ON CONFLICT DO NOTHING;

\echo ''
\echo 'MIG_203 complete!'
\echo ''
\echo 'Summary:'
\echo '  - Added LMFM to name normalization patterns'
\echo '  - Created normalize_lmfm_name() function'
\echo '  - Processed and cleaned LMFM person records'
\echo '  - Linked cats to their LMFM people by phone number'
\echo '  - Created Little Mama Feline Mission organization record'
\echo ''
