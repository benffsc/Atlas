\echo '=== MIG_815: Structural Place Dedup Enhancements ==='
\echo 'DH_E004: Catch remaining ~307 structural duplicate places.'
\echo 'Adds inverted address normalization, text-only Tier 4 matching,'
\echo 'junk address flagging, and dedup-specific normalization function.'
\echo ''

-- ============================================================================
-- 1. Widen match_tier CHECK constraint (1-3 → 1-4)
-- ============================================================================

\echo '1. Widening match_tier CHECK constraint to allow Tier 4...'

ALTER TABLE trapper.place_dedup_candidates
  DROP CONSTRAINT IF EXISTS place_dedup_candidates_match_tier_check;

ALTER TABLE trapper.place_dedup_candidates
  ADD CONSTRAINT place_dedup_candidates_match_tier_check
  CHECK (match_tier BETWEEN 1 AND 4);

-- ============================================================================
-- 2. Enhance normalize_address() — inverted address fix
-- ============================================================================

\echo '2. Enhancing normalize_address() with inverted address detection...'

CREATE OR REPLACE FUNCTION trapper.normalize_address(p_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_result text;
BEGIN
  IF p_address IS NULL OR BTRIM(p_address) = '' THEN
    RETURN NULL;
  END IF;

  v_result := BTRIM(p_address);

  -- Step 1: Strip ", USA" / ", US" suffix (case insensitive)
  v_result := REGEXP_REPLACE(v_result, ',\s*(USA|US|United States)\s*$', '', 'i');

  -- Step 2a: Strip em-dash city placeholder (", —," pattern from Airtable imports)
  v_result := REGEXP_REPLACE(v_result, ',\s*[—–]+\s*,', ',', 'g');  -- ", —," → ","
  v_result := REGEXP_REPLACE(v_result, ',\s*--+\s*,', ',', 'g');     -- ", --," → ","

  -- Step 2b: Strip trailing em-dash / double-dash
  v_result := REGEXP_REPLACE(v_result, '\s*[—–]+\s*$', '', 'g');
  v_result := REGEXP_REPLACE(v_result, '\s*--+\s*$', '', 'g');

  -- Step 2c: Normalize comma before zip (", CA, 95404" → ", CA 95404")
  v_result := REGEXP_REPLACE(v_result, ',\s*([A-Za-z]{2}),\s*(\d{5})', ', \1 \2', 'gi');

  -- Step 3: Remove periods from abbreviations (St. -> St, Ave. -> Ave, Dr. -> Dr, P.O. -> PO)
  -- But preserve decimal numbers (e.g., "5.5 miles")
  v_result := REGEXP_REPLACE(v_result, '\.(\s|,|$)', '\1', 'g');  -- period before space/comma/end
  v_result := REGEXP_REPLACE(v_result, '([A-Za-z])\.([A-Za-z])', '\1\2', 'g');  -- P.O. -> PO

  -- Step 4: Collapse whitespace
  v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');

  -- Step 5: Remove double commas, space before comma
  v_result := REGEXP_REPLACE(v_result, ',\s*,', ',', 'g');
  v_result := REGEXP_REPLACE(v_result, '\s+,', ',', 'g');

  -- Step 5b: Normalize apartment/unit spelling
  v_result := REGEXP_REPLACE(v_result, '\y(apartment)\y', 'apt', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(suite)\y', 'ste', 'gi');

  -- Step 5c: Strip comma between house number and street name ("1898, cooper rd" → "1898 cooper rd")
  v_result := REGEXP_REPLACE(v_result, '^(\d+),\s+', '\1 ', 'g');

  -- Step 5d: Fix inverted addresses — street name before house number (MIG_815)
  -- "valley ford rd 14495" → "14495 valley ford rd"
  -- Safe: requires leading alpha (won't touch "123 Main St"), needs 2-6 trailing digits
  v_result := REGEXP_REPLACE(v_result, '^([a-zA-Z][a-zA-Z ]+?)\s+(\d{2,6})(\s*,|\s*$)', '\2 \1\3');

  -- Step 6: Normalize street suffixes (comprehensive list)
  v_result := REGEXP_REPLACE(v_result, '\y(road)\y',      'rd',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(street)\y',    'st',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(avenue)\y',    'ave',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(drive)\y',     'dr',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(boulevard)\y', 'blvd', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(lane)\y',      'ln',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(court)\y',     'ct',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(circle)\y',    'cir',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(place)\y',     'pl',   'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(highway)\y',   'hwy',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(terrace)\y',   'ter',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(parkway)\y',   'pkwy', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(trail)\y',     'trl',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(square)\y',    'sq',   'gi');

  -- Step 7: Normalize directional abbreviations
  v_result := REGEXP_REPLACE(v_result, '\y(north)\y',     'n',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(south)\y',     's',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(east)\y',      'e',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(west)\y',      'w',  'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(northwest)\y', 'nw', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(northeast)\y', 'ne', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(southwest)\y', 'sw', 'gi');
  v_result := REGEXP_REPLACE(v_result, '\y(southeast)\y', 'se', 'gi');

  -- Step 8: Normalize # prefix for units
  v_result := REGEXP_REPLACE(v_result, '\s*#\s*', ' #', 'g');

  -- Step 9: Final LOWER + TRIM
  v_result := LOWER(BTRIM(v_result));

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION trapper.normalize_address IS
  'Normalizes addresses for deduplication. MIG_815: Added inverted address detection (street-before-number pattern).';

-- ============================================================================
-- 3. New normalize_address_for_dedup() — aggressive comparison normalization
-- ============================================================================

\echo '3. Creating normalize_address_for_dedup() for Tier 4 matching...'

CREATE OR REPLACE FUNCTION trapper.normalize_address_for_dedup(p_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_result text;
BEGIN
  v_result := trapper.normalize_address(p_address);
  IF v_result IS NULL THEN RETURN NULL; END IF;

  -- Strip all commas (city/state commas cause false mismatches)
  -- "75 hillview dr, cloverdale, ca 95425" → "75 hillview dr cloverdale ca 95425"
  v_result := REPLACE(v_result, ',', '');

  -- Collapse multi-space to single
  v_result := REGEXP_REPLACE(v_result, '\s+', ' ', 'g');

  -- Strip trailing state + zip if present
  -- "123 main st petaluma ca 95472" → "123 main st petaluma"
  v_result := REGEXP_REPLACE(v_result, '\s+[a-z]{2}\s+\d{5}(-\d{4})?\s*$', '');

  RETURN BTRIM(v_result);
END;
$function$;

COMMENT ON FUNCTION trapper.normalize_address_for_dedup IS
'Aggressive address normalization for dedup comparison only (not stored).
Strips commas and trailing state+zip so "75 hillview dr, cloverdale, ca 95425"
matches "75 hillview dr cloverdale". MIG_815.';

-- ============================================================================
-- 4. Add is_junk_address column + flag_junk_addresses() function
-- ============================================================================

\echo '4. Adding is_junk_address column and detection function...'

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS is_junk_address BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.places.is_junk_address IS
  'TRUE if address is garbage/unknown/placeholder. Flagged by flag_junk_addresses(). MIG_815.';

CREATE INDEX IF NOT EXISTS idx_places_junk_address
  ON trapper.places (is_junk_address)
  WHERE is_junk_address = TRUE;

CREATE OR REPLACE FUNCTION trapper.flag_junk_addresses()
RETURNS TABLE(place_id UUID, formatted_address TEXT, reason TEXT)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.place_id, p.formatted_address,
    CASE
      WHEN p.formatted_address IS NULL OR BTRIM(p.formatted_address) = '' THEN 'empty'
      WHEN LENGTH(BTRIM(p.formatted_address)) < 5 THEN 'too_short'
      WHEN LOWER(BTRIM(p.formatted_address)) ~ '^\s*(unknown|unknow)\b' THEN 'unknown_address'
      WHEN LOWER(BTRIM(p.formatted_address)) ~ '^\s*(n/?a|none|tbd|test)\b' THEN 'placeholder'
      WHEN BTRIM(p.formatted_address) !~ '\s' THEN 'single_word'
      ELSE NULL
    END AS reason
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND (
      p.formatted_address IS NULL
      OR LENGTH(BTRIM(p.formatted_address)) < 5
      OR LOWER(BTRIM(p.formatted_address)) ~ '^\s*(unknown|unknow|n/?a|none|tbd|test)\b'
      OR BTRIM(p.formatted_address) !~ '\s'
    );
END;
$function$;

COMMENT ON FUNCTION trapper.flag_junk_addresses IS
'Returns places with garbage/unknown/placeholder addresses. Does not modify data.
Used to flag is_junk_address and exclude from dedup candidates. MIG_815.';

-- ============================================================================
-- 5. Extend refresh_place_dedup_candidates() with Tier 4
-- ============================================================================

\echo '5. Extending refresh_place_dedup_candidates() with Tier 4 (text-only)...'

CREATE OR REPLACE FUNCTION trapper.refresh_place_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, tier4_count INT, total INT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_t1 INT := 0;
  v_t2 INT := 0;
  v_t3 INT := 0;
  v_t4 INT := 0;
BEGIN
  -- Clear unresolved candidates (keep resolved ones for audit)
  DELETE FROM trapper.place_dedup_candidates WHERE status = 'pending';

  -- Tier 1: Within 30m + similarity >= 0.6
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    1,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) >= 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t1 = ROW_COUNT;

  -- Tier 2: Within 30m + similarity < 0.6
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    2,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) < 0.6
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t2 = ROW_COUNT;

  -- Tier 3: 30-100m + similarity >= 0.7
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    3,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1),
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND ST_DWithin(a.location::geography, b.location::geography, 100)
    AND NOT ST_DWithin(a.location::geography, b.location::geography, 30)
    AND similarity(a.normalized_address, b.normalized_address) >= 0.7
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.location IS NOT NULL AND b.location IS NOT NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t3 = ROW_COUNT;

  -- Tier 4: Text-only matching (no coordinates required) — MIG_815
  -- Catches: inverted addresses, missing commas, null-location duplicates
  INSERT INTO trapper.place_dedup_candidates (
    canonical_place_id, duplicate_place_id, match_tier,
    address_similarity, distance_meters,
    canonical_address, canonical_name, canonical_kind,
    duplicate_address, duplicate_name, duplicate_kind
  )
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.place_id ELSE b.place_id END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_id ELSE a.place_id END,
    4,
    ROUND(similarity(a.normalized_address, b.normalized_address)::numeric, 3),
    CASE
      WHEN a.location IS NOT NULL AND b.location IS NOT NULL
      THEN ROUND(ST_Distance(a.location::geography, b.location::geography)::numeric, 1)
      ELSE NULL  -- distance unknown when coordinates missing
    END,
    CASE WHEN a.created_at <= b.created_at THEN a.formatted_address ELSE b.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN a.display_name ELSE b.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN a.place_kind::text ELSE b.place_kind::text END,
    CASE WHEN a.created_at <= b.created_at THEN b.formatted_address ELSE a.formatted_address END,
    CASE WHEN a.created_at <= b.created_at THEN b.display_name ELSE a.display_name END,
    CASE WHEN a.created_at <= b.created_at THEN b.place_kind::text ELSE a.place_kind::text END
  FROM trapper.places a
  JOIN trapper.places b
    ON a.place_id < b.place_id
    AND (
      -- Same dedup-normalized address (catches inverted, comma differences, zip variance)
      trapper.normalize_address_for_dedup(a.formatted_address)
        = trapper.normalize_address_for_dedup(b.formatted_address)
      -- OR very high trigram similarity on base normalized_address
      OR similarity(a.normalized_address, b.normalized_address) >= 0.85
    )
  WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
    AND a.normalized_address IS NOT NULL AND b.normalized_address IS NOT NULL
    AND a.parent_place_id IS NULL AND b.parent_place_id IS NULL
    AND COALESCE(a.is_junk_address, FALSE) = FALSE
    AND COALESCE(b.is_junk_address, FALSE) = FALSE
  ON CONFLICT (canonical_place_id, duplicate_place_id) DO NOTHING;
  GET DIAGNOSTICS v_t4 = ROW_COUNT;

  RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t4, v_t1 + v_t2 + v_t3 + v_t4;
END;
$function$;

COMMENT ON FUNCTION trapper.refresh_place_dedup_candidates IS
'Refreshes the place_dedup_candidates table with current proximity + text-based duplicates.
Clears pending candidates and re-detects across 4 tiers:
  Tier 1: Within 30m + address similarity >= 0.6
  Tier 2: Within 30m + low similarity (same spot, different text)
  Tier 3: 30-100m + address similarity >= 0.7
  Tier 4: Text-only (no coords required) — dedup-normalized equality OR trigram >= 0.85
Returns counts per tier. Safe to run repeatedly — preserves resolved decisions. MIG_815 added Tier 4.';

-- ============================================================================
-- 6. Functional index for Tier 4 performance
-- ============================================================================

\echo '6. Creating functional index for dedup normalization...'

CREATE INDEX IF NOT EXISTS idx_places_dedup_norm
  ON trapper.places (trapper.normalize_address_for_dedup(formatted_address))
  WHERE merged_into_place_id IS NULL
    AND formatted_address IS NOT NULL
    AND COALESCE(is_junk_address, FALSE) = FALSE;

-- ============================================================================
-- 7. Re-normalize all places with improved function
-- ============================================================================

\echo '7. Re-normalizing all place addresses (inverted address fix)...'

UPDATE trapper.places
SET normalized_address = trapper.normalize_address(formatted_address),
    updated_at = NOW()
WHERE formatted_address IS NOT NULL
  AND merged_into_place_id IS NULL
  AND normalized_address IS DISTINCT FROM trapper.normalize_address(formatted_address);

-- ============================================================================
-- 8. Flag junk addresses
-- ============================================================================

\echo '8. Flagging junk addresses...'

UPDATE trapper.places p
SET is_junk_address = TRUE, updated_at = NOW()
FROM trapper.flag_junk_addresses() j
WHERE p.place_id = j.place_id
  AND COALESCE(p.is_junk_address, FALSE) = FALSE;

\echo 'Junk addresses flagged:'
SELECT reason, COUNT(*) AS cnt
FROM trapper.flag_junk_addresses()
GROUP BY reason
ORDER BY cnt DESC;

-- ============================================================================
-- 9. Refresh candidates with new Tier 4
-- ============================================================================

\echo '9. Refreshing dedup candidates (all 4 tiers)...'

SELECT * FROM trapper.refresh_place_dedup_candidates();

-- ============================================================================
-- 10. Update Tippy catalog
-- ============================================================================

\echo '10. Updating Tippy catalog...'

UPDATE trapper.tippy_view_catalog
SET description = 'Materialized place duplicate candidates detected via PostGIS proximity + trigram similarity. Tier 1=close+similar, Tier 2=close+different, Tier 3=farther+very similar, Tier 4=text-only match (no coordinates required). Refreshed via refresh_place_dedup_candidates().',
    updated_at = NOW()
WHERE view_name = 'place_dedup_candidates';

-- ============================================================================
-- 11. Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Re-normalized addresses changed:'
SELECT COUNT(*) AS re_normalized_count
FROM trapper.places
WHERE formatted_address IS NOT NULL
  AND merged_into_place_id IS NULL
  AND normalized_address IS DISTINCT FROM trapper.normalize_address(formatted_address);

\echo ''
\echo 'Dedup candidates by tier:'
SELECT
  match_tier,
  CASE match_tier
    WHEN 1 THEN 'Close + Similar Address'
    WHEN 2 THEN 'Close + Different Address'
    WHEN 3 THEN 'Farther + Very Similar'
    WHEN 4 THEN 'Text Match Only'
  END AS tier_label,
  COUNT(*) AS pair_count
FROM trapper.place_dedup_candidates
WHERE status = 'pending'
GROUP BY match_tier
ORDER BY match_tier;

\echo ''
\echo 'Sample Tier 4 candidates (first 10):'
SELECT
  address_similarity AS sim,
  COALESCE(distance_meters::text, 'N/A') AS dist,
  canonical_address,
  duplicate_address
FROM trapper.place_dedup_candidates
WHERE status = 'pending' AND match_tier = 4
ORDER BY address_similarity DESC
LIMIT 10;

\echo ''
\echo '=== MIG_815 Complete ==='
\echo 'Enhanced:'
\echo '  - normalize_address(): Inverted address detection (Step 5d)'
\echo '  - normalize_address_for_dedup(): Aggressive comparison normalization'
\echo '  - refresh_place_dedup_candidates(): Tier 4 text-only matching'
\echo 'Added:'
\echo '  - is_junk_address column on places'
\echo '  - flag_junk_addresses() function'
\echo '  - Functional index for dedup normalization'
