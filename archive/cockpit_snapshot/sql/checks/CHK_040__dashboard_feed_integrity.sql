-- CHK_040__dashboard_feed_integrity
-- Verifies dashboard feed view integrity
SELECT
  (SELECT COUNT(*) FROM trapper.requests) AS requests_count,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed) AS feed_count,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed WHERE primary_place_id IS NOT NULL AND place_id IS NULL) AS requests_with_place_but_no_place_id,
  (SELECT COUNT(*) FROM trapper.v_requests_dashboard_feed WHERE address_id IS NOT NULL AND (latitude IS NULL OR longitude IS NULL)) AS address_missing_latlng;
