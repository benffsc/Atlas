-- MIG_2837: Backfill Legacy Request Fields from Notes
--
-- ~1,583 Airtable-sourced requests have structured data buried in free-text
-- notes/internal_notes/archive_notes/kitten_notes/urgency_notes columns. This migration parses those notes
-- using regex to backfill 15 structured columns, making legacy requests
-- queryable the same way as new intake submissions.
--
-- Pattern: Follows MIG_2533 COALESCE-based updates — only fills NULL columns.
-- Safety: DRY RUN by default. Must explicitly pass FALSE to write.
--
-- Created: 2026-03-05

\echo ''
\echo '=============================================='
\echo '  MIG_2837: Backfill Legacy Request Fields'
\echo '  from Notes (Airtable Requests)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Create the backfill function
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.backfill_legacy_request_fields(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
  v_rec RECORD;
  v_combined TEXT;
  v_staged_payload JSONB;
  v_match TEXT[];

  -- Extracted values
  v_cat_count INT;
  v_eartip_count INT;
  v_is_being_fed BOOLEAN;
  v_feeding_frequency TEXT;
  v_access_notes TEXT;
  v_has_kittens BOOLEAN;
  v_has_medical BOOLEAN;
  v_medical_desc TEXT;
  v_is_emergency BOOLEAN;
  v_handleability TEXT;
  v_colony_duration TEXT;
  v_dogs_on_site TEXT;
  v_trap_savvy TEXT;
  v_previous_tnr TEXT;

  -- Counters
  v_total INT := 0;
  v_with_notes INT := 0;
  v_updated INT := 0;
  v_field_counts JSONB := '{}'::JSONB;
  v_samples JSONB := '[]'::JSONB;
  v_fields_changed TEXT[];
  v_sample_count INT := 0;
BEGIN
  -- Initialize field counters
  v_field_counts := jsonb_build_object(
    'estimated_cat_count', 0,
    'total_cats_reported', 0,
    'eartip_count_observed', 0,
    'is_being_fed', 0,
    'feeding_frequency', 0,
    'access_notes', 0,
    'has_kittens', 0,
    'has_medical_concerns', 0,
    'medical_description', 0,
    'is_emergency', 0,
    'handleability', 0,
    'colony_duration', 0,
    'dogs_on_site', 0,
    'trap_savvy', 0,
    'previous_tnr', 0
  );

  FOR v_rec IN
    SELECT r.request_id, r.notes, r.internal_notes,
           r.archive_notes, r.kitten_notes, r.urgency_notes,
           r.estimated_cat_count, r.total_cats_reported, r.eartip_count_observed,
           r.is_being_fed, r.feeding_frequency, r.access_notes,
           r.has_kittens, r.has_medical_concerns, r.medical_description,
           r.is_emergency, r.handleability, r.colony_duration,
           r.dogs_on_site, r.trap_savvy, r.previous_tnr,
           r.source_record_id
    FROM ops.requests r
    WHERE r.source_system LIKE 'airtable%'
  LOOP
    v_total := v_total + 1;
    v_fields_changed := '{}';

    -- Build combined text from all note fields
    v_combined := LOWER(
      COALESCE(v_rec.notes, '') || ' ' ||
      COALESCE(v_rec.internal_notes, '') || ' ' ||
      COALESCE(v_rec.archive_notes, '') || ' ' ||
      COALESCE(v_rec.kitten_notes, '') || ' ' ||
      COALESCE(v_rec.urgency_notes, '')
    );

    -- Skip if no notes at all
    IF TRIM(v_combined) = '' THEN
      CONTINUE;
    END IF;
    v_with_notes := v_with_notes + 1;

    -- Try to get staged payload for higher-confidence Airtable fields
    v_staged_payload := NULL;
    IF v_rec.source_record_id IS NOT NULL THEN
      SELECT sr.payload INTO v_staged_payload
      FROM ops.staged_records sr
      WHERE sr.source_row_id = v_rec.source_record_id
        AND sr.source_system = 'airtable'
        AND sr.source_table = 'trapping_requests'
      LIMIT 1;
    END IF;

    -- Reset extracted values
    v_cat_count := NULL;
    v_eartip_count := NULL;
    v_is_being_fed := NULL;
    v_feeding_frequency := NULL;
    v_access_notes := NULL;
    v_has_kittens := NULL;
    v_has_medical := NULL;
    v_medical_desc := NULL;
    v_is_emergency := NULL;
    v_handleability := NULL;
    v_colony_duration := NULL;
    v_dogs_on_site := NULL;
    v_trap_savvy := NULL;
    v_previous_tnr := NULL;

    -- =====================================================================
    -- EXTRACTION: Cat count (estimated_cat_count + total_cats_reported)
    -- =====================================================================
    IF v_rec.estimated_cat_count IS NULL THEN
      -- Staged payload first (higher confidence)
      IF v_staged_payload IS NOT NULL THEN
        BEGIN
          v_cat_count := COALESCE(
            NULLIF(v_staged_payload->>'Total Cats to be trapped', '')::INT,
            NULLIF(v_staged_payload->>'Adult Cats', '')::INT
          );
        EXCEPTION WHEN OTHERS THEN
          v_cat_count := NULL;
        END;
      END IF;

      -- Regex fallback on notes
      IF v_cat_count IS NULL THEN
        v_match := regexp_match(v_combined, 'colony of (?:about |approximately )?(\d+)', 'i');
        IF v_match IS NOT NULL THEN v_cat_count := v_match[1]::INT; END IF;
      END IF;
      IF v_cat_count IS NULL THEN
        v_match := regexp_match(v_combined, 'feeds? (?:about )?(\d+)\s*cats?', 'i');
        IF v_match IS NOT NULL THEN v_cat_count := v_match[1]::INT; END IF;
      END IF;
      IF v_cat_count IS NULL THEN
        v_match := regexp_match(v_combined, '(?:about|approximately|around|~)\s?(\d+)\s*cats?', 'i');
        IF v_match IS NOT NULL THEN v_cat_count := v_match[1]::INT; END IF;
      END IF;
      IF v_cat_count IS NULL THEN
        v_match := regexp_match(v_combined, '(\d+)\s*cats?\s*total', 'i');
        IF v_match IS NOT NULL THEN v_cat_count := v_match[1]::INT; END IF;
      END IF;
      IF v_cat_count IS NULL THEN
        v_match := regexp_match(v_combined, '(\d+)\s*(?:feral|stray|outdoor|community)\s*cats?', 'i');
        IF v_match IS NOT NULL THEN v_cat_count := v_match[1]::INT; END IF;
      END IF;

      -- Safety: 1-200 range only
      IF v_cat_count IS NOT NULL AND (v_cat_count < 1 OR v_cat_count > 200) THEN
        v_cat_count := NULL;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: Eartip count
    -- =====================================================================
    IF v_rec.eartip_count_observed IS NULL THEN
      v_match := regexp_match(v_combined, '(\d+)\s*(?:with\s)?ear-?tips?', 'i');
      IF v_match IS NOT NULL THEN v_eartip_count := v_match[1]::INT; END IF;

      IF v_eartip_count IS NULL THEN
        v_match := regexp_match(v_combined, '(\d+)\s*already\s*(?:ear-?)?tipped', 'i');
        IF v_match IS NOT NULL THEN v_eartip_count := v_match[1]::INT; END IF;
      END IF;

      IF v_eartip_count IS NULL THEN
        v_match := regexp_match(v_combined, '(\d+)\s*(?:are |have been )?(?:fixed|altered|spayed|neutered)', 'i');
        IF v_match IS NOT NULL THEN v_eartip_count := v_match[1]::INT; END IF;
      END IF;

      -- Eartip must be <= cat count (if known) and <= 200
      IF v_eartip_count IS NOT NULL THEN
        IF v_eartip_count > 200 OR v_eartip_count < 0 THEN
          v_eartip_count := NULL;
        ELSIF v_cat_count IS NOT NULL AND v_eartip_count > v_cat_count THEN
          v_eartip_count := NULL;
        END IF;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: is_being_fed
    -- =====================================================================
    IF v_rec.is_being_fed IS NULL THEN
      IF v_combined ~* '\m(feeds|feeding|fed at|being fed|food out|puts? out food|leaving food)\M' THEN
        v_is_being_fed := TRUE;
      ELSIF v_combined ~* '\m(not feeding|not fed|no one feeds|nobody feeds|unfed)\M' THEN
        v_is_being_fed := FALSE;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: feeding_frequency → enum (daily, few_times_week, occasionally, rarely)
    -- =====================================================================
    IF v_rec.feeding_frequency IS NULL AND (v_is_being_fed = TRUE OR v_rec.is_being_fed = TRUE) THEN
      IF v_combined ~* '\m(daily|every day|twice a day|feeds?\s+(?:every|each)\s+day|morning and evening)\M' THEN
        v_feeding_frequency := 'daily';
      ELSIF v_combined ~* '\m(few times a week|several times|every other day|a few times)\M' THEN
        v_feeding_frequency := 'few_times_week';
      ELSIF v_combined ~* '\m(occasionally|sometimes|once in a while|now and then|when\s+(?:I|they)\s+can)\M' THEN
        v_feeding_frequency := 'occasionally';
      ELSIF v_combined ~* '\m(rarely|seldom|hardly ever|infrequent)\M' THEN
        v_feeding_frequency := 'rarely';
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: access_notes
    -- =====================================================================
    IF v_rec.access_notes IS NULL THEN
      -- Look for access-related sentences
      v_match := regexp_match(v_combined, '((?:access|gate|enter|parking|drive|call before|call ahead|text before|key|lock|code)[^.!?]{5,120}[.!?])', 'i');
      IF v_match IS NOT NULL THEN
        v_access_notes := INITCAP(TRIM(v_match[1]));
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: has_kittens
    -- =====================================================================
    IF v_rec.has_kittens IS NULL THEN
      -- Staged payload first
      IF v_staged_payload IS NOT NULL
         AND v_staged_payload->>'Kittens Present?' IS NOT NULL
         AND v_staged_payload->>'Kittens Present?' ILIKE '%yes%' THEN
        v_has_kittens := TRUE;
      ELSIF v_staged_payload IS NOT NULL
         AND v_staged_payload->>'Kittens' IS NOT NULL
         AND v_staged_payload->>'Kittens' != '0'
         AND v_staged_payload->>'Kittens' != '' THEN
        v_has_kittens := TRUE;
      END IF;

      -- Regex fallback
      IF v_has_kittens IS NULL AND v_combined ~* '\m(kittens?|litter|babies|baby cats?)\M' THEN
        -- But exclude "no kittens" pattern
        IF v_combined ~* '\m(no kittens|no litter|without kittens)\M' THEN
          v_has_kittens := FALSE;
        ELSE
          v_has_kittens := TRUE;
        END IF;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: has_medical_concerns + medical_description
    -- =====================================================================
    IF v_rec.has_medical_concerns IS NULL THEN
      IF v_combined ~* '\m(injured|sick|limping|abscess|uri|mange|wound|infection|eye infection|upper respiratory|broken|emaciated|frostbite|ringworm|flea|fleas)\M' THEN
        v_has_medical := TRUE;

        -- Extract the sentence containing the medical keyword
        IF v_rec.medical_description IS NULL THEN
          v_match := regexp_match(v_combined, '([^.!?]*\m(?:injured|sick|limping|abscess|uri|mange|wound|infection|eye infection|upper respiratory|broken|emaciated|frostbite|ringworm)\M[^.!?]{0,120}[.!?]?)', 'i');
          IF v_match IS NOT NULL THEN
            v_medical_desc := INITCAP(TRIM(LEFT(v_match[1], 200)));
          END IF;
        END IF;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: is_emergency
    -- =====================================================================
    IF v_rec.is_emergency IS NULL THEN
      IF v_combined ~* '\m(emergency|urgent|hit by car|hbc|attacked|life.?threatening|dying|critical)\M' THEN
        v_is_emergency := TRUE;
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: handleability → enum
    -- =====================================================================
    IF v_rec.handleability IS NULL THEN
      IF v_combined ~* '\m(friendly|tame|lap cat|pet|affectionate|loves people)\M' THEN
        -- Check if mixed colony
        IF v_combined ~* '\m(some friendly|mix of|both friendly and feral|some tame)\M' THEN
          v_handleability := 'some_friendly';
        ELSE
          v_handleability := 'friendly_carrier';
        END IF;
      ELSIF v_combined ~* '\m(feral|wild|cannot touch|can''t touch|untouchable|completely feral|all feral)\M' THEN
        IF v_combined ~* '\m(all feral|completely feral|none are friendly|entirely feral)\M' THEN
          v_handleability := 'all_unhandleable';
        ELSE
          v_handleability := 'unhandleable_trap';
        END IF;
      ELSIF v_combined ~* '\m(shy|skittish|scared|cautious|wary|semi.?feral)\M' THEN
        v_handleability := 'shy_handleable';
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: colony_duration → enum
    -- =====================================================================
    IF v_rec.colony_duration IS NULL THEN
      IF v_combined ~* '\m(few weeks|couple weeks|just started|recently|just showed up|new cats?)\M' THEN
        v_colony_duration := 'under_1_month';
      ELSIF v_combined ~* '\m(few months|couple months|several months|since\s+(?:last\s+)?(?:spring|summer|fall|winter))\M' THEN
        v_colony_duration := '1_to_6_months';
      ELSIF v_combined ~* '\m((?:over\s+)?(?:a\s+)?year|about a year|past year|for years|long time|1\+?\s*year)\M' THEN
        v_colony_duration := '6_to_24_months';
      ELSIF v_combined ~* '\m(several years|many years|2\+?\s*years|3\+?\s*years|5\+?\s*years|10\+?\s*years|decades?|for\s+\d+\s+years)\M' THEN
        v_colony_duration := 'over_2_years';
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: dogs_on_site
    -- =====================================================================
    IF v_rec.dogs_on_site IS NULL THEN
      IF v_combined ~* '\m(dogs? on site|dogs? on property|has dogs?|have dogs?|dogs? in yard|dogs? present)\M' THEN
        v_dogs_on_site := 'yes';
      ELSIF v_combined ~* '\m(no dogs?|no pets?)\M' THEN
        v_dogs_on_site := 'no';
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: trap_savvy
    -- =====================================================================
    IF v_rec.trap_savvy IS NULL THEN
      IF v_combined ~* '\m(trap.?savvy|trap.?shy|trap.?wise|avoid.?traps?|won''t go in trap|learned to avoid)\M' THEN
        v_trap_savvy := 'yes';
      ELSIF v_combined ~* '\m(never trapped|not been trapped|first time trapping|no previous trapping)\M' THEN
        v_trap_savvy := 'no';
      END IF;
    END IF;

    -- =====================================================================
    -- EXTRACTION: previous_tnr
    -- =====================================================================
    IF v_rec.previous_tnr IS NULL THEN
      IF v_combined ~* '\m(previous tnr|previously trapped|tnr.?(?:ed|''d)|been trapped before|prior trapping)\M' THEN
        v_previous_tnr := 'yes';
      ELSIF v_combined ~* '\m(some fixed|some already|partial.?tnr|a few fixed|some spayed|some neutered)\M' THEN
        v_previous_tnr := 'partial';
      ELSIF v_combined ~* '\m(none fixed|no tnr|never been trapped|no previous tnr|never tnr)\M' THEN
        v_previous_tnr := 'no';
      END IF;
    END IF;

    -- =====================================================================
    -- APPLY: Check if anything was extracted
    -- =====================================================================

    -- Track which fields would change
    IF v_cat_count IS NOT NULL AND v_rec.estimated_cat_count IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'estimated_cat_count');
    END IF;
    IF v_cat_count IS NOT NULL AND v_rec.total_cats_reported IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'total_cats_reported');
    END IF;
    IF v_eartip_count IS NOT NULL AND v_rec.eartip_count_observed IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'eartip_count_observed');
    END IF;
    IF v_is_being_fed IS NOT NULL AND v_rec.is_being_fed IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'is_being_fed');
    END IF;
    IF v_feeding_frequency IS NOT NULL AND v_rec.feeding_frequency IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'feeding_frequency');
    END IF;
    IF v_access_notes IS NOT NULL AND v_rec.access_notes IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'access_notes');
    END IF;
    IF v_has_kittens IS NOT NULL AND v_rec.has_kittens IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'has_kittens');
    END IF;
    IF v_has_medical IS NOT NULL AND v_rec.has_medical_concerns IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'has_medical_concerns');
    END IF;
    IF v_medical_desc IS NOT NULL AND v_rec.medical_description IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'medical_description');
    END IF;
    IF v_is_emergency IS NOT NULL AND v_rec.is_emergency IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'is_emergency');
    END IF;
    IF v_handleability IS NOT NULL AND v_rec.handleability IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'handleability');
    END IF;
    IF v_colony_duration IS NOT NULL AND v_rec.colony_duration IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'colony_duration');
    END IF;
    IF v_dogs_on_site IS NOT NULL AND v_rec.dogs_on_site IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'dogs_on_site');
    END IF;
    IF v_trap_savvy IS NOT NULL AND v_rec.trap_savvy IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'trap_savvy');
    END IF;
    IF v_previous_tnr IS NOT NULL AND v_rec.previous_tnr IS NULL THEN
      v_fields_changed := array_append(v_fields_changed, 'previous_tnr');
    END IF;

    -- Skip if nothing to update
    IF array_length(v_fields_changed, 1) IS NULL OR array_length(v_fields_changed, 1) = 0 THEN
      CONTINUE;
    END IF;

    v_updated := v_updated + 1;

    -- Update per-field counters
    FOR i IN 1..array_length(v_fields_changed, 1) LOOP
      v_field_counts := jsonb_set(
        v_field_counts,
        ARRAY[v_fields_changed[i]],
        to_jsonb((v_field_counts->>v_fields_changed[i])::INT + 1)
      );
    END LOOP;

    -- Collect samples (first 10)
    IF v_sample_count < 10 THEN
      v_samples := v_samples || jsonb_build_object(
        'request_id', v_rec.request_id,
        'fields_changed', to_jsonb(v_fields_changed),
        'cat_count', v_cat_count,
        'is_being_fed', v_is_being_fed,
        'has_kittens', v_has_kittens,
        'handleability', v_handleability,
        'colony_duration', v_colony_duration,
        'note_preview', LEFT(TRIM(COALESCE(v_rec.notes, v_rec.internal_notes, v_rec.archive_notes, '')), 120)
      );
      v_sample_count := v_sample_count + 1;
    END IF;

    -- Apply changes (only if not dry run)
    IF NOT p_dry_run THEN
      UPDATE ops.requests
      SET
        estimated_cat_count   = COALESCE(estimated_cat_count,   v_cat_count),
        total_cats_reported   = COALESCE(total_cats_reported,   v_cat_count),
        eartip_count_observed = COALESCE(eartip_count_observed, v_eartip_count),
        is_being_fed          = COALESCE(is_being_fed,          v_is_being_fed),
        feeding_frequency      = COALESCE(feeding_frequency,      v_feeding_frequency),
        access_notes          = COALESCE(access_notes,          v_access_notes),
        has_kittens           = COALESCE(has_kittens,           v_has_kittens),
        has_medical_concerns  = COALESCE(has_medical_concerns,  v_has_medical),
        medical_description   = COALESCE(medical_description,   v_medical_desc),
        is_emergency          = COALESCE(is_emergency,          v_is_emergency),
        handleability         = COALESCE(handleability,         v_handleability),
        colony_duration       = COALESCE(colony_duration,       v_colony_duration),
        dogs_on_site          = COALESCE(dogs_on_site,          v_dogs_on_site),
        trap_savvy            = COALESCE(trap_savvy,            v_trap_savvy),
        previous_tnr          = COALESCE(previous_tnr,          v_previous_tnr),
        updated_at            = NOW()
      WHERE request_id = v_rec.request_id;

      -- Log each field change to entity_edits
      IF v_cat_count IS NOT NULL AND v_rec.estimated_cat_count IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'estimated_cat_count', NULL, v_cat_count::TEXT, 'MIG_2837_note_parser');
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'total_cats_reported', NULL, v_cat_count::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_eartip_count IS NOT NULL AND v_rec.eartip_count_observed IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'eartip_count_observed', NULL, v_eartip_count::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_is_being_fed IS NOT NULL AND v_rec.is_being_fed IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'is_being_fed', NULL, v_is_being_fed::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_feeding_frequency IS NOT NULL AND v_rec.feeding_frequency IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'feeding_frequency', NULL, v_feeding_frequency, 'MIG_2837_note_parser');
      END IF;
      IF v_access_notes IS NOT NULL AND v_rec.access_notes IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'access_notes', NULL, v_access_notes, 'MIG_2837_note_parser');
      END IF;
      IF v_has_kittens IS NOT NULL AND v_rec.has_kittens IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'has_kittens', NULL, v_has_kittens::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_has_medical IS NOT NULL AND v_rec.has_medical_concerns IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'has_medical_concerns', NULL, v_has_medical::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_medical_desc IS NOT NULL AND v_rec.medical_description IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'medical_description', NULL, v_medical_desc, 'MIG_2837_note_parser');
      END IF;
      IF v_is_emergency IS NOT NULL AND v_rec.is_emergency IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'is_emergency', NULL, v_is_emergency::TEXT, 'MIG_2837_note_parser');
      END IF;
      IF v_handleability IS NOT NULL AND v_rec.handleability IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'handleability', NULL, v_handleability, 'MIG_2837_note_parser');
      END IF;
      IF v_colony_duration IS NOT NULL AND v_rec.colony_duration IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'colony_duration', NULL, v_colony_duration, 'MIG_2837_note_parser');
      END IF;
      IF v_dogs_on_site IS NOT NULL AND v_rec.dogs_on_site IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'dogs_on_site', NULL, v_dogs_on_site, 'MIG_2837_note_parser');
      END IF;
      IF v_trap_savvy IS NOT NULL AND v_rec.trap_savvy IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'trap_savvy', NULL, v_trap_savvy, 'MIG_2837_note_parser');
      END IF;
      IF v_previous_tnr IS NOT NULL AND v_rec.previous_tnr IS NULL THEN
        INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
        VALUES ('request', v_rec.request_id, 'previous_tnr', NULL, v_previous_tnr, 'MIG_2837_note_parser');
      END IF;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'total_requests', v_total,
    'requests_with_notes', v_with_notes,
    'requests_updated', v_updated,
    'would_update', v_field_counts,
    'sample_extractions', v_samples
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.backfill_legacy_request_fields(BOOLEAN) IS
'Parse free-text notes/legacy_notes/internal_notes from Airtable-sourced requests
and backfill 15 structured columns. Uses COALESCE pattern — never overwrites non-NULL.
Logs all changes to ops.entity_edits with change_source = MIG_2837_note_parser.
DRY RUN by default. Pass FALSE to apply changes.
MIG_2837, 2026-03-05';

