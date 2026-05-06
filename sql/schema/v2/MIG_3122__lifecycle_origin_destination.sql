-- MIG_3122: Add origin/destination place tracking to cat lifecycle events
--
-- Currently lifecycle events have a single place_id (ambiguous) and person_id
-- but never resolve the person's address into a place. This means:
-- - 6,966 intake events with 0 place links (origin unknown)
-- - 6,309 adoption events with 0 place links (destination unknown)
-- - 5,256 foster events with 0 place links
--
-- The person's address IS available in source.shelterluv_raw but was never resolved.
--
-- This migration:
-- 1. Adds origin/destination columns to cat_lifecycle_events
-- 2. Backfills from ShelterLuv person addresses
-- 3. Creates a view for Tippy to query cat journeys

-- ============================================================================
-- Step 1: Add columns
-- ============================================================================

ALTER TABLE sot.cat_lifecycle_events
  ADD COLUMN IF NOT EXISTS origin_place_id UUID REFERENCES sot.places(place_id),
  ADD COLUMN IF NOT EXISTS destination_place_id UUID REFERENCES sot.places(place_id),
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS destination_address TEXT;

COMMENT ON COLUMN sot.cat_lifecycle_events.origin_place_id IS 'Where the cat came FROM (intake events: field origin, foster_end: foster home)';
COMMENT ON COLUMN sot.cat_lifecycle_events.destination_place_id IS 'Where the cat went TO (adoption: adopter home, foster: foster home, relocation: barn)';
COMMENT ON COLUMN sot.cat_lifecycle_events.origin_address IS 'Raw address when place could not be resolved';
COMMENT ON COLUMN sot.cat_lifecycle_events.destination_address IS 'Raw address when place could not be resolved';

CREATE INDEX IF NOT EXISTS idx_cle_origin_place ON sot.cat_lifecycle_events(origin_place_id) WHERE origin_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cle_destination_place ON sot.cat_lifecycle_events(destination_place_id) WHERE destination_place_id IS NOT NULL;

-- ============================================================================
-- Step 2: Backfill from ShelterLuv person addresses
-- ============================================================================

-- For INTAKE events: the associated person's address = ORIGIN (where the cat was found/lived)
-- For OUTCOME events: the associated person's address = DESTINATION (adopter/foster/relocation)

-- Helper: build address from ShelterLuv person payload
CREATE OR REPLACE FUNCTION ops.sl_person_address(p_sl_person_id TEXT)
RETURNS TABLE(address TEXT, place_id UUID)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_street TEXT;
  v_city TEXT;
  v_state TEXT;
  v_zip TEXT;
  v_full_address TEXT;
  v_place_id UUID;
