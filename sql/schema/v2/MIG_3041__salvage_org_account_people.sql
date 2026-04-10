-- MIG_3041: Salvage Real People from Org-Classified Clinic Accounts
-- Date: 2026-04-03
--
-- Three-tier re-resolution of unresolved org/site_name clinic accounts that
-- have real person identifiers (email/phone) but resolved_person_id = NULL.
--
-- Tier 0: Direct identifier match to existing sot.people (~394 accounts, zero risk)
--   0a: Email match against person_identifiers
--   0b: Phone match with address proximity check (MIG_2548/2560 invariant)
--
-- Tier 2: Notes-based name extraction + find_or_create_person (~200 accounts)
--   Extract caretaker/contact names from quick_notes/long_notes via regex
--   Pass extracted name (NOT org name) through should_be_person gate
--
-- Tier 1: Email prefix derivation + find_or_create_person (~100 accounts)
--   Parse first.last@domain → "First Last" → find_or_create_person
--   Lowest confidence tier, most conservative guards
--
-- Key invariant: account_type stays 'organization'/'site_name' (unchanged).
-- Only resolved_person_id is set. The org account preserves its identity.
--
-- Unresolved accounts are logged for Tier 3 (Claude Batch API, FFS-1097).
--
-- Related: DATA_GAP_065, DATA_GAP_066, MIG_3039

\echo ''
\echo '=============================================='
\echo '  MIG_3041: Salvage Real People from Org-Classified Clinic Accounts'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- STEP 0: Expand person_place evidence_type CHECK constraint
-- ============================================================================

\echo '0. Expanding person_place evidence_type CHECK...'

DO $$
BEGIN
  ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_evidence_type_check;
  ALTER TABLE sot.person_place ADD CONSTRAINT person_place_evidence_type_check
    CHECK (evidence_type = ANY (ARRAY[
      'manual', 'inferred', 'imported', 'appointment',
      'owner_address', 'person_relationship', 'request_report',
      'org_account_salvage'
    ]));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update evidence_type CHECK: %', SQLERRM;
END;
$$;

-- ============================================================================
-- STEP 1: Build working table of all unresolved org/site_name accounts
-- ============================================================================

\echo '1. Building working table of unresolved org/site_name accounts...'

DROP TABLE IF EXISTS _mig3041_targets;

CREATE TEMP TABLE _mig3041_targets AS
SELECT
  ca.account_id,
  ca.owner_email,
  ca.owner_phone,
  ca.owner_address,
  ca.owner_first_name,
  ca.owner_last_name,
  ca.display_name,
  ca.account_type,
  ca.quick_notes,
  ca.long_notes,
  -- Is email blacklisted?
  EXISTS (
    SELECT 1 FROM sot.soft_blacklist sb
    WHERE sb.identifier_type = 'email'
      AND sb.identifier_norm = LOWER(TRIM(ca.owner_email))
      AND sb.require_name_similarity >= 0.9
  ) AS email_blacklisted,
  -- Is phone blacklisted?
  EXISTS (
    SELECT 1 FROM sot.soft_blacklist sb
    WHERE sb.identifier_type = 'phone'
      AND sb.identifier_norm = sot.norm_phone_us(ca.owner_phone)
  ) AS phone_blacklisted,
  -- Most common appointment place for this account
  (
    SELECT a.inferred_place_id
    FROM ops.appointments a
    WHERE a.owner_account_id = ca.account_id
      AND a.inferred_place_id IS NOT NULL
    GROUP BY a.inferred_place_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ) AS primary_place_id,
  -- Resolution tracking (filled in by subsequent steps)
  NULL::UUID AS resolved_person_id,
  NULL::TEXT AS resolution_tier,
  NULL::TEXT AS resolution_detail
FROM ops.clinic_accounts ca
WHERE ca.account_type IN ('organization', 'site_name')
  AND ca.merged_into_account_id IS NULL
  AND ca.resolved_person_id IS NULL;

CREATE INDEX ON _mig3041_targets (account_id);

\echo '   Target summary:'
SELECT
  COUNT(*) AS total_targets,
  COUNT(*) FILTER (WHERE owner_email IS NOT NULL AND NOT email_blacklisted) AS usable_email,
  COUNT(*) FILTER (WHERE owner_phone IS NOT NULL AND NOT phone_blacklisted) AS usable_phone,
  COUNT(*) FILTER (WHERE quick_notes IS NOT NULL OR long_notes IS NOT NULL) AS has_notes,
  COUNT(*) FILTER (WHERE primary_place_id IS NOT NULL) AS has_place
