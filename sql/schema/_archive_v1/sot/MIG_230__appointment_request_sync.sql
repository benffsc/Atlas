-- MIG_230: Appointment Request Sync Support
--
-- Creates views and functions for syncing appointment requests from Airtable.
-- Philosophy:
--   - People are always saved (salvageable contact info)
--   - Places only created for valid addresses
--   - Garbage data stays in staged_records for audit
--   - "Hydratable" records can be linked later when good data arrives

\echo ''
\echo '=============================================='
\echo 'MIG_230: Appointment Request Sync Support'
\echo '=============================================='
\echo ''

-- ============================================
-- PART 1: View for hydratable records
-- ============================================

\echo 'Creating v_appointment_requests_hydratable...'

CREATE OR REPLACE VIEW trapper.v_appointment_requests_hydratable AS
SELECT
  sr.staged_record_id,
  sr.source_row_id as airtable_record_id,
  sr.payload->>'Name' as name,
  sr.payload->>'Email' as email,
  sr.payload->>'Best phone number to reach you' as phone,
  sr.payload->>'Clean Address' as clean_address,
  sr.payload->>'Clean Address (Cats)' as cats_address_raw,
  sr.payload->>'Status' as contact_status,
  sr.payload->>'Submission Status' as submission_status,
  sr.payload->>'New Submitted' as submitted_at,
  -- Check if we have a linked person
  p.person_id,
  p.display_name as person_name,
  -- Check if person has any place links
  EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = p.person_id
  ) as has_place_link,
  -- Hydration status
  CASE
    WHEN p.person_id IS NULL THEN 'no_person'
    WHEN EXISTS (SELECT 1 FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) THEN 'hydrated'
    ELSE 'awaiting_address'
  END as hydration_status,
  sr.created_at as staged_at,
  sr.updated_at
FROM trapper.staged_records sr
LEFT JOIN trapper.sot_people p ON (
  LOWER(TRIM(p.email)) = LOWER(TRIM(sr.payload->>'Email'))
  AND p.merged_into_person_id IS NULL
)
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'appointment_requests';

COMMENT ON VIEW trapper.v_appointment_requests_hydratable IS
'Shows appointment requests from Airtable with their hydration status.
- no_person: Contact info not salvageable, raw data preserved
- awaiting_address: Person saved but no valid place link yet
- hydrated: Person has valid place link';

-- ============================================
-- PART 2: View for records needing address review
-- ============================================

\echo 'Creating v_appointment_requests_need_address...'

CREATE OR REPLACE VIEW trapper.v_appointment_requests_need_address AS
SELECT
  sr.source_row_id as airtable_record_id,
  sr.payload->>'Name' as name,
  sr.payload->>'Email' as email,
  sr.payload->>'Clean Address' as clean_address,
  sr.payload->>'Clean Address (Cats)' as cats_address,
  sr.payload->>'Your address' as your_address,
  sr.payload->>'Your city' as your_city,
  sr.payload->>'Submission Status' as status,
  -- Try to build a usable address
  trapper.smart_merge_address(
    sr.payload->>'Clean Address',
    sr.payload->>'Clean Address (Cats)',
    sr.payload->>'Your address',
    sr.payload->>'Your city',
    sr.payload->>'Your Zip Code'
  ) as suggested_address,
  sr.created_at
FROM trapper.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'appointment_requests'
  -- Has a person but no valid address
  AND sr.payload->>'Email' IS NOT NULL
  AND TRIM(sr.payload->>'Email') != ''
  AND (
    sr.payload->>'Clean Address' IS NULL
    OR TRIM(sr.payload->>'Clean Address') = ''
    OR LENGTH(TRIM(sr.payload->>'Clean Address')) < 15
  )
ORDER BY sr.created_at DESC;

COMMENT ON VIEW trapper.v_appointment_requests_need_address IS
'Appointment requests with valid contact info but missing/invalid addresses.
Shows suggested_address from smart_merge_address function.
Use for manual review and address correction.';

-- ============================================
-- PART 3: Function to hydrate a person with an address
-- ============================================

\echo 'Creating hydrate_person_with_place...'

CREATE OR REPLACE FUNCTION trapper.hydrate_person_with_place(
  p_person_id UUID,
  p_formatted_address TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_source TEXT DEFAULT 'manual_hydration'
) RETURNS UUID AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Find or create place
  v_place_id := trapper.find_or_create_place_deduped(
    p_formatted_address,
    NULL,
    p_lat,
    p_lng,
    p_source
  );

  IF v_place_id IS NULL THEN
    RAISE EXCEPTION 'Could not create place from address: %', p_formatted_address;
  END IF;

  -- Link person to place
  INSERT INTO trapper.person_place_relationships (
    person_id, place_id, role, confidence, source_system, source_table
  ) VALUES (
    p_person_id, v_place_id, 'resident', 'medium', p_source, 'hydration'
  )
  ON CONFLICT DO NOTHING;

  RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.hydrate_person_with_place IS
'Links a person to a place when a valid address becomes available.
Creates the place if it doesn''t exist, then links.
Used to "hydrate" records that were saved without addresses.';

-- ============================================
-- PART 4: Summary view
-- ============================================

\echo 'Creating v_appointment_requests_summary...'

CREATE OR REPLACE VIEW trapper.v_appointment_requests_summary AS
SELECT
  (SELECT COUNT(*) FROM trapper.staged_records
   WHERE source_system = 'airtable' AND source_table = 'appointment_requests') as total_records,
  (SELECT COUNT(DISTINCT LOWER(TRIM(sr.payload->>'Email')))
   FROM trapper.staged_records sr
   WHERE sr.source_system = 'airtable' AND sr.source_table = 'appointment_requests'
     AND sr.payload->>'Email' IS NOT NULL AND TRIM(sr.payload->>'Email') != '') as unique_emails,
  (SELECT COUNT(*) FROM trapper.v_appointment_requests_hydratable WHERE hydration_status = 'hydrated') as hydrated,
  (SELECT COUNT(*) FROM trapper.v_appointment_requests_hydratable WHERE hydration_status = 'awaiting_address') as awaiting_address,
  (SELECT COUNT(*) FROM trapper.v_appointment_requests_hydratable WHERE hydration_status = 'no_person') as no_person,
  (SELECT COUNT(*) FROM trapper.v_appointment_requests_need_address) as need_address_review;

COMMENT ON VIEW trapper.v_appointment_requests_summary IS
'Summary stats for appointment request sync status.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT * FROM trapper.v_appointment_requests_summary;

\echo ''
\echo 'Sample records needing address review:'
SELECT name, email, clean_address, cats_address, suggested_address
FROM trapper.v_appointment_requests_need_address
LIMIT 5;

\echo ''
\echo 'MIG_230 complete!'
\echo ''
\echo 'New views:'
\echo '  - v_appointment_requests_hydratable: Shows hydration status of all appt requests'
\echo '  - v_appointment_requests_need_address: Records with contact info but bad addresses'
\echo '  - v_appointment_requests_summary: Quick stats'
\echo ''
\echo 'New functions:'
\echo '  - hydrate_person_with_place(person_id, address, lat, lng): Link person to new place'
\echo ''
