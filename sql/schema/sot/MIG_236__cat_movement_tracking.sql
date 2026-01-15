-- MIG_236__cat_movement_tracking.sql
-- Track cat movement patterns across addresses over time
--
-- Purpose:
--   - Track when cats (by microchip) appear at different addresses
--   - Calculate distances and time between visits
--   - Support "reunited with owner" tracking
--   - Inform TNR return policy for cats that move between locations
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_236__cat_movement_tracking.sql

\echo ''
\echo 'MIG_236: Cat Movement Tracking'
\echo '=============================='
\echo ''

-- ============================================================
-- 1. Create cat_movement_events table
-- ============================================================

\echo 'Creating cat_movement_events table...'

CREATE TABLE IF NOT EXISTS trapper.cat_movement_events (
    movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cat identification
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    microchip TEXT,  -- Denormalized for quick lookups

    -- Location change
    from_place_id UUID REFERENCES trapper.places(place_id),
    to_place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Timing
    event_date DATE NOT NULL,
    previous_event_date DATE,
    days_since_previous INTEGER,

    -- Distance (calculated if both places have coords)
    distance_meters NUMERIC,

    -- Source of this movement detection
    source_type TEXT NOT NULL DEFAULT 'appointment',  -- appointment, manual, reunion
    source_record_id TEXT,  -- e.g., appointment_id

    -- Movement type classification
    movement_type TEXT,  -- new_location, return_home, routine_visit, relocation

    -- Staff notes for manual entries
    notes TEXT,
    recorded_by TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_movement_cat_id
ON trapper.cat_movement_events(cat_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_cat_movement_microchip
ON trapper.cat_movement_events(microchip, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_cat_movement_to_place
ON trapper.cat_movement_events(to_place_id, event_date DESC);

COMMENT ON TABLE trapper.cat_movement_events IS
'Tracks when cats (by microchip) appear at different addresses.
Used for analyzing movement patterns and tracking reunifications.';

-- ============================================================
-- 2. Create cat_reunifications table
-- ============================================================

\echo ''
\echo 'Creating cat_reunifications table...'

CREATE TABLE IF NOT EXISTS trapper.cat_reunifications (
    reunification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cat
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- People involved
    original_owner_person_id UUID REFERENCES trapper.sot_people(person_id),
    current_caretaker_person_id UUID REFERENCES trapper.sot_people(person_id),

    -- Places involved
    original_place_id UUID REFERENCES trapper.places(place_id),
    found_at_place_id UUID REFERENCES trapper.places(place_id),

    -- Status
    reunification_status TEXT NOT NULL DEFAULT 'pending',  -- pending, confirmed, declined, unknown_outcome

    -- Details
    reunification_date DATE,
    how_identified TEXT,  -- microchip_scan, physical_description, owner_recognition
    notes TEXT,

    -- Audit
    recorded_by TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cat_reunifications_cat
ON trapper.cat_reunifications(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_reunifications_status
ON trapper.cat_reunifications(reunification_status, recorded_at DESC);

COMMENT ON TABLE trapper.cat_reunifications IS
'Tracks when cats are reunited with previous owners/caretakers.
Helps understand cat displacement and recovery patterns.';

-- ============================================================
-- 3. Create function to record movement
-- ============================================================

\echo ''
\echo 'Creating record_cat_movement function...'

CREATE OR REPLACE FUNCTION trapper.record_cat_movement(
    p_cat_id UUID,
    p_to_place_id UUID,
    p_event_date DATE,
    p_source_type TEXT DEFAULT 'appointment',
    p_source_record_id TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_recorded_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
    v_movement_id UUID;
    v_microchip TEXT;
    v_from_place_id UUID;
    v_previous_date DATE;
    v_days_since INTEGER;
    v_distance NUMERIC;
    v_movement_type TEXT;
BEGIN
    -- Get microchip
    SELECT id_value INTO v_microchip
    FROM trapper.cat_identifiers
    WHERE cat_id = p_cat_id AND id_type = 'microchip'
    LIMIT 1;

    -- Get most recent previous location
    SELECT to_place_id, event_date
    INTO v_from_place_id, v_previous_date
    FROM trapper.cat_movement_events
    WHERE cat_id = p_cat_id
      AND event_date < p_event_date
    ORDER BY event_date DESC
    LIMIT 1;

    -- Calculate days since previous
    IF v_previous_date IS NOT NULL THEN
        v_days_since := p_event_date - v_previous_date;
    END IF;

    -- Calculate distance if both places have coordinates
    SELECT ST_Distance(
        (SELECT location FROM trapper.places WHERE place_id = v_from_place_id),
        (SELECT location FROM trapper.places WHERE place_id = p_to_place_id)
    )::NUMERIC
    INTO v_distance
    WHERE v_from_place_id IS NOT NULL;

    -- Classify movement type
    v_movement_type := CASE
        WHEN v_from_place_id IS NULL THEN 'first_recorded'
        WHEN v_from_place_id = p_to_place_id THEN 'same_location'
        WHEN EXISTS (
            SELECT 1 FROM trapper.cat_movement_events
            WHERE cat_id = p_cat_id
              AND to_place_id = p_to_place_id
              AND event_date < p_event_date - INTERVAL '30 days'
        ) THEN 'return_visit'
        ELSE 'new_location'
    END;

    -- Don't record if same location and recent (within 7 days)
    IF v_from_place_id = p_to_place_id AND v_days_since < 7 THEN
        RETURN NULL;
    END IF;

    -- Insert movement record
    INSERT INTO trapper.cat_movement_events (
        cat_id, microchip,
        from_place_id, to_place_id,
        event_date, previous_event_date, days_since_previous,
        distance_meters, source_type, source_record_id,
        movement_type, notes, recorded_by
    ) VALUES (
        p_cat_id, v_microchip,
        v_from_place_id, p_to_place_id,
        p_event_date, v_previous_date, v_days_since,
        v_distance, p_source_type, p_source_record_id,
        v_movement_type, p_notes, p_recorded_by
    )
    RETURNING movement_id INTO v_movement_id;

    RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_cat_movement IS
'Records a cat movement event. Automatically calculates distance, time since previous, and movement type.';

-- ============================================================
-- 4. Create view for cat movement patterns
-- ============================================================

\echo ''
\echo 'Creating v_cat_movement_patterns view...'

CREATE OR REPLACE VIEW trapper.v_cat_movement_patterns AS
WITH cat_stats AS (
    SELECT
        cat_id,
        microchip,
        COUNT(*) AS total_movements,
        COUNT(DISTINCT to_place_id) AS unique_places,
        MIN(event_date) AS first_seen,
        MAX(event_date) AS last_seen,
        AVG(days_since_previous) FILTER (WHERE days_since_previous IS NOT NULL) AS avg_days_between,
        AVG(distance_meters) FILTER (WHERE distance_meters > 0) AS avg_distance,
        MAX(distance_meters) AS max_distance,
        COUNT(*) FILTER (WHERE movement_type = 'return_visit') AS return_visits,
        COUNT(*) FILTER (WHERE movement_type = 'new_location') AS new_locations
    FROM trapper.cat_movement_events
    GROUP BY cat_id, microchip
),
primary_location AS (
    SELECT DISTINCT ON (cat_id)
        cat_id,
        to_place_id AS primary_place_id
    FROM trapper.cat_movement_events
    GROUP BY cat_id, to_place_id
    ORDER BY cat_id, COUNT(*) DESC, MAX(event_date) DESC
)
SELECT
    c.cat_id,
    c.display_name AS cat_name,
    cs.microchip,
    cs.total_movements,
    cs.unique_places,
    cs.first_seen,
    cs.last_seen,
    cs.last_seen - cs.first_seen AS tracking_duration_days,
    ROUND(cs.avg_days_between::NUMERIC, 1) AS avg_days_between_visits,
    ROUND(cs.avg_distance) AS avg_distance_meters,
    ROUND(cs.max_distance) AS max_distance_meters,
    cs.return_visits,
    cs.new_locations,

    -- Movement pattern classification
    CASE
        WHEN cs.unique_places = 1 THEN 'stationary'
        WHEN cs.unique_places = 2 AND cs.return_visits > cs.new_locations THEN 'two_homes'
        WHEN cs.avg_distance > 1000 OR cs.max_distance > 5000 THEN 'wide_roamer'
        WHEN cs.unique_places > 3 THEN 'mobile'
        ELSE 'local_mover'
    END AS movement_pattern,

    -- Primary location
    pl.primary_place_id,
    p.display_name AS primary_place_name,
    p.formatted_address AS primary_address

FROM cat_stats cs
JOIN trapper.sot_cats c ON c.cat_id = cs.cat_id
LEFT JOIN primary_location pl ON pl.cat_id = cs.cat_id
LEFT JOIN trapper.places p ON p.place_id = pl.primary_place_id;

COMMENT ON VIEW trapper.v_cat_movement_patterns IS
'Aggregated movement statistics per cat including pattern classification.
Patterns: stationary, two_homes, wide_roamer, mobile, local_mover';

-- ============================================================
-- 5. Create view for movement timeline
-- ============================================================

\echo ''
\echo 'Creating v_cat_movement_timeline view...'

CREATE OR REPLACE VIEW trapper.v_cat_movement_timeline AS
SELECT
    me.movement_id,
    me.cat_id,
    c.display_name AS cat_name,
    me.microchip,

    -- From location
    me.from_place_id,
    fp.display_name AS from_place_name,
    fp.formatted_address AS from_address,

    -- To location
    me.to_place_id,
    tp.display_name AS to_place_name,
    tp.formatted_address AS to_address,

    -- Timing
    me.event_date,
    me.previous_event_date,
    me.days_since_previous,

    -- Distance
    me.distance_meters,
    CASE
        WHEN me.distance_meters IS NULL THEN NULL
        WHEN me.distance_meters < 100 THEN 'same_area'
        WHEN me.distance_meters < 500 THEN 'nearby'
        WHEN me.distance_meters < 2000 THEN 'local'
        WHEN me.distance_meters < 10000 THEN 'distant'
        ELSE 'far'
    END AS distance_category,

    -- Classification
    me.movement_type,
    me.source_type,
    me.notes,

    me.created_at

FROM trapper.cat_movement_events me
JOIN trapper.sot_cats c ON c.cat_id = me.cat_id
LEFT JOIN trapper.places fp ON fp.place_id = me.from_place_id
LEFT JOIN trapper.places tp ON tp.place_id = me.to_place_id;

COMMENT ON VIEW trapper.v_cat_movement_timeline IS
'Detailed timeline of cat movements with location names and distance categories.';

-- ============================================================
-- 6. Backfill movements from existing appointments
-- ============================================================

\echo ''
\echo 'Backfilling movements from appointments...'

-- Only create movements where cat has place association
INSERT INTO trapper.cat_movement_events (
    cat_id, microchip, to_place_id, event_date,
    source_type, source_record_id, movement_type, recorded_by
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date::DATE)
    a.cat_id,
    ci.id_value AS microchip,
    cpr.place_id AS to_place_id,
    a.appointment_date::DATE AS event_date,
    'appointment',
    a.appointment_id::TEXT,
    'backfill',
    'MIG_236'
FROM trapper.sot_appointments a
JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
WHERE a.cat_id IS NOT NULL
  AND cpr.place_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_movement_events e
      WHERE e.cat_id = a.cat_id
        AND e.to_place_id = cpr.place_id
        AND e.event_date = a.appointment_date::DATE
  )
ORDER BY a.cat_id, a.appointment_date::DATE, a.appointment_date DESC;

-- Update from_place_id and days_since_previous for backfilled records
WITH ordered_movements AS (
    SELECT
        movement_id,
        cat_id,
        to_place_id,
        event_date,
        LAG(to_place_id) OVER (PARTITION BY cat_id ORDER BY event_date) AS prev_place,
        LAG(event_date) OVER (PARTITION BY cat_id ORDER BY event_date) AS prev_date
    FROM trapper.cat_movement_events
)
UPDATE trapper.cat_movement_events me
SET
    from_place_id = om.prev_place,
    previous_event_date = om.prev_date,
    days_since_previous = me.event_date - om.prev_date
FROM ordered_movements om
WHERE me.movement_id = om.movement_id
  AND me.from_place_id IS NULL
  AND om.prev_place IS NOT NULL;

-- Update movement type based on history
UPDATE trapper.cat_movement_events me
SET movement_type = CASE
    WHEN me.from_place_id IS NULL THEN 'first_recorded'
    WHEN me.from_place_id = me.to_place_id THEN 'same_location'
    WHEN EXISTS (
        SELECT 1 FROM trapper.cat_movement_events prev
        WHERE prev.cat_id = me.cat_id
          AND prev.to_place_id = me.to_place_id
          AND prev.event_date < me.event_date - INTERVAL '30 days'
    ) THEN 'return_visit'
    ELSE 'new_location'
END
WHERE me.movement_type = 'backfill';

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Movement events recorded:';
SELECT COUNT(*) AS total_movements FROM trapper.cat_movement_events;

\echo ''
\echo 'Movement types distribution:';
SELECT movement_type, COUNT(*) AS count
FROM trapper.cat_movement_events
GROUP BY movement_type
ORDER BY count DESC;

\echo ''
\echo 'Cats with multiple locations:';
SELECT COUNT(*) AS multi_location_cats
FROM (
    SELECT cat_id FROM trapper.cat_movement_events
    GROUP BY cat_id
    HAVING COUNT(DISTINCT to_place_id) > 1
) x;

\echo ''
\echo 'Movement pattern summary:';
SELECT movement_pattern, COUNT(*) AS cats
FROM trapper.v_cat_movement_patterns
GROUP BY movement_pattern
ORDER BY cats DESC;

SELECT 'MIG_236 Complete' AS status;
