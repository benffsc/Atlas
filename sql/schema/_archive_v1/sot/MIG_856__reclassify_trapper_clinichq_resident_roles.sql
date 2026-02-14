-- ============================================================================
-- MIG_856: Reclassify clinichq 'resident' roles for trappers/staff
-- ============================================================================
-- The clinichq pipeline creates person_place_relationships with role='resident'
-- for the owner/contact on every appointment. This is correct for regular pet
-- owners (1-2 addresses) but wrong for:
--
-- Case A: Sandra Nicander (staff) — FFSC org phone 7075767999 appears on
--   1,200+ appointments. Pipeline matched her to all of them → 317 false
--   'resident' links. She doesn't live at any of those addresses.
--
-- Case B: Crystal Furtado (trapper) — brings cats from dozens of trapping
--   sites. Pipeline creates 'resident' at every site → 36 false links.
--   She actually lives at 441 Alta Ave (has 'owner' role at 0.90 confidence).
--
-- This migration:
--   1. Blacklists FFSC org phone in data_engine_soft_blacklist
--   2. For people with active trapper/staff/volunteer roles who have >3
--      clinichq 'resident' relationships:
--      - Keeps the HIGHEST-CONFIDENCE one as 'resident' (likely actual home)
--      - Reclassifies the rest to 'contact' (clinic appointment contact)
--   3. Logs all changes to entity_edits for audit
-- ============================================================================

\echo ''
\echo '============================================================'
\echo 'MIG_856: Reclassify Trapper/Staff ClinicHQ Resident Roles'
\echo '============================================================'
\echo ''

-- Step 1: Blacklist FFSC organizational phone number
-- This phone appears on 1,200+ appointments as the default owner phone.
-- It should not be used for identity resolution.
\echo 'Step 1: Blacklisting FFSC org phone 7075767999...'
INSERT INTO trapper.data_engine_soft_blacklist (
  identifier_norm, identifier_type, reason,
  distinct_name_count, sample_names,
  require_name_similarity, require_address_match
) VALUES (
  '7075767999', 'phone', 'FFSC organizational phone - appears on 1200+ clinic appointments as default owner phone',
  1, ARRAY['Sandra Nicander'],
  1.0, true
)
WHERE NOT EXISTS (SELECT 1 FROM trapper.data_engine_soft_blacklist WHERE identifier_norm = '7075767999');

-- Show before state
\echo ''
\echo 'Before: People with >3 clinichq resident links + active role:'
SELECT p.display_name, COUNT(*) AS resident_count,
  string_agg(DISTINCT pr.role, ', ') AS active_roles
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
LEFT JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role_status = 'active'
WHERE ppr.role = 'resident' AND ppr.source_system = 'clinichq'
  AND p.merged_into_person_id IS NULL
  AND EXISTS (SELECT 1 FROM trapper.person_roles pr2
              WHERE pr2.person_id = ppr.person_id AND pr2.role_status = 'active'
              AND pr2.role IN ('trapper', 'staff', 'volunteer', 'coordinator', 'head_trapper'))
GROUP BY p.person_id, p.display_name
HAVING COUNT(*) > 3
ORDER BY COUNT(*) DESC;

-- Step 2: Reclassify
-- For each affected person: keep highest-confidence link as resident, rest become contact
\echo ''
\echo 'Step 2: Reclassifying...'
WITH affected_relationships AS (
  SELECT
    ppr.relationship_id,
    ppr.person_id,
    ppr.place_id,
    ppr.confidence,
    ROW_NUMBER() OVER (
      PARTITION BY ppr.person_id
      ORDER BY
        ppr.confidence DESC,
        CASE ppr.role WHEN 'owner' THEN 1 WHEN 'resident' THEN 2 ELSE 3 END,
        ppr.created_at ASC  -- oldest = most likely actual home
    ) AS rn
  FROM trapper.person_place_relationships ppr
  WHERE ppr.role = 'resident'
    AND ppr.source_system = 'clinichq'
    AND EXISTS (
      SELECT 1 FROM trapper.person_roles pr
      WHERE pr.person_id = ppr.person_id AND pr.role_status = 'active'
      AND pr.role IN ('trapper', 'staff', 'volunteer', 'coordinator', 'head_trapper')
    )
    AND (
      SELECT COUNT(*)
      FROM trapper.person_place_relationships ppr2
      WHERE ppr2.person_id = ppr.person_id
        AND ppr2.role = 'resident'
        AND ppr2.source_system = 'clinichq'
    ) > 3
),
to_reclassify AS (
  SELECT relationship_id, person_id, place_id
  FROM affected_relationships
  WHERE rn > 1
)
UPDATE trapper.person_place_relationships ppr
SET role = 'contact'::trapper.person_place_role
FROM to_reclassify tr
WHERE ppr.relationship_id = tr.relationship_id;

-- Show after state
\echo ''
\echo 'After: Reclassified relationships:'
SELECT p.display_name,
  SUM(CASE WHEN ppr.role = 'resident' THEN 1 ELSE 0 END) AS resident_count,
  SUM(CASE WHEN ppr.role = 'contact' THEN 1 ELSE 0 END) AS contact_count,
  SUM(CASE WHEN ppr.role = 'owner' THEN 1 ELSE 0 END) AS owner_count
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
WHERE ppr.source_system = 'clinichq'
  AND p.merged_into_person_id IS NULL
  AND EXISTS (SELECT 1 FROM trapper.person_roles pr
              WHERE pr.person_id = ppr.person_id AND pr.role_status = 'active'
              AND pr.role IN ('trapper', 'staff', 'volunteer', 'coordinator', 'head_trapper'))
  AND (
    SELECT COUNT(*)
    FROM trapper.person_place_relationships ppr2
    WHERE ppr2.person_id = ppr.person_id AND ppr2.source_system = 'clinichq'
  ) > 3
GROUP BY p.person_id, p.display_name
ORDER BY p.display_name;

-- Step 3: Audit trail
\echo ''
\echo 'Step 3: Logging to entity_edits...'
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, edit_type, field_name,
  old_value, new_value, edited_by, edit_source
)
SELECT
  'person_place_relationship', ppr.relationship_id, 'field_update', 'role',
  to_jsonb('resident'::text), to_jsonb('contact'::text),
  'MIG_856', 'migration'
FROM trapper.person_place_relationships ppr
WHERE ppr.role = 'contact'
  AND ppr.source_system = 'clinichq'
  AND EXISTS (
    SELECT 1 FROM trapper.person_roles pr
    WHERE pr.person_id = ppr.person_id AND pr.role_status = 'active'
    AND pr.role IN ('trapper', 'staff', 'volunteer', 'coordinator', 'head_trapper')
  )
  AND NOT EXISTS (
    SELECT 1 FROM trapper.entity_edits ee
    WHERE ee.entity_id = ppr.relationship_id
      AND ee.edited_by = 'MIG_856'
  );

\echo ''
\echo 'MIG_856 Changes:'
\echo '  1. Blacklisted FFSC org phone 7075767999 in data_engine_soft_blacklist'
\echo '  2. Reclassified clinichq resident->contact for trappers/staff with >3 sites'
\echo '  3. Kept highest-confidence link as resident (actual home)'
\echo '  4. Logged all changes to entity_edits for audit'
\echo ''
\echo '=== MIG_856 Complete ==='
