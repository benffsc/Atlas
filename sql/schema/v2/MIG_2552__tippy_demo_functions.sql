-- MIG_2552: Tippy Demo Functions
-- Pre-built functions for reliable demo question answers
-- Created for FFSC board presentation

-- ============================================================================
-- Q1: What do we know about Pozzan Road in Healdsburg?
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_pozzan_road()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'summary', 'Pozzan Road in Healdsburg - Emily West''s colony',
    'main_location', (
      SELECT jsonb_build_object(
        'address', p.formatted_address,
        'caretaker', 'Emily West',
        'total_cats', COUNT(DISTINCT cp.cat_id),
        'altered_cats', COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'alteration_rate', ROUND(
          COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT cp.cat_id), 0) * 100, 1
        ),
        'mass_trapping_date', '2026-01-29',
        'mass_trapping_count', 24,
        'notes', 'Client referred to us by Ellen J. and Becky B. who are trappers here now. Easy to work with and willing to help.'
      )
      FROM sot.places p
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE p.formatted_address ILIKE '%15760 Pozzan%'
      AND p.merged_into_place_id IS NULL
    ),
    'nearby_locations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'address', p.formatted_address,
        'cat_count', cat_count,
        'distance_meters', distance_m
      ) ORDER BY distance_m), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (p2.place_id)
          p2.place_id,
          p2.formatted_address,
          COUNT(DISTINCT cp.cat_id) as cat_count,
          ROUND(ST_Distance(p1.location::geography, p2.location::geography)::numeric) as distance_m
        FROM sot.places p1
        JOIN sot.places p2 ON ST_DWithin(p1.location::geography, p2.location::geography, 500)
          AND p1.place_id != p2.place_id
        LEFT JOIN sot.cat_place cp ON cp.place_id = p2.place_id
        WHERE p1.formatted_address ILIKE '%15760 Pozzan%'
        AND p1.merged_into_place_id IS NULL
        AND p2.merged_into_place_id IS NULL
        GROUP BY p2.place_id, p2.formatted_address, p1.location, p2.location
        HAVING COUNT(DISTINCT cp.cat_id) > 0
      ) sub
      JOIN sot.places p ON p.place_id = sub.place_id
    ),
    'interpretation', 'This is a success story - 24 cats mass trapped in one coordinated effort on January 29, 2026. All cats we''ve encountered are fixed. Emily West is the caretaker/resident and was easy to work with. The broader Pozzan Road area has several nearby locations with cats, which is typical for rural areas where cats roam between properties. While 100% of known cats are altered, new cats could always appear.'
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q2: Tell me about 175 Scenic Avenue in Santa Rosa
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_scenic_avenue()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'address', '175 Scenic Avenue, Santa Rosa, CA 95407',
    'summary', 'Large established colony - the Dalley family property',
    'stats', (
      SELECT jsonb_build_object(
        'total_cats', COUNT(DISTINCT cp.cat_id),
        'altered_cats', COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'unknown_status', COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IS NULL),
        'alteration_rate', ROUND(
          COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT cp.cat_id), 0) * 100, 1
        )
      )
      FROM sot.places p
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE p.formatted_address ILIKE '%175 Scenic%Santa Rosa%'
      AND p.merged_into_place_id IS NULL
    ),
    'people', (
      SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'name', per.display_name,
        'relationship', pp.relationship_type
      )), '[]'::jsonb)
      FROM sot.places p
      JOIN sot.person_place pp ON pp.place_id = p.place_id
      JOIN sot.people per ON per.person_id = pp.person_id AND per.merged_into_person_id IS NULL
      WHERE p.formatted_address ILIKE '%175 Scenic%Santa Rosa%'
      AND p.merged_into_place_id IS NULL
    ),
    'interpretation', 'This is a well-established colony with 110 cats on record. The 91.8% alteration rate means breeding has been significantly reduced among the cats we know about. The work has been done gradually over time rather than in mass trapping events. With this many cats at such a high rate, this location is stable, though there''s always a chance new cats could appear.'
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q3: Silveira Ranch
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_silveira_ranch()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'summary', 'Silveira Ranch - Toni Price''s colony on San Antonio Road, Petaluma',
    'location', (
      SELECT jsonb_build_object(
        'address', p.formatted_address,
        'total_cats', COUNT(DISTINCT cp.cat_id),
        'altered_cats', COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'alteration_rate', ROUND(
          COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT cp.cat_id), 0) * 100, 1
        )
      )
      FROM sot.places p
      LEFT JOIN sot.cat_place cp ON cp.place_id = p.place_id
      LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE (p.formatted_address ILIKE '%Silveira%' OR p.display_name ILIKE '%Silveira%')
      AND p.merged_into_place_id IS NULL
      GROUP BY p.place_id, p.formatted_address
      ORDER BY COUNT(DISTINCT cp.cat_id) DESC
      LIMIT 1
    ),
    'notes', 'Farm/ranch TNR operation. Toni Price is methodically working through this colony over time rather than mass trapping events.',
    'interpretation', 'This is a gradual TNR effort at a farm property. The work has been steady but spread out, with cats being fixed in small batches. This patient approach works well for farm colonies where cats may be harder to trap all at once.'
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q4: Santa Rosa vs Petaluma comparison
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_city_comparison()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'santa_rosa', (
      SELECT jsonb_build_object(
        'total_cats', COUNT(DISTINCT c.cat_id),
        'total_places', COUNT(DISTINCT p.place_id),
        'total_requests', (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = 'Santa Rosa'),
        'altered_cats', COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'alteration_rate', ROUND(
          COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
        )
      )
      FROM sot.places p
      JOIN sot.addresses a ON a.address_id = p.sot_address_id
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE a.city = 'Santa Rosa'
      AND p.merged_into_place_id IS NULL
    ),
    'petaluma', (
      SELECT jsonb_build_object(
        'total_cats', COUNT(DISTINCT c.cat_id),
        'total_places', COUNT(DISTINCT p.place_id),
        'total_requests', (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = 'Petaluma'),
        'altered_cats', COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'alteration_rate', ROUND(
          COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
        )
      )
      FROM sot.places p
      JOIN sot.addresses a ON a.address_id = p.sot_address_id
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE a.city = 'Petaluma'
      AND p.merged_into_place_id IS NULL
    ),
    'interpretation', 'Santa Rosa has roughly twice the cat volume as Petaluma, which makes sense as the county seat and largest city. Both cities show similar alteration rates above 92%, indicating the TNR program has been equally effective in both places at different scales. The request counts reflect this - Santa Rosa has more requests matching its larger population. Both are well above the 70% threshold for population control among cats we''ve encountered.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q5: Roseland area (95407)
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_roseland_95407()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'summary', 'Roseland area (95407) - one of our most active zones',
    'stats', (
      SELECT jsonb_build_object(
        'total_cats', COUNT(DISTINCT c.cat_id),
        'total_places', COUNT(DISTINCT p.place_id),
        'altered_cats', COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered')),
        'unknown_status', COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IS NULL),
        'alteration_rate', ROUND(
          COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
          NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
        )
      )
      FROM sot.places p
      JOIN sot.addresses a ON a.address_id = p.sot_address_id
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE a.postal_code = '95407'
      AND p.merged_into_place_id IS NULL
    ),
    'top_colonies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'address', formatted_address,
        'cat_count', cat_count,
        'alteration_rate', alt_rate
      ) ORDER BY cat_count DESC), '[]'::jsonb)
      FROM (
        SELECT
          p.formatted_address,
          COUNT(DISTINCT c.cat_id) as cat_count,
          ROUND(
            COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
            NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
          ) as alt_rate
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        JOIN sot.cat_place cp ON cp.place_id = p.place_id
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE a.postal_code = '95407'
        AND p.merged_into_place_id IS NULL
        GROUP BY p.place_id, p.formatted_address
        ORDER BY COUNT(DISTINCT c.cat_id) DESC
        LIMIT 5
      ) sub
    ),
    'interpretation', 'The 95407 zip covers Roseland/South Santa Rosa. The high cat count combined with high alteration rates suggests this area has had sustained TNR work over time. Many cats came through clinic walk-ins and community trappers rather than formal requests. The cats are spread across many locations rather than concentrated, indicating widespread community cat populations that have been systematically addressed. This represents cats we''ve encountered - the actual population could be larger.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q6: Where to focus trapping resources
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_trapping_priorities()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'new_requests', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'address', COALESCE(p.formatted_address, 'Unknown location'),
        'estimated_cats', r.estimated_cat_count,
        'has_kittens', r.has_kittens,
        'created_date', r.created_at::date
      ) ORDER BY r.estimated_cat_count DESC NULLS LAST), '[]'::jsonb)
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.status = 'new'
      LIMIT 10
    ),
    'active_with_remaining', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'address', COALESCE(p.formatted_address, 'Unknown location'),
        'estimated_cats', r.estimated_cat_count,
        'verified_cats', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id),
        'remaining', r.estimated_cat_count - (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)
      ) ORDER BY (r.estimated_cat_count - (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)) DESC NULLS LAST), '[]'::jsonb)
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.status IN ('triaged', 'scheduled', 'in_progress')
      AND r.estimated_cat_count > (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)
      LIMIT 10
    ),
    'interpretation', 'Focus on new requests first, especially any with kittens (breeding priority). Then work on active requests where estimated cats exceed verified - these have known gaps. Prioritize locations with the highest remaining cat counts for maximum impact per trip.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q7: West County TNR activity
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_west_county()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'summary', 'West County TNR Activity',
    'cities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'city', city,
        'total_cats', cat_count,
        'total_places', place_count,
        'alteration_rate', alt_rate,
        'request_count', req_count
      ) ORDER BY cat_count DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.city,
          COUNT(DISTINCT c.cat_id) as cat_count,
          COUNT(DISTINCT p.place_id) as place_count,
          ROUND(
            COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
            NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
          ) as alt_rate,
          (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as req_count
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        JOIN sot.cat_place cp ON cp.place_id = p.place_id
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE a.city IN ('Sebastopol', 'Guerneville', 'Forestville', 'Monte Rio', 'Bodega Bay', 'Occidental', 'Cazadero', 'Bodega', 'Jenner', 'Valley Ford')
        AND p.merged_into_place_id IS NULL
        GROUP BY a.city
      ) sub
    ),
    'interpretation', 'West County shows high alteration rates across all communities, but be cautious interpreting this as "success." High rates with low request counts often indicate limited data rather than comprehensive coverage. Sebastopol dominates the numbers as the largest West County city. The smaller coastal communities show very few requests, which could mean either successful past work OR that we haven''t had much systematic outreach there. The cats we know about appear well-managed, but there may be colonies we haven''t discovered yet.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q8: Russian River area
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_russian_river()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'summary', 'Russian River Area TNR Activity',
    'communities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'city', city,
        'total_cats', cat_count,
        'total_places', place_count,
        'alteration_rate', alt_rate,
        'request_count', req_count
      ) ORDER BY cat_count DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.city,
          COUNT(DISTINCT c.cat_id) as cat_count,
          COUNT(DISTINCT p.place_id) as place_count,
          ROUND(
            COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::numeric /
            NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
          ) as alt_rate,
          (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as req_count
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        JOIN sot.cat_place cp ON cp.place_id = p.place_id
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE a.city IN ('Guerneville', 'Forestville', 'Monte Rio', 'Rio Nido', 'Duncan Mills', 'Villa Grande', 'Jenner')
        AND p.merged_into_place_id IS NULL
        GROUP BY a.city
      ) sub
    ),
    'interpretation', 'The Russian River corridor shows high alteration rates among cats we''ve encountered. However, with only a handful of total requests across the entire region, these numbers likely reflect cats that came to us through various channels rather than systematic area coverage. The rural/vacation home nature of this area means there could be cats we haven''t discovered. Guerneville is the activity center with the most cats and requests.'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Q9: Areas with cats but little data
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.tippy_demo_coverage_gaps()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'summary', 'Areas that might have cats but limited TNR data',
    'zero_request_areas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'city', city,
        'cat_count', cat_count,
        'place_count', place_count,
        'concern', 'Zero requests ever filed - may indicate lack of outreach'
      ) ORDER BY cat_count DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.city,
          COUNT(DISTINCT c.cat_id) as cat_count,
          COUNT(DISTINCT p.place_id) as place_count
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        JOIN sot.cat_place cp ON cp.place_id = p.place_id
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE p.merged_into_place_id IS NULL
        GROUP BY a.city
        HAVING (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) = 0
        AND COUNT(DISTINCT c.cat_id) > 50
      ) sub
    ),
    'low_request_ratio', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'city', city,
        'cat_count', cat_count,
        'request_count', req_count,
        'ratio', ROUND(cat_count::numeric / NULLIF(req_count, 0), 0),
        'concern', 'High cat count relative to requests - may indicate unmet need'
      ) ORDER BY cat_count DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.city,
          COUNT(DISTINCT c.cat_id) as cat_count,
          (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) as req_count
        FROM sot.places p
        JOIN sot.addresses a ON a.address_id = p.sot_address_id
        JOIN sot.cat_place cp ON cp.place_id = p.place_id
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE p.merged_into_place_id IS NULL
        GROUP BY a.city
        HAVING COUNT(DISTINCT c.cat_id) > 500
        AND (SELECT COUNT(*) FROM ops.requests r JOIN sot.places rp ON rp.place_id = r.place_id JOIN sot.addresses ra ON ra.address_id = rp.sot_address_id WHERE ra.city = a.city) < 10
      ) sub
    ),
    'interpretation', 'These areas have cats in our system but very few formal requests. This could mean: (1) people are handling TNR independently without our help, (2) we haven''t done outreach there, or (3) communities haven''t engaged with our services. Zero-request areas with cats are the biggest unknowns - we don''t know if the cats we have came from clinic walk-ins, partner referrals, or other channels. The actual cat population in these areas could be much larger than what we''ve seen.'
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
