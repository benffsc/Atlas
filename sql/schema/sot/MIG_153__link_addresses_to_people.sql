-- MIG_153__link_addresses_to_people.sql
-- Link address observations to people
--
-- Problem:
--   Address signals are extracted from appointments but not linked to people.
--   Aaron Shreve has address "7530 Monet Pl, Rohnert Park, CA 94928" in observations
--   but no primary_address_id on his person record.
--
-- Solution:
--   For people without a primary_address, find their most recent address observation
--   and create/link an address.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_153__link_addresses_to_people.sql

\echo ''
\echo 'MIG_153: Link Addresses to People'
\echo '============================================'

-- ============================================================
-- 1. Function to link an address to a person from observations
-- ============================================================

\echo ''
\echo 'Creating link_person_address_from_observations function...'

CREATE OR REPLACE FUNCTION trapper.link_person_address_from_observations(
    p_person_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_address_text TEXT;
    v_address_id UUID;
    v_staged_record_id UUID;
BEGIN
    -- Skip if person already has address
    IF EXISTS (SELECT 1 FROM trapper.sot_people WHERE person_id = p_person_id AND primary_address_id IS NOT NULL) THEN
        RETURN NULL;
    END IF;

    -- Find the most recent address observation for this person
    SELECT o.value_text, o.staged_record_id
    INTO v_address_text, v_staged_record_id
    FROM trapper.observations o
    JOIN trapper.staged_record_person_link srpl ON srpl.staged_record_id = o.staged_record_id
    WHERE srpl.person_id = p_person_id
      AND o.observation_type = 'address_signal'
      AND o.value_text IS NOT NULL
      AND TRIM(o.value_text) <> ''
    ORDER BY o.created_at DESC
    LIMIT 1;

    IF v_address_text IS NULL THEN
        RETURN NULL;
    END IF;

    -- Check if this address already exists
    SELECT address_id INTO v_address_id
    FROM trapper.sot_addresses
    WHERE raw_input = v_address_text;

    -- If not, create it
    IF v_address_id IS NULL THEN
        INSERT INTO trapper.sot_addresses (
            raw_input,
            formatted_address,
            geocode_status,
            data_source
        ) VALUES (
            v_address_text,
            v_address_text,  -- Use raw as formatted until geocoded
            'pending',
            'clinichq'
        )
        RETURNING address_id INTO v_address_id;
    END IF;

    -- Link to person
    UPDATE trapper.sot_people
    SET primary_address_id = v_address_id
    WHERE person_id = p_person_id;

    RETURN v_address_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_person_address_from_observations IS
'Links a person to their most recent address observation. Skips if already has address.';

-- ============================================================
-- 2. Backfill addresses for existing people
-- ============================================================

\echo ''
\echo 'Backfilling addresses for people with address observations...'

WITH people_with_address_obs AS (
    SELECT DISTINCT srpl.person_id
    FROM trapper.observations o
    JOIN trapper.staged_record_person_link srpl ON srpl.staged_record_id = o.staged_record_id
    JOIN trapper.sot_people p ON p.person_id = srpl.person_id
    WHERE o.observation_type = 'address_signal'
      AND o.value_text IS NOT NULL
      AND TRIM(o.value_text) <> ''
      AND p.primary_address_id IS NULL
),
linked AS (
    SELECT
        person_id,
        trapper.link_person_address_from_observations(person_id) as address_id
    FROM people_with_address_obs
)
SELECT
    COUNT(*) as people_checked,
    COUNT(address_id) as addresses_linked
FROM linked;

-- ============================================================
-- 3. Verify Aaron Shreve
-- ============================================================

\echo ''
\echo 'Checking Aaron Shreve...';

SELECT
    p.person_id,
    p.display_name,
    p.primary_address_id,
    a.formatted_address
FROM trapper.sot_people p
LEFT JOIN trapper.sot_addresses a ON a.address_id = p.primary_address_id
WHERE p.display_name ILIKE '%Aaron Shreve%';

SELECT 'MIG_153 Complete' AS status;
