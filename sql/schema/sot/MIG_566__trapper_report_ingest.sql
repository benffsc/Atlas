-- MIG_566__trapper_report_ingest.sql
-- Trapper Report Ingest System
--
-- Purpose:
--   Safe ingestion of unstructured trapper reports (emails, summaries) with:
--   1. Immutable staging for raw content
--   2. AI extraction to structured items
--   3. Entity matching with confidence scores and alternatives
--   4. Human review before commit
--   5. Full audit trail
--
-- Design Principles:
--   - Never auto-link entities without review
--   - Show match candidates with confidence scores
--   - Staff can override any auto-match
--   - All commits logged to entity_edits

\echo '=============================================='
\echo 'MIG_566: Trapper Report Ingest System'
\echo '=============================================='

-- =============================================================================
-- TABLES
-- =============================================================================

\echo 'Creating trapper_report_submissions table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_report_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reporter identity (resolved after extraction)
  reporter_email TEXT,
  reporter_person_id UUID REFERENCES trapper.sot_people(person_id),
  reporter_match_confidence NUMERIC(4,3),
  reporter_match_candidates JSONB,  -- [{person_id, display_name, score, signals}]

  -- Raw content (immutable)
  raw_content TEXT NOT NULL,
  content_type TEXT DEFAULT 'email' CHECK (content_type IN ('email', 'form', 'sms', 'note')),
  subject TEXT,  -- Email subject if available
  received_at TIMESTAMPTZ DEFAULT NOW(),

  -- Extraction status
  extraction_status TEXT DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'extracting', 'extracted', 'reviewed', 'committed', 'failed')),
  extracted_at TIMESTAMPTZ,
  extraction_error TEXT,
  ai_extraction JSONB,  -- Full structured extraction from AI

  -- Review workflow
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Commit tracking
  committed_at TIMESTAMPTZ,
  committed_by TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source_system TEXT DEFAULT 'email_forward'
);

COMMENT ON TABLE trapper.trapper_report_submissions IS
  'Staged trapper reports (emails, summaries) awaiting extraction and review';

COMMENT ON COLUMN trapper.trapper_report_submissions.raw_content IS
  'Immutable original text - never modified after insertion';

COMMENT ON COLUMN trapper.trapper_report_submissions.reporter_match_candidates IS
  'All potential person matches with scores for review UI';


\echo 'Creating trapper_report_items table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_report_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES trapper.trapper_report_submissions(submission_id) ON DELETE CASCADE,

  -- Item classification
  item_type TEXT NOT NULL CHECK (item_type IN (
    'person_identifier',    -- Add email/phone to person
    'request_status',       -- Update request status
    'request_note',         -- Add note to request
    'colony_estimate',      -- Add colony size observation
    'site_relationship',    -- Link two sites
    'new_site_observation', -- Create new site with observation
    'trapping_progress'     -- Update cats trapped/remaining
  )),

  -- Entity matching (with alternatives for review)
  target_entity_type TEXT CHECK (target_entity_type IN ('person', 'place', 'request')),
  target_entity_id UUID,              -- Best auto-match (may be null if uncertain)
  match_confidence NUMERIC(4,3),      -- 0.000 to 1.000
  match_candidates JSONB,             -- [{entity_id, display_name, score, signals, context}]

  -- Extracted data
  extracted_text TEXT,                -- Original text snippet this came from
  extracted_data JSONB NOT NULL,      -- Structured extraction

  -- Review workflow
  review_status TEXT DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_clarification', 'skipped')),
  final_entity_id UUID,               -- Staff-confirmed entity (may differ from auto-match)
  final_data JSONB,                   -- Staff-edited data (if modified)
  review_notes TEXT,

  -- Commit tracking
  committed_at TIMESTAMPTZ,
  commit_result JSONB,                -- {success, entity_ids_affected, edit_ids, error}

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.trapper_report_items IS
  'Individual extractable items from trapper reports, each requiring review';

