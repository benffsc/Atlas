\echo '=== MIG_733: Tiered Auto-Linking with Multi-Unit Safety ==='
\echo 'Implements safe linking strategy with place-type-aware thresholds'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Previous auto-linking used single 25m threshold for all place types.
-- This caused issues:
-- 1. Apartments/mobile homes shouldn't auto-link (need unit selection)
-- 2. Rural properties may need larger thresholds
-- 3. No audit trail for linking decisions
--
-- SOLUTION:
-- 1. Tiered thresholds by place_kind
-- 2. Multi-unit places flagged for manual review (never auto-link)
-- 3. Full audit trail for all linking decisions
-- ============================================================================

-- ============================================================================
-- PART 1: Add columns for linking workflow
-- ============================================================================

\echo 'Adding linking workflow columns...'

ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS suggested_parent_place_id UUID REFERENCES trapper.places(place_id),
  ADD COLUMN IF NOT EXISTS requires_unit_selection BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS link_review_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS link_reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS link_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extracted_address TEXT,
  ADD COLUMN IF NOT EXISTS extracted_address_confidence NUMERIC(3,2);

-- Add constraint for link_review_status
DO $$
BEGIN
  ALTER TABLE trapper.google_map_entries
    ADD CONSTRAINT chk_link_review_status
    CHECK (link_review_status IN ('pending', 'approved', 'rejected', 'skipped'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Index for review queue
CREATE INDEX IF NOT EXISTS idx_gme_link_review_pending
  ON trapper.google_map_entries(link_review_status)
  WHERE link_review_status = 'pending';

COMMENT ON COLUMN trapper.google_map_entries.suggested_parent_place_id IS
  'For multi-unit entries, the parent building to help with unit selection';
COMMENT ON COLUMN trapper.google_map_entries.requires_unit_selection IS
  'TRUE if entry is near a multi-unit place and needs manual unit selection';
COMMENT ON COLUMN trapper.google_map_entries.link_review_status IS
  'Status in linking review workflow: pending, approved, rejected, skipped';
COMMENT ON COLUMN trapper.google_map_entries.extracted_address IS
  'Address extracted from notes by AI classification';

-- ============================================================================
-- PART 2: Create link audit table
-- ============================================================================

\echo 'Creating link audit table...'

CREATE TABLE IF NOT EXISTS trapper.google_entry_link_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES trapper.google_map_entries(entry_id),
  action TEXT NOT NULL CHECK (action IN ('linked', 'unlinked', 'rejected', 'skipped', 'flagged_multiunit')),
  place_id UUID REFERENCES trapper.places(place_id),
  link_method TEXT,
  confidence NUMERIC(3,2),
  performed_by TEXT DEFAULT 'system',
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_gel_audit_entry ON trapper.google_entry_link_audit(entry_id);
CREATE INDEX IF NOT EXISTS idx_gel_audit_place ON trapper.google_entry_link_audit(place_id);
CREATE INDEX IF NOT EXISTS idx_gel_audit_time ON trapper.google_entry_link_audit(performed_at DESC);

COMMENT ON TABLE trapper.google_entry_link_audit IS
  'Audit trail for all Google Maps entry linking decisions';

-- ============================================================================
-- PART 3: Function to get appropriate distance threshold by place kind
-- ============================================================================

\echo 'Creating get_link_threshold_for_place function...'

CREATE OR REPLACE FUNCTION trapper.get_link_threshold_for_place(p_place_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    -- Multi-unit: never auto-link
    WHEN trapper.is_multi_unit_place(p_place_id) THEN 0
    -- Rural/outdoor: larger footprint
    WHEN p.place_kind = 'outdoor_site' THEN 30
    -- Business: larger footprint
    WHEN p.place_kind = 'business' THEN 20
    -- Residential: standard
    WHEN p.place_kind = 'residential_house' THEN 15
    -- Unknown: conservative
    ELSE 10
  END
  FROM trapper.places p
  WHERE p.place_id = p_place_id;
$$;

COMMENT ON FUNCTION trapper.get_link_threshold_for_place IS
  'Returns the appropriate auto-link distance threshold in meters for a place based on its type';

-- ============================================================================
-- PART 4: Tiered auto-linking function
-- ============================================================================

\echo 'Creating link_google_entries_tiered function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_tiered(
  p_limit INT DEFAULT 1000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  residential_linked INT,
  business_linked INT,
  rural_linked INT,
  multi_unit_flagged INT,
  total_linked INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_residential INT := 0;
  v_business INT := 0;
  v_rural INT := 0;
  v_multi_unit INT := 0;
  v_total INT := 0;
BEGIN
  -- Step 1: Flag multi-unit candidates (never auto-link)
  IF NOT p_dry_run THEN
    WITH flagged AS (
      UPDATE trapper.google_map_entries e
      SET
        requires_unit_selection = TRUE,
        suggested_parent_place_id = COALESCE(p.parent_place_id, p.place_id),
        link_review_status = 'pending'
      FROM trapper.places p
      WHERE p.place_id = e.nearest_place_id
        AND e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND e.nearest_place_distance_m < 50
        AND trapper.is_multi_unit_place(p.place_id)
      RETURNING e.entry_id, p.place_id
    ),
    audit_insert AS (
      INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, notes)
      SELECT entry_id, 'flagged_multiunit', place_id, 'auto_tiered', 'Near multi-unit place, requires unit selection'
      FROM flagged
    )
    SELECT COUNT(*) INTO v_multi_unit FROM flagged;
  ELSE
    SELECT COUNT(*) INTO v_multi_unit
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND e.nearest_place_distance_m < 50
      AND trapper.is_multi_unit_place(p.place_id);
  END IF;

  -- Step 2: Auto-link residential (threshold 15m)
  IF NOT p_dry_run THEN
    WITH linked AS (
      UPDATE trapper.google_map_entries e
      SET
        linked_place_id = e.nearest_place_id,
        link_confidence = CASE
          WHEN e.nearest_place_distance_m <= 5 THEN 0.99
          WHEN e.nearest_place_distance_m <= 10 THEN 0.95
          ELSE 0.90
        END,
        link_method = 'auto_tiered_residential'
      FROM trapper.places p
      WHERE p.place_id = e.nearest_place_id
        AND e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND p.place_kind = 'residential_house'
        AND e.nearest_place_distance_m <= 15
        AND NOT trapper.is_multi_unit_place(p.place_id)
      RETURNING e.entry_id, e.nearest_place_id as place_id, e.link_confidence
    ),
    audit_insert AS (
      INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, confidence)
      SELECT entry_id, 'linked', place_id, 'auto_tiered_residential', link_confidence
      FROM linked
    )
    SELECT COUNT(*) INTO v_residential FROM linked;
  ELSE
    SELECT COUNT(*) INTO v_residential
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND p.place_kind = 'residential_house'
      AND e.nearest_place_distance_m <= 15
      AND NOT trapper.is_multi_unit_place(p.place_id);
  END IF;

  -- Step 3: Auto-link business (threshold 20m)
  IF NOT p_dry_run THEN
    WITH linked AS (
      UPDATE trapper.google_map_entries e
      SET
        linked_place_id = e.nearest_place_id,
        link_confidence = CASE
          WHEN e.nearest_place_distance_m <= 10 THEN 0.95
          ELSE 0.88
        END,
        link_method = 'auto_tiered_business'
      FROM trapper.places p
      WHERE p.place_id = e.nearest_place_id
        AND e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND p.place_kind = 'business'
        AND e.nearest_place_distance_m <= 20
        AND NOT trapper.is_multi_unit_place(p.place_id)
      RETURNING e.entry_id, e.nearest_place_id as place_id, e.link_confidence
    ),
    audit_insert AS (
      INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, confidence)
      SELECT entry_id, 'linked', place_id, 'auto_tiered_business', link_confidence
      FROM linked
    )
    SELECT COUNT(*) INTO v_business FROM linked;
  ELSE
    SELECT COUNT(*) INTO v_business
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND p.place_kind = 'business'
      AND e.nearest_place_distance_m <= 20
      AND NOT trapper.is_multi_unit_place(p.place_id);
  END IF;

  -- Step 4: Auto-link rural/outdoor (threshold 30m)
  IF NOT p_dry_run THEN
    WITH linked AS (
      UPDATE trapper.google_map_entries e
      SET
        linked_place_id = e.nearest_place_id,
        link_confidence = CASE
          WHEN e.nearest_place_distance_m <= 15 THEN 0.92
          ELSE 0.85
        END,
        link_method = 'auto_tiered_rural'
      FROM trapper.places p
      WHERE p.place_id = e.nearest_place_id
        AND e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND p.place_kind = 'outdoor_site'
        AND e.nearest_place_distance_m <= 30
        AND NOT trapper.is_multi_unit_place(p.place_id)
      RETURNING e.entry_id, e.nearest_place_id as place_id, e.link_confidence
    ),
    audit_insert AS (
      INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, confidence)
      SELECT entry_id, 'linked', place_id, 'auto_tiered_rural', link_confidence
      FROM linked
    )
    SELECT COUNT(*) INTO v_rural FROM linked;
  ELSE
    SELECT COUNT(*) INTO v_rural
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND p.place_kind = 'outdoor_site'
      AND e.nearest_place_distance_m <= 30
      AND NOT trapper.is_multi_unit_place(p.place_id);
  END IF;

  -- Step 5: Auto-link unknown places with conservative threshold (10m)
  IF NOT p_dry_run THEN
    WITH linked AS (
      UPDATE trapper.google_map_entries e
      SET
        linked_place_id = e.nearest_place_id,
        link_confidence = CASE
          WHEN e.nearest_place_distance_m <= 5 THEN 0.95
          ELSE 0.88
        END,
        link_method = 'auto_tiered_unknown'
      FROM trapper.places p
      WHERE p.place_id = e.nearest_place_id
        AND e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND p.place_kind IN ('unknown', 'neighborhood', 'clinic')
        AND e.nearest_place_distance_m <= 10
        AND NOT trapper.is_multi_unit_place(p.place_id)
      RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_total FROM linked;
    v_total := v_total + v_residential + v_business + v_rural;
  ELSE
    SELECT COUNT(*) INTO v_total
    FROM trapper.google_map_entries e
    JOIN trapper.places p ON p.place_id = e.nearest_place_id
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND p.place_kind IN ('unknown', 'neighborhood', 'clinic')
      AND e.nearest_place_distance_m <= 10
      AND NOT trapper.is_multi_unit_place(p.place_id);
    v_total := v_total + v_residential + v_business + v_rural;
  END IF;

  RETURN QUERY SELECT v_residential, v_business, v_rural, v_multi_unit, v_total;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_tiered IS
  'Auto-links Google Maps entries using place-type-aware distance thresholds. Multi-unit places are flagged for manual review.';

-- ============================================================================
-- PART 5: Function to link from AI entity suggestions
-- ============================================================================

\echo 'Creating link_google_entries_from_ai function...'

CREATE OR REPLACE FUNCTION trapper.link_google_entries_from_ai(
  p_limit INT DEFAULT 1000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  ai_linked INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  IF NOT p_dry_run THEN
    WITH linked AS (
      UPDATE trapper.google_map_entries e
      SET
        linked_place_id = (e.ai_classification->'entity_links'->>'place_id')::UUID,
        link_confidence = 0.92,
        link_method = 'ai_entity_link'
      WHERE e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.link_review_status IS NULL
        AND e.requires_unit_selection = FALSE
        AND e.ai_classification->'entity_links'->>'place_id' IS NOT NULL
        AND e.ai_classification->'entity_links'->>'place_confidence' = 'high'
        AND (e.ai_classification->'entity_links'->>'is_same_as_nearby_place')::boolean = TRUE
        AND e.nearest_place_distance_m < 100
        AND NOT trapper.is_multi_unit_place(
          (e.ai_classification->'entity_links'->>'place_id')::UUID
        )
      RETURNING e.entry_id, (e.ai_classification->'entity_links'->>'place_id')::UUID as place_id
    ),
    audit_insert AS (
      INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, confidence, notes)
      SELECT entry_id, 'linked', place_id, 'ai_entity_link', 0.92, 'AI high confidence + is_same_as_nearby_place'
      FROM linked
    )
    SELECT COUNT(*) INTO v_linked FROM linked;
  ELSE
    SELECT COUNT(*) INTO v_linked
    FROM trapper.google_map_entries e
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.link_review_status IS NULL
      AND e.requires_unit_selection = FALSE
      AND e.ai_classification->'entity_links'->>'place_id' IS NOT NULL
      AND e.ai_classification->'entity_links'->>'place_confidence' = 'high'
      AND (e.ai_classification->'entity_links'->>'is_same_as_nearby_place')::boolean = TRUE
      AND e.nearest_place_distance_m < 100;
  END IF;

  RETURN QUERY SELECT v_linked;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_entries_from_ai IS
  'Links Google Maps entries using high-confidence AI entity_links suggestions';

-- ============================================================================
-- PART 6: Update manual link function to add audit
-- ============================================================================

\echo 'Updating manual_link_google_entry to include audit...'

CREATE OR REPLACE FUNCTION trapper.manual_link_google_entry(
  p_entry_id UUID,
  p_place_id UUID,
  p_linked_by TEXT DEFAULT 'web_app'
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry RECORD;
  v_place RECORD;
BEGIN
  -- Validate entry exists
  SELECT entry_id, kml_name, linked_place_id
  INTO v_entry
  FROM trapper.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found'::TEXT;
    RETURN;
  END IF;

  -- Validate place exists and is not merged
  SELECT place_id, formatted_address, merged_into_place_id
  INTO v_place
  FROM trapper.places
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Place not found'::TEXT;
    RETURN;
  END IF;

  IF v_place.merged_into_place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Place has been merged - use the merged place instead'::TEXT;
    RETURN;
  END IF;

  -- Link the entry
  UPDATE trapper.google_map_entries
  SET
    linked_place_id = p_place_id,
    link_confidence = 1.0,
    link_method = 'manual',
    link_review_status = 'approved',
    link_reviewed_by = p_linked_by,
    link_reviewed_at = NOW(),
    requires_unit_selection = FALSE,
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  -- Add audit entry
  INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, confidence, performed_by, notes)
  VALUES (p_entry_id, 'linked', p_place_id, 'manual', 1.0, p_linked_by, 'Manual link by staff');

  RETURN QUERY SELECT TRUE,
    format('Linked "%s" to "%s"', v_entry.kml_name, v_place.formatted_address)::TEXT;
END;
$$;

-- ============================================================================
-- PART 7: Update unlink function to add audit
-- ============================================================================

\echo 'Updating unlink_google_entry to include audit...'

CREATE OR REPLACE FUNCTION trapper.unlink_google_entry(
  p_entry_id UUID,
  p_unlinked_by TEXT DEFAULT 'web_app'
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry RECORD;
  v_old_place_id UUID;
BEGIN
  -- Get entry
  SELECT entry_id, kml_name, place_id, linked_place_id
  INTO v_entry
  FROM trapper.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found'::TEXT;
    RETURN;
  END IF;

  IF v_entry.place_id IS NULL AND v_entry.linked_place_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Entry is not linked to any place'::TEXT;
    RETURN;
  END IF;

  -- Cannot unlink entries with place_id (those are from original import)
  IF v_entry.place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Cannot unlink entries with original place_id - only linked_place_id can be removed'::TEXT;
    RETURN;
  END IF;

  v_old_place_id := v_entry.linked_place_id;

  -- Unlink
  UPDATE trapper.google_map_entries
  SET
    linked_place_id = NULL,
    linked_person_id = NULL,
    link_confidence = NULL,
    link_method = NULL,
    link_review_status = NULL,
    link_reviewed_by = NULL,
    link_reviewed_at = NULL,
    requires_unit_selection = FALSE,
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  -- Add audit entry
  INSERT INTO trapper.google_entry_link_audit (entry_id, action, place_id, link_method, performed_by, notes)
  VALUES (p_entry_id, 'unlinked', v_old_place_id, 'manual_unlink', p_unlinked_by, 'Unlinked by staff');

  RETURN QUERY SELECT TRUE, format('Unlinked "%s"', v_entry.kml_name)::TEXT;
END;
$$;

-- ============================================================================
-- PART 8: Run tiered linking
-- ============================================================================

\echo ''
\echo 'Running tiered auto-linking (dry run first)...'
SELECT * FROM trapper.link_google_entries_tiered(5000, TRUE);

\echo 'Running tiered auto-linking (actual)...'
SELECT * FROM trapper.link_google_entries_tiered(5000, FALSE);

\echo ''
\echo 'Running AI-based linking (dry run first)...'
SELECT * FROM trapper.link_google_entries_from_ai(5000, TRUE);

\echo 'Running AI-based linking (actual)...'
SELECT * FROM trapper.link_google_entries_from_ai(5000, FALSE);

-- ============================================================================
-- PART 9: Summary
-- ============================================================================

\echo ''
\echo 'Current linking status:'
SELECT
  CASE
    WHEN place_id IS NOT NULL OR linked_place_id IS NOT NULL THEN 'Linked to place'
    WHEN requires_unit_selection THEN 'Needs unit selection'
    ELSE 'Unlinked (historical dot)'
  END as status,
  COUNT(*) as count
FROM trapper.google_map_entries
WHERE lat IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Link methods used:'
SELECT link_method, COUNT(*) as count
FROM trapper.google_map_entries
WHERE linked_place_id IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Audit trail summary:'
SELECT action, COUNT(*) as count
FROM trapper.google_entry_link_audit
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo '=== MIG_733 Summary ==='
\echo 'Created tiered auto-linking with place-type-aware thresholds:'
\echo '  - Residential: 15m'
\echo '  - Business: 20m'
\echo '  - Rural/Outdoor: 30m'
\echo '  - Unknown: 10m (conservative)'
\echo '  - Multi-unit: NEVER auto-link (flagged for review)'
\echo ''
\echo 'Functions created/updated:'
\echo '  - link_google_entries_tiered(limit, dry_run)'
\echo '  - link_google_entries_from_ai(limit, dry_run)'
\echo '  - manual_link_google_entry (now with audit)'
\echo '  - unlink_google_entry (now with audit)'
\echo '  - get_link_threshold_for_place(place_id)'
\echo ''
\echo 'Tables created:'
\echo '  - google_entry_link_audit'
\echo '=== MIG_733 Complete ==='
