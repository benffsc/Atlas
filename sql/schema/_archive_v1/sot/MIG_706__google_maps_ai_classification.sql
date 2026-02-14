-- ============================================================================
-- MIG_706: Google Maps AI Classification System
-- ============================================================================
-- Purpose: Add AI-based classification of Google Maps entries based on TEXT
-- content rather than unreliable icon colors.
--
-- Priority Classifications:
-- 1. Disease Risk (FeLV/FIV) - Staff safety
-- 2. Watch List - Difficult clients
-- 3. Volunteers - Community helpers
-- 4. Relocation Clients - Cat relocators
-- 5. Colony Info - Active/historical colonies
--
-- Key Insight: Icon colors don't reliably indicate meaning. TEXT is truth.
-- ============================================================================

\echo '=== MIG_706: Google Maps AI Classification System ==='

-- Add AI classification columns to google_map_entries
ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS ai_classification JSONB,
  ADD COLUMN IF NOT EXISTS ai_meaning TEXT,
  ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_place_id UUID REFERENCES trapper.places(place_id),
  ADD COLUMN IF NOT EXISTS linked_person_id UUID REFERENCES trapper.sot_people(person_id),
  ADD COLUMN IF NOT EXISTS linked_request_id UUID REFERENCES trapper.sot_requests(request_id),
  ADD COLUMN IF NOT EXISTS link_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS link_method TEXT;

COMMENT ON COLUMN trapper.google_map_entries.ai_classification IS 'Full AI classification result including signals extracted from text';
COMMENT ON COLUMN trapper.google_map_entries.ai_meaning IS 'Primary classification type (disease_risk, watch_list, volunteer, etc.)';
COMMENT ON COLUMN trapper.google_map_entries.ai_classified_at IS 'When AI classification was performed';
COMMENT ON COLUMN trapper.google_map_entries.linked_place_id IS 'Linked Atlas place (by proximity or address match)';
COMMENT ON COLUMN trapper.google_map_entries.linked_person_id IS 'Linked Atlas person (by phone or name match)';
COMMENT ON COLUMN trapper.google_map_entries.linked_request_id IS 'Linked Atlas request (if applicable)';
COMMENT ON COLUMN trapper.google_map_entries.link_confidence IS 'Confidence in entity link (0-1)';
COMMENT ON COLUMN trapper.google_map_entries.link_method IS 'How entity was linked: proximity, address_match, phone_match, name_match';

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_gme_ai_meaning ON trapper.google_map_entries(ai_meaning);
CREATE INDEX IF NOT EXISTS idx_gme_linked_place ON trapper.google_map_entries(linked_place_id) WHERE linked_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gme_linked_person ON trapper.google_map_entries(linked_person_id) WHERE linked_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gme_ai_classified_at ON trapper.google_map_entries(ai_classified_at) WHERE ai_classified_at IS NOT NULL;

-- Classification lookup table for display and priority
CREATE TABLE IF NOT EXISTS trapper.google_map_classification_types (
  classification_type TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  display_color TEXT NOT NULL,  -- Hex color for map display
  priority INT NOT NULL,        -- Lower = more important (1 = highest)
  description TEXT,
  staff_alert BOOLEAN DEFAULT FALSE  -- Show warning to staff
);

COMMENT ON TABLE trapper.google_map_classification_types IS 'Lookup table for Google Maps AI classification types with display settings';
COMMENT ON COLUMN trapper.google_map_classification_types.priority IS 'Display priority: 1=highest (disease risk), 99=lowest (unclassified)';
COMMENT ON COLUMN trapper.google_map_classification_types.staff_alert IS 'If true, show prominent warning to staff before visiting location';

-- Insert classification types in priority order
INSERT INTO trapper.google_map_classification_types
  (classification_type, display_label, display_color, priority, description, staff_alert)
VALUES
  ('disease_risk', 'Disease Risk', '#FF0000', 1, 'FeLV, FIV, or other disease mentioned - requires extra caution', true),
  ('watch_list', 'Watch List', '#FF6600', 2, 'Difficult client or safety concern - proceed with caution', true),
  ('felv_colony', 'FeLV Colony', '#FF3300', 3, 'Active FeLV-positive colony - disease management protocols apply', true),
  ('fiv_colony', 'FIV Colony', '#FF6633', 4, 'Active FIV-positive colony - disease management protocols apply', true),
  ('volunteer', 'Volunteer', '#FFD700', 5, 'Volunteer or community helper - potential resource', false),
  ('relocation_client', 'Relocation', '#9933FF', 6, 'Client who relocates cats to barn homes or other locations', false),
  ('active_colony', 'Active Colony', '#00AA00', 7, 'Active feeding colony with details (cat counts, feeders)', false),
  ('historical_colony', 'Historical', '#808080', 8, 'Historical colony that may be resolved or inactive', false),
  ('contact_info', 'Contact Only', '#0066CC', 9, 'Contact information without colony details', false),
  ('unclassified', 'Unclassified', '#CCCCCC', 99, 'Could not determine classification from text', false)
