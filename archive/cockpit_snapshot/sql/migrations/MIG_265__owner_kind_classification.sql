-- MIG_265__owner_kind_classification.sql
-- REL_013: Entity classification for ClinicHQ owners + linking suggestions
--
-- SAFETY: This migration uses ONLY additive operations:
--   - CREATE OR REPLACE FUNCTION
--   - CREATE OR REPLACE VIEW
--   - ALTER TABLE ADD COLUMN
--
-- NO DROP, NO TRUNCATE, NO DELETE.
--
-- Purpose:
--   - Add owner_kind classification function
--   - Add person_key / place_key computation
--   - Create linking_suggestions view for appt->request candidates
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_265__owner_kind_classification.sql

BEGIN;

-- ============================================================
-- PART A: Normalization Functions
-- ============================================================

-- A1) clean_email: normalize and validate email
CREATE OR REPLACE FUNCTION trapper.clean_email(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(raw))
  WHERE raw IS NOT NULL
    AND raw LIKE '%@%'
    AND LENGTH(raw) >= 5
    AND LOWER(TRIM(raw)) NOT IN ('n/a', 'none', 'test', 'na', '-', 'unknown', 'no email', 'noemail', 'none@none.com');
$$;

COMMENT ON FUNCTION trapper.clean_email(text) IS
'Normalizes and validates email. Returns NULL for invalid/placeholder emails.';

-- A2) clean_phone: normalize to digits-only, validate 10+ digits
CREATE OR REPLACE FUNCTION trapper.clean_phone(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT REGEXP_REPLACE(raw, '[^0-9]', '', 'g')
  WHERE raw IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(raw, '[^0-9]', '', 'g')) >= 10
    AND REGEXP_REPLACE(raw, '[^0-9]', '', 'g') !~ '^(0000|1111|1234|5555)';
$$;

COMMENT ON FUNCTION trapper.clean_phone(text) IS
'Normalizes phone to digits-only. Returns NULL for invalid/fake patterns.';

-- A3) name_norm: normalize name for comparison
CREATE OR REPLACE FUNCTION trapper.name_norm(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(COALESCE(raw, ''), '[^\w\s]', '', 'g'),
    '\s+', ' ', 'g'
  )))
  WHERE raw IS NOT NULL AND LENGTH(TRIM(raw)) > 0;
$$;

COMMENT ON FUNCTION trapper.name_norm(text) IS
'Normalizes name for comparison: lowercase, no punctuation, collapsed whitespace.';

-- ============================================================
-- PART B: Owner Kind Classification Function
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.classify_owner_kind(
  owner_name text,
  owner_email text,
  owner_phone text,
  owner_address text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- JUNK: empty/placeholder name with no valid contact
    WHEN (
      trapper.name_norm(owner_name) IS NULL
      OR trapper.name_norm(owner_name) IN ('unknown', 'n/a', 'none', 'test', '-', '???', 'no name', 'no owner')
    )
    AND trapper.clean_email(owner_email) IS NULL
    AND trapper.clean_phone(owner_phone) IS NULL
    THEN 'junk'

    -- PLACE: contains org/site tokens
    WHEN LOWER(COALESCE(owner_name, '')) ~
      '(mhp|mobile home|park|apartments?|apt|llc|inc|corp|corporation|hoa|church|school|shelter|rescue|clinic|hospital|veterinary|vet clinic|humane|foundation|society|agency|center|centre|association|county|city of|district)'
    THEN 'place'

    -- PLACE: has "&" with likely business pattern
    WHEN owner_name ~ '&' AND LOWER(owner_name) ~ '(llc|inc|corp|hoa|association)'
    THEN 'place'

    -- PLACE: ALL-CAPS multiword (3+ words, likely business)
    WHEN owner_name ~ '^[A-Z\s]+$'
      AND ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(owner_name), ' '), 1) >= 3
      AND NOT LOWER(owner_name) ~ '^[a-z]+ [a-z]+$'  -- exclude "JOHN SMITH" pattern
    THEN 'place'

    -- PERSON: looks like a name with contact info
    WHEN (
      -- 2-4 tokens
      ARRAY_LENGTH(STRING_TO_ARRAY(TRIM(COALESCE(owner_name, '')), ' '), 1) BETWEEN 2 AND 4
      -- Not an org
      AND LOWER(COALESCE(owner_name, '')) !~
        '(mhp|mobile home|park|apartments?|apt|llc|inc|corp|hoa|church|school|shelter|rescue|clinic|hospital)'
    )
    AND (
      -- Has valid email, phone, or residential address
      trapper.clean_email(owner_email) IS NOT NULL
      OR trapper.clean_phone(owner_phone) IS NOT NULL
      OR owner_address ~ '^\d+\s'  -- Starts with number (likely street address)
    )
    THEN 'person'

    -- UNKNOWN: needs manual review
    ELSE 'unknown'
  END;
