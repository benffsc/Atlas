-- MIG_141__verified_tnr_counts.sql
-- Verified TNR counts derived from ClinicHQ surgery records
-- Trust comes from provenance - counts are COMPUTED from verified source data
--
-- Design:
--   - `estimated_cat_count` remains a soft estimate (human input)
--   - Verified counts are COMPUTED from cats linked to requests that have ClinicHQ surgery records
--   - No manual override of verified counts - trust comes from the data lineage
--
-- MANUAL APPLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_141__verified_tnr_counts.sql

-- ============================================================
-- 1. View: ClinicHQ Cats with Surgery Status
-- ============================================================
-- Extract surgery status from ClinicHQ staged records

CREATE OR REPLACE VIEW trapper.v_clinichq_surgery_status AS
SELECT
    sr.source_row_id,
    sr.row_hash,
    sr.payload->>'Animal Name' AS animal_name,
    sr.payload->>'Microchip Number' AS microchip,
    sr.payload->>'Spay Neuter Status' AS spay_neuter_status,
    sr.payload->>'Date' AS procedure_date,
    sr.payload->>'Sex' AS sex,
    sr.payload->>'Number' AS clinichq_number,
    CASE
        WHEN LOWER(sr.payload->>'Spay Neuter Status') IN ('yes', 'y', 'true', '1') THEN TRUE
        WHEN LOWER(sr.payload->>'Spay Neuter Status') IN ('no', 'n', 'false', '0') THEN FALSE
        ELSE NULL
    END AS is_altered,
    sr.created_at AS record_created_at
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'cat_info';

COMMENT ON VIEW trapper.v_clinichq_surgery_status IS 'ClinicHQ cat records with parsed surgery/alteration status. Source of truth for verified alterations.';

-- ============================================================
-- 2. View: Cats with Verified Alteration Status
-- ============================================================
-- Links sot_cats to their ClinicHQ surgery records via microchip

CREATE OR REPLACE VIEW trapper.v_cat_verified_status AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status AS current_altered_status,

    -- ClinicHQ verification
    BOOL_OR(chq.is_altered) AS clinichq_verified_altered,
    COUNT(DISTINCT CASE WHEN chq.is_altered = TRUE THEN chq.row_hash END) AS clinichq_surgery_records,
    MIN(chq.procedure_date) AS earliest_surgery_date,

    -- Verification status
    CASE
        WHEN BOOL_OR(chq.is_altered) = TRUE THEN 'verified_altered'
        WHEN BOOL_OR(chq.is_altered) = FALSE THEN 'verified_intact'
        WHEN COUNT(chq.row_hash) > 0 THEN 'clinichq_no_status'
        ELSE 'unverified'
    END AS verification_status

FROM trapper.sot_cats c
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.v_clinichq_surgery_status chq ON
    chq.microchip IS NOT NULL
    AND chq.microchip != ''
    AND ci.id_value = chq.microchip
GROUP BY c.cat_id, c.display_name, c.sex, c.altered_status;

COMMENT ON VIEW trapper.v_cat_verified_status IS 'Cats with verification status from ClinicHQ. Only trusts ClinicHQ data for alteration verification.';

-- ============================================================
-- 3. View: Request Verified Counts
-- ============================================================
-- Computes verified TNR counts for requests based on linked cats with ClinicHQ data

CREATE OR REPLACE VIEW trapper.v_request_verified_counts AS
SELECT
    r.request_id,

    -- Soft estimates (human input, useful context)
    r.estimated_cat_count,
    r.cats_trapped,
    r.cats_returned,

    -- Linked cat counts
    COUNT(DISTINCT rc.cat_id) AS linked_cat_count,

    -- Verified counts from ClinicHQ linkage
    COUNT(DISTINCT CASE WHEN cvs.verification_status = 'verified_altered' THEN rc.cat_id END) AS verified_altered_count,
    COUNT(DISTINCT CASE WHEN cvs.verification_status = 'verified_intact' THEN rc.cat_id END) AS verified_intact_count,
    COUNT(DISTINCT CASE WHEN cvs.verification_status = 'unverified' THEN rc.cat_id END) AS unverified_count,

    -- Trust indicator
    CASE
        WHEN COUNT(DISTINCT rc.cat_id) = 0 THEN 'no_cats_linked'
        WHEN COUNT(DISTINCT CASE WHEN cvs.verification_status IN ('verified_altered', 'verified_intact') THEN rc.cat_id END) = COUNT(DISTINCT rc.cat_id) THEN 'fully_verified'
        WHEN COUNT(DISTINCT CASE WHEN cvs.verification_status IN ('verified_altered', 'verified_intact') THEN rc.cat_id END) > 0 THEN 'partially_verified'
        ELSE 'unverified'
    END AS verification_completeness

