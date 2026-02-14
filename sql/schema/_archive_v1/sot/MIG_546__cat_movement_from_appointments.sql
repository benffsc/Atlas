-- =====================================================
-- MIG_546: Cat Movement Tracking from Appointments
-- =====================================================
-- Populates cat_movement_events directly from sot_appointments
-- using the place_id on each appointment (owner's address).
--
-- This captures cat movements like the Gary/Heather case:
-- - Cat first seen at Gary's place (2020)
-- - Cat later seen at Heather's place (2024)
-- - Creates movement event showing the cat moved between locations
-- =====================================================

\echo '=== MIG_546: Cat Movement Tracking from Appointments ==='
\echo ''

-- ============================================================
-- 1. Baseline: Current movement events
-- ============================================================

\echo 'Baseline - Current movement events:'
SELECT
    COUNT(*) as total_movements,
    COUNT(DISTINCT cat_id) as unique_cats
FROM trapper.cat_movement_events;

-- ============================================================
-- 2. Backfill movements from appointments with place_id
-- ============================================================

\echo ''
\echo 'Step 1: Backfilling movements from appointments...'

-- Create temp table with all appointment-place associations
CREATE TEMP TABLE appointment_movements AS
SELECT
    a.cat_id,
    a.place_id,
    a.appointment_date,
    a.appointment_id,
    ci.id_value as microchip,
    ROW_NUMBER() OVER (PARTITION BY a.cat_id ORDER BY a.appointment_date, a.created_at) as seq
FROM trapper.sot_appointments a
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
WHERE a.cat_id IS NOT NULL
  AND a.place_id IS NOT NULL
ORDER BY a.cat_id, a.appointment_date;

\echo 'Appointments with cat and place:'
SELECT COUNT(*) as total FROM appointment_movements;

-- Insert movements, avoiding duplicates
INSERT INTO trapper.cat_movement_events (
    cat_id,
    microchip,
    to_place_id,
    event_date,
    source_type,
    source_record_id,
    movement_type,
    recorded_by
)
SELECT
    am.cat_id,
    am.microchip,
    am.place_id,
    am.appointment_date::DATE,
    'appointment',
    am.appointment_id::TEXT,
    'backfill',
    'MIG_546'
FROM appointment_movements am
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_movement_events me
    WHERE me.cat_id = am.cat_id
      AND me.to_place_id = am.place_id
      AND me.event_date = am.appointment_date::DATE
)
ON CONFLICT DO NOTHING;

\echo 'After backfill:'
SELECT COUNT(*) as total_movements FROM trapper.cat_movement_events;

DROP TABLE appointment_movements;

-- ============================================================
-- 3. Update from_place_id and calculate days_since_previous
-- ============================================================

\echo ''
\echo 'Step 2: Calculating from_place_id and time deltas...'

WITH ordered_movements AS (
    SELECT
        movement_id,
        cat_id,
        to_place_id,
        event_date,
        LAG(to_place_id) OVER (PARTITION BY cat_id ORDER BY event_date, created_at) AS prev_place,
        LAG(event_date) OVER (PARTITION BY cat_id ORDER BY event_date, created_at) AS prev_date
    FROM trapper.cat_movement_events
)
UPDATE trapper.cat_movement_events me
SET
    from_place_id = COALESCE(me.from_place_id, om.prev_place),
    previous_event_date = COALESCE(me.previous_event_date, om.prev_date),
    days_since_previous = COALESCE(me.days_since_previous, me.event_date - om.prev_date)
FROM ordered_movements om
WHERE me.movement_id = om.movement_id
  AND (me.from_place_id IS NULL OR me.previous_event_date IS NULL);

-- ============================================================
-- 4. Calculate distances using PostGIS
-- ============================================================

\echo ''
\echo 'Step 3: Calculating distances...'

UPDATE trapper.cat_movement_events me
SET distance_meters = ST_Distance(
    fp.location::geography,
    tp.location::geography
)
FROM trapper.places fp, trapper.places tp
WHERE me.from_place_id = fp.place_id
  AND me.to_place_id = tp.place_id
  AND fp.location IS NOT NULL
  AND tp.location IS NOT NULL
  AND me.distance_meters IS NULL;

-- ============================================================
-- 5. Classify movement types
-- ============================================================

\echo ''
\echo 'Step 4: Classifying movement types...'

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
WHERE me.movement_type IN ('backfill', 'MIG_546') OR me.movement_type IS NULL;

-- ============================================================
-- 6. Create trigger to auto-record movements
-- ============================================================

\echo ''
\echo 'Step 5: Creating trigger for automatic movement recording...'

CREATE OR REPLACE FUNCTION trapper.trigger_appointment_movement()
RETURNS TRIGGER AS $$
BEGIN
    -- Only record if we have both cat and place
    IF NEW.cat_id IS NOT NULL AND NEW.place_id IS NOT NULL THEN
        -- Use the record_cat_movement function
        PERFORM trapper.record_cat_movement(
            p_cat_id := NEW.cat_id,
            p_to_place_id := NEW.place_id,
            p_event_date := NEW.appointment_date::DATE,
            p_source_type := 'appointment',
            p_source_record_id := NEW.appointment_id::TEXT
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_appointment_movement ON trapper.sot_appointments;

-- Create trigger
CREATE TRIGGER trg_appointment_movement
AFTER INSERT OR UPDATE OF cat_id, place_id ON trapper.sot_appointments
FOR EACH ROW
EXECUTE FUNCTION trapper.trigger_appointment_movement();

COMMENT ON FUNCTION trapper.trigger_appointment_movement IS
'Automatically records cat movement events when appointment cat_id or place_id is set.';

-- ============================================================
-- 7. Verification - Gary/Heather case
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Movement types distribution:'
SELECT movement_type, COUNT(*) as count
FROM trapper.cat_movement_events
GROUP BY movement_type
ORDER BY count DESC;

\echo ''
\echo 'Cats with movements to multiple places:'
SELECT COUNT(*) as cats_with_multi_place_movements
FROM (
    SELECT cat_id
    FROM trapper.cat_movement_events
    GROUP BY cat_id
    HAVING COUNT(DISTINCT to_place_id) > 1
) x;

\echo ''
\echo 'Movement patterns:'
SELECT movement_pattern, COUNT(*) as cats
FROM trapper.v_cat_movement_patterns
GROUP BY movement_pattern
ORDER BY cats DESC;

\echo ''
\echo 'Sample cat with multiple locations (like Gary/Heather case):'
SELECT
    c.display_name as cat_name,
    me.microchip,
    fp.display_name as from_place,
    tp.display_name as to_place,
    me.event_date,
    me.movement_type,
    ROUND(me.distance_meters) as distance_m
FROM trapper.cat_movement_events me
JOIN trapper.sot_cats c ON c.cat_id = me.cat_id
LEFT JOIN trapper.places fp ON fp.place_id = me.from_place_id
JOIN trapper.places tp ON tp.place_id = me.to_place_id
WHERE me.cat_id IN (
    SELECT cat_id FROM trapper.cat_movement_events
    GROUP BY cat_id
    HAVING COUNT(DISTINCT to_place_id) > 1
)
ORDER BY me.cat_id, me.event_date
LIMIT 10;

\echo ''
\echo '=== MIG_546 Complete ==='
