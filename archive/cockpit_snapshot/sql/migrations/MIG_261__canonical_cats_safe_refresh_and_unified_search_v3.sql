-- MIG_261__canonical_cats_safe_refresh_and_unified_search_v3.sql
-- DB_261: Safe canonical cats refresh + unified search v3
--
-- SAFETY: This migration uses ONLY additive operations:
--   - ALTER TABLE ADD COLUMN (if not exists pattern)
--   - CREATE OR REPLACE FUNCTION (UPSERT, no TRUNCATE)
--   - CREATE OR REPLACE VIEW
--
-- NO DROP, NO TRUNCATE, NO DESTRUCTIVE OPS.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_261__canonical_cats_safe_refresh_and_unified_search_v3.sql

-- ============================================================
-- PART A: Add last_seen_owner_name + last_seen_at columns (safe)
-- ============================================================

-- Add columns if they don't exist (safe, additive only)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'canonical_cats'
        AND column_name = 'last_seen_owner_name'
    ) THEN
        ALTER TABLE trapper.canonical_cats
        ADD COLUMN last_seen_owner_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'canonical_cats'
        AND column_name = 'last_seen_at'
    ) THEN
        ALTER TABLE trapper.canonical_cats
        ADD COLUMN last_seen_at DATE;
    END IF;
END $$;

COMMENT ON COLUMN trapper.canonical_cats.last_seen_owner_name IS
'Owner name from most recent ClinicHQ appointment. May be nonsense/archival. For display only.';

COMMENT ON COLUMN trapper.canonical_cats.last_seen_at IS
'Date of most recent ClinicHQ appointment for this cat.';

-- ============================================================
-- PART A2: Safe UPSERT refresh function (no TRUNCATE!)
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.refresh_canonical_cats_safe()
RETURNS TABLE(inserted int, updated int, total int)
LANGUAGE plpgsql
AS $$
DECLARE
    v_inserted INT := 0;
    v_updated INT := 0;
    v_total INT;
