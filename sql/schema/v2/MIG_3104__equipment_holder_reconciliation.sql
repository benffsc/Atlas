-- =============================================================================
-- MIG_3104: Equipment Holder Reconciliation
-- =============================================================================
-- Links checked-out equipment to sot.people by matching current_holder_name.
-- Categories: trapper (keep traps), public (call for return), internal (staff/foster).
--
-- Strategy:
-- 1. Exact name match → link directly
-- 2. Known aliases (Crystal = Crystal Furtado, Moria Z = Moria Zimbicki, etc.)
-- 3. Fuzzy match > 0.6 similarity with dedup (prefer person with phone/email)
-- 4. Classify each holder as trapper/public/internal for the call list
--
-- Safe: only sets current_custodian_id where it's currently NULL.
-- Does NOT overwrite any existing links.
-- =============================================================================

BEGIN;

-- Step 1: Manual alias mapping for known holders
-- Ben confirmed: "Crystal" variants = Crystal Furtado (ffsc_volunteer)
-- "Moria Z" / "Moria z" / "Moria Z." = Moria Zimbicki
-- "Cassie T" = Cassie Thomson
-- "Lepori" = Amy Lepori
-- "Leslie" = unknown (skip — too ambiguous)
-- "Katie Moore - Brigham" = Katie Moore
-- "Crystal - Van 12/16/25" / "Crystal - Over Weekend" = Crystal Furtado
-- "Crystal Furtado - Over Weekend" = Crystal Furtado
-- "Christel Stimpson/Linda Knox" → Linda Knox (she's the email holder)
-- "Jeannee Irvine - Trapper" = Jeannee Irvine
-- "Carol Watson Return" / "Sarah Fields Return" = Carol Watson / Sarah Fields (pending return)
-- "George (Marcy) Greeley" = Marcy Greeley
-- "Dana Clark" = Donna Clark (from the checkout slip — name was "Donna")
-- "Dave Charleston" = leave unlinked (Jo Charleston is a different person)
-- "Hemmin and Hauling" = Hemmin Hauling
-- "Nav Paramar" = Nav Parmar
-- "Lynetter Cromwell" = Lynnette Cromwell
-- "Travis Dicarlo" = Travis DeCarlo
-- "Jennifer Pratt" → Jennifer Platt (close but different — skip, not confident)
-- "Laura Schermeister" → skip (Laura Schnizler is different)
-- "Marilyn Campo" = Marilyn Martin del campo
-- "Foster Casey" / "Foster Jamie Barett" / "Foster Mcferren" / "Fosters: Gibbs" = internal/foster
-- "Cat Room" / "SN CLIENT MCKEE" / "Heidi" = internal

CREATE TEMP TABLE holder_aliases (
  holder_name TEXT PRIMARY KEY,
  resolved_person_id UUID,
  holder_category TEXT NOT NULL -- 'trapper', 'public', 'internal', 'pending_return'
);

-- Crystal Furtado variants
INSERT INTO holder_aliases VALUES ('Crystal', '1626f01c-cb89-4ac6-89ec-fb4587d7dc88', 'trapper');
INSERT INTO holder_aliases VALUES ('Crystal - Van 12/16/25', '1626f01c-cb89-4ac6-89ec-fb4587d7dc88', 'trapper');
INSERT INTO holder_aliases VALUES ('Crystal - Over Weekend', '1626f01c-cb89-4ac6-89ec-fb4587d7dc88', 'trapper');
INSERT INTO holder_aliases VALUES ('Crystal Furtado - Over Weekend', '1626f01c-cb89-4ac6-89ec-fb4587d7dc88', 'trapper');

-- Moria Zimbicki variants
INSERT INTO holder_aliases VALUES ('Moria Z', '978a7364-83f8-4799-a3b4-1b268862d6f5', 'public');
INSERT INTO holder_aliases VALUES ('Moria z', '978a7364-83f8-4799-a3b4-1b268862d6f5', 'public');
INSERT INTO holder_aliases VALUES ('Moria Z.', '978a7364-83f8-4799-a3b4-1b268862d6f5', 'public');

-- Abbreviated names
INSERT INTO holder_aliases VALUES ('Cassie T', 'a20b59e5-b2e2-41fc-aed4-4bac1de89959', 'trapper');
INSERT INTO holder_aliases VALUES ('Lepori', 'bbe3d891-2a30-4b5c-bd24-cc227439e16b', 'public');

-- Annotated names (strip suffix)
INSERT INTO holder_aliases VALUES ('Katie Moore - Brigham', 'b509f492-bc44-445e-b8b3-0e96ac9cfda7', 'trapper');
INSERT INTO holder_aliases VALUES ('Jeannee Irvine - Trapper', 'c5d9bb8f-33bd-43e4-a420-f77cc5a4527f', 'trapper');
INSERT INTO holder_aliases VALUES ('Carol Watson Return', '7f502533-4e15-43a8-abf7-1cd59af8080d', 'pending_return');
INSERT INTO holder_aliases VALUES ('Sarah Fields Return', '2cacc819-c60b-4172-b42b-c216ddfd1feb', 'pending_return');

-- Parenthetical / slash names
INSERT INTO holder_aliases VALUES ('George (Marcy) Greeley', '6ded405c-b7a2-4fea-8efa-3b34af5f3dad', 'public');
INSERT INTO holder_aliases VALUES ('Christel Stimpson/Linda Knox', '06400e7d-e249-498c-99b1-3f9efc19c18a', 'public');

-- Typos / misspellings
INSERT INTO holder_aliases VALUES ('Dana Clark', '29c03be8-53f9-41c1-abd1-88e9091a49b8', 'public');
INSERT INTO holder_aliases VALUES ('Hemmin and Hauling', '4a656a8b-891d-41c7-b4e6-b1a2505baad2', 'public');
INSERT INTO holder_aliases VALUES ('Nav Paramar', 'de4efc46-b5c0-4bca-93be-581cebd8a616', 'public');
INSERT INTO holder_aliases VALUES ('Lynetter Cromwell', '7d382528-af1d-4e77-91ac-d68ba4d8f450', 'public');
INSERT INTO holder_aliases VALUES ('Travis Dicarlo', '99e956e9-fbc8-4b1f-a58b-c60e1216cf90', 'public');
INSERT INTO holder_aliases VALUES ('Thea Torgerson', '311ec534-379d-41ab-8727-33216c691fa0', 'public');
INSERT INTO holder_aliases VALUES ('Marilyn Campo', '51c47083-d657-4ac9-b8eb-c4f3ca1d078e', 'public');
INSERT INTO holder_aliases VALUES ('Maria Olneras', NULL, 'internal'); -- unclear match

-- Internal / foster / non-person
INSERT INTO holder_aliases VALUES ('Cat Room', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Foster Casey', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Foster Jamie Barett', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Foster Mcferren', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Fosters: Gibbs', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Heidi', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('SN CLIENT MCKEE', NULL, 'internal');
INSERT INTO holder_aliases VALUES ('Jonas Bourland', 'f6eac3bb-24a3-4496-96a6-4fca8a55a67a', 'public');
INSERT INTO holder_aliases VALUES ('Spring Maxfield', NULL, 'public'); -- no person match in system, will be created via scan slip

-- Step 2: Link equipment to people
-- 2a: Link via manual aliases (highest confidence)
UPDATE ops.equipment e
SET current_custodian_id = ha.resolved_person_id
FROM holder_aliases ha
WHERE e.current_holder_name = ha.holder_name
  AND ha.resolved_person_id IS NOT NULL
  AND e.current_custodian_id IS NULL
  AND e.custody_status = 'checked_out'
  AND e.retired_at IS NULL;

-- 2b: Link via exact name match (for holders not in the alias table)
UPDATE ops.equipment e
SET current_custodian_id = matched.person_id
FROM (
  SELECT DISTINCT ON (e2.equipment_id)
    e2.equipment_id,
    p.person_id
  FROM ops.equipment e2
  JOIN sot.people p ON LOWER(TRIM(p.display_name)) = LOWER(TRIM(e2.current_holder_name))
    AND p.merged_into_person_id IS NULL
  LEFT JOIN holder_aliases ha ON e2.current_holder_name = ha.holder_name
  WHERE e2.custody_status = 'checked_out'
    AND e2.retired_at IS NULL
    AND e2.current_custodian_id IS NULL
    AND ha.holder_name IS NULL  -- not already handled by alias
  -- Prefer person with identifiers (phone/email)
  ORDER BY e2.equipment_id,
    (SELECT COUNT(*) FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5) DESC,
    p.created_at ASC
) matched
WHERE e.equipment_id = matched.equipment_id
  AND e.current_custodian_id IS NULL;

-- Step 3: Report what we linked
DO $$
DECLARE
  linked_count INT;
  still_unlinked INT;
BEGIN
  SELECT COUNT(*) INTO linked_count
  FROM ops.equipment
  WHERE custody_status = 'checked_out' AND retired_at IS NULL AND current_custodian_id IS NOT NULL;

  SELECT COUNT(*) INTO still_unlinked
  FROM ops.equipment
  WHERE custody_status = 'checked_out' AND retired_at IS NULL AND current_custodian_id IS NULL;

  RAISE NOTICE 'Equipment holder reconciliation complete: % linked, % still unlinked', linked_count, still_unlinked;
END $$;

COMMIT;
