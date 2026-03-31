-- ============================================================================
-- MIG_3015: Full Seed of ops.tippy_view_catalog
-- ============================================================================
-- Date: 2026-03-30
--
-- Purpose: Replace the original 12-view catalog (MIG_2520) with a comprehensive
-- catalog covering ~100 views across all schemas and categories.
--
-- The tippy_view_catalog is used by Tippy's run_sql tool and
-- tippy_discover_schema() to understand what views are available,
-- what columns they expose, and what questions they can answer.
--
-- Categories:
--   entity       — Core entity detail and list views
--   ecology      — Colony status, disease, breeding, alteration rates
--   statistics   — Aggregated stats, program comparisons, quarterly rollups
--   trapper      — Trapper performance, coverage, tiers, efficiency
--   data_quality — Data gaps, dedup candidates, monitoring, alerts
--   operations   — Intake queue, processing pipeline, batch status, system health
--   geography    — Map pins, geocoding, zones, zip coverage
--   matview      — Pre-computed materialized views
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_3015: Tippy View Catalog Full Seed'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: Update category CHECK constraint to support new categories
-- ============================================================================

\echo '1. Updating category constraint...'

ALTER TABLE ops.tippy_view_catalog
  DROP CONSTRAINT IF EXISTS tippy_view_catalog_category_check;

ALTER TABLE ops.tippy_view_catalog
  ADD CONSTRAINT tippy_view_catalog_category_check
  CHECK (category IN (
    'entity', 'ecology', 'statistics', 'trapper',
    'data_quality', 'operations', 'geography', 'matview',
    -- Keep legacy values for backward compat (mapped to new ones)
    'stats', 'processing', 'quality', 'linkage'
  ));

\echo '   Done'

-- ============================================================================
-- STEP 2: Truncate and re-seed the catalog
-- ============================================================================

\echo ''
\echo '2. Truncating existing catalog...'

TRUNCATE ops.tippy_view_catalog;

\echo '   Done'

-- ============================================================================
-- STEP 3: Seed — ENTITY views
-- ============================================================================

\echo ''
\echo '3. Seeding entity views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

-- Cat views
('sot', 'v_cat_detail', 'entity',
 'Full cat profile with identifiers, owners, places, appointment history, and test results as JSONB arrays',
 ARRAY['cat_id', 'display_name', 'microchip'],
 ARRAY['sex', 'altered_status', 'primary_color', 'ear_tip', 'is_deceased', 'data_source'],
 ARRAY['Look up a cat by microchip number', 'Show all info about a cat named Whiskers', 'Which cats are deceased?']),

('sot', 'v_cat_list', 'entity',
 'Lightweight cat list with name, microchip, sex, altered status, color, eartip, primary place name and address',
 ARRAY['cat_id', 'name', 'microchip'],
 ARRAY['sex', 'altered_status', 'primary_color', 'source_system'],
 ARRAY['List all female intact cats', 'How many cats came from ClinicHQ vs ShelterLuv?', 'Find cats with no microchip']),

('sot', 'v_cat_current_status', 'entity',
 'Current status snapshot for each cat including altered status, location, last appointment date, and whether alive',
 ARRAY['cat_id', 'name'],
 ARRAY['altered_status', 'is_deceased'],
 ARRAY['Which cats have not been seen in over a year?', 'How many cats are currently alive and unaltered?']),

('sot', 'v_cat_clinic_history', 'entity',
 'Full appointment history per cat with dates, procedures, test results, and clinic notes',
 ARRAY['cat_id', 'appointment_id'],
 ARRAY['appointment_date', 'is_spay', 'is_neuter'],
 ARRAY['Show appointment history for this cat', 'When was this cat last seen at the clinic?']),

('sot', 'v_adoption_context', 'entity',
 'Cat adoption events from ShelterLuv with adopter info, intake type, outcome, and timeline',
 ARRAY['cat_id', 'event_id'],
 ARRAY['outcome_type', 'intake_type'],
 ARRAY['How many cats were adopted this year?', 'What is the average time from intake to adoption?']),

-- Person views
('sot', 'v_person_detail', 'entity',
 'Full person profile with email, phone, roles, cat relationships, place relationships, and request history',
 ARRAY['person_id', 'display_name'],
 ARRAY['city'],
 ARRAY['Find a person by name or email', 'What roles does this person have?', 'Show all cats linked to this person']),

('sot', 'v_person_list_v3', 'entity',
 'Lightweight person list with display name, primary email, phone, city, cat count, place count, and roles',
 ARRAY['person_id', 'display_name'],
 ARRAY['city', 'has_email', 'has_phone'],
 ARRAY['List all people in Sebastopol', 'How many people have both email and phone?', 'Find people with the most cats']),

-- Place views
('sot', 'v_place_detail_v2', 'entity',
 'Full place profile with address, coordinates, place kind, cat count, people count, request history, and colony estimate',
 ARRAY['place_id', 'display_name'],
 ARRAY['city', 'place_kind', 'postal_code'],
 ARRAY['Show details for this address', 'What is at 123 Main St?', 'Which places have active requests?']),

('sot', 'v_place_list', 'entity',
 'Lightweight place list with display name, formatted address, city, place kind, cat count, and request count',
 ARRAY['place_id', 'display_name'],
 ARRAY['city', 'place_kind'],
 ARRAY['List all places in Petaluma', 'Which places have the most cats?', 'How many places are classified as colonies?']),

-- Request views
('ops', 'v_request_detail', 'entity',
 'Full request profile with requester, place, assigned trappers, cat count, status history, and resolution details',
 ARRAY['request_id'],
 ARRAY['status', 'city', 'priority', 'request_type'],
 ARRAY['Show details for request #123', 'Who is assigned to this request?', 'What is the history of this request?']),

('ops', 'v_request_list', 'entity',
 'Request list with status, place, requester, estimated cat count, priority, site contact, and trapper assignments',
 ARRAY['request_id'],
 ARRAY['status', 'city', 'priority', 'request_type'],
 ARRAY['Show all active requests', 'List requests in Santa Rosa', 'Which requests are high priority?']),

-- Appointment views
('ops', 'v_appointment_detail', 'entity',
 'Appointment details with date, cat, place, procedures performed, test results, and client info',
 ARRAY['appointment_id', 'cat_id'],
 ARRAY['appointment_date', 'is_spay', 'is_neuter', 'place_id'],
 ARRAY['Show appointments from last week', 'How many spays vs neuters this month?', 'Which places had the most appointments?']),

