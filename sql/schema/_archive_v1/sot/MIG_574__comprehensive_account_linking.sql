-- ============================================================================
-- MIG_574: Comprehensive Account Linking
-- ============================================================================
-- Links clinic_owner_accounts to existing places.
-- Key context:
--   - LMFM = Love Me Fix Me (Sonoma Humane waiver program) - REAL PEOPLE
--   - FFSC/SCAS suffix = who brought the cat, not what it is
--   - Apartment complexes should link to parent building places
-- ============================================================================

-- Step 1: Add converted_to_person to account_type constraint
ALTER TABLE trapper.clinic_owner_accounts
DROP CONSTRAINT IF EXISTS clinic_owner_accounts_account_type_check;

ALTER TABLE trapper.clinic_owner_accounts
ADD CONSTRAINT clinic_owner_accounts_account_type_check
CHECK (account_type IN (
  'address',
  'apartment_complex',
  'organization',
  'unknown',
  'converted_to_person'
));

-- Step 2: Deduplicate accounts (keep the one with more data)
WITH duplicates AS (
  SELECT
    lower(display_name) as lower_name,
    array_agg(account_id ORDER BY
      CASE WHEN linked_place_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN ai_researched_at IS NOT NULL THEN 0 ELSE 1 END,
      created_at
    ) as account_ids
  FROM trapper.clinic_owner_accounts
  GROUP BY lower(display_name)
  HAVING COUNT(*) > 1
),
to_delete AS (
  SELECT unnest(account_ids[2:]) as account_id
  FROM duplicates
)
DELETE FROM trapper.clinic_owner_accounts
WHERE account_id IN (SELECT account_id FROM to_delete);

-- Step 3: Link apartment complexes to existing places by fuzzy match
UPDATE trapper.clinic_owner_accounts coa
SET linked_place_id = (
  SELECT p.place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND (
      p.display_name ILIKE '%' || split_part(coa.display_name, ' ', 1) || '%'
      OR p.formatted_address ILIKE '%' || split_part(coa.display_name, ' ', 1) || '%'
    )
  LIMIT 1
),
    ai_research_notes = COALESCE(ai_research_notes || E'\n', '') || 'Linked to existing place by fuzzy match',
    updated_at = NOW()
WHERE coa.linked_place_id IS NULL
  AND coa.account_type IN ('apartment_complex', 'address')
  AND EXISTS (
    SELECT 1 FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND (
        p.display_name ILIKE '%' || split_part(coa.display_name, ' ', 1) || '%'
        OR p.formatted_address ILIKE '%' || split_part(coa.display_name, ' ', 1) || '%'
      )
  );

-- Step 4: Mark LMFM participants for conversion
UPDATE trapper.clinic_owner_accounts
SET ai_research_notes = COALESCE(ai_research_notes || E'\n', '') || 'LMFM participant - Love Me Fix Me program (Sonoma Humane)',
    needs_verification = true,
    updated_at = NOW()
WHERE display_name ILIKE 'lmfm %'
  AND account_type != 'converted_to_person';
