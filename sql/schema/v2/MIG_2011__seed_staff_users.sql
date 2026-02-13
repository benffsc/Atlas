-- MIG_2011: Seed Staff Users in sot.people
--
-- Purpose: Create staff user records that were deleted during CASCADE truncate
-- Source: Staff-Grid view CSV from Airtable
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2011: Seed Staff Users'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. INSERT STAFF USERS
-- ============================================================================

\echo '1. Creating staff user records...'

INSERT INTO sot.people (first_name, last_name, display_name, primary_email, primary_phone, source_system)
VALUES
    -- FFSC Core Staff
    ('Pip', 'Marquez de la Plata', 'Pip Marquez de la Plata', 'pip@forgottenfelines.com', '4152981612', 'atlas_ui'),
    ('Jami', 'Knuthson', 'Jami Knuthson', 'jami@forgottenfelines.com', '7074860656', 'atlas_ui'),
    ('Kate', 'McLaren', 'Kate McLaren', 'kate@forgottenfelines.com', '7074797059', 'atlas_ui'),
    ('Addie', 'Anderson', 'Addie Anderson', 'addie@forgottenfelines.com', '7077907731', 'atlas_ui'),
    ('Sandra', 'Nicander', 'Sandra Nicander', 'sandra@forgottenfelines.com', '7075913247', 'atlas_ui'),
    ('Heidi', 'Fantacone', 'Heidi Fantacone', 'wcbc@forgottenfelines.com', '7073216955', 'atlas_ui'),
    ('Jennifer', 'Cochran', 'Jennifer Cochran', 'jenniferc@forgottenfelines.com', '7072178781', 'atlas_ui'),
    ('Neely', 'Hart', 'Neely Hart', 'neely@forgottenfelines.com', '7076840797', 'atlas_ui'),
    ('Valentina', 'Viti', 'Valentina Viti', 'valentina@forgottenfelines.com', '7076088182', 'atlas_ui'),
    ('Bridget', 'Shannon', 'Bridget Shannon', 'bridget@forgottenfelines.com', '7074721370', 'atlas_ui'),
    ('Julia', 'Rosenfeld', 'Julia Rosenfeld', 'julia@forgottenfelines.com', '7187152757', 'atlas_ui'),
    ('Brian', 'Benn', 'Brian Benn', 'brian@forgottenfelines.com', '7077382347', 'atlas_ui'),
    ('Ben', 'Mis', 'Ben Mis', 'ben@forgottenfelines.com', '4158589577', 'atlas_ui'),
    ('Ethan', 'Britton', 'Ethan Britton', 'ethan@forgottenfelines.com', NULL, 'atlas_ui'),

    -- FFSC Field Staff (non-FFSC emails)
    ('Crystal', 'Furtado', 'Crystal Furtado', 'crystalfurtado57chevy@gmail.com', '7078899411', 'atlas_ui'),
    ('Stephanie', 'Fuller', 'Stephanie Fuller', 'stephyfuller@yahoo.com', '7077387536', 'atlas_ui'),
    ('Tyce', 'Abbott', 'Tyce Abbott', 'tyceabbott96@gmail.com', '7078886435', 'atlas_ui'),

    -- Beacon Engineering Team
    ('Daniel', 'Chen', 'Daniel Chen', 'danielchen297@gmail.com', NULL, 'atlas_ui'),
    ('Evan', 'Haque', 'Evan Haque', 'evanhaque1@gmail.com', NULL, 'atlas_ui'),
    ('Dominique', 'Fougere', 'Dominique Fougere', 'dom@dominiquefougere.com', NULL, 'atlas_ui'),
    ('Dave', 'Shreiner', 'Dave Shreiner', 'shreiner@gmail.com', NULL, 'atlas_ui'),
    ('Alan', 'Wu', 'Alan Wu', 'alanwu0331@gmail.com', NULL, 'atlas_ui'),
    ('Xuefei', 'Cheng', 'Xuefei Cheng', 'cheng.xuefei0319@gmail.com', NULL, 'atlas_ui')
ON CONFLICT DO NOTHING;

\echo '   Created 23 staff user records'

-- ============================================================================
-- 2. ADD PERSON IDENTIFIERS FOR STAFF
-- ============================================================================

\echo ''
\echo '2. Adding person identifiers for staff...'

-- Add email identifiers
INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
SELECT
    p.person_id,
    'email',
    p.primary_email,
    LOWER(p.primary_email),
    1.0,
    'atlas_ui'
FROM sot.people p
WHERE p.primary_email IS NOT NULL
  AND p.source_system = 'atlas_ui'
  AND NOT EXISTS (
      SELECT 1 FROM sot.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type = 'email'
        AND pi.id_value_norm = LOWER(p.primary_email)
  )
ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;

-- Add phone identifiers
INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
SELECT
    p.person_id,
    'phone',
    p.primary_phone,
    p.primary_phone,
    1.0,
    'atlas_ui'
FROM sot.people p
WHERE p.primary_phone IS NOT NULL
  AND p.source_system = 'atlas_ui'
  AND NOT EXISTS (
      SELECT 1 FROM sot.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type = 'phone'
        AND pi.id_value_norm = p.primary_phone
  )
ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;

\echo '   Added email and phone identifiers'

-- ============================================================================
-- 3. ADD STAFF ROLES (if person_roles table exists)
-- ============================================================================

\echo ''
\echo '3. Adding staff roles...'

-- Only run if person_roles table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sot' AND table_name = 'person_roles'
    ) THEN
        -- FFSC Staff
        INSERT INTO sot.person_roles (person_id, role, role_status, source_system)
        SELECT p.person_id, 'staff', 'active', 'atlas_ui'
        FROM sot.people p
        WHERE p.primary_email LIKE '%@forgottenfelines.com'
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_roles pr
              WHERE pr.person_id = p.person_id AND pr.role = 'staff'
          )
        ON CONFLICT DO NOTHING;

        -- Trappers (Ben, Crystal)
        INSERT INTO sot.person_roles (person_id, role, role_status, source_system)
        SELECT p.person_id,
               CASE
                   WHEN p.display_name = 'Ben Mis' THEN 'coordinator'
                   ELSE 'ffsc_trapper'
               END,
               'active',
               'atlas_ui'
        FROM sot.people p
        WHERE p.display_name IN ('Ben Mis', 'Crystal Furtado')
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_roles pr
              WHERE pr.person_id = p.person_id
                AND pr.role IN ('coordinator', 'ffsc_trapper')
          )
        ON CONFLICT DO NOTHING;

        RAISE NOTICE 'Added staff roles';
    ELSE
        RAISE NOTICE 'Skipping roles - sot.person_roles table not found';
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Staff users created:'
SELECT
    display_name,
    primary_email,
    source_system
FROM sot.people
WHERE source_system = 'atlas_ui'
ORDER BY display_name;

\echo ''
\echo 'Staff identifiers:'
SELECT
    p.display_name,
    pi.id_type,
    pi.id_value_norm
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id
WHERE p.source_system = 'atlas_ui'
ORDER BY p.display_name, pi.id_type;

\echo ''
\echo '=============================================='
\echo '  MIG_2011 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created staff users:'
\echo '  - 14 FFSC core staff'
\echo '  - 3 FFSC field staff'
\echo '  - 6 Beacon engineering team'
\echo ''
\echo 'Added identifiers for all staff with email/phone'
\echo 'Added staff roles where applicable'
\echo ''