FROM trapper.sot_requests r
LEFT JOIN trapper.request_cats rc ON rc.request_id = r.request_id
LEFT JOIN trapper.v_cat_verified_status cvs ON cvs.cat_id = rc.cat_id
GROUP BY r.request_id, r.estimated_cat_count, r.cats_trapped, r.cats_returned;

COMMENT ON VIEW trapper.v_request_verified_counts IS 'Request TNR counts with verification status. verified_altered_count is trustworthy (from ClinicHQ), estimated_cat_count is soft.';

-- ============================================================
-- 4. Update v_request_detail to include verified counts
-- ============================================================

DROP VIEW IF EXISTS trapper.v_request_detail;
CREATE VIEW trapper.v_request_detail AS
SELECT
    r.request_id,
    r.status,
    r.priority,
    r.summary,
    r.notes,
    r.legacy_notes,
    r.estimated_cat_count,
    r.has_kittens,
    r.cats_are_friendly,
    r.preferred_contact_method,
    r.assigned_to,
    r.scheduled_date,
    r.scheduled_time_range,
    r.resolved_at,
    r.resolution_notes,
    r.cats_trapped,
    r.cats_returned,
    r.data_source,
    r.source_system,
    r.source_record_id,
    r.created_by,
    r.created_at,
    r.updated_at,

    -- Place info
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address AS place_address,
    p.place_kind::text AS place_kind,
    a.locality AS place_city,
    a.postal_code AS place_postal_code,
    CASE
        WHEN a.lat IS NOT NULL AND a.lng IS NOT NULL
        THEN jsonb_build_object('lat', a.lat, 'lng', a.lng)
        ELSE NULL
    END AS place_coordinates,

    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,

    -- Verified counts (computed from ClinicHQ linkage)
    vc.linked_cat_count,
    vc.verified_altered_count,
    vc.verified_intact_count,
    vc.unverified_count,
    vc.verification_completeness

FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses a ON a.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
LEFT JOIN trapper.v_request_verified_counts vc ON vc.request_id = r.request_id;

COMMENT ON VIEW trapper.v_request_detail IS 'Full request details with verified counts from ClinicHQ linkage.';

-- ============================================================
-- 5. Verification Summary (for ops dashboard)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_verification_summary AS
SELECT
    'cats' AS entity_type,
    COUNT(*) AS total,
    COUNT(CASE WHEN verification_status = 'verified_altered' THEN 1 END) AS verified_altered,
    COUNT(CASE WHEN verification_status = 'verified_intact' THEN 1 END) AS verified_intact,
    COUNT(CASE WHEN verification_status = 'unverified' THEN 1 END) AS unverified,
    ROUND(100.0 * COUNT(CASE WHEN verification_status IN ('verified_altered', 'verified_intact') THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS verification_pct
FROM trapper.v_cat_verified_status

UNION ALL

SELECT
    'requests' AS entity_type,
    COUNT(*) AS total,
    COUNT(CASE WHEN verification_completeness = 'fully_verified' THEN 1 END) AS verified_altered,
    COUNT(CASE WHEN verification_completeness = 'partially_verified' THEN 1 END) AS verified_intact,
    COUNT(CASE WHEN verification_completeness IN ('unverified', 'no_cats_linked') THEN 1 END) AS unverified,
    ROUND(100.0 * COUNT(CASE WHEN verification_completeness IN ('fully_verified', 'partially_verified') THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS verification_pct
FROM trapper.v_request_verified_counts;

COMMENT ON VIEW trapper.v_verification_summary IS 'Summary of data verification status for ops dashboard.';

-- ============================================================
-- Verification
-- ============================================================

DO $$
DECLARE
    v_view_count INT;
BEGIN
    SELECT COUNT(*) INTO v_view_count
    FROM information_schema.views
    WHERE table_schema = 'trapper'
      AND table_name IN ('v_clinichq_surgery_status', 'v_cat_verified_status', 'v_request_verified_counts', 'v_verification_summary');

    RAISE NOTICE 'MIG_141: Created % verification views', v_view_count;
END $$;

-- Show verification stats
SELECT 'MIG_141 Complete' AS status;
SELECT * FROM trapper.v_verification_summary;
