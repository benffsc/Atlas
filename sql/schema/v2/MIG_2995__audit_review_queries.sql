-- MIG_2995: Audit Review Queries (No Data Changes)
--
-- FFS-881: ClinicHQ Data Quality Audit Remediation
-- FFS-884: Review 33 phone-only name mismatches (pre-address-guard)
-- FFS-887: Re-run March batch + investigate person-cat evidence gaps
--
-- These queries generate review lists for manual triage.
-- No data is modified — output only.
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_2995: Audit Review Queries'
\echo '=============================================='
\echo ''

-- ============================================================================
-- QUERY 1: Phone-only name mismatches (FFS-884)
-- ============================================================================
-- 33 clinic accounts matched by phone-only where name similarity < 0.3.
-- These are existing wrong links from before the address guard (MIG_2990).

\echo ''
\echo '--- QUERY 1: Phone-Only Name Mismatches (CRITICAL) ---'
\echo ''

SELECT
  ca.account_id,
  ca.display_name AS account_name,
  p.display_name AS resolved_to_name,
  ROUND(similarity(LOWER(ca.display_name), LOWER(p.display_name))::NUMERIC, 3) AS name_similarity,
  ca.owner_phone,
  ca.owner_email,
  ca.owner_address AS account_address,
  (SELECT pp.place_id FROM sot.person_place pp
   JOIN sot.places pl ON pl.place_id = pp.place_id
   WHERE pp.person_id = p.person_id
   LIMIT 1) AS person_place_id,
  (SELECT pl.formatted_address FROM sot.person_place pp
   JOIN sot.places pl ON pl.place_id = pp.place_id
   WHERE pp.person_id = p.person_id
   LIMIT 1) AS person_address,
  ca.resolved_person_id,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = ca.resolved_person_id) AS total_person_appts,
  (SELECT COUNT(DISTINCT a.client_name) FROM ops.appointments a WHERE a.person_id = ca.resolved_person_id) AS distinct_names_on_person
FROM ops.clinic_accounts ca
JOIN sot.people p ON ca.resolved_person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  -- Phone-only match: has phone, no email on the account
  AND ca.owner_phone IS NOT NULL
  AND (ca.owner_email IS NULL OR ca.owner_email = '')
  -- Name similarity below threshold
  AND similarity(LOWER(ca.display_name), LOWER(p.display_name)) < 0.3
  -- Exclude accounts where the name is an address or org (those are expected to differ)
  AND ca.display_name !~ '^[0-9]'
  AND ca.display_name NOT ILIKE '%SCAS%'
  AND ca.display_name NOT ILIKE '%Altera%'
ORDER BY name_similarity ASC, ca.display_name;

-- ============================================================================
-- QUERY 2: Multi-identity people (multiple distinct names, 3+ addresses)
-- ============================================================================
-- People who may have absorbed wrong identities via phone matching.

\echo ''
\echo '--- QUERY 2: Multi-Identity People (potential wrong merges) ---'
\echo ''

SELECT
  p.person_id,
  p.display_name,
  COUNT(DISTINCT a.client_name) AS distinct_names,
  COUNT(DISTINCT a.owner_address) AS distinct_addresses,
  COUNT(*) AS total_appointments,
  ARRAY_AGG(DISTINCT a.client_name ORDER BY a.client_name) AS all_names,
  ARRAY_AGG(DISTINCT a.owner_address ORDER BY a.owner_address) AS all_addresses
FROM sot.people p
JOIN ops.appointments a ON a.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name
HAVING COUNT(DISTINCT a.client_name) >= 3
   AND COUNT(DISTINCT a.owner_address) >= 3
ORDER BY COUNT(DISTINCT a.client_name) DESC;

-- ============================================================================
-- QUERY 3: March appointments missing owner_account_id (FFS-887)
-- ============================================================================

\echo ''
\echo '--- QUERY 3: Appointments Missing owner_account_id ---'
\echo ''

SELECT
  a.appointment_id,
  a.client_name,
  a.appointment_date,
  a.person_id,
  a.cat_id,
  a.owner_email,
  a.owner_phone,
  a.owner_address