FROM _mig3041_targets;

-- ============================================================================
-- STEP 2: TIER 0a — Email identifier match (highest confidence)
-- ============================================================================

\echo ''
\echo '2. Tier 0a: Matching by email to existing people...'

UPDATE _mig3041_targets t
SET resolved_person_id = pi.person_id,
    resolution_tier = 'tier_0_email',
    resolution_detail = 'Email ' || t.owner_email || ' → person ' || pi.person_id
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id
  AND p.merged_into_person_id IS NULL
  AND COALESCE(p.is_organization, FALSE) = FALSE
WHERE pi.id_type = 'email'
  AND pi.id_value_norm = LOWER(TRIM(t.owner_email))
  AND pi.confidence >= 0.5
  AND t.owner_email IS NOT NULL
  AND NOT t.email_blacklisted
  AND t.resolved_person_id IS NULL;

SELECT COUNT(*) AS tier_0a_email_resolved
FROM _mig3041_targets WHERE resolution_tier = 'tier_0_email';

-- ============================================================================
-- STEP 3: TIER 0b — Phone identifier match (with address proximity guard)
-- ============================================================================

\echo '3. Tier 0b: Matching by phone with address proximity check...'

-- Phone matching per MIG_2548/2560: same phone + same place = OK
-- Use appointment inferred_place_id as the address proxy
UPDATE _mig3041_targets t
SET resolved_person_id = match.person_id,
    resolution_tier = 'tier_0_phone',
    resolution_detail = 'Phone ' || t.owner_phone || ' → person ' || match.person_id || ' (place confirmed)'
FROM (
  SELECT DISTINCT ON (t2.account_id)
    t2.account_id,
    pi.person_id
  FROM _mig3041_targets t2
  JOIN sot.person_identifiers pi ON pi.id_type = 'phone'
    AND pi.id_value_norm = sot.norm_phone_us(t2.owner_phone)
    AND pi.confidence >= 0.5
  JOIN sot.people p ON p.person_id = pi.person_id
    AND p.merged_into_person_id IS NULL
    AND COALESCE(p.is_organization, FALSE) = FALSE
  WHERE t2.owner_phone IS NOT NULL
    AND NOT t2.phone_blacklisted
    AND t2.resolved_person_id IS NULL
    AND t2.primary_place_id IS NOT NULL
    -- Address proximity: person must already be linked to the same place
    AND EXISTS (
      SELECT 1 FROM sot.person_place pp
      WHERE pp.person_id = pi.person_id
        AND pp.place_id = t2.primary_place_id
    )
  ORDER BY t2.account_id, pi.confidence DESC
) match
WHERE t.account_id = match.account_id
  AND t.resolved_person_id IS NULL;

SELECT COUNT(*) AS tier_0b_phone_resolved
FROM _mig3041_targets WHERE resolution_tier = 'tier_0_phone';

-- ============================================================================
-- STEP 4: TIER 2 — Notes-based name extraction + find_or_create_person
-- ============================================================================

\echo ''
\echo '4. Tier 2: Extracting person names from notes...'

DROP TABLE IF EXISTS _mig3041_notes_names;

CREATE TEMP TABLE _mig3041_notes_names AS
WITH note_text AS (
  SELECT
    t.account_id,
    t.owner_email,
    t.owner_phone,
    t.owner_address,
    COALESCE(t.quick_notes, '') || ' ' || COALESCE(t.long_notes, '') AS all_notes
  FROM _mig3041_targets t
  WHERE t.resolved_person_id IS NULL
    AND (t.quick_notes IS NOT NULL OR t.long_notes IS NOT NULL)
),
extracted AS (
  SELECT
    nt.account_id,
    nt.owner_email,
    nt.owner_phone,
    nt.owner_address,
    COALESCE(
      -- Pattern 1: "Contact is Eileen Dabbs", "Caretaker: Efrain Guzman"
      (regexp_match(nt.all_notes,
        '(?:contact|caretaker|trapper|feeder|owner|manager)\s+(?:is|:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'))[1],
      -- Pattern 2: "Donna Nelson is the contact", "Scott Wilson is transport"
      (regexp_match(nt.all_notes,
        '([A-Z][a-z]+\s+[A-Z][a-z]+)\s+is\s+(?:the\s+)?(?:contact|trapper|caretaker|feeder|owner|manager|transport)'))[1],
      -- Pattern 3: "Keri Fennell is my contact at..."
      (regexp_match(nt.all_notes,
        '([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+my\s+contact'))[1]
    ) AS extracted_name
  FROM note_text nt
)
SELECT
  e.account_id,
  e.owner_email,
  e.owner_phone,
  e.owner_address,
  e.extracted_name,
  SPLIT_PART(e.extracted_name, ' ', 1) AS first_name,
  CASE
    WHEN POSITION(' ' IN e.extracted_name) > 0
    THEN SUBSTRING(e.extracted_name FROM POSITION(' ' IN e.extracted_name) + 1)
    ELSE NULL
  END AS last_name
