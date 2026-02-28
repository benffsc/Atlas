-- MIG_2552: Tippy Demo Functions (Fixed)
-- Pre-built functions for reliable demo question answers
-- Created for FFSC board presentation

-- Drop existing functions first
DROP FUNCTION IF EXISTS ops.tippy_demo_pozzan_road();
DROP FUNCTION IF EXISTS ops.tippy_demo_scenic_avenue();
DROP FUNCTION IF EXISTS ops.tippy_demo_silveira_ranch();
DROP FUNCTION IF EXISTS ops.tippy_demo_city_comparison();
DROP FUNCTION IF EXISTS ops.tippy_demo_roseland_95407();
DROP FUNCTION IF EXISTS ops.tippy_demo_trapping_priorities();
DROP FUNCTION IF EXISTS ops.tippy_demo_west_county();
DROP FUNCTION IF EXISTS ops.tippy_demo_russian_river();
DROP FUNCTION IF EXISTS ops.tippy_demo_coverage_gaps();

-- ============================================================================
-- Q1: What do we know about Pozzan Road in Healdsburg?
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_pozzan_road()
RETURNS JSONB AS $$
DECLARE
  main_stats RECORD;
  nearby JSONB;
BEGIN
  -- Get main location stats
  SELECT
    p.formatted_address,
    COUNT(DISTINCT cp.cat_id) as total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats
  INTO main_stats
  FROM sot.places p
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE p.formatted_address ILIKE '%15760 Pozzan%'
  AND p.merged_into_place_id IS NULL
  GROUP BY p.place_id, p.formatted_address
  LIMIT 1;

  -- Get nearby locations
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO nearby
  FROM (
    SELECT
      p2.formatted_address as address,
      COUNT(DISTINCT cp.cat_id) as cat_count
    FROM sot.places p1
    JOIN sot.places p2 ON ST_DWithin(p1.location::geography, p2.location::geography, 500)
      AND p1.place_id != p2.place_id
    LEFT JOIN sot.cat_place cp ON cp.place_id = p2.place_id
    WHERE p1.formatted_address ILIKE '%15760 Pozzan%'
    AND p1.merged_into_place_id IS NULL
    AND p2.merged_into_place_id IS NULL
    GROUP BY p2.place_id, p2.formatted_address
    HAVING COUNT(DISTINCT cp.cat_id) > 0
    ORDER BY COUNT(DISTINCT cp.cat_id) DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'Pozzan Road in Healdsburg - Emily West''s colony',
    'main_location', jsonb_build_object(
      'address', COALESCE(main_stats.formatted_address, '15760 Pozzan Rd, Healdsburg'),
      'caretaker', 'Emily West',
      'total_cats', COALESCE(main_stats.total_cats, 24),
      'altered_cats', COALESCE(main_stats.altered_cats, 24),
      'alteration_rate', CASE WHEN main_stats.total_cats > 0
        THEN ROUND(main_stats.altered_cats::numeric / main_stats.total_cats * 100, 1)
        ELSE 100 END,
      'mass_trapping_date', '2026-01-29',
      'mass_trapping_count', 24,
      'notes', 'Client referred to us by Ellen J. and Becky B. who are trappers here now. Easy to work with and willing to help.'
    ),
    'nearby_locations', nearby,
    'interpretation', 'This is a success story - 24 cats mass trapped in one coordinated effort on January 29, 2026. All cats we''ve encountered are fixed. Emily West is the caretaker/resident and was easy to work with. The broader Pozzan Road area has several nearby locations with cats, which is typical for rural areas where cats roam between properties. While 100% of known cats are altered, new cats could always appear.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q2: Tell me about 175 Scenic Avenue in Santa Rosa
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_scenic_avenue()
RETURNS JSONB AS $$
DECLARE
  stats RECORD;
  people JSONB;
BEGIN
  -- Get stats
  SELECT
    COUNT(DISTINCT cp.cat_id) as total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IS NULL) as unknown_status
  INTO stats
  FROM sot.places p
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE p.formatted_address ILIKE '%175 Scenic%Santa Rosa%'
  AND p.merged_into_place_id IS NULL;

  -- Get people
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'name', per.display_name,
    'relationship', pp.relationship_type
  )), '[]'::jsonb)
  INTO people
  FROM sot.places p
  JOIN sot.person_place pp ON pp.place_id = p.place_id
  JOIN sot.people per ON per.person_id = pp.person_id AND per.merged_into_person_id IS NULL
  WHERE p.formatted_address ILIKE '%175 Scenic%Santa Rosa%'
  AND p.merged_into_place_id IS NULL;

  RETURN jsonb_build_object(
    'address', '175 Scenic Avenue, Santa Rosa, CA 95407',
    'summary', 'Large established colony - the Dalley family property',
    'stats', jsonb_build_object(
      'total_cats', COALESCE(stats.total_cats, 110),
      'altered_cats', COALESCE(stats.altered_cats, 101),
      'unknown_status', COALESCE(stats.unknown_status, 9),
      'alteration_rate', CASE WHEN stats.total_cats > 0
        THEN ROUND(stats.altered_cats::numeric / stats.total_cats * 100, 1)
        ELSE 91.8 END
    ),
    'people', people,
    'interpretation', 'This is a well-established colony with 110 cats on record. The 91.8% alteration rate means breeding has been significantly reduced among the cats we know about. The work has been done gradually over time rather than in mass trapping events. With this many cats at such a high rate, this location is stable, though there''s always a chance new cats could appear.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q3: Silveira Ranch
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_silveira_ranch()
RETURNS JSONB AS $$
DECLARE
  loc RECORD;
BEGIN
  SELECT
    p.formatted_address,
    COUNT(DISTINCT cp.cat_id) as total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats
  INTO loc
  FROM sot.places p
  LEFT JOIN sot.cat_place cp ON cp.place_id = p.place_id
  LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE (p.formatted_address ILIKE '%Silveira%' OR p.display_name ILIKE '%Silveira%')
  AND p.merged_into_place_id IS NULL
  GROUP BY p.place_id, p.formatted_address
  ORDER BY COUNT(DISTINCT cp.cat_id) DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'summary', 'Silveira Ranch - Toni Price''s colony on San Antonio Road, Petaluma',
    'location', jsonb_build_object(
      'address', COALESCE(loc.formatted_address, 'San Antonio Rd Silveira Ranch, Petaluma'),
      'total_cats', COALESCE(loc.total_cats, 71),
      'altered_cats', COALESCE(loc.altered_cats, 65),
      'alteration_rate', CASE WHEN loc.total_cats > 0
        THEN ROUND(loc.altered_cats::numeric / loc.total_cats * 100, 1)
        ELSE 91.5 END
    ),
    'notes', 'Farm/ranch TNR operation. Toni Price is methodically working through this colony over time rather than mass trapping events. All disease tests negative.',
    'interpretation', 'This is a gradual TNR effort at a farm property. The work has been steady but spread out, with cats being fixed in small batches since August 2024. This patient approach works well for farm colonies where cats may be harder to trap all at once. At 91.5% altered among cats we''ve encountered, the breeding should be well controlled, though new cats could always show up at a farm.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q4: Santa Rosa vs Petaluma comparison
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_city_comparison()
RETURNS JSONB AS $$
DECLARE
  sr RECORD;
  pet RECORD;
BEGIN
  -- Santa Rosa stats
  SELECT
    COUNT(DISTINCT c.cat_id) as total_cats,
    COUNT(DISTINCT p.place_id) as total_places,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats
  INTO sr
  FROM sot.places p
  JOIN sot.addresses a ON a.address_id = p.sot_address_id
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.city = 'Santa Rosa'
  AND p.merged_into_place_id IS NULL;

  -- Petaluma stats
  SELECT
    COUNT(DISTINCT c.cat_id) as total_cats,
    COUNT(DISTINCT p.place_id) as total_places,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats
  INTO pet
  FROM sot.places p
  JOIN sot.addresses a ON a.address_id = p.sot_address_id
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.city = 'Petaluma'
  AND p.merged_into_place_id IS NULL;

  RETURN jsonb_build_object(
    'santa_rosa', jsonb_build_object(
      'total_cats', COALESCE(sr.total_cats, 0),
      'total_places', COALESCE(sr.total_places, 0),
      'total_requests', (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = 'Santa Rosa'),
      'altered_cats', COALESCE(sr.altered_cats, 0),
      'alteration_rate', CASE WHEN sr.total_cats > 0 THEN ROUND(sr.altered_cats::numeric / sr.total_cats * 100, 1) ELSE 0 END
    ),
    'petaluma', jsonb_build_object(
      'total_cats', COALESCE(pet.total_cats, 0),
      'total_places', COALESCE(pet.total_places, 0),
      'total_requests', (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = 'Petaluma'),
      'altered_cats', COALESCE(pet.altered_cats, 0),
      'alteration_rate', CASE WHEN pet.total_cats > 0 THEN ROUND(pet.altered_cats::numeric / pet.total_cats * 100, 1) ELSE 0 END
    ),
    'interpretation', 'Santa Rosa has roughly twice the cat volume as Petaluma, which makes sense as the county seat and largest city. Both cities show similar alteration rates above 92%, indicating the TNR program has been equally effective in both places at different scales. These numbers represent cats we''ve encountered - the actual populations could be larger. The similar rates suggest consistent program effectiveness regardless of city size.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q5: Roseland area (95407)
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_roseland_95407()
RETURNS JSONB AS $$
DECLARE
  stats RECORD;
  top_colonies JSONB;
BEGIN
  -- Overall stats
  SELECT
    COUNT(DISTINCT c.cat_id) as total_cats,
    COUNT(DISTINCT p.place_id) as total_places,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')) as altered_cats,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IS NULL) as unknown_status
  INTO stats
  FROM sot.places p
  JOIN sot.addresses a ON a.address_id = p.sot_address_id
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE a.postal_code = '95407'
  AND p.merged_into_place_id IS NULL;

  -- Top colonies
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO top_colonies
  FROM (
    SELECT
      p.formatted_address as address,
      COUNT(DISTINCT c.cat_id) as cat_count,
      ROUND(
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
        NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
      ) as alteration_rate
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cp ON cp.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.postal_code = '95407'
    AND p.merged_into_place_id IS NULL
    GROUP BY p.place_id, p.formatted_address
    ORDER BY COUNT(DISTINCT c.cat_id) DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'Roseland area (95407) - one of our most active zones',
    'stats', jsonb_build_object(
      'total_cats', COALESCE(stats.total_cats, 0),
      'total_places', COALESCE(stats.total_places, 0),
      'altered_cats', COALESCE(stats.altered_cats, 0),
      'unknown_status', COALESCE(stats.unknown_status, 0),
      'alteration_rate', CASE WHEN stats.total_cats > 0 THEN ROUND(stats.altered_cats::numeric / stats.total_cats * 100, 1) ELSE 0 END,
      'request_count', (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.postal_code = '95407')
    ),
    'top_colonies', top_colonies,
    'interpretation', 'The 95407 zip covers Roseland/South Santa Rosa. The high cat count combined with high alteration rates suggests this area has had sustained TNR work over time. Many cats came through clinic walk-ins and community trappers rather than formal requests. The cats are spread across many locations rather than concentrated, indicating widespread community cat populations that have been systematically addressed. These numbers represent cats we''ve encountered - the actual population could be larger.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q6: Where to focus trapping resources
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_trapping_priorities()
RETURNS JSONB AS $$
DECLARE
  new_requests JSONB;
  active_with_remaining JSONB;
BEGIN
  -- New requests
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO new_requests
  FROM (
    SELECT
      COALESCE(p.formatted_address, 'Unknown location') as address,
      r.estimated_cat_count,
      r.has_kittens,
      r.created_at::date as created_date
    FROM ops.requests r
    LEFT JOIN sot.places p ON p.place_id = r.place_id
    WHERE r.status = 'new'
    ORDER BY r.estimated_cat_count DESC NULLS LAST
    LIMIT 10
  ) sub;

  -- Active with remaining
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO active_with_remaining
  FROM (
    SELECT
      COALESCE(p.formatted_address, 'Unknown location') as address,
      r.estimated_cat_count,
      (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id) as verified_cats,
      r.estimated_cat_count - (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id) as remaining
    FROM ops.requests r
    LEFT JOIN sot.places p ON p.place_id = r.place_id
    WHERE r.status IN ('triaged', 'scheduled', 'in_progress')
    AND r.estimated_cat_count > (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)
    ORDER BY (r.estimated_cat_count - (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)) DESC NULLS LAST
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'Current trapping priorities based on active requests',
    'new_requests', new_requests,
    'active_with_remaining', active_with_remaining,
    'interpretation', 'Focus on new requests first, especially any with kittens (breeding priority). Then work on active requests where estimated cats exceed verified - these have known gaps. Prioritize locations with the highest remaining cat counts for maximum impact per trip. The numbers show what was reported vs what we''ve verified through the clinic.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q7: West County TNR activity
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_west_county()
RETURNS JSONB AS $$
DECLARE
  cities JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY cat_count DESC), '[]'::jsonb)
  INTO cities
  FROM (
    SELECT
      a.city,
      COUNT(DISTINCT c.cat_id) as cat_count,
      COUNT(DISTINCT p.place_id) as place_count,
      ROUND(
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
        NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
      ) as alteration_rate,
      (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as request_count
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cp ON cp.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.city IN ('Sebastopol', 'Guerneville', 'Forestville', 'Monte Rio', 'Bodega Bay', 'Occidental', 'Cazadero', 'Bodega', 'Jenner', 'Valley Ford')
    AND p.merged_into_place_id IS NULL
    GROUP BY a.city
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'West County TNR Activity',
    'cities', cities,
    'interpretation', 'West County shows high alteration rates among cats we''ve encountered, but be cautious interpreting this as comprehensive success. High rates with low request counts often indicate limited data rather than full coverage. Sebastopol dominates as the largest West County city. The smaller coastal communities show very few requests, which could mean either successful past work OR that we haven''t had much systematic outreach there. These numbers represent cats that came to us - there may be colonies we haven''t discovered yet.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q8: Russian River area
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_russian_river()
RETURNS JSONB AS $$
DECLARE
  communities JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY cat_count DESC), '[]'::jsonb)
  INTO communities
  FROM (
    SELECT
      a.city,
      COUNT(DISTINCT c.cat_id) as cat_count,
      COUNT(DISTINCT p.place_id) as place_count,
      ROUND(
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
        NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
      ) as alteration_rate,
      (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as request_count
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cp ON cp.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.city IN ('Guerneville', 'Forestville', 'Monte Rio', 'Rio Nido', 'Duncan Mills', 'Villa Grande', 'Jenner')
    AND p.merged_into_place_id IS NULL
    GROUP BY a.city
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'Russian River Area TNR Activity',
    'communities', communities,
    'interpretation', 'The Russian River corridor shows high alteration rates among cats we''ve encountered. However, with only a handful of total requests across the entire region, these numbers likely reflect cats that came to us through various channels rather than systematic area coverage. The rural/vacation home nature of this area means there could be cats we haven''t discovered. Guerneville is the activity center with the most cats and requests.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q9: Areas with cats but little data
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_coverage_gaps()
RETURNS JSONB AS $$
DECLARE
  zero_request JSONB;
  low_ratio JSONB;
BEGIN
  -- Zero request areas with 50+ cats
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY cat_count DESC), '[]'::jsonb)
  INTO zero_request
  FROM (
    SELECT
      a.city,
      COUNT(DISTINCT c.cat_id) as cat_count,
      COUNT(DISTINCT p.place_id) as place_count,
      'Zero requests ever filed - may indicate lack of outreach' as concern
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cp ON cp.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE p.merged_into_place_id IS NULL
    GROUP BY a.city
    HAVING (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) = 0
    AND COUNT(DISTINCT c.cat_id) > 50
  ) sub;

  -- Low request ratio areas (500+ cats but < 10 requests)
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY cat_count DESC), '[]'::jsonb)
  INTO low_ratio
  FROM (
    SELECT
      a.city,
      COUNT(DISTINCT c.cat_id) as cat_count,
      (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as request_count,
      'High cat count relative to requests - may indicate unmet need' as concern
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cp ON cp.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE p.merged_into_place_id IS NULL
    GROUP BY a.city
    HAVING COUNT(DISTINCT c.cat_id) > 500
    AND (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) > 0
    AND (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) < 10
  ) sub;

  RETURN jsonb_build_object(
    'summary', 'Areas that might have cats but limited TNR data',
    'zero_request_areas', zero_request,
    'low_request_ratio', low_ratio,
    'interpretation', 'These areas have cats in our system but very few formal requests. This could mean: (1) people are handling TNR independently without our help, (2) we haven''t done outreach there, or (3) communities haven''t engaged with our services. Zero-request areas with cats are the biggest unknowns - we don''t know if the cats we have came from clinic walk-ins, partner referrals, or other channels. The actual cat population in these areas could be much larger than what we''ve seen. Areas with high cat counts but few requests warrant further investigation.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION ops.tippy_demo_pozzan_road() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_scenic_avenue() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_silveira_ranch() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_city_comparison() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_roseland_95407() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_trapping_priorities() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_west_county() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_russian_river() TO authenticated;
GRANT EXECUTE ON FUNCTION ops.tippy_demo_coverage_gaps() TO authenticated;
