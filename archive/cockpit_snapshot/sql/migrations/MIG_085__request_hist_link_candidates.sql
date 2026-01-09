-- MIG_085__request_hist_link_candidates.sql
-- Creates view for conservative linking between Airtable requests and ClinicHQ history
--
-- Match strategy (conservative, avoids false positives):
--   HIGH: Exact phone_normalized match (request person → hist owner)
--   MEDIUM: Exact email match (request person → hist owner)
--
-- Note: Microchip matching not possible at request level since requests don't store
-- microchip numbers. Use /history page for microchip lookups.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_085__request_hist_link_candidates.sql

-- ============================================
-- INDEXES FOR EFFICIENT JOINS
-- ============================================

-- Index on owners.phone_normalized for phone matching
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'clinichq_hist_owners'
          AND indexname = 'idx_clinichq_hist_owners_phone_norm_btree'
    ) THEN
        CREATE INDEX idx_clinichq_hist_owners_phone_norm_btree
        ON trapper.clinichq_hist_owners(phone_normalized)
        WHERE phone_normalized IS NOT NULL;
        RAISE NOTICE 'Created index: idx_clinichq_hist_owners_phone_norm_btree';
    ELSE
        RAISE NOTICE 'Index idx_clinichq_hist_owners_phone_norm_btree already exists';
    END IF;
END $$;

-- Index on owners.owner_email for email matching
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'clinichq_hist_owners'
          AND indexname = 'idx_clinichq_hist_owners_email_lower'
    ) THEN
        CREATE INDEX idx_clinichq_hist_owners_email_lower
        ON trapper.clinichq_hist_owners(LOWER(owner_email))
        WHERE owner_email IS NOT NULL AND owner_email != '';
        RAISE NOTICE 'Created index: idx_clinichq_hist_owners_email_lower';
    ELSE
        RAISE NOTICE 'Index idx_clinichq_hist_owners_email_lower already exists';
    END IF;
END $$;

-- Index on people.phone_normalized for matching
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'people'
          AND indexname = 'idx_people_phone_normalized_btree'
    ) THEN
        CREATE INDEX idx_people_phone_normalized_btree
        ON trapper.people(phone_normalized)
        WHERE phone_normalized IS NOT NULL;
        RAISE NOTICE 'Created index: idx_people_phone_normalized_btree';
    ELSE
        RAISE NOTICE 'Index idx_people_phone_normalized_btree already exists';
    END IF;
END $$;

-- ============================================
-- VIEW: v_request_hist_link_candidates
-- ============================================

CREATE OR REPLACE VIEW trapper.v_request_hist_link_candidates AS

-- Phone matches (HIGH confidence, score=100)
SELECT
    r.id AS request_id,
    r.case_number,
    'phone' AS match_kind,
    'high' AS confidence,
    100 AS match_score,
    ho.appt_date,
    ho.appt_number,
    ha.animal_name,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS owner_name,
    ha.microchip_number AS microchip,
    ho.owner_email,
    ho.phone_normalized,
    ho.owner_address,
    CASE
        WHEN ha.spay THEN 'Spay'
        WHEN ha.neuter THEN 'Neuter'
        WHEN ha.pregnant THEN 'Pregnant'
        WHEN ha.pyometra THEN 'Pyometra'
        WHEN ha.cryptorchid THEN 'Cryptorchid'
        ELSE NULL
    END AS surgery_type,
    ho.id AS hist_owner_id,
    ha.id AS hist_appt_id,
    p.id AS matched_person_id,
    p.full_name AS matched_person_name
FROM trapper.requests r
JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
JOIN trapper.clinichq_hist_owners ho ON ho.phone_normalized = p.phone_normalized
    AND ho.phone_normalized IS NOT NULL
    AND p.phone_normalized IS NOT NULL
LEFT JOIN trapper.clinichq_hist_appts ha ON ha.appt_number = ho.appt_number
WHERE r.archive_reason IS NULL OR r.archive_reason != 'duplicate'

UNION ALL