-- Contact views
('ops', 'v_request_contacts', 'entity',
 'Contact information for request-related people including requester, site contact, and assigned trappers',
 ARRAY['request_id', 'person_id'],
 ARRAY['contact_role'],
 ARRAY['Who are the contacts for this request?', 'Find the site contact for a request']);

\echo '   Done: 13 entity views'

-- ============================================================================
-- STEP 4: Seed — ECOLOGY views
-- ============================================================================

\echo ''
\echo '4. Seeding ecology views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('sot', 'v_place_colony_status', 'ecology',
 'Colony size estimates and alteration rates per place, with latest observation date and estimate method',
 ARRAY['place_id'],
 ARRAY['city'],
 ARRAY['What is the colony status at this address?', 'Which colonies have the lowest alteration rates?', 'Where are the largest unmanaged colonies?']),

('ops', 'v_colony_stats', 'ecology',
 'Aggregated colony statistics by area including total colonies, average size, total cats, and alteration coverage',
 ARRAY['city'],
 ARRAY['place_type'],
 ARRAY['How many colonies are in each city?', 'Colony overview for Sonoma County', 'Average colony size by area']),

('ops', 'v_colony_linked_cats', 'ecology',
 'Cats linked to colony places with their alteration status, allowing per-colony cat-level analysis',
 ARRAY['place_id', 'cat_id'],
 ARRAY['altered_status', 'city'],
 ARRAY['List all cats at this colony', 'How many unaltered cats are in colonies?']),

('ops', 'v_beacon_summary', 'ecology',
 'High-level TNR impact metrics: total cats altered, places served, active colonies, and overall alteration rate',
 ARRAY['metric'],
 ARRAY['time_period'],
 ARRAY['What are our total TNR numbers?', 'How many cats have we helped overall?', 'What is our overall alteration rate?']),

('ops', 'v_cat_disease_status', 'ecology',
 'Disease test results per cat including FIV, FeLV, and other tests with positive/negative/unknown classification',
 ARRAY['cat_id'],
 ARRAY['disease_type', 'test_result'],
 ARRAY['Which cats tested positive for FIV?', 'What is the FeLV rate?', 'How many cats have been tested?']),

('ops', 'v_cats_with_positive_tests', 'ecology',
 'Cats with positive disease test results including test type, date, and linked place for disease cluster analysis',
 ARRAY['cat_id', 'test_type'],
 ARRAY['test_result', 'city'],
 ARRAY['List all FIV-positive cats', 'Are there disease clusters in any area?', 'Show positive test results by city']),

('ops', 'v_place_disease_summary', 'ecology',
 'Disease prevalence summary per place with positive/negative counts and rates for FIV and FeLV',
 ARRAY['place_id'],
 ARRAY['city'],
 ARRAY['What is the FIV rate at this location?', 'Which places have the highest disease prevalence?']),

('ops', 'v_breeding_season_indicators', 'ecology',
 'Monthly pregnancy and lactation rates among female cats at clinic, with breeding phase classification',
 ARRAY['month'],
 ARRAY['breeding_phase'],
 ARRAY['What is the current pregnancy rate?', 'When does breeding season peak?', 'Are we seeing more pregnant cats than last year?']),

('ops', 'v_place_breeding_activity', 'ecology',
 'Breeding activity indicators per place including kitten sightings, pregnant/lactating cats, and breeding pressure score',
 ARRAY['place_id'],
 ARRAY['city'],
 ARRAY['Which places have the most breeding activity?', 'Where are kittens being born?']),

('ops', 'v_kitten_surge_prediction', 'ecology',
 'Predicted kitten surge timing based on historical breeding patterns and current pregnancy rates',
 ARRAY['month'],
 ARRAY['year'],
 ARRAY['When should we expect kitten season?', 'How many kittens do we predict this year?']),

('sot', 'v_place_ecology_stats', 'ecology',
 'Comprehensive ecological stats per place: known cats, altered count, eartip rate, Chapman estimate, and TNR need',
 ARRAY['place_id'],
 ARRAY['city'],
 ARRAY['What is the Chapman estimate for this colony?', 'How many cats still need TNR at this place?', 'What is the eartip rate here?']),

('ops', 'v_ear_tip_rate_by_period', 'ecology',
 'Eartip rate trends over configurable time periods showing TNR penetration progress',
 ARRAY['period'],
 ARRAY['city'],
 ARRAY['How has the eartip rate changed over time?', 'What is the current eartip rate?']),

('ops', 'v_ear_tip_rate_by_year', 'ecology',
 'Annual eartip rate showing year-over-year TNR progress across the service area',
 ARRAY['year'],
 ARRAY['city'],
 ARRAY['What was the eartip rate in 2025?', 'Is our eartip rate improving year over year?']),

('ops', 'v_seasonal_dashboard', 'ecology',
 'Monthly clinic activity with seasonal context: appointments, alterations, and breeding season flag',
 ARRAY['year', 'month_num'],
 ARRAY['season', 'is_breeding_season'],
 ARRAY['How busy was the clinic last month?', 'Compare spring vs fall activity', 'Show seasonal trends']),

('sot', 'v_place_alteration_history', 'ecology',
 'Time-series alteration history per place showing cumulative alterations and rate changes over time',
 ARRAY['place_id'],
 ARRAY['city', 'year'],
 ARRAY['Show the alteration history for this colony', 'How quickly are we making progress at this location?']),

('ops', 'v_place_condition_summary', 'ecology',
 'Place condition assessments including hoarding risk, sanitation, shelter quality, and overall risk score',
 ARRAY['place_id'],
 ARRAY['risk_level'],
 ARRAY['Which places have the worst conditions?', 'Are there any hoarding situations?']),

('ops', 'v_place_risk_status', 'ecology',
 'Risk classification per place combining disease prevalence, breeding activity, and condition assessments',
 ARRAY['place_id'],
 ARRAY['risk_level', 'city'],
 ARRAY['Which places are highest risk?', 'Show risk status for places in Guerneville']);

\echo '   Done: 17 ecology views'

-- ============================================================================
-- STEP 5: Seed — STATISTICS views
-- ============================================================================

\echo ''
\echo '5. Seeding statistics views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_request_alteration_stats', 'statistics',
 'Request-level alteration statistics: cats altered per request, completion rate, average time to resolution',
 ARRAY['request_id'],
 ARRAY['status', 'city'],
 ARRAY['How many cats were altered per request on average?', 'What is our request completion rate?', 'Average time from request to first alteration']),

