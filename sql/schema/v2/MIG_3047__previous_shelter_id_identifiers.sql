-- MIG_3047: Backfill previous_shelter_id identifiers from ShelterLuv PreviousIds
--
-- Context: When a cat moves between shelters, ShelterLuv preserves the prior
-- shelter's animal ID in payload->'PreviousIds'. SCAS (Sonoma County Animal
-- Services) uses IDs like "A439019". When FFSC sees these cats again at clinic,
-- the master list often references them by the SCAS ID (e.g., "SCAS A439019
-- (updates)"). Without these as queryable identifiers, CDS cannot bridge the
-- master list line to the existing cat record.
--
-- Discovery: ben@ffsc 2026-04-06 — Macy on 02/04 line 5 was logged as
-- "SCAS A439019 (updates)". Macy has shelterluv_animal_id 212902097 and her
-- ShelterLuv record has PreviousIds: [{IdValue: "A439019"}]. CDS had no way
-- to bridge "A439019" → Macy because the previous ID was buried in raw JSON.
--
-- Scope: 1446 cats with 1476 distinct previous shelter IDs. No collisions.

BEGIN;

-- Allow 'previous_shelter_id' as a valid id_type
ALTER TABLE sot.cat_identifiers
  DROP CONSTRAINT IF EXISTS cat_identifiers_id_type_check;

ALTER TABLE sot.cat_identifiers
  ADD CONSTRAINT cat_identifiers_id_type_check
  CHECK (id_type = ANY (ARRAY[
    'microchip'::text,
    'clinichq_animal_id'::text,
    'shelterluv_animal_id'::text,
    'airtable_id'::text,
    'petlink_id'::text,
    'previous_shelter_id'::text
  ]));

-- Backfill from shelterluv_raw.payload->'PreviousIds'
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, confidence)
SELECT DISTINCT
  ci.cat_id,
  'previous_shelter_id'::text AS id_type,
  prev->>'IdValue' AS id_value,
  'shelterluv'::text AS source_system,
  1.0 AS confidence
FROM source.shelterluv_raw r
JOIN sot.cat_identifiers ci
  ON ci.id_value = r.payload->>'Internal-ID'
  AND ci.id_type = 'shelterluv_animal_id'
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'PreviousIds', '[]'::jsonb)) prev
WHERE prev->>'IdValue' IS NOT NULL
  AND prev->>'IdValue' != ''
ON CONFLICT (id_type, id_value) DO NOTHING;

-- Verify the Macy case specifically
DO $$
DECLARE
  v_cat_id uuid;
BEGIN
  SELECT cat_id INTO v_cat_id
  FROM sot.cat_identifiers
  WHERE id_type = 'previous_shelter_id' AND id_value = 'A439019';

  IF v_cat_id IS NULL THEN
    RAISE WARNING 'Expected A439019 → Macy backfill missing';
  ELSE
    RAISE NOTICE 'Macy SCAS ID A439019 → cat_id %', v_cat_id;
  END IF;
END $$;

COMMIT;