FROM extracted e
WHERE e.extracted_name IS NOT NULL
  -- Validate: extracted name must classify as a real person
  AND sot.classify_owner_name(e.extracted_name) = 'likely_person';

SELECT COUNT(*) AS names_extracted_from_notes FROM _mig3041_notes_names;

-- Resolve extracted names via find_or_create_person
-- The extracted name (e.g., "Donna Nelson") passes through should_be_person gate
-- because it IS a real person name, not the org name
DROP TABLE IF EXISTS _mig3041_tier2_resolved;

CREATE TEMP TABLE _mig3041_tier2_resolved AS
SELECT
  nn.account_id,
  nn.extracted_name,
  sot.find_or_create_person(
    nn.owner_email,
    nn.owner_phone,
    nn.first_name,
    nn.last_name,
    nn.owner_address,
    'clinichq'
  ) AS person_id
FROM _mig3041_notes_names nn
JOIN _mig3041_targets t ON t.account_id = nn.account_id
  AND t.resolved_person_id IS NULL;

-- Apply Tier 2 resolutions
UPDATE _mig3041_targets t
SET resolved_person_id = r.person_id,
    resolution_tier = 'tier_2_notes',
    resolution_detail = 'Extracted "' || r.extracted_name || '" from notes'
FROM _mig3041_tier2_resolved r
WHERE t.account_id = r.account_id
  AND r.person_id IS NOT NULL
  AND t.resolved_person_id IS NULL;

SELECT COUNT(*) AS tier_2_notes_resolved
FROM _mig3041_targets WHERE resolution_tier = 'tier_2_notes';

-- ============================================================================
-- STEP 5: TIER 1 — Email prefix derivation + find_or_create_person
-- ============================================================================

\echo ''
\echo '5. Tier 1: Deriving names from email prefixes...'

DROP TABLE IF EXISTS _mig3041_email_names;

-- Only handle clean first.last@domain.com patterns
CREATE TEMP TABLE _mig3041_email_names AS
WITH email_parts AS (
  SELECT
    t.account_id,
    t.owner_email,
    t.owner_phone,
    t.owner_address,
    (regexp_match(LOWER(t.owner_email), '^([a-z]+)\.([a-z]+)@'))[1] AS raw_first,
    (regexp_match(LOWER(t.owner_email), '^([a-z]+)\.([a-z]+)@'))[2] AS raw_last
  FROM _mig3041_targets t
  WHERE t.resolved_person_id IS NULL
    AND t.owner_email IS NOT NULL
    AND NOT t.email_blacklisted
    -- Only first.last@ pattern (strict)
    AND t.owner_email ~* '^[a-z]+\.[a-z]+@'
)
SELECT
  ep.account_id,
  ep.owner_email,
  ep.owner_phone,
  ep.owner_address,
  INITCAP(ep.raw_first) AS first_name,
  INITCAP(ep.raw_last) AS last_name,
  INITCAP(ep.raw_first) || ' ' || INITCAP(ep.raw_last) AS derived_name
FROM email_parts ep
WHERE ep.raw_first IS NOT NULL
  AND ep.raw_last IS NOT NULL
  -- Minimum name length guards
  AND LENGTH(ep.raw_first) >= 2
  AND LENGTH(ep.raw_last) >= 2
  -- Validate: derived name must classify as a real person
  AND sot.classify_owner_name(INITCAP(ep.raw_first) || ' ' || INITCAP(ep.raw_last)) = 'likely_person';

SELECT COUNT(*) AS names_derived_from_email FROM _mig3041_email_names;

