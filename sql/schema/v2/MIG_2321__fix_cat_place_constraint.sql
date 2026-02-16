-- ============================================================================
-- MIG_2321: Fix cat_place duplicate constraint
-- ============================================================================
-- Issue: V2 has two unique constraints on sot.cat_place:
--   1. cat_place_cat_place_unique (cat_id, place_id) - TOO restrictive
--   2. cat_place_cat_id_place_id_relationship_type_key (cat_id, place_id, relationship_type) - CORRECT
--
-- The first constraint prevents a cat from having multiple relationship types
-- with the same place (e.g., 'home' and 'colony_member'), which is valid.
--
-- This migration drops the redundant restrictive constraint.
-- ============================================================================

\echo '=== MIG_2321: Fix cat_place duplicate constraint ==='

-- Drop the over-restrictive constraint
ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS cat_place_cat_place_unique;

\echo 'Dropped cat_place_cat_place_unique constraint'
\echo 'Remaining constraint: cat_place_cat_id_place_id_relationship_type_key'
\echo 'MIG_2321 Complete!'