COMMENT ON COLUMN trapper.trapper_report_items.match_candidates IS
  'All potential entity matches shown in review UI for staff selection';

COMMENT ON COLUMN trapper.trapper_report_items.final_entity_id IS
  'Staff-confirmed entity - may differ from auto-matched target_entity_id';


-- Indexes
CREATE INDEX IF NOT EXISTS idx_trapper_report_submissions_status
  ON trapper.trapper_report_submissions(extraction_status);

CREATE INDEX IF NOT EXISTS idx_trapper_report_submissions_reporter
  ON trapper.trapper_report_submissions(reporter_person_id);

CREATE INDEX IF NOT EXISTS idx_trapper_report_items_submission
  ON trapper.trapper_report_items(submission_id);

CREATE INDEX IF NOT EXISTS idx_trapper_report_items_review_status
  ON trapper.trapper_report_items(review_status);

CREATE INDEX IF NOT EXISTS idx_trapper_report_items_type
  ON trapper.trapper_report_items(item_type);


-- =============================================================================
-- ENTITY MATCHING FUNCTIONS
-- =============================================================================

\echo 'Creating match_person_from_report function...'

CREATE OR REPLACE FUNCTION trapper.match_person_from_report(
  p_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_context_address TEXT DEFAULT NULL,
  p_context_request_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  person_id UUID,
  display_name TEXT,
  match_score NUMERIC,
  matched_signals TEXT[],
  context_notes TEXT,
  existing_emails TEXT[],
  existing_phones TEXT[],
  is_trapper BOOLEAN,
  active_assignments INT
) AS $$
DECLARE
  v_phone_norm TEXT;
  v_email_norm TEXT;
BEGIN
  -- Normalize inputs
  v_email_norm := LOWER(TRIM(p_email));
  v_phone_norm := trapper.norm_phone_us(p_phone);

  RETURN QUERY
  WITH candidate_scores AS (
    SELECT
      p.person_id,
      p.display_name,

      -- Email match (40% weight)
      CASE WHEN v_email_norm IS NOT NULL AND EXISTS (
        SELECT 1 FROM trapper.person_identifiers pi
        WHERE pi.person_id = p.person_id
          AND pi.id_type = 'email'
          AND pi.id_value_norm = v_email_norm
      ) THEN 0.40 ELSE 0.00 END AS email_score,

      -- Phone match (25% weight)
      CASE WHEN v_phone_norm IS NOT NULL AND EXISTS (
        SELECT 1 FROM trapper.person_identifiers pi
        WHERE pi.person_id = p.person_id
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = v_phone_norm
      ) THEN 0.25 ELSE 0.00 END AS phone_score,

      -- Name similarity (25% weight)
      CASE WHEN p_name IS NOT NULL THEN
        COALESCE(similarity(LOWER(p.display_name), LOWER(p_name)), 0) * 0.25
      ELSE 0.00 END AS name_score,

      -- Context: is trapper on mentioned requests (10% weight)
      CASE WHEN p_context_request_ids IS NOT NULL AND EXISTS (
        SELECT 1 FROM trapper.request_trapper_assignments rta
        WHERE rta.trapper_person_id = p.person_id
          AND rta.request_id = ANY(p_context_request_ids)
          AND rta.unassigned_at IS NULL
      ) THEN 0.10 ELSE 0.00 END AS request_context_score,

      -- Build signals array
      ARRAY_REMOVE(ARRAY[
        CASE WHEN v_email_norm IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        ) THEN 'email_match' END,
        CASE WHEN v_phone_norm IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        ) THEN 'phone_match' END,
        CASE WHEN p_name IS NOT NULL AND similarity(LOWER(p.display_name), LOWER(p_name)) > 0.5
        THEN 'name_similar' END,
        CASE WHEN p_context_request_ids IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.request_trapper_assignments rta
          WHERE rta.trapper_person_id = p.person_id AND rta.request_id = ANY(p_context_request_ids)
        ) THEN 'assigned_to_context_request' END
      ], NULL) AS signals,

      -- Get existing identifiers for display
      (SELECT ARRAY_AGG(pi.id_value_norm) FROM trapper.person_identifiers pi
       WHERE pi.person_id = p.person_id AND pi.id_type = 'email') AS emails,
      (SELECT ARRAY_AGG(pi.id_value_norm) FROM trapper.person_identifiers pi
       WHERE pi.person_id = p.person_id AND pi.id_type = 'phone') AS phones,

      -- Is this person a trapper?
      EXISTS (
        SELECT 1 FROM trapper.person_roles pr
        WHERE pr.person_id = p.person_id AND pr.role = 'trapper' AND pr.role_status = 'active'
      ) AS is_trapper,

      -- Count active assignments
      (SELECT COUNT(*) FROM trapper.request_trapper_assignments rta
       WHERE rta.trapper_person_id = p.person_id AND rta.unassigned_at IS NULL)::INT AS assignments

    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL  -- Only canonical records
      AND (
        -- Must have some potential match signal
        (v_email_norm IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        ))
        OR (v_phone_norm IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        ))
        OR (p_name IS NOT NULL AND similarity(LOWER(p.display_name), LOWER(p_name)) > 0.3)
      )
  )
  SELECT
    cs.person_id,
    cs.display_name,
    (cs.email_score + cs.phone_score + cs.name_score + cs.request_context_score)::NUMERIC AS match_score,
    cs.signals AS matched_signals,
    CASE
      WHEN cs.is_trapper THEN 'Active trapper with ' || cs.assignments || ' assignments'
      ELSE 'Not a trapper'
    END AS context_notes,
    cs.emails AS existing_emails,
    cs.phones AS existing_phones,
    cs.is_trapper,
    cs.assignments AS active_assignments
  FROM candidate_scores cs
  WHERE (cs.email_score + cs.phone_score + cs.name_score + cs.request_context_score) > 0.20
  ORDER BY (cs.email_score + cs.phone_score + cs.name_score + cs.request_context_score) DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.match_person_from_report IS
  'Find person candidates from report context with weighted scoring. Returns top 5 matches with confidence.';