('ops', 'v_request_lifecycle_metrics', 'statistics',
 'Request lifecycle timing metrics: median days from creation to triage, scheduling, completion, and resolution',
 ARRAY['metric_name'],
 ARRAY['year', 'quarter'],
 ARRAY['How long do requests take to complete?', 'What is the average time from triage to scheduling?', 'Are we getting faster at resolving requests?']),

('ops', 'v_yoy_activity_comparison', 'statistics',
 'Year-over-year comparison of clinic activity: appointments, alterations, unique cats, and places served by month',
 ARRAY['month_num'],
 ARRAY['year'],
 ARRAY['How does this year compare to last year?', 'Are we seeing more cats this year?', 'Year-over-year alteration trends']),

('ops', 'v_county_cat_quarterly', 'statistics',
 'Quarterly cat alteration counts broken down by county for regional impact reporting',
 ARRAY['county', 'quarter'],
 ARRAY['year', 'county'],
 ARRAY['How many cats did we alter in Sonoma County this quarter?', 'Quarterly breakdown by county']),

('ops', 'v_lmfm_quarterly', 'statistics',
 'Large-scale colony management (LMFM) quarterly metrics: colonies managed, cats altered, completion rates',
 ARRAY['quarter'],
 ARRAY['year'],
 ARRAY['LMFM program stats this quarter', 'How many large colonies have we managed?']),

('ops', 'v_foster_program_quarterly', 'statistics',
 'Foster program quarterly metrics: kittens fostered, foster homes active, average foster duration, outcomes',
 ARRAY['quarter'],
 ARRAY['year'],
 ARRAY['How many kittens were fostered this quarter?', 'How many active foster homes do we have?', 'Foster program outcomes']),

('ops', 'v_program_comparison_quarterly', 'statistics',
 'Side-by-side quarterly comparison across all programs: TNR, LMFM, foster, ShelterLuv outcomes',
 ARRAY['program', 'quarter'],
 ARRAY['year', 'program'],
 ARRAY['Compare all programs this quarter', 'Which program had the most impact?', 'Program trends over time']),

('ops', 'v_volunteer_role_counts', 'statistics',
 'Count of volunteers by role type (trapper, foster, clinic volunteer, etc.)',
 ARRAY['role_type'],
 ARRAY['role_type'],
 ARRAY['How many trappers do we have?', 'How many active volunteers by role?', 'Volunteer breakdown by type']),

('ops', 'v_active_request_progress', 'statistics',
 'Progress tracking for active requests: cats needed vs altered, assigned trappers, days since last activity',
 ARRAY['request_id'],
 ARRAY['status', 'city'],
 ARRAY['Which active requests are stalled?', 'Show progress on current requests', 'Requests with no activity in 30+ days']),

('ops', 'v_sac_report', 'statistics',
 'Sonoma Animal Services (SAC) reporting view with vocabulary and metrics required for county reporting',
 ARRAY['report_period'],
 ARRAY['year'],
 ARRAY['Generate the SAC report', 'What numbers do we report to the county?']),

('ops', 'v_cat_alteration_history', 'statistics',
 'Time-series of cat alterations (spay/neuter) by month with cumulative totals',
 ARRAY['month'],
 ARRAY['year'],
 ARRAY['How many cats were altered each month?', 'Show the alteration trend over time', 'Monthly spay/neuter counts']),

('ops', 'v_cat_outcome_history', 'statistics',
 'Cat outcome history from ShelterLuv: adoptions, transfers, euthanasia, died in care, by month',
 ARRAY['month', 'outcome_type'],
 ARRAY['year', 'outcome_type'],
 ARRAY['How many cats were adopted last month?', 'Outcome breakdown for this year', 'Euthanasia trends over time']);

\echo '   Done: 12 statistics views'

-- ============================================================================
-- STEP 6: Seed — TRAPPER views
-- ============================================================================

\echo ''
\echo '6. Seeding trapper views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_trapper_full_stats', 'trapper',
 'Comprehensive trapper performance: cats trapped, requests completed, active assignments, efficiency metrics, and tier classification',
 ARRAY['person_id', 'display_name'],
 ARRAY['trapper_type', 'is_active'],
 ARRAY['How many cats has this trapper caught?', 'Who are our top trappers?', 'Show trapper performance rankings']),

('sot', 'v_trapper_tiers', 'trapper',
 'Trapper tier classification (Tier 1: FFSC volunteer, Tier 2: community with contract, Tier 3: legacy/informal)',
 ARRAY['person_id', 'display_name'],
 ARRAY['trapper_type', 'tier'],
 ARRAY['How many Tier 1 trappers do we have?', 'List community trappers', 'Show trapper tier breakdown']),

('ops', 'v_trapper_aggregate_stats', 'trapper',
 'Aggregated trapper statistics: total cats by all trappers, average per trapper, busiest periods',
 ARRAY['trapper_type'],
 ARRAY['trapper_type'],
 ARRAY['What is the average cats per trapper?', 'Trapper workforce summary', 'Total trapper output this year']),

('sot', 'v_trapper_coverage', 'trapper',
 'Geographic coverage by trapper: which areas each trapper services, place count, and last activity date',
 ARRAY['person_id', 'place_id'],
 ARRAY['city', 'trapper_type'],
 ARRAY['Which areas does this trapper cover?', 'Who covers Sebastopol?', 'Are there coverage gaps?']),

('ops', 'v_trapper_efficiency', 'trapper',
 'Trapper efficiency metrics: cats per request, average days to complete, success rate, and utilization',
 ARRAY['person_id', 'display_name'],
 ARRAY['trapper_type'],
 ARRAY['Which trapper is most efficient?', 'Average cats trapped per request', 'Trapper efficiency rankings']),

('ops', 'v_community_trappers', 'trapper',
 'Community trappers (Tier 2) with contract status, service areas, and activity summary',
 ARRAY['person_id', 'display_name'],
 ARRAY['has_signed_contract', 'is_active'],
 ARRAY['List all community trappers', 'Which community trappers have signed contracts?', 'Community trapper activity']),

('ops', 'v_trapper_onboarding_stats', 'trapper',
 'Trapper onboarding pipeline metrics: new trappers by month, time to first assignment, completion rate',
 ARRAY['month'],
 ARRAY['year', 'trapper_type'],
 ARRAY['How many new trappers joined this month?', 'Trapper onboarding funnel', 'Average time from signup to first trap']),