$$;

COMMENT ON FUNCTION trapper.classify_owner_kind(text, text, text, text) IS
'Classifies ClinicHQ owner as person/place/junk/unknown. REL_013 interpretation contract.';

-- ============================================================
-- PART C: Person Key Computation
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.compute_person_key(
  owner_email text,
  owner_phone text,
  owner_name text,
  owner_zip text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    -- Priority 1: email
    'email:' || trapper.clean_email(owner_email),
    -- Priority 2: phone
    'phone:' || trapper.clean_phone(owner_phone),
    -- Priority 3: name+zip (for suggestions only, lower confidence)
    CASE WHEN trapper.name_norm(owner_name) IS NOT NULL AND owner_zip IS NOT NULL
      THEN 'name_zip:' || trapper.name_norm(owner_name) || ':' || LEFT(owner_zip, 5)
      ELSE NULL
    END
  );
$$;

COMMENT ON FUNCTION trapper.compute_person_key(text, text, text, text) IS
'Computes identity key for person deduplication. Priority: email > phone > name+zip.';

-- ============================================================
-- PART D: View - ClinicHQ Owners with Classification
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_clinichq_owners_classified AS
SELECT
  ho.id,
  ho.owner_first_name,
  ho.owner_last_name,
  COALESCE(ho.owner_first_name, '') || ' ' || COALESCE(ho.owner_last_name, '') AS owner_full_name,
  ho.owner_email,
  ho.owner_phone,
  ho.owner_cell_phone,
  ho.owner_address,
  ho.phone_normalized,
  ho.appt_date,
  ho.appt_number,
  ho.animal_name,
  ho.microchip_number,
  -- Classification
  trapper.classify_owner_kind(
    COALESCE(ho.owner_first_name, '') || ' ' || COALESCE(ho.owner_last_name, ''),
    ho.owner_email,
    COALESCE(ho.owner_phone, ho.owner_cell_phone),
    ho.owner_address
  ) AS owner_kind,
  -- Identity key (no zip available, use address for suggestions)
  trapper.compute_person_key(
    ho.owner_email,
    COALESCE(ho.owner_phone, ho.owner_cell_phone),
    COALESCE(ho.owner_first_name, '') || ' ' || COALESCE(ho.owner_last_name, ''),
    NULL  -- no zip column
  ) AS person_key,
  -- Normalized fields
  trapper.clean_email(ho.owner_email) AS email_normalized,
  trapper.clean_phone(COALESCE(ho.owner_phone, ho.owner_cell_phone)) AS phone_clean,
  trapper.name_norm(COALESCE(ho.owner_first_name, '') || ' ' || COALESCE(ho.owner_last_name, '')) AS name_normalized
FROM trapper.clinichq_hist_owners ho;

COMMENT ON VIEW trapper.v_clinichq_owners_classified IS
'ClinicHQ owners with REL_013 classification (person/place/junk/unknown) and identity keys.';

-- ============================================================
-- PART E: View - Owner Kind Summary (for ops dashboard)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_owner_kind_summary AS
SELECT
  owner_kind,
  COUNT(*) AS total_count,
  COUNT(DISTINCT person_key) AS unique_keys,
  COUNT(*) FILTER (WHERE email_normalized IS NOT NULL) AS with_email,
  COUNT(*) FILTER (WHERE phone_clean IS NOT NULL) AS with_phone
FROM trapper.v_clinichq_owners_classified
GROUP BY owner_kind
ORDER BY
  CASE owner_kind
    WHEN 'person' THEN 1
    WHEN 'place' THEN 2
    WHEN 'unknown' THEN 3
    WHEN 'junk' THEN 4
  END;

COMMENT ON VIEW trapper.v_owner_kind_summary IS
'Summary counts by owner classification. For ops dashboard (REL_013).';