\echo 'Creating match_place_from_report function...'

CREATE OR REPLACE FUNCTION trapper.match_place_from_report(
  p_address_fragment TEXT,
  p_resident_name TEXT DEFAULT NULL,
  p_context_trapper_id UUID DEFAULT NULL
)
RETURNS TABLE (
  place_id UUID,
  formatted_address TEXT,
  display_name TEXT,
  match_score NUMERIC,
  matched_signals TEXT[],
  context_notes TEXT,
  has_active_request BOOLEAN,
  request_count INT
) AS $$
DECLARE
  v_address_norm TEXT;
  v_address_pattern TEXT;
BEGIN
  -- Normalize and create search pattern
  v_address_norm := LOWER(TRIM(p_address_fragment));
  -- Create pattern: "28 Tarman" → "%28%tarman%"
  v_address_pattern := '%' || REPLACE(v_address_norm, ' ', '%') || '%';

  RETURN QUERY
  WITH place_matches AS (
    SELECT
      pl.place_id,
      pl.formatted_address,
      pl.display_name,

      -- Address match score (base 0.60 for pattern match)
      CASE
        WHEN LOWER(pl.formatted_address) = v_address_norm THEN 1.00
        WHEN LOWER(pl.formatted_address) LIKE v_address_pattern THEN 0.60
        WHEN pl.normalized_address LIKE v_address_pattern THEN 0.55
        ELSE 0.00
      END AS address_score,

      -- Resident name match via requests (boost 0.20)
      CASE WHEN p_resident_name IS NOT NULL AND EXISTS (
        SELECT 1 FROM trapper.sot_requests r
        JOIN trapper.sot_people req ON r.requester_person_id = req.person_id
        WHERE r.place_id = pl.place_id
          AND similarity(LOWER(req.display_name), LOWER(p_resident_name)) > 0.5
      ) THEN 0.20 ELSE 0.00 END AS resident_score,

      -- Trapper context: is trapper assigned here? (boost 0.20)
      CASE WHEN p_context_trapper_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM trapper.sot_requests r
        JOIN trapper.request_trapper_assignments rta ON r.request_id = rta.request_id
        WHERE r.place_id = pl.place_id
          AND rta.trapper_person_id = p_context_trapper_id
          AND rta.unassigned_at IS NULL
      ) THEN 0.20 ELSE 0.00 END AS trapper_context_score,

      -- Build signals
      ARRAY_REMOVE(ARRAY[
        CASE WHEN LOWER(pl.formatted_address) LIKE v_address_pattern THEN 'address_match' END,
        CASE WHEN p_resident_name IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.sot_requests r
          JOIN trapper.sot_people req ON r.requester_person_id = req.person_id
          WHERE r.place_id = pl.place_id AND similarity(LOWER(req.display_name), LOWER(p_resident_name)) > 0.5
        ) THEN 'resident_name_match' END,
        CASE WHEN p_context_trapper_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.sot_requests r
          JOIN trapper.request_trapper_assignments rta ON r.request_id = rta.request_id
          WHERE r.place_id = pl.place_id AND rta.trapper_person_id = p_context_trapper_id
        ) THEN 'trapper_assigned' END
      ], NULL) AS signals,

      -- Has active request?
      EXISTS (
        SELECT 1 FROM trapper.sot_requests r
        WHERE r.place_id = pl.place_id
          AND r.status NOT IN ('completed', 'cancelled')
      ) AS has_active,

      -- Request count
      (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = pl.place_id)::INT AS req_count

    FROM trapper.places pl
    WHERE pl.merged_into_place_id IS NULL  -- Only canonical
      AND (
        LOWER(pl.formatted_address) LIKE v_address_pattern
        OR pl.normalized_address LIKE v_address_pattern
      )
  )
  SELECT
    pm.place_id,
    pm.formatted_address,
    pm.display_name,
    (pm.address_score + pm.resident_score + pm.trapper_context_score)::NUMERIC AS match_score,
    pm.signals AS matched_signals,
    CASE
      WHEN pm.has_active THEN 'Active request at this address'
      WHEN pm.req_count > 0 THEN pm.req_count || ' past requests'
      ELSE 'No requests on file'
    END AS context_notes,
    pm.has_active AS has_active_request,
    pm.req_count AS request_count
  FROM place_matches pm
  WHERE (pm.address_score + pm.resident_score + pm.trapper_context_score) > 0.30
  ORDER BY (pm.address_score + pm.resident_score + pm.trapper_context_score) DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.match_place_from_report IS
  'Find place candidates from partial address with context boosting. Returns top 5 matches.';


