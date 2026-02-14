-- MIG_470: Intake Feeder/Caretaker Relationships - Unified Data Engine Integration
--
-- Captures feeder and caretaker relationships from web intake submissions:
-- 1. Creates person_place_relationships(role='feeder') when feeds_cat = true
-- 2. Creates person_roles(role='caretaker') for people who feed/care for cats
-- 3. Integrates with unified data engine flow
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_470__intake_relationships.sql

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_470: Intake Feeder/Caretaker Relationships                      ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- PART 1: Current state analysis
-- ============================================================================

\echo 'Current intake submissions with feeding data:'
SELECT
  COUNT(*) AS total_submissions,
  COUNT(*) FILTER (WHERE feeds_cat = true) AS feeders,
  COUNT(*) FILTER (WHERE feeding_frequency IS NOT NULL) AS has_frequency,
  COUNT(*) FILTER (WHERE matched_person_id IS NOT NULL) AS has_person,
  COUNT(*) FILTER (WHERE place_id IS NOT NULL) AS has_place,
  COUNT(*) FILTER (WHERE feeds_cat = true AND matched_person_id IS NOT NULL AND place_id IS NOT NULL) AS can_link
FROM trapper.web_intake_submissions;

-- ============================================================================
-- PART 2: Create function to process intake feeder relationships
-- ============================================================================

\echo ''
\echo 'Creating process_intake_feeder_relationship function...'

