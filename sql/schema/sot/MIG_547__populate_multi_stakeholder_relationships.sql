-- =====================================================
-- MIG_547: Populate Multi-Stakeholder Relationships
-- =====================================================
-- Identifies and creates 'brought_in_by' relationships for
-- cases where a cat was brought in by a different person
-- than the registered owner.
--
-- Example: Gary's cat (981020033918588) was brought in by Heather
-- - Gary = 'owner' (first registered)
-- - Heather = 'brought_in_by' (brought cat in later)
-- =====================================================

\echo '=== MIG_547: Populate Multi-Stakeholder Relationships ==='
\echo ''

-- ============================================================
-- 1. Baseline: Current person_cat_relationships
-- ============================================================

\echo 'Baseline - Current relationships:'
SELECT
    relationship_type,
    COUNT(*) as count
FROM trapper.person_cat_relationships
GROUP BY relationship_type
ORDER BY count DESC;

-- ============================================================
-- 2. Find cats with their first owner (earliest appointment)
-- ============================================================

\echo ''
\echo 'Step 1: Identifying first owner for each cat...'

CREATE TEMP TABLE cat_first_owners AS
SELECT DISTINCT ON (a.cat_id)
    a.cat_id,
    a.person_id as first_owner_person_id,
    p.display_name as first_owner_name,
    p.email as first_owner_email,
    a.appointment_date as first_appointment_date
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON p.person_id = a.person_id
WHERE a.cat_id IS NOT NULL
  AND a.person_id IS NOT NULL
ORDER BY a.cat_id, a.appointment_date ASC, a.created_at ASC;

\echo 'Cats with first owners identified:'
SELECT COUNT(*) as total FROM cat_first_owners;

-- ============================================================
-- 3. Find appointments where a different person brought in the cat
-- ============================================================

\echo ''
\echo 'Step 2: Finding appointments with different contacts...'

CREATE TEMP TABLE multi_stakeholder_appointments AS
SELECT
    a.appointment_id,
    a.cat_id,
    a.person_id as brought_by_person_id,
    p.display_name as brought_by_name,
    a.appointment_date,
    cfo.first_owner_person_id,
    cfo.first_owner_name,
    cfo.first_owner_email
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON p.person_id = a.person_id
JOIN cat_first_owners cfo ON cfo.cat_id = a.cat_id
WHERE a.cat_id IS NOT NULL
  AND a.person_id IS NOT NULL
  AND a.person_id != cfo.first_owner_person_id;

\echo 'Appointments with different person than first owner:'
SELECT COUNT(*) as total FROM multi_stakeholder_appointments;

-- ============================================================
-- 4. Ensure first owners have 'owner' relationships
-- ============================================================

\echo ''
\echo 'Step 3: Ensuring first owners have owner relationships...'

INSERT INTO trapper.person_cat_relationships (
    person_cat_id,
    person_id,
    cat_id,
    relationship_type,
    confidence,
    source_system,
    source_table,
    effective_date,
    created_at
)
SELECT
    gen_random_uuid(),
    cfo.first_owner_person_id,
    cfo.cat_id,
    'owner',
    'high',
    'clinichq',
    'sot_appointments',
    cfo.first_appointment_date,
    NOW()
FROM cat_first_owners cfo
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_cat_relationships pcr
    WHERE pcr.person_id = cfo.first_owner_person_id
      AND pcr.cat_id = cfo.cat_id
      AND pcr.relationship_type = 'owner'
)
ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
DO NOTHING;

-- ============================================================
-- 5. Create 'brought_in_by' relationships
-- ============================================================

\echo ''
\echo 'Step 4: Creating brought_in_by relationships...'