\echo 'Creating match_request_from_report function...'

CREATE OR REPLACE FUNCTION trapper.match_request_from_report(
  p_place_id UUID,
  p_requester_name TEXT DEFAULT NULL,
  p_trapper_id UUID DEFAULT NULL,
  p_status_filter TEXT[] DEFAULT ARRAY['new', 'triaged', 'scheduled', 'in_progress', 'on_hold']
)
RETURNS TABLE (
  request_id UUID,
  status TEXT,
  requester_name TEXT,
  place_address TEXT,
  match_score NUMERIC,
  context_notes TEXT,
  estimated_cats INT,
  cats_trapped INT,
  assigned_trappers TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.request_id,
    r.status,
    req.display_name AS requester_name,
    pl.formatted_address AS place_address,

    -- Scoring
    (
      1.00  -- Base score for place match
      + CASE WHEN p_requester_name IS NOT NULL
          AND similarity(LOWER(req.display_name), LOWER(p_requester_name)) > 0.5
        THEN 0.20 ELSE 0.00 END
      + CASE WHEN p_trapper_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM trapper.request_trapper_assignments rta
          WHERE rta.request_id = r.request_id
            AND rta.trapper_person_id = p_trapper_id
            AND rta.unassigned_at IS NULL
        ) THEN 0.30 ELSE 0.00 END
    )::NUMERIC AS match_score,

    -- Context
    'Status: ' || r.status ||
    CASE WHEN r.estimated_cat_count IS NOT NULL
      THEN ', Est. ' || r.estimated_cat_count || ' cats'
      ELSE '' END AS context_notes,

    r.estimated_cat_count,
    r.cats_trapped,

    -- Get assigned trappers
    (SELECT ARRAY_AGG(t.display_name)
     FROM trapper.request_trapper_assignments rta
     JOIN trapper.sot_people t ON rta.trapper_person_id = t.person_id
     WHERE rta.request_id = r.request_id AND rta.unassigned_at IS NULL) AS assigned_trappers

  FROM trapper.sot_requests r
  JOIN trapper.places pl ON r.place_id = pl.place_id
  LEFT JOIN trapper.sot_people req ON r.requester_person_id = req.person_id
  WHERE r.place_id = p_place_id
    AND (p_status_filter IS NULL OR r.status = ANY(p_status_filter))
  ORDER BY
    -- Prefer requests where this trapper is assigned
    CASE WHEN p_trapper_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM trapper.request_trapper_assignments rta
      WHERE rta.request_id = r.request_id AND rta.trapper_person_id = p_trapper_id
    ) THEN 0 ELSE 1 END,
    -- Then by status priority
    CASE r.status
      WHEN 'in_progress' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'on_hold' THEN 3
      WHEN 'triaged' THEN 4
      ELSE 5
    END,
    r.source_created_at DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.match_request_from_report IS
  'Find request candidates at a place with trapper/requester context. Returns top 5 matches.';


