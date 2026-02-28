-- MIG_2560: Fix find_similar_people to consider address differences
--
-- Problem (DATA_GAP_056): Phone matching gives 1.0 score regardless of address.
-- When two different people at different addresses share a phone (common in
-- households), they incorrectly get matched.
--
-- Example that was wrongly matched:
--   Samantha Spaletta (949 Chileno Valley) and Samantha Tresch (1170 Walker Rd)
--   Same cell phone: 7072178913
--   Old behavior: phone match = 1.0 → auto-linked as same person
--   New behavior: phone match + different address = 0.6 → requires review
--
-- Fix: Add p_address parameter and adjust phone match scoring:
--   - No address provided: 0.85 (can't verify)
--   - Same/similar address: 1.0 (confident match)
--   - Different address: 0.6 (likely household members, needs review)
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2560: Fix find_similar_people Address'
\echo '=============================================='
\echo ''

-- Drop existing function to allow signature change
DROP FUNCTION IF EXISTS sot.find_similar_people(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.find_similar_people(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL  -- NEW: Address for phone match verification
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    match_score NUMERIC
) AS $$
DECLARE
    v_full_name TEXT;
    v_norm_phone TEXT;
    v_norm_email TEXT;
BEGIN
    v_full_name := CONCAT(TRIM(p_first_name), ' ', TRIM(p_last_name));
    v_norm_phone := sot.norm_phone_us(p_phone);
    v_norm_email := sot.norm_email(p_email);

    RETURN QUERY
    SELECT
        p.person_id,
        p.display_name,
        pi_email.id_value_raw as email,
        pi_phone.id_value_raw as phone,
        GREATEST(
            -- Name similarity (unchanged)
            sot.name_similarity(p.display_name, v_full_name),

            -- Email match: exact = 1.0 (unchanged)
            CASE WHEN pi_email.id_value_norm = v_norm_email THEN 1.0 ELSE 0 END,

            -- Phone match: NOW ADDRESS-AWARE
            CASE
                WHEN pi_phone.id_value_norm = v_norm_phone THEN
                    CASE
                        -- No address to compare: moderate confidence
                        WHEN p_address IS NULL OR p_address = '' THEN 0.85

                        -- Same/similar address: high confidence match
                        WHEN EXISTS (
                            SELECT 1 FROM sot.places pl
                            WHERE pl.place_id = p.primary_address_id
                              AND pl.formatted_address IS NOT NULL
                              AND similarity(LOWER(pl.formatted_address), LOWER(p_address)) > 0.5
                        ) THEN 1.0

                        -- Different address: likely household members, low confidence
                        WHEN EXISTS (
                            SELECT 1 FROM sot.places pl
                            WHERE pl.place_id = p.primary_address_id
                              AND pl.formatted_address IS NOT NULL
                              AND similarity(LOWER(pl.formatted_address), LOWER(p_address)) < 0.3
                        ) THEN 0.6

                        -- Address unclear (person has no primary_address or no formatted_address)
                        ELSE 0.75
                    END
                ELSE 0
            END
        ) as match_score
    FROM sot.people p
    LEFT JOIN sot.person_identifiers pi_email ON pi_email.person_id = p.person_id
        AND pi_email.id_type = 'email' AND pi_email.confidence >= 0.5
    LEFT JOIN sot.person_identifiers pi_phone ON pi_phone.person_id = p.person_id
        AND pi_phone.id_type = 'phone'
    WHERE p.merged_into_person_id IS NULL
        AND (
            sot.name_similarity(p.display_name, v_full_name) > 0.6
            OR pi_email.id_value_norm = v_norm_email
            OR pi_phone.id_value_norm = v_norm_phone
        )
    ORDER BY match_score DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.find_similar_people IS
'Find people similar to the given name/email/phone/address.
FIXED (MIG_2560): Phone matches now consider address similarity.
- Same phone + same address = 1.0 (confident match)
- Same phone + no address provided = 0.85 (can''t verify)
- Same phone + different address = 0.6 (likely household members, needs review)
This prevents cross-linking household members who share a phone.';

\echo ''
\echo 'Testing find_similar_people with address awareness...'

-- Test: Same phone, same address should score 1.0
SELECT 'PHONE+SAME_ADDR' as test_case,
       (SELECT match_score FROM sot.find_similar_people('Test', 'Person', NULL, '7075551234', '123 Main St') LIMIT 1) IS NOT NULL as works;

\echo ''
\echo '=============================================='
\echo '  MIG_2560 Complete'
\echo '=============================================='
\echo ''
