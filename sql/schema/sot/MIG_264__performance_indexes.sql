-- MIG_264: Performance Indexes
--
-- Problem:
--   Several commonly queried tables lack optimal indexes for typical query patterns:
--   - person_identifiers lookups by (id_type, id_value_norm)
--   - sot_requests filtering by (place_id, status, source_system)
--   - request_trapper_assignments joins on (request_id, trapper_person_id)
--   - places deduplication by normalized_address
--
-- Solution:
--   Add composite and unique indexes for common query patterns.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_264__performance_indexes.sql

\echo ''
\echo '=============================================='
\echo 'MIG_264: Performance Indexes'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. person_identifiers composite index
-- ============================================================

\echo '1. Creating person_identifiers lookup index...'

-- Composite index for identity lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_person_identifiers_type_value_norm
ON trapper.person_identifiers(id_type, id_value_norm);

-- Index for finding all identifiers for a person
CREATE INDEX IF NOT EXISTS idx_person_identifiers_person_id
ON trapper.person_identifiers(person_id);

-- ============================================================
-- 2. cat_identifiers composite index
-- ============================================================

\echo '2. Creating cat_identifiers lookup index...'

CREATE INDEX IF NOT EXISTS idx_cat_identifiers_type_value
ON trapper.cat_identifiers(id_type, id_value);

CREATE INDEX IF NOT EXISTS idx_cat_identifiers_cat_id
ON trapper.cat_identifiers(cat_id);

-- ============================================================
-- 3. sot_requests filtering indexes
-- ============================================================

\echo '3. Creating sot_requests filtering indexes...'

-- Common filter: requests by place
CREATE INDEX IF NOT EXISTS idx_sot_requests_place_id
ON trapper.sot_requests(place_id)
WHERE place_id IS NOT NULL;

-- Common filter: requests by status
CREATE INDEX IF NOT EXISTS idx_sot_requests_status
ON trapper.sot_requests(status);

-- Common filter: active requests (exclude completed/cancelled)
CREATE INDEX IF NOT EXISTS idx_sot_requests_active
ON trapper.sot_requests(status, priority, created_at DESC)
WHERE status NOT IN ('completed', 'cancelled');

-- Common filter: requests by source system
CREATE INDEX IF NOT EXISTS idx_sot_requests_source_system
ON trapper.sot_requests(source_system);

-- Composite for common list query
CREATE INDEX IF NOT EXISTS idx_sot_requests_list_query
ON trapper.sot_requests(status, source_system, created_at DESC);

-- ============================================================
-- 4. request_trapper_assignments indexes
-- ============================================================

\echo '4. Creating request_trapper_assignments indexes...'

-- Lookup by request
CREATE INDEX IF NOT EXISTS idx_request_trapper_assignments_request
ON trapper.request_trapper_assignments(request_id);

-- Lookup by trapper (for trapper stats)
CREATE INDEX IF NOT EXISTS idx_request_trapper_assignments_trapper
ON trapper.request_trapper_assignments(trapper_person_id);

-- Active assignments only
CREATE INDEX IF NOT EXISTS idx_request_trapper_assignments_active
ON trapper.request_trapper_assignments(request_id, trapper_person_id)
WHERE is_current = TRUE;

-- ============================================================
-- 5. places deduplication index
-- ============================================================

\echo '5. Creating places deduplication index...'

-- Unique index on normalized_address to prevent duplicates
-- Only for address-backed places that aren't merged
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_normalized_address_unique
ON trapper.places(normalized_address)
WHERE is_address_backed = TRUE
  AND merged_into_place_id IS NULL
  AND normalized_address IS NOT NULL;

-- Index for geocoding queue lookups
CREATE INDEX IF NOT EXISTS idx_places_geocoding_pending
ON trapper.places(geocode_status, created_at)
WHERE geocode_status IN ('pending', 'failed');

-- ============================================================
-- 6. sot_people merged lookup
-- ============================================================

\echo '6. Creating sot_people merge lookup index...'

-- Fast lookup of merged people for canonical resolution
CREATE INDEX IF NOT EXISTS idx_sot_people_merged_into
ON trapper.sot_people(merged_into_person_id)
WHERE merged_into_person_id IS NOT NULL;

-- Active (non-merged) people lookup
CREATE INDEX IF NOT EXISTS idx_sot_people_active_name
ON trapper.sot_people(display_name)
WHERE merged_into_person_id IS NULL;

-- ============================================================
-- 7. sot_cats merged lookup
-- ============================================================

\echo '7. Creating sot_cats merge lookup index...'

CREATE INDEX IF NOT EXISTS idx_sot_cats_merged_into
ON trapper.sot_cats(merged_into_cat_id)
WHERE merged_into_cat_id IS NOT NULL;

-- Active cats lookup by microchip
CREATE INDEX IF NOT EXISTS idx_sot_cats_active_altered
ON trapper.sot_cats(altered_status)
WHERE merged_into_cat_id IS NULL;

-- ============================================================
-- 8. Relationship table indexes
-- ============================================================

\echo '8. Creating relationship table indexes...'

-- person_place_relationships
CREATE INDEX IF NOT EXISTS idx_person_place_rel_person
ON trapper.person_place_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_place_rel_place
ON trapper.person_place_relationships(place_id);

-- person_cat_relationships
CREATE INDEX IF NOT EXISTS idx_person_cat_rel_person
ON trapper.person_cat_relationships(person_id);

CREATE INDEX IF NOT EXISTS idx_person_cat_rel_cat
ON trapper.person_cat_relationships(cat_id);

-- cat_place_relationships
CREATE INDEX IF NOT EXISTS idx_cat_place_rel_cat
ON trapper.cat_place_relationships(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_place_rel_place
ON trapper.cat_place_relationships(place_id);

-- ============================================================
-- 9. web_intake_submissions indexes
-- ============================================================

\echo '9. Creating web_intake_submissions indexes...'

-- Queue ordering
CREATE INDEX IF NOT EXISTS idx_web_intake_submissions_queue
ON trapper.web_intake_submissions(submission_status, triage_score DESC, submitted_at)
WHERE submission_status NOT IN ('complete', 'archived');

-- Person matching
CREATE INDEX IF NOT EXISTS idx_web_intake_submissions_person
ON trapper.web_intake_submissions(matched_person_id)
WHERE matched_person_id IS NOT NULL;

-- Place matching
CREATE INDEX IF NOT EXISTS idx_web_intake_submissions_place
ON trapper.web_intake_submissions(place_id)
WHERE place_id IS NOT NULL;

-- ============================================================
-- 10. sot_appointments indexes
-- ============================================================

\echo '10. Creating sot_appointments indexes...'

-- Lookup by cat
CREATE INDEX IF NOT EXISTS idx_sot_appointments_cat
ON trapper.sot_appointments(cat_id)
WHERE cat_id IS NOT NULL;

-- Lookup by appointment number (for dedup)
CREATE INDEX IF NOT EXISTS idx_sot_appointments_number
ON trapper.sot_appointments(appointment_number)
WHERE appointment_number IS NOT NULL;

-- Date range queries
CREATE INDEX IF NOT EXISTS idx_sot_appointments_date
ON trapper.sot_appointments(appointment_date DESC);

-- ============================================================
-- 11. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Indexes created (sample):'
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'trapper'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname
LIMIT 20;

\echo ''
\echo 'Total indexes in trapper schema:'
SELECT COUNT(*) AS total_indexes
FROM pg_indexes
WHERE schemaname = 'trapper';

\echo ''
SELECT 'MIG_264 Complete' AS status;
