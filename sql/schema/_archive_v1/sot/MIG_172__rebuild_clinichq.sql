-- MIG_172__rebuild_clinichq.sql
-- FFSC Office handling, data source priority, and rebuild support
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_172__rebuild_clinichq.sql

\echo ''
\echo 'MIG_172: FFSC Office + Data Source Priority'
\echo '============================================'
\echo ''

-- ============================================================
-- 1. Extend data_source enum with clinichq and petlink
-- ============================================================

\echo 'Extending data_source enum...'

-- Check if values already exist before adding
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'clinichq' AND enumtypid = 'trapper.data_source'::regtype) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'clinichq';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'petlink' AND enumtypid = 'trapper.data_source'::regtype) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'petlink';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Enum values may already exist or enum does not exist';
END $$;

-- ============================================================
-- 2. Create FFSC office addresses table
-- ============================================================

\echo 'Creating FFSC office addresses table...'

CREATE TABLE IF NOT EXISTS trapper.ffsc_office_addresses (
    address_id SERIAL PRIMARY KEY,
    street_address TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Santa Rosa',
    state TEXT NOT NULL DEFAULT 'CA',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed known FFSC office addresses
INSERT INTO trapper.ffsc_office_addresses (street_address, description) VALUES
('1820 Empire Industrial Ct', 'FFSC Main Office'),
('1814 Empire Industrial Ct', 'FFSC Secondary Office')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Add origin_unknown flag to cat_place_relationships
-- ============================================================

\echo 'Adding origin_unknown flag to cat_place_relationships...'

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS origin_unknown BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cat_place_origin_unknown
ON trapper.cat_place_relationships(origin_unknown) WHERE origin_unknown = TRUE;

-- ============================================================
-- 4. Create or get FFSC Office place
-- ============================================================

\echo 'Creating FFSC Office place...'

-- Create the special FFSC Office place if it doesn't exist
INSERT INTO trapper.places (
    display_name,
    place_kind,
    is_address_backed,
    has_appointment_activity
)
SELECT
    'FFSC Office - Unknown Origin',
    'clinic'::trapper.place_kind,
    FALSE,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.places WHERE display_name = 'FFSC Office - Unknown Origin'
);

-- ============================================================
-- 5. Function to check if address is FFSC office
-- ============================================================

\echo 'Creating is_ffsc_office_address function...'

