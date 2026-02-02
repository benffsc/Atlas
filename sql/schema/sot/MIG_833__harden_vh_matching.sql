-- ============================================================================
-- MIG_833: Harden VH Matching — Prevent Wrong Person Matches
-- ============================================================================
-- Root causes fixed:
--   1. Email/phone on place-as-person records matched VH volunteers to orgs
--   2. Shared identifiers on wrong people caused cascading mismatches
--   3. No mechanism to lock manually-corrected matches
--   4. Soft blacklist was empty — known shared identifiers not registered
--
-- This migration:
--   A. Unmerges Ellen Johnson from Holiday Duncan (different people)
--   B. Adds match_locked column to prevent re-matching corrected volunteers
--   C. Populates soft blacklist with known shared identifiers
--   D. Hardens match_volunteerhub_volunteer() to filter org-named people
--      and respect match_locked + soft blacklist on email matches
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_833: Harden VH Matching'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Step 1: Unmerge Ellen Johnson from Holiday Duncan
-- ============================================================================

\echo 'Step 1: Unmerging Ellen Johnson from Holiday Duncan...'

-- 1a. Promote airtable Ellen Johnson to canonical (clear merge pointer)
UPDATE trapper.sot_people
SET merged_into_person_id = NULL,
    updated_at = NOW()
WHERE person_id = '609118b0-0771-4a6e-ad7a-b9dc249726cb'
  AND display_name = 'Ellen Johnson';

-- 1b. Redirect all other Ellen Johnson records to the new canonical
UPDATE trapper.sot_people
SET merged_into_person_id = '609118b0-0771-4a6e-ad7a-b9dc249726cb',
    updated_at = NOW()
WHERE display_name = 'Ellen Johnson'
  AND merged_into_person_id = 'ca6faf77-06cf-4422-a3eb-a0f341c17441'
  AND person_id != '609118b0-0771-4a6e-ad7a-b9dc249726cb';

-- 1c. Move email winelady87@hotmail.com from Holiday Duncan to Ellen Johnson
-- (It's Ellen's VH email; Holiday Duncan is a different person)
UPDATE trapper.person_identifiers
SET person_id = '609118b0-0771-4a6e-ad7a-b9dc249726cb'
WHERE person_id = 'ca6faf77-06cf-4422-a3eb-a0f341c17441'
  AND id_type = 'email'
  AND id_value_norm = 'winelady87@hotmail.com';

-- 1d. Update VH match for Ellen Johnson to point to correct person
UPDATE trapper.volunteerhub_volunteers
SET matched_person_id = '609118b0-0771-4a6e-ad7a-b9dc249726cb',
    match_method = 'manual_correction',
    matched_at = NOW(),
    match_confidence = 1.0
WHERE volunteerhub_id = 'e7bc3e4a-3626-4231-b4a8-0750af85656a'
  AND display_name = 'Ellen Johnson';

-- 1e. Deactivate any leftover VH roles on Holiday Duncan
UPDATE trapper.person_roles
SET role_status = 'inactive',
    ended_at = CURRENT_DATE,
    notes = COALESCE(notes || '; ', '') || 'MIG_833: Ellen Johnson unmerged — these were from Ellen VH match',
    updated_at = NOW()
WHERE person_id = 'ca6faf77-06cf-4422-a3eb-a0f341c17441'
  AND source_system = 'volunteerhub'
  AND role_status = 'active';

-- 1f. Log unmerge to entity_edits
INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, reason, edit_source, edited_by)
VALUES
  ('person', '609118b0-0771-4a6e-ad7a-b9dc249726cb', 'restore', 'merged_into_person_id',
   to_jsonb('ca6faf77-06cf-4422-a3eb-a0f341c17441'::text), to_jsonb(NULL::text),
   'MIG_833: Unmerged Ellen Johnson from Holiday Duncan — different people sharing email winelady87@hotmail.com',
   'system', 'mig_833');

\echo 'Ellen Johnson unmerged. Running VH role processing...'

-- 1g. Run role processing for Ellen Johnson
SELECT trapper.process_volunteerhub_group_roles(
  '609118b0-0771-4a6e-ad7a-b9dc249726cb',
  'e7bc3e4a-3626-4231-b4a8-0750af85656a'
);