CREATE OR REPLACE FUNCTION trapper.process_intake_feeder_relationship(p_submission_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
  v_place_id UUID;
  v_rel_id UUID;
  v_role_id UUID;
  v_feeding_notes TEXT;
BEGIN
  -- Get the submission
  SELECT
    submission_id,
    matched_person_id,
    place_id,
    feeds_cat,
    feeding_frequency,
    feeding_duration,
    cat_comes_inside,
    cats_being_fed,
    feeder_info
  INTO v_sub
  FROM trapper.web_intake_submissions
  WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Submission not found',
      'submission_id', p_submission_id
    );
  END IF;

  v_person_id := v_sub.matched_person_id;
  v_place_id := v_sub.place_id;

  -- Need both person and place to create relationships
  IF v_person_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No matched person',
      'submission_id', p_submission_id
    );
  END IF;

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No linked place',
      'submission_id', p_submission_id
    );
  END IF;

  -- Check if this person feeds cats at this location
  IF v_sub.feeds_cat = true OR v_sub.cats_being_fed = true THEN
    -- Build feeding notes
    v_feeding_notes := '';
    IF v_sub.feeding_frequency IS NOT NULL THEN
      v_feeding_notes := v_feeding_notes || 'Frequency: ' || v_sub.feeding_frequency;
    END IF;
    IF v_sub.feeding_duration IS NOT NULL THEN
      IF v_feeding_notes != '' THEN v_feeding_notes := v_feeding_notes || ', '; END IF;
      v_feeding_notes := v_feeding_notes || 'Duration: ' || v_sub.feeding_duration;
    END IF;
    IF v_sub.cat_comes_inside IS NOT NULL THEN
      IF v_feeding_notes != '' THEN v_feeding_notes := v_feeding_notes || ', '; END IF;
      v_feeding_notes := v_feeding_notes || 'Comes inside: ' || v_sub.cat_comes_inside;
    END IF;

    -- Create person-place relationship as feeder
    INSERT INTO trapper.person_place_relationships (
      person_id,
      place_id,
      role,
      confidence,
      source_system,
      source_table,
      notes
    ) VALUES (
      v_person_id,
      v_place_id,
      'feeder',
      0.95,  -- High confidence - direct self-report
      'web_intake',
      'web_intake_submissions',
      NULLIF(v_feeding_notes, '')
    )
    ON CONFLICT (person_id, place_id, role) DO UPDATE
    SET updated_at = NOW(),
        notes = COALESCE(EXCLUDED.notes, trapper.person_place_relationships.notes)
    RETURNING relationship_id INTO v_rel_id;

    -- Assign caretaker role to the person
    v_role_id := trapper.assign_person_role(v_person_id, 'caretaker', 'web_intake');

    RETURN jsonb_build_object(
      'success', true,
      'person_id', v_person_id,
      'place_id', v_place_id,
      'relationship_id', v_rel_id,
      'role_id', v_role_id,
      'feeding_frequency', v_sub.feeding_frequency,
      'is_feeder', true
    );
  ELSE
    -- Still create a requester relationship to track the request origin
    INSERT INTO trapper.person_place_relationships (
      person_id,
      place_id,
      role,
      confidence,
      source_system,
      source_table
    ) VALUES (
      v_person_id,
      v_place_id,
      'requester',
      0.9,
      'web_intake',
      'web_intake_submissions'
    )
    ON CONFLICT (person_id, place_id, role) DO NOTHING
    RETURNING relationship_id INTO v_rel_id;

    RETURN jsonb_build_object(
      'success', true,
      'person_id', v_person_id,
      'place_id', v_place_id,
      'relationship_id', v_rel_id,
      'is_feeder', false
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_intake_feeder_relationship IS 'Creates person-place relationships from intake submissions.
Creates feeder relationship if feeds_cat=true, otherwise creates requester relationship.
Also assigns caretaker role to feeders.';

-- ============================================================================
-- PART 3: Batch processor for existing submissions
-- ============================================================================

\echo ''
\echo 'Creating batch processor for intake relationships...'

CREATE OR REPLACE FUNCTION trapper.process_all_intake_relationships(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_processed INT := 0;
  v_feeders INT := 0;
  v_requesters INT := 0;
  v_errors INT := 0;
  v_rec RECORD;
  v_result JSONB;
BEGIN
  FOR v_rec IN
    SELECT submission_id
    FROM trapper.web_intake_submissions wis
    WHERE matched_person_id IS NOT NULL
      AND place_id IS NOT NULL
      -- Skip if already has a relationship
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = wis.matched_person_id
          AND ppr.place_id = wis.place_id
          AND ppr.source_system = 'web_intake'
      )
    ORDER BY submitted_at DESC
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_result := trapper.process_intake_feeder_relationship(v_rec.submission_id);
      v_processed := v_processed + 1;

      IF (v_result->>'success')::boolean THEN
        IF (v_result->>'is_feeder')::boolean THEN
          v_feeders := v_feeders + 1;
        ELSE
          v_requesters := v_requesters + 1;
        END IF;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'feeders_created', v_feeders,
    'requesters_created', v_requesters,
    'errors', v_errors
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_all_intake_relationships IS 'Batch process intake submissions to create person-place relationships.
Run periodically or after bulk intake imports.';

-- ============================================================================
-- PART 4: Create trigger for automatic processing
-- ============================================================================

\echo ''
\echo 'Creating trigger for automatic intake relationship processing...'

CREATE OR REPLACE FUNCTION trapper.trigger_intake_feeder_relationship()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if we have both person_id and place_id set
  IF NEW.matched_person_id IS NOT NULL AND NEW.place_id IS NOT NULL THEN
    -- Check if relationship was just established (person or place was NULL before)
    IF (TG_OP = 'UPDATE' AND
        (OLD.matched_person_id IS NULL OR OLD.place_id IS NULL))
       OR TG_OP = 'INSERT' THEN
      PERFORM trapper.process_intake_feeder_relationship(NEW.submission_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_feeder_relationship ON trapper.web_intake_submissions;
CREATE TRIGGER trg_intake_feeder_relationship
  AFTER INSERT OR UPDATE OF matched_person_id, place_id ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_intake_feeder_relationship();

COMMENT ON TRIGGER trg_intake_feeder_relationship ON trapper.web_intake_submissions IS
'Automatically creates person-place relationships when intake submission is linked to person and place.';

-- ============================================================================
-- PART 5: Register processor in data engine
-- ============================================================================

\echo ''
\echo 'Registering intake_feeder processor in data engine...'

INSERT INTO trapper.data_engine_processors (
  processor_name,
  source_system,
  source_table,
  entity_type,
  processor_function,
  priority
) VALUES (
  'intake_feeder',
  'web_intake',
  'web_intake_submissions',
  'relationship',
  'process_intake_feeder_relationship',
  200  -- Lower priority, run after person/place creation
)
ON CONFLICT (source_system, source_table) DO UPDATE
SET processor_function = EXCLUDED.processor_function,
    entity_type = EXCLUDED.entity_type,
    priority = EXCLUDED.priority;

-- ============================================================================
-- PART 6: Add unique constraint for person-place-role if missing
-- ============================================================================

\echo ''
\echo 'Ensuring unique constraint on person_place_relationships...'

-- Check if constraint exists, if not create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'person_place_relationships_person_place_role_key'
  ) THEN
    -- First remove any existing duplicates
    DELETE FROM trapper.person_place_relationships a
    USING trapper.person_place_relationships b
    WHERE a.relationship_id > b.relationship_id
      AND a.person_id = b.person_id
      AND a.place_id = b.place_id
      AND a.role = b.role;

    -- Now add the constraint
    ALTER TABLE trapper.person_place_relationships
    ADD CONSTRAINT person_place_relationships_person_place_role_key
    UNIQUE (person_id, place_id, role);

    RAISE NOTICE 'Added unique constraint on (person_id, place_id, role)';
  ELSE
    RAISE NOTICE 'Unique constraint already exists';
  END IF;
END;
$$;

-- ============================================================================
-- PART 7: Backfill existing submissions
-- ============================================================================

\echo ''
\echo 'Backfilling relationships for existing intake submissions...'

SELECT trapper.process_all_intake_relationships(10000);

-- ============================================================================
-- PART 8: Summary
-- ============================================================================

\echo ''
\echo 'Results after migration:'

SELECT
  'person_place_relationships by role' as metric,
  role,
  COUNT(*) as count
FROM trapper.person_place_relationships
WHERE source_system = 'web_intake'
GROUP BY role
ORDER BY count DESC;

SELECT
  'caretaker roles created' as metric,
  COUNT(*) as count
FROM trapper.person_roles
WHERE role = 'caretaker';

\echo ''
\echo 'Sample feeder relationships:'
SELECT
  p.display_name AS person_name,
  pl.display_name AS place_name,
  ppr.role,
  ppr.notes AS feeding_info
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id
WHERE ppr.role = 'feeder'
  AND ppr.source_system = 'web_intake'
LIMIT 10;

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_470 COMPLETE - Intake Relationships Integrated                  ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║  Functions:                                                          ║'
\echo '║    - process_intake_feeder_relationship(): Single submission         ║'
\echo '║    - process_all_intake_relationships(): Batch processor             ║'
\echo '║                                                                      ║'
\echo '║  Now capturing:                                                      ║'
\echo '║    - person_place_relationships(role=feeder) for cat feeders        ║'
\echo '║    - person_place_relationships(role=requester) for non-feeders     ║'
\echo '║    - person_roles(role=caretaker) for feeders                        ║'
\echo '║                                                                      ║'
\echo '║  Trigger:                                                            ║'
\echo '║    - Auto-creates relationships when person+place are linked         ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''
