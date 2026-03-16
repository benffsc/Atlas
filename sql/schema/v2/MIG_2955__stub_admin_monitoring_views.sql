-- MIG_2955: Stub admin/monitoring views to prevent 500 errors (FFS-601)
--
-- 25 views referenced by admin/health/cron API routes were never created in V2.
-- This migration creates stub views with correct column signatures so routes
-- don't crash. Stubs return empty or minimal computed data.
-- Full implementations can replace these as features are built out.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ops.v_active_locks — Entity edit locking
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_active_locks AS
SELECT
  NULL::TEXT AS entity_type,
  NULL::UUID AS entity_id,
  NULL::UUID AS locked_by,
  NULL::TEXT AS locked_by_name,
  NULL::TIMESTAMPTZ AS locked_at,
  NULL::TIMESTAMPTZ AS expires_at
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. ops.v_data_engine_health — Data Engine metrics
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_data_engine_health AS
SELECT
  0::INT AS decisions_24h,
  0::INT AS auto_matches_24h,
  0::INT AS new_entities_24h,
  0::INT AS pending_reviews,
  0::INT AS queued_jobs,
  0::INT AS processing_jobs,
  0::INT AS failed_jobs,
  (SELECT COUNT(*)::INT FROM sot.households) AS total_households,
  (SELECT COUNT(*)::INT FROM sot.household_members) AS active_household_members,
  0::INT AS soft_blacklisted_identifiers,
  0::NUMERIC AS avg_processing_ms;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ops.v_data_quality_dashboard — Data quality overview
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_data_quality_dashboard AS
SELECT
  (SELECT COUNT(*)::INT FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
  (SELECT COUNT(DISTINCT cp.cat_id)::INT FROM sot.cat_place cp JOIN sot.cats c ON c.cat_id = cp.cat_id WHERE c.merged_into_cat_id IS NULL) AS cats_with_places,
  ROUND(
    (SELECT COUNT(DISTINCT cp.cat_id)::NUMERIC FROM sot.cat_place cp JOIN sot.cats c ON c.cat_id = cp.cat_id WHERE c.merged_into_cat_id IS NULL)
    / NULLIF((SELECT COUNT(*)::NUMERIC FROM sot.cats WHERE merged_into_cat_id IS NULL), 0) * 100, 1
  ) AS cat_place_coverage_pct,
  (SELECT COUNT(*)::INT FROM sot.people WHERE merged_into_person_id IS NULL) AS total_people,
  (SELECT COUNT(*)::INT FROM sot.people WHERE merged_into_person_id IS NULL AND is_organization = FALSE) AS valid_people,
  0::INT AS invalid_people,
  (SELECT COUNT(*)::INT FROM sot.people WHERE merged_into_person_id IS NULL AND is_organization = TRUE) AS orgs_as_people,
  0::INT AS garbage_people,
  0::INT AS non_canonical_people,
  0::INT AS total_external_organizations,
  0::INT AS people_needing_org_conversion,
  0::INT AS total_de_decisions,
  0::INT AS de_decisions_24h,
  0::INT AS pending_reviews,
  0::INT AS auto_matches,
  0::INT AS new_entities,
  (SELECT COUNT(*)::INT FROM sot.households) AS total_households,
  (SELECT COUNT(*)::INT FROM sot.household_members) AS people_in_households,
  0::NUMERIC AS household_coverage_pct,
  (SELECT COUNT(*)::INT FROM sot.places WHERE merged_into_place_id IS NULL) AS total_places,
  (SELECT COUNT(*)::INT FROM sot.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL) AS geocoded_places,
  0::INT AS geocoding_queue,
  ROUND(
    (SELECT COUNT(*)::NUMERIC FROM sot.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL)
    / NULLIF((SELECT COUNT(*)::NUMERIC FROM sot.places WHERE merged_into_place_id IS NULL), 0) * 100, 1
  ) AS geocoding_coverage_pct,
  (SELECT COUNT(*)::INT FROM ops.appointments) AS total_appointments,
  (SELECT COUNT(*)::INT FROM ops.appointments WHERE person_id IS NOT NULL) AS appointments_with_person,
  0::INT AS appointments_with_trapper,
  ROUND(
    (SELECT COUNT(*)::NUMERIC FROM ops.appointments WHERE person_id IS NOT NULL)
    / NULLIF((SELECT COUNT(*)::NUMERIC FROM ops.appointments), 0) * 100, 1
  ) AS appointment_person_pct,
  (SELECT COUNT(DISTINCT pi.person_id)::INT FROM sot.person_identifiers pi WHERE pi.confidence >= 0.5) AS people_with_identifiers,
  0::NUMERIC AS identity_coverage_pct,
  0::INT AS people_created_24h,
  0::INT AS invalid_people_created_24h,
  0::INT AS cats_created_24h,
  0::INT AS records_staged_24h,
  0::INT AS soft_blacklist_count,
  NOW()::TEXT AS checked_at;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. ops.v_data_quality_problems — Data quality alerts
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_data_quality_problems AS
SELECT
  NULL::TEXT AS problem_type,
  NULL::TEXT AS severity,
  NULL::TEXT AS count,
  NULL::TEXT AS description
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. ops.v_data_quality_summary — Duplicate summary stats
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_data_quality_summary AS
SELECT
  0::INT AS email_duplicates,
  0::INT AS email_excess_records,
  0::INT AS phone_duplicates,
  0::INT AS phone_excess_records,
  0::INT AS garbage_names,
  (SELECT COUNT(*)::INT FROM sot.people WHERE merged_into_person_id IS NULL) AS active_people,
  (SELECT COUNT(*)::INT FROM sot.people WHERE merged_into_person_id IS NOT NULL) AS merged_people,
  0::INT AS merges_last_7_days,
  0::INT AS merges_last_24h;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ops.v_data_staleness_alerts — Data freshness tracking
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_data_staleness_alerts AS
SELECT
  NULL::TEXT AS data_category,
  NULL::TEXT AS freshness_status
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. ops.v_extraction_backlog_summary — AI extraction progress
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_extraction_backlog_summary AS
SELECT
  NULL::TEXT AS extraction_type,
  0::INT AS pending_count,
  0::INT AS completed_count,
  0::INT AS failed_count,
  NULL::TIMESTAMPTZ AS last_processed_at
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. ops.v_google_map_classification_stats — Google Maps stats
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_google_map_classification_stats AS
SELECT
  NULL::TEXT AS classification_type,
  NULL::TEXT AS display_label,
  NULL::TEXT AS display_color,
  0::INT AS priority,
  FALSE::BOOLEAN AS staff_alert,
  0::INT AS entry_count,
  0::INT AS with_place_link,
  0::INT AS with_person_link
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. ops.v_google_map_disease_risks — Disease risk review
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_google_map_disease_risks AS
SELECT
  NULL::UUID AS entry_id,
  NULL::TEXT AS kml_name,
  NULL::NUMERIC AS lat,
  NULL::NUMERIC AS lng,
  NULL::TEXT[] AS disease_mentions,
  NULL::TEXT AS ai_classified_at,
  NULL::TEXT AS linked_address
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ops.v_places_needing_classification — Place classification queue
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_places_needing_classification AS
SELECT
  NULL::UUID AS place_id,
  NULL::TEXT AS formatted_address,
  NULL::TEXT AS display_name,
  NULL::TEXT AS current_classification,
  NULL::TEXT AS suggested_classification,
  NULL::NUMERIC AS avg_confidence,
  0::INT AS request_count,
  0::INT AS agreement_count,
  NULL::UUID AS most_recent_request_id,
  NULL::TIMESTAMPTZ AS most_recent_at
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. ops.v_orchestrator_health — Orchestrator status
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_orchestrator_health AS
SELECT
  NULL::TEXT AS last_run_id,
  NULL::TEXT AS last_run_status,
  NULL::TIMESTAMPTZ AS last_run_at,
  0::INT AS last_run_duration_ms,
  0::INT AS runs_last_24h,
  0::INT AS failures_last_24h,
  0::INT AS cat_conflicts,
  0::INT AS person_conflicts,
  '{}'::JSONB AS phase_last_runs;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. ops.v_organization_match_stats — Org matching metrics
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_organization_match_stats AS
SELECT
  NULL::UUID AS org_id,
  0::INT AS matches_24h,
  0::INT AS matches_7d,
  0::INT AS matches_total
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. ops.v_places_needing_cat_reconciliation — Cat presence review
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_places_needing_cat_reconciliation AS
SELECT
  cp.place_id,
  p.formatted_address,
  p.display_name,
  p.colony_classification::TEXT,
  p.authoritative_cat_count,
  COUNT(DISTINCT cp.cat_id)::INT AS total_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'current')::INT AS current_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'uncertain')::INT AS uncertain_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'departed')::INT AS likely_departed,
  COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'unknown')::INT AS unconfirmed_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::INT AS altered_cats,
  MAX(cp.last_observed_at) AS most_recent_observation,
  (p.authoritative_cat_count IS NOT NULL AND p.authoritative_cat_count !=
    COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'current')
  ) AS has_count_mismatch,
  (COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'uncertain') > 0) AS has_uncertain_cats,
  (COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'departed') > 0) AS has_likely_departed,
  CASE
    WHEN COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'uncertain') > 5 THEN 1
    WHEN p.authoritative_cat_count IS NOT NULL THEN 2
    WHEN COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'uncertain') > 0 THEN 3
    ELSE 4
  END AS reconciliation_priority
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
GROUP BY cp.place_id, p.formatted_address, p.display_name, p.colony_classification, p.authoritative_cat_count
HAVING COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') IN ('uncertain', 'unknown')) > 0
    OR (p.authoritative_cat_count IS NOT NULL AND p.authoritative_cat_count !=
        COUNT(DISTINCT cp.cat_id) FILTER (WHERE COALESCE(cp.presence_status, 'unknown') = 'current'));