('ops', 'v_trapper_onboarding_pipeline', 'trapper',
 'Individual trappers in the onboarding pipeline with current stage, days in stage, and next steps',
 ARRAY['person_id'],
 ARRAY['onboarding_stage'],
 ARRAY['Who is in the trapper onboarding pipeline?', 'Which trappers are stuck in onboarding?']),

('ops', 'v_scrape_trapper_attribution', 'trapper',
 'Trapper attribution from ClinicHQ appointment scrapes: which trapper brought which cat based on scraped notes',
 ARRAY['appointment_id', 'person_id'],
 ARRAY['trapper_name'],
 ARRAY['Which trappers are mentioned in clinic notes?', 'Attribution for appointments without formal trapper assignment']),

('ops', 'v_place_trap_efficiency', 'trapper',
 'Trap efficiency per place: cats caught per trap night, success rate, and optimal trapping patterns',
 ARRAY['place_id'],
 ARRAY['city'],
 ARRAY['What is the trap efficiency at this location?', 'Which places are hardest to trap?']);

\echo '   Done: 10 trapper views'

-- ============================================================================
-- STEP 7: Seed — DATA_QUALITY views
-- ============================================================================

\echo ''
\echo '7. Seeding data_quality views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_data_quality_dashboard', 'data_quality',
 'Overall data quality scores by entity type with completeness, accuracy, and consistency metrics',
 ARRAY['entity_type'],
 ARRAY['entity_type'],
 ARRAY['What is our data quality score?', 'Which entity type has the worst data?', 'Data quality overview']),

('ops', 'v_data_quality_summary', 'data_quality',
 'Summary of data quality issues by category and severity with counts and trend indicators',
 ARRAY['category', 'severity'],
 ARRAY['category', 'severity'],
 ARRAY['How many critical data issues do we have?', 'Data quality issue breakdown', 'Are data issues improving?']),

('ops', 'v_data_quality_alerts', 'data_quality',
 'Active data quality alerts requiring attention: missing required fields, suspicious patterns, integrity violations',
 ARRAY['alert_type'],
 ARRAY['severity', 'entity_type'],
 ARRAY['What data quality alerts are active?', 'Show critical data alerts', 'Any new data problems?']),

('ops', 'v_data_quality_problems', 'data_quality',
 'Individual data quality problems with affected entity, problem description, and suggested fix',
 ARRAY['problem_id', 'entity_id'],
 ARRAY['problem_type', 'entity_type'],
 ARRAY['What specific data problems exist?', 'Show problems for cats', 'List unfixed data issues']),

('sot', 'v_cat_quality', 'data_quality',
 'Per-cat data quality scores: completeness of name, microchip, sex, color, place, and owner fields',
 ARRAY['cat_id'],
 ARRAY['quality_tier'],
 ARRAY['Which cats have incomplete data?', 'Cats needing data cleanup', 'Low-quality cat records']),

('sot', 'v_person_dedup_candidates', 'data_quality',
 'Potential duplicate person pairs with match confidence, shared identifiers, and merge recommendation',
 ARRAY['person_id_1', 'person_id_2'],
 ARRAY['match_confidence', 'match_type'],
 ARRAY['How many duplicate people do we have?', 'Show high-confidence person duplicates', 'Dedup candidates to review']),

('sot', 'v_person_dedup_summary', 'data_quality',
 'Summary statistics for person deduplication: total candidates, reviewed, merged, by confidence tier',
 ARRAY['confidence_tier'],
 ARRAY['status'],
 ARRAY['How many person dedup candidates remain?', 'Dedup review progress']),

('ops', 'v_cat_dedup_candidates', 'data_quality',
 'Potential duplicate cat pairs based on microchip similarity, name matching, and shared place/owner',
 ARRAY['cat_id_1', 'cat_id_2'],
 ARRAY['match_type', 'confidence'],
 ARRAY['How many duplicate cats do we have?', 'Show cat dedup candidates', 'Cats that might be the same animal']),

('ops', 'v_cat_dedup_chip_typos', 'data_quality',
 'Cat pairs with microchips that differ by 1-2 characters, suggesting typos rather than distinct cats',
 ARRAY['cat_id_1', 'cat_id_2'],
 ARRAY['edit_distance'],
 ARRAY['Which microchips might have typos?', 'Potential microchip errors']),

('ops', 'v_cat_dedup_same_owner', 'data_quality',
 'Cat pairs linked to the same owner with similar names or attributes, likely duplicates',
 ARRAY['cat_id_1', 'cat_id_2', 'person_id'],
 ARRAY['confidence'],
 ARRAY['Cats with the same owner that might be duplicates', 'Same-owner cat dedup review']),

('sot', 'v_cat_dedup_health', 'data_quality',
 'Cat deduplication pipeline health: candidates remaining, auto-merge success rate, error counts',
 ARRAY['metric'],
 ARRAY['status'],
 ARRAY['How is the cat dedup pipeline doing?', 'Cat dedup health check']),

('ops', 'v_data_staleness_alerts', 'data_quality',
 'Alerts for data sources that have not synced recently: days since last sync, expected frequency, status',
 ARRAY['source_system'],
 ARRAY['source_system', 'severity'],
 ARRAY['Are any data sources stale?', 'When did ClinicHQ last sync?', 'Data freshness status']),

('ops', 'v_identifier_cardinality', 'data_quality',
 'Person identifier cardinality analysis: people with unusually many emails/phones suggesting data issues',
 ARRAY['person_id'],
 ARRAY['identifier_type'],
 ARRAY['Which people have too many identifiers?', 'Suspicious identifier patterns', 'People with 5+ emails']),

('ops', 'v_high_volume_accounts', 'data_quality',
 'ClinicHQ accounts with unusually high appointment volumes, likely trappers or organizations rather than residents',
 ARRAY['account_id'],
 ARRAY['account_type', 'appointment_count'],
 ARRAY['Which accounts have the most appointments?', 'High-volume accounts that might be misclassified']),

('ops', 'v_high_volume_persons', 'data_quality',
 'People with unusually many cat relationships, flagged for review as potential data quality issues',
 ARRAY['person_id'],
 ARRAY['cat_count'],
 ARRAY['Which people have the most cats linked?', 'High-volume person review']),

('sot', 'v_people_cleanup_candidates', 'data_quality',
 'People records that may need cleanup: missing identifiers, pseudo-profiles, or org names in person records',
 ARRAY['person_id'],
 ARRAY['cleanup_reason'],
 ARRAY['Which person records need cleanup?', 'Pseudo-profiles that should be removed']),

