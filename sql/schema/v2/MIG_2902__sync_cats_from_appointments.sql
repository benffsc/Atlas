-- MIG_2902: Create ops.sync_cats_from_appointments() function (FFS-420)
--
-- Problem: MIG_2896-2899 backfilled sot.cats columns (weight_lbs, estimated_birth_date,
-- age_group, coat_length) from ops.appointments data. But the live ingest pipeline
-- does NOT sync these columns. New cats from future uploads will have NULL weight/age/coat
-- even though the appointment data is there.
--
-- Solution: SQL function called inline during ingest (after weight/age enrichment)
-- that syncs sot.cats from the latest appointment data. Only fills NULLs.
-- Merge-aware. Safe to call repeatedly.

CREATE OR REPLACE FUNCTION ops.sync_cats_from_appointments()
RETURNS TABLE(weight_updated INT, age_updated INT, coat_updated INT) AS $$
DECLARE
    v_weight INT;
    v_age INT;
    v_coat INT;
BEGIN
    -- =========================================================================
    -- 1. Weight: appointment cat_weight_lbs → sot.cats.weight_lbs
    -- Only where sot.cats.weight_lbs IS NULL and appointment has valid weight
    -- =========================================================================

    WITH latest_weight AS (
        SELECT DISTINCT ON (a.cat_id)
            a.cat_id,
            a.cat_weight_lbs
        FROM ops.appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.cat_weight_lbs IS NOT NULL
          AND a.cat_weight_lbs > 0
          AND a.cat_weight_lbs <= 30  -- Sanity cap
        ORDER BY a.cat_id, a.appointment_date DESC
    )
    UPDATE sot.cats c
    SET weight_lbs = lw.cat_weight_lbs, updated_at = NOW()
    FROM latest_weight lw
    WHERE lw.cat_id = c.cat_id
      AND c.merged_into_cat_id IS NULL
      AND c.weight_lbs IS NULL;

    GET DIAGNOSTICS v_weight = ROW_COUNT;

    -- =========================================================================
    -- 2. Age: cat_age_years/cat_age_months + appointment_date → estimated_birth_date + age_group
    -- Same formula as MIG_2896/MIG_2899
    -- =========================================================================

    WITH latest_age AS (
        SELECT DISTINCT ON (a.cat_id)
            a.cat_id,
            a.appointment_date,
            a.cat_age_years,
            a.cat_age_months
        FROM ops.appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.cat_age_years IS NOT NULL
        ORDER BY a.cat_id, a.appointment_date DESC
    )
    UPDATE sot.cats c
    SET
        estimated_birth_date = la.appointment_date - (la.cat_age_years * 365 + COALESCE(la.cat_age_months, 0) * 30)::int,
        age_group = CASE
            WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 6 THEN 'kitten'
            WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 12 THEN 'juvenile'
            WHEN (la.cat_age_years * 12 + COALESCE(la.cat_age_months, 0)) < 84 THEN 'adult'
            ELSE 'senior'
        END,
        updated_at = NOW()
    FROM latest_age la
    WHERE la.cat_id = c.cat_id
      AND c.merged_into_cat_id IS NULL
      AND c.estimated_birth_date IS NULL;

    GET DIAGNOSTICS v_age = ROW_COUNT;

    -- =========================================================================
    -- 3. Coat length: infer from breed name where sot.cats.coat_length IS NULL
    -- =========================================================================

    UPDATE sot.cats c
    SET
        coat_length = CASE
            WHEN c.breed ILIKE '%shorthair%' THEN 'short'
            WHEN c.breed ILIKE '%longhair%' THEN 'long'
            WHEN c.breed ILIKE '%mediumhair%' OR c.breed ILIKE '%medium hair%' THEN 'medium'
        END,
        updated_at = NOW()
    WHERE c.merged_into_cat_id IS NULL
      AND c.coat_length IS NULL
      AND c.breed IS NOT NULL
      AND (
          c.breed ILIKE '%shorthair%'
          OR c.breed ILIKE '%longhair%'
          OR c.breed ILIKE '%mediumhair%'
          OR c.breed ILIKE '%medium hair%'
      );

    GET DIAGNOSTICS v_coat = ROW_COUNT;

    RETURN QUERY SELECT v_weight, v_age, v_coat;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.sync_cats_from_appointments IS
'Syncs sot.cats columns (weight_lbs, estimated_birth_date, age_group, coat_length)
from ops.appointments data. Only fills NULL values. Merge-aware. Idempotent.
Called inline during ingest after appointment weight/age enrichment.';