-- Resolve derived names via find_or_create_person
DROP TABLE IF EXISTS _mig3041_tier1_resolved;

CREATE TEMP TABLE _mig3041_tier1_resolved AS
SELECT
  en.account_id,
  en.derived_name,
  en.owner_email,
  sot.find_or_create_person(
    en.owner_email,
    en.owner_phone,
    en.first_name,
    en.last_name,
    en.owner_address,
    'clinichq'
  ) AS person_id
FROM _mig3041_email_names en
JOIN _mig3041_targets t ON t.account_id = en.account_id
  AND t.resolved_person_id IS NULL;

-- Apply Tier 1 resolutions
UPDATE _mig3041_targets t
SET resolved_person_id = r.person_id,
    resolution_tier = 'tier_1_email',
    resolution_detail = 'Derived "' || r.derived_name || '" from ' || r.owner_email
FROM _mig3041_tier1_resolved r
WHERE t.account_id = r.account_id
  AND r.person_id IS NOT NULL
  AND t.resolved_person_id IS NULL;

SELECT COUNT(*) AS tier_1_email_resolved
FROM _mig3041_targets WHERE resolution_tier = 'tier_1_email';

-- ============================================================================
-- STEP 6: Apply all resolutions to ops.clinic_accounts
-- ============================================================================

\echo ''
\echo '6. Applying resolutions to ops.clinic_accounts...'

UPDATE ops.clinic_accounts ca
SET resolved_person_id = t.resolved_person_id,
    resolved_at = NOW(),
    resolved_by = 'MIG_3041_' || t.resolution_tier,
    updated_at = NOW()
FROM _mig3041_targets t
WHERE ca.account_id = t.account_id
  AND t.resolved_person_id IS NOT NULL;

\echo '   Resolution summary by tier:'
SELECT
  resolution_tier,
  COUNT(*) AS accounts_resolved
FROM _mig3041_targets
WHERE resolved_person_id IS NOT NULL
GROUP BY resolution_tier
ORDER BY resolution_tier;

-- ============================================================================
-- STEP 7: Create person→place links for resolved accounts
-- ============================================================================

\echo ''
\echo '7. Creating person→place links (site_contact) for resolved accounts...'

INSERT INTO sot.person_place (
  person_id, place_id, relationship_type, evidence_type,
  confidence, source_system, source_table
)
SELECT DISTINCT
  t.resolved_person_id,
  t.primary_place_id,
  'site_contact',
  'org_account_salvage',
  0.75,
  'clinichq',
  'MIG_3041'
FROM _mig3041_targets t
WHERE t.resolved_person_id IS NOT NULL
  AND t.primary_place_id IS NOT NULL
ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

SELECT COUNT(*) AS person_place_links_created
FROM sot.person_place WHERE source_table = 'MIG_3041';

-- ============================================================================
-- STEP 8: Backfill appointment person_id where currently NULL
-- ============================================================================

\echo '8. Backfilling appointment person_id for resolved org accounts...'

DO $$
DECLARE
  v_count INT;
BEGIN
  WITH resolved_accounts AS (
    SELECT account_id, resolved_person_id
    FROM _mig3041_targets
    WHERE resolved_person_id IS NOT NULL
  )
  UPDATE ops.appointments a
  SET person_id = ra.resolved_person_id
  FROM resolved_accounts ra
  WHERE a.owner_account_id = ra.account_id
    AND a.person_id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Appointments linked to people: %', v_count;
END;
$$;

-- ============================================================================
-- STEP 9: Audit trail — log all resolutions to entity_edits
-- ============================================================================

\echo '9. Logging resolutions to ops.entity_edits...'

INSERT INTO ops.entity_edits (
  entity_type, entity_id, field_name,
  old_value, new_value,
  changed_by, change_source
)
SELECT
  'clinic_account',
  t.account_id,
  'resolved_person_id',
  NULL,
  t.resolved_person_id::TEXT,
  NULL,  -- NULL for migration edits (changed_by is UUID type)
  'MIG_3041_' || t.resolution_tier
FROM _mig3041_targets t
WHERE t.resolved_person_id IS NOT NULL;

-- ============================================================================
-- STEP 10: Log unresolved accounts for Tier 3 (Claude Batch API)
-- ============================================================================

\echo '10. Logging unresolved accounts for Tier 3 backlog...'

