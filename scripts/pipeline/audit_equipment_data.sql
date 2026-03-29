-- =============================================================================
-- Equipment Data Audit
-- Run this BEFORE applying MIG_2977/2978 to understand what we're working with.
-- =============================================================================

-- 1. What Airtable fields exist in the raw equipment payloads?
--    This shows ALL fields, including any we're NOT importing.
SELECT '=== EQUIPMENT TABLE: ALL AIRTABLE FIELD NAMES ===' AS section;

SELECT
    key AS airtable_field,
    COUNT(*) AS records_with_field,
    ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'airtable' AND source_table = 'equipment') * 100, 1) AS pct_populated
FROM ops.staged_records sr,
     jsonb_each_text(sr.payload) AS kv(key, value)
WHERE sr.source_system = 'airtable' AND sr.source_table = 'equipment'
GROUP BY key
ORDER BY records_with_field DESC;


-- 2. What Airtable fields exist in the checkout log payloads?
SELECT '=== CHECKOUT LOG: ALL AIRTABLE FIELD NAMES ===' AS section;

SELECT
    key AS airtable_field,
    COUNT(*) AS records_with_field,
    ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM ops.staged_records WHERE source_system = 'airtable' AND source_table = 'checkout_log') * 100, 1) AS pct_populated
FROM ops.staged_records sr,
     jsonb_each_text(sr.payload) AS kv(key, value)
WHERE sr.source_system = 'airtable' AND sr.source_table = 'checkout_log'
GROUP BY key
ORDER BY records_with_field DESC;


-- 3. Check for PHOTO/ATTACHMENT fields (Airtable stores these as JSON arrays)
SELECT '=== PHOTO/ATTACHMENT FIELDS IN EQUIPMENT ===' AS section;

SELECT
    key,
    jsonb_typeof(payload->key) AS json_type,
    LEFT(payload->>key, 200) AS sample_value
FROM ops.staged_records sr,
     jsonb_each(sr.payload) AS kv(key, value)
WHERE sr.source_system = 'airtable' AND sr.source_table = 'equipment'
  AND (
    key ILIKE '%photo%' OR key ILIKE '%image%' OR key ILIKE '%attachment%'
    OR key ILIKE '%picture%' OR key ILIKE '%file%' OR key ILIKE '%media%'
    OR jsonb_typeof(kv.value) = 'array'  -- Airtable attachments are arrays
  )
LIMIT 20;


-- 4. Sample 3 FULL equipment records (all fields)
SELECT '=== SAMPLE EQUIPMENT RECORDS (ALL FIELDS) ===' AS section;

SELECT source_row_id, jsonb_pretty(payload)
FROM ops.staged_records
WHERE source_system = 'airtable' AND source_table = 'equipment'
LIMIT 3;


-- 5. Sample 3 FULL checkout log records
SELECT '=== SAMPLE CHECKOUT RECORDS (ALL FIELDS) ===' AS section;

SELECT source_row_id, jsonb_pretty(payload)
FROM ops.staged_records
WHERE source_system = 'airtable' AND source_table = 'checkout_log'
LIMIT 3;


-- 6. Current equipment name patterns (for barcode extraction validation)
SELECT '=== EQUIPMENT NAME PATTERNS ===' AS section;

SELECT
    equipment_name,
    equipment_type,
    CASE
        WHEN equipment_name ~ '#\w+' THEN 'has_#_number'
        WHEN equipment_name ~ '^\d{3,5}$' THEN 'bare_number'
        WHEN equipment_name ~ '[A-Z]-\d+' THEN 'letter_dash_number'
        WHEN equipment_name ~* 'Camera\s+\d+' THEN 'camera_number'
        ELSE 'other'
    END AS pattern,
    condition,
    is_available
FROM ops.equipment
ORDER BY equipment_type, equipment_name;


-- 7. Checkout data quality: how many have person_id?
SELECT '=== CHECKOUT PERSON RESOLUTION ===' AS section;

SELECT
    COUNT(*) AS total_checkouts,
    COUNT(person_id) AS with_person,
    COUNT(*) - COUNT(person_id) AS without_person,
    ROUND(COUNT(person_id)::numeric / COUNT(*) * 100, 1) AS pct_resolved,
    COUNT(DISTINCT person_id) AS unique_people
FROM ops.equipment_checkouts;


-- 8. What are the checkout notes/actions? (might reveal workflow patterns)
SELECT '=== CHECKOUT ACTION PATTERNS ===' AS section;

SELECT
    notes,
    COUNT(*) AS occurrences
FROM ops.equipment_checkouts
GROUP BY notes
ORDER BY occurrences DESC
LIMIT 20;


-- 9. Equipment types distribution
SELECT '=== EQUIPMENT TYPE DISTRIBUTION ===' AS section;

SELECT
    equipment_type,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE is_available) AS available,
    COUNT(*) FILTER (WHERE NOT is_available) AS checked_out
FROM ops.equipment
GROUP BY equipment_type
ORDER BY count DESC;


-- 10. Are there any staged equipment records NOT in ops.equipment?
--     (records that failed to import)
SELECT '=== STAGED BUT NOT IMPORTED ===' AS section;

SELECT
    sr.source_row_id,
    sr.payload->>'Name' AS name,
    sr.payload->>'Type' AS type
FROM ops.staged_records sr
LEFT JOIN ops.equipment e ON e.source_record_id = sr.source_row_id AND e.source_system = 'airtable'
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'equipment'
  AND e.equipment_id IS NULL;


-- 11. Check if checkout log has any fields we might want for the new event system
SELECT '=== CHECKOUT LOG FIELD SAMPLE VALUES ===' AS section;

SELECT
    key,
    jsonb_typeof(value) AS type,
    CASE
        WHEN jsonb_typeof(value) = 'string' THEN LEFT(value::text, 100)
        WHEN jsonb_typeof(value) = 'array' THEN LEFT(value::text, 200)
        ELSE value::text
    END AS sample
FROM ops.staged_records sr,
     jsonb_each(sr.payload) AS kv(key, value)
WHERE sr.source_system = 'airtable' AND sr.source_table = 'checkout_log'
LIMIT 30;