ON CONFLICT (classification_type) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  display_color = EXCLUDED.display_color,
  priority = EXCLUDED.priority,
  description = EXCLUDED.description,
  staff_alert = EXCLUDED.staff_alert;

-- View for Beacon map with AI classifications
CREATE OR REPLACE VIEW trapper.v_google_map_entries_classified AS
SELECT
  g.entry_id,
  g.kml_name,
  g.lat,
  g.lng,
  g.original_content,
  g.ai_summary,
  g.ai_meaning,
  g.ai_classification,
  g.ai_classified_at,
  g.linked_place_id,
  g.linked_person_id,
  g.linked_request_id,
  g.link_confidence,
  g.link_method,
  g.icon_type,
  g.icon_color,
  g.icon_meaning as icon_derived_meaning,
  g.kml_folder,
  g.synced_at,
  COALESCE(ct.display_label, 'Unknown') as display_label,
  COALESCE(ct.display_color, '#CCCCCC') as display_color,
  COALESCE(ct.priority, 99) as priority,
  COALESCE(ct.staff_alert, false) as staff_alert,
  ct.description as classification_description,
  p.formatted_address as linked_address,
  p.service_zone as linked_service_zone,
  pe.display_name as linked_person_name
FROM trapper.google_map_entries g
LEFT JOIN trapper.google_map_classification_types ct ON ct.classification_type = g.ai_meaning
LEFT JOIN trapper.places p ON p.place_id = g.linked_place_id
LEFT JOIN trapper.sot_people pe ON pe.person_id = g.linked_person_id;

COMMENT ON VIEW trapper.v_google_map_entries_classified IS 'Google Maps entries with AI classification details for Beacon map display';

-- Function to link google map entries to places by proximity
CREATE OR REPLACE FUNCTION trapper.link_google_map_entries_to_places(
  p_distance_meters INT DEFAULT 50
)
RETURNS TABLE(total_linked INT, by_proximity INT) AS $$
DECLARE
  v_by_proximity INT := 0;
BEGIN
  -- Link by proximity (within specified meters of a place)
  WITH closest_places AS (
    SELECT DISTINCT ON (g.entry_id)
      g.entry_id,
      p.place_id,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
        p.location::geography
      ) as dist
    FROM trapper.google_map_entries g
    JOIN trapper.places p ON ST_DWithin(
      ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
      p.location::geography,
      p_distance_meters
    )
    WHERE g.linked_place_id IS NULL
      AND g.lat IS NOT NULL
      AND g.lng IS NOT NULL
      AND p.merged_into_place_id IS NULL
    ORDER BY g.entry_id, dist
  )
  UPDATE trapper.google_map_entries g
  SET
    linked_place_id = cp.place_id,
    link_confidence = CASE
      WHEN cp.dist < 10 THEN 0.99
      WHEN cp.dist < 25 THEN 0.95
      ELSE 0.85
    END,
    link_method = 'proximity'
  FROM closest_places cp
  WHERE g.entry_id = cp.entry_id;

  GET DIAGNOSTICS v_by_proximity = ROW_COUNT;

  RETURN QUERY SELECT v_by_proximity, v_by_proximity;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_google_map_entries_to_places IS 'Links Google Map entries to nearby Atlas places by geographic proximity';

-- Function to link google map entries to people by phone
CREATE OR REPLACE FUNCTION trapper.link_google_map_entries_to_people()
RETURNS TABLE(total_linked INT, by_phone INT) AS $$
DECLARE
  v_by_phone INT := 0;
