-- MIG_2931: Seed FFSC staff roster with correct roles and departments (FFS-534)
--
-- Staff were seeded as sot.people in MIG_2011 but never added to ops.staff
-- (except Ben Mis from MIG_2013). This migration populates the staff directory
-- and links to existing person records via email.

BEGIN;

-- Step 1: Upsert staff records, linking to sot.people via person_identifiers
WITH staff_data (first_name, last_name, email, role, department) AS (
  VALUES
    ('Pip',       'Marquez de la Plata', 'pip@forgottenfelines.com',              'Executive Director',                       'Administration'),
    ('Jami',      'Knuthson',            'jami@forgottenfelines.com',             'Receptionist / Administrative Assistant',  'Administration'),
    ('Kate',      'McLaren',             'kate@forgottenfelines.com',             'Bookkeeper',                              'Administration'),
    ('Addie',     'Anderson',            'addie@forgottenfelines.com',            'Adoption & Barn Cat Program Coordinator',  'Adoptions'),
    ('Sandra',    'Nicander',            'sandra@forgottenfelines.com',           'Clinic Coordinator',                       'Clinic'),
    ('Heidi',     'Fantacone',           'wcbc@forgottenfelines.com',             'Barn Cat Program Coordinator',             'Adoptions'),
    ('Jennifer',  'Cochran',             'jenniferc@forgottenfelines.com',        'Clinic Coordinator',                       'Clinic'),
    ('Neely',     'Hart',                'neely@forgottenfelines.com',            'Foster & Adoption Coordinator',            'Adoptions'),
    ('Paisley',   'Rousseau',            'paisley@forgottenfelines.com',          'Associate Clinic Coordinator',             'Clinic'),
    ('Ethan',     'Britton',             'ethan@forgottenfelines.com',            'Associate Clinic Coordinator',             'Clinic'),
    ('Valentina', 'Viti',                'valentina@forgottenfelines.com',        'Marketing Coordinator',                    'Marketing'),
    ('Bridget',   'Shannon',             'bridget@forgottenfelines.com',          'Volunteer Coordinator',                    'Volunteers'),
    ('Julia',     'Rosenfeld',           'julia@forgottenfelines.com',            'Foster Coordinator',                       'Adoptions'),
    ('Brian',     'Benn',                'brian@forgottenfelines.com',            'Pick of the Litter Manager',               'Other'),
    ('Crystal',   'Furtado',             'crystalfurtado57chevy@gmail.com',       'Trapper (Staff)',                          'Trapping')
)
INSERT INTO ops.staff (first_name, last_name, display_name, email, role, department, person_id, source_system, is_active)
SELECT
  sd.first_name,
  sd.last_name,
  sd.first_name || ' ' || sd.last_name,
  sd.email,
  sd.role,
  sd.department,
  pi.person_id,
  'atlas_ui',
  TRUE
FROM staff_data sd
LEFT JOIN sot.person_identifiers pi
  ON pi.id_type = 'email'
  AND pi.id_value_norm = LOWER(TRIM(sd.email))
  AND pi.confidence >= 0.5
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  person_id = COALESCE(ops.staff.person_id, EXCLUDED.person_id),
  is_active = TRUE,
  updated_at = NOW();

-- Step 2: Ensure 'staff' person_role exists for all linked staff
INSERT INTO sot.person_roles (person_id, role, role_status, source_system, notes)
SELECT s.person_id, 'staff', 'active', 'atlas_ui', s.role
FROM ops.staff s
WHERE s.person_id IS NOT NULL
  AND s.is_active = TRUE
ON CONFLICT (person_id, role) DO UPDATE SET
  role_status = 'active',
  notes = EXCLUDED.notes,
  updated_at = NOW();

COMMIT;