-- Email matches (MEDIUM confidence, score=90)
SELECT
    r.id AS request_id,
    r.case_number,
    'email' AS match_kind,
    'medium' AS confidence,
    90 AS match_score,
    ho.appt_date,
    ho.appt_number,
    ha.animal_name,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS owner_name,
    ha.microchip_number AS microchip,
    ho.owner_email,
    ho.phone_normalized,
    ho.owner_address,
    CASE
        WHEN ha.spay THEN 'Spay'
        WHEN ha.neuter THEN 'Neuter'
        WHEN ha.pregnant THEN 'Pregnant'
        WHEN ha.pyometra THEN 'Pyometra'
        WHEN ha.cryptorchid THEN 'Cryptorchid'
        ELSE NULL
    END AS surgery_type,
    ho.id AS hist_owner_id,
    ha.id AS hist_appt_id,
    p.id AS matched_person_id,
    p.full_name AS matched_person_name
FROM trapper.requests r
JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
JOIN trapper.clinichq_hist_owners ho ON LOWER(ho.owner_email) = LOWER(p.email)
    AND ho.owner_email IS NOT NULL AND ho.owner_email != ''
    AND p.email IS NOT NULL AND p.email != ''
    -- Exclude if already matched by phone (avoid duplicates)
    AND (ho.phone_normalized IS NULL OR p.phone_normalized IS NULL
         OR ho.phone_normalized != p.phone_normalized)
LEFT JOIN trapper.clinichq_hist_appts ha ON ha.appt_number = ho.appt_number
WHERE r.archive_reason IS NULL OR r.archive_reason != 'duplicate';

COMMENT ON VIEW trapper.v_request_hist_link_candidates IS
'Conservative candidate matches between Airtable requests and ClinicHQ history.
Match kinds: phone (high=100), email (medium=90).
Does NOT include name-only matches to avoid false positives.
Columns: request_id, case_number, match_kind, confidence, match_score, appt info, owner info.';

-- ============================================
-- VIEW: v_request_hist_candidates_top
-- Top N candidates per request (for UI display)
-- ============================================

CREATE OR REPLACE VIEW trapper.v_request_hist_candidates_top AS
WITH ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY request_id
            ORDER BY match_score DESC, appt_date DESC NULLS LAST
        ) AS rn
    FROM trapper.v_request_hist_link_candidates
)
SELECT
    request_id,
    case_number,
    match_kind,
    confidence,
    match_score,
    appt_date,
    appt_number,
    animal_name,
    owner_name,
    microchip,
    owner_email,
    phone_normalized,
    owner_address,
    surgery_type,
    hist_owner_id,
    hist_appt_id,
    matched_person_id,
    matched_person_name,
    rn AS rank_in_request
FROM ranked
WHERE rn <= 10;

COMMENT ON VIEW trapper.v_request_hist_candidates_top IS
'Top 10 ClinicHQ history candidates per request, ranked by match_score then appt_date DESC.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Link candidates views created. Quick stats:'

SELECT
    'Total candidates' AS metric,
    COUNT(*)::text AS value
FROM trapper.v_request_hist_link_candidates
UNION ALL
SELECT
    'Distinct requests with matches',
    COUNT(DISTINCT case_number)::text
FROM trapper.v_request_hist_link_candidates
UNION ALL
SELECT
    'Phone matches (high, score=100)',
    COUNT(*)::text
FROM trapper.v_request_hist_link_candidates
WHERE match_kind = 'phone'
UNION ALL
SELECT
    'Email matches (medium, score=90)',
    COUNT(*)::text
FROM trapper.v_request_hist_link_candidates
WHERE match_kind = 'email';

\echo ''
\echo 'Top candidates view sample (first 5):'
SELECT
    case_number,
    match_kind,
    match_score,
    appt_date::text,
    animal_name,
    owner_name,
    surgery_type
FROM trapper.v_request_hist_candidates_top
ORDER BY match_score DESC, appt_date DESC NULLS LAST
LIMIT 5;
