-- MIG_2976: Ingest pipeline recovery function
-- FFS-740: Auto-recovers stuck batches and retries failed uploads.
-- Called by pg_cron every 10 minutes.

CREATE OR REPLACE FUNCTION ops.recover_stuck_ingest_batches()
RETURNS JSONB AS $$
DECLARE
  v_stuck_reset INT := 0;
  v_retried INT := 0;
  v_max_retries CONSTANT INT := 3;
  v_stuck_threshold CONSTANT INTERVAL := '10 minutes';
  v_results JSONB;
BEGIN
  -- Step 1: Reset uploads stuck in 'staging' or 'post_processing' for too long
  -- These likely timed out or crashed mid-processing.
  UPDATE ops.file_uploads
  SET
    processing_phase = CASE
      WHEN processing_phase = 'staging' THEN 'pending'      -- restart from beginning
      WHEN processing_phase = 'post_processing' THEN 'staged' -- restart from post-processing
      ELSE processing_phase
    END,
    status = 'pending',
    retry_count = retry_count + 1,
    last_error = 'Auto-reset: stuck in ' || processing_phase || ' for >' || v_stuck_threshold::text,
    failed_at_step = processing_phase
  WHERE processing_phase IN ('staging', 'post_processing')
    AND processed_at < NOW() - v_stuck_threshold
    AND retry_count < v_max_retries;

  GET DIAGNOSTICS v_stuck_reset = ROW_COUNT;

  -- Step 2: Mark uploads that exceeded max retries as permanently failed
  UPDATE ops.file_uploads
  SET
    processing_phase = 'failed',
    status = 'failed',
    last_error = 'Exceeded max retry count (' || v_max_retries || ')',
    error_message = COALESCE(error_message, '') || '; Exceeded max retries at ' || NOW()::text
  WHERE processing_phase IN ('staging', 'post_processing')
    AND processed_at < NOW() - v_stuck_threshold
    AND retry_count >= v_max_retries;

  -- Step 3: Count files in 'staged' phase that haven't been picked up
  -- (these should be processed by the cron/process-uploads endpoint)
  SELECT COUNT(*) INTO v_retried
  FROM ops.file_uploads
  WHERE processing_phase = 'staged'
    AND status = 'pending';

  v_results := jsonb_build_object(
    'stuck_reset', v_stuck_reset,
    'awaiting_processing', v_retried,
    'timestamp', NOW()
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.recover_stuck_ingest_batches() IS
  'Called by pg_cron every 10 minutes. Resets stuck uploads and flags permanently failed ones.';
