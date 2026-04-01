-- MIG_3029: Kiosk staff tracking — "Who's at the desk?" (FFS-929)
--
-- Adds show_in_kiosk flag to ops.staff so admins can control which staff
-- appear in the kiosk staff picker. Seeds TRUE for clinic-facing departments.
-- Also links Paisley Rousseau's person_id if not already linked.
-- Adds kiosk.staff_selection_required config key.

BEGIN;

-- Step 1: Add show_in_kiosk column
ALTER TABLE ops.staff
ADD COLUMN IF NOT EXISTS show_in_kiosk BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ops.staff.show_in_kiosk IS
'Whether this staff member appears in the kiosk staff picker grid.';

-- Step 2: Set show_in_kiosk = TRUE for clinic-facing departments
UPDATE ops.staff
SET show_in_kiosk = TRUE
WHERE is_active = TRUE
  AND department IN ('Administration', 'Adoptions', 'Clinic', 'Trapping', 'Volunteers');

-- Step 3: Link Paisley Rousseau's person_id if not already set
UPDATE ops.staff s
SET person_id = pi.person_id
FROM sot.person_identifiers pi
WHERE s.email = 'paisley@forgottenfelines.com'
  AND s.person_id IS NULL
  AND pi.id_type = 'email'
  AND pi.id_value_norm = 'paisley@forgottenfelines.com'
  AND pi.confidence >= 0.5;

-- Ensure Paisley has correct department/role
UPDATE ops.staff
SET department = 'Clinic',
    role = 'Associate Clinic Coordinator'
WHERE email = 'paisley@forgottenfelines.com'
  AND (department IS NULL OR department != 'Clinic');

-- Step 4: Seed config key for requiring staff selection
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'kiosk.staff_selection_required',
  'false'::jsonb,
  'When true, hides the Skip option in the kiosk staff picker — forces staff identification on every session.',
  'kiosk'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
