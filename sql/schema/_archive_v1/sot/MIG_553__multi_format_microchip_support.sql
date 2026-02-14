-- =====================================================
-- MIG_553: Multi-Format Microchip Support
-- =====================================================
-- Problem: Atlas only extracts 15-digit ISO microchips, but valid formats include:
--   - 15 digit ISO (standard)
--   - 9 digit AVID FriendChip
--   - 10 digit HomeAgain/AVID Euro
--   - 14 digit truncated ISO (data entry error)
--
-- Solution: Create format detection function and update extraction logic.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_553__multi_format_microchip_support.sql
-- =====================================================

\echo '=== MIG_553: Multi-Format Microchip Support ==='
\echo ''

-- ============================================================
-- 1. Add confidence tracking columns to cat_identifiers
-- ============================================================

\echo 'Step 1: Adding format tracking columns to cat_identifiers...'

ALTER TABLE trapper.cat_identifiers
ADD COLUMN IF NOT EXISTS format_notes TEXT,
ADD COLUMN IF NOT EXISTS format_confidence TEXT DEFAULT 'high';

COMMENT ON COLUMN trapper.cat_identifiers.format_notes IS
'Notes about the identifier format (e.g., "AVID 9-digit format", "Likely ISO with 1 missing digit")';

COMMENT ON COLUMN trapper.cat_identifiers.format_confidence IS
'Confidence in identifier format: high (standard), medium (non-standard but valid), low (uncertain)';

-- ============================================================
-- 2. Create the format detection function
-- ============================================================

\echo ''
\echo 'Step 2: Creating detect_microchip_format function...'

CREATE OR REPLACE FUNCTION trapper.detect_microchip_format(p_value TEXT)
RETURNS TABLE (
  cleaned_value TEXT,
  id_type TEXT,
  confidence TEXT,
  notes TEXT
) AS $$
DECLARE
  v_cleaned TEXT;
  v_digits_only TEXT;
  v_len INT;
BEGIN
  -- Return nothing for NULL or empty input
  IF p_value IS NULL OR TRIM(p_value) = '' THEN
    RETURN;
  END IF;

  -- Clean input: remove spaces, dashes, dots, parentheses
  v_cleaned := UPPER(TRIM(REGEXP_REPLACE(p_value, '[\s\.\-\(\)]', '', 'g')));
  v_digits_only := REGEXP_REPLACE(v_cleaned, '[^0-9]', '', 'g');
  v_len := LENGTH(v_digits_only);

  -- Skip if too short to be any valid format
  IF v_len < 9 THEN
    RETURN;
  END IF;

  -- Detect shelter animal IDs (start with A followed by 5-7 digits)
  IF v_cleaned ~ '^A[0-9]{5,7}$' THEN
    RETURN QUERY SELECT v_cleaned, 'shelter_animal_id'::TEXT, 'high'::TEXT,
      'Shelter animal ID format'::TEXT;
    RETURN;
  END IF;

  -- ISO 15-digit standard (most common)
  IF v_len = 15 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip'::TEXT, 'high'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 14-digit truncated ISO (starts with known manufacturer prefixes)
  -- Common prefixes: 981 (ISO), 900 (ISO variant), 941 (Destron), 985 (HomeAgain ISO)
  IF v_len = 14 AND v_digits_only ~ '^(981|900|941|985)[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_truncated'::TEXT, 'medium'::TEXT,
      'Likely ISO chip with 1 missing digit'::TEXT;
    RETURN;
  END IF;

  -- 9-digit AVID format (encrypted proprietary format)
  IF v_len = 9 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_avid'::TEXT, 'high'::TEXT,
      'AVID 9-digit encrypted format'::TEXT;
    RETURN;
  END IF;

  -- 10-digit formats (HomeAgain, AVID Euro, may include hex characters)
  IF v_len = 10 AND v_digits_only ~ '^[0-9]+$' THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_10digit'::TEXT, 'high'::TEXT,
      'HomeAgain/AVID 10-digit format'::TEXT;
    RETURN;
  END IF;

  -- 10-character alphanumeric (HomeAgain with hex)
  IF LENGTH(v_cleaned) = 10 AND v_cleaned ~ '^[0-9A-F]+$' THEN
    RETURN QUERY SELECT v_cleaned, 'microchip_10digit'::TEXT, 'high'::TEXT,
      'HomeAgain 10-character alphanumeric format'::TEXT;
    RETURN;
  END IF;

  -- 11-13 digits: non-standard, flag for review
  IF v_len >= 11 AND v_len <= 13 THEN
    RETURN QUERY SELECT v_digits_only, 'microchip'::TEXT, 'low'::TEXT,
      format('Non-standard format: %s digits - needs review', v_len)::TEXT;
    RETURN;
  END IF;

  -- 14 digits but doesn't start with known prefix
  IF v_len = 14 THEN
    RETURN QUERY SELECT v_digits_only, 'microchip_truncated'::TEXT, 'low'::TEXT,
      'Unknown 14-digit format - may be truncated'::TEXT;
    RETURN;
  END IF;

  -- 16+ digits: likely data entry error with extra digit
  IF v_len > 15 THEN
    RETURN QUERY SELECT v_digits_only, 'microchip'::TEXT, 'low'::TEXT,
      format('Non-standard format: %s digits - possible extra digit', v_len)::TEXT;
    RETURN;
  END IF;

  -- Fallback: not a recognizable microchip format
  RETURN;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.detect_microchip_format(TEXT) IS