-- =============================================================================
-- COMMIT FUNCTIONS
-- =============================================================================

\echo 'Creating commit_trapper_report_item function...'

CREATE OR REPLACE FUNCTION trapper.commit_trapper_report_item(
  p_item_id UUID,
  p_committed_by TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
  v_item RECORD;
  v_entity_id UUID;
  v_data JSONB;
  v_result JSONB;
  v_edit_id UUID;
  v_old_values JSONB;
  v_new_values JSONB;
BEGIN
  -- Get the item
  SELECT * INTO v_item
  FROM trapper.trapper_report_items
  WHERE item_id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;

  IF v_item.review_status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not approved');
  END IF;

  IF v_item.committed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item already committed');
  END IF;

  -- Use final data if staff edited, otherwise extracted data
  v_data := COALESCE(v_item.final_data, v_item.extracted_data);
  v_entity_id := COALESCE(v_item.final_entity_id, v_item.target_entity_id);

  -- Handle each item type
  CASE v_item.item_type

    -- Add identifier to person
    WHEN 'person_identifier' THEN
      INSERT INTO trapper.person_identifiers (
        person_id, id_type, id_value_norm, id_value_raw,
        source_system, source_table
      ) VALUES (
        v_entity_id,
        v_data->>'id_type',
        LOWER(TRIM(v_data->>'id_value')),
        v_data->>'id_value',
        'trapper_report',
        'trapper_report_items'
      )
      ON CONFLICT DO NOTHING;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'person_identifier_added',
        'person_id', v_entity_id
      );

    -- Update request status
    WHEN 'request_status' THEN
      -- Get old values for audit
      SELECT jsonb_build_object('status', status, 'hold_reason', hold_reason)
      INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Update request
      UPDATE trapper.sot_requests
      SET
        status = COALESCE((v_data->>'status')::trapper.request_status, status),
        hold_reason = COALESCE(v_data->>'hold_reason', hold_reason),
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      v_new_values := jsonb_build_object(
        'status', v_data->>'status',
        'hold_reason', v_data->>'hold_reason'
      );

      -- Log to entity_edits
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values,
        source, source_record_id, edited_by
      ) VALUES (
        'request', v_entity_id, 'status_change',
        v_old_values, v_new_values,
        'trapper_report', p_item_id::TEXT, p_committed_by
      ) RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'request_status_updated',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    -- Add note to request
    WHEN 'request_note' THEN
      -- Get old notes for audit
      SELECT jsonb_build_object('notes', notes) INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Append note
      UPDATE trapper.sot_requests
      SET
        notes = COALESCE(notes, '') || E'\n\n---\n' ||
                '[Trapper Report ' || TO_CHAR(NOW(), 'YYYY-MM-DD') || ']: ' ||
                (v_data->>'note'),
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      -- Log to entity_edits
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values,
        source, source_record_id, edited_by
      ) VALUES (
        'request', v_entity_id, 'note_added',
        v_old_values, jsonb_build_object('note_added', v_data->>'note'),
        'trapper_report', p_item_id::TEXT, p_committed_by
      ) RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'request_note_added',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    -- Add colony estimate
    WHEN 'colony_estimate' THEN
      INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        total_cats_observed,
        eartip_count_observed,
        notes,
        source_type,
        observation_date,
        source_system,
        source_record_id,
        is_firsthand,
        created_by
      ) VALUES (
        v_entity_id,
        (v_data->>'remaining_max')::INT,
        (v_data->>'cats_seen')::INT,
        (v_data->>'eartips_seen')::INT,
        v_data->>'notes',
        'trapper_report',
        COALESCE((v_data->>'observation_date')::DATE, CURRENT_DATE),
        'trapper_report',
        p_item_id::TEXT,
        TRUE,
        p_committed_by
      );

      v_result := jsonb_build_object(
        'success', true,
        'action', 'colony_estimate_added',
        'place_id', v_entity_id
      );

    -- Link two sites
    WHEN 'site_relationship' THEN
      INSERT INTO trapper.place_place_edges (
        place_id_a, place_id_b,
        relationship_type_id,
        direction,
        confidence,
        note,
        source_system
      )
      SELECT
        LEAST(v_entity_id, (v_data->>'related_place_id')::UUID),
        GREATEST(v_entity_id, (v_data->>'related_place_id')::UUID),
        rt.id,
        'bidirectional',
        0.90,
        v_data->>'note',
        'trapper_report'
      FROM trapper.relationship_types rt
      WHERE rt.domain = 'place_place' AND rt.code = 'same_colony_site'
      ON CONFLICT DO NOTHING;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'site_relationship_created',
        'place_id_a', v_entity_id,
        'place_id_b', v_data->>'related_place_id'
      );

    -- Trapping progress update
    WHEN 'trapping_progress' THEN
      -- Get old values
      SELECT jsonb_build_object(
        'cats_trapped', cats_trapped,
        'estimated_cat_count', estimated_cat_count
      ) INTO v_old_values
      FROM trapper.sot_requests WHERE request_id = v_entity_id;

      -- Update request
      UPDATE trapper.sot_requests
      SET
        cats_trapped = COALESCE((v_data->>'cats_trapped')::INT, cats_trapped),
        estimated_cat_count = COALESCE((v_data->>'cats_remaining')::INT, estimated_cat_count),
        updated_at = NOW()
      WHERE request_id = v_entity_id;

      -- Log to entity_edits
      INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        old_values, new_values,
        source, source_record_id, edited_by
      ) VALUES (
        'request', v_entity_id, 'trapping_progress',
        v_old_values, v_data,
        'trapper_report', p_item_id::TEXT, p_committed_by
      ) RETURNING edit_id INTO v_edit_id;

      v_result := jsonb_build_object(
        'success', true,
        'action', 'trapping_progress_updated',
        'request_id', v_entity_id,
        'edit_id', v_edit_id
      );

    ELSE
      v_result := jsonb_build_object(
        'success', false,
        'error', 'Unknown item type: ' || v_item.item_type
      );
  END CASE;

  -- Update item as committed
  UPDATE trapper.trapper_report_items
  SET
    committed_at = NOW(),
    commit_result = v_result,
    updated_at = NOW()
  WHERE item_id = p_item_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.commit_trapper_report_item IS
  'Commit an approved trapper report item to the database with full audit trail';


