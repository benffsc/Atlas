-- ============================================================================
-- MIG_968: Restore link_cats_to_places() in Entity Linking Pipeline
-- ============================================================================
-- Problem: MIG_957 removed link_cats_to_places() from the pipeline, leaving
-- adopted/fostered cats without cat_place_relationships. This function was
-- fixed in MIG_889 with LIMIT 1 per person, but never re-added.
--
-- Root Cause of Data Pollution (DQ_019):
--   1. MIG_555 was a one-time backfill with buggy pattern (ALL addresses)
--   2. link_cats_to_places() was fixed but removed from pipeline
--
-- Solution:
--   1. Add link_cats_to_places() back to run_all_entity_linking() as Step 8
--   2. Add alert trigger to detect future pollution (> 5 links of same type)
--   3. Add monitoring view for pollution detection
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_968: Restore link_cats_to_places() in Entity Linking Pipeline'
\echo '=============================================================================='
\echo ''

-- ============================================================================
-- PHASE 1: PRE-FIX DIAGNOSTIC
-- ============================================================================

\echo 'PHASE 1: PRE-FIX DIAGNOSTIC'
\echo ''

\echo '1a. Cats with adopter relationships but NO cat-place links:'

SELECT COUNT(DISTINCT pcr.cat_id) AS cats_missing_place_links
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'adopter'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = pcr.cat_id
  );

\echo ''
\echo '1b. Current pipeline steps (from run_all_entity_linking):'
\echo '    Steps 1-7 exist, Step 8 (link_cats_to_places) is MISSING'
\echo ''

-- ============================================================================
-- PHASE 2: UPDATE run_all_entity_linking() WITH STEP 8
-- ============================================================================

\echo 'PHASE 2: Adding Step 8 (link_cats_to_places) to pipeline...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
  v_rec RECORD;
BEGIN
  -- Step 1: Link appointments to owners via email
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_to_owners(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Link appointments via phone
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_phone()
    )
    SELECT INTO v_count (linked->>'appointments_linked')::INT FROM linked;
    operation := 'link_appointments_via_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Link appointments via safe phone (uniquely identifying)
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_safe_phone(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_via_safe_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_safe_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link partner org appointments
  BEGIN
    WITH linked AS (
      SELECT trapper.link_partner_org_appointments(2000) as appointments_linked
    )
    SELECT INTO v_count (SELECT appointments_linked FROM linked);
    operation := 'link_partner_org_appointments'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_partner_org_appointments (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- ============================================================================
  -- MIG_957 FIX: Steps 5 & 6 are REORDERED
  -- MUST infer appointment places BEFORE linking cats to places!
  -- booking_address (colony site) takes priority over person_place (home address)
  -- ============================================================================

  -- Step 5: FIRST - Infer appointment places (booking_address has highest priority)
  BEGIN
    FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
      operation := 'infer_appointment_places:' || v_rec.source;
      count := v_rec.appointments_linked;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: Link cats to places via appointment inferred_place_id
  BEGIN
    FOR v_rec IN SELECT * FROM trapper.link_cats_to_appointment_places() LOOP
      operation := 'link_cats_to_appointment_places';
      count := v_rec.cats_linked;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7: Create person-cat relationships from linked appointments
  -- MIG_938: Exclude appointments with organizational contacts
  BEGIN
    WITH missing_rels AS (
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      )
      SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
        'clinichq', 'appointments'
      FROM trapper.sot_appointments a
      WHERE a.person_id IS NOT NULL
        AND a.cat_id IS NOT NULL
        -- MIG_938: Exclude organizational contacts
        AND NOT trapper.is_organizational_contact(a.owner_email, a.owner_phone)
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
        )
      ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
      RETURNING person_id
    )
    SELECT INTO v_count COUNT(*) FROM missing_rels;
    operation := 'create_person_cat_relationships'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'create_person_cat_relationships (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- ============================================================================
  -- MIG_968: Step 8 (NEW) - Link cats via person_cat → person_place chain
  -- ============================================================================
  -- This handles relationships created by ShelterLuv outcomes:
  --   - adopter → home (high confidence)
  --   - foster → home (medium confidence)
  --   - caretaker → residence (medium confidence)
  --   - owner → home (high confidence)
  --   - colony_caretaker → colony_member (medium confidence)
  --
  -- Uses LIMIT 1 per person (MIG_889 fix) to prevent pollution.
  -- Only links to the BEST place per person (highest confidence, most recent).
  -- ============================================================================
  BEGIN
    FOR v_rec IN SELECT * FROM trapper.link_cats_to_places() LOOP
      operation := 'link_cats_to_places';
      count := v_rec.total_edges;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_cats_to_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
