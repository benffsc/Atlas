-- MIG_3115: Fix trapper email/phone confidence + one-time Airtable seed
--
-- Problem: Only 8 of 42 active trappers have email confidence >= 0.5.
-- The threshold was designed for PetLink spam, but it's hiding real
-- trapper contact info from VolunteerHub (0.48) and ClinicHQ (0.35-0.40).
--
-- Solution:
--   1. Boost confidence to 0.7 for all active trapper identifiers
--   2. One-time Airtable email backfill handled by separate script
--
-- Confidence hierarchy going forward:
--   Atlas UI staff edit: 0.9 (highest trust)
--   VolunteerHub sync:  0.7
--   ClinicHQ ingest:    0.5-0.7 (boosted for known trappers)
--   Airtable seed:      0.6 (one-time, will go stale)
--
-- FFS-1428
-- Created: 2026-05-01

\echo ''
\echo '=============================================='
\echo '  MIG_3115: Trapper Email Confidence Fix'
\echo '=============================================='
\echo ''

-- Baseline: how many active trappers have usable emails?
\echo 'BEFORE — Active trapper email coverage at >= 0.5 confidence:'

SELECT
  tp.trapper_type,
  COUNT(DISTINCT tp.person_id) AS active_trappers,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'email' AND pi.confidence >= 0.5 THEN tp.person_id END) AS with_email_gte_05,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'email' THEN tp.person_id END) AS with_any_email,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'phone' AND pi.confidence >= 0.5 THEN tp.person_id END) AS with_phone_gte_05
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.person_identifiers pi ON pi.person_id = tp.person_id
WHERE tp.is_active = TRUE
GROUP BY tp.trapper_type
ORDER BY tp.trapper_type;

BEGIN;

-- Step 1: Boost confidence for all active trapper identifiers
\echo ''
\echo '1. Boosting confidence to 0.7 for active trapper identifiers...'

UPDATE sot.person_identifiers pi
SET confidence = 0.7
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
WHERE tp.person_id = pi.person_id
  AND tp.is_active = TRUE
  AND pi.confidence < 0.7
  AND pi.id_type IN ('email', 'phone');

\echo '   Done.'

COMMIT;

-- Verify
\echo ''
\echo 'AFTER — Active trapper email coverage at >= 0.5 confidence:'

SELECT
  tp.trapper_type,
  COUNT(DISTINCT tp.person_id) AS active_trappers,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'email' AND pi.confidence >= 0.5 THEN tp.person_id END) AS with_email_gte_05,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'email' THEN tp.person_id END) AS with_any_email,
  COUNT(DISTINCT CASE WHEN pi.id_type = 'phone' AND pi.confidence >= 0.5 THEN tp.person_id END) AS with_phone_gte_05
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.person_identifiers pi ON pi.person_id = tp.person_id
WHERE tp.is_active = TRUE
GROUP BY tp.trapper_type
ORDER BY tp.trapper_type;

-- Show trappers still missing email
\echo ''
\echo 'Active trappers still missing email (need Airtable seed or manual entry):'

SELECT p.display_name, tp.trapper_type, p.source_system
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
WHERE tp.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_identifiers pi
    WHERE pi.person_id = tp.person_id AND pi.id_type = 'email'
  )
ORDER BY p.display_name;

\echo ''
\echo 'Next: run Airtable email seed script for missing emails.'
\echo '  source apps/web/.env.local && npx tsx scripts/pipeline/seed-trapper-emails-from-airtable.ts'
\echo ''
