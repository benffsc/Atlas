-- CHK_031__request_place_address_join_integrity
-- Verifies FK chain: requests -> places -> addresses
SELECT
  (SELECT COUNT(*) FROM trapper.requests) AS total_requests,
  (SELECT COUNT(*) FROM trapper.requests WHERE primary_place_id IS NOT NULL) AS requests_with_place,
  (SELECT COUNT(*) FROM trapper.requests r
    WHERE r.primary_place_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM trapper.places p WHERE p.id = r.primary_place_id)
  ) AS requests_orphan_place_fk,
  (SELECT COUNT(*) FROM trapper.places) AS total_places,
  (SELECT COUNT(*) FROM trapper.places WHERE address_id IS NOT NULL) AS places_with_address,
  (SELECT COUNT(*) FROM trapper.places p
    WHERE p.address_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM trapper.addresses a WHERE a.id = p.address_id)
  ) AS places_orphan_address_fk;
