-- ============================================================================
-- MIG_773: Backfill People Without Identifiers (TASK_005)
-- ============================================================================
-- TASK_LEDGER reference: TASK_005
-- ACTIVE Impact: No — strictly additive (INSERT into person_identifiers)
--
-- 986 active people have no email/phone in person_identifiers.
-- They can't be found by search and will be duplicated on next encounter.
-- 507 of these have email/phone in data_engine_match_decisions.
-- ============================================================================

\echo '=== MIG_773: Backfill People Without Identifiers (TASK_005) ==='

-- ============================================================================
-- Step 1: Diagnostics
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-fix count of people without identifiers:'

SELECT COUNT(*) AS people_without_identifiers
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id);

-- ============================================================================
-- Step 2: Recover emails from data_engine_match_decisions
-- ============================================================================

\echo ''
\echo 'Step 2: Recovering emails from match decisions'

-- Insert emails found in match decisions for orphan people
WITH orphan_people AS (
    SELECT sp.person_id
    FROM trapper.sot_people sp
    WHERE sp.merged_into_person_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id)
),
recoverable_emails AS (
    SELECT DISTINCT ON (d.resulting_person_id)
        d.resulting_person_id AS person_id,
        LOWER(TRIM(d.incoming_email)) AS email
    FROM trapper.data_engine_match_decisions d
    JOIN orphan_people op ON op.person_id = d.resulting_person_id
    WHERE d.incoming_email IS NOT NULL
      AND TRIM(d.incoming_email) != ''
      AND LOWER(TRIM(d.incoming_email)) NOT IN ('n/a', 'none', 'na', 'unknown', 'no email')
    ORDER BY d.resulting_person_id, d.processed_at DESC
)
INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system, created_at)
SELECT
    re.person_id,
    'email',
    re.email,
    re.email,
    'atlas_backfill_773',
    NOW()
FROM recoverable_emails re
WHERE NOT EXISTS (
    -- Check globally: this email must not belong to ANY person (unique constraint is global)
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.id_type = 'email' AND pi.id_value_norm = re.email
)
ON CONFLICT DO NOTHING;

\echo 'Emails recovered:'
SELECT COUNT(*) AS emails_added
FROM trapper.person_identifiers
WHERE source_system = 'atlas_backfill_773' AND id_type = 'email';

-- ============================================================================
-- Step 3: Recover phones from data_engine_match_decisions
-- ============================================================================

\echo ''
\echo 'Step 3: Recovering phones from match decisions'

WITH orphan_people AS (
    SELECT sp.person_id
    FROM trapper.sot_people sp
    WHERE sp.merged_into_person_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = sp.person_id
      )
),
recoverable_phones AS (
    SELECT DISTINCT ON (d.resulting_person_id)
        d.resulting_person_id AS person_id,
        TRIM(d.incoming_phone) AS phone,
        trapper.norm_phone_us(d.incoming_phone) AS phone_norm
    FROM trapper.data_engine_match_decisions d
    JOIN orphan_people op ON op.person_id = d.resulting_person_id
    WHERE d.incoming_phone IS NOT NULL
      AND TRIM(d.incoming_phone) != ''
      AND LENGTH(TRIM(d.incoming_phone)) >= 7
    ORDER BY d.resulting_person_id, d.processed_at DESC
)
INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system, created_at)
SELECT
    rp.person_id,
    'phone',
    rp.phone,
    rp.phone_norm,
    'atlas_backfill_773',
    NOW()
FROM recoverable_phones rp
WHERE rp.phone_norm IS NOT NULL
  AND rp.phone_norm != ''
  AND NOT EXISTS (
    -- Check globally: this phone must not belong to ANY person (unique constraint is global)
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.id_type = 'phone' AND pi.id_value_norm = rp.phone_norm
  )
ON CONFLICT DO NOTHING;

\echo 'Phones recovered:'
SELECT COUNT(*) AS phones_added
FROM trapper.person_identifiers
WHERE source_system = 'atlas_backfill_773' AND id_type = 'phone';

-- ============================================================================
-- Step 4: Post-fix diagnostics
-- ============================================================================

\echo ''
\echo 'Step 4: Post-fix count of people still without identifiers:'

SELECT COUNT(*) AS remaining_without_identifiers
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id);

\echo ''
\echo 'Total identifiers added by this migration:'
SELECT id_type, COUNT(*) AS added
FROM trapper.person_identifiers
WHERE source_system = 'atlas_backfill_773'
GROUP BY id_type;

\echo ''
\echo 'Orphans whose identifiers already belong to another person (potential duplicates):'
SELECT COUNT(*) AS potential_duplicates
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id)
  AND EXISTS (
    SELECT 1 FROM trapper.data_engine_match_decisions d
    WHERE d.resulting_person_id = sp.person_id
      AND (
        (d.incoming_email IS NOT NULL AND TRIM(d.incoming_email) != ''
         AND EXISTS (SELECT 1 FROM trapper.person_identifiers pi2
                     WHERE pi2.id_type = 'email'
                       AND pi2.id_value_norm = LOWER(TRIM(d.incoming_email))
                       AND pi2.person_id != sp.person_id))
        OR
        (d.incoming_phone IS NOT NULL AND TRIM(d.incoming_phone) != ''
         AND EXISTS (SELECT 1 FROM trapper.person_identifiers pi2
                     WHERE pi2.id_type = 'phone'
                       AND pi2.id_value_norm = trapper.norm_phone_us(d.incoming_phone)
                       AND pi2.person_id != sp.person_id))
      )
  );

\echo ''
\echo 'Remaining orphans by data_source:'
SELECT sp.data_source, COUNT(*) AS cnt
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id)
GROUP BY sp.data_source
ORDER BY cnt DESC;

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_773 SUMMARY ======'
\echo 'Recovered identifiers from data_engine_match_decisions for orphan people.'
\echo 'Source system tagged as atlas_backfill_773 for auditability.'
\echo ''
\echo 'Rollback: DELETE FROM trapper.person_identifiers WHERE source_system = ''atlas_backfill_773'';'
\echo ''
\echo '=== MIG_773 Complete ==='