-- ============================================================================
-- 2. Pre-backfill coverage snapshot
-- ============================================================================

\echo ''
\echo '2. Pre-backfill coverage snapshot...'
\echo ''

SELECT
  COUNT(*) AS total_airtable_requests,
  COUNT(*) FILTER (WHERE notes IS NOT NULL OR internal_notes IS NOT NULL OR archive_notes IS NOT NULL OR kitten_notes IS NOT NULL OR urgency_notes IS NOT NULL) AS with_notes,
  COUNT(*) FILTER (WHERE estimated_cat_count IS NOT NULL) AS has_cat_count,
  COUNT(*) FILTER (WHERE eartip_count_observed IS NOT NULL) AS has_eartip,
  COUNT(*) FILTER (WHERE is_being_fed IS NOT NULL) AS has_feeding,
  COUNT(*) FILTER (WHERE has_kittens IS NOT NULL) AS has_kittens,
  COUNT(*) FILTER (WHERE has_medical_concerns IS NOT NULL) AS has_medical,
  COUNT(*) FILTER (WHERE is_emergency IS NOT NULL) AS has_emergency,
  COUNT(*) FILTER (WHERE handleability IS NOT NULL) AS has_handleability,
  COUNT(*) FILTER (WHERE colony_duration IS NOT NULL) AS has_colony_dur,
  COUNT(*) FILTER (WHERE dogs_on_site IS NOT NULL) AS has_dogs,
  COUNT(*) FILTER (WHERE trap_savvy IS NOT NULL) AS has_trap_savvy,
  COUNT(*) FILTER (WHERE previous_tnr IS NOT NULL) AS has_prev_tnr,
  COUNT(*) FILTER (WHERE access_notes IS NOT NULL) AS has_access,
  COUNT(*) FILTER (WHERE feeding_frequency IS NOT NULL) AS has_feed_freq
