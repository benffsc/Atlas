-- ============================================================================
-- MIG_703: Google Maps Icon Styles
-- ============================================================================
-- Purpose: Add icon/style information to google_map_entries to preserve
-- the meaningful visual indicators from the original Google Maps:
--
-- Icon Types:
--   - icon-503 = Circles/dots (default)
--   - icon-959 = Stars (volunteers)
--   - icon-960 = Squares (disease indicators)
--   - icon-961 = Diamonds/flags (FeLV colonies)
--
-- Key Colors:
--   - 000000 = Black (difficult clients, watch list)
--   - 009D57 = Green (standard entries)
--   - DB4436 = Red (high priority)
--   - CDDC39 = Lime green (relocation clients)
--   - F8971B/F4B400 = Orange (FeLV indicators)
--   - FFDD5E/F4EB37 = Yellow (disease indicators)
-- ============================================================================

\echo '=== MIG_703: Google Maps Icon Styles ==='

-- ============================================================================
-- 1. Add Icon Style Columns
-- ============================================================================
\echo 'Adding icon style columns...'

ALTER TABLE trapper.google_map_entries
ADD COLUMN IF NOT EXISTS icon_type TEXT,
ADD COLUMN IF NOT EXISTS icon_color TEXT,
ADD COLUMN IF NOT EXISTS icon_style_id TEXT,
ADD COLUMN IF NOT EXISTS icon_meaning TEXT;

COMMENT ON COLUMN trapper.google_map_entries.icon_type IS
'Icon shape from Google Maps: icon-503 (circle), icon-959 (star), icon-960 (square), icon-961 (diamond)';

COMMENT ON COLUMN trapper.google_map_entries.icon_color IS
'Hex color code from icon style (e.g., 000000 for black, 009D57 for green)';

COMMENT ON COLUMN trapper.google_map_entries.icon_style_id IS
'Full style ID from KML (e.g., icon-503-000000)';

COMMENT ON COLUMN trapper.google_map_entries.icon_meaning IS
'Interpreted meaning based on icon type and color combination';

-- ============================================================================
-- 2. Create Icon Meaning Lookup Table
-- ============================================================================
\echo 'Creating icon meaning lookup table...'

CREATE TABLE IF NOT EXISTS trapper.google_maps_icon_meanings (
  icon_type TEXT,
  icon_color TEXT,
  meaning TEXT NOT NULL,
  description TEXT,
  display_priority INT DEFAULT 50,
  map_color TEXT, -- Color to use in BeaconMap
  PRIMARY KEY (icon_type, icon_color)
);

-- Insert known meanings based on FFSC conventions
INSERT INTO trapper.google_maps_icon_meanings (icon_type, icon_color, meaning, description, display_priority, map_color)
VALUES
  -- Black dots = difficult clients
  ('icon-503', '000000', 'difficult_client', 'Difficult client or situation to watch', 90, '#1f2937'),
  ('icon-959', '000000', 'difficult_client', 'Difficult client (star marker)', 90, '#1f2937'),

  -- Stars = volunteers
  ('icon-959', 'CDDC39', 'volunteer', 'FFSC volunteer', 30, '#84cc16'),
  ('icon-959', '009D57', 'volunteer', 'FFSC volunteer (green)', 30, '#22c55e'),

  -- Squares and orange diamonds = FeLV/disease
  ('icon-961', 'F8971B', 'felv_colony', 'FeLV positive colony', 100, '#ea580c'),
  ('icon-961', 'F4B400', 'felv_colony', 'FeLV positive colony (yellow-orange)', 100, '#f59e0b'),
  ('icon-960', 'FFDD5E', 'disease_indicator', 'Disease indicator (yellow square)', 95, '#eab308'),
  ('icon-960', 'F4EB37', 'disease_indicator', 'Disease indicator', 95, '#eab308'),

  -- Lime green = relocation
  ('icon-503', 'CDDC39', 'relocation', 'Relocation client', 60, '#84cc16'),
  ('icon-503', 'B7DBAB', 'relocation', 'Relocation client (light green)', 60, '#86efac'),

  -- Standard entries
  ('icon-503', '009D57', 'standard', 'Standard colony/client entry', 10, '#22c55e'),
  ('icon-503', 'DB4436', 'high_priority', 'High priority or urgent', 80, '#dc2626'),
  ('icon-503', '0BA9CC', 'standard', 'Standard entry (cyan)', 10, '#06b6d4'),
  ('icon-503', '62AF44', 'standard', 'Standard entry (green variant)', 10, '#22c55e'),
  ('icon-503', '4186F0', 'standard', 'Standard entry (blue)', 10, '#3b82f6'),
  ('icon-503', '3F5BA9', 'standard', 'Standard entry (dark blue)', 10, '#4f46e5'),
  ('icon-503', 'A61B4A', 'high_priority', 'High priority (maroon)', 80, '#be185d'),
  ('icon-503', 'F4B400', 'attention', 'Needs attention (orange)', 70, '#f59e0b')
ON CONFLICT (icon_type, icon_color) DO UPDATE SET
  meaning = EXCLUDED.meaning,
  description = EXCLUDED.description,
  display_priority = EXCLUDED.display_priority,
  map_color = EXCLUDED.map_color;

