-- MIG_157__clean_identity_linking.sql
-- Clean rebuild of person identity linking with exclusions
--
-- Problem:
--   1. Shared phones (FFSC main line, Animal Services) create mega-persons
--   2. Non-person names (locations, programs, placeholders) become person profiles
--   3. This erodes trust in the data
--
-- Solution:
--   1. Create exclusion rules for phones and name patterns
--   2. Backup current person data for rescue if needed
--   3. Rebuild person profiles with clean rules
--   4. Log all decisions for auditability
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_157__clean_identity_linking.sql

\echo ''
\echo 'MIG_157: Clean Identity Linking Rebuild'
\echo '========================================'
\echo 'This migration will rebuild person profiles with cleaner linking rules.'
\echo ''

-- ============================================================
-- 1. Create exclusion rules tables (if not exist)
-- ============================================================

\echo 'Creating identity exclusion rules tables...'

CREATE TABLE IF NOT EXISTS trapper.identity_phone_blacklist (
    phone_norm TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    distinct_client_count INT,
    sample_clients TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS trapper.identity_name_exclusions (
    pattern_id SERIAL PRIMARY KEY,
    pattern_type TEXT NOT NULL,
    pattern_value TEXT NOT NULL,
    field TEXT NOT NULL DEFAULT 'both',
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'system',
    UNIQUE(pattern_type, pattern_value, field)
);

-- ============================================================
-- 2. Populate phone blacklist (if empty)
-- ============================================================

\echo 'Populating phone blacklist...'

INSERT INTO trapper.identity_phone_blacklist (phone_norm, reason, distinct_client_count, sample_clients)
SELECT
    phone,
    'Shared phone used by ' || client_count || ' distinct client names',
    client_count,
    sample_clients
FROM (
    SELECT
        COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone') as phone,
        COUNT(DISTINCT (payload->>'Owner First Name') || ' ' || (payload->>'Owner Last Name')) as client_count,
        (ARRAY_AGG(DISTINCT (payload->>'Owner First Name') || ' ' || (payload->>'Owner Last Name')))[1:5] as sample_clients
    FROM trapper.staged_records
    WHERE source_table = 'owner_info'
      AND COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone') IS NOT NULL
      AND LENGTH(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone')) >= 10
    GROUP BY 1
    HAVING COUNT(DISTINCT (payload->>'Owner First Name') || ' ' || (payload->>'Owner Last Name')) >= 5
) sub
ON CONFLICT (phone_norm) DO NOTHING;

\echo 'Phone blacklist:'
SELECT phone_norm, distinct_client_count FROM trapper.identity_phone_blacklist ORDER BY distinct_client_count DESC;

-- ============================================================
-- 3. Populate name exclusion patterns (if empty)
-- ============================================================

\echo ''
\echo 'Populating name exclusion patterns...'

INSERT INTO trapper.identity_name_exclusions (pattern_type, pattern_value, field, reason) VALUES
('contains', 'ffsc', 'both', 'FFSC program account'),
('contains', 'forgotten felines', 'both', 'FFSC program account'),
('contains', 'barn cat', 'both', 'FFSC program'),
('contains', 'foster program', 'both', 'FFSC program'),
('contains', 'mobile home', 'both', 'Location name'),
('contains', ' mhp', 'both', 'Mobile home park'),
('contains', 'hotel', 'both', 'Location name'),
('contains', 'motel', 'both', 'Location name'),
('contains', 'restaurant', 'both', 'Location name'),
('contains', 'apartment', 'both', 'Location name'),
('contains', 'school', 'first', 'Location name'),
('contains', 'church', 'first', 'Location name'),
('contains', 'ranch', 'first', 'Location name'),
('contains', 'winery', 'both', 'Location name'),
('contains', 'vineyard', 'both', 'Location name'),
('regex', '^[0-9]+\s', 'first', 'Address used as name'),
('contains', 'placeholder', 'both', 'Placeholder record'),
('contains', 'rebooking', 'both', 'Rebooking placeholder'),
('equals', 'scas', 'first', 'Animal services code'),
('contains', 'duplicate report', 'both', 'Duplicate flag'),
('contains', 'animal services', 'both', 'Partner organization'),
('contains', 'humane society', 'both', 'Partner organization'),
('contains', 'spca', 'both', 'Partner organization')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Create helper functions
-- ============================================================

\echo ''
\echo 'Creating helper functions...'

CREATE OR REPLACE FUNCTION trapper.is_person_name(p_first_name TEXT, p_last_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_first TEXT := LOWER(COALESCE(p_first_name, ''));
    v_last TEXT := LOWER(COALESCE(p_last_name, ''));
    v_display TEXT := v_first || ' ' || v_last;
    v_pattern RECORD;
BEGIN
    IF v_first = '' AND v_last = '' THEN RETURN FALSE; END IF;
    IF v_first = v_last AND LENGTH(v_first) > 3 THEN RETURN FALSE; END IF;

    FOR v_pattern IN SELECT * FROM trapper.identity_name_exclusions
    LOOP
        IF v_pattern.pattern_type = 'contains' THEN
            IF v_pattern.field IN ('first', 'both') AND v_first LIKE '%' || LOWER(v_pattern.pattern_value) || '%' THEN RETURN FALSE; END IF;
            IF v_pattern.field IN ('last', 'both') AND v_last LIKE '%' || LOWER(v_pattern.pattern_value) || '%' THEN RETURN FALSE; END IF;
        ELSIF v_pattern.pattern_type = 'equals' THEN
            IF v_pattern.field = 'first' AND v_first = LOWER(v_pattern.pattern_value) THEN RETURN FALSE; END IF;
            IF v_pattern.field = 'last' AND v_last = LOWER(v_pattern.pattern_value) THEN RETURN FALSE; END IF;
        ELSIF v_pattern.pattern_type = 'regex' THEN
            IF v_pattern.field = 'first' AND v_first ~ v_pattern.pattern_value THEN RETURN FALSE; END IF;
            IF v_pattern.field = 'last' AND v_last ~ v_pattern.pattern_value THEN RETURN FALSE; END IF;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION trapper.is_phone_blacklisted(p_phone TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_phone IS NULL OR p_phone = '' THEN RETURN FALSE; END IF;
    RETURN EXISTS (SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = trapper.norm_phone_us(p_phone));
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 5. Backup current person data
-- ============================================================

\echo ''
\echo 'Backing up current person data...'

DROP TABLE IF EXISTS trapper.backup_sot_people_mig157;
CREATE TABLE trapper.backup_sot_people_mig157 AS SELECT * FROM trapper.sot_people;

DROP TABLE IF EXISTS trapper.backup_person_identifiers_mig157;
CREATE TABLE trapper.backup_person_identifiers_mig157 AS SELECT * FROM trapper.person_identifiers;

DROP TABLE IF EXISTS trapper.backup_person_cat_relationships_mig157;
CREATE TABLE trapper.backup_person_cat_relationships_mig157 AS SELECT * FROM trapper.person_cat_relationships;

\echo 'Backed up person data.'

-- ============================================================
-- 6. Clear ALL person-related tables
-- ============================================================

\echo ''
\echo 'Clearing person-related tables...'

-- Unlink foreign keys first
UPDATE trapper.sot_appointments SET person_id = NULL;
UPDATE trapper.sot_requests SET requester_person_id = NULL;
UPDATE trapper.sot_people SET primary_address_id = NULL, merged_into_person_id = NULL;

-- Delete from all referencing tables
DELETE FROM trapper.person_cat_relationships;
DELETE FROM trapper.person_place_relationships;
DELETE FROM trapper.person_relationships WHERE TRUE;
DELETE FROM trapper.person_person_edges WHERE TRUE;
DELETE FROM trapper.person_match_candidates WHERE TRUE;
DELETE FROM trapper.person_match_decisions WHERE TRUE;
DELETE FROM trapper.person_merges WHERE TRUE;
DELETE FROM trapper.person_aliases WHERE TRUE;
DELETE FROM trapper.staged_record_person_link WHERE TRUE;
DELETE FROM trapper.person_identifiers;
DELETE FROM trapper.sot_people;

\echo 'Person tables cleared.'

-- ============================================================
-- 7. Rebuild people with clean rules
-- ============================================================

\echo ''
\echo 'Rebuilding person profiles with clean rules...'

DO $$
DECLARE
    v_record RECORD;
    v_person_id UUID;
    v_first_name TEXT;
    v_last_name TEXT;
    v_email TEXT;
    v_phone TEXT;
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_created_count INT := 0;
    v_linked_count INT := 0;
    v_skipped_name INT := 0;
    v_skipped_phone INT := 0;
BEGIN
    FOR v_record IN
        SELECT
            source_row_id,
            payload->>'Owner First Name' as first_name,
            payload->>'Owner Last Name' as last_name,
            COALESCE(payload->>'Owner Email', payload->>'Email', payload->>'Clean Email') as email,
            COALESCE(payload->>'Owner Cell Phone', payload->>'Mobile', payload->>'Cell', payload->>'Phone') as phone,
            payload->>'Owner Address' as address
        FROM trapper.staged_records
        WHERE source_table = 'owner_info'
    LOOP
        v_first_name := TRIM(v_record.first_name);
        v_last_name := TRIM(v_record.last_name);
        v_email := TRIM(v_record.email);
        v_phone := TRIM(v_record.phone);

        -- Skip non-person names
        IF NOT trapper.is_person_name(v_first_name, v_last_name) THEN
            v_skipped_name := v_skipped_name + 1;
            CONTINUE;
        END IF;

        -- Build display name
        v_display_name := TRIM(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''));
        IF v_display_name = '' OR v_display_name = ' ' THEN
            CONTINUE;
        END IF;

        -- Normalize identifiers
        v_email_norm := trapper.norm_email(v_email);

        -- Check if phone is blacklisted BEFORE normalizing for lookup
        IF trapper.is_phone_blacklisted(v_phone) THEN
            v_phone_norm := NULL;
            v_skipped_phone := v_skipped_phone + 1;
        ELSE
            v_phone_norm := trapper.norm_phone_us(v_phone);
        END IF;

        -- Try to find existing person by email first
        v_person_id := NULL;
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            SELECT person_id INTO v_person_id
            FROM trapper.person_identifiers
            WHERE id_type = 'email' AND id_value_norm = v_email_norm
            LIMIT 1;
        END IF;

        -- Try phone if no email match
        IF v_person_id IS NULL AND v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            SELECT person_id INTO v_person_id
            FROM trapper.person_identifiers
            WHERE id_type = 'phone' AND id_value_norm = v_phone_norm
            LIMIT 1;
        END IF;

        -- Create new person if no match
        IF v_person_id IS NULL THEN
            INSERT INTO trapper.sot_people (display_name, data_source)
            VALUES (v_display_name, 'clinichq')
            RETURNING person_id INTO v_person_id;
            v_created_count := v_created_count + 1;
        ELSE
            v_linked_count := v_linked_count + 1;
        END IF;

        -- Add email identifier
        IF v_email_norm IS NOT NULL AND v_email_norm != '' THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table, source_row_id)
            VALUES (v_person_id, 'email', v_email_norm, v_email, 'clinichq', 'owner_info', v_record.source_row_id)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

        -- Add phone identifier (only if not blacklisted)
        IF v_phone_norm IS NOT NULL AND v_phone_norm != '' THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system, source_table, source_row_id)
            VALUES (v_person_id, 'phone', v_phone_norm, v_phone, 'clinichq', 'owner_info', v_record.source_row_id)
            ON CONFLICT (id_type, id_value_norm) DO NOTHING;
        END IF;

    END LOOP;

    RAISE NOTICE 'Person rebuild complete:';
    RAISE NOTICE '  Created: %', v_created_count;
    RAISE NOTICE '  Linked to existing: %', v_linked_count;
    RAISE NOTICE '  Skipped (non-person name): %', v_skipped_name;
    RAISE NOTICE '  Skipped phone linking (blacklisted): %', v_skipped_phone;
END $$;

-- ============================================================
-- 8. Rebuild cat-person relationships
-- ============================================================

\echo ''
\echo 'Rebuilding cat-person relationships...'

INSERT INTO trapper.person_cat_relationships (person_id, cat_id, relationship_type, source_system, source_table)
SELECT DISTINCT
    pi.person_id,
    c.cat_id,
    'owner',
    'clinichq',
    'owner_info'
FROM trapper.staged_records sr
JOIN trapper.person_identifiers pi ON pi.source_row_id = sr.source_row_id
JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
WHERE sr.source_table = 'owner_info'
  AND sr.payload->>'Microchip Number' IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 9. Rebuild appointment-person links
-- ============================================================

\echo ''
\echo 'Rebuilding appointment-person links...'

UPDATE trapper.sot_appointments a
SET person_id = sub.person_id
FROM (
    SELECT DISTINCT ON (sr.source_row_id)
        sr.source_row_id,
        pi.person_id
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON pi.source_row_id = sr.source_row_id
    WHERE sr.source_table = 'owner_info'
) sub
WHERE a.source_record_id = sub.source_row_id;

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Person count comparison:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people) as new_people,
    (SELECT COUNT(*) FROM trapper.backup_sot_people_mig157) as old_people,
    (SELECT COUNT(*) FROM trapper.backup_sot_people_mig157) - (SELECT COUNT(*) FROM trapper.sot_people) as reduced_by;

\echo ''
\echo 'Mega-persons check (anyone with >50 cats - should be empty or reasonable):'
SELECT p.display_name, COUNT(*) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
GROUP BY p.person_id, p.display_name
HAVING COUNT(*) > 50
ORDER BY cat_count DESC
LIMIT 10;

\echo ''
\echo 'Top 10 people by cat count (should look like real trappers/volunteers):'
SELECT p.display_name, COUNT(*) as cat_count
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
GROUP BY p.person_id, p.display_name
ORDER BY cat_count DESC
LIMIT 10;

\echo ''
\echo 'Appointment linking stats:'
SELECT
    COUNT(*) FILTER (WHERE person_id IS NOT NULL) as linked,
    COUNT(*) FILTER (WHERE person_id IS NULL) as unlinked,
    COUNT(*) as total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE person_id IS NOT NULL) / COUNT(*), 1) as pct_linked
FROM trapper.sot_appointments;

\echo ''
\echo 'Cat-person relationships:'
SELECT COUNT(*) as total_relationships FROM trapper.person_cat_relationships;

\echo ''
\echo 'Sample of people created:'
SELECT display_name FROM trapper.sot_people ORDER BY created_at DESC LIMIT 10;

SELECT 'MIG_157 Complete' AS status;
