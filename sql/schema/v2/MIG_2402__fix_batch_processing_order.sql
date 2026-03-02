-- MIG_2402__fix_batch_processing_order.sql
-- Fix the processing order for ClinicHQ batch uploads
--
-- Issue: The order was cat_info → owner_info → appointment_info
-- But appointments must exist BEFORE cat_info and owner_info can link to them!
--
-- Correct order:
-- 1. appointment_info - Creates appointments (the anchor records)
-- 2. cat_info - Creates cats, links them to existing appointments
-- 3. owner_info - Creates people/places, links them to existing appointments

\echo ''
\echo '=============================================='
\echo '  MIG_2402: Fix Batch Processing Order'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION ops.get_batch_files_in_order(p_batch_id UUID)
RETURNS TABLE (
    upload_id UUID,
    source_table TEXT,
    status TEXT,
    original_filename TEXT,
    processing_order INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        fu.upload_id,
        fu.source_table,
        fu.status,
        fu.original_filename,
        CASE fu.source_table
            -- appointment_info FIRST: creates the appointment records
            WHEN 'appointment_info' THEN 1
            -- cat_info SECOND: creates cats and links to existing appointments
            WHEN 'cat_info' THEN 2
            -- owner_info THIRD: creates people/places and links to existing appointments
            WHEN 'owner_info' THEN 3
            ELSE 99
        END AS processing_order
    FROM ops.file_uploads fu
    WHERE fu.batch_id = p_batch_id
      AND fu.source_system = 'clinichq'
    ORDER BY
        CASE fu.source_table
            WHEN 'appointment_info' THEN 1
            WHEN 'cat_info' THEN 2
            WHEN 'owner_info' THEN 3
            ELSE 99
        END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.get_batch_files_in_order(UUID) IS 
  'Returns batch files in correct processing order: appointment_info (creates appointments), cat_info (links cats), owner_info (links people)';

\echo ''
\echo '==============================================
\echo '  MIG_2402 Complete!'
\echo '=============================================='
\echo ''
