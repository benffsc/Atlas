-- MIG_240_fix__unlinked_sources_schema.sql
-- Fix v_people_unlinked_sources to match actual clinichq_hist_owners schema
-- The table has one row per appointment, not per owner, so we aggregate

-- ============================================================
-- PART 1: Aggregated ClinicHQ Owners CTE for reuse
-- ============================================================

-- First, create the corrected v_people_unlinked_sources view
CREATE OR REPLACE VIEW trapper.v_people_unlinked_sources AS
WITH clinichq_owners_agg AS (
    -- Aggregate appointments into distinct owners
    SELECT
        -- Use phone_normalized + email as owner key (most stable identifier)
        COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, '') AS owner_key,
        CONCAT(owner_first_name, ' ', owner_last_name) AS display_name,
        owner_email AS email,
        COALESCE(owner_cell_phone, owner_phone) AS phone,
        phone_normalized,
        owner_address AS address_display,
        COUNT(*) AS visit_count,
        MIN(appt_date) AS first_seen,
        MAX(appt_date) AS last_seen,
        -- Pick one representative ID for linking
        MIN(id::text) AS source_record_id
    FROM trapper.clinichq_hist_owners
    WHERE owner_first_name IS NOT NULL
      AND owner_first_name != ''
    GROUP BY
        COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, ''),
        CONCAT(owner_first_name, ' ', owner_last_name),
        owner_email,
        COALESCE(owner_cell_phone, owner_phone),
        phone_normalized,
        owner_address
)
-- ClinicHQ owners not linked
SELECT
    'clinichq'::text AS source_system,
    cho.source_record_id,
    cho.display_name,
    cho.email,
    cho.phone,
    cho.phone_normalized,
    cho.address_display,
    cho.visit_count::int,
    cho.first_seen::timestamptz,
    cho.last_seen::timestamptz,
    -- Check if already linked
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.source_record_id
    ) AS is_unlinked,
    -- Check if has open candidates
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'clinichq'
        AND pmc.source_record_id = cho.source_record_id
        AND pmc.status = 'open'
    ) AS has_open_candidates
FROM clinichq_owners_agg cho
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.source_record_id
)

UNION ALL

-- Appointment requests (JotForm) not linked
SELECT
    'jotform'::text AS source_system,
    ar.id::text AS source_record_id,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS display_name,
    ar.email,
    ar.phone,
    ar.phone_normalized,
    COALESCE(ar.cats_address, ar.requester_address) AS address_display,
    1 AS visit_count,
    ar.submitted_at AS first_seen,
    ar.submitted_at AS last_seen,
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
    ) AS is_unlinked,
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'jotform'
        AND pmc.source_record_id = ar.id::text
        AND pmc.status = 'open'
    ) AS has_open_candidates
FROM trapper.appointment_requests ar
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
);

COMMENT ON VIEW trapper.v_people_unlinked_sources IS
'Source records (ClinicHQ owners, JotForm submissions) not yet linked to canonical people.
ClinicHQ owners are aggregated from appointment rows. Use for matching and backlog tracking.';

-- ============================================================
-- PART 2: Fix v_people_linking_stats to count distinct owners
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_people_linking_stats AS
WITH clinichq_owner_keys AS (
    -- Count distinct owners by phone/email combo
    SELECT
        COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, '') AS owner_key,
        MIN(id::text) AS representative_id
    FROM trapper.clinichq_hist_owners
    WHERE owner_first_name IS NOT NULL AND owner_first_name != ''
    GROUP BY COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, '')
),
clinichq_counts AS (
    SELECT
        COUNT(*) AS total_owners,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM trapper.person_source_link psl
            WHERE psl.source_system = 'clinichq' AND psl.source_pk = cok.representative_id
        )) AS linked_owners
    FROM clinichq_owner_keys cok
),
candidate_counts AS (
    SELECT
        COUNT(*) AS total_candidates,
        COUNT(*) FILTER (WHERE status = 'open') AS open_candidates,
        COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_candidates,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_candidates,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.95) AS tier0_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.80 AND confidence < 0.95) AS tier1_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.50 AND confidence < 0.80) AS tier2_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence < 0.50) AS tier3_open
    FROM trapper.person_match_candidates
),
link_counts AS (
    SELECT
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE source_system = 'clinichq') AS clinichq_links,
        COUNT(*) FILTER (WHERE source_system = 'airtable') AS airtable_links,
        COUNT(*) FILTER (WHERE source_system = 'jotform') AS jotform_links
    FROM trapper.person_source_link
)
SELECT
    -- ClinicHQ backlog
    cc.total_owners AS clinichq_total_owners,
    cc.linked_owners AS clinichq_linked_owners,
    cc.total_owners - cc.linked_owners AS clinichq_unlinked_owners,
    ROUND(100.0 * cc.linked_owners / NULLIF(cc.total_owners, 0), 1) AS clinichq_linked_pct,

    -- Candidates
    cand.total_candidates,
    cand.open_candidates,
    cand.accepted_candidates,
    cand.rejected_candidates,
    ROUND(100.0 * cand.accepted_candidates / NULLIF(cand.accepted_candidates + cand.rejected_candidates, 0), 1) AS acceptance_rate_pct,

    -- Open by tier
    cand.tier0_open,
    cand.tier1_open,
    cand.tier2_open,
    cand.tier3_open,

    -- Links
    lc.total_links,
    lc.clinichq_links,
    lc.airtable_links,
    lc.jotform_links,

    -- Canonical people count
    (SELECT COUNT(*) FROM trapper.people) AS canonical_people_count
FROM clinichq_counts cc, candidate_counts cand, link_counts lc;

COMMENT ON VIEW trapper.v_people_linking_stats IS
'Dashboard stats for people linking: backlog (distinct owners), candidates by tier, acceptance rate.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_240_fix applied. Verifying:'
\echo ''

\echo 'Distinct ClinicHQ owners (aggregated):'
SELECT
    COUNT(*) AS total_unlinked_clinichq
FROM trapper.v_people_unlinked_sources
WHERE source_system = 'clinichq';

\echo ''
\echo 'Linking stats:'
SELECT * FROM trapper.v_people_linking_stats;