BEGIN
    -- UPSERT pattern: Insert new cats, update existing by microchip_number
    -- NO DROP, NO TRUNCATE - safe for production use

    WITH cat_agg AS (
        SELECT
            microchip_number,
            (ARRAY_AGG(animal_name ORDER BY appt_date DESC NULLS LAST))[1] AS display_name,
            (ARRAY_AGG(breed ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE breed IS NOT NULL))[1] AS breed,
            (ARRAY_AGG(sex ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE sex IS NOT NULL))[1] AS sex,
            (ARRAY_AGG(primary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE primary_color IS NOT NULL))[1] AS primary_color,
            (ARRAY_AGG(secondary_color ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE secondary_color IS NOT NULL))[1] AS secondary_color,
            (ARRAY_AGG(spay_neuter_status ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE spay_neuter_status IS NOT NULL))[1] AS spay_neuter_status,
            (ARRAY_AGG(weight ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE weight IS NOT NULL))[1] AS last_weight,
            (ARRAY_AGG(age_months ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_months IS NOT NULL))[1] AS last_age_months,
            (ARRAY_AGG(age_years ORDER BY appt_date DESC NULLS LAST) FILTER (WHERE age_years IS NOT NULL))[1] AS last_age_years,
            MIN(appt_date) AS first_appt_date,
            MAX(appt_date) AS last_appt_date,
            COUNT(*) AS total_appts,
            ARRAY_AGG(id ORDER BY appt_date DESC) AS source_hist_cat_ids
        FROM trapper.clinichq_hist_cats
        WHERE microchip_number IS NOT NULL
          AND microchip_number != ''
          AND LENGTH(microchip_number) >= 9
        GROUP BY microchip_number
    ),
    upserted AS (
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
            source_hist_cat_ids,
            last_seen_at,
            updated_at
        )
        SELECT
            ca.microchip_number,
            COALESCE(ca.display_name, 'Unknown Cat'),
            ca.breed,
            ca.sex,
            ca.primary_color,
            ca.secondary_color,
            ca.spay_neuter_status,
            ca.last_weight,
            ca.last_age_months,
            ca.last_age_years,
            ca.first_appt_date,
            ca.last_appt_date,
            ca.total_appts,
            ca.source_hist_cat_ids,
            ca.last_appt_date,  -- last_seen_at = last_appt_date
            NOW()
        FROM cat_agg ca
        ON CONFLICT (microchip_number) DO UPDATE SET
            display_name = COALESCE(EXCLUDED.display_name, trapper.canonical_cats.display_name),
            breed = COALESCE(EXCLUDED.breed, trapper.canonical_cats.breed),
            sex = COALESCE(EXCLUDED.sex, trapper.canonical_cats.sex),
            primary_color = COALESCE(EXCLUDED.primary_color, trapper.canonical_cats.primary_color),
            secondary_color = COALESCE(EXCLUDED.secondary_color, trapper.canonical_cats.secondary_color),
            spay_neuter_status = COALESCE(EXCLUDED.spay_neuter_status, trapper.canonical_cats.spay_neuter_status),
            last_weight = COALESCE(EXCLUDED.last_weight, trapper.canonical_cats.last_weight),
            last_age_months = COALESCE(EXCLUDED.last_age_months, trapper.canonical_cats.last_age_months),
            last_age_years = COALESCE(EXCLUDED.last_age_years, trapper.canonical_cats.last_age_years),
            first_appt_date = LEAST(EXCLUDED.first_appt_date, trapper.canonical_cats.first_appt_date),
            last_appt_date = GREATEST(EXCLUDED.last_appt_date, trapper.canonical_cats.last_appt_date),
            total_appts = EXCLUDED.total_appts,
            source_hist_cat_ids = EXCLUDED.source_hist_cat_ids,
            last_seen_at = GREATEST(EXCLUDED.last_seen_at, trapper.canonical_cats.last_seen_at),
            updated_at = NOW()
        RETURNING (xmax = 0) AS was_inserted
    )
    SELECT
        COUNT(*) FILTER (WHERE was_inserted),
        COUNT(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

    -- Update last_seen_owner_name from owner linkage
    UPDATE trapper.canonical_cats cc
    SET last_seen_owner_name = CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name)
    FROM trapper.v_canonical_cat_owners cco
    JOIN trapper.clinichq_hist_owners ho ON ho.id = cco.owner_id
    WHERE cc.id = cco.canonical_cat_id
      AND cco.owner_id IS NOT NULL;

    SELECT COUNT(*) INTO v_total FROM trapper.canonical_cats;

    RETURN QUERY SELECT v_inserted, v_updated, v_total;
END;
$$;

COMMENT ON FUNCTION trapper.refresh_canonical_cats_safe IS
'Safe UPSERT refresh for canonical_cats. NO DROP, NO TRUNCATE.
Inserts new cats, updates existing by microchip_number.
Run after ClinicHQ import.';

-- ============================================================
-- PART A3: Backfill last_seen_owner_name for existing cats
-- ============================================================

UPDATE trapper.canonical_cats cc
SET
    last_seen_owner_name = CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name),
    last_seen_at = COALESCE(cc.last_appt_date, cc.last_seen_at)
FROM trapper.v_canonical_cat_owners cco
JOIN trapper.clinichq_hist_owners ho ON ho.id = cco.owner_id
WHERE cc.id = cco.canonical_cat_id
  AND cc.last_seen_owner_name IS NULL;

-- ============================================================
-- PART B: Create v_search_unified_v3 with canonical cats
-- ============================================================