-- =============================================================================
-- VIEWS
-- =============================================================================

\echo 'Creating review queue view...'

CREATE OR REPLACE VIEW trapper.v_trapper_report_review_queue AS
SELECT
  i.item_id,
  i.submission_id,
  i.item_type,
  i.target_entity_type,
  i.target_entity_id,
  i.match_confidence,
  i.match_candidates,
  i.extracted_text,
  i.extracted_data,
  i.review_status,
  i.final_entity_id,
  i.final_data,
  i.created_at AS item_created_at,

  -- Submission context
  s.reporter_email,
  s.reporter_person_id,
  s.reporter_match_confidence,
  rp.display_name AS reporter_name,
  s.raw_content,
  s.content_type,
  s.received_at,
  s.extraction_status,

  -- Matched entity details (if available)
  CASE i.target_entity_type
    WHEN 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = i.target_entity_id)
    WHEN 'place' THEN (SELECT formatted_address FROM trapper.places WHERE place_id = i.target_entity_id)
    WHEN 'request' THEN (SELECT formatted_address FROM trapper.places pl
                         JOIN trapper.sot_requests r ON r.place_id = pl.place_id
                         WHERE r.request_id = i.target_entity_id)
  END AS matched_entity_display,

  -- Confidence badge
  CASE
    WHEN i.match_confidence >= 0.95 THEN 'high'
    WHEN i.match_confidence >= 0.70 THEN 'medium'
    WHEN i.match_confidence >= 0.50 THEN 'low'
    ELSE 'uncertain'
  END AS confidence_level