\echo ''
\echo 'Ellen Johnson roles after processing:'
SELECT role, trapper_type, role_status, source_system
FROM trapper.person_roles
WHERE person_id = '609118b0-0771-4a6e-ad7a-b9dc249726cb'
ORDER BY role;

-- ============================================================================
-- Step 2: Add match_locked column to volunteerhub_volunteers
-- ============================================================================

\echo ''
\echo 'Step 2: Adding match_locked column...'

ALTER TABLE trapper.volunteerhub_volunteers
  ADD COLUMN IF NOT EXISTS match_locked BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.volunteerhub_volunteers.match_locked IS
'When TRUE, match_volunteerhub_volunteer() will NOT re-match this volunteer.
Set after manual corrections to prevent the matcher from overwriting fixes.
Created by MIG_833.';

-- ============================================================================
-- Step 3: Lock the 5 manually-corrected VH matches
-- ============================================================================

\echo ''
\echo 'Step 3: Locking manually-corrected VH matches...'

UPDATE trapper.volunteerhub_volunteers
SET match_locked = TRUE
WHERE volunteerhub_id IN (
  '1f750396-ee3f-4aa7-a567-f34bdca33d12',  -- Carl Draper
  '27ecf8a6-edb0-4d9a-97b3-83183142c3bc',  -- Kate Vasey
  '9b9cc35b-0ffe-4e7d-bb9f-91c20fb04f0a',  -- Michelle Gleed
  'b67ff125-9e62-4e71-a144-873d6bbe68ba',   -- Alana Lavery
  'e7bc3e4a-3626-4231-b4a8-0750af85656a'    -- Ellen Johnson
);

\echo 'Locked matches:'
SELECT display_name, match_locked, match_method, match_confidence
FROM trapper.volunteerhub_volunteers
WHERE match_locked = TRUE
ORDER BY display_name;

-- ============================================================================
-- Step 4: Populate soft blacklist with known shared identifiers
-- ============================================================================

\echo ''
\echo 'Step 4: Populating soft blacklist...'

INSERT INTO trapper.data_engine_soft_blacklist
  (identifier_type, identifier_norm, distinct_name_count, sample_names, reason)
VALUES
  ('email', 'winelady87@hotmail.com', 2,
   ARRAY['Ellen Johnson', 'Holiday Duncan'],
   'MIG_833: Shared by Ellen Johnson (VH trapper) and Holiday Duncan (clinic client). Different people.'),
  ('phone', '7072927680', 2,
   ARRAY['Carl Draper', 'Patricia Elder'],
   'MIG_833: Shared by Carl Draper (VH trapper) and Patricia Elder (clinic client). Different people.'),
  ('email', 'mgpurple@aol.com', 2,
   ARRAY['Michelle Gleed', 'Ernie Lockner'],
   'MIG_833: Was wrongly assigned to Ernie Lockner. Now on Michelle Gleed. Blacklisted to prevent re-collision.'),
  ('email', 'riverrat@comcast.net', 2,
   ARRAY['Kate Vasey', 'Miwok Court Santa Rosa'],
   'MIG_833: Was on place-as-person Miwok Court. Now on Kate Vasey. Blacklisted to prevent re-collision.')
ON CONFLICT (identifier_type, identifier_norm) DO UPDATE SET
  reason = EXCLUDED.reason,
  distinct_name_count = EXCLUDED.distinct_name_count,
  sample_names = EXCLUDED.sample_names;

\echo 'Soft blacklist entries:'
SELECT identifier_type, identifier_norm, reason
FROM trapper.data_engine_soft_blacklist
ORDER BY identifier_type, identifier_norm;

-- ============================================================================
-- Step 5: Harden match_volunteerhub_volunteer()
-- ============================================================================

\echo ''
\echo 'Step 5: Hardening match_volunteerhub_volunteer()...'

CREATE OR REPLACE FUNCTION trapper.match_volunteerhub_volunteer(p_volunteerhub_id TEXT)
RETURNS UUID AS $$
DECLARE
    v_vol RECORD;
    v_result RECORD;
    v_person_id UUID;
    v_confidence NUMERIC;
    v_method TEXT;
    v_address TEXT;
    v_is_blacklisted BOOLEAN;