-- Update v_search_canonical_cats to include last_seen_owner_name in search text
CREATE OR REPLACE VIEW trapper.v_search_canonical_cats AS
SELECT
    'canonical_cat'::text AS entity_type,
    cc.id AS entity_id,
    COALESCE(cc.display_name, 'Cat') || ' - ' || cc.microchip_number AS display_label,
    cc.display_name AS name_text,
    NULL::text AS address_display,
    NULL::boolean AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    cc.last_seen_at AS relevant_date,
    cc.spay_neuter_status AS status,
    NULL::geometry AS location,
    -- Extra context columns
    cc.microchip_number,
    CONCAT_WS(' ', cc.breed, cc.sex, cc.primary_color) AS surgery_info,
    cc.last_seen_owner_name AS owner_name,
    NULL::text AS owner_phone,
    -- Search text includes microchip AND owner name for finding cats via nonsense owners
    LOWER(
        COALESCE(cc.display_name, '') || ' ' ||
        cc.microchip_number || ' ' ||
        COALESCE(cc.breed, '') || ' ' ||
        COALESCE(cc.primary_color, '') || ' ' ||
        COALESCE(cc.last_seen_owner_name, '')
    ) AS search_text,
    -- Normalized search text
    LOWER(
        COALESCE(cc.display_name, '') || ' ' ||
        cc.microchip_number || ' ' ||
        COALESCE(cc.last_seen_owner_name, '')
    ) AS search_text_normalized,
    -- For v3 compatibility
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.canonical_cats cc;

COMMENT ON VIEW trapper.v_search_canonical_cats IS
'Search view for canonical cats. Includes last_seen_owner_name in search text
so searching for a nonsense owner name still finds the cat. DB_261.';

-- Create v_search_unified_v3 that includes canonical cats
-- Cast entity_id to text for consistent typing across UNION
CREATE OR REPLACE VIEW trapper.v_search_unified_v3 AS
-- Existing v_search_unified_v2 content (cast entity_id to text)
SELECT
    entity_type,
    entity_id::text AS entity_id,
    display_label,
    name_text,
    address_display,
    address_canonical,
    phone_text,
    email_text,
    city,
    postal_code,
    relevant_date::date AS relevant_date,
    status,
    location,
    microchip_number,
    surgery_info,
    owner_name,
    search_text,
    search_text_normalized,
    hist_owner_class,
    hist_owner_recency,
    hist_owner_entity_kind
FROM trapper.v_search_unified_v2

UNION ALL

-- Canonical cats (first-class canonical entities)
SELECT
    entity_type,
    entity_id::text AS entity_id,
    display_label,
    name_text,
    address_display,
    address_canonical,
    phone_text,
    email_text,
    city,
    postal_code,
    relevant_date,
    status,
    location,
    microchip_number,
    surgery_info,
    owner_name,
    search_text,
    search_text_normalized,
    hist_owner_class,
    hist_owner_recency,
    hist_owner_entity_kind
FROM trapper.v_search_canonical_cats;

COMMENT ON VIEW trapper.v_search_unified_v3 IS
'Unified search view v3. Includes all entities from v2 plus canonical cats.
Canonical cats are first-class entities, searchable by microchip or owner name.
DB_261: Makes cats stable anchors even when owner accounts are nonsense/archival.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_261 applied. Safe refresh + unified search v3.'
\echo ''
\echo 'New columns added to canonical_cats:'
\echo '  - last_seen_owner_name (text) - owner name from most recent appt'
\echo '  - last_seen_at (date) - date of most recent appt'
\echo ''
\echo 'New function: trapper.refresh_canonical_cats_safe()'
\echo '  - UPSERT by microchip_number (NO DROP, NO TRUNCATE)'
\echo ''
\echo 'New view: trapper.v_search_unified_v3'
\echo '  - Includes canonical_cat entity type'
\echo '  - Searching owner name finds the cat'
\echo ''

-- Show sample canonical cats with owner names
SELECT
    microchip_number,
    display_name,
    last_seen_owner_name,
    last_seen_at,
    total_appts
FROM trapper.canonical_cats
WHERE last_seen_owner_name IS NOT NULL
ORDER BY last_seen_at DESC NULLS LAST
LIMIT 10;

-- Verify v3 includes canonical cats
\echo ''
\echo 'Canonical cats in v_search_unified_v3:'
SELECT entity_type, COUNT(*) AS count
FROM trapper.v_search_unified_v3
WHERE entity_type = 'canonical_cat'
GROUP BY entity_type;