('ops', 'v_names_with_garbage_patterns', 'data_quality',
 'Person/account names containing garbage patterns (test data, keyboard mashing, placeholder text)',
 ARRAY['entity_id'],
 ARRAY['pattern_type'],
 ARRAY['Are there garbage names in the data?', 'Find test/placeholder records']),

('ops', 'v_potential_recheck_duplicates', 'data_quality',
 'Potential duplicate cats from recheck visits where microchip was entered in the Animal Name field',
 ARRAY['cat_id', 'potential_match_id'],
 ARRAY['status'],
 ARRAY['Are there unhandled recheck duplicates?', 'Recheck patterns needing review']),

('ops', 'v_unhandled_recheck_duplicates', 'data_quality',
 'Recheck duplicates that have NOT been resolved yet (should be zero in a healthy system)',
 ARRAY['cat_id'],
 ARRAY['status'],
 ARRAY['Do we have unresolved recheck duplicates?', 'Recheck duplicate alert status']),

('ops', 'v_cats_awaiting_microchip', 'data_quality',
 'Cats that have had appointments but still lack a microchip number, needing data entry follow-up',
 ARRAY['cat_id'],
 ARRAY['appointment_date'],
 ARRAY['Which cats are missing microchips after their appointment?', 'Microchip data entry backlog']),

('ops', 'v_cats_with_multiple_chips', 'data_quality',
 'Cats with more than one microchip number, which may indicate data issues or actual re-chipping',
 ARRAY['cat_id'],
 ARRAY['chip_count'],
 ARRAY['Which cats have multiple microchips?', 'Potential microchip data errors']),

('ops', 'v_cats_without_places', 'data_quality',
 'Cats with no place linkage at all, indicating missing location data',
 ARRAY['cat_id'],
 ARRAY['source_system'],
 ARRAY['How many cats have no location?', 'Cats missing place data']),

('ops', 'v_orphan_places', 'data_quality',
 'Places with no cats, no people, and no requests linked — candidates for cleanup or re-investigation',
 ARRAY['place_id'],
 ARRAY['city', 'place_kind'],
 ARRAY['How many orphan places exist?', 'Places with no linked entities']),

('ops', 'v_suspicious_people', 'data_quality',
 'People flagged as suspicious: org emails on person records, addresses as names, or impossible identifier combinations',
 ARRAY['person_id'],
 ARRAY['suspicion_type'],
 ARRAY['Are there suspicious person records?', 'People that might be organizations']),

('ops', 'v_org_person_cross_contamination', 'data_quality',
 'Organization identifiers that leaked into person records or vice versa',
 ARRAY['person_id', 'org_id'],
 ARRAY['contamination_type'],
 ARRAY['Is there org/person cross-contamination?', 'Identifiers shared between orgs and people']),

('ops', 'v_potential_email_duplicates', 'data_quality',
 'People who share the same email address, indicating potential duplicates or household members',
 ARRAY['email', 'person_id_1', 'person_id_2'],
 ARRAY['email'],
 ARRAY['Which people share email addresses?', 'Potential duplicates by email']);

\echo '   Done: 26 data_quality views'

-- ============================================================================
-- STEP 8: Seed — OPERATIONS views
-- ============================================================================

\echo ''
\echo '8. Seeding operations views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_intake_triage_queue', 'operations',
 'Incoming intake submissions awaiting triage: requester info, address, cat count, submission date, priority score',
 ARRAY['request_id'],
 ARRAY['status', 'priority', 'city'],
 ARRAY['What is in the intake queue?', 'How many requests need triage?', 'Show highest priority intake items']),

('ops', 'v_processing_dashboard', 'operations',
 'Data processing pipeline status: running jobs, queued items, error counts, and throughput metrics',
 ARRAY['job_type'],
 ARRAY['status'],
 ARRAY['Is the processing pipeline healthy?', 'Any stuck processing jobs?', 'Processing dashboard status']),

('ops', 'v_clinichq_batch_status', 'operations',
 'ClinicHQ file upload batch processing status: files received, processing stage, record counts, and errors',
 ARRAY['batch_id'],
 ARRAY['status', 'batch_ready'],
 ARRAY['Status of the latest ClinicHQ upload?', 'Are there any failed batches?', 'How many records in the last batch?']),

('ops', 'v_clinichq_export_health', 'operations',
 'ClinicHQ data export health metrics: last export date, record freshness, missing data patterns',
 ARRAY['metric'],
 ARRAY['status'],
 ARRAY['Is the ClinicHQ data feed healthy?', 'When was the last ClinicHQ export?', 'Any ClinicHQ data issues?']),

('ops', 'v_shelterluv_sync_status', 'operations',
 'ShelterLuv data synchronization status: last sync time, records synced, errors, and delta changes',
 ARRAY['sync_type'],
 ARRAY['status'],
 ARRAY['Is ShelterLuv sync working?', 'When did ShelterLuv last sync?', 'ShelterLuv sync health']),

('ops', 'v_shelterluv_cat_status', 'operations',
 'ShelterLuv cat records with current status, intake type, and Atlas matching status',
 ARRAY['shelterluv_id', 'cat_id'],
 ARRAY['status', 'intake_type'],
 ARRAY['How many ShelterLuv cats are matched to Atlas?', 'Unmatched ShelterLuv records']),

('source', 'v_file_upload_audit', 'operations',
 'File upload audit trail: all uploaded files with hash, size, uploader, processing status, and timestamps',
 ARRAY['file_upload_id'],
 ARRAY['source_system', 'status'],
 ARRAY['Recent file uploads', 'Failed uploads this week', 'File upload history']),

('ops', 'v_system_health_summary', 'operations',
 'Overall system health dashboard: database size, queue depths, cron job status, and error rates',
 ARRAY['component'],
 ARRAY['status', 'severity'],
 ARRAY['Is the system healthy?', 'Any system alerts?', 'System health overview']),

('ops', 'v_orchestrator_health', 'operations',
 'Data orchestrator pipeline health: cron execution history, success/failure rates, and timing',
 ARRAY['job_name'],
 ARRAY['status', 'last_run'],
 ARRAY['Are the cron jobs running?', 'Which orchestrator jobs failed recently?', 'Cron job health']),

