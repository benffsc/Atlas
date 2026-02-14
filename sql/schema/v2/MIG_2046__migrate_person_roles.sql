-- MIG_2046: Migrate person_roles from trapper to sot schema
-- Date: 2026-02-13
-- Issue: sot.person_roles is empty, trapper.person_roles has 253 rows

-- Check before
SELECT 'BEFORE: sot.person_roles' as context, COUNT(*) as count FROM sot.person_roles;

-- Migrate roles from trapper to sot
-- Map trapper_type based on role
INSERT INTO sot.person_roles (
  role_id,
  person_id,
  role,
  role_status,
  trapper_type,
  source_system,
  source_record_id,
  created_at,
  updated_at
)
SELECT
  tr.role_id,
  tr.person_id,
  tr.role,
  tr.role_status,
  -- Map trapper_type for trapper roles
  CASE
    WHEN tr.role = 'trapper' AND tr.source_system = 'volunteerhub' THEN 'ffsc_trapper'
    WHEN tr.role = 'trapper' AND tr.source_system = 'airtable' THEN 'ffsc_trapper'
    WHEN tr.role = 'staff' THEN 'coordinator'
    ELSE NULL
  END as trapper_type,
  tr.source_system,
  NULL as source_record_id,
  tr.created_at,
  COALESCE(tr.updated_at, tr.created_at)
FROM trapper.person_roles tr
-- Only migrate if person exists in sot.people
WHERE EXISTS (
  SELECT 1 FROM sot.people p
  WHERE p.person_id = tr.person_id
  AND p.merged_into_person_id IS NULL
)
ON CONFLICT (role_id) DO NOTHING;

-- Check after
SELECT 'AFTER: sot.person_roles' as context, COUNT(*) as count FROM sot.person_roles;

-- Show role distribution
SELECT role, role_status, trapper_type, COUNT(*)
FROM sot.person_roles
GROUP BY 1, 2, 3
ORDER BY 4 DESC;