BEGIN
  -- Get address from staged_records (more complete than shelterluv_raw)
  SELECT
    NULLIF(TRIM(sr.payload->>'Street'), ''),
    NULLIF(TRIM(sr.payload->>'City'), ''),
    NULLIF(TRIM(sr.payload->>'State'), ''),
    NULLIF(TRIM(sr.payload->>'Zip'), '')
  INTO v_street, v_city, v_state, v_zip
  FROM ops.staged_records sr
  WHERE sr.source_system = 'shelterluv'
    AND sr.source_table = 'people'
    AND sr.source_row_id = p_sl_person_id
  ORDER BY sr.updated_at DESC
  LIMIT 1;

  -- Fall back to shelterluv_raw if not in staged_records
  IF v_street IS NULL THEN
    SELECT
      NULLIF(TRIM(sr.payload->>'Street'), ''),
      NULLIF(TRIM(sr.payload->>'City'), ''),
      NULLIF(TRIM(sr.payload->>'State'), ''),
      NULLIF(TRIM(sr.payload->>'Zip'), '')
    INTO v_street, v_city, v_state, v_zip
    FROM source.shelterluv_raw sr
    WHERE sr.record_type = 'person'
      AND sr.source_record_id = p_sl_person_id
    ORDER BY sr.fetched_at DESC
    LIMIT 1;
  END IF;

  IF v_street IS NULL THEN
    RETURN;
  END IF;

  -- Build full address
  v_full_address := v_street;
  IF v_city IS NOT NULL THEN v_full_address := v_full_address || ', ' || v_city; END IF;
  IF v_state IS NOT NULL THEN v_full_address := v_full_address || ', ' || v_state; END IF;
  IF v_zip IS NOT NULL THEN v_full_address := v_full_address || ' ' || v_zip; END IF;

  -- Try to resolve to an existing place (don't create new ones during backfill)
  SELECT p.place_id INTO v_place_id
  FROM sot.places p
  WHERE p.merged_into_place_id IS NULL
    AND (p.formatted_address ILIKE '%' || v_street || '%'
         OR p.display_name ILIKE '%' || v_street || '%')
    AND (v_city IS NULL OR p.formatted_address ILIKE '%' || v_city || '%')
  LIMIT 1;

  address := v_full_address;
  place_id := v_place_id;
  RETURN NEXT;
END;
$$;

-- Backfill intake events: person address = ORIGIN
UPDATE sot.cat_lifecycle_events cle
SET
  origin_address = addr.address,
  origin_place_id = addr.place_id
FROM (
  SELECT cle2.event_id, pa.address, pa.place_id
  FROM sot.cat_lifecycle_events cle2
  -- Get the ShelterLuv person ID from the event's source record
  CROSS JOIN LATERAL (
    SELECT ar->>'Id' AS sl_person_id
    FROM ops.staged_records sr,
         jsonb_array_elements(sr.payload->'AssociatedRecords') ar
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.source_row_id = cle2.source_record_id
      AND ar->>'Type' = 'Person'
    LIMIT 1
  ) person_ref
  -- Get that person's address
  CROSS JOIN LATERAL ops.sl_person_address(person_ref.sl_person_id) pa
  WHERE cle2.event_type = 'intake'
    AND cle2.source_system = 'shelterluv'
    AND cle2.origin_place_id IS NULL
    AND cle2.origin_address IS NULL
) addr
WHERE cle.event_id = addr.event_id;

-- Backfill outcome events: person address = DESTINATION
UPDATE sot.cat_lifecycle_events cle
SET
  destination_address = addr.address,
  destination_place_id = addr.place_id
FROM (
  SELECT cle2.event_id, pa.address, pa.place_id
  FROM sot.cat_lifecycle_events cle2
  CROSS JOIN LATERAL (
    SELECT ar->>'Id' AS sl_person_id
    FROM ops.staged_records sr,
         jsonb_array_elements(sr.payload->'AssociatedRecords') ar
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.source_row_id = cle2.source_record_id
      AND ar->>'Type' = 'Person'
    LIMIT 1
  ) person_ref
  CROSS JOIN LATERAL ops.sl_person_address(person_ref.sl_person_id) pa
  WHERE cle2.event_type IN ('adoption', 'foster_start', 'return_to_field', 'transfer')
    AND cle2.source_system = 'shelterluv'
    AND cle2.destination_place_id IS NULL
    AND cle2.destination_address IS NULL
) addr
WHERE cle.event_id = addr.event_id;

-- For foster_end events: person address = ORIGIN (cat leaving foster home)
UPDATE sot.cat_lifecycle_events cle
SET
  origin_address = addr.address,
  origin_place_id = addr.place_id
FROM (
  SELECT cle2.event_id, pa.address, pa.place_id
  FROM sot.cat_lifecycle_events cle2
  CROSS JOIN LATERAL (
    SELECT ar->>'Id' AS sl_person_id
    FROM ops.staged_records sr,
         jsonb_array_elements(sr.payload->'AssociatedRecords') ar
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.source_row_id = cle2.source_record_id
      AND ar->>'Type' = 'Person'
    LIMIT 1
  ) person_ref
  CROSS JOIN LATERAL ops.sl_person_address(person_ref.sl_person_id) pa
  WHERE cle2.event_type = 'foster_end'
    AND cle2.source_system = 'shelterluv'
    AND cle2.origin_place_id IS NULL
    AND cle2.origin_address IS NULL
) addr
WHERE cle.event_id = addr.event_id;

-- ============================================================================
-- Step 3: Cat journey view for Tippy
-- ============================================================================

CREATE OR REPLACE VIEW sot.v_cat_journey AS
SELECT
  c.cat_id,
  c.display_name AS cat_name,
  c.sex,
  c.altered_status,
  c.is_deceased,

  -- Origin (first intake event)
  intake.event_at AS intake_date,
  intake.event_subtype AS intake_type,
  COALESCE(origin_place.formatted_address, intake.origin_address) AS origin_address,
  intake.origin_place_id,

  -- Current status based on latest event
  latest.event_type AS current_status,
  latest.event_subtype AS current_status_detail,
  latest.event_at AS status_date,

  -- Destination (latest non-foster outcome, or foster if still in foster)
  COALESCE(dest_place.formatted_address, latest.destination_address) AS destination_address,
  latest.destination_place_id,
  latest.person_id AS current_person_id,
  dest_person.display_name AS current_person_name,

  -- Foster info (if currently in foster)
  CASE WHEN c.shelterluv_animal_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM source.shelterluv_raw sr
      WHERE sr.record_type = 'animal'
        AND sr.source_record_id = c.shelterluv_animal_id::text
        AND (sr.payload->>'InFoster')::boolean = true
    )
  THEN TRUE ELSE FALSE END AS is_in_foster,

  -- Journey summary (for Tippy narrative)
  CASE
    WHEN latest.event_type = 'foster_start' THEN 'In foster care'
    WHEN latest.event_type = 'adoption' AND latest.event_subtype = 'Relocation' THEN 'Relocated (barn cat program)'
    WHEN latest.event_type = 'adoption' AND latest.event_subtype = 'Foster Home Adoption' THEN 'Adopted by foster parent'
    WHEN latest.event_type = 'adoption' THEN 'Adopted'
    WHEN latest.event_type = 'return_to_field' THEN 'Returned to field (TNR)'
    WHEN latest.event_type = 'transfer' THEN 'Transferred to partner org'
    WHEN latest.event_type = 'mortality' THEN 'Deceased'
    WHEN latest.event_type = 'intake' THEN 'In FFSC custody'
    ELSE 'Unknown'
  END AS journey_status

