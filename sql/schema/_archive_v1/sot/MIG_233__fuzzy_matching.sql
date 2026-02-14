-- MIG_233: Fuzzy Name Matching for Duplicate Detection
--
-- Problem: Names like "Bibiana Patino" and "Viviana Patino" are likely the same
-- person but won't match exactly. We need fuzzy matching to surface potential
-- duplicates for staff review.
--
-- Solution:
-- 1. Use pg_trgm for similarity scoring
-- 2. Use Soundex/Metaphone for phonetic matching
-- 3. Create a view that surfaces potential duplicates
-- 4. Add a function to find similar people when adding new contacts
--
-- MANUAL APPLY:
--   source .env.local && psql "$DATABASE_URL" -f sql/schema/sot/MIG_233__fuzzy_matching.sql

\echo ''
\echo '=============================================='
\echo 'MIG_233: Fuzzy Name Matching'
\echo '=============================================='
\echo ''

-- Ensure extensions are available
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

\echo 'Extensions enabled: pg_trgm, fuzzystrmatch'

-- Function to find potential duplicate people by name similarity
CREATE OR REPLACE FUNCTION trapper.find_similar_people(
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  person_id UUID,
  display_name TEXT,
  similarity_score FLOAT,
  match_type TEXT,
  matched_phone TEXT,
  matched_email TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    -- Exact phone match (highest priority)
    SELECT DISTINCT
      p.person_id,
      p.display_name,
      1.0::FLOAT AS score,
      'exact_phone'::TEXT AS match_type,
      pi.id_value_norm AS matched_phone,
      NULL::TEXT AS matched_email
    FROM trapper.sot_people p
    JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
    WHERE p_phone IS NOT NULL
      AND pi.id_type = 'phone'
      AND pi.id_value_norm = REGEXP_REPLACE(p_phone, '\D', '', 'g')
      AND p.merged_into_person_id IS NULL

    UNION ALL

    -- Exact email match
    SELECT DISTINCT
      p.person_id,
      p.display_name,
      1.0::FLOAT AS score,
      'exact_email'::TEXT AS match_type,
      NULL AS matched_phone,
      pi.id_value_norm AS matched_email
    FROM trapper.sot_people p
    JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
    WHERE p_email IS NOT NULL
      AND pi.id_type = 'email'
      AND LOWER(pi.id_value_norm) = LOWER(p_email)
      AND p.merged_into_person_id IS NULL

    UNION ALL

    -- Trigram similarity (fuzzy text match)
    SELECT
      p.person_id,
      p.display_name,
      similarity(LOWER(p.display_name), LOWER(p_name))::FLOAT AS score,
      'name_similar'::TEXT AS match_type,
      NULL AS matched_phone,
      NULL AS matched_email
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND similarity(LOWER(p.display_name), LOWER(p_name)) >= p_threshold

    UNION ALL

    -- Soundex match (phonetic)
    SELECT
      p.person_id,
      p.display_name,
      0.7::FLOAT AS score,  -- Fixed score for soundex matches
      'soundex_match'::TEXT AS match_type,
      NULL AS matched_phone,
      NULL AS matched_email
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND SOUNDEX(SPLIT_PART(p.display_name, ' ', 1)) = SOUNDEX(SPLIT_PART(p_name, ' ', 1))
      AND SOUNDEX(SPLIT_PART(p.display_name, ' ', 2)) = SOUNDEX(SPLIT_PART(p_name, ' ', 2))
      AND p.display_name != p_name  -- Exclude exact matches
  )
  SELECT DISTINCT ON (c.person_id)
    c.person_id,
    c.display_name,
    MAX(c.score) AS similarity_score,
    -- Prefer exact matches over fuzzy
    CASE
      WHEN MAX(CASE WHEN c.match_type = 'exact_phone' THEN 1 ELSE 0 END) = 1 THEN 'exact_phone'
      WHEN MAX(CASE WHEN c.match_type = 'exact_email' THEN 1 ELSE 0 END) = 1 THEN 'exact_email'
      WHEN MAX(CASE WHEN c.match_type = 'soundex_match' THEN 1 ELSE 0 END) = 1 THEN 'soundex_match'
      ELSE 'name_similar'
    END AS match_type,
    MAX(c.matched_phone) AS matched_phone,
    MAX(c.matched_email) AS matched_email
  FROM candidates c
  GROUP BY c.person_id, c.display_name
  ORDER BY c.person_id, MAX(c.score) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

\echo 'Created find_similar_people() function'