'MIG_968: Restored link_cats_to_places() as Step 8.

Pipeline order:
  1. link_appointments_to_owners - Email matching
  2. link_appointments_via_phone - Phone matching
  3. link_appointments_via_safe_phone - Unique phone matching
  4. link_partner_org_appointments - Partner org matching
  5. infer_appointment_places - Set inferred_place_id (booking_address priority)
  6. link_cats_to_appointment_places - Create cat-place links from appointments
  7. create_person_cat_relationships - Create person-cat links from appointments
  8. link_cats_to_places - Create cat-place links via person_cat → person_place

Step 8 uses LIMIT 1 per person (MIG_889 fix) to prevent linking cats to ALL
of a person''s historical addresses. Only links to the BEST place per person.';

\echo 'Step 8 (link_cats_to_places) added to pipeline.'
\echo ''

-- ============================================================================
-- PHASE 3: CREATE DATA QUALITY ALERTS TABLE
-- ============================================================================

\echo 'PHASE 3: Creating data_quality_alerts table...'

CREATE TABLE IF NOT EXISTS trapper.data_quality_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.data_quality_alerts IS
'MIG_968: Stores data quality alerts for review. Populated by triggers that
detect potential issues (e.g., cat_place_pollution when a cat has 5+ links
of the same type).';

CREATE INDEX IF NOT EXISTS idx_data_quality_alerts_type
ON trapper.data_quality_alerts (alert_type);

CREATE INDEX IF NOT EXISTS idx_data_quality_alerts_unreviewed
ON trapper.data_quality_alerts (created_at)
WHERE reviewed_at IS NULL;

\echo 'data_quality_alerts table created.'
\echo ''

-- ============================================================================
-- PHASE 4: CREATE POLLUTION DETECTION TRIGGER
-- ============================================================================

\echo 'PHASE 4: Creating pollution detection trigger...'

CREATE OR REPLACE FUNCTION trapper.check_cat_place_pollution()
RETURNS TRIGGER AS $$
DECLARE
  v_link_count INT;
