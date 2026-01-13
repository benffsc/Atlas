-- MIG_173__place_quality_tiers.sql
-- Adds quality tiers to places based on source and activity
--
-- Tier A: Active TNR site (has trapping requests)
-- Tier B: Known cat area (multiple clinic visits)
-- Tier C: Single clinic mention
-- Tier D: FFSC office / unverified / unknown
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_173__place_quality_tiers.sql

\echo ''
\echo 'MIG_173: Place Quality Tiers'
\echo '============================='
\echo ''

-- ============================================================
-- 1. Create place quality tier enum
-- ============================================================

\echo 'Creating place_quality_tier enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'place_quality_tier') THEN
        CREATE TYPE trapper.place_quality_tier AS ENUM ('A', 'B', 'C', 'D');
    END IF;
END $$;

-- ============================================================
-- 2. Add quality tier columns to places
-- ============================================================

\echo 'Adding quality tier columns to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS quality_tier trapper.place_quality_tier DEFAULT 'D',
ADD COLUMN IF NOT EXISTS quality_reason TEXT,
ADD COLUMN IF NOT EXISTS quality_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_places_quality_tier
ON trapper.places(quality_tier);

-- ============================================================
-- 3. Function to compute place quality tier
-- ============================================================

\echo 'Creating compute_place_quality function...'

CREATE OR REPLACE FUNCTION trapper.compute_place_quality(p_place_id UUID)
RETURNS TABLE(tier trapper.place_quality_tier, reason TEXT) AS $$
DECLARE
    v_has_trapping_request BOOLEAN;
    v_appointment_count INT;
    v_cat_count INT;
    v_is_ffsc_office BOOLEAN;
    v_display_name TEXT;
BEGIN
    -- Get place info
    SELECT p.display_name, p.has_trapping_activity
    INTO v_display_name, v_has_trapping_request
    FROM trapper.places p
    WHERE p.place_id = p_place_id;

    -- Check if FFSC office
    v_is_ffsc_office := v_display_name LIKE 'FFSC Office%' OR v_display_name LIKE '%Empire Industrial%';

    -- Count appointments at this place
    SELECT COUNT(DISTINCT a.appointment_id)
    INTO v_appointment_count
    FROM trapper.sot_appointments a
    WHERE a.place_id = p_place_id;

    -- Count cats linked to this place
    SELECT COUNT(DISTINCT cpr.cat_id)
    INTO v_cat_count
    FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id = p_place_id;

    -- Determine tier
    IF v_is_ffsc_office THEN
        RETURN QUERY SELECT 'D'::trapper.place_quality_tier, 'FFSC office - unknown true location';
    ELSIF v_has_trapping_request THEN
        RETURN QUERY SELECT 'A'::trapper.place_quality_tier, 'Active TNR site with trapping request';
    ELSIF v_appointment_count >= 3 OR v_cat_count >= 3 THEN
        RETURN QUERY SELECT 'B'::trapper.place_quality_tier,
            format('Known cat area (%s appointments, %s cats)', v_appointment_count, v_cat_count);
    ELSIF v_appointment_count >= 1 OR v_cat_count >= 1 THEN
        RETURN QUERY SELECT 'C'::trapper.place_quality_tier,
            format('Single mention (%s appointments, %s cats)', v_appointment_count, v_cat_count);
    ELSE
        RETURN QUERY SELECT 'D'::trapper.place_quality_tier, 'No activity recorded';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 4. Function to refresh all place quality tiers
-- ============================================================

\echo 'Creating refresh_place_quality_tiers function...'

CREATE OR REPLACE FUNCTION trapper.refresh_place_quality_tiers()
RETURNS TABLE(tier_a INT, tier_b INT, tier_c INT, tier_d INT) AS $$
DECLARE
    v_a INT := 0;
    v_b INT := 0;
    v_c INT := 0;
    v_d INT := 0;
BEGIN
    -- Update all places
    UPDATE trapper.places p
    SET
        quality_tier = q.tier,
        quality_reason = q.reason,
        quality_updated_at = NOW()
    FROM (
        SELECT place_id, (trapper.compute_place_quality(place_id)).*
        FROM trapper.places
    ) q
    WHERE p.place_id = q.place_id;

    -- Count by tier
    SELECT COUNT(*) INTO v_a FROM trapper.places WHERE quality_tier = 'A';
    SELECT COUNT(*) INTO v_b FROM trapper.places WHERE quality_tier = 'B';
    SELECT COUNT(*) INTO v_c FROM trapper.places WHERE quality_tier = 'C';
    SELECT COUNT(*) INTO v_d FROM trapper.places WHERE quality_tier = 'D';

    RETURN QUERY SELECT v_a, v_b, v_c, v_d;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Function to promote place to Tier A (add trapping activity)
-- ============================================================

\echo 'Creating promote_place_to_tier_a function...'

CREATE OR REPLACE FUNCTION trapper.promote_place_to_tier_a(p_place_id UUID, p_reason TEXT DEFAULT 'Manual promotion')
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.places
    SET
        has_trapping_activity = TRUE,
        quality_tier = 'A',
        quality_reason = p_reason,
        quality_updated_at = NOW()
    WHERE place_id = p_place_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. View for places by quality tier
-- ============================================================

\echo 'Creating v_places_by_quality view...'

CREATE OR REPLACE VIEW trapper.v_places_by_quality AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.quality_tier,
    p.quality_reason,
    p.has_trapping_activity,
    p.has_appointment_activity,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id) as cat_count,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.place_id = p.place_id) as appointment_count,
    p.quality_updated_at
FROM trapper.places p
WHERE p.place_id IS NOT NULL
ORDER BY
    CASE p.quality_tier
        WHEN 'A' THEN 1
        WHEN 'B' THEN 2
        WHEN 'C' THEN 3
        WHEN 'D' THEN 4
    END,
    p.display_name;

-- ============================================================
-- 7. Initial quality tier computation
-- ============================================================

\echo ''
\echo 'Computing initial quality tiers...'

SELECT * FROM trapper.refresh_place_quality_tiers();

-- ============================================================
-- 8. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Place quality tier distribution:'
SELECT
    quality_tier as tier,
    COUNT(*) as places,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM trapper.places
GROUP BY quality_tier
ORDER BY quality_tier;

\echo ''
\echo 'Sample Tier A places (TNR sites):'
SELECT display_name, quality_reason
FROM trapper.places
WHERE quality_tier = 'A'
LIMIT 5;

\echo ''
\echo 'Sample Tier D places (unverified):'
SELECT display_name, quality_reason
FROM trapper.places
WHERE quality_tier = 'D'
LIMIT 5;

SELECT 'MIG_173 Complete' AS status;
