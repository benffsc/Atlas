-- MIG_265: Add Missing FK Cascades
--
-- Problem:
--   Relationship tables don't have ON DELETE CASCADE constraints,
--   which can cause orphaned records or FK violations when deleting entities.
--
-- Solution:
--   Add ON DELETE CASCADE to relationship table foreign keys.
--   This allows proper cleanup when parent entities are deleted.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_265__fk_cascades.sql

\echo ''
\echo '=============================================='
\echo 'MIG_265: FK Cascades'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. person_place_relationships
-- ============================================================

\echo '1. Updating person_place_relationships FK constraints...'

-- Drop existing constraints (if any)
ALTER TABLE trapper.person_place_relationships
DROP CONSTRAINT IF EXISTS person_place_relationships_person_id_fkey;

ALTER TABLE trapper.person_place_relationships
DROP CONSTRAINT IF EXISTS person_place_relationships_place_id_fkey;

-- Add with CASCADE
ALTER TABLE trapper.person_place_relationships
ADD CONSTRAINT person_place_relationships_person_id_fkey
FOREIGN KEY (person_id) REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE;

ALTER TABLE trapper.person_place_relationships
ADD CONSTRAINT person_place_relationships_place_id_fkey
FOREIGN KEY (place_id) REFERENCES trapper.places(place_id) ON DELETE CASCADE;

-- ============================================================
-- 2. person_cat_relationships
-- ============================================================

\echo '2. Updating person_cat_relationships FK constraints...'

ALTER TABLE trapper.person_cat_relationships
DROP CONSTRAINT IF EXISTS person_cat_relationships_person_id_fkey;

ALTER TABLE trapper.person_cat_relationships
DROP CONSTRAINT IF EXISTS person_cat_relationships_cat_id_fkey;

ALTER TABLE trapper.person_cat_relationships
ADD CONSTRAINT person_cat_relationships_person_id_fkey
FOREIGN KEY (person_id) REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE;

ALTER TABLE trapper.person_cat_relationships
ADD CONSTRAINT person_cat_relationships_cat_id_fkey
FOREIGN KEY (cat_id) REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE;

-- ============================================================
-- 3. cat_place_relationships
-- ============================================================

\echo '3. Updating cat_place_relationships FK constraints...'

ALTER TABLE trapper.cat_place_relationships
DROP CONSTRAINT IF EXISTS cat_place_relationships_cat_id_fkey;

ALTER TABLE trapper.cat_place_relationships
DROP CONSTRAINT IF EXISTS cat_place_relationships_place_id_fkey;

ALTER TABLE trapper.cat_place_relationships
ADD CONSTRAINT cat_place_relationships_cat_id_fkey
FOREIGN KEY (cat_id) REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE;

ALTER TABLE trapper.cat_place_relationships
ADD CONSTRAINT cat_place_relationships_place_id_fkey
FOREIGN KEY (place_id) REFERENCES trapper.places(place_id) ON DELETE CASCADE;

-- ============================================================
-- 4. person_identifiers
-- ============================================================

\echo '4. Updating person_identifiers FK constraints...'

ALTER TABLE trapper.person_identifiers
DROP CONSTRAINT IF EXISTS person_identifiers_person_id_fkey;

ALTER TABLE trapper.person_identifiers
ADD CONSTRAINT person_identifiers_person_id_fkey
FOREIGN KEY (person_id) REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE;

-- ============================================================
-- 5. cat_identifiers
-- ============================================================

\echo '5. Updating cat_identifiers FK constraints...'

ALTER TABLE trapper.cat_identifiers
DROP CONSTRAINT IF EXISTS cat_identifiers_cat_id_fkey;

ALTER TABLE trapper.cat_identifiers
ADD CONSTRAINT cat_identifiers_cat_id_fkey
FOREIGN KEY (cat_id) REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE;

-- ============================================================
-- 6. request_trapper_assignments
-- ============================================================

\echo '6. Updating request_trapper_assignments FK constraints...'

ALTER TABLE trapper.request_trapper_assignments
DROP CONSTRAINT IF EXISTS request_trapper_assignments_request_id_fkey;

ALTER TABLE trapper.request_trapper_assignments
DROP CONSTRAINT IF EXISTS request_trapper_assignments_trapper_person_id_fkey;

ALTER TABLE trapper.request_trapper_assignments
ADD CONSTRAINT request_trapper_assignments_request_id_fkey
FOREIGN KEY (request_id) REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE;

ALTER TABLE trapper.request_trapper_assignments
ADD CONSTRAINT request_trapper_assignments_trapper_person_id_fkey
FOREIGN KEY (trapper_person_id) REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE;

-- ============================================================
-- 7. request_cat_links
-- ============================================================

\echo '7. Updating request_cat_links FK constraints...'

ALTER TABLE trapper.request_cat_links
DROP CONSTRAINT IF EXISTS request_cat_links_request_id_fkey;

ALTER TABLE trapper.request_cat_links
DROP CONSTRAINT IF EXISTS request_cat_links_cat_id_fkey;

ALTER TABLE trapper.request_cat_links
ADD CONSTRAINT request_cat_links_request_id_fkey
FOREIGN KEY (request_id) REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE;

ALTER TABLE trapper.request_cat_links
ADD CONSTRAINT request_cat_links_cat_id_fkey
FOREIGN KEY (cat_id) REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE;

-- ============================================================
-- 8. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'FK constraints with CASCADE:'
SELECT
    tc.table_name,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'trapper'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND rc.delete_rule = 'CASCADE'
ORDER BY tc.table_name;

\echo ''
SELECT 'MIG_265 Complete' AS status;