CREATE OR REPLACE FUNCTION trapper.is_ffsc_office_address(p_address TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_address IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM trapper.ffsc_office_addresses
        WHERE is_active = TRUE
          AND LOWER(p_address) LIKE '%' || LOWER(street_address) || '%'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 6. Function to determine data source priority
-- ============================================================

\echo 'Creating determine_data_source function...'

CREATE OR REPLACE FUNCTION trapper.determine_data_source(p_cat_id UUID)
RETURNS TEXT AS $$
BEGIN
    -- If cat has ClinicHQ staged records, it's a ClinicHQ patient
    IF EXISTS (
        SELECT 1 FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.payload::text LIKE '%' || (
              SELECT ci.id_value FROM trapper.cat_identifiers ci
              WHERE ci.cat_id = p_cat_id AND ci.id_type = 'microchip'
              LIMIT 1
          ) || '%'
    ) THEN
        RETURN 'clinichq';
    END IF;

    -- If cat has clinichq_animal_id, it's from ClinicHQ
    IF EXISTS (
        SELECT 1 FROM trapper.cat_identifiers
        WHERE cat_id = p_cat_id
          AND (id_type = 'clinichq_animal_id' OR source_system = 'clinichq')
    ) THEN
        RETURN 'clinichq';
    END IF;

    -- If cat has petlink identifier, it's from PetLink
    IF EXISTS (
        SELECT 1 FROM trapper.cat_identifiers
        WHERE cat_id = p_cat_id
          AND (id_type = 'petlink_pet_id' OR source_system = 'petlink')
    ) THEN
        RETURN 'petlink';
    END IF;

    -- Default to legacy_import
    RETURN 'legacy_import';
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 7. Function to update all cat data sources
-- ============================================================

\echo 'Creating update_cat_data_sources function...'

CREATE OR REPLACE FUNCTION trapper.update_cat_data_sources()
RETURNS TABLE(clinichq_count INT, petlink_count INT, legacy_count INT) AS $$
DECLARE
    v_clinichq INT := 0;
    v_petlink INT := 0;
    v_legacy INT := 0;
BEGIN
    -- Update each cat's data_source based on priority
    UPDATE trapper.sot_cats c
    SET data_source = trapper.determine_data_source(c.cat_id)::trapper.data_source,
        updated_at = NOW()
    WHERE data_source IS DISTINCT FROM trapper.determine_data_source(c.cat_id)::trapper.data_source;

    -- Count by source
    SELECT COUNT(*) INTO v_clinichq FROM trapper.sot_cats WHERE data_source = 'clinichq';
    SELECT COUNT(*) INTO v_petlink FROM trapper.sot_cats WHERE data_source = 'petlink';
    SELECT COUNT(*) INTO v_legacy FROM trapper.sot_cats WHERE data_source NOT IN ('clinichq', 'petlink') OR data_source IS NULL;

    RETURN QUERY SELECT v_clinichq, v_petlink, v_legacy;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. Function to link internal accounts to departments
-- ============================================================

\echo 'Creating link_internal_accounts_to_orgs function...'

CREATE OR REPLACE FUNCTION trapper.link_internal_accounts_to_orgs()
RETURNS INT AS $$
DECLARE
    v_linked INT := 0;
BEGIN
    INSERT INTO trapper.person_organization_link (person_id, org_id, link_type, link_reason)
    SELECT DISTINCT ON (p.person_id)
        p.person_id,
        o.org_id,
        'internal_account',
        'Matched pattern: ' || iat.account_pattern
    FROM trapper.sot_people p
    JOIN trapper.internal_account_types iat ON
        iat.is_active = TRUE
        AND (
            (iat.pattern_type = 'contains' AND LOWER(p.display_name) LIKE '%' || LOWER(iat.account_pattern) || '%')
            OR (iat.pattern_type = 'starts_with' AND LOWER(p.display_name) LIKE LOWER(iat.account_pattern) || '%')
        )
    JOIN trapper.organizations o ON o.org_code = iat.maps_to_org_code
    WHERE p.merged_into_person_id IS NULL
      AND (p.is_canonical = FALSE OR p.is_canonical IS NULL)
    ORDER BY p.person_id, iat.type_id
    ON CONFLICT (person_id, org_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 9. Function to flag cats at FFSC office addresses
-- ============================================================

\echo 'Creating link_ffsc_office_cats function...'

CREATE OR REPLACE FUNCTION trapper.link_ffsc_office_cats()
RETURNS INT AS $$
DECLARE
    v_ffsc_place_id UUID;
    v_linked INT := 0;
BEGIN
    -- Get the FFSC Office place ID
    SELECT place_id INTO v_ffsc_place_id
    FROM trapper.places
    WHERE display_name = 'FFSC Office - Unknown Origin'
    LIMIT 1;

    IF v_ffsc_place_id IS NULL THEN
        RAISE NOTICE 'FFSC Office place not found';
        RETURN 0;
    END IF;

    -- Find cats whose addresses match FFSC office and link them
    INSERT INTO trapper.cat_place_relationships (
        cat_id,
        place_id,
        relationship_type,
        confidence,
        source_system,
        source_table,
        origin_unknown
    )
    SELECT DISTINCT
        ci.cat_id,
        v_ffsc_place_id,
        'booking_site',
        'low',
        'clinichq',
        'appointment_info',
        TRUE
    FROM trapper.cat_identifiers ci
    JOIN trapper.staged_records sr ON
        sr.source_system = 'clinichq'
        AND sr.source_table IN ('appointment_info', 'owner_info')
        AND sr.payload->>'Microchip Number' = ci.id_value
    WHERE ci.id_type = 'microchip'
      AND trapper.is_ffsc_office_address(sr.payload->>'Owner Address')
      AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr
          WHERE cpr.cat_id = ci.cat_id
            AND cpr.place_id = v_ffsc_place_id
      )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10. Trigger to re-compute canonical status on identifier changes
-- ============================================================

\echo 'Creating canonical status trigger...'

CREATE OR REPLACE FUNCTION trapper.trigger_recompute_canonical()
RETURNS TRIGGER AS $$
BEGIN
    -- Update canonical status when identifiers change
    UPDATE trapper.sot_people
    SET is_canonical = trapper.compute_is_canonical(
        CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END
    ),
    updated_at = NOW()
    WHERE person_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END
      AND merged_into_person_id IS NULL;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompute_canonical ON trapper.person_identifiers;
CREATE TRIGGER trg_recompute_canonical
AFTER INSERT OR UPDATE OR DELETE ON trapper.person_identifiers
FOR EACH ROW EXECUTE FUNCTION trapper.trigger_recompute_canonical();

-- ============================================================
-- 11. Backup tables before any destructive operations
-- ============================================================

\echo ''
\echo 'Creating backup tables...'

DROP TABLE IF EXISTS trapper.backup_rebuild_person_cat_relationships;
CREATE TABLE trapper.backup_rebuild_person_cat_relationships AS
SELECT * FROM trapper.person_cat_relationships;

DROP TABLE IF EXISTS trapper.backup_rebuild_cat_place_relationships;
CREATE TABLE trapper.backup_rebuild_cat_place_relationships AS
SELECT * FROM trapper.cat_place_relationships;

\echo 'Backup complete.'

-- ============================================================
-- 12. Run data source updates
-- ============================================================

\echo ''
\echo 'Updating cat data sources...'
SELECT * FROM trapper.update_cat_data_sources();

-- ============================================================
-- 13. Link internal accounts to organizations
-- ============================================================

\echo ''
\echo 'Linking internal accounts to departments...'
SELECT trapper.link_internal_accounts_to_orgs() AS accounts_linked;

-- ============================================================
-- 14. Link FFSC office cats
-- ============================================================

\echo ''
\echo 'Linking cats at FFSC office addresses...'
SELECT trapper.link_ffsc_office_cats() AS ffsc_cats_linked;

-- ============================================================
-- 15. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Cat data source distribution:'
SELECT
    COALESCE(data_source::TEXT, 'NULL') as source,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM trapper.sot_cats
GROUP BY data_source
ORDER BY count DESC;

\echo ''
\echo 'Internal accounts by department:'
SELECT
    o.display_name as department,
    COUNT(*) as accounts
FROM trapper.person_organization_link pol
JOIN trapper.organizations o ON o.org_id = pol.org_id
WHERE pol.link_type = 'internal_account'
GROUP BY o.display_name
ORDER BY accounts DESC;

\echo ''
\echo 'Cats with unknown origin (FFSC office):'
SELECT COUNT(*) as ffsc_office_cats
FROM trapper.cat_place_relationships
WHERE origin_unknown = TRUE;

\echo ''
\echo 'FFSC office addresses configured:'
SELECT street_address, description FROM trapper.ffsc_office_addresses WHERE is_active = TRUE;

SELECT 'MIG_172 Complete' AS status;
