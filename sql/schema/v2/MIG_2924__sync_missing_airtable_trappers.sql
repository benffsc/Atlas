-- MIG_2924: Sync missing Airtable trappers into Atlas
--
-- Problem: ~13 people in Airtable trappers list have no trapper role in Atlas.
-- Some exist as people (via ClinicHQ), some don't exist at all.
--
-- Approach:
--   1. Create people who don't exist via data_engine_resolve_identity()
--   2. Add trapper role to all
--   3. Create trapper_profiles with appropriate type
--
-- Skipping: "Client Trapping" (placeholder), Patricia Dias (phone only)
--
-- Fixes FFS-472

BEGIN;

-- =========================================================================
-- Step 1: Create missing people via data_engine_resolve_identity
-- =========================================================================

-- Dr. Morgan Marchbanks (Community)
SELECT * FROM sot.data_engine_resolve_identity(
  'morgan.marchbanks@gmail.com', NULL, 'Morgan', 'Marchbanks', NULL, 'airtable'
);

-- Gina Ward (Community)
SELECT * FROM sot.data_engine_resolve_identity(
  'ginaward2000@gmail.com', NULL, 'Gina', 'Ward', NULL, 'airtable'
);

-- Natasha Reed (Community)
SELECT * FROM sot.data_engine_resolve_identity(
  'verylucky2b@msn.com', NULL, 'Natasha', 'Reed', NULL, 'airtable'
);

-- Peggy (Margaret) Carr — already exists (94214641) but confirm with cpegster@comcast.net
-- Note: existing email is pegster@mail.com, Airtable has cpegster@comcast.net
-- These may be different emails for same person — add identifier
INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system, confidence)
VALUES ('94214641-e54c-414b-9b6c-d82ef6e49f29', 'email', 'cpegster@comcast.net', 'cpegster@comcast.net', 'airtable', 0.9)
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

-- Joana Hurtado (Community+Approved — appears twice in AT, use community_trapper)
SELECT * FROM sot.data_engine_resolve_identity(
  'nira1010@gmail.com', NULL, 'Joana', 'Hurtado', NULL, 'airtable'
);

-- =========================================================================
-- Step 2: Add trapper roles for all people who need them
-- Uses email lookup to get person_id for newly created people
-- =========================================================================

-- Helper: add trapper role by email (handles both existing and new people)
DO $$
DECLARE
  v_person_id UUID;
  v_emails TEXT[] := ARRAY[
    'quicheandcarry10@gmail.com',  -- Deborah Moss (Approved → ffsc_volunteer)
    'morgan.marchbanks@gmail.com', -- Dr. Morgan Marchbanks (Community)
    'ginaward2000@gmail.com',      -- Gina Ward (Community)
    'verylucky2b@msn.com',         -- Natasha Reed (Community)
    'sherri4x4@mail.com',          -- Sherri Hildreth (Community)
    'katiehbr@gmail.com',          -- Katie Culpepper (Approved → ffsc_volunteer)
    'clcthatsme@gmail.com',        -- Chrystal Coleman (Inactive)
    'cpegster@comcast.net',        -- Peggy Carr (Inactive) — secondary email
    'arcatahackett@gmail.com',     -- Mary Hackett (Inactive)
    'nira1010@gmail.com'           -- Joana Hurtado (Community+Approved)
  ];
  v_email TEXT;
BEGIN
  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT pi.person_id INTO v_person_id
    FROM sot.person_identifiers pi
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = LOWER(v_email)
      AND pi.confidence >= 0.5
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
      -- Add trapper role if not exists
      INSERT INTO sot.person_roles (person_id, role, source_system)
      VALUES (v_person_id, 'trapper', 'airtable')
      ON CONFLICT DO NOTHING;

      RAISE NOTICE 'Added trapper role for % (person_id: %)', v_email, v_person_id;
    ELSE
      RAISE NOTICE 'WARNING: No person found for email %, skipping', v_email;
    END IF;
  END LOOP;
END $$;