COMMENT ON TABLE trapper.google_maps_icon_meanings IS
'Lookup table for interpreting Google Maps icon styles. Based on FFSC conventions.';

-- ============================================================================
-- 3. Function to Derive Icon Meaning
-- ============================================================================
\echo 'Creating icon meaning function...'

CREATE OR REPLACE FUNCTION trapper.derive_icon_meaning(
  p_icon_type TEXT,
  p_icon_color TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_meaning TEXT;
BEGIN
  -- Look up in meanings table
  SELECT meaning INTO v_meaning
  FROM trapper.google_maps_icon_meanings
  WHERE icon_type = p_icon_type AND icon_color = p_icon_color;

  -- If not found, derive from known patterns
  IF v_meaning IS NULL THEN
    -- Black = difficult
    IF p_icon_color = '000000' THEN
      v_meaning := 'difficult_client';
    -- Stars = volunteers
    ELSIF p_icon_type = 'icon-959' THEN
      v_meaning := 'volunteer';
    -- Diamonds = disease
    ELSIF p_icon_type = 'icon-961' THEN
      v_meaning := 'disease_indicator';
    -- Squares = attention
    ELSIF p_icon_type = 'icon-960' THEN
      v_meaning := 'attention';
    -- Reds = high priority
    ELSIF p_icon_color IN ('DB4436', 'A61B4A') THEN
      v_meaning := 'high_priority';
    -- Lime greens = relocation
    ELSIF p_icon_color IN ('CDDC39', 'B7DBAB') THEN
      v_meaning := 'relocation';
    -- Default
    ELSE
      v_meaning := 'standard';
    END IF;
  END IF;

  RETURN v_meaning;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.derive_icon_meaning(TEXT, TEXT) IS
'Derives the semantic meaning from an icon type and color combination.';

-- ============================================================================
-- 4. Update Parsed Signals to Include Icon Meaning
-- ============================================================================
\echo 'Creating function to update signals with icon meaning...'

CREATE OR REPLACE FUNCTION trapper.update_entry_icon_meaning()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.icon_type IS NOT NULL AND NEW.icon_color IS NOT NULL THEN
    NEW.icon_meaning := trapper.derive_icon_meaning(NEW.icon_type, NEW.icon_color);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_icon_meaning ON trapper.google_map_entries;
CREATE TRIGGER trg_update_icon_meaning
  BEFORE INSERT OR UPDATE OF icon_type, icon_color
  ON trapper.google_map_entries
  FOR EACH ROW
  EXECUTE FUNCTION trapper.update_entry_icon_meaning();

-- ============================================================================
-- 5. Create View for Map Display with Icon Info
-- ============================================================================
\echo 'Creating view for map display with icon meanings...'

CREATE OR REPLACE VIEW trapper.v_google_map_entries_styled AS
SELECT
  g.entry_id,
  g.kml_name,
  g.original_content,
  g.lat,
  g.lng,
  g.icon_type,
  g.icon_color,
  g.icon_style_id,
  g.icon_meaning,
  COALESCE(m.map_color, '#6366f1') as map_color,
  COALESCE(m.display_priority, 10) as display_priority,
  COALESCE(m.description, 'Standard entry') as meaning_description,
  g.parsed_signals,
  g.ai_summary,
  g.parsed_cat_count
FROM trapper.google_map_entries g
LEFT JOIN trapper.google_maps_icon_meanings m
  ON m.icon_type = g.icon_type AND m.icon_color = g.icon_color
WHERE g.lat IS NOT NULL AND g.lng IS NOT NULL;

COMMENT ON VIEW trapper.v_google_map_entries_styled IS
'Google Maps entries with icon meaning and display styling for BeaconMap.';

-- ============================================================================
-- 6. Add to Tippy View Catalog
-- ============================================================================
\echo 'Adding to Tippy view catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_google_map_entries_styled', 'entity',
   'Google Maps entries with icon meanings (difficult_client, volunteer, felv_colony, relocation, etc.)',
   ARRAY['entry_id', 'kml_name', 'icon_meaning'],
   ARRAY['icon_meaning', 'icon_type'],
   ARRAY['Show me FeLV colony markers', 'What difficult client entries exist?', 'Where are the relocation clients?'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_703 Complete ==='
\echo 'Added:'
\echo '  - icon_type, icon_color, icon_style_id, icon_meaning columns'
\echo '  - google_maps_icon_meanings lookup table'
\echo '  - derive_icon_meaning() function'
\echo '  - v_google_map_entries_styled view'
\echo ''
\echo 'Icon Meanings:'
\echo '  - difficult_client: Black markers - watch list'
\echo '  - volunteer: Stars - FFSC volunteers'
\echo '  - felv_colony: Orange diamonds - FeLV positive'
\echo '  - disease_indicator: Yellow squares - disease'
\echo '  - relocation: Lime green - relocation clients'
\echo '  - high_priority: Red markers - urgent'
\echo '  - standard: Green dots - normal entries'
\echo ''
\echo 'Run the KML re-import script to populate icon data:'
\echo '  node scripts/jobs/reimport_google_maps_styles.mjs'
