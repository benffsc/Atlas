-- MIG_2853: FFSC Program Cat Classification (FFS-260)
--
-- After running sot.run_all_entity_linking() post-audit-fixes, 2,866 ClinicHQ cats
-- remain unlinked to places. These are FFSC program cats — booked under organizational
-- accounts like "Forgotten Felines Fosters", "SCAS", "Fire Cat" — whose owner_address
-- points to the FFSC clinic (1814 Empire Industrial Ct), which is correctly blacklisted.
--
-- This migration:
-- 1. Creates ops.classify_ffsc_booking() to classify program bookings
-- 2. Adds ffsc_program column to ops.appointments
-- 3. Backfills existing appointments
-- 4. Updates monitoring views to exclude FFSC program cats from coverage metrics
-- 5. Adds ops.v_ffsc_trapping_sites view for manual review

BEGIN;

-- =============================================================================
-- 1. Classification function
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.classify_ffsc_booking(p_client_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF p_client_name IS NULL THEN
        RETURN NULL;
    END IF;

    v_name := LOWER(TRIM(p_client_name));

    -- FFSC foster program
    IF v_name LIKE '%forgotten felines foster%' THEN
        RETURN 'ffsc_foster';
    END IF;

    -- FFSC office cats
    IF v_name LIKE '%forgotten felines office%' THEN
        RETURN 'ffsc_office';
    END IF;

    -- FFSC colony cats
    IF v_name LIKE '%forgotten felines colony%' THEN
        RETURN 'ffsc_colony';
    END IF;

    -- Shelter transfers (SCAS = Sonoma County Animal Services, RPAS = Rohnert Park Animal Shelter)
    IF v_name ~ '^(scas|rpas)\b' THEN
        RETURN 'shelter_transfer';
    END IF;

    -- Fire rescue cats
    IF v_name LIKE 'fire cat%' THEN
        RETURN 'fire_rescue';
    END IF;

    -- Rebooking placeholders
    IF v_name LIKE '%rebooking placeholder%' OR v_name LIKE '%rebook%' THEN
        RETURN 'placeholder';
    END IF;

    -- FFSC trapping sites (e.g., "West School Street Ffsc", "Silveira Ranch Forgotten Felines")
    IF v_name ~ '\s(ffsc|forgotten felines)\s*$' THEN
        RETURN 'ffsc_trapping_site';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.classify_ffsc_booking(TEXT) IS
    'Classify a ClinicHQ booking as an FFSC program booking. Returns NULL if not a program booking.';

-- =============================================================================
-- 2. Add column to ops.appointments
-- =============================================================================

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS ffsc_program TEXT;

COMMENT ON COLUMN ops.appointments.ffsc_program IS
    'FFSC program classification: ffsc_foster, ffsc_office, ffsc_colony, shelter_transfer, fire_rescue, placeholder, ffsc_trapping_site. NULL = regular community booking.';

-- =============================================================================
-- 3. Backfill existing appointments
-- =============================================================================

UPDATE ops.appointments
SET ffsc_program = ops.classify_ffsc_booking(client_name)
WHERE client_name IS NOT NULL
  AND ffsc_program IS NULL
  AND ops.classify_ffsc_booking(client_name) IS NOT NULL;

-- =============================================================================
-- 4. Update monitoring views
-- =============================================================================

-- 4a. v_cat_place_coverage — Add ffsc_program count, exclude from coverage denominator
-- Must DROP because new column order differs from original (PostgreSQL restriction)
DROP VIEW IF EXISTS ops.v_cat_place_coverage;
CREATE VIEW ops.v_cat_place_coverage AS
WITH ffsc_cats AS (
    -- Cats where ALL appointments are FFSC program (no non-program appointments)
    SELECT DISTINCT a.cat_id
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.ffsc_program IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM ops.appointments a2
          WHERE a2.cat_id = a.cat_id
            AND (a2.ffsc_program IS NULL)
      )
),
cat_stats AS (
    SELECT
        COUNT(*) as total_cats,
        COUNT(*) FILTER (WHERE fc.cat_id IS NOT NULL) as cats_ffsc_program,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
        )) as cats_with_place,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id
        )) as cats_with_appointments,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id
        )) as cats_with_person
    FROM sot.cats c
    LEFT JOIN ffsc_cats fc ON fc.cat_id = c.cat_id
    WHERE c.merged_into_cat_id IS NULL
),
link_stats AS (
    SELECT
        COUNT(*) as total_links,
        COUNT(DISTINCT cat_id) as unique_cats,
        COUNT(*) FILTER (WHERE source_table = 'link_cats_to_appointment_places') as via_appointments,
        COUNT(*) FILTER (WHERE source_table = 'link_cats_to_places') as via_person_chain,
        COUNT(*) FILTER (WHERE relationship_type = 'home') as home_links,
        COUNT(*) FILTER (WHERE relationship_type = 'residence') as residence_links,
        COUNT(*) FILTER (WHERE relationship_type = 'colony_member') as colony_links
    FROM sot.cat_place
)
SELECT
    cs.total_cats,
    cs.cats_ffsc_program,
    cs.cats_with_place,
    -- Coverage excludes FFSC program cats from denominator
    ROUND(100.0 * cs.cats_with_place / NULLIF(cs.total_cats - cs.cats_ffsc_program, 0), 1) as place_coverage_pct,
    cs.cats_with_appointments,
    cs.cats_with_person,
    ls.total_links,
    ROUND(1.0 * ls.total_links / NULLIF(ls.unique_cats, 0), 2) as avg_links_per_cat,
    ls.via_appointments,
    ls.via_person_chain,
    ls.home_links,
    ls.residence_links,
    ls.colony_links
