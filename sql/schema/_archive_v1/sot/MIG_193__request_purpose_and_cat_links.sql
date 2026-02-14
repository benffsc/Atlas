-- MIG_193: Request Purpose & Cat Link Tracking
-- Adds request purpose (TNR, Wellness, Hybrid) and cat link purpose tracking
--
-- Problem: Requests conflate "cats needing TNR" with "cats at location"
-- When ear-tipped cats come in for wellness or by accident, it throws off counts.
--
-- Solution:
-- 1. Explicit request_purpose to distinguish TNR vs wellness vs hybrid
-- 2. Separate wellness_cat_count from estimated_cat_count (TNR targets)
-- 3. request_cat_links with purpose for explicit cat associations
-- 4. No retroactive linking required - old data stays intact

\echo '=============================================='
\echo 'MIG_193: Request Purpose & Cat Link Tracking'
\echo '=============================================='

-- ============================================
-- PART 1: Request Purpose Enum
-- ============================================

\echo 'Creating request_purpose enum...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_purpose') THEN
    CREATE TYPE trapper.request_purpose AS ENUM (
      'tnr',           -- Standard TNR request - cats need fixing
      'wellness',      -- Wellness check on already-altered cats
      'hybrid',        -- Mix: some need TNR, some wellness
      'relocation',    -- Trapping assistance for relocation (no TNR)
      'rescue'         -- Emergency rescue/trapping assistance
    );
  END IF;
END $$;

-- ============================================
-- PART 2: Cat Link Purpose Enum
-- ============================================

\echo 'Creating cat_link_purpose enum...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cat_link_purpose') THEN
    CREATE TYPE trapper.cat_link_purpose AS ENUM (
      'tnr_target',     -- Unfixed cat, needs TNR (counts toward work)
      'wellness',       -- Already fixed, wellness visit
      'documentation',  -- Just documenting/photo for records
      'accidental'      -- Ear-tipped cat caught by accident
    );
  END IF;
END $$;

-- ============================================
-- PART 3: Add columns to sot_requests
-- ============================================

\echo 'Adding request_purpose and wellness columns to sot_requests...'

ALTER TABLE trapper.sot_requests
  ADD COLUMN IF NOT EXISTS request_purpose trapper.request_purpose DEFAULT 'tnr',
  ADD COLUMN IF NOT EXISTS wellness_cat_count INTEGER;

COMMENT ON COLUMN trapper.sot_requests.request_purpose IS
'Purpose of request: tnr (cats need fixing), wellness (checking altered cats), hybrid (both)';

COMMENT ON COLUMN trapper.sot_requests.wellness_cat_count IS
'Number of already-altered cats for wellness check (wellness/hybrid requests only)';

-- ============================================
-- PART 4: Add columns to raw_intake_request
-- ============================================

\echo 'Adding columns to raw_intake_request...'

ALTER TABLE trapper.raw_intake_request
  ADD COLUMN IF NOT EXISTS raw_request_purpose TEXT,
  ADD COLUMN IF NOT EXISTS raw_wellness_cat_count INTEGER;

-- ============================================
-- PART 5: Request-Cat Links Table
-- ============================================

\echo 'Creating request_cat_links table...'

CREATE TABLE IF NOT EXISTS trapper.request_cat_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,
  cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE,
  link_purpose trapper.cat_link_purpose NOT NULL DEFAULT 'tnr_target',
  link_notes TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by TEXT NOT NULL DEFAULT 'system',
  -- Prevent duplicate links
  CONSTRAINT uq_request_cat_link UNIQUE (request_id, cat_id)
);

CREATE INDEX IF NOT EXISTS idx_request_cat_links_request
  ON trapper.request_cat_links(request_id);

CREATE INDEX IF NOT EXISTS idx_request_cat_links_cat
  ON trapper.request_cat_links(cat_id);

CREATE INDEX IF NOT EXISTS idx_request_cat_links_purpose
  ON trapper.request_cat_links(link_purpose);

COMMENT ON TABLE trapper.request_cat_links IS
'Explicit links between requests and cats with purpose tracking.
Only populated when cats are explicitly associated (photo upload, etc.).
Old requests without links are fine - counts stand on their own.';

-- ============================================
-- PART 6: View for request cat summary
-- ============================================

\echo 'Creating request cat summary view...'

