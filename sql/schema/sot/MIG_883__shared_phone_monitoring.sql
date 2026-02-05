-- ============================================================================
-- MIG_883: Shared Phone Monitoring for Trapper-Colony Cross-Linking Prevention
-- ============================================================================
-- Known data pattern: Legacy FFSC trappers often gave their cell phone as
-- the contact number for elderly or less capable colony owners they managed.
-- This causes identity cross-linking when the phone resolves to the trapper
-- instead of the colony owner.
--
-- MIG_881 fixed the COALESCE order (prefer Owner Phone over Cell Phone).
-- This migration adds monitoring to detect and prevent future cross-linking
-- from shared phone numbers between trappers and non-trappers.
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_883: Shared Phone Monitoring'
\echo '============================================================'
\echo ''

-- ============================================================================
-- Phase 1: Create monitoring view for shared phones
-- ============================================================================

\echo 'Phase 1: Creating v_shared_phone_candidates...'

CREATE OR REPLACE VIEW trapper.v_shared_phone_candidates AS
SELECT
  pi.id_value_norm as phone,
  trapper_person.person_id as trapper_person_id,
  trapper_person.display_name as trapper_name,
  (SELECT string_agg(DISTINCT pr.role || COALESCE('/' || pr.trapper_type, ''), ', ')
   FROM trapper.person_roles pr
   WHERE pr.person_id = trapper_person.person_id AND pr.role_status = 'active'
  ) as trapper_roles,
  non_trapper.person_id as colony_owner_person_id,
  non_trapper.display_name as colony_owner_name,
  (SELECT COUNT(DISTINCT a.cat_id) FROM trapper.sot_appointments a WHERE a.person_id = non_trapper.person_id AND a.cat_id IS NOT NULL) as owner_cat_count,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = non_trapper.person_id) as owner_appointment_count,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM trapper.data_engine_soft_blacklist sb
      WHERE sb.identifier_norm = pi.id_value_norm AND sb.identifier_type = 'phone'
    ) THEN 'already_blacklisted'
    ELSE 'unprotected'
  END as blacklist_status
FROM trapper.person_identifiers pi
JOIN trapper.sot_people trapper_person ON trapper_person.person_id = pi.person_id
  AND trapper_person.merged_into_person_id IS NULL
JOIN trapper.person_roles pr ON pr.person_id = trapper_person.person_id
  AND pr.role = 'trapper' AND pr.role_status = 'active'
-- Same phone on a different person who is NOT a trapper
JOIN trapper.person_identifiers pi2 ON pi2.id_type = 'phone'
  AND pi2.id_value_norm = pi.id_value_norm
  AND pi2.person_id != pi.person_id
JOIN trapper.sot_people non_trapper ON non_trapper.person_id = pi2.person_id
  AND non_trapper.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = non_trapper.person_id
      AND pr2.role = 'trapper' AND pr2.role_status = 'active'
  )
WHERE pi.id_type = 'phone'
ORDER BY owner_appointment_count DESC;

COMMENT ON VIEW trapper.v_shared_phone_candidates IS
'MIG_883: Monitors phone numbers shared between active trappers and non-trapper people. '
'These are potential cross-linking risks from the legacy pattern of trappers giving their '
'cell phone as contact for elderly colony owners. Check blacklist_status to see if already protected.';

-- ============================================================================
-- Phase 2: Seed soft blacklist with unprotected shared trapper phones
-- ============================================================================

\echo ''
\echo 'Phase 2: Seeding soft blacklist...'

WITH unprotected_phones AS (
  SELECT DISTINCT phone, trapper_name, colony_owner_name
  FROM trapper.v_shared_phone_candidates
  WHERE blacklist_status = 'unprotected'
),
inserted AS (
  INSERT INTO trapper.data_engine_soft_blacklist (
    identifier_norm, identifier_type, reason,
    distinct_name_count, sample_names,
    require_name_similarity, require_address_match,
    auto_detected
  )
  SELECT
    up.phone,
    'phone',
    'trapper_colony_phone_sharing',
    2,
    ARRAY[up.trapper_name, up.colony_owner_name],
    0.6,   -- Require moderate name similarity to match
    FALSE,
    TRUE
  FROM unprotected_phones up
  ON CONFLICT DO NOTHING
  RETURNING identifier_norm
)
SELECT COUNT(*) as phones_blacklisted FROM inserted;

-- ============================================================================
-- Phase 3: Register in Tippy view catalog
-- ============================================================================

\echo ''
\echo 'Phase 3: Registering in Tippy...'

INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions
)
VALUES (
  'v_shared_phone_candidates',
  'quality',
  'Phone numbers shared between active trappers and non-trapper people. Potential cross-linking risk from legacy trapper-colony phone sharing pattern.',
  ARRAY['phone', 'trapper_name', 'colony_owner_name'],
  ARRAY['blacklist_status'],
  ARRAY[
    'Are there any shared phone numbers between trappers and colony owners?',
    'Which trappers share phone numbers with clients?',
    'Are all shared trapper phones protected by the soft blacklist?'
  ]
)
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Shared phone candidates:'
SELECT phone, trapper_name, colony_owner_name, owner_cat_count, blacklist_status
FROM trapper.v_shared_phone_candidates
LIMIT 15;

\echo ''
\echo 'Soft blacklist trapper entries:'
SELECT identifier_norm, reason, sample_names
FROM trapper.data_engine_soft_blacklist
WHERE reason = 'trapper_colony_phone_sharing'
LIMIT 10;

\echo ''
\echo '=== MIG_883 Complete ==='
