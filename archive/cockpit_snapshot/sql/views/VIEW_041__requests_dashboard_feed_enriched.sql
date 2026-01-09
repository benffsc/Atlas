-- VIEW_041__requests_dashboard_feed_enriched
-- Enriched dashboard feed with review_reason + request triage fields
CREATE OR REPLACE VIEW trapper.v_requests_dashboard_feed_enriched AS
SELECT
  feed.request_id,
  feed.case_number,
  feed.primary_place_id,
  feed.place_id,
  feed.place_display_name,
  feed.address_id,
  feed.raw_address,
  feed.formatted_address,
  feed.latitude,
  feed.longitude,
  feed.location,
  feed.location_geog,
  -- Review queue fields (NULL if no review issue)
  rq.review_reason,
  rq.similarity,
  -- Request triage fields
  r.status,
  r.priority,
  r.notes,
  r.source_system,
  r.created_at,
  r.updated_at
FROM trapper.v_requests_dashboard_feed feed
LEFT JOIN trapper.requests r ON r.id = feed.request_id
LEFT JOIN trapper.v_address_review_queue_v2 rq ON rq.address_id = feed.address_id;