-- ============================================================
-- PART F: View - Person Dedupe Candidates
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_person_dedupe_candidates AS
WITH person_owners AS (
  SELECT
    id,
    owner_full_name,
    email_normalized,
    phone_clean,
    person_key,
    name_normalized,
    owner_address,
    appt_date
  FROM trapper.v_clinichq_owners_classified
  WHERE owner_kind = 'person'
    AND person_key IS NOT NULL
),
-- Find person_keys with multiple distinct names
grouped AS (
  SELECT
    person_key,
    ARRAY_AGG(DISTINCT name_normalized ORDER BY name_normalized) AS names,
    COUNT(DISTINCT id) AS record_count,
    MIN(appt_date) AS first_seen,
    MAX(appt_date) AS last_seen
  FROM person_owners
  GROUP BY person_key
  HAVING COUNT(DISTINCT name_normalized) > 1
)
SELECT
  g.person_key,
  g.names,
  g.record_count,
  g.first_seen,
  g.last_seen,
  CASE
    WHEN g.person_key LIKE 'email:%' THEN 'high'
    WHEN g.person_key LIKE 'phone:%' THEN 'medium'
    ELSE 'low'
  END AS merge_confidence,
  'Name variation under same ' ||
    CASE
      WHEN g.person_key LIKE 'email:%' THEN 'email'
      WHEN g.person_key LIKE 'phone:%' THEN 'phone'
      ELSE 'name'
    END AS reason
FROM grouped g
ORDER BY
  CASE WHEN g.person_key LIKE 'email:%' THEN 1 WHEN g.person_key LIKE 'phone:%' THEN 2 ELSE 3 END,
  g.record_count DESC
LIMIT 100;

COMMENT ON VIEW trapper.v_person_dedupe_candidates IS
'Person records that may be duplicates (same email/phone, different names). For review.';

-- ============================================================
-- PART G: View - Request History Link Candidates (Tier 5: person_key)
-- ============================================================

-- Note: This supplements existing v_request_hist_link_candidates (Tier 3: address)
-- by adding person_key based linking (Tier 5)

CREATE OR REPLACE VIEW trapper.v_request_person_link_candidates AS
SELECT DISTINCT ON (r.id, ho.id)
  r.id AS request_id,
  r.case_number,
  r.status::text AS request_status,
  ho.id AS hist_owner_id,
  ho.owner_full_name,
  ho.person_key,
  ho.appt_date AS owner_appt_date,
  -- Contact from request
  COALESCE(p.full_name, p.display_name) AS request_contact_name,
  p.email AS request_contact_email,
  p.phone AS request_contact_phone,
  -- Compute match confidence
  CASE
    WHEN ho.email_normalized IS NOT NULL
      AND trapper.clean_email(p.email) = ho.email_normalized
    THEN 0.95
    WHEN ho.phone_clean IS NOT NULL
      AND trapper.clean_phone(p.phone) = ho.phone_clean
    THEN 0.85
    WHEN ho.name_normalized IS NOT NULL
      AND trapper.name_norm(COALESCE(p.full_name, p.display_name)) = ho.name_normalized
    THEN 0.60
    ELSE 0.50
  END AS confidence,
  CASE
    WHEN ho.email_normalized IS NOT NULL
      AND trapper.clean_email(p.email) = ho.email_normalized
    THEN 'exact_email'
    WHEN ho.phone_clean IS NOT NULL
      AND trapper.clean_phone(p.phone) = ho.phone_clean
    THEN 'exact_phone'
    WHEN ho.name_normalized IS NOT NULL
      AND trapper.name_norm(COALESCE(p.full_name, p.display_name)) = ho.name_normalized
    THEN 'exact_name'
    ELSE 'weak_match'
  END AS match_type
FROM trapper.requests r
JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
JOIN trapper.v_clinichq_owners_classified ho ON (
  -- Email match
  (ho.email_normalized IS NOT NULL AND trapper.clean_email(p.email) = ho.email_normalized)
  -- OR phone match
  OR (ho.phone_clean IS NOT NULL AND trapper.clean_phone(p.phone) = ho.phone_clean)
  -- OR name match (only with email/phone match - too loose otherwise)
  OR (
    ho.name_normalized IS NOT NULL
    AND trapper.name_norm(COALESCE(p.full_name, p.display_name)) = ho.name_normalized
    AND (ho.email_normalized IS NOT NULL OR ho.phone_clean IS NOT NULL)
  )
)
WHERE r.archive_reason IS NULL OR r.archive_reason != 'duplicate'
ORDER BY r.id, ho.id,
  CASE
    WHEN ho.email_normalized IS NOT NULL AND trapper.clean_email(p.email) = ho.email_normalized THEN 1
    WHEN ho.phone_clean IS NOT NULL AND trapper.clean_phone(p.phone) = ho.phone_clean THEN 2
    ELSE 3
  END
LIMIT 200;

COMMENT ON VIEW trapper.v_request_person_link_candidates IS
'Request-to-history linking candidates based on person contact matching (Tier 5). REL_013.';

COMMIT;
