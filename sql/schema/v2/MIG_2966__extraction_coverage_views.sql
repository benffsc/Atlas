-- MIG_2966: Extraction coverage monitoring views
-- FFS-646: Per-source-system extraction rates, address propagation check, pipeline health dashboard
--
-- These complement the existing ops.v_cat_place_coverage and ops.v_entity_linking_history views
-- by adding source-level extraction metrics and a unified health dashboard.

BEGIN;

-- ==========================================================================
-- View 1: ops.v_extraction_coverage
-- Per-source-system extraction rates: raw records ingested vs SOT entities created
-- ==========================================================================

CREATE OR REPLACE VIEW ops.v_extraction_coverage AS
WITH source_counts AS (
  -- ClinicHQ: raw records by type
  SELECT
    'clinichq' AS source_system,
    'appointments' AS entity_type,
    COUNT(*) AS raw_count,
    COUNT(DISTINCT cr.source_record_id) AS unique_raw_count
  FROM source.clinichq_raw cr
  WHERE cr.record_type = 'appointment'
  UNION ALL
  SELECT
    'clinichq', 'cats',
    COUNT(*),
    COUNT(DISTINCT source_record_id)
  FROM source.clinichq_raw
  WHERE record_type = 'cat'
  UNION ALL
  SELECT
    'clinichq', 'owners',
    COUNT(*),
    COUNT(DISTINCT source_record_id)
  FROM source.clinichq_raw
  WHERE record_type = 'owner'
  UNION ALL
  -- Airtable: raw records by table
  SELECT
    'airtable', 'requests',
    COUNT(*),
    COUNT(DISTINCT record_id)
  FROM source.airtable_raw
  WHERE table_name ILIKE '%request%'
  UNION ALL
  -- ShelterLuv: animals
  SELECT
    'shelterluv', 'animals',
    COUNT(*),
    COUNT(DISTINCT source_record_id)
  FROM source.shelterluv_raw
  WHERE record_type = 'animal'
  UNION ALL
  -- VolunteerHub: people
  SELECT
    'volunteerhub', 'people',
    COUNT(*),
    COUNT(DISTINCT source_record_id)
  FROM source.volunteerhub_raw
  WHERE record_type = 'person'
  UNION ALL
  -- PetLink: registrations
  SELECT
    'petlink', 'registrations',
    COUNT(*),
    COUNT(DISTINCT microchip_id)
  FROM source.petlink_raw
  WHERE record_type = 'microchip_registration'
  UNION ALL
  -- Web intake
  SELECT
    'web_intake', 'submissions',
    COUNT(*),
    COUNT(DISTINCT submission_id)
  FROM source.web_intake_raw
),
sot_counts AS (
  -- SOT entities by source_system
  SELECT source_system, 'cats' AS entity_type, COUNT(*) AS sot_count
  FROM sot.cats WHERE merged_into_cat_id IS NULL
  GROUP BY source_system
  UNION ALL
  SELECT source_system, 'people', COUNT(*)
  FROM sot.people WHERE merged_into_person_id IS NULL
  GROUP BY source_system
  UNION ALL
  SELECT source_system, 'places', COUNT(*)
  FROM sot.places WHERE merged_into_place_id IS NULL
  GROUP BY source_system
),
ops_counts AS (
  -- OPS entities by source
  SELECT source_system, 'appointments' AS entity_type, COUNT(*) AS ops_count
  FROM ops.appointments
  GROUP BY source_system
  UNION ALL
  SELECT source_system, 'requests', COUNT(*)
  FROM ops.requests
  GROUP BY source_system
)
SELECT
  sc.source_system,
  sc.entity_type,
  sc.raw_count,
  sc.unique_raw_count,
  COALESCE(oc.ops_count, 0) AS ops_count,
  COALESCE(sotc.sot_count, 0) AS sot_count,
  CASE WHEN sc.unique_raw_count > 0
    THEN ROUND(100.0 * COALESCE(oc.ops_count, sotc.sot_count, 0) / sc.unique_raw_count, 1)
    ELSE NULL
  END AS extraction_pct
FROM source_counts sc
LEFT JOIN ops_counts oc ON oc.source_system = sc.source_system AND oc.entity_type = sc.entity_type
LEFT JOIN sot_counts sotc ON sotc.source_system = sc.source_system AND sotc.entity_type = sc.entity_type
ORDER BY sc.source_system, sc.entity_type;


-- ==========================================================================
-- View 2: ops.v_address_propagation
-- Places with formatted_address but missing sot_address_id (should be 0)
-- Invariant: every place with an address MUST have sot_address_id set (MIG_2562-2565)
-- ==========================================================================

CREATE OR REPLACE VIEW ops.v_address_propagation AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.place_kind,
  p.source_system,
  p.created_at
FROM sot.places p
WHERE p.formatted_address IS NOT NULL
  AND p.formatted_address != ''
  AND p.sot_address_id IS NULL
  AND p.merged_into_place_id IS NULL;

COMMENT ON VIEW ops.v_address_propagation IS
  'Places with formatted_address but no sot_address_id. Should be 0 rows. If not, run sot.find_or_create_address() backfill.';


-- ==========================================================================
-- View 3: ops.v_data_pipeline_health
-- Aggregate dashboard combining extraction, linkage, and clinic leakage
-- ==========================================================================

CREATE OR REPLACE VIEW ops.v_data_pipeline_health AS
SELECT
  -- Extraction metrics
  (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
  (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) AS total_people,
  (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL) AS total_places,
  (SELECT COUNT(*) FROM ops.appointments) AS total_appointments,
  (SELECT COUNT(*) FROM ops.requests) AS total_requests,

  -- Cat-place linkage (from existing coverage view)
  (SELECT COUNT(*) FROM sot.cat_place) AS total_cat_place_links,
  (SELECT COUNT(DISTINCT cp.cat_id) FROM sot.cat_place cp
   JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL) AS cats_with_place,
  CASE WHEN (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) > 0
    THEN ROUND(100.0 *
      (SELECT COUNT(DISTINCT cp.cat_id) FROM sot.cat_place cp
       JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL)::NUMERIC /
      (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 1)
    ELSE 0
  END AS cat_place_coverage_pct,

  -- Person linkage
  (SELECT COUNT(DISTINCT pi.person_id) FROM sot.person_identifiers pi
   WHERE pi.confidence >= 0.5) AS people_with_identifiers,

  -- Address propagation (should be 0)
  (SELECT COUNT(*) FROM sot.places
   WHERE formatted_address IS NOT NULL AND formatted_address != ''
     AND sot_address_id IS NULL AND merged_into_place_id IS NULL) AS address_propagation_gaps,

  -- Clinic leakage (should be 0)
  (SELECT COUNT(*) FROM sot.cat_place cp
   JOIN sot.places p ON p.place_id = cp.place_id
   WHERE ops.is_clinic_address(p.formatted_address)) AS clinic_leakage,

  -- Entity linking skipped
  (SELECT COUNT(*) FROM ops.entity_linking_skipped) AS total_skipped_links,

  -- Latest entity linking run
  (SELECT created_at FROM ops.entity_linking_runs ORDER BY created_at DESC LIMIT 1) AS last_linking_run,
  (SELECT status FROM ops.entity_linking_runs ORDER BY created_at DESC LIMIT 1) AS last_linking_status,

  NOW() AS computed_at;

COMMENT ON VIEW ops.v_data_pipeline_health IS
  'Aggregate data pipeline health dashboard. Key invariants: address_propagation_gaps = 0, clinic_leakage = 0.';

COMMIT;