'Detects microchip format from a string value.
Returns: cleaned_value, id_type, confidence, notes
Supported formats:
  - microchip: Standard ISO 15-digit
  - microchip_avid: AVID 9-digit encrypted
  - microchip_10digit: HomeAgain/AVID 10-digit (numeric or alphanumeric)
  - microchip_truncated: 14-digit (likely ISO with missing digit)
  - shelter_animal_id: Shelter IDs starting with A (not a microchip)';

-- ============================================================
-- 3. Update the extraction function to use format detection
-- ============================================================

\echo ''
\echo 'Step 3: Updating extract_and_link_microchips_from_animal_name function...'

CREATE OR REPLACE FUNCTION trapper.extract_and_link_microchips_from_animal_name()
RETURNS TABLE (
  cats_created INT,
  identifiers_created INT,
  appointments_linked INT
) AS $$
DECLARE
  v_cats_created INT := 0;
  v_identifiers_created INT := 0;
  v_appointments_linked INT := 0;
  r RECORD;
  v_detected RECORD;
  v_new_cat_id UUID;
BEGIN
  -- Step 1: Find potential microchips in Animal Name that don't have cat_identifiers yet
  CREATE TEMP TABLE IF NOT EXISTS _temp_missing_chips (
    raw_value TEXT,
    cleaned_value TEXT,
    id_type TEXT,
    confidence TEXT,
    format_notes TEXT,
    cat_name TEXT,
    sex TEXT,
    PRIMARY KEY (cleaned_value, id_type)
  ) ON COMMIT DROP;

  TRUNCATE _temp_missing_chips;

  -- Extract potential chip values and detect their format
  FOR r IN
    SELECT DISTINCT
      sr.payload->>'Animal Name' as animal_name,
      -- Extract the numeric portion for format detection
      regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g') as raw_value,
      -- Extract cat name (before or after the chip)
      CASE
        WHEN TRIM(regexp_replace(sr.payload->>'Animal Name', '[0-9]{9,}.*', '')) <> ''
        THEN TRIM(regexp_replace(sr.payload->>'Animal Name', '[0-9]{9,}.*', ''))
        WHEN TRIM(regexp_replace(sr.payload->>'Animal Name', '.*[0-9]{9,}\s*', '')) <> ''
        THEN TRIM(regexp_replace(sr.payload->>'Animal Name', '.*[0-9]{9,}\s*', ''))
        ELSE NULL
      END as cat_name,
      MAX(sr.payload->>'Sex') as sex
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
      AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '[0-9]{9,}'  -- At least 9 digits somewhere
    GROUP BY sr.payload->>'Animal Name'
  LOOP
    -- Detect the format
    SELECT * INTO v_detected FROM trapper.detect_microchip_format(r.raw_value);

    -- Skip if not a valid microchip format or already exists
    IF v_detected.id_type IS NOT NULL AND v_detected.id_type != 'shelter_animal_id' THEN
      IF NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_type = v_detected.id_type
        AND ci.id_value = v_detected.cleaned_value
      ) THEN
        INSERT INTO _temp_missing_chips (raw_value, cleaned_value, id_type, confidence, format_notes, cat_name, sex)
        VALUES (r.raw_value, v_detected.cleaned_value, v_detected.id_type, v_detected.confidence, v_detected.notes, r.cat_name, r.sex)
        ON CONFLICT (cleaned_value, id_type) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- Step 2: Create cats for missing chips
  FOR r IN SELECT * FROM _temp_missing_chips
  LOOP
    BEGIN
      v_new_cat_id := gen_random_uuid();

      INSERT INTO trapper.sot_cats (
        cat_id,
        display_name,
        sex,
        data_source,
        created_at
      ) VALUES (
        v_new_cat_id,
        COALESCE(NULLIF(TRIM(r.cat_name), ''), 'Cat-' || r.cleaned_value),
        CASE
          WHEN r.sex ILIKE '%female%' THEN 'female'
          WHEN r.sex ILIKE '%male%' THEN 'male'
          ELSE 'unknown'
        END,
        'clinichq'::trapper.data_source,
        NOW()
      );

      -- Create the identifier with format tracking
      INSERT INTO trapper.cat_identifiers (
        cat_id,
        id_type,
        id_value,
        source_system,
        source_table,
        format_notes,
        format_confidence
      ) VALUES (
        v_new_cat_id,
        r.id_type,
        r.cleaned_value,
        'clinichq',
        'appointment_info',
        r.format_notes,
        r.confidence
      );

      v_cats_created := v_cats_created + 1;
      v_identifiers_created := v_identifiers_created + 1;

    EXCEPTION WHEN unique_violation THEN
      -- Cat or identifier already exists, skip
      NULL;
    END;
  END LOOP;

  -- Step 3: Link appointments to cats via any chip format in Animal Name
  WITH linked AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = ci.cat_id,
        cat_linking_status = 'linked_via_animal_name_auto',
        updated_at = NOW()
    FROM trapper.staged_records sr
    JOIN LATERAL trapper.detect_microchip_format(
      regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g')
    ) detected ON TRUE
    JOIN trapper.cat_identifiers ci ON ci.id_type = detected.id_type
      AND ci.id_value = detected.cleaned_value
    WHERE a.source_row_hash = sr.row_hash
      AND a.source_system = 'clinichq'
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '[0-9]{9,}'
      AND detected.id_type IS NOT NULL
      AND detected.id_type != 'shelter_animal_id'
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_appointments_linked FROM linked;

  DROP TABLE IF EXISTS _temp_missing_chips;

  RETURN QUERY SELECT v_cats_created, v_identifiers_created, v_appointments_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.extract_and_link_microchips_from_animal_name() IS