-- View to surface potential duplicate people in the system
CREATE OR REPLACE VIEW trapper.v_potential_duplicate_people AS
WITH name_parts AS (
  SELECT
    person_id,
    display_name,
    SPLIT_PART(display_name, ' ', 1) AS first_name,
    SPLIT_PART(display_name, ' ', 2) AS last_name,
    SOUNDEX(SPLIT_PART(display_name, ' ', 1)) AS first_soundex,
    SOUNDEX(SPLIT_PART(display_name, ' ', 2)) AS last_soundex
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL
    AND trapper.is_valid_person_name(display_name)
),
potential_dupes AS (
  SELECT
    a.person_id AS person_id_a,
    a.display_name AS name_a,
    b.person_id AS person_id_b,
    b.display_name AS name_b,
    similarity(LOWER(a.display_name), LOWER(b.display_name)) AS name_similarity,
    CASE
      -- Same soundex on both first and last name
      WHEN a.first_soundex = b.first_soundex AND a.last_soundex = b.last_soundex THEN 'phonetic'
      -- High trigram similarity
      WHEN similarity(LOWER(a.display_name), LOWER(b.display_name)) > 0.6 THEN 'similar'
      -- Same last name, similar first name
      WHEN a.last_name = b.last_name AND similarity(a.first_name, b.first_name) > 0.5 THEN 'same_family'
      ELSE 'weak'
    END AS match_reason
  FROM name_parts a
  JOIN name_parts b ON a.person_id < b.person_id  -- Prevent duplicates
  WHERE (
    -- Soundex match on both names
    (a.first_soundex = b.first_soundex AND a.last_soundex = b.last_soundex)
    OR
    -- High name similarity
    similarity(LOWER(a.display_name), LOWER(b.display_name)) > 0.6
    OR
    -- Same last name with similar first name (catches "Bibiana Patino" vs "Viviana Patino")
    (a.last_name = b.last_name AND similarity(a.first_name, b.first_name) > 0.5)
  )
)
SELECT
  pd.person_id_a,
  pd.name_a,
  pd.person_id_b,
  pd.name_b,
  pd.name_similarity,
  pd.match_reason,
  -- Check if they share any identifiers
  EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi_a
    JOIN trapper.person_identifiers pi_b ON pi_a.id_type = pi_b.id_type
      AND pi_a.id_value_norm = pi_b.id_value_norm
    WHERE pi_a.person_id = pd.person_id_a
      AND pi_b.person_id = pd.person_id_b
  ) AS shares_identifier,
  -- Check if they share any places
  EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr_a
    JOIN trapper.person_place_relationships ppr_b ON ppr_a.place_id = ppr_b.place_id
    WHERE ppr_a.person_id = pd.person_id_a
      AND ppr_b.person_id = pd.person_id_b
  ) AS shares_place
FROM potential_dupes pd
WHERE pd.match_reason != 'weak'
ORDER BY
  CASE pd.match_reason
    WHEN 'phonetic' THEN 1
    WHEN 'similar' THEN 2
    WHEN 'same_family' THEN 3
    ELSE 4
  END,
  pd.name_similarity DESC;

\echo 'Created v_potential_duplicate_people view'

-- Quick function to check if a new name might be a duplicate
CREATE OR REPLACE FUNCTION trapper.check_for_duplicate_person(
  p_first_name TEXT,
  p_last_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS TABLE (
  person_id UUID,
  display_name TEXT,
  confidence TEXT,
  reason TEXT
) AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  RETURN QUERY
  SELECT
    fsp.person_id,
    fsp.display_name,
    CASE
      WHEN fsp.match_type IN ('exact_phone', 'exact_email') THEN 'HIGH'
      WHEN fsp.similarity_score > 0.8 THEN 'HIGH'
      WHEN fsp.similarity_score > 0.6 THEN 'MEDIUM'
      ELSE 'LOW'
    END AS confidence,
    fsp.match_type || ': ' || ROUND(fsp.similarity_score::NUMERIC, 2)::TEXT AS reason
  FROM trapper.find_similar_people(v_full_name, p_phone, p_email) fsp
  ORDER BY
    CASE
      WHEN fsp.match_type IN ('exact_phone', 'exact_email') THEN 0
      ELSE 1
    END,
    fsp.similarity_score DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

\echo 'Created check_for_duplicate_person() function'

\echo ''
\echo '=============================================='
\echo 'MIG_233 Complete!'
\echo '=============================================='
\echo ''
\echo 'New functions:'
\echo '  - find_similar_people(name, phone?, email?, threshold?)'
\echo '    → Returns potential matches with similarity scores'
\echo ''
\echo '  - check_for_duplicate_person(first, last, phone?, email?)'
\echo '    → Quick check when adding new contacts'
\echo ''
\echo 'New view:'
\echo '  - v_potential_duplicate_people'
\echo '    → Lists all potential duplicates in the system'
\echo ''

-- Test with the Bibiana/Viviana case
\echo 'Testing with "Viviana Patino" (should find Bibiana Patino Garcia):'
SELECT * FROM trapper.check_for_duplicate_person('Viviana', 'Patino', '707-975-1628');

\echo ''
\echo 'Testing name-only match:'
SELECT * FROM trapper.check_for_duplicate_person('Viviana', 'Patino');