INSERT INTO ops.entity_linking_skipped (
  entity_type, entity_id, reason
)
SELECT
  'clinic_account',
  t.account_id,
  CASE
    WHEN t.owner_email IS NULL AND t.owner_phone IS NULL
      THEN 'no_identifiers'
    WHEN t.email_blacklisted AND (t.owner_phone IS NULL OR t.phone_blacklisted)
      THEN 'identifiers_blacklisted'
    WHEN t.quick_notes IS NULL AND t.long_notes IS NULL AND t.owner_email IS NULL
      THEN 'no_notes_no_email'
    ELSE 'unresolved_needs_tier_3'
  END
FROM _mig3041_targets t
WHERE t.resolved_person_id IS NULL
ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM _mig3041_targets WHERE resolved_person_id IS NULL;
  RAISE NOTICE '   Accounts logged for Tier 3: %', v_count;
END;
$$;

-- ============================================================================
-- CLEANUP temp tables
-- ============================================================================

DROP TABLE IF EXISTS _mig3041_tier1_resolved;
DROP TABLE IF EXISTS _mig3041_tier2_resolved;
DROP TABLE IF EXISTS _mig3041_email_names;
DROP TABLE IF EXISTS _mig3041_notes_names;
DROP TABLE IF EXISTS _mig3041_targets;

COMMIT;

-- ============================================================================
-- VERIFICATION (post-commit)
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

-- 1. Resolution counts by tier
\echo '1. Resolution counts by tier:'
SELECT
  CASE
    WHEN ee.change_source LIKE '%tier_0_email%' THEN 'Tier 0a (email match)'
    WHEN ee.change_source LIKE '%tier_0_phone%' THEN 'Tier 0b (phone match)'
    WHEN ee.change_source LIKE '%tier_2%'       THEN 'Tier 2  (notes extraction)'
    WHEN ee.change_source LIKE '%tier_1%'       THEN 'Tier 1  (email derivation)'
    ELSE ee.change_source
  END AS resolution_tier,
  COUNT(*) AS accounts_resolved
FROM ops.entity_edits ee
WHERE ee.change_source LIKE 'MIG_3041%'
  AND ee.field_name = 'resolved_person_id'
GROUP BY 1
ORDER BY 1;

-- 2. Person→place links created
\echo ''
\echo '2. Person→place links created:'
SELECT COUNT(*) AS org_salvage_links
FROM sot.person_place
WHERE evidence_type = 'org_account_salvage';

-- 3. Remaining unresolved
\echo ''
\echo '3. Remaining unresolved org/site_name accounts:'
SELECT account_type, COUNT(*) AS remaining
FROM ops.clinic_accounts
WHERE account_type IN ('organization', 'site_name')
  AND merged_into_account_id IS NULL
  AND resolved_person_id IS NULL
GROUP BY account_type
ORDER BY account_type;

-- 4. Spot-check: Speedy Creek Winery → expected contact person
\echo ''
\echo '4. Spot-check: Speedy Creek Winery'
SELECT ca.display_name AS org_account, p.display_name AS resolved_to,
       ee.change_source AS resolution_method
FROM ops.clinic_accounts ca
LEFT JOIN sot.people p ON p.person_id = ca.resolved_person_id
LEFT JOIN ops.entity_edits ee ON ee.entity_id = ca.account_id
  AND ee.change_source LIKE 'MIG_3041%'
WHERE ca.display_name ILIKE '%speedy%creek%';

-- 5. Spot-check: Aamco → expected Eileen/Chris Dabbs
\echo ''
\echo '5. Spot-check: Aamco'
SELECT ca.display_name AS org_account, p.display_name AS resolved_to,
       ee.change_source AS resolution_method
FROM ops.clinic_accounts ca
LEFT JOIN sot.people p ON p.person_id = ca.resolved_person_id
LEFT JOIN ops.entity_edits ee ON ee.entity_id = ca.account_id
  AND ee.change_source LIKE 'MIG_3041%'
WHERE ca.display_name ILIKE '%aamco%';

-- 6. Tier 3 backlog breakdown
\echo ''
\echo '6. Tier 3 backlog (unresolved reasons):'
SELECT reason, COUNT(*) AS accounts
FROM ops.entity_linking_skipped
WHERE entity_type = 'clinic_account'
GROUP BY reason
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_3041 Complete!'
\echo '=============================================='
\echo ''
