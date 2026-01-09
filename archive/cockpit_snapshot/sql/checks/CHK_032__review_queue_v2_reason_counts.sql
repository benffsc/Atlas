-- CHK_032__review_queue_v2_reason_counts
-- Counts review reasons in the v2 address review queue
SELECT
  review_reason,
  COUNT(*) AS n
FROM trapper.v_address_review_queue_v2
GROUP BY review_reason
ORDER BY n DESC, review_reason;
