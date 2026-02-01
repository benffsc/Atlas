\echo '=== MIG_819: Fix extraction re-queue on source data update ==='
\echo 'Problem: When appointment notes or intake descriptions are updated,'
\echo 'the extraction triggers skip records already in extraction_status.'
\echo 'Fix: On UPDATE, set needs_reextraction=TRUE and queue new extraction.'

-- ============================================================================
-- 1. FIX APPOINTMENT EXTRACTION TRIGGER
-- Previously: Skipped records already in extraction_status (even on UPDATE)
-- Now: On UPDATE, sets needs_reextraction=TRUE and queues new extraction
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.trigger_queue_appointment_extraction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.medical_notes IS NOT NULL
     AND LENGTH(NEW.medical_notes) > 20
     AND NEW.cat_id IS NOT NULL THEN

    -- On UPDATE: flag existing extraction_status for re-extraction
    IF TG_OP = 'UPDATE' THEN
      UPDATE trapper.extraction_status
      SET needs_reextraction = TRUE, updated_at = NOW()
      WHERE source_table = 'sot_appointments'
        AND source_record_id = NEW.appointment_id::TEXT
        AND needs_reextraction = FALSE;

      -- Queue re-extraction (queue_for_extraction handles duplicates gracefully)
      IF FOUND OR NOT EXISTS (
        SELECT 1 FROM trapper.extraction_queue eq
        WHERE eq.source_table = 'sot_appointments'
          AND eq.source_record_id = NEW.appointment_id::TEXT
          AND eq.completed_at IS NULL
      ) THEN
        PERFORM trapper.queue_for_extraction(
          'sot_appointments', NEW.appointment_id::TEXT, 'cat', NEW.cat_id,
          'updated', 30  -- Higher priority for updates (re-extraction)
        );
      END IF;

    -- On INSERT: original behavior (skip if already processed)
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM trapper.extraction_queue eq
        WHERE eq.source_table = 'sot_appointments'
          AND eq.source_record_id = NEW.appointment_id::TEXT
          AND eq.completed_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'sot_appointments'
          AND es.source_record_id = NEW.appointment_id::TEXT
      ) THEN
        INSERT INTO trapper.extraction_queue (
          source_table, source_record_id, entity_type, entity_id,
          trigger_reason, priority
        ) VALUES (
          'sot_appointments', NEW.appointment_id::TEXT, 'cat', NEW.cat_id,
          'INSERT', 50
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo '  → Appointment extraction trigger updated (re-queues on UPDATE)'

-- ============================================================================
-- 2. FIX INTAKE EXTRACTION TRIGGER
-- Same pattern: On UPDATE, flag for re-extraction + queue
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.trigger_queue_intake_extraction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.situation_description IS NOT NULL
     AND LENGTH(NEW.situation_description) > 30
     AND NEW.place_id IS NOT NULL THEN

    -- On UPDATE: flag existing extraction_status for re-extraction
    IF TG_OP = 'UPDATE' THEN
      UPDATE trapper.extraction_status
      SET needs_reextraction = TRUE, updated_at = NOW()
      WHERE source_table = 'web_intake_submissions'
        AND source_record_id = NEW.submission_id::TEXT
        AND needs_reextraction = FALSE;

      IF FOUND OR NOT EXISTS (
        SELECT 1 FROM trapper.extraction_queue eq
        WHERE eq.source_table = 'web_intake_submissions'
          AND eq.source_record_id = NEW.submission_id::TEXT
          AND eq.completed_at IS NULL
      ) THEN
        PERFORM trapper.queue_for_extraction(
          'web_intake_submissions', NEW.submission_id::TEXT, 'place', NEW.place_id,
          'updated', 30
        );
      END IF;

    -- On INSERT: original behavior
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM trapper.extraction_queue eq
        WHERE eq.source_table = 'web_intake_submissions'
          AND eq.source_record_id = NEW.submission_id::TEXT
          AND eq.completed_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM trapper.extraction_status es
        WHERE es.source_table = 'web_intake_submissions'
          AND es.source_record_id = NEW.submission_id::TEXT
      ) THEN
        INSERT INTO trapper.extraction_queue (
          source_table, source_record_id, entity_type, entity_id,
          trigger_reason, priority
        ) VALUES (
          'web_intake_submissions', NEW.submission_id::TEXT, 'place', NEW.place_id,
          'INSERT', 40
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo '  → Intake extraction trigger updated (re-queues on UPDATE)'

-- ============================================================================
-- 3. VERIFY: Request trigger already handles updates correctly
-- queue_for_extraction() inserts new queue entries when old ones are completed
-- No change needed for request trigger
-- ============================================================================

\echo '  → Request extraction trigger already handles updates (via queue_for_extraction)'

-- ============================================================================
-- 4. ADD needs_reextraction HANDLING TO DISEASE EXTRACTION
-- When a cat test result changes, flag the place for disease re-computation
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.trigger_recompute_disease_on_test_change()
RETURNS TRIGGER AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Find the place associated with this cat via cat_place_relationships
  SELECT cpr.place_id INTO v_place_id
  FROM trapper.cat_place_relationships cpr
  WHERE cpr.cat_id = NEW.cat_id
    AND cpr.ended_at IS NULL
  ORDER BY cpr.started_at DESC
  LIMIT 1;

  IF v_place_id IS NOT NULL THEN
    -- Re-compute disease status for this place
    PERFORM trapper.compute_place_disease_status(v_place_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on cat_test_results for automatic disease recomputation
DROP TRIGGER IF EXISTS trg_recompute_disease_on_test ON trapper.cat_test_results;
CREATE TRIGGER trg_recompute_disease_on_test
  AFTER INSERT OR UPDATE OF result, result_detail ON trapper.cat_test_results
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_recompute_disease_on_test_change();

\echo '  → Disease recomputation trigger on cat_test_results changes'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_819 Complete ==='
\echo 'Changes:'
\echo '  1. Appointment trigger: re-queues extraction on note UPDATE (was silently skipped)'
\echo '  2. Intake trigger: re-queues extraction on description UPDATE (was silently skipped)'
\echo '  3. Disease trigger: auto-recomputes place disease status when test results change'
\echo '  4. Request trigger: already correct (no change)'
\echo ''
\echo 'How it works:'
\echo '  - On INSERT: existing behavior (skip if already processed)'
\echo '  - On UPDATE: sets needs_reextraction=TRUE → queues for re-extraction at priority 30'
\echo '  - Cron (/api/cron/ai-extract) picks up queue items and clears needs_reextraction'
\echo '  - Disease status auto-recomputes when cat test results change'