('ops', 'v_data_pipeline_health', 'operations',
 'End-to-end data pipeline health: ingest, processing, entity linking, and output stages with status indicators',
 ARRAY['pipeline_stage'],
 ARRAY['status'],
 ARRAY['Is the data pipeline healthy?', 'Pipeline stage status', 'Any pipeline blockages?']),

('ops', 'v_data_engine_health', 'operations',
 'Identity resolution data engine health: match rates, merge queue depth, confidence distribution',
 ARRAY['metric'],
 ARRAY['status'],
 ARRAY['Is the data engine healthy?', 'Match rate trends', 'Data engine metrics']),

('ops', 'v_entity_linking_history', 'operations',
 'Entity linking run history: when linking ran, how many entities linked, coverage achieved, and warnings',
 ARRAY['run_id'],
 ARRAY['entity_type', 'status'],
 ARRAY['When did entity linking last run?', 'Entity linking coverage trends', 'Any linking failures?']),

('ops', 'v_entity_linking_skipped_summary', 'operations',
 'Summary of entities skipped during linking with reasons (no identifier, clinic address, blacklisted)',
 ARRAY['reason'],
 ARRAY['entity_type'],
 ARRAY['Why were entities skipped during linking?', 'How many cats lack place links?', 'Skipped entity summary']),

('ops', 'v_cat_place_coverage', 'operations',
 'Cat-place linking coverage metrics: percentage of cats with places, by source system and reason for gaps',
 ARRAY['metric'],
 ARRAY['source_system'],
 ARRAY['What percentage of cats have places?', 'Cat-place coverage by source', 'Why are some cats missing places?']),

('ops', 'v_clinic_leakage', 'operations',
 'Cats incorrectly linked to clinic addresses instead of their actual home/colony (should be zero)',
 ARRAY['cat_id', 'place_id'],
 ARRAY['place_name'],
 ARRAY['Are there any clinic address leaks?', 'Cats incorrectly at 845 Todd Rd', 'Clinic leakage check']),

('ops', 'v_stale_requests', 'operations',
 'Requests that have been inactive for extended periods, needing follow-up or closure',
 ARRAY['request_id'],
 ARRAY['status', 'days_inactive'],
 ARRAY['Which requests are stale?', 'Requests with no activity in 90+ days']),

('ops', 'v_pending_owner_changes', 'operations',
 'Owner change detection events awaiting review: when appointment data suggests a different owner than recorded',
 ARRAY['appointment_id', 'cat_id'],
 ARRAY['change_type'],
 ARRAY['Are there pending owner changes to review?', 'Owner change detection queue']),

('ops', 'v_unresolved_appointments', 'operations',
 'Appointments that could not be fully resolved: missing cat link, missing place, or ambiguous owner',
 ARRAY['appointment_id'],
 ARRAY['resolution_issue'],
 ARRAY['How many appointments are unresolved?', 'What appointments need manual review?']),

('ops', 'v_rebooked_cats', 'operations',
 'Cats that have been rebooked for additional appointments, with rebooking reason and timeline',
 ARRAY['cat_id', 'appointment_id'],
 ARRAY['rebook_reason'],
 ARRAY['Which cats have been rebooked?', 'Rebook patterns and reasons']),

('ops', 'v_extraction_coverage', 'operations',
 'Attribute extraction coverage: what percentage of records have had AI extraction run, by entity type',
 ARRAY['entity_type'],
 ARRAY['extraction_status'],
 ARRAY['What is the extraction coverage?', 'Which records need extraction?']),

('ops', 'v_extraction_backlog_summary', 'operations',
 'Backlog of records awaiting AI attribute extraction with priority and queue depth',
 ARRAY['entity_type'],
 ARRAY['priority'],
 ARRAY['How big is the extraction backlog?', 'Extraction queue status']),

('ops', 'v_equipment_inventory', 'operations',
 'Equipment inventory: traps, carriers, and other TNR equipment with location, condition, and checkout status',
 ARRAY['equipment_id'],
 ARRAY['equipment_type', 'status', 'condition'],
 ARRAY['What equipment do we have?', 'How many traps are available?', 'Equipment checked out to whom?']),

('ops', 'v_tippy_all_signals', 'operations',
 'All signals/feedback from Tippy conversations for monitoring AI assistant quality and capability gaps',
 ARRAY['signal_id'],
 ARRAY['signal_type'],
 ARRAY['What feedback has Tippy received?', 'Tippy capability gaps']),

('ops', 'v_tippy_signal_summary', 'operations',
 'Aggregated Tippy feedback/signal summary by type and resolution status',
 ARRAY['signal_type'],
 ARRAY['status'],
 ARRAY['Tippy feedback summary', 'Common Tippy issues']),

('ops', 'v_tippy_draft_stats', 'operations',
 'Statistics on Tippy-created draft requests: conversion rate, abandonment, and quality scores',
 ARRAY['metric'],
 ARRAY['time_period'],
 ARRAY['How many Tippy drafts became real requests?', 'Tippy draft conversion rate']);

\echo '   Done: 25 operations views'

-- ============================================================================
-- STEP 9: Seed — GEOGRAPHY views
-- ============================================================================

\echo ''
\echo '9. Seeding geography views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_map_atlas_pins', 'geography',
 'Map pin data for all places: coordinates, cat count, alteration rate, request status, disease risk, and place kind',
 ARRAY['place_id'],
 ARRAY['city', 'place_kind', 'has_active_request'],
 ARRAY['Show all map pins', 'Map data for Santa Rosa', 'Places with active requests on the map']),

('ops', 'v_gm_reference_pins', 'geography',
 'Google Maps reference pins: imported Google Maps markers with classification, linking status, and coordinates',
 ARRAY['entry_id'],
 ARRAY['classification', 'is_linked'],
 ARRAY['How many Google Maps pins are linked?', 'Unlinked Google Maps markers', 'Google Maps data coverage']),

('ops', 'v_geocoding_stats', 'geography',
 'Geocoding success/failure statistics: addresses geocoded, pending, failed, and success rate by source',
 ARRAY['source_system'],
 ARRAY['status'],
 ARRAY['What is the geocoding success rate?', 'How many addresses failed geocoding?', 'Geocoding coverage']),

('ops', 'v_geocoding_failures', 'geography',
 'Addresses that failed geocoding with error reason, retry count, and original address text',
 ARRAY['address_id'],
 ARRAY['error_type'],
 ARRAY['Which addresses could not be geocoded?', 'Geocoding failure reasons']),

