-- CHK_041__dashboard_feed_enriched_integrity
-- Verifies enriched dashboard feed view integrity
SELECT
  (SELECT COUNT(*) FROM trapper.requests) AS requests_count,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed_enriched) AS enriched_feed_count,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed_enriched
   WHERE address_id IS NOT NULL AND (latitude IS NULL OR longitude IS NULL)) AS address_missing_latlng,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed_enriched
   WHERE review_reason IS NOT NULL
     AND review_reason NOT IN ('PLUS_CODE', 'NON_ROOFTOP', 'LOW_SIMILARITY')) AS invalid_review_reason;
