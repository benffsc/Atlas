\echo '=== MIG_712: Incremental Extraction Tracking ==='

-- ============================================================
-- TRACK WHAT'S BEEN EXTRACTED AND WHEN
-- Enables: Weekly refreshes, triggered updates, cost tracking
-- ============================================================

-- Track extraction status per record
CREATE TABLE IF NOT EXISTS trapper.extraction_status (
  extraction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,              -- 'sot_appointments', 'sot_requests', etc.
  source_record_id TEXT NOT NULL,          -- The record's primary key
  source_updated_at TIMESTAMPTZ,           -- When source record was last modified
  last_extracted_at TIMESTAMPTZ,           -- When we last ran extraction on it
  extraction_hash TEXT,                    -- MD5 of the text we extracted from (detect changes)
  attributes_extracted INT DEFAULT 0,      -- How many attributes found
  needs_reextraction BOOLEAN DEFAULT FALSE,-- Flagged for re-processing

  UNIQUE(source_table, source_record_id)
);

CREATE INDEX idx_extraction_status_needs ON trapper.extraction_status(needs_reextraction) WHERE needs_reextraction = TRUE;
CREATE INDEX idx_extraction_status_stale ON trapper.extraction_status(last_extracted_at);

-- ============================================================
-- EXTRACTION QUEUE (Records needing processing)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.extraction_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,               -- 'place', 'person', 'cat', 'request'
  entity_id UUID NOT NULL,
  priority INT DEFAULT 50,                 -- 1=highest, 100=lowest
  trigger_reason TEXT,                     -- 'new_record', 'related_update', 'weekly_refresh', 'manual'
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  UNIQUE(source_table, source_record_id) WHERE completed_at IS NULL
);

CREATE INDEX idx_extraction_queue_pending ON trapper.extraction_queue(priority, queued_at)
  WHERE completed_at IS NULL AND processing_started_at IS NULL;

-- ============================================================
-- FUNCTION: Queue new records for extraction
-- Called by triggers when new data arrives
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.queue_for_extraction(
  p_source_table TEXT,
  p_source_record_id TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_trigger_reason TEXT DEFAULT 'new_record',
  p_priority INT DEFAULT 50
) RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
BEGIN
  INSERT INTO trapper.extraction_queue (
    source_table, source_record_id, entity_type, entity_id, trigger_reason, priority
  ) VALUES (
    p_source_table, p_source_record_id, p_entity_type, p_entity_id, p_trigger_reason, p_priority
  )
  ON CONFLICT (source_table, source_record_id) WHERE completed_at IS NULL
  DO UPDATE SET
    priority = LEAST(trapper.extraction_queue.priority, p_priority),
    trigger_reason = p_trigger_reason
  RETURNING queue_id INTO v_queue_id;

  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Queue related entities when parent changes
-- e.g., When a request changes, queue person + place for re-extraction
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.queue_related_extractions(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_trigger_reason TEXT DEFAULT 'related_update'
) RETURNS INT AS $$
DECLARE
  v_queued INT := 0;
BEGIN
  CASE p_entity_type
    -- When a request changes, queue person and place
    WHEN 'request' THEN
      -- Queue the requester
      INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
      SELECT 'sot_people', rq.requester_person_id::TEXT, 'person', rq.requester_person_id, p_trigger_reason, 60
      FROM trapper.sot_requests rq WHERE rq.request_id = p_entity_id AND rq.requester_person_id IS NOT NULL
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_queued = ROW_COUNT;

      -- Queue the place
      INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
      SELECT 'places', rq.place_id::TEXT, 'place', rq.place_id, p_trigger_reason, 60
      FROM trapper.sot_requests rq WHERE rq.request_id = p_entity_id AND rq.place_id IS NOT NULL
      ON CONFLICT DO NOTHING;
      v_queued := v_queued + ROW_COUNT;

    -- When a person changes, queue their places
    WHEN 'person' THEN
      INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
      SELECT 'places', ppr.place_id::TEXT, 'place', ppr.place_id, p_trigger_reason, 70
      FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = p_entity_id AND ppr.ended_at IS NULL
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_queued = ROW_COUNT;

    -- When a place changes, queue related people
    WHEN 'place' THEN
      INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
      SELECT 'sot_people', ppr.person_id::TEXT, 'person', ppr.person_id, p_trigger_reason, 70
      FROM trapper.person_place_relationships ppr
      WHERE ppr.place_id = p_entity_id AND ppr.ended_at IS NULL
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_queued = ROW_COUNT;

    ELSE
      -- No related entities to queue
      v_queued := 0;
  END CASE;

  RETURN v_queued;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Queue weekly refresh (stale extractions)
-- Called by cron job weekly
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.queue_weekly_extraction_refresh(
  p_days_stale INT DEFAULT 7,
  p_limit INT DEFAULT 1000
) RETURNS INT AS $$
DECLARE
  v_queued INT := 0;