BEGIN
    -- Get the volunteer record
    SELECT * INTO v_vol
    FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- *** GUARD: Respect match_locked ***
    -- Manually-corrected matches must NOT be overwritten by automated matching
    IF v_vol.match_locked = TRUE AND v_vol.matched_person_id IS NOT NULL THEN
        RAISE NOTICE 'Volunteer % match is locked — skipping', p_volunteerhub_id;
        RETURN v_vol.matched_person_id;
    END IF;

    -- Strategy 1: Exact email match (highest confidence)
    -- HARDENED: Skip org-named people and check soft blacklist
    IF v_vol.email_norm IS NOT NULL THEN
        -- Check soft blacklist for this email
        SELECT EXISTS (
            SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
            WHERE sbl.identifier_type = 'email'
              AND sbl.identifier_norm = v_vol.email_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = v_vol.email_norm
              AND sp.merged_into_person_id IS NULL
              -- GUARD: Never match to org-named records (place-as-person)
              AND NOT trapper.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 1.0;
                v_method := 'email';
            END IF;
        ELSE
            -- Blacklisted email: fall through to require more evidence
            RAISE NOTICE 'Email % is soft-blacklisted for volunteer %', v_vol.email_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 2: Phone match
    -- HARDENED: Skip org-named people, check soft blacklist
    IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
        SELECT EXISTS (
            SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
            WHERE sbl.identifier_type = 'phone'
              AND sbl.identifier_norm = v_vol.phone_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_vol.phone_norm
              AND sp.merged_into_person_id IS NULL
              -- GUARD: Never match to org-named records (place-as-person)
              AND NOT trapper.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 0.9;
                v_method := 'phone';
            END IF;
        ELSE
            RAISE NOTICE 'Phone % is soft-blacklisted for volunteer %', v_vol.phone_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 3: Data Engine (fuzzy matching / new person creation)
    IF v_person_id IS NULL AND (v_vol.email_norm IS NOT NULL OR (v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10)) THEN
        SELECT * INTO v_result FROM trapper.data_engine_resolve_identity(
            p_email := v_vol.email,
            p_phone := v_vol.phone,
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_vol.full_address,
            p_source_system := 'volunteerhub',
            p_staged_record_id := NULL,
            p_job_id := NULL
        );

        IF v_result.person_id IS NOT NULL THEN
            -- GUARD: Verify Data Engine didn't match to an org-named person
            IF NOT trapper.is_organization_name(
                (SELECT display_name FROM trapper.sot_people WHERE person_id = v_result.person_id)
            ) THEN
                v_person_id := v_result.person_id;
                v_confidence := v_result.confidence_score;
                v_method := 'data_engine/' || COALESCE(v_result.decision_type, 'unknown');
            ELSE
                RAISE NOTICE 'Data Engine matched to org-named person for volunteer % — skipping', p_volunteerhub_id;
            END IF;
        END IF;
    END IF;

    -- Strategy 4: Staff name match
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM trapper.sot_people sp
        WHERE sp.is_system_account = TRUE
          AND sp.merged_into_person_id IS NULL
          AND LOWER(sp.display_name) = LOWER(TRIM(v_vol.first_name || ' ' || v_vol.last_name))
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.85;
            v_method := 'staff_name_match';
        END IF;
    END IF;

    -- Strategy 5: Skeleton creation
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        v_address := CONCAT_WS(', ',
            NULLIF(TRIM(COALESCE(v_vol.address, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.city, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.state, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.zip, '')), '')
        );

        v_person_id := trapper.create_skeleton_person(
            p_first_name := v_vol.first_name,
            p_last_name := v_vol.last_name,
            p_address := v_address,
            p_source_system := 'volunteerhub',
            p_source_record_id := p_volunteerhub_id,
            p_notes := 'VH volunteer with no email/phone — skeleton until contact info acquired'
        );

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.0;
            v_method := 'skeleton_creation';
        END IF;
    END IF;

    -- Update the volunteer record with match result
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role as PENDING
        INSERT INTO trapper.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'pending', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            role_status = CASE
                WHEN person_roles.role_status = 'active' THEN 'active'
                ELSE 'pending'
            END,
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE trapper.volunteerhub_volunteers
        SET sync_status = 'unmatched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_volunteerhub_volunteer IS
'Matches a VolunteerHub volunteer to an Atlas person via email/phone/Data Engine.
Hardened by MIG_833:
  - Respects match_locked (never overwrites manual corrections)
  - Checks soft blacklist on email AND phone matches
  - Filters out org-named people (place-as-person records)
  - Verifies Data Engine results against org-name check
Created by MIG_350, updated by MIG_468, hardened by MIG_833.';

-- ============================================================================
-- Step 6: Run enforce_vh_role_authority() cleanup
-- ============================================================================

\echo ''
\echo 'Step 6: Running enforce_vh_role_authority()...'

SELECT * FROM trapper.enforce_vh_role_authority(p_dry_run := true);

-- ============================================================================
-- Step 7: Verification
-- ============================================================================

\echo ''
\echo 'Step 7: Verification...'

\echo ''
\echo 'Corrected VH matches (should all match names):'
SELECT vv.display_name AS vh_name, sp.display_name AS atlas_name,
       vv.match_locked, vv.match_method, vv.match_confidence
FROM trapper.volunteerhub_volunteers vv
JOIN trapper.sot_people sp ON sp.person_id = vv.matched_person_id
WHERE vv.display_name IN ('Carl Draper', 'Kate Vasey', 'Michelle Gleed', 'Alana Lavery', 'Ellen Johnson')
ORDER BY vv.display_name;

\echo ''
\echo 'Roles on corrected people:'
SELECT sp.display_name, pr.role, pr.trapper_type, pr.role_status, pr.source_system
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.person_id IN (
  '107989e2-f8c0-4f3b-8bab-0475f178df98',
  'cd7a8d5d-e8b7-4f03-a7e7-f7ffefd3c13a',
  'a574f2cf-593a-404b-b6ab-7106d3aa3746',
  '30f293a2-8b27-4b2c-b486-fdb3697c1b3a',
  '609118b0-0771-4a6e-ad7a-b9dc249726cb'
)
AND pr.role_status = 'active'
ORDER BY sp.display_name, pr.role;

\echo ''
\echo 'Wrong people should have NO active VH roles:'
SELECT sp.display_name, pr.role, pr.role_status, pr.source_system
FROM trapper.person_roles pr
JOIN trapper.sot_people sp ON sp.person_id = pr.person_id
WHERE pr.person_id IN (
  'a488e402-c841-4804-ac92-ea2987e23057',
  '16dba7a5-3e9d-4853-b330-8101588d8dd8',
  '6c9bc5ae-191a-467a-9f71-ea61b3812948',
  'ca6faf77-06cf-4422-a3eb-a0f341c17441'
)
AND pr.role_status = 'active'
ORDER BY sp.display_name;

\echo ''
\echo 'Soft blacklist entries:'
SELECT identifier_type, identifier_norm, reason
FROM trapper.data_engine_soft_blacklist
ORDER BY identifier_type, identifier_norm;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_833 SUMMARY'
\echo '============================================================'
\echo ''
\echo 'UNMERGED: Ellen Johnson from Holiday Duncan'
\echo '  - New canonical: 609118b0 (airtable Ellen Johnson)'
\echo '  - Email winelady87@hotmail.com moved to Ellen Johnson'
\echo '  - VH match updated + locked'
\echo ''
\echo 'ADDED: match_locked column on volunteerhub_volunteers'
\echo '  - 5 manually-corrected matches locked'
\echo ''
\echo 'POPULATED: data_engine_soft_blacklist'
\echo '  - winelady87@hotmail.com (Ellen Johnson / Holiday Duncan)'
\echo '  - 7072927680 (Carl Draper / Patricia Elder)'
\echo '  - mgpurple@aol.com (Michelle Gleed / Ernie Lockner)'
\echo '  - riverrat@comcast.net (Kate Vasey / Miwok Court)'
\echo ''
\echo 'HARDENED: match_volunteerhub_volunteer()'
\echo '  - Respects match_locked (never overwrites manual fixes)'
\echo '  - Checks soft blacklist on BOTH email and phone'
\echo '  - Filters out org-named people (place-as-person records)'
\echo '  - Validates Data Engine matches against org-name check'
\echo ''
\echo '=== MIG_833 Complete ==='
