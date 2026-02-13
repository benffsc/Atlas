-- MIG_2023: Fix relationship type constraints
--
-- Updates check constraints to allow all needed relationship_type and evidence_type values
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2023: Fix Relationship Constraints'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX evidence_type CONSTRAINTS
-- ============================================================================

\echo '1. Fixing evidence_type constraints...'

ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_evidence_type_check;
ALTER TABLE sot.person_cat DROP CONSTRAINT IF EXISTS person_cat_evidence_type_check;
ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS cat_place_evidence_type_check;

ALTER TABLE sot.person_place ADD CONSTRAINT person_place_evidence_type_check
    CHECK (evidence_type IN ('manual', 'inferred', 'imported', 'appointment', 'owner_address', 'person_relationship'));
ALTER TABLE sot.person_cat ADD CONSTRAINT person_cat_evidence_type_check
    CHECK (evidence_type IN ('manual', 'inferred', 'imported', 'appointment', 'owner_address', 'person_relationship'));
ALTER TABLE sot.cat_place ADD CONSTRAINT cat_place_evidence_type_check
    CHECK (evidence_type IN ('manual', 'inferred', 'imported', 'appointment', 'owner_address', 'person_relationship'));

\echo '   evidence_type constraints updated'

-- ============================================================================
-- 2. FIX relationship_type CONSTRAINTS
-- ============================================================================

\echo ''
\echo '2. Fixing relationship_type constraints...'

ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS cat_place_relationship_type_check;
ALTER TABLE sot.cat_place ADD CONSTRAINT cat_place_relationship_type_check
    CHECK (relationship_type IN ('home', 'residence', 'colony_member', 'seen_at', 'appointment_site', 'trapped_at', 'relocated_to', 'sighting', 'treated_at', 'found_at'));

ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;
ALTER TABLE sot.person_place ADD CONSTRAINT person_place_relationship_type_check
    CHECK (relationship_type IN ('resident', 'owner', 'manager', 'caretaker', 'works_at', 'volunteers_at', 'requester', 'trapper_at'));

\echo '   relationship_type constraints updated'

\echo ''
\echo '=============================================='
\echo '  MIG_2023 Complete!'
\echo '=============================================='
\echo ''