('ops', 'v_reverse_geocoding_stats', 'geography',
 'Reverse geocoding statistics: coordinates resolved to addresses, pending, and failure rates',
 ARRAY['metric'],
 ARRAY['status'],
 ARRAY['Reverse geocoding status', 'How many coordinates need reverse geocoding?']),

('beacon', 'v_zone_alteration_rollup', 'geography',
 'TNR alteration statistics aggregated by observation zone: total cats, altered count, rate, and trend',
 ARRAY['zone_id', 'zone_code'],
 ARRAY['service_zone'],
 ARRAY['Alteration rate by zone', 'Which zones have the lowest alteration rate?', 'Zone-level TNR progress']),

('beacon', 'v_county_alteration_rollup', 'geography',
 'County-level TNR alteration statistics: cats altered, alteration rate, and places served per county',
 ARRAY['county'],
 ARRAY['county'],
 ARRAY['Alteration rate by county', 'How does Sonoma compare to Marin?', 'County-level impact']),

('beacon', 'v_service_zone_summary', 'geography',
 'Service zone summary: geographic boundaries, place count, cat count, and coverage metrics per zone',
 ARRAY['zone_id'],
 ARRAY['service_zone'],
 ARRAY['Service zone overview', 'Which zones are under-served?', 'Zone coverage summary']),

('ops', 'v_observation_zone_summary', 'geography',
 'Observation zone monitoring summary: zone activity, last observation date, and data coverage quality',
 ARRAY['zone_id'],
 ARRAY['zone_code'],
 ARRAY['Observation zone status', 'Which zones need fresh data?']),

('sot', 'v_place_observation_priority', 'geography',
 'Places ranked by observation priority based on colony size, last visit date, and data staleness',
 ARRAY['place_id'],
 ARRAY['city', 'priority_tier'],
 ARRAY['Which places most need a visit?', 'Observation priority list', 'Stale colonies needing check-up']),

('ops', 'v_zip_observation_priority', 'geography',
 'Zip codes ranked by observation priority: colony density, data gaps, and time since last visit',
 ARRAY['postal_code'],
 ARRAY['priority_tier'],
 ARRAY['Which zip codes need attention?', 'Zip code priority ranking']),

('ops', 'v_zone_observation_priority', 'geography',
 'Zones ranked by observation priority with aggregated metrics across all places in the zone',
 ARRAY['zone_id'],
 ARRAY['priority_tier'],
 ARRAY['Which zones need field visits?', 'Zone observation priorities']),

('sot', 'v_co_located_place_groups', 'geography',
 'Groups of places at the same or very close coordinates (multi-unit properties, adjacent locations)',
 ARRAY['group_id', 'place_id'],
 ARRAY['city'],
 ARRAY['Which places are co-located?', 'Multi-unit properties', 'Places at the same address']);

\echo '   Done: 13 geography views'

-- ============================================================================
-- STEP 10: Seed — MATVIEW (materialized views)
-- ============================================================================

\echo ''
\echo '10. Seeding matview entries...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'mv_city_stats', 'matview',
 'Pre-computed city-level statistics: places, cats, altered count, alteration rate, requests, appointments, and people per city. Refreshed periodically for fast queries.',
 ARRAY['city'],
 ARRAY['city', 'county'],
 ARRAY['How many cats in each city?', 'City with the most places', 'Alteration rate by city', 'Compare Santa Rosa vs Petaluma']),

('ops', 'mv_zip_coverage', 'matview',
 'Pre-computed zip code coverage analysis: places, cats, coverage gaps, and classification (well-covered, emerging, gap)',
 ARRAY['postal_code'],
 ARRAY['coverage_class', 'county'],
 ARRAY['Which zip codes are coverage gaps?', 'Zip code with the most cats', 'Coverage analysis by zip']),

('ops', 'mv_ffr_impact_summary', 'matview',
 'Pre-computed FFR (Free-Roaming Feline Reduction) impact by city/year/month: alterations, unique cats, and trend data',
 ARRAY['city', 'year', 'month'],
 ARRAY['city', 'year'],
 ARRAY['FFR impact by city this year', 'Monthly alteration trends', 'Which city shows the most improvement?']),

('ops', 'mv_beacon_place_metrics', 'matview',
 'Pre-computed place-level Beacon metrics: cat count, alteration rate, last appointment, colony estimate, and risk score per place',
 ARRAY['place_id'],
 ARRAY['city', 'risk_level'],
 ARRAY['Quick place metrics', 'Places with highest risk scores', 'Place-level alteration rates']);

\echo '   Done: 4 matview entries'

-- ============================================================================
-- STEP 11: Additional useful views (miscellaneous)
-- ============================================================================

\echo ''
\echo '11. Seeding additional views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

-- Cat movement and media
('sot', 'v_cat_movement_timeline', 'entity',
 'Timeline of a cat''s movement between places with dates, relationship types, and evidence sources',
 ARRAY['cat_id', 'place_id'],
 ARRAY['cat_id'],
 ARRAY['Where has this cat been?', 'Cat movement history', 'Show the timeline for this cat']),

('sot', 'v_cat_movement_patterns', 'entity',
 'Aggregated movement patterns: cats that move between places, frequency, and distance traveled',
 ARRAY['cat_id'],
 ARRAY['movement_count'],
 ARRAY['Which cats move between locations?', 'Most mobile cats']),

('sot', 'v_cat_media', 'entity',
 'Cat photos and media files with upload date, source, and associated appointment',
 ARRAY['cat_id', 'media_id'],
 ARRAY['source_system'],
 ARRAY['Does this cat have photos?', 'Cat media files']),

('sot', 'v_cat_field_sources_summary', 'entity',
 'For each cat field (name, sex, color, etc.), which source system provided the current value',
 ARRAY['cat_id'],
 ARRAY['source_system'],
 ARRAY['Where did this cat''s data come from?', 'Data provenance for this cat']),

('sot', 'v_cat_primary_place', 'entity',
 'Each cat''s primary (highest-confidence) place linkage with address and relationship type',
 ARRAY['cat_id', 'place_id'],
 ARRAY['city'],
 ARRAY['Where does this cat live?', 'Primary location for each cat']),

-- Place lifecycle
('ops', 'v_place_lifecycle_summary', 'ecology',
 'Place lifecycle summary: first request, first alteration, total activity, and current phase (new/active/mature/dormant)',
 ARRAY['place_id'],
 ARRAY['lifecycle_phase', 'city'],
 ARRAY['Which places are dormant?', 'New places needing attention', 'Place lifecycle distribution']),