BEGIN
  -- Count existing links of this type for this cat
  SELECT COUNT(*) INTO v_link_count
  FROM trapper.cat_place_relationships
  WHERE cat_id = NEW.cat_id
    AND relationship_type = NEW.relationship_type;

  -- If this cat already has 5+ links of this type, log an alert
  IF v_link_count >= 5 THEN
    INSERT INTO trapper.data_quality_alerts (
      alert_type, entity_type, entity_id, message, details
    ) VALUES (
      'cat_place_pollution',
      'cat',
      NEW.cat_id,
      format('Cat has %s %s links - possible pollution', v_link_count, NEW.relationship_type),
      jsonb_build_object(
        'relationship_type', NEW.relationship_type,
        'link_count', v_link_count,
        'latest_place_id', NEW.place_id,
        'source_system', NEW.source_system
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.check_cat_place_pollution() IS
'MIG_968: Trigger function that logs an alert when a cat has 5+ links of the
same relationship_type. This indicates possible pollution from a buggy
link-creation process.';

-- Create or replace the trigger
DROP TRIGGER IF EXISTS trg_cat_place_pollution_check ON trapper.cat_place_relationships;

CREATE TRIGGER trg_cat_place_pollution_check
AFTER INSERT ON trapper.cat_place_relationships
FOR EACH ROW EXECUTE FUNCTION trapper.check_cat_place_pollution();

\echo 'Pollution detection trigger created.'
\echo ''

-- ============================================================================
-- PHASE 5: CREATE MONITORING VIEW
-- ============================================================================

\echo 'PHASE 5: Creating monitoring view...'

CREATE OR REPLACE VIEW trapper.v_cat_place_pollution_check AS
SELECT
  c.cat_id,
  c.display_name,
  cpr.relationship_type,
  COUNT(*) as link_count,
  CASE
    WHEN COUNT(*) > 5 THEN 'CRITICAL'
    WHEN COUNT(*) > 3 THEN 'HIGH'
    WHEN COUNT(*) > 1 THEN 'MEDIUM'
    ELSE 'OK'
  END as pollution_risk,
  array_agg(DISTINCT cpr.source_system) as sources,
  MIN(cpr.created_at) as first_link_created,
  MAX(cpr.created_at) as last_link_created
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
WHERE cpr.relationship_type IN ('adopter_residence', 'home', 'foster_home', 'residence')
GROUP BY c.cat_id, c.display_name, cpr.relationship_type
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

COMMENT ON VIEW trapper.v_cat_place_pollution_check IS
'MIG_968: Shows cats with multiple links of the same relationship type.
More than 2-3 links usually indicates pollution from a buggy process.
Pollution risk levels: CRITICAL (>5), HIGH (>3), MEDIUM (>1), OK (1).';

\echo 'Monitoring view created.'
\echo ''

-- ============================================================================
-- PHASE 6: BACKFILL - Run link_cats_to_places() for missing links
-- ============================================================================

\echo 'PHASE 6: Running link_cats_to_places() to create missing links...'

SELECT * FROM trapper.link_cats_to_places();

\echo ''
\echo 'Backfill complete.'
\echo ''

-- ============================================================================
-- PHASE 7: VERIFICATION
-- ============================================================================

\echo 'PHASE 7: VERIFICATION'
\echo ''

\echo '7a. Cats with adopter relationships that now have cat-place links:'

SELECT COUNT(DISTINCT pcr.cat_id) AS cats_with_place_links
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'adopter'
  AND EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = pcr.cat_id
  );

\echo ''
\echo '7b. Pollution check (should show 0 CRITICAL or HIGH):'

SELECT pollution_risk, COUNT(*) as cat_count
FROM trapper.v_cat_place_pollution_check
GROUP BY pollution_risk
ORDER BY
  CASE pollution_risk
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    ELSE 4
  END;

\echo ''
\echo '7c. Recent cat-place links created by link_cats_to_places:'

SELECT COUNT(*) as links_from_function
FROM trapper.cat_place_relationships
WHERE source_table = 'link_cats_to_places';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_968 Complete'
\echo '=============================================================================='
\echo ''
\echo 'What was fixed:'
\echo '  1. Added Step 8 (link_cats_to_places) back to run_all_entity_linking()'
\echo '  2. Created data_quality_alerts table for pollution detection'
\echo '  3. Created trigger to alert when cat has 5+ links of same type'
\echo '  4. Created v_cat_place_pollution_check monitoring view'
\echo '  5. Ran backfill to create missing cat-place links'
\echo ''
\echo 'Why this is permanent:'
\echo '  - link_cats_to_places() is now part of the ongoing cron pipeline'
\echo '  - Uses LIMIT 1 per person (MIG_889 fix) to prevent pollution'
\echo '  - Alert trigger catches any future pollution attempts'
\echo '  - Monitoring view provides visibility for staff review'
\echo ''
\echo 'Related migrations:'
\echo '  - MIG_889: Fixed link_cats_to_places() with LIMIT 1'
\echo '  - MIG_957: Reordered pipeline for booking_address priority'
\echo '  - MIG_966/967: Deleted bad links from data_fix and ShelterLuv'
\echo ''
