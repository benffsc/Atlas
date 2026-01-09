-- MIG_010__create_view_021__address_review_queue_v2
-- Creates the v2 address review queue view with improved location_type path detection
BEGIN;

CREATE OR REPLACE VIEW trapper.v_address_review_queue_v2 AS
WITH address_review AS (
  SELECT
    a.id AS address_id,
    a.raw_address,
    a.formatted_address,
    a.latitude,
    a.longitude,
    COALESCE(
      NULLIF(a.geocode_result #>> '{results,0,geometry,location_type}', ''),
      NULLIF(a.geocode_result #>> '{geometry,location_type}', '')
    ) AS location_type,
    similarity(COALESCE(a.raw_address, ''), COALESCE(a.formatted_address, '')) AS sim,
    CASE
      WHEN a.formatted_address ~ '^[A-Z0-9]{4}\+[A-Z0-9]{2}' THEN 'PLUS_CODE'
      WHEN COALESCE(
             NULLIF(a.geocode_result #>> '{results,0,geometry,location_type}', ''),
             NULLIF(a.geocode_result #>> '{geometry,location_type}', '')
           ) IS NOT NULL
           AND COALESCE(
             NULLIF(a.geocode_result #>> '{results,0,geometry,location_type}', ''),
             NULLIF(a.geocode_result #>> '{geometry,location_type}', '')
           ) <> 'ROOFTOP' THEN 'NON_ROOFTOP'
      WHEN similarity(COALESCE(a.raw_address, ''), COALESCE(a.formatted_address, '')) < 0.75 THEN 'LOW_SIMILARITY'
      ELSE 'OK'
    END AS review_reason
  FROM trapper.addresses a
  WHERE a.formatted_address IS NOT NULL
)
SELECT DISTINCT ON (ar.address_id)
  ar.address_id,
  ar.raw_address,
  ar.formatted_address,
  ar.location_type,
  ar.sim AS similarity,
  ar.review_reason,
  p.id AS place_id,
  r.case_number
FROM address_review ar
LEFT JOIN LATERAL (
  SELECT pl.id
  FROM trapper.places pl
  WHERE pl.address_id = ar.address_id
  LIMIT 1
) p ON true
LEFT JOIN LATERAL (
  SELECT req.case_number
  FROM trapper.requests req
  JOIN trapper.places pl2 ON pl2.id = req.primary_place_id
  WHERE pl2.address_id = ar.address_id
  LIMIT 1
) r ON true
WHERE ar.review_reason <> 'OK'
ORDER BY ar.address_id;

COMMIT;
