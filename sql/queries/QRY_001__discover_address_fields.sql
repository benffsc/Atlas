-- QRY_001__discover_address_fields.sql
-- PREWORK for ATLAS_003: Identify best address fields from staged_records payload
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_001__discover_address_fields.sql
--
-- Purpose:
--   Scans JSON payload keys matching '%address%' pattern and ranks by non-blank count.
--   Helps identify PRIMARY_ADDRESS_KEY and SECONDARY_ADDRESS_KEY for extraction.

\echo '============================================'
\echo 'Address Field Discovery for staged_records'
\echo '============================================'

-- ============================================
-- Part 1: Find all address-like keys and their non-blank counts
-- ============================================
\echo ''
\echo 'Address-like fields ranked by non-blank count:'
\echo ''

WITH payload_keys AS (
    SELECT
        sr.id,
        kv.key AS field_name,
        kv.value AS field_value
    FROM trapper.staged_records sr,
         jsonb_each_text(sr.payload) kv
    WHERE sr.source_table = 'trapping_requests'
),
key_stats AS (
    SELECT
        field_name,
        COUNT(*) AS total_rows,
        COUNT(*) FILTER (WHERE field_value IS NOT NULL AND TRIM(field_value) != '') AS non_blank_count,
        ROUND(100.0 * COUNT(*) FILTER (WHERE field_value IS NOT NULL AND TRIM(field_value) != '') / COUNT(*), 1) AS fill_rate_pct,
        -- Sample values (first 3 non-blank)
        (ARRAY_AGG(field_value ORDER BY LENGTH(field_value) DESC) FILTER (WHERE field_value IS NOT NULL AND TRIM(field_value) != ''))[1:3] AS sample_values
    FROM payload_keys
    WHERE LOWER(field_name) LIKE '%address%'
       OR LOWER(field_name) LIKE '%street%'
       OR LOWER(field_name) LIKE '%location%'
    GROUP BY field_name
)
SELECT
    field_name,
    non_blank_count,
    total_rows,
    fill_rate_pct || '%' AS fill_rate,
    CASE
        WHEN ROW_NUMBER() OVER (ORDER BY non_blank_count DESC, fill_rate_pct DESC) = 1 THEN '*** PRIMARY ***'
        WHEN ROW_NUMBER() OVER (ORDER BY non_blank_count DESC, fill_rate_pct DESC) = 2 THEN '** SECONDARY **'
        ELSE ''
    END AS recommendation,
    sample_values[1] AS sample_1
FROM key_stats
ORDER BY non_blank_count DESC, fill_rate_pct DESC;

-- ============================================
-- Part 2: Show related fields (city, zip, state)
-- ============================================
\echo ''
\echo 'Related geographic fields:'
\echo ''

WITH payload_keys AS (
    SELECT
        sr.id,
        kv.key AS field_name,
        kv.value AS field_value
    FROM trapper.staged_records sr,
         jsonb_each_text(sr.payload) kv
    WHERE sr.source_table = 'trapping_requests'
),
key_stats AS (
    SELECT
        field_name,
        COUNT(*) AS total_rows,
        COUNT(*) FILTER (WHERE field_value IS NOT NULL AND TRIM(field_value) != '') AS non_blank_count,
        ROUND(100.0 * COUNT(*) FILTER (WHERE field_value IS NOT NULL AND TRIM(field_value) != '') / COUNT(*), 1) AS fill_rate_pct
    FROM payload_keys
    WHERE LOWER(field_name) LIKE '%city%'
       OR LOWER(field_name) LIKE '%zip%'
       OR LOWER(field_name) LIKE '%postal%'
       OR LOWER(field_name) LIKE '%state%'
       OR LOWER(field_name) LIKE '%county%'
    GROUP BY field_name
)
SELECT
    field_name,
    non_blank_count,
    fill_rate_pct || '%' AS fill_rate
FROM key_stats
ORDER BY non_blank_count DESC;

-- ============================================
-- Part 3: Sample full addresses for validation
-- ============================================
\echo ''
\echo 'Sample full addresses (top 5):'
\echo ''

SELECT
    sr.id AS staged_record_id,
    sr.source_row_id,
    -- Try common address field names
    COALESCE(
        payload->>'Address',
        payload->>'address',
        payload->>'Street Address',
        payload->>'street_address',
        payload->>'Location Address',
        payload->>'Cats Address',
        payload->>'cats_address'
    ) AS detected_address,
    COALESCE(
        payload->>'City',
        payload->>'city'
    ) AS detected_city,
    COALESCE(
        payload->>'Zip',
        payload->>'zip',
        payload->>'ZIP',
        payload->>'Postal Code'
    ) AS detected_zip
FROM trapper.staged_records sr
WHERE sr.source_table = 'trapping_requests'
  AND (
      payload->>'Address' IS NOT NULL
      OR payload->>'address' IS NOT NULL
      OR payload->>'Street Address' IS NOT NULL
      OR payload->>'Cats Address' IS NOT NULL
  )
LIMIT 5;

\echo ''
\echo 'Discovery complete. Update PRIMARY_ADDRESS_KEY and SECONDARY_ADDRESS_KEY'
\echo 'in the candidate extraction view based on results above.'
\echo ''
