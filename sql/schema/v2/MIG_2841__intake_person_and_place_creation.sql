-- MIG_2841: Create intake person + place creation functions (v2)
--
-- These functions were defined in v1 (MIG_273, MIG_252) but never migrated to v2.
-- Both intake routes (staff + public) call them after submission, but the calls
-- fail silently because the functions don't exist in v2.
--
-- This means:
--   - Intake requesters never get sot.people records created
--   - matched_person_id is always NULL (unless pre-selected via existing_person_id)
--   - place_id is only set when staff pre-selects an address
--
-- Instead of porting v1 code directly, we use the modern centralized functions:
--   - sot.find_or_create_person() (delegates to data_engine_resolve_identity)
--   - trapper.find_or_create_place_deduped() (standard place creation with dedup)
--
-- Fixes: FFS-229

BEGIN;

-- ============================================================================
-- sot.match_intake_to_person(p_submission_id UUID) RETURNS UUID
-- ============================================================================
-- Matches or creates a person record from an intake submission.
-- Uses the Data Engine (find_or_create_person) which handles:
--   - should_be_person() gate (rejects orgs/garbage names)
--   - Soft blacklist filtering
--   - Fellegi-Sunter confidence scoring
--   - Existing person matching by email/phone
--
-- Returns: person_id (matched or created), or NULL if no identifiers or rejected
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.match_intake_to_person(p_submission_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_sub RECORD;
    v_person_id UUID;
BEGIN
    -- 1. Fetch submission data
    SELECT first_name, last_name, email, phone, cats_address, matched_person_id
    INTO v_sub
    FROM ops.intake_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND THEN
        RAISE WARNING 'match_intake_to_person: submission % not found', p_submission_id;
        RETURN NULL;
    END IF;

    -- 2. Already matched (e.g., staff pre-selected existing_person_id)
    IF v_sub.matched_person_id IS NOT NULL THEN
        RETURN v_sub.matched_person_id;
    END IF;

    -- 3. No identifiers — can't create or match a person
    IF v_sub.email IS NULL AND v_sub.phone IS NULL THEN
        RETURN NULL;
    END IF;

    -- 4. Delegate to centralized person creation/matching
    --    This handles should_be_person(), soft blacklist, identity resolution
    v_person_id := sot.find_or_create_person(
        p_email         := v_sub.email,
        p_phone         := v_sub.phone,
        p_first_name    := v_sub.first_name,
        p_last_name     := v_sub.last_name,
        p_address       := v_sub.cats_address,
        p_source_system := 'web_intake'
    );

    -- 5. Update submission if person was created/matched
    IF v_person_id IS NOT NULL THEN
        UPDATE ops.intake_submissions
        SET matched_person_id = v_person_id,
            updated_at = NOW()
        WHERE submission_id = p_submission_id;
    END IF;

    RETURN v_person_id;
END;
$$;

COMMENT ON FUNCTION sot.match_intake_to_person(UUID) IS
    'Match or create a person from an intake submission using the Data Engine. Returns person_id or NULL.';


-- ============================================================================
-- sot.link_intake_to_place(p_submission_id UUID) RETURNS UUID
-- ============================================================================
-- Links an intake submission to a place record (cats' location).
-- Uses trapper.find_or_create_place_deduped() for address dedup.
--
-- Returns: place_id (found or created), or NULL if no address
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.link_intake_to_place(p_submission_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_sub RECORD;
    v_place_id UUID;
    v_full_address TEXT;
BEGIN
    -- 1. Fetch submission data
    SELECT cats_address, cats_city, cats_zip, geo_latitude, geo_longitude,
           place_id, selected_address_place_id
    INTO v_sub
    FROM ops.intake_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND THEN
        RAISE WARNING 'link_intake_to_place: submission % not found', p_submission_id;
        RETURN NULL;
    END IF;

    -- 2. Already linked (place_id or selected_address_place_id)
    IF v_sub.place_id IS NOT NULL THEN
        RETURN v_sub.place_id;
    END IF;

    IF v_sub.selected_address_place_id IS NOT NULL THEN
        RETURN v_sub.selected_address_place_id;
    END IF;

    -- 3. No address — can't create a place
    IF v_sub.cats_address IS NULL OR TRIM(v_sub.cats_address) = '' THEN
        RETURN NULL;
    END IF;

    -- 4. Build full address string
    v_full_address := v_sub.cats_address;
    IF v_sub.cats_city IS NOT NULL AND TRIM(v_sub.cats_city) != '' THEN
        v_full_address := v_full_address || ', ' || v_sub.cats_city;
    END IF;

    -- 5. Find or create place with dedup
    v_place_id := sot.find_or_create_place_deduped(
        p_formatted_address := v_full_address,
        p_display_name      := NULL,
        p_lat               := v_sub.geo_latitude,
        p_lng               := v_sub.geo_longitude,
        p_source_system     := 'web_intake'
    );

    -- 6. Update submission with place_id
    IF v_place_id IS NOT NULL THEN
        UPDATE ops.intake_submissions
        SET place_id = v_place_id,
            updated_at = NOW()
        WHERE submission_id = p_submission_id;
    END IF;

    RETURN v_place_id;
END;
$$;

COMMENT ON FUNCTION sot.link_intake_to_place(UUID) IS
    'Link an intake submission to a place record (cats location). Creates place if needed via dedup. Returns place_id or NULL.';


-- ============================================================================
-- Backfill: Match persons for existing submissions
-- ============================================================================
-- Safe because find_or_create_person is idempotent (finds existing matches first)

DO $$
DECLARE
    v_matched INT := 0;
    v_total INT := 0;
    v_result UUID;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT submission_id
        FROM ops.intake_submissions
        WHERE matched_person_id IS NULL
          AND (email IS NOT NULL OR phone IS NOT NULL)
        ORDER BY submitted_at
    LOOP
        v_total := v_total + 1;
        BEGIN
            v_result := sot.match_intake_to_person(v_rec.submission_id);
            IF v_result IS NOT NULL THEN
                v_matched := v_matched + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'match_intake_to_person failed for %: %', v_rec.submission_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Person backfill complete: % matched out of % attempted', v_matched, v_total;
END;
$$;


-- ============================================================================
-- Backfill: Link places for existing submissions
-- ============================================================================

DO $$
DECLARE
    v_linked INT := 0;
    v_total INT := 0;
    v_result UUID;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT submission_id
        FROM ops.intake_submissions
        WHERE place_id IS NULL
          AND selected_address_place_id IS NULL
          AND cats_address IS NOT NULL
          AND TRIM(cats_address) != ''
        ORDER BY submitted_at
    LOOP
        v_total := v_total + 1;
        BEGIN
            v_result := sot.link_intake_to_place(v_rec.submission_id);
            IF v_result IS NOT NULL THEN
                v_linked := v_linked + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'link_intake_to_place failed for %: %', v_rec.submission_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Place backfill complete: % linked out of % attempted', v_linked, v_total;
END;
$$;

COMMIT;
