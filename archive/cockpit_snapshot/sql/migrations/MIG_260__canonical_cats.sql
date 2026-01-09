-- MIG_260__canonical_cats.sql
-- MEGA_007 Phase 3: Canonical Cat table from ClinicHQ
--
-- Creates canonical cats using microchip as the stable anchor.
-- Aggregates all ClinicHQ historical appointments for each unique microchip.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_260__canonical_cats.sql

-- ============================================================
-- PART 1: Canonical Cat Table
-- ============================================================

-- Drop existing table if recreating
DROP TABLE IF EXISTS trapper.canonical_cats CASCADE;

CREATE TABLE trapper.canonical_cats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Microchip is the stable anchor (required for canonical)
    microchip_number TEXT NOT NULL UNIQUE,

    -- Best known name (from most recent appointment)
    display_name TEXT NOT NULL,

    -- Physical characteristics (from most recent where available)
    breed TEXT,
    sex TEXT,
    primary_color TEXT,
    secondary_color TEXT,

    -- Surgery status (from most recent appointment)
    spay_neuter_status TEXT,

    -- Age at most recent appointment
    last_weight NUMERIC(20, 2),
    last_age_months INTEGER,
    last_age_years INTEGER,

    -- Appointment history
    first_appt_date DATE,
    last_appt_date DATE,
    total_appts INTEGER NOT NULL DEFAULT 0,

    -- Owner linkage (from most recent appointment)
    last_owner_id UUID REFERENCES trapper.clinichq_hist_owners(id),

    -- Source tracking
    source_hist_cat_ids UUID[] NOT NULL DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for search and lookup
CREATE INDEX idx_canonical_cats_name_trgm ON trapper.canonical_cats USING gin (display_name gin_trgm_ops);
CREATE INDEX idx_canonical_cats_microchip ON trapper.canonical_cats (microchip_number);
CREATE INDEX idx_canonical_cats_last_appt ON trapper.canonical_cats (last_appt_date);
CREATE INDEX idx_canonical_cats_last_owner ON trapper.canonical_cats (last_owner_id);

COMMENT ON TABLE trapper.canonical_cats IS
'Canonical cats aggregated from ClinicHQ history using microchip as stable anchor.
Each unique microchip = one canonical cat. MEGA_007 Phase 3.';

-- ============================================================
-- PART 2: Populate from ClinicHQ History
-- ============================================================

-- Materialized aggregation of cats by microchip
INSERT INTO trapper.canonical_cats (
    microchip_number,
    display_name,
    breed,
    sex,
    primary_color,
    secondary_color,
    spay_neuter_status,
    last_weight,
    last_age_months,
    last_age_years,
    first_appt_date,
    last_appt_date,
    total_appts,
    source_hist_cat_ids
)
SELECT
    microchip_number,
    -- Best name: from most recent appointment
    (ARRAY_AGG(animal_name ORDER BY appt_date DESC NULLS LAST))[1] AS display_name,
    -- Physical: from most recent where not null
    (ARRAY_AGG(breed ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE breed IS NOT NULL))[1] AS breed,
    (ARRAY_AGG(sex ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE sex IS NOT NULL))[1] AS sex,
    (ARRAY_AGG(primary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE primary_color IS NOT NULL))[1] AS primary_color,
    (ARRAY_AGG(secondary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE secondary_color IS NOT NULL))[1] AS secondary_color,
    -- Surgery status from most recent
    (ARRAY_AGG(spay_neuter_status ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE spay_neuter_status IS NOT NULL))[1] AS spay_neuter_status,
    -- Physical measurements from most recent
    (ARRAY_AGG(weight ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE weight IS NOT NULL))[1] AS last_weight,
    (ARRAY_AGG(age_months ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_months IS NOT NULL))[1] AS last_age_months,
    (ARRAY_AGG(age_years ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_years IS NOT NULL))[1] AS last_age_years,
    -- Appointment dates
    MIN(appt_date) AS first_appt_date,
    MAX(appt_date) AS last_appt_date,
    COUNT(*) AS total_appts,
    -- Source tracking
    ARRAY_AGG(id ORDER BY appt_date DESC) AS source_hist_cat_ids
FROM trapper.clinichq_hist_cats
WHERE microchip_number IS NOT NULL
  AND microchip_number != ''
  AND LENGTH(microchip_number) >= 9  -- Valid microchip length
GROUP BY microchip_number;

-- ============================================================
-- PART 3: Link to owners via appt_number
-- ============================================================

-- Link cats to owners via microchip (owners table has microchip column)
CREATE OR REPLACE VIEW trapper.v_canonical_cat_owners AS
WITH owner_matches AS (
    SELECT
        cc.id AS canonical_cat_id,
        cc.microchip_number,
        ho.id AS owner_id,
        ho.owner_first_name,
        ho.owner_last_name,
        ho.phone_normalized,
        ho.owner_email,
        ho.appt_date,
        ROW_NUMBER() OVER (PARTITION BY cc.id ORDER BY ho.appt_date DESC) AS rn
    FROM trapper.canonical_cats cc
    JOIN trapper.clinichq_hist_owners ho ON ho.microchip_number = cc.microchip_number
)
SELECT
    canonical_cat_id,
    microchip_number,
    owner_id,
    owner_first_name,
    owner_last_name,
    phone_normalized,
    owner_email,
    appt_date AS last_seen_date