FROM ops.appointments a
WHERE a.owner_account_id IS NULL
  AND a.appointment_date >= '2026-03-01'
ORDER BY a.appointment_date DESC;

-- ============================================================================
-- QUERY 4: Person-cat evidence gaps (FFS-887)
-- ============================================================================
-- ClinicHQ person-cat links claiming "appointment" evidence but no matching
-- appointment connects that person to that cat.

\echo ''
\echo '--- QUERY 4: Person-Cat Evidence Gaps (sample 50) ---'
\echo ''

SELECT
  pc.person_id,
  p.display_name,
  pc.cat_id,
  c.name AS cat_name,
  c.microchip,
  pc.evidence_type,
  pc.source_system,
  pc.created_at AS link_created,
  (SELECT COUNT(*) FROM ops.appointments a
   WHERE a.person_id = pc.person_id AND a.cat_id = pc.cat_id) AS matching_appts,
  (SELECT COUNT(*) FROM ops.appointments a
   WHERE a.cat_id = pc.cat_id) AS total_cat_appts,
  (SELECT COUNT(*) FROM ops.appointments a
   WHERE a.person_id = pc.person_id) AS total_person_appts
FROM sot.person_cat pc
JOIN sot.people p ON p.person_id = pc.person_id
JOIN sot.cats c ON c.cat_id = pc.cat_id
WHERE pc.source_system = 'clinichq'
  AND pc.evidence_type = 'appointment'
  AND p.merged_into_person_id IS NULL
  AND c.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a
    WHERE a.person_id = pc.person_id
      AND a.cat_id = pc.cat_id
  )
ORDER BY pc.created_at DESC
LIMIT 50;

-- Count total gaps
SELECT COUNT(*) AS total_evidence_gaps
FROM sot.person_cat pc
JOIN sot.people p ON p.person_id = pc.person_id
JOIN sot.cats c ON c.cat_id = pc.cat_id
WHERE pc.source_system = 'clinichq'
  AND pc.evidence_type = 'appointment'
  AND p.merged_into_person_id IS NULL
  AND c.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ops.appointments a
    WHERE a.person_id = pc.person_id
      AND a.cat_id = pc.cat_id
  );

-- ============================================================================
-- QUERY 5: Post-MIG_2993/2994 Verification
-- ============================================================================
-- Run these AFTER applying MIG_2993 and MIG_2994 to confirm fixes.

\echo ''
\echo '--- QUERY 5: Post-Fix Verification ---'
\echo ''

-- Stale FKs to merged cats (expect 0)
SELECT 'Stale person_cat → merged cats' AS check_name,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM sot.person_cat pc
JOIN sot.cats c ON pc.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL

UNION ALL

SELECT 'Stale cat_place → merged cats',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM sot.cat_place cp
JOIN sot.cats c ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NOT NULL

UNION ALL

-- Appointment divergence (expect 0)
SELECT 'Appointment person_id ≠ account resolution',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM ops.appointments a
JOIN ops.clinic_accounts ca ON a.owner_account_id = ca.account_id
WHERE ca.resolved_person_id IS NOT NULL
  AND a.person_id IS NOT NULL
  AND a.person_id IS DISTINCT FROM ca.resolved_person_id

UNION ALL

-- Stale clinic_accounts → merged people (expect 0)
SELECT 'Stale clinic_accounts → merged people',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM ops.clinic_accounts ca
JOIN sot.people p ON ca.resolved_person_id = p.person_id
WHERE p.merged_into_person_id IS NOT NULL

UNION ALL

-- Altera appointments (expect 2)
SELECT 'Altera remaining appointments (expect 2)',
  COUNT(*),
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'CHECK' END
FROM ops.appointments
WHERE person_id = '28f4f1ae-a5df-49b6-bb25-2e22cb361eff'

UNION ALL

-- Phone blacklisted
SELECT 'Phone 4152469162 blacklisted',
  COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END
FROM sot.soft_blacklist
WHERE identifier_type = 'phone' AND identifier_norm = '4152469162';

\echo ''
\echo '=============================================='
\echo '  MIG_2995 COMPLETE'
\echo '=============================================='
\echo ''
