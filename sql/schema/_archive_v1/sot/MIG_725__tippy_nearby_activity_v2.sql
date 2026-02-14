\echo '=== MIG_725: Tippy Nearby Activity V2 with Date Parsing ==='

-- Enhanced function with date extraction and relevance scoring
CREATE OR REPLACE FUNCTION trapper.tippy_nearby_activity_v2(
  p_address TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_radius_m INT DEFAULT 1000,
  p_recent_only BOOLEAN DEFAULT TRUE  -- filter to last 2 years by default
)
RETURNS TABLE (
  source TEXT,
  name TEXT,
  classification TEXT,
  distance_m INT,
  last_mentioned_date DATE,
  last_clinic_visit DATE,
  has_active_request BOOLEAN,
  relevance TEXT,
  notes_preview TEXT
) AS $$
DECLARE
  v_lat DOUBLE PRECISION := p_lat;
  v_lng DOUBLE PRECISION := p_lng;
BEGIN
  -- Resolve address if needed
  IF v_lat IS NULL AND p_address IS NOT NULL THEN
    SELECT ST_Y(p.location::geometry), ST_X(p.location::geometry)
    INTO v_lat, v_lng
    FROM trapper.places p
    WHERE p.formatted_address ILIKE '%' || p_address || '%'
      AND p.location IS NOT NULL
    LIMIT 1;
  END IF;

  IF v_lat IS NULL THEN
    RAISE NOTICE 'Address not found: %', p_address;
    RETURN;
  END IF;

  RETURN QUERY
  WITH nearby_google AS (
    SELECT
      'google_maps'::TEXT as src,
      g.kml_name,
      g.ai_meaning,
      ROUND((111111 * SQRT(
        POWER(g.lat - v_lat, 2) +
        POWER((g.lng - v_lng) * COS(RADIANS(v_lat)), 2)
      )))::INT as dist_m,
      -- Parse date from notes (MM/DD/YY format) - get most recent
      (
        SELECT MAX(
          make_date(
            CASE WHEN m[3]::int > 50 THEN 1900 + m[3]::int ELSE 2000 + m[3]::int END,
            m[1]::int,
            LEAST(m[2]::int, 28)  -- cap day at 28 to avoid invalid dates
          )
        )
        FROM regexp_matches(g.original_content, '([0-9]{1,2})/([0-9]{1,2})/([0-9]{2})', 'g') m
        WHERE m[1]::int BETWEEN 1 AND 12 AND m[2]::int BETWEEN 1 AND 31
      ) as mentioned_date,
      -- Last clinic visit at linked place
      (SELECT MAX(a.appointment_date)
       FROM trapper.sot_appointments a
       JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
       WHERE cpr.place_id = g.linked_place_id) as clinic_visit,
      -- Active request at linked place
      EXISTS(SELECT 1 FROM trapper.sot_requests r
             WHERE r.place_id = g.linked_place_id
               AND r.status NOT IN ('completed', 'cancelled')) as active_req,
      LEFT(COALESCE(g.ai_summary, g.original_content), 150) as notes
    FROM trapper.google_map_entries g
    WHERE g.lat IS NOT NULL
      AND ABS(g.lat - v_lat) < (p_radius_m::FLOAT / 111111)
      AND ABS(g.lng - v_lng) < (p_radius_m::FLOAT / (111111 * COS(RADIANS(v_lat))))
  )
  SELECT
    ng.src as source,
    ng.kml_name as name,
    ng.ai_meaning as classification,
    ng.dist_m as distance_m,
    ng.mentioned_date as last_mentioned_date,
    ng.clinic_visit as last_clinic_visit,
    ng.active_req as has_active_request,
    CASE
      WHEN ng.active_req THEN 'ACTIVE REQUEST'
      WHEN ng.clinic_visit > CURRENT_DATE - INTERVAL '6 months' THEN 'Recent clinic (6mo)'
      WHEN ng.mentioned_date > CURRENT_DATE - INTERVAL '1 year' THEN 'Recent notes (1yr)'
      WHEN ng.clinic_visit > CURRENT_DATE - INTERVAL '2 years' THEN 'Clinic 1-2yrs ago'
      WHEN ng.mentioned_date > CURRENT_DATE - INTERVAL '2 years' THEN 'Notes 1-2yrs ago'
      WHEN ng.mentioned_date IS NOT NULL OR ng.clinic_visit IS NOT NULL THEN 'Stale (>2yrs)'
      ELSE 'Unknown recency'
    END as relevance,
    ng.notes as notes_preview
  FROM nearby_google ng
  WHERE (NOT p_recent_only) OR (
    ng.mentioned_date > CURRENT_DATE - INTERVAL '2 years'
    OR ng.clinic_visit > CURRENT_DATE - INTERVAL '2 years'
    OR ng.active_req
    OR (ng.mentioned_date IS NULL AND ng.clinic_visit IS NULL)  -- keep unknown for review
  )
  ORDER BY
    -- Priority: active requests first, then by recency, then by distance
    CASE WHEN ng.active_req THEN 0 ELSE 1 END,
    GREATEST(COALESCE(ng.mentioned_date, '1900-01-01'::date), COALESCE(ng.clinic_visit, '1900-01-01'::date)) DESC,
    ng.dist_m;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.tippy_nearby_activity_v2 IS
'Enhanced nearby activity search with date extraction from notes and relevance scoring.
Filters to recent activity by default (last 2 years).
Use p_recent_only=FALSE to see all historical data.';

-- Update catalog
UPDATE trapper.tippy_view_catalog
SET description = 'Enhanced nearby activity with date parsing and relevance scoring. Returns recent activity (2yr) by default. Set p_recent_only=FALSE for all history.',
    example_questions = ARRAY[
      'What recent activity is near 123 Main St?',
      'Any active requests near this address?',
      'Who has been trapping nearby in the last year?',
      'Show me all historical activity near this location'
    ]
WHERE view_name = 'tippy_nearby_activity';

\echo 'Created tippy_nearby_activity_v2 with date parsing and relevance scoring'