FROM sot.cats c
-- First intake = origin
LEFT JOIN LATERAL (
  SELECT event_at, event_subtype, origin_place_id, origin_address
  FROM sot.cat_lifecycle_events
  WHERE cat_id = c.cat_id AND event_type = 'intake'
  ORDER BY event_at ASC
  LIMIT 1
) intake ON true
LEFT JOIN sot.places origin_place ON origin_place.place_id = intake.origin_place_id

-- Latest event = current status
LEFT JOIN LATERAL (
  SELECT event_type, event_subtype, event_at, person_id,
         destination_place_id, destination_address
  FROM sot.cat_lifecycle_events
  WHERE cat_id = c.cat_id
  ORDER BY event_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN sot.places dest_place ON dest_place.place_id = latest.destination_place_id
LEFT JOIN sot.people dest_person ON dest_person.person_id = latest.person_id AND dest_person.merged_into_person_id IS NULL

WHERE c.merged_into_cat_id IS NULL
  AND c.shelterluv_animal_id IS NOT NULL;

COMMENT ON VIEW sot.v_cat_journey IS 'Cat lifecycle journey: origin → custody → destination. For Tippy narrative synthesis.';

-- ============================================================================
-- Step 4: Verify
-- ============================================================================

DO $$
DECLARE
  v_intake_origins INT;
  v_outcome_destinations INT;
  v_journey_rows INT;
BEGIN
  SELECT COUNT(*) INTO v_intake_origins FROM sot.cat_lifecycle_events WHERE event_type = 'intake' AND (origin_place_id IS NOT NULL OR origin_address IS NOT NULL);
  SELECT COUNT(*) INTO v_outcome_destinations FROM sot.cat_lifecycle_events WHERE event_type IN ('adoption','foster_start','return_to_field') AND (destination_place_id IS NOT NULL OR destination_address IS NOT NULL);
  SELECT COUNT(*) INTO v_journey_rows FROM sot.v_cat_journey;

  RAISE NOTICE 'MIG_3122: % intake events with origin, % outcome events with destination, % cat journeys total', v_intake_origins, v_outcome_destinations, v_journey_rows;
END $$;
