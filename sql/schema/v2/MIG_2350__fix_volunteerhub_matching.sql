-- MIG_2350: Fix VolunteerHub Matching Function
--
-- AUDIT FINDINGS:
-- ✅ sot.data_engine_score_candidates - Fellegi-Sunter scoring, works correctly
-- ✅ sot.data_engine_resolve_identity - 6-param signature, works correctly
-- ❌ sot.match_volunteerhub_volunteer - BUG: calls data_engine with wrong params
--    - Passes p_staged_record_id and p_job_id (don't exist)
--    - Uses v_result.person_id instead of v_result.resolved_person_id
--    - Uses v_result.confidence_score instead of v_result.confidence
--
-- ✅ source.volunteerhub_volunteers - Has all matching columns already
-- ✅ source.volunteerhub_group_memberships - Has temporal columns (joined_at, left_at)
-- ✅ quarantine.failed_records - DLQ exists (may add retry columns later)
-- ✅ sot.cat_intake_events - Schema exists (empty, needs population)
-- ✅ beacon.colony_estimates - Schema exists (empty, needs Chapman columns)

-- Fix the match_volunteerhub_volunteer function
CREATE OR REPLACE FUNCTION sot.match_volunteerhub_volunteer(p_volunteerhub_id text)
RETURNS uuid
LANGUAGE plpgsql AS $$
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
    FROM source.volunteerhub_volunteers
    WHERE volunteerhub_id = p_volunteerhub_id;

    IF v_vol IS NULL THEN
        RETURN NULL;
    END IF;

    -- GUARD: Respect match_locked
    IF v_vol.match_locked = TRUE AND v_vol.matched_person_id IS NOT NULL THEN
        RAISE NOTICE 'Volunteer % match is locked — skipping', p_volunteerhub_id;
        RETURN v_vol.matched_person_id;
    END IF;

    -- Strategy 1: Exact email match
    IF v_vol.email_norm IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM sot.soft_blacklist sbl
            WHERE sbl.identifier_type = 'email'
              AND sbl.identifier_norm = v_vol.email_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM sot.person_identifiers pi
            JOIN sot.people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = v_vol.email_norm
              AND sp.merged_into_person_id IS NULL
              AND NOT sot.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 1.0;
                v_method := 'email';
            END IF;
        ELSE
            RAISE NOTICE 'Email % is soft-blacklisted for volunteer %', v_vol.email_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 2: Phone match
    IF v_person_id IS NULL AND v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10 THEN
        SELECT EXISTS (
            SELECT 1 FROM sot.soft_blacklist sbl
            WHERE sbl.identifier_type = 'phone'
              AND sbl.identifier_norm = v_vol.phone_norm
        ) INTO v_is_blacklisted;

        IF NOT v_is_blacklisted THEN
            SELECT sp.person_id INTO v_person_id
            FROM sot.person_identifiers pi
            JOIN sot.people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = v_vol.phone_norm
              AND sp.merged_into_person_id IS NULL
              AND NOT sot.is_organization_name(sp.display_name)
            LIMIT 1;

            IF v_person_id IS NOT NULL THEN
                v_confidence := 0.9;
                v_method := 'phone';
            END IF;
        ELSE
            RAISE NOTICE 'Phone % is soft-blacklisted for volunteer %', v_vol.phone_norm, p_volunteerhub_id;
        END IF;
    END IF;

    -- Strategy 3: Data Engine (FIXED: correct 6-param signature + correct result columns)
    IF v_person_id IS NULL AND (v_vol.email_norm IS NOT NULL OR (v_vol.phone_norm IS NOT NULL AND LENGTH(v_vol.phone_norm) = 10)) THEN
        SELECT * INTO v_result FROM sot.data_engine_resolve_identity(
            v_vol.email,            -- p_email
            v_vol.phone,            -- p_phone
            v_vol.first_name,       -- p_first_name
            v_vol.last_name,        -- p_last_name
            v_vol.full_address,     -- p_address
            'volunteerhub'::text    -- p_source_system
        );

        -- FIXED: Use correct column names from data_engine_resolve_identity return type
        IF v_result.resolved_person_id IS NOT NULL THEN
            IF NOT sot.is_organization_name(
                (SELECT display_name FROM sot.people WHERE person_id = v_result.resolved_person_id)
            ) THEN
                v_person_id := v_result.resolved_person_id;
                v_confidence := v_result.confidence;
                v_method := 'data_engine/' || COALESCE(v_result.decision_type, 'unknown');
            ELSE
                RAISE NOTICE 'Data Engine matched to org-named person for volunteer % — skipping', p_volunteerhub_id;
            END IF;
        END IF;
    END IF;

    -- Strategy 4: Staff name match
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        SELECT sp.person_id INTO v_person_id
        FROM sot.people sp
        WHERE sp.is_system_account = TRUE
          AND sp.merged_into_person_id IS NULL
          AND LOWER(sp.display_name) = LOWER(TRIM(v_vol.first_name || ' ' || v_vol.last_name))
        LIMIT 1;

        IF v_person_id IS NOT NULL THEN
            v_confidence := 0.85;
            v_method := 'staff_name_match';
        END IF;
    END IF;

    -- Strategy 5: Skeleton creation (for volunteers with name but no identifiers)
    IF v_person_id IS NULL AND v_vol.first_name IS NOT NULL AND v_vol.last_name IS NOT NULL THEN
        v_address := CONCAT_WS(', ',
            NULLIF(TRIM(COALESCE(v_vol.address, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.city, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.state, '')), ''),
            NULLIF(TRIM(COALESCE(v_vol.zip, '')), '')
        );

        v_person_id := sot.create_skeleton_person(
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

    -- Update the volunteer record
    IF v_person_id IS NOT NULL THEN
        UPDATE source.volunteerhub_volunteers
        SET matched_person_id = v_person_id,
            matched_at = NOW(),
            match_confidence = v_confidence,
            match_method = v_method,
            sync_status = 'matched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;

        -- Add volunteer role as PENDING
        INSERT INTO sot.person_roles (person_id, role, role_status, source_system, source_record_id, started_at)
        VALUES (v_person_id, 'volunteer', 'pending', 'volunteerhub', p_volunteerhub_id, CURRENT_DATE)
        ON CONFLICT (person_id, role) DO UPDATE SET
            role_status = CASE
                WHEN sot.person_roles.role_status = 'active' THEN 'active'
                ELSE 'pending'
            END,
            updated_at = NOW();

        RAISE NOTICE 'Matched volunteer % to person % via % (confidence: %)',
            p_volunteerhub_id, v_person_id, v_method, v_confidence;
    ELSE
        UPDATE source.volunteerhub_volunteers
        SET sync_status = 'unmatched',
            synced_at = NOW()
        WHERE volunteerhub_id = p_volunteerhub_id;
    END IF;

    RETURN v_person_id;
END;
$$;

COMMENT ON FUNCTION sot.match_volunteerhub_volunteer IS
'Match a VolunteerHub volunteer to sot.people using multiple strategies:
1. Exact email match (highest confidence)
2. Exact phone match (high confidence)
3. Data Engine probabilistic matching (medium confidence)
4. Staff name match (for system accounts)
5. Skeleton creation (lowest confidence, for volunteers with no identifiers)

FIXED in MIG_2350: Corrected data_engine_resolve_identity call signature and result column names.';

-- ========================================
-- Now run matching for all unmatched volunteers
-- ========================================

DO $$
DECLARE
    v_count INT := 0;
    v_matched INT := 0;
    v_record RECORD;
    v_result UUID;
BEGIN
    RAISE NOTICE 'Starting volunteer matching...';

    FOR v_record IN
        SELECT volunteerhub_id, email, phone, first_name, last_name
        FROM source.volunteerhub_volunteers
        WHERE matched_person_id IS NULL
          OR sync_status IN ('unmatched', 'pending')
        ORDER BY
            CASE WHEN email IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN phone IS NOT NULL THEN 0 ELSE 1 END,
            joined_at DESC NULLS LAST
    LOOP
        v_count := v_count + 1;

        BEGIN
            v_result := sot.match_volunteerhub_volunteer(v_record.volunteerhub_id);
            IF v_result IS NOT NULL THEN
                v_matched := v_matched + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Error matching volunteer %: %', v_record.volunteerhub_id, SQLERRM;
        END;

        -- Progress log every 100
        IF v_count % 100 = 0 THEN
            RAISE NOTICE 'Processed % volunteers, % matched so far', v_count, v_matched;
        END IF;
    END LOOP;

    RAISE NOTICE '=== COMPLETE: Processed % volunteers, % matched ===', v_count, v_matched;
END $$;

-- ========================================
-- Verify results
-- ========================================

SELECT
    sync_status,
    CASE WHEN matched_person_id IS NOT NULL THEN 'has_match' ELSE 'no_match' END as match_status,
    COUNT(*) as count
FROM source.volunteerhub_volunteers
GROUP BY 1, 2
ORDER BY 1, 2;

-- Show matching methods used
SELECT
    match_method,
    COUNT(*) as count,
    ROUND(AVG(match_confidence)::numeric, 2) as avg_confidence
FROM source.volunteerhub_volunteers
WHERE matched_person_id IS NOT NULL
GROUP BY match_method
ORDER BY count DESC;
