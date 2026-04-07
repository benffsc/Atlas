# Service Area Boundaries

This directory holds GeoJSON polygons used by the
out-of-service-area pipeline (FFS-1181).

## sonoma_county_boundary.geojson

**Source:** OpenStreetMap (relation 396468) via [Nominatim](https://nominatim.openstreetmap.org/)
**License:** ODbL 1.0 — © OpenStreetMap contributors
**Imported by:** `sql/schema/v2/MIG_3057__service_area_boundary.sql`
**Schema:** Single Feature with a `MultiPolygon` geometry, EPSG:4326.
**Resolution:** Full polygon (5544 points).

### Two versions in this repo

There are two representations of the boundary in the repo:

1. **High-resolution polygon** (this file, 5544 points) — kept here as
   the canonical reference and for any future re-derivation.
2. **Simplified polygon** (~352 points, embedded inline in `MIG_3057`)
   — Douglas-Peucker simplified at epsilon=0.001° (~111m). This is
   what gets loaded into `sot.service_area_boundary` on a fresh DB
   bootstrap. All 7 spot checks pass with the simplified version:
   - Santa Rosa downtown (38.4404, -122.7141) → `'in'`
   - San Rafael (37.9735, -122.5311) → `'out'`
   - Cotati (38.3266, -122.7094) → `'in'`
   - Bodega Bay (38.3333, -123.0481) → `'in'`
   - Healdsburg (38.6102, -122.8694) → `'in'`
   - Petaluma (38.2324, -122.6367) → `'in'`
   - Los Angeles (34.0522, -118.2437) → `'out'`

The buffer width for the soft `'ambiguous'` band is configurable via
`ops.app_config` key `geo.service_area_boundary_buffer_m` (default
2000 meters).

### Replacing with the official Sonoma County GIS Hub polygon

Before flipping the out-of-service-area pipeline to Go Live, you may
want to replace the OSM-derived polygon with the official Sonoma
County GIS Hub polygon for legal/audit cleanliness:

1. Visit https://gis-sonomacounty.hub.arcgis.com/
2. Find the "County Boundary" dataset
3. Download as GeoJSON (EPSG:4326)
4. Save as `sonoma_county_boundary.geojson` (overwrite this file)
5. Re-load via:
   ```sql
   DELETE FROM sot.service_area_boundary WHERE org_slug = 'ffsc';
   INSERT INTO sot.service_area_boundary (org_slug, name, geom, source, source_url)
   SELECT 'ffsc', 'Sonoma County',
          ST_Multi(ST_GeomFromGeoJSON('<paste geometry JSON here>')),
          'sonoma_county_gis_hub',
          'https://gis-sonomacounty.hub.arcgis.com/';
   ```
6. Re-verify the 7 spot checks listed above.