INSERT INTO trapper.person_cat_relationships (
    person_cat_id,
    person_id,
    cat_id,
    relationship_type,
    confidence,
    source_system,
    source_table,
    context_notes,
    appointment_id,
    effective_date,
    created_at
)
SELECT DISTINCT ON (msa.brought_by_person_id, msa.cat_id)
    gen_random_uuid(),
    msa.brought_by_person_id,
    msa.cat_id,
    'brought_in_by',
    'high',
    'clinichq',
    'sot_appointments',
    format(
        'Brought in on %s. Cat''s registered owner is %s.',
        msa.appointment_date::TEXT,
        msa.first_owner_name
    ),
    msa.appointment_id,
    msa.appointment_date,
    NOW()
FROM multi_stakeholder_appointments msa
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_cat_relationships pcr
    WHERE pcr.person_id = msa.brought_by_person_id
      AND pcr.cat_id = msa.cat_id
      AND pcr.relationship_type = 'brought_in_by'
)
ORDER BY msa.brought_by_person_id, msa.cat_id, msa.appointment_date ASC
ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
DO UPDATE SET
    context_notes = COALESCE(EXCLUDED.context_notes, trapper.person_cat_relationships.context_notes),
    appointment_id = COALESCE(trapper.person_cat_relationships.appointment_id, EXCLUDED.appointment_id),
    effective_date = COALESCE(trapper.person_cat_relationships.effective_date, EXCLUDED.effective_date);

DROP TABLE multi_stakeholder_appointments;
DROP TABLE cat_first_owners;

-- ============================================================
-- 6. Update context for existing relationships
-- ============================================================

\echo ''
\echo 'Step 5: Updating context for existing owner relationships...'

-- Add effective_date to owner relationships that don't have it
UPDATE trapper.person_cat_relationships pcr
SET effective_date = (
    SELECT MIN(a.appointment_date)
    FROM trapper.sot_appointments a
    WHERE a.cat_id = pcr.cat_id AND a.person_id = pcr.person_id
)
WHERE pcr.relationship_type = 'owner'
  AND pcr.effective_date IS NULL;

-- ============================================================
-- 7. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Relationship types after migration:'
SELECT
    relationship_type,
    COUNT(*) as count
FROM trapper.person_cat_relationships
GROUP BY relationship_type
ORDER BY count DESC;

\echo ''
\echo 'Cats with multiple stakeholders:'
SELECT COUNT(DISTINCT cat_id) as cats_with_multi_stakeholders
FROM trapper.person_cat_relationships
WHERE cat_id IN (
    SELECT cat_id
    FROM trapper.person_cat_relationships
    GROUP BY cat_id
    HAVING COUNT(DISTINCT person_id) > 1
);

\echo ''
\echo 'Sample brought_in_by relationships:'
SELECT
    c.display_name as cat_name,
    ci.id_value as microchip,
    p.display_name as brought_by,
    pcr.effective_date,
    pcr.context_notes
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE pcr.relationship_type = 'brought_in_by'
ORDER BY pcr.created_at DESC
LIMIT 10;

\echo ''
\echo '====== SPECIFIC VERIFICATION: Heather Singkeo Case ======'

\echo ''
\echo 'Heather Singkeo relationships:'
SELECT
    c.display_name as cat_name,
    ci.id_value as microchip,
    pcr.relationship_type,
    pcr.effective_date,
    pcr.context_notes
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE p.email ILIKE '%singkeo%'
ORDER BY pcr.effective_date;

\echo ''
\echo 'Gary Cassasa relationships:'
SELECT
    c.display_name as cat_name,
    ci.id_value as microchip,
    pcr.relationship_type,
    pcr.effective_date,
    pcr.context_notes
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE p.email ILIKE '%bilbocrash%'
ORDER BY pcr.effective_date;

\echo ''
\echo 'Cat 981020033918588 all stakeholders:'
SELECT
    p.display_name as person_name,
    pcr.relationship_type,
    pcr.effective_date,
    pcr.context_notes
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id
WHERE ci.id_type = 'microchip' AND ci.id_value = '981020033918588';

\echo ''
\echo '=== MIG_547 Complete ==='