CREATE OR REPLACE VIEW trapper.v_request_cat_summary AS
SELECT
  r.request_id,
  r.request_purpose::TEXT,
  r.estimated_cat_count AS tnr_target_count,
  r.wellness_cat_count,
  r.eartip_count AS known_eartipped_count,
  r.eartip_estimate::TEXT,
  -- Linked cat counts by purpose
  (SELECT COUNT(*) FROM trapper.request_cat_links l
   WHERE l.request_id = r.request_id AND l.link_purpose = 'tnr_target') AS linked_tnr_cats,
  (SELECT COUNT(*) FROM trapper.request_cat_links l
   WHERE l.request_id = r.request_id AND l.link_purpose = 'wellness') AS linked_wellness_cats,
  (SELECT COUNT(*) FROM trapper.request_cat_links l
   WHERE l.request_id = r.request_id AND l.link_purpose = 'documentation') AS linked_documentation_cats,
  (SELECT COUNT(*) FROM trapper.request_cat_links l
   WHERE l.request_id = r.request_id AND l.link_purpose = 'accidental') AS linked_accidental_cats,
  (SELECT COUNT(*) FROM trapper.request_cat_links l
   WHERE l.request_id = r.request_id) AS total_linked_cats
FROM trapper.sot_requests r;

-- ============================================
-- PART 7: Function to link cat to request
-- ============================================

\echo 'Creating link_cat_to_request function...'