'Extracts microchips of various formats from the Animal Name field for appointments without cat_id.
Supports: ISO 15-digit, AVID 9-digit, HomeAgain 10-digit, truncated 14-digit.
Creates cats if needed, then links appointments.
Returns counts of cats_created, identifiers_created, appointments_linked.
Call after ClinicHQ ingest or from cron job.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Functions created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('detect_microchip_format', 'extract_and_link_microchips_from_animal_name');

\echo ''
\echo 'New columns on cat_identifiers:'
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'cat_identifiers'
  AND column_name IN ('format_notes', 'format_confidence');

\echo ''
\echo 'Testing format detection:'
SELECT * FROM trapper.detect_microchip_format('981020053524791');  -- ISO 15
SELECT * FROM trapper.detect_microchip_format('98102005352');      -- 11 digits (non-standard)
SELECT * FROM trapper.detect_microchip_format('9810200535247');    -- 14 digits (truncated)
SELECT * FROM trapper.detect_microchip_format('086523606');        -- AVID 9
SELECT * FROM trapper.detect_microchip_format('086.523.606');      -- AVID 9 with dots
SELECT * FROM trapper.detect_microchip_format('0A133F4543');       -- HomeAgain 10 alphanumeric
SELECT * FROM trapper.detect_microchip_format('4737160067');       -- AVID Euro 10
SELECT * FROM trapper.detect_microchip_format('A425849');          -- Shelter ID

\echo ''
\echo '=== MIG_553 Complete ==='
\echo ''
\echo 'NEXT: Run MIG_554 to process existing unlinked appointments with non-standard chips.'