-- ═══════════════════════════════════════════════════════════════════════
-- 14. ops.v_potential_email_duplicates — Duplicate detection
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_potential_email_duplicates AS
SELECT
  pi.id_value_norm AS primary_email,
  COUNT(DISTINCT pi.person_id)::INT AS person_count,
  ARRAY_AGG(DISTINCT pi.person_id) AS person_ids,
  ARRAY_AGG(DISTINCT p.display_name) AS names,
  ARRAY_AGG(DISTINCT p.data_source) AS data_sources,
  MIN(p.created_at) AS earliest_created,
  MAX(p.created_at) AS latest_created
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
WHERE pi.id_type = 'email'
  AND pi.confidence >= 0.5
GROUP BY pi.id_value_norm
HAVING COUNT(DISTINCT pi.person_id) > 1;

-- ═══════════════════════════════════════════════════════════════════════
-- 15. ops.v_names_with_garbage_patterns — Garbage name detection
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_names_with_garbage_patterns AS
SELECT
  p.person_id,
  p.display_name,
  (SELECT pi.id_value_norm FROM sot.person_identifiers pi
   WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5
   ORDER BY pi.confidence DESC LIMIT 1) AS primary_email,
  CASE
    WHEN p.display_name ~ '^\d+\s' THEN 'starts_with_number'
    WHEN p.display_name ~ '^\W' THEN 'starts_with_special'
    WHEN LENGTH(p.display_name) <= 2 THEN 'too_short'
    WHEN p.display_name ~ '^[A-Z\s]+$' AND LENGTH(p.display_name) > 10 THEN 'all_uppercase_long'
    ELSE 'other'
  END AS pattern_type
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND (
    p.display_name ~ '^\d+\s'
    OR p.display_name ~ '^\W'
    OR LENGTH(COALESCE(p.display_name, '')) <= 2
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 16-18. Role audit views
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_stale_volunteer_roles AS
SELECT
  NULL::UUID AS role_id,
  NULL::UUID AS person_id,
  NULL::TEXT AS display_name,
  NULL::TEXT AS role,
  NULL::TEXT AS trapper_type,
  0::INT AS days_since_departure,
  NULL::TEXT[] AS groups_left
WHERE FALSE;

CREATE OR REPLACE VIEW ops.v_role_without_volunteer AS
SELECT
  NULL::UUID AS person_id,
  NULL::TEXT AS display_name,
  NULL::TEXT[] AS roles_without_volunteer,
  NULL::TEXT[] AS role_sources,
  FALSE::BOOLEAN AS has_vh_record
WHERE FALSE;

CREATE OR REPLACE VIEW ops.v_role_source_conflicts AS
SELECT
  NULL::UUID AS person_id,
  NULL::TEXT AS display_name,
  NULL::TEXT AS role,
  NULL::TEXT AS atlas_status,
  NULL::TEXT AS source_status
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 19-21. Tippy views
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_tippy_all_signals AS
SELECT
  NULL::TEXT AS signal_type,
  NULL::UUID AS signal_id,
  NULL::TIMESTAMPTZ AS created_at,
  NULL::TEXT AS status,
  NULL::TEXT AS detail_type,
  NULL::TEXT AS summary,
  NULL::TEXT AS entity_type,
  NULL::UUID AS entity_id,
  NULL::TEXT AS reported_by,
  NULL::UUID AS staff_id,
  NULL::NUMERIC AS confidence,
  FALSE::BOOLEAN AS is_silent
WHERE FALSE;

CREATE OR REPLACE VIEW ops.v_tippy_signal_summary AS
SELECT
  NULL::TEXT AS signal_type,
  0::INT AS total,
  0::INT AS needs_attention,
  0::INT AS last_7_days,
  NULL::TIMESTAMPTZ AS latest
WHERE FALSE;

CREATE OR REPLACE VIEW ops.v_tippy_draft_stats AS
SELECT
  NULL::TEXT AS status,
  0::INT AS count,
  NULL::TIMESTAMPTZ AS latest
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 22-23. Trapper onboarding views
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW ops.v_trapper_onboarding_pipeline AS
SELECT
  NULL::UUID AS onboarding_id,
  NULL::UUID AS person_id,
  NULL::TEXT AS display_name,
  NULL::TEXT AS primary_email,
  NULL::TEXT AS primary_phone,
  NULL::TEXT AS status,
  NULL::TEXT AS target_trapper_type,
  FALSE::BOOLEAN AS has_interest,
  FALSE::BOOLEAN AS has_contact,
  FALSE::BOOLEAN AS has_orientation,
  FALSE::BOOLEAN AS has_training,
  FALSE::BOOLEAN AS has_contract_sent,
  FALSE::BOOLEAN AS has_contract_signed,
  FALSE::BOOLEAN AS is_approved,
  NULL::TIMESTAMPTZ AS interest_received_at,
  NULL::TIMESTAMPTZ AS first_contact_at,
  NULL::TIMESTAMPTZ AS orientation_completed_at,
  NULL::TIMESTAMPTZ AS training_completed_at,
  NULL::TIMESTAMPTZ AS contract_sent_at,
  NULL::TIMESTAMPTZ AS contract_signed_at,
  NULL::TIMESTAMPTZ AS approved_at,
  0::INT AS days_in_status,
  0::INT AS days_in_pipeline,
  NULL::TEXT AS coordinator_name,
  NULL::TEXT AS notes,
  NULL::TEXT AS referral_source
WHERE FALSE;

CREATE OR REPLACE VIEW ops.v_trapper_onboarding_stats AS
SELECT
  NULL::TEXT AS status,
  0::INT AS count,
  0::NUMERIC AS avg_days_in_status
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- 24-25. Cat dedup views
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW sot.v_cat_dedup_health AS
SELECT
  0::INT AS pending_review,
  0::INT AS high_confidence_pending,
  (SELECT COUNT(*)::INT FROM sot.cats WHERE merged_into_cat_id IS NOT NULL) AS merged_count,
  0::INT AS not_duplicate_count,
  0::INT AS exact_microchip_duplicates,
  (SELECT COUNT(*)::INT FROM sot.cats WHERE merged_into_cat_id IS NULL AND microchip IS NULL) AS cats_without_microchip,
  (SELECT COUNT(*)::INT FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_active_cats;

CREATE OR REPLACE VIEW sot.v_cat_duplicate_review AS
SELECT
  NULL::UUID AS candidate_id,
  NULL::TEXT AS cat1_name,
  NULL::TEXT AS cat2_name,
  NULL::TEXT AS cat1_microchip,
  NULL::TEXT AS cat2_microchip,
  NULL::NUMERIC AS duplicate_confidence,
  NULL::TEXT AS likely_cause,
  NULL::TIMESTAMPTZ AS flagged_at,
  NULL::TEXT AS recommendation
WHERE FALSE;

-- ═══════════════════════════════════════════════════════════════════════

COMMENT ON VIEW ops.v_active_locks IS 'Stub: Entity edit locks (no locking system yet)';
COMMENT ON VIEW ops.v_data_engine_health IS 'Stub: Data engine health metrics';
COMMENT ON VIEW ops.v_data_quality_dashboard IS 'Data quality dashboard with live counts';
COMMENT ON VIEW ops.v_data_quality_problems IS 'Stub: Data quality problem alerts';
COMMENT ON VIEW ops.v_data_quality_summary IS 'Data quality duplicate summary';
COMMENT ON VIEW ops.v_data_staleness_alerts IS 'Stub: Data freshness alerts';
COMMENT ON VIEW ops.v_extraction_backlog_summary IS 'Stub: AI extraction backlog';
COMMENT ON VIEW ops.v_google_map_classification_stats IS 'Stub: Google Maps classification stats';
COMMENT ON VIEW ops.v_google_map_disease_risks IS 'Stub: Google Maps disease risk entries';
COMMENT ON VIEW ops.v_places_needing_classification IS 'Stub: Places needing classification review';
COMMENT ON VIEW ops.v_orchestrator_health IS 'Stub: Orchestrator health status';
COMMENT ON VIEW ops.v_organization_match_stats IS 'Stub: Organization matching metrics';
COMMENT ON VIEW ops.v_places_needing_cat_reconciliation IS 'Places with cats needing presence reconciliation';
COMMENT ON VIEW ops.v_potential_email_duplicates IS 'People sharing the same email address';
COMMENT ON VIEW ops.v_names_with_garbage_patterns IS 'People with garbage-pattern display names';
COMMENT ON VIEW ops.v_stale_volunteer_roles IS 'Stub: Stale volunteer roles';
COMMENT ON VIEW ops.v_role_without_volunteer IS 'Stub: Roles without VH record';
COMMENT ON VIEW ops.v_role_source_conflicts IS 'Stub: Role source conflicts';
COMMENT ON VIEW ops.v_tippy_all_signals IS 'Stub: Tippy AI signals';
COMMENT ON VIEW ops.v_tippy_signal_summary IS 'Stub: Tippy signal summary';
COMMENT ON VIEW ops.v_tippy_draft_stats IS 'Stub: Tippy draft statistics';
COMMENT ON VIEW ops.v_trapper_onboarding_pipeline IS 'Stub: Trapper onboarding pipeline';
COMMENT ON VIEW ops.v_trapper_onboarding_stats IS 'Stub: Trapper onboarding stats';
COMMENT ON VIEW sot.v_cat_dedup_health IS 'Cat dedup health with live counts';
COMMENT ON VIEW sot.v_cat_duplicate_review IS 'Stub: Cat duplicate review candidates';

COMMIT;