FROM cat_stats cs
CROSS JOIN link_stats ls;

COMMENT ON VIEW ops.v_cat_place_coverage IS
    'Cat-place linking coverage. cats_ffsc_program excluded from coverage denominator (FFS-260).';

-- 4b. v_cats_without_places — Exclude FFSC program cats
CREATE OR REPLACE VIEW ops.v_cats_without_places AS
SELECT
    c.cat_id,
    c.name,
    c.microchip,
    c.source_system,
    c.created_at as cat_created_at,
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
    (SELECT MAX(a.appointment_date) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as last_appointment,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id) as person_links,
    els.reason as skip_reason,
    els.created_at as skip_logged_at
FROM sot.cats c
LEFT JOIN ops.entity_linking_skipped els ON els.entity_id = c.cat_id AND els.entity_type = 'cat'
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id)
  -- Exclude cats whose ONLY appointments are FFSC program bookings (FFS-260)
  AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.cat_id = c.cat_id
        AND a.ffsc_program IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM ops.appointments a2
            WHERE a2.cat_id = c.cat_id
              AND a2.ffsc_program IS NULL
        )
  );

COMMENT ON VIEW ops.v_cats_without_places IS
    'Cats without place links, excluding FFSC program cats (FFS-260). Use for monitoring entity linking coverage.';

-- 4c. check_entity_linking_health() — cat_place_coverage now uses adjusted view automatically
-- No changes needed since it reads from v_cat_place_coverage which already excludes FFSC program cats

-- =============================================================================
-- 5. Trapping site review view
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_ffsc_trapping_sites AS
SELECT
    a.client_name,
    TRIM(REGEXP_REPLACE(a.client_name, '\s*(ffsc|forgotten felines)\s*$', '', 'i')) AS extracted_location,
    COUNT(DISTINCT a.cat_id) as cat_count,
    MIN(a.appointment_date) as first_seen,
    MAX(a.appointment_date) as last_seen
FROM ops.appointments a
WHERE a.ffsc_program = 'ffsc_trapping_site'
GROUP BY a.client_name
ORDER BY cat_count DESC;

COMMENT ON VIEW ops.v_ffsc_trapping_sites IS
    'Trapping sites booked under FFSC accounts. extracted_location can be used for manual place matching (FFS-260).';

COMMIT;