-- Also handle Barb Gray (d9ff5bdd) and Peggy Carr by person_id
INSERT INTO sot.person_roles (person_id, role, source_system)
VALUES
  ('d9ff5bdd-13f3-45a1-a166-29f9f58bef3f', 'trapper', 'airtable'),  -- Barb Gray
  ('94214641-e54c-414b-9b6c-d82ef6e49f29', 'trapper', 'airtable')   -- Peggy Carr (primary person_id)
ON CONFLICT DO NOTHING;

-- =========================================================================
-- Step 3: Create trapper_profiles
-- =========================================================================

DO $$
DECLARE
  v_person_id UUID;
  v_rec RECORD;
  v_profiles RECORD;
BEGIN
  -- Community trappers (active)
  FOR v_rec IN
    SELECT unnest(ARRAY[
      'morgan.marchbanks@gmail.com',
      'ginaward2000@gmail.com',
      'verylucky2b@msn.com',
      'sherri4x4@mail.com',
      'nira1010@gmail.com'
    ]) AS email, 'community_trapper' AS trapper_type, true AS is_active
    UNION ALL
    -- Approved → ffsc_volunteer (if not in VH, treat as community_trapper)
    SELECT unnest(ARRAY[
      'quicheandcarry10@gmail.com',
      'katiehbr@gmail.com'
    ]) AS email, 'community_trapper' AS trapper_type, true AS is_active
    UNION ALL
    -- Inactive
    SELECT unnest(ARRAY[
      'clcthatsme@gmail.com',
      'arcatahackett@gmail.com'
    ]) AS email, 'community_trapper' AS trapper_type, false AS is_active
  LOOP
    SELECT pi.person_id INTO v_person_id
    FROM sot.person_identifiers pi
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = LOWER(v_rec.email)
      AND pi.confidence >= 0.5
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
      INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, has_signed_contract, source_system)
      VALUES (v_person_id, v_rec.trapper_type, v_rec.is_active, false, 'airtable')
      ON CONFLICT (person_id) DO UPDATE SET
        trapper_type = COALESCE(sot.trapper_profiles.trapper_type, EXCLUDED.trapper_type),
        is_active = EXCLUDED.is_active,
        updated_at = NOW();
    END IF;
  END LOOP;

  -- Barb Gray: VH Approved but "Refuses trapping assignments" → active=false
  INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, notes, source_system)
  VALUES (
    'd9ff5bdd-13f3-45a1-a166-29f9f58bef3f',
    'ffsc_volunteer', false,
    '[Airtable] Refuses trapping assignments',
    'airtable'
  )
  ON CONFLICT (person_id) DO UPDATE SET
    is_active = false,
    notes = '[Airtable] Refuses trapping assignments',
    updated_at = NOW();

  -- Peggy Carr: Inactive
  INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, source_system)
  VALUES ('94214641-e54c-414b-9b6c-d82ef6e49f29', 'community_trapper', false, 'airtable')
  ON CONFLICT (person_id) DO UPDATE SET
    is_active = false,
    updated_at = NOW();
END $$;

-- =========================================================================
-- Step 4: Verification
-- =========================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_total_roles INT;
  v_total_profiles INT;
BEGIN
  SELECT COUNT(*) INTO v_total_roles FROM sot.person_roles WHERE role = 'trapper';
  SELECT COUNT(*) INTO v_total_profiles FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '=== MIG_2924 Verification ===';
  RAISE NOTICE 'Total trapper roles: %', v_total_roles;
  RAISE NOTICE 'Total trapper profiles: %', v_total_profiles;
  RAISE NOTICE '';
  RAISE NOTICE 'Profile distribution:';
  FOR v_rec IN
    SELECT tp.trapper_type, tp.is_active, COUNT(*) as cnt
    FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
    GROUP BY tp.trapper_type, tp.is_active
    ORDER BY tp.trapper_type, tp.is_active DESC
  LOOP
    RAISE NOTICE '  %-20s active=%-5s  count=%', v_rec.trapper_type, v_rec.is_active, v_rec.cnt;
  END LOOP;
END $$;

COMMIT;