BEGIN
  -- Link to people by phone number found in ai_classification signals
  UPDATE trapper.google_map_entries g
  SET
    linked_person_id = match.person_id,
    link_confidence = 0.95,
    link_method = 'phone_match'
  FROM (
    SELECT DISTINCT ON (g2.entry_id)
      g2.entry_id,
      pi.person_id
    FROM trapper.google_map_entries g2
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(g2.ai_classification->'signals'->'phone_numbers', '[]'::jsonb)
    ) as phone
    JOIN trapper.person_identifiers pi ON pi.id_type = 'phone'
      AND pi.id_value_norm = trapper.norm_phone_us(phone)
    WHERE g2.linked_person_id IS NULL
      AND g2.ai_classification IS NOT NULL
      AND g2.ai_classification->'signals'->'phone_numbers' IS NOT NULL
    ORDER BY g2.entry_id
  ) match
  WHERE g.entry_id = match.entry_id;

  GET DIAGNOSTICS v_by_phone = ROW_COUNT;

  RETURN QUERY SELECT v_by_phone, v_by_phone;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_google_map_entries_to_people IS 'Links Google Map entries to Atlas people by matching phone numbers found in AI-extracted signals';

-- Combined linking function
CREATE OR REPLACE FUNCTION trapper.link_google_map_entries()
RETURNS TABLE(linked_to_places INT, linked_to_people INT, total_linked INT) AS $$
DECLARE
  v_places INT;
  v_people INT;
BEGIN
  SELECT total_linked INTO v_places FROM trapper.link_google_map_entries_to_places();
  SELECT total_linked INTO v_people FROM trapper.link_google_map_entries_to_people();

  RETURN QUERY SELECT v_places, v_people, v_places + v_people;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_google_map_entries IS 'Links all unlinked Google Map entries to Atlas places and people';

-- View for classification statistics
CREATE OR REPLACE VIEW trapper.v_google_map_classification_stats AS
SELECT
  ct.classification_type,
  ct.display_label,
  ct.display_color,
  ct.priority,
  ct.staff_alert,
  COALESCE(counts.entry_count, 0) as entry_count,
  COALESCE(counts.with_place_link, 0) as with_place_link,
  COALESCE(counts.with_person_link, 0) as with_person_link
FROM trapper.google_map_classification_types ct
LEFT JOIN (
  SELECT
    ai_meaning,
    COUNT(*) as entry_count,
    COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL) as with_place_link,
    COUNT(*) FILTER (WHERE linked_person_id IS NOT NULL) as with_person_link
  FROM trapper.google_map_entries
  WHERE ai_meaning IS NOT NULL
  GROUP BY ai_meaning
) counts ON counts.ai_meaning = ct.classification_type
ORDER BY ct.priority;

COMMENT ON VIEW trapper.v_google_map_classification_stats IS 'Statistics on Google Map entry AI classifications';

-- View for disease risk entries that need review
CREATE OR REPLACE VIEW trapper.v_google_map_disease_risks AS
SELECT
  g.entry_id,
  g.kml_name,
  g.lat,
  g.lng,
  g.original_content,
  g.ai_summary,
  g.ai_classification->'signals'->'disease_mentions' as disease_mentions,
  g.ai_classification->'staff_alert_text' as staff_alert_text,
  g.ai_classified_at,
  g.linked_place_id,
  p.formatted_address as linked_address,
  g.linked_person_id,
  pe.display_name as linked_person_name
FROM trapper.google_map_entries g
LEFT JOIN trapper.places p ON p.place_id = g.linked_place_id
LEFT JOIN trapper.sot_people pe ON pe.person_id = g.linked_person_id
WHERE g.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')
ORDER BY g.ai_classified_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_google_map_disease_risks IS 'Google Map entries flagged as disease risks for staff safety review';

-- Add to Tippy view catalog
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_google_map_entries_classified', 'beacon', 'Google Maps entries with AI classification (disease risk, watch list, volunteers, colonies)',
   ARRAY['kml_name', 'ai_meaning', 'display_label'], ARRAY['ai_meaning', 'staff_alert'],
   ARRAY['How many Google Maps pins are marked as disease risk?', 'Which entries mention FeLV?', 'Show me watch list entries']),
  ('v_google_map_classification_stats', 'beacon', 'Statistics on Google Map AI classifications',
   ARRAY['classification_type', 'entry_count'], ARRAY['staff_alert'],
   ARRAY['How many entries are in each classification?', 'How many staff alerts are there?']),
  ('v_google_map_disease_risks', 'beacon', 'Google Map entries flagged as disease risks',
   ARRAY['kml_name', 'disease_mentions'], NULL,
   ARRAY['Show me all disease risk pins', 'What locations have FeLV?'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

\echo '=== MIG_706 Complete ==='
\echo 'Run: node scripts/jobs/classify_google_map_entries.mjs --limit 100 to start classification'
