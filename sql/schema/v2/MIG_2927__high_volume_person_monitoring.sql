-- MIG_2927: Create high-volume person monitoring view
-- FFS-523: Audit persons with >20 cats — likely orgs, trappers, or caretakers
--
-- High cat counts on a single person often indicate:
--   1. Organization misclassified as person (SCAS, HSSC, rescue orgs)
--   2. Undetected trapper (brings many cats from multiple locations)
--   3. Colony caretaker (legitimate — manages large colony)
--   4. Data quality issue (entity linking chain pollution)
--
-- This view provides ongoing monitoring to catch these patterns early.

BEGIN;

-- ============================================================================
-- 1. Create monitoring view
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_high_volume_persons AS
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.is_organization,
    p.data_quality,
    p.source_system,
    sot.classify_owner_name(p.display_name) AS name_classification,

    -- Cat count
    cat_counts.total_cats,
    cat_counts.as_owner,
    cat_counts.as_caretaker,
    cat_counts.as_trapper,
    cat_counts.as_other,

    -- Place count
    place_counts.total_places,
    place_counts.as_resident,
    place_counts.as_contact,

    -- Role info
    role_info.roles,
    role_info.is_trapper,

    -- Identifiers
    sot.get_email(p.person_id) AS email,
    sot.get_phone(p.person_id) AS phone,

    -- Risk assessment
    CASE
        WHEN p.is_organization = TRUE THEN 'org_with_cats'
        WHEN role_info.is_trapper THEN 'known_trapper'
        WHEN cat_counts.total_cats > 50 THEN 'extreme_volume'
        WHEN place_counts.total_places > 3 AND cat_counts.total_cats > 20 THEN 'multi_location_high_volume'
        WHEN sot.classify_owner_name(p.display_name) IN ('organization', 'site_name') THEN 'misclassified_org'
        WHEN cat_counts.as_trapper > 0 THEN 'has_trapper_links'
        ELSE 'needs_review'
    END AS risk_category,

    p.created_at

FROM sot.people p
-- Cat counts by relationship type
JOIN LATERAL (
    SELECT
        COUNT(*) AS total_cats,
        COUNT(*) FILTER (WHERE pc.relationship_type = 'owner') AS as_owner,
        COUNT(*) FILTER (WHERE pc.relationship_type IN ('caretaker', 'colony_caretaker')) AS as_caretaker,
        COUNT(*) FILTER (WHERE pc.relationship_type = 'trapper') AS as_trapper,
        COUNT(*) FILTER (WHERE pc.relationship_type NOT IN ('owner', 'caretaker', 'colony_caretaker', 'trapper')) AS as_other
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    WHERE pc.person_id = p.person_id
) cat_counts ON TRUE
-- Place counts
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_places,
        COUNT(*) FILTER (WHERE pp.relationship_type IN ('resident', 'owner')) AS as_resident,
        COUNT(*) FILTER (WHERE pp.relationship_type = 'contact_address') AS as_contact
    FROM sot.person_place pp
    JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
    WHERE pp.person_id = p.person_id
) place_counts ON TRUE
-- Roles
LEFT JOIN LATERAL (
    SELECT
        ARRAY_AGG(pr.role) AS roles,
        BOOL_OR(pr.role IN ('trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper')) AS is_trapper
    FROM sot.person_roles pr
    WHERE pr.person_id = p.person_id AND pr.role_status = 'active'
) role_info ON TRUE
WHERE p.merged_into_person_id IS NULL
  AND cat_counts.total_cats > 20
ORDER BY cat_counts.total_cats DESC;

COMMENT ON VIEW ops.v_high_volume_persons IS
'FFS-523: Monitoring view for persons with >20 cat links.
High cat counts often indicate orgs misclassified as people, undetected trappers,
or entity linking pollution. Check risk_category for triage priority.

Risk categories:
- org_with_cats: Already flagged as org but still has cat links (cleanup needed)
- known_trapper: Expected high volume — verified trapper
- extreme_volume: >50 cats, needs immediate review
- multi_location_high_volume: >20 cats across >3 places — likely trapper or org
- misclassified_org: Name classifies as org but is_organization=FALSE
- has_trapper_links: Has trapper-type person_cat links
- needs_review: Catch-all for manual investigation';

-- ============================================================================
-- 2. Run initial audit
-- ============================================================================

\echo 'High-volume persons (>20 cats):'
SELECT
    display_name,
    total_cats,
    total_places,
    risk_category,
    is_organization,
    COALESCE(roles::TEXT, '{}') AS roles,
    email
FROM ops.v_high_volume_persons
ORDER BY total_cats DESC
LIMIT 30;

\echo ''
\echo 'Summary by risk category:'
SELECT
    risk_category,
    COUNT(*) AS person_count,
    SUM(total_cats) AS total_cats
FROM ops.v_high_volume_persons
GROUP BY risk_category
ORDER BY total_cats DESC;

\echo ''
\echo 'MIG_2927: ops.v_high_volume_persons monitoring view created'

COMMIT;
