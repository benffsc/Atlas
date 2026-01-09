-- CHK_033__review_queue_v2_distinct_counts
-- Total rows + distinct addresses in v2 queue
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT address_id) AS distinct_addresses
FROM trapper.v_address_review_queue_v2;