BEGIN
  -- Queue requests not extracted in p_days_stale days
  INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
  SELECT 'sot_requests', r.request_id::TEXT, 'request', r.request_id, 'weekly_refresh', 80
  FROM trapper.sot_requests r
  LEFT JOIN trapper.extraction_status es ON es.source_table = 'sot_requests' AND es.source_record_id = r.request_id::TEXT
  WHERE (r.summary IS NOT NULL AND r.summary != '')
    AND (es.last_extracted_at IS NULL OR es.last_extracted_at < NOW() - (p_days_stale || ' days')::INTERVAL)
    AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')  -- Only active requests
  ORDER BY COALESCE(es.last_extracted_at, '1970-01-01'::TIMESTAMPTZ)
  LIMIT p_limit
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_queued = ROW_COUNT;

  -- Queue appointments with notes not extracted recently
  INSERT INTO trapper.extraction_queue (source_table, source_record_id, entity_type, entity_id, trigger_reason, priority)
  SELECT 'sot_appointments', a.appointment_id::TEXT, 'cat', a.cat_id, 'weekly_refresh', 90
  FROM trapper.sot_appointments a
  LEFT JOIN trapper.extraction_status es ON es.source_table = 'sot_appointments' AND es.source_record_id = a.appointment_id::TEXT
  WHERE (a.medical_notes IS NOT NULL AND a.medical_notes != '')
    AND a.cat_id IS NOT NULL
    AND (es.last_extracted_at IS NULL OR es.last_extracted_at < NOW() - (p_days_stale || ' days')::INTERVAL)
  ORDER BY a.appointment_date DESC  -- Prioritize recent appointments
  LIMIT p_limit - v_queued
  ON CONFLICT DO NOTHING;
  v_queued := v_queued + ROW_COUNT;

  RETURN v_queued;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGER: Auto-queue new requests for extraction
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.trigger_queue_request_extraction()
RETURNS TRIGGER AS $$
BEGIN
  -- Queue the request itself
  IF NEW.summary IS NOT NULL AND NEW.summary != '' THEN
    PERFORM trapper.queue_for_extraction(
      'sot_requests', NEW.request_id::TEXT, 'request', NEW.request_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'new_record' ELSE 'updated' END,
      CASE WHEN NEW.status IN ('new', 'triaged') THEN 30 ELSE 50 END  -- Higher priority for new
    );
  END IF;

  -- Queue related entities
  IF NEW.requester_person_id IS NOT NULL THEN
    PERFORM trapper.queue_for_extraction(
      'sot_people', NEW.requester_person_id::TEXT, 'person', NEW.requester_person_id,
      'related_update', 60
    );
  END IF;

  IF NEW.place_id IS NOT NULL THEN
    PERFORM trapper.queue_for_extraction(
      'places', NEW.place_id::TEXT, 'place', NEW.place_id,
      'related_update', 60
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_queue_request_extraction') THEN
    CREATE TRIGGER trg_queue_request_extraction
      AFTER INSERT OR UPDATE OF summary, notes, internal_notes ON trapper.sot_requests
      FOR EACH ROW
      EXECUTE FUNCTION trapper.trigger_queue_request_extraction();
  END IF;
END $$;

-- ============================================================
-- VIEW: Extraction queue status
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_extraction_queue_status AS
SELECT
  source_table,
  COUNT(*) FILTER (WHERE completed_at IS NULL AND processing_started_at IS NULL) as pending,
  COUNT(*) FILTER (WHERE processing_started_at IS NOT NULL AND completed_at IS NULL) as processing,
  COUNT(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at > NOW() - INTERVAL '24 hours') as completed_24h,
  COUNT(*) FILTER (WHERE error_message IS NOT NULL) as errors
FROM trapper.extraction_queue
WHERE queued_at > NOW() - INTERVAL '7 days'
GROUP BY source_table;

-- ============================================================
-- VIEW: Extraction coverage (what % of records have been processed)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_extraction_coverage AS
SELECT
  'sot_requests' as source_table,
  COUNT(*) as total_with_text,
  COUNT(es.extraction_id) as extracted,
  ROUND(100.0 * COUNT(es.extraction_id) / NULLIF(COUNT(*), 0), 1) as coverage_pct,
  MIN(es.last_extracted_at) as oldest_extraction,
  MAX(es.last_extracted_at) as newest_extraction
FROM trapper.sot_requests r
LEFT JOIN trapper.extraction_status es ON es.source_table = 'sot_requests' AND es.source_record_id = r.request_id::TEXT
WHERE r.summary IS NOT NULL AND r.summary != ''

UNION ALL

SELECT
  'sot_appointments' as source_table,
  COUNT(*) as total_with_text,
  COUNT(es.extraction_id) as extracted,
  ROUND(100.0 * COUNT(es.extraction_id) / NULLIF(COUNT(*), 0), 1) as coverage_pct,
  MIN(es.last_extracted_at) as oldest_extraction,
  MAX(es.last_extracted_at) as newest_extraction
FROM trapper.sot_appointments a
LEFT JOIN trapper.extraction_status es ON es.source_table = 'sot_appointments' AND es.source_record_id = a.appointment_id::TEXT
WHERE a.medical_notes IS NOT NULL AND a.medical_notes != ''

UNION ALL

SELECT
  'google_map_entries' as source_table,
  COUNT(*) as total_with_text,
  COUNT(*) FILTER (WHERE ai_classified_at IS NOT NULL) as extracted,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ai_classified_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as coverage_pct,
  MIN(ai_classified_at) as oldest_extraction,
  MAX(ai_classified_at) as newest_extraction
FROM trapper.google_map_entries
WHERE original_content IS NOT NULL AND original_content != '';

\echo '=== MIG_712 Complete ==='
