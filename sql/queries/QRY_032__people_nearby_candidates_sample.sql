-- QRY_032__people_nearby_candidates_sample.sql
-- Sample nearby people candidates for review
--
-- Shows top candidates by score for potential relationship linking.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_032__people_nearby_candidates_sample.sql

\echo ''
\echo '============================================'
\echo 'Nearby People Candidates'
\echo '============================================'

\echo ''
\echo 'Total candidates:'
SELECT COUNT(*) AS total_candidates
FROM trapper.v_person_nearby_people_candidates;

\echo ''
\echo 'Candidates by score range:'
SELECT
    CASE
        WHEN score = 1.0 THEN 'Same address (1.0)'
        WHEN score >= 0.8 THEN 'Very close (0.8+)'
        WHEN score >= 0.6 THEN 'Close (0.6-0.8)'
        WHEN score >= 0.4 THEN 'Nearby (0.4-0.6)'
        ELSE 'Far (<0.4)'
    END AS score_range,
    COUNT(*) AS count
FROM trapper.v_person_nearby_people_candidates
GROUP BY 1
ORDER BY MIN(score) DESC;

\echo ''
\echo 'Top 50 candidates by score:'
SELECT
    person_name,
    candidate_name,
    ROUND(distance_m::numeric, 1) AS distance_m,
    score,
    person_place_name,
    candidate_place_name,
    reasons->>'same_address' AS same_address
FROM trapper.v_person_nearby_people_candidates
ORDER BY score DESC, distance_m ASC
LIMIT 50;

\echo ''
\echo 'Same-address pairs (highest priority):'
SELECT
    person_name,
    candidate_name,
    person_place_name AS shared_address
FROM trapper.v_person_nearby_people_candidates
WHERE score = 1.0
LIMIT 20;

\echo ''
\echo 'To create a suggestion from this data:'
\echo '  INSERT INTO trapper.relationship_suggestions'
\echo '    (domain, entity_kind_a, entity_id_a, entity_kind_b, entity_id_b, score, reasons)'
\echo '  SELECT'
\echo '    ''person_person'', ''person'', person_id, ''person'', candidate_person_id, score, reasons'
\echo '  FROM trapper.v_person_nearby_people_candidates'
\echo '  WHERE score >= 0.8;'
\echo ''