CREATE OR REPLACE FUNCTION trapper.link_cat_to_request(
  p_request_id UUID,
  p_cat_id UUID,
  p_purpose trapper.cat_link_purpose DEFAULT 'tnr_target',
  p_notes TEXT DEFAULT NULL,
  p_linked_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_link_id UUID;
BEGIN
  INSERT INTO trapper.request_cat_links (
    request_id, cat_id, link_purpose, link_notes, linked_by
  ) VALUES (
    p_request_id, p_cat_id, p_purpose, p_notes, p_linked_by
  )
  ON CONFLICT (request_id, cat_id) DO UPDATE SET
    link_purpose = EXCLUDED.link_purpose,
    link_notes = COALESCE(EXCLUDED.link_notes, trapper.request_cat_links.link_notes),
    linked_by = EXCLUDED.linked_by
  RETURNING link_id INTO v_link_id;

  RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 8: Update promote_intake_request
-- ============================================

\echo 'Updating promote_intake_request to handle new fields...'

-- We need to update the existing function to include the new fields
-- First, let's check if it exists and update it

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
  p_raw_id UUID,
  p_promoted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_raw RECORD;
  v_request_id UUID;
  v_place_id UUID;
  v_person_id UUID;
BEGIN
  -- Get the raw intake record
  SELECT * INTO v_raw
  FROM trapper.raw_intake_request
  WHERE raw_id = p_raw_id
    AND intake_status IN ('pending', 'validated', 'needs_review');

  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Use existing place_id if provided, or try to find/create from address
  v_place_id := v_raw.place_id;

  -- Use existing person_id if provided
  v_person_id := v_raw.requester_person_id;

  -- Create the request
  INSERT INTO trapper.sot_requests (
    -- Request Purpose
    request_purpose,
    -- Location
    place_id,
    property_type,
    location_description,
    -- Contact
    requester_person_id,
    property_owner_contact,
    property_owner_name,
    property_owner_phone,
    best_contact_times,
    -- Permission & Access
    permission_status,
    access_notes,
    traps_overnight_safe,
    access_without_contact,
    authorization_pending,
    -- About the Cats
    estimated_cat_count,
    wellness_cat_count,
    count_confidence,
    colony_duration,
    eartip_count,
    eartip_estimate,
    cats_are_friendly,
    -- Kittens
    has_kittens,
    kitten_count,
    kitten_age_weeks,
    -- Feeding
    is_being_fed,
    feeder_name,
    feeding_schedule,
    best_times_seen,
    -- Urgency
    urgency_reasons,
    urgency_deadline,
    urgency_notes,
    priority,
    -- Additional
    summary,
    notes,
    -- Meta
    data_source,
    source_system,
    created_by
  ) VALUES (
    COALESCE(v_raw.raw_request_purpose, 'tnr')::trapper.request_purpose,
    v_place_id,
    v_raw.raw_property_type::trapper.property_type,
    v_raw.raw_location_description,
    v_person_id,
    v_raw.raw_property_owner_contact,
    v_raw.raw_property_owner_name,
    v_raw.raw_property_owner_phone,
    v_raw.raw_best_contact_times,
    COALESCE(v_raw.raw_permission_status, 'unknown')::trapper.permission_status,
    v_raw.raw_access_notes,
    v_raw.raw_traps_overnight_safe,
    v_raw.raw_access_without_contact,
    COALESCE(v_raw.raw_authorization_pending, FALSE),
    v_raw.raw_estimated_cat_count,
    v_raw.raw_wellness_cat_count,
    COALESCE(v_raw.raw_count_confidence, 'unknown')::trapper.count_confidence,
    COALESCE(v_raw.raw_colony_duration, 'unknown')::trapper.colony_duration,
    v_raw.raw_eartip_count,
    COALESCE(v_raw.raw_eartip_estimate, 'unknown')::trapper.eartip_estimate,
    v_raw.raw_cats_are_friendly,
    COALESCE(v_raw.raw_has_kittens, FALSE),
    v_raw.raw_kitten_count,
    v_raw.raw_kitten_age_weeks,
    v_raw.raw_is_being_fed,
    v_raw.raw_feeder_name,
    v_raw.raw_feeding_schedule,
    v_raw.raw_best_times_seen,
    v_raw.raw_urgency_reasons,
    v_raw.raw_urgency_deadline,
    v_raw.raw_urgency_notes,
    COALESCE(v_raw.raw_priority, 'normal')::trapper.request_priority,
    v_raw.raw_summary,
    v_raw.raw_notes,
    'app',
    v_raw.source_system,
    p_promoted_by
  )
  RETURNING request_id INTO v_request_id;

  -- Update raw record as promoted
  UPDATE trapper.raw_intake_request
  SET intake_status = 'promoted',
      promoted_request_id = v_request_id,
      promoted_at = NOW(),
      promoted_by = p_promoted_by
  WHERE raw_id = p_raw_id;

  -- Log to audit
  INSERT INTO trapper.intake_audit_log (
    raw_table, raw_id, sot_table, sot_id,
    action, promoted_by, promotion_reason
  ) VALUES (
    'raw_intake_request', p_raw_id, 'sot_requests', v_request_id,
    'create', p_promoted_by, 'standard_promotion'
  );

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 9: Helper view for request display
-- ============================================

\echo 'Creating request purpose display view...'

CREATE OR REPLACE VIEW trapper.v_request_purpose_display AS
SELECT
  r.request_id,
  r.request_purpose::TEXT,
  CASE r.request_purpose
    WHEN 'tnr' THEN
      COALESCE(r.estimated_cat_count::TEXT, '?') || ' cats to fix' ||
      CASE WHEN r.eartip_count > 0 THEN ' (' || r.eartip_count || ' ear-tipped at location)'
           WHEN r.eartip_estimate != 'unknown' AND r.eartip_estimate != 'none' THEN ' (' || r.eartip_estimate || ' ear-tipped)'
           ELSE '' END
    WHEN 'wellness' THEN
      'Wellness check on ' || COALESCE(r.wellness_cat_count::TEXT, '?') || ' altered cats'
    WHEN 'hybrid' THEN
      COALESCE(r.estimated_cat_count::TEXT, '?') || ' to fix + wellness on ' ||
      COALESCE(r.wellness_cat_count::TEXT, '?') || ' altered'
    WHEN 'relocation' THEN
      'Relocation assistance - ' || COALESCE(r.estimated_cat_count::TEXT, '?') || ' cats'
    WHEN 'rescue' THEN
      'Rescue/trapping assistance - ' || COALESCE(r.estimated_cat_count::TEXT, '?') || ' cats'
    ELSE 'Unknown'
  END AS purpose_summary,
  r.estimated_cat_count,
  r.wellness_cat_count,
  r.eartip_count,
  r.eartip_estimate::TEXT
FROM trapper.sot_requests r;

\echo ''
\echo 'MIG_193 complete!'
\echo ''
\echo 'Created:'
\echo '  - Enum: trapper.request_purpose (tnr, wellness, hybrid, relocation, rescue)'
\echo '  - Enum: trapper.cat_link_purpose (tnr_target, wellness, documentation, accidental)'
\echo '  - Column: sot_requests.request_purpose'
\echo '  - Column: sot_requests.wellness_cat_count'
\echo '  - Table: trapper.request_cat_links'
\echo '  - Function: trapper.link_cat_to_request()'
\echo '  - View: trapper.v_request_cat_summary'
\echo '  - View: trapper.v_request_purpose_display'
\echo ''
\echo 'Notes:'
\echo '  - Old requests default to request_purpose=tnr'
\echo '  - No retroactive linking required'
\echo '  - Cat links only created when explicitly associating cats'