FROM trapper.trapper_report_items i
JOIN trapper.trapper_report_submissions s ON s.submission_id = i.submission_id
LEFT JOIN trapper.sot_people rp ON s.reporter_person_id = rp.person_id
WHERE i.review_status = 'pending'
ORDER BY s.received_at, i.created_at;

COMMENT ON VIEW trapper.v_trapper_report_review_queue IS
  'Pending trapper report items awaiting staff review with full context';


\echo 'Creating submission stats view...'

CREATE OR REPLACE VIEW trapper.v_trapper_report_stats AS
SELECT
  s.extraction_status,
  COUNT(*) AS submission_count,
  SUM(CASE WHEN i.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_items,
  SUM(CASE WHEN i.review_status = 'approved' THEN 1 ELSE 0 END) AS approved_items,
  SUM(CASE WHEN i.committed_at IS NOT NULL THEN 1 ELSE 0 END) AS committed_items,
  MIN(s.received_at) AS oldest_submission,
  MAX(s.received_at) AS newest_submission
FROM trapper.trapper_report_submissions s
LEFT JOIN trapper.trapper_report_items i ON i.submission_id = s.submission_id
GROUP BY s.extraction_status;

COMMENT ON VIEW trapper.v_trapper_report_stats IS
  'Statistics on trapper report processing pipeline';


-- =============================================================================
-- SUMMARY
-- =============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_566 Complete: Trapper Report Ingest System'
\echo '=============================================='
\echo ''
\echo 'Tables created:'
\echo '  - trapper_report_submissions (raw reports staging)'
\echo '  - trapper_report_items (extracted items for review)'
\echo ''
\echo 'Functions created:'
\echo '  - match_person_from_report() - Find person candidates'
\echo '  - match_place_from_report() - Find place candidates'
\echo '  - match_request_from_report() - Find request candidates'
\echo '  - commit_trapper_report_item() - Commit approved items'
\echo ''
\echo 'Views created:'
\echo '  - v_trapper_report_review_queue - Pending items for review'
\echo '  - v_trapper_report_stats - Pipeline statistics'
\echo ''
