-- QRY_011__top_open_match_candidates.sql
-- Top open person match candidates for manual review
--
-- Shows the most promising potential duplicates that haven't been
-- auto-merged or blocked. Includes match scores and shared signals.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_011__top_open_match_candidates.sql

SELECT
    pmc.candidate_id,
    lp.display_name AS left_person,
    rp.display_name AS right_person,
    ROUND(pmc.name_similarity, 2) AS name_sim,
    pmc.shared_email,
    pmc.shared_phone,
    pmc.shared_address_context,
    pmc.status,
    pmc.created_at::date AS created
FROM trapper.person_match_candidates pmc
JOIN trapper.sot_people lp ON lp.person_id = pmc.left_person_id
JOIN trapper.sot_people rp ON rp.person_id = pmc.right_person_id
WHERE pmc.status = 'open'
ORDER BY
    (CASE WHEN pmc.shared_email THEN 1 ELSE 0 END +
     CASE WHEN pmc.shared_phone THEN 1 ELSE 0 END +
     CASE WHEN pmc.shared_address_context THEN 1 ELSE 0 END) DESC,
    pmc.name_similarity DESC
LIMIT 20;

\echo ''
\echo 'Match candidate status summary:'
SELECT status, COUNT(*) FROM trapper.person_match_candidates GROUP BY 1 ORDER BY 1;