FROM ops.requests
WHERE source_system LIKE 'airtable%';

-- ============================================================================
-- 3. Dry run
-- ============================================================================

\echo ''
\echo '3. Running DRY RUN...'
\echo ''

SELECT jsonb_pretty(ops.backfill_legacy_request_fields(TRUE));

\echo ''
\echo '=============================================='
\echo '  MIG_2837 Ready'
\echo '=============================================='
\echo ''
\echo 'Review the dry run output above.'
\echo 'To apply changes:'
\echo '  SELECT * FROM ops.backfill_legacy_request_fields(FALSE);'
\echo ''
\echo 'Post-backfill verification:'
\echo '  SELECT COUNT(*) AS total,'
\echo '    COUNT(*) FILTER (WHERE is_being_fed IS NOT NULL) AS feeding,'
\echo '    COUNT(*) FILTER (WHERE has_kittens IS NOT NULL) AS kittens,'
\echo '    COUNT(*) FILTER (WHERE estimated_cat_count IS NOT NULL) AS cat_count,'
\echo '    COUNT(*) FILTER (WHERE handleability IS NOT NULL) AS handleability,'
\echo '    COUNT(*) FILTER (WHERE has_medical_concerns IS NOT NULL) AS medical'
\echo '  FROM ops.requests WHERE source_system LIKE ''airtable%'';'
\echo ''
