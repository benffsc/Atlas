-- MIG_154__auto_link_requests_to_people.sql
-- Auto-link requests to existing people via email/phone matching
--
-- Problem:
--   Lee Anderson has a request and a person profile, but they're not linked.
--   The request promotion didn't match the email to the existing person.
--
-- Solution:
--   Create a function to auto-link requests to people based on email/phone.
--   Run on all unlinked requests.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_154__auto_link_requests_to_people.sql

\echo ''
\echo 'MIG_154: Auto-link Requests to People'
\echo '============================================'

-- ============================================================
-- 1. Function to link a request to a person
-- ============================================================

\echo ''
\echo 'Creating link_request_to_person function...'

CREATE OR REPLACE FUNCTION trapper.link_request_to_person(
    p_request_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_source_record_id TEXT;
    v_email TEXT;
    v_phone TEXT;
    v_person_id UUID;
    v_match_reason TEXT;
BEGIN
    -- Skip if already linked
    IF EXISTS (SELECT 1 FROM trapper.sot_requests WHERE request_id = p_request_id AND requester_person_id IS NOT NULL) THEN
        RETURN NULL;
    END IF;

    -- Get the source record ID
    SELECT source_record_id INTO v_source_record_id
    FROM trapper.sot_requests
    WHERE request_id = p_request_id;

    IF v_source_record_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Get email and phone from staged record
    SELECT
        COALESCE(payload->>'Email', payload->>'Clean Email', payload->>'Business Email'),
        COALESCE(payload->>'Phone', payload->>'Clean Phone', payload->>'Business Phone')
    INTO v_email, v_phone
    FROM trapper.staged_records
    WHERE source_row_id = v_source_record_id;

    -- Try to match by email first (highest confidence)
    IF v_email IS NOT NULL AND TRIM(v_email) <> '' THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = trapper.norm_email(v_email);

        IF v_person_id IS NOT NULL THEN
            v_match_reason := 'email_match';
        END IF;
    END IF;

    -- Try phone if no email match
    IF v_person_id IS NULL AND v_phone IS NOT NULL AND TRIM(v_phone) <> '' THEN
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = trapper.norm_phone_us(v_phone);

        IF v_person_id IS NOT NULL THEN
            v_match_reason := 'phone_match';
        END IF;
    END IF;

    -- Update request if we found a match
    IF v_person_id IS NOT NULL THEN
        -- Get canonical person ID (in case of merges)
        v_person_id := trapper.canonical_person_id(v_person_id);

        UPDATE trapper.sot_requests
        SET requester_person_id = v_person_id
        WHERE request_id = p_request_id;

        -- Log the auto-link
        INSERT INTO trapper.corrections (
            entity_type, entity_id, correction_type, field_name,
            old_value, new_value, reason, created_by, suggested_by
        ) VALUES (
            'request', p_request_id, 'link', 'requester_person_id',
            'null'::jsonb, to_jsonb(v_person_id::text),
            'Auto-linked via ' || v_match_reason,
            'system', 'rule'
        );

        RETURN v_person_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_request_to_person IS
'Auto-links a request to an existing person via email/phone matching.
Returns the person_id if linked, NULL if no match found.';

-- ============================================================
-- 2. Backfill: Link all unlinked requests
-- ============================================================

\echo ''
\echo 'Auto-linking unlinked requests...'

WITH unlinked_requests AS (
    SELECT request_id
    FROM trapper.sot_requests
    WHERE requester_person_id IS NULL
      AND source_record_id IS NOT NULL
),
linked AS (
    SELECT
        request_id,
        trapper.link_request_to_person(request_id) as person_id
    FROM unlinked_requests
)
SELECT
    COUNT(*) as total_checked,
    COUNT(person_id) as auto_linked,
    COUNT(*) - COUNT(person_id) as still_unlinked
FROM linked;

-- ============================================================
-- 3. Verify Lee Anderson
-- ============================================================

\echo ''
\echo 'Verifying Lee Anderson link...';

SELECT
    r.request_id,
    r.summary,
    r.requester_person_id,
    p.display_name as linked_person_name
FROM trapper.sot_requests r
LEFT JOIN trapper.sot_people p ON p.person_id = r.requester_person_id
WHERE r.summary ILIKE '%Lee Anderson%';

-- ============================================================
-- 4. Show remaining unlinked requests
-- ============================================================

\echo ''
\echo 'Remaining unlinked requests (need manual review):';

SELECT
    r.request_id,
    r.summary,
    sr.payload->>'Email' as email,
    sr.payload->>'Phone' as phone,
    sr.payload->>'First Name' as first_name,
    sr.payload->>'Last Name' as last_name
FROM trapper.sot_requests r
JOIN trapper.staged_records sr ON sr.source_row_id = r.source_record_id
WHERE r.requester_person_id IS NULL
  AND sr.source_table = 'trapping_requests'
LIMIT 20;

SELECT 'MIG_154 Complete' AS status;
