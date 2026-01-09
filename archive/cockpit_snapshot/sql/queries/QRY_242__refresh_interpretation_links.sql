-- QRY_242__refresh_interpretation_links.sql
-- UI_242: Deterministic refresh of person_source_link and link candidate views
--
-- This script recomputes:
-- 1. Person source links (provenance mapping)
-- 2. Link candidate views (already materialized by underlying views)
--
-- Safe to run multiple times. Does not modify manual links or confirmed merges.
-- Run after any data ingest to update linking suggestions.
--
-- Usage:
--   psql $DATABASE_URL -f sql/queries/QRY_242__refresh_interpretation_links.sql

-- ============================================================
-- REFRESH 1: Update person_key for any people missing it
-- ============================================================
WITH computed_keys AS (
  SELECT
    p.id,
    COALESCE(
      LOWER(TRIM(p.email)),
      CASE WHEN LENGTH(REGEXP_REPLACE(p.phone, '[^0-9]', '', 'g')) >= 10
           THEN REGEXP_REPLACE(p.phone, '[^0-9]', '', 'g')
           ELSE NULL
      END,
      LOWER(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')))
        || ':' || COALESCE(
          (SELECT a.postal_code FROM trapper.addresses a
           JOIN trapper.requests r ON r.address_id = a.id
           WHERE r.person_id = p.id LIMIT 1),
          ''
        )
    ) AS computed_person_key
  FROM trapper.people p
  WHERE p.person_key IS NULL
)
UPDATE trapper.people p
SET person_key = ck.computed_person_key,
    updated_at = NOW()
FROM computed_keys ck
WHERE p.id = ck.id
  AND ck.computed_person_key IS NOT NULL;

-- Report updated
DO $$
DECLARE
  updated_count INT;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % people with computed person_key', updated_count;
END $$;

-- ============================================================
-- REFRESH 2: Auto-link high-confidence sources (email match)
-- ============================================================
-- Only creates links where:
-- - Source record has valid email
-- - Canonical person has matching email
-- - Link does not already exist
-- - Confidence >= 0.9 (email match)
INSERT INTO trapper.person_source_link (
  person_id,
  source_system,
  source_pk,
  confidence,
  matched_on,
  created_at
)
SELECT DISTINCT ON (oc.id)
  p.id AS person_id,
  'clinichq' AS source_system,
  oc.id::text AS source_pk,
  0.95 AS confidence,
  ARRAY['email']::text[] AS matched_on,
  NOW() AS created_at
FROM trapper.v_clinichq_owners_classified oc
JOIN trapper.people p ON LOWER(TRIM(p.email)) = oc.email_normalized
WHERE oc.email_normalized IS NOT NULL
  AND oc.owner_kind = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq'
      AND psl.source_pk = oc.id::text
  )
ORDER BY oc.id, p.created_at
ON CONFLICT (source_system, source_pk) DO NOTHING;

-- Report created
DO $$
DECLARE
  created_count INT;
BEGIN
  GET DIAGNOSTICS created_count = ROW_COUNT;
  RAISE NOTICE 'Created % new email-based person_source_links', created_count;
END $$;

-- ============================================================
-- REFRESH 3: Auto-link high-confidence sources (phone match)
-- ============================================================
INSERT INTO trapper.person_source_link (
  person_id,
  source_system,
  source_pk,
  confidence,
  matched_on,
  created_at
)
SELECT DISTINCT ON (oc.id)
  p.id AS person_id,
  'clinichq' AS source_system,
  oc.id::text AS source_pk,
  0.90 AS confidence,
  ARRAY['phone']::text[] AS matched_on,
  NOW() AS created_at
FROM trapper.v_clinichq_owners_classified oc
JOIN trapper.people p ON p.phone_normalized = oc.phone_clean
WHERE oc.phone_clean IS NOT NULL
  AND LENGTH(oc.phone_clean) >= 10
  AND oc.owner_kind = 'person'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq'
      AND psl.source_pk = oc.id::text
  )
ORDER BY oc.id, p.created_at
ON CONFLICT (source_system, source_pk) DO NOTHING;

-- Report created
DO $$
DECLARE
  created_count INT;
BEGIN
  GET DIAGNOSTICS created_count = ROW_COUNT;
  RAISE NOTICE 'Created % new phone-based person_source_links', created_count;
END $$;

-- ============================================================
-- SUMMARY REPORT
-- ============================================================
SELECT
  'person_source_link' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE confidence >= 0.9) AS high_confidence,
  COUNT(*) FILTER (WHERE confidence >= 0.7 AND confidence < 0.9) AS medium_confidence,
  COUNT(*) FILTER (WHERE confidence < 0.7) AS low_confidence
FROM trapper.person_source_link;

SELECT
  'people' AS table_name,
  COUNT(*) AS total_people,
  COUNT(*) FILTER (WHERE person_key IS NOT NULL) AS with_person_key,
  COUNT(*) FILTER (WHERE email IS NOT NULL) AS with_email,
  COUNT(*) FILTER (WHERE phone IS NOT NULL) AS with_phone
FROM trapper.people;

-- Linking coverage
SELECT
  'linking_coverage' AS report,
  COUNT(DISTINCT psl.person_id) AS linked_people,
  (SELECT COUNT(*) FROM trapper.people) AS total_people,
  ROUND(COUNT(DISTINCT psl.person_id)::numeric * 100.0 / NULLIF((SELECT COUNT(*) FROM trapper.people), 0), 1) AS pct_linked
FROM trapper.person_source_link psl;

-- Done
SELECT 'QRY_242 refresh complete' AS status, NOW() AS completed_at;
