-- VIEW_040__requests_dashboard_feed
-- Read-only view for Trapper Dashboard: requests + place + address + lat/lng
CREATE OR REPLACE VIEW trapper.v_requests_dashboard_feed AS
SELECT
  r.id AS request_id,
  r.case_number,
  r.primary_place_id,
  p.id AS place_id,
  COALESCE(p.name, p.display_name, a.formatted_address, a.raw_address) AS place_display_name,
  a.id AS address_id,
  a.raw_address,
  a.formatted_address,
  a.latitude,
  a.longitude,
  a.location,
  a.location_geog
FROM trapper.requests r
LEFT JOIN trapper.places p ON p.id = r.primary_place_id
LEFT JOIN trapper.addresses a ON a.id = COALESCE(p.primary_address_id, p.address_id);