-- Volunteer views
('ops', 'v_active_volunteers', 'statistics',
 'Currently active volunteers with role, last activity date, and total hours/events',
 ARRAY['person_id'],
 ARRAY['role_type'],
 ARRAY['How many active volunteers do we have?', 'Volunteer activity summary']),

('ops', 'v_volunteer_role_history', 'statistics',
 'Volunteer role changes over time: promotions, role additions, and deactivations',
 ARRAY['person_id'],
 ARRAY['role_type', 'change_type'],
 ARRAY['Volunteer role change history', 'Who was recently promoted?']),

('ops', 'v_role_source_conflicts', 'data_quality',
 'Conflicts between source systems about a person''s roles (e.g., VH says trapper, Airtable says not)',
 ARRAY['person_id'],
 ARRAY['role_type'],
 ARRAY['Are there role conflicts between source systems?', 'Role data inconsistencies']),

('ops', 'v_stale_volunteer_roles', 'data_quality',
 'Volunteer roles that have not been confirmed by source system in a long time',
 ARRAY['person_id'],
 ARRAY['role_type', 'days_stale'],
 ARRAY['Which volunteer roles are stale?', 'Roles needing re-verification']),

-- ClinicHQ scrape views
('ops', 'v_clinichq_scrape_coverage', 'operations',
 'Coverage metrics for ClinicHQ appointment scraping: scraped vs total, match rate, and data enrichment stats',
 ARRAY['metric'],
 ARRAY['status'],
 ARRAY['How much ClinicHQ data is scraped?', 'Scrape coverage status']),

('ops', 'v_scrape_appointment_enrichment', 'operations',
 'Appointments enriched via ClinicHQ scraping with additional fields extracted: trapper, notes, test results',
 ARRAY['appointment_id'],
 ARRAY['has_trapper', 'has_notes'],
 ARRAY['Which appointments have enriched data?', 'Scrape enrichment coverage']),

-- Place verification
('sot', 'v_person_place_verification_queue', 'data_quality',
 'Person-place relationships flagged for verification: low confidence, conflicting addresses, or inferred links',
 ARRAY['person_id', 'place_id'],
 ARRAY['verification_reason', 'confidence'],
 ARRAY['Which person-place links need verification?', 'Low-confidence address associations']),

('ops', 'v_address_mismatch_appointments', 'data_quality',
 'Appointments where the cat''s linked place does not match the appointment''s inferred place',
 ARRAY['appointment_id', 'cat_id'],
 ARRAY['mismatch_type'],
 ARRAY['Appointments with address mismatches', 'Cats at unexpected locations']);

\echo '   Done: 14 additional views'

-- ============================================================================
-- STEP 12: Beacon cluster and Google Maps views
-- ============================================================================

\echo ''
\echo '12. Seeding beacon and Google Maps views...'

INSERT INTO ops.tippy_view_catalog
  (schema_name, view_name, category, description, key_columns, filter_columns, example_questions)
VALUES

('ops', 'v_beacon_cluster_summary', 'geography',
 'Beacon geographic cluster summary: groups of nearby places with aggregate cat counts and alteration rates',
 ARRAY['cluster_id'],
 ARRAY['city'],
 ARRAY['Show place clusters', 'Largest cat clusters on the map']),

('ops', 'v_beacon_place_metrics', 'geography',
 'Per-place Beacon metrics view (non-materialized): cat counts, alteration rate, request status, and risk indicators',
 ARRAY['place_id'],
 ARRAY['city', 'risk_level'],
 ARRAY['Beacon metrics for this place', 'Place risk assessment']),

('ops', 'v_google_map_entries_classified', 'geography',
 'Google Maps imported entries with AI classification: residential, colony, business, or unknown',
 ARRAY['entry_id'],
 ARRAY['classification'],
 ARRAY['How are Google Maps entries classified?', 'Unclassified Google Maps markers']),

('ops', 'v_google_map_entries_linked', 'geography',
 'Google Maps entries that have been successfully linked to Atlas places',
 ARRAY['entry_id', 'place_id'],
 ARRAY['classification'],
 ARRAY['Which Google Maps entries are linked to places?', 'Google Maps linking status']),

('ops', 'v_gm_linking_stats', 'geography',
 'Statistics on Google Maps to Atlas place linking: total entries, linked count, match rate by classification',
 ARRAY['classification'],
 ARRAY['classification'],
 ARRAY['Google Maps linking success rate', 'How many markers are linked?']),

('ops', 'v_google_map_classification_stats', 'geography',
 'Breakdown of Google Maps entry classifications with counts per type',
 ARRAY['classification'],
 ARRAY['classification'],
 ARRAY['Google Maps classification breakdown', 'How many colony pins on Google Maps?']),

('ops', 'v_google_map_disease_risks', 'geography',
 'Google Maps markers at locations with known disease presence (FIV/FeLV positive cats)',
 ARRAY['entry_id'],
 ARRAY['disease_type'],
 ARRAY['Google Maps pins near disease clusters', 'Locations with disease risk']);

\echo '   Done: 7 beacon/GM views'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'View catalog by category:'
SELECT category, COUNT(*) AS view_count
FROM ops.tippy_view_catalog
WHERE is_active = true
GROUP BY category
ORDER BY category;

\echo ''
\echo 'Total views in catalog:'
SELECT COUNT(*) AS total_views FROM ops.tippy_view_catalog WHERE is_active = true;

\echo ''
\echo 'Sample entries (one per category):'
SELECT DISTINCT ON (category)
  category,
  schema_name || '.' || view_name AS full_view_name,
  LEFT(description, 80) AS description_preview
FROM ops.tippy_view_catalog
WHERE is_active = true
ORDER BY category, view_name;

\echo ''
\echo '=============================================='
\echo '  MIG_3015 Complete!'
\echo '=============================================='
\echo ''
\echo 'Tippy view catalog seeded with comprehensive coverage:'
\echo '  - entity:       Core entity detail/list views'
\echo '  - ecology:      Colony, disease, breeding, alteration views'
\echo '  - statistics:   Aggregated stats and quarterly rollups'
\echo '  - trapper:      Trapper performance and coverage views'
\echo '  - data_quality:  Dedup, monitoring, and quality alert views'
\echo '  - operations:   Pipeline, sync, and system health views'
\echo '  - geography:    Map pins, zones, geocoding views'
\echo '  - matview:      Pre-computed materialized views'
\echo ''