FROM owner_matches
WHERE rn = 1;

COMMENT ON VIEW trapper.v_canonical_cat_owners IS
'Links canonical cats to their most recent owner from ClinicHQ history.';

-- Update canonical_cats with last_owner_id
UPDATE trapper.canonical_cats cc
SET last_owner_id = cco.owner_id
FROM trapper.v_canonical_cat_owners cco
WHERE cc.id = cco.canonical_cat_id
  AND cco.owner_id IS NOT NULL;

-- ============================================================
-- PART 4: Update Search View to include canonical cats
-- ============================================================

-- Add canonical cats to the unified search view
-- This will be done by updating v_search_unified_v2 to include canonical_cats

-- For now, create a helper view for canonical cat search
CREATE OR REPLACE VIEW trapper.v_search_canonical_cats AS
SELECT
    'canonical_cat'::text AS entity_type,
    cc.id AS entity_id,
    COALESCE(cc.display_name, 'Unknown Cat') || ' - ' || cc.microchip_number AS display_label,
    cc.display_name AS name_text,
    NULL::text AS address_display,
    NULL::boolean AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    cc.last_appt_date AS relevant_date,
    cc.spay_neuter_status AS status,
    NULL::geometry AS location,
    -- Extra context
    cc.microchip_number,
    cc.breed || ' ' || COALESCE(cc.sex, '') || ' ' || COALESCE(cc.primary_color, '') AS surgery_info,
    CONCAT_WS(' ', cco.owner_first_name, cco.owner_last_name) AS owner_name,
    cco.phone_normalized AS owner_phone,
    -- Search text
    LOWER(COALESCE(cc.display_name, '') || ' ' || cc.microchip_number || ' ' ||
          COALESCE(cc.breed, '') || ' ' || COALESCE(cc.primary_color, '')) AS search_text
FROM trapper.canonical_cats cc
LEFT JOIN trapper.v_canonical_cat_owners cco ON cco.canonical_cat_id = cc.id;

COMMENT ON VIEW trapper.v_search_canonical_cats IS
'Search view for canonical cats. Used by unified search. MEGA_007 Phase 3.';

-- ============================================================
-- PART 5: Refresh function for future updates
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.refresh_canonical_cats()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Clear and repopulate
    TRUNCATE trapper.canonical_cats;

    INSERT INTO trapper.canonical_cats (
        microchip_number,
        display_name,
        breed,
        sex,
        primary_color,
        secondary_color,
        spay_neuter_status,
        last_weight,
        last_age_months,
        last_age_years,
        first_appt_date,
        last_appt_date,
        total_appts,
        source_hist_cat_ids
    )
    SELECT
        microchip_number,
        (ARRAY_AGG(animal_name ORDER BY appt_date DESC NULLS LAST))[1],
        (ARRAY_AGG(breed ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE breed IS NOT NULL))[1],
        (ARRAY_AGG(sex ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE sex IS NOT NULL))[1],
        (ARRAY_AGG(primary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE primary_color IS NOT NULL))[1],
        (ARRAY_AGG(secondary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE secondary_color IS NOT NULL))[1],
        (ARRAY_AGG(spay_neuter_status ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE spay_neuter_status IS NOT NULL))[1],
        (ARRAY_AGG(weight ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE weight IS NOT NULL))[1],
        (ARRAY_AGG(age_months ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_months IS NOT NULL))[1],
        (ARRAY_AGG(age_years ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_years IS NOT NULL))[1],
        MIN(appt_date),
        MAX(appt_date),
        COUNT(*),
        ARRAY_AGG(id ORDER BY appt_date DESC)
    FROM trapper.clinichq_hist_cats
    WHERE microchip_number IS NOT NULL
      AND microchip_number != ''
      AND LENGTH(microchip_number) >= 9
    GROUP BY microchip_number;

    -- Update owner links
    UPDATE trapper.canonical_cats cc
    SET last_owner_id = cco.owner_id,
        updated_at = NOW()
    FROM trapper.v_canonical_cat_owners cco
    WHERE cc.id = cco.canonical_cat_id
      AND cco.owner_id IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION trapper.refresh_canonical_cats IS
'Refreshes canonical_cats table from clinichq_hist_cats. Run after ClinicHQ import.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_260 applied. Canonical cats table created.'
\echo ''

SELECT
    COUNT(*) AS total_canonical_cats,
    COUNT(last_owner_id) AS with_owner_link,
    SUM(total_appts) AS total_appointments_covered,
    MIN(first_appt_date) AS earliest_appt,
    MAX(last_appt_date) AS latest_appt
FROM trapper.canonical_cats;

\echo ''
\echo 'Top 10 cats by appointment count:'
SELECT
    display_name,
    microchip_number,
    total_appts,
    first_appt_date,
    last_appt_date,
    spay_neuter_status
FROM trapper.canonical_cats
ORDER BY total_appts DESC
LIMIT 10;
