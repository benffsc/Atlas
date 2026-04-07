-- MIG_3057: Service Area Boundary (PostGIS) + Auto-Populate Trigger
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 1 / FFS-1183.
--
-- Purpose: stand up the data layer so every intake submission with
-- geocoded coords automatically gets a 3-state service_area_status:
--
--   'in'         — inside Sonoma County, NOT near the edge
--   'ambiguous'  — within geo.service_area_boundary_buffer_m of the edge
--   'out'        — outside Sonoma County, NOT near the edge
--   'unknown'    — no lat/lng available
--
-- This replaces the broken Airtable-era city-name string matching.
-- The buffer width is admin-configurable via ops.app_config.
--
-- White-label note: the org_slug column on sot.service_area_boundary
-- supports multiple orgs in the future. For now we seed a single row
-- with org_slug='ffsc'.
--
-- Depends on:
--   - MIG_0000 (PostGIS extension)
--   - ops.intake_submissions (existing table with geo_latitude/longitude)
--   - ops.app_config (MIG_2926)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3057: Service Area Boundary (PostGIS)'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Create boundary table
-- ============================================================================

\echo '1. Creating sot.service_area_boundary...'

CREATE TABLE IF NOT EXISTS sot.service_area_boundary (
  boundary_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_slug     TEXT NOT NULL,
  name         TEXT NOT NULL,
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  source       TEXT NOT NULL,
  source_url   TEXT,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_area_boundary_geom
  ON sot.service_area_boundary USING GIST (geom);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_area_boundary_org_slug
  ON sot.service_area_boundary (org_slug);

COMMENT ON TABLE sot.service_area_boundary IS
'MIG_3057 (FFS-1183): PostGIS polygon defining an org service area.
Used by sot.service_area_membership() to classify geocoded points as
in / ambiguous / out. White-label friendly via org_slug.';

-- ============================================================================
-- 2. Seed app_config keys
-- ============================================================================

\echo '2. Seeding app_config keys...'

INSERT INTO ops.app_config (key, value, category, description)
VALUES
  (
    'geo.service_area_boundary_buffer_m',
    '2000'::jsonb,
    'spatial',
    'Distance (meters) from the service area boundary edge that counts as ambiguous. Points within this buffer of the edge are classified ambiguous instead of in/out.'
  ),
  (
    'geo.service_area_boundary_org_slug',
    '"ffsc"'::jsonb,
    'spatial',
    'org_slug used to look up the active service area boundary.'
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. Service area membership function
-- ============================================================================

\echo '3. Creating sot.service_area_membership()...'

CREATE OR REPLACE FUNCTION sot.service_area_membership(
  p_lat NUMERIC,
  p_lng NUMERIC
) RETURNS TEXT AS $$
DECLARE
  v_buffer_m INT;
  v_org_slug TEXT;
  v_point    geometry;
  v_inside   BOOLEAN;
  v_near_edge BOOLEAN;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN 'unknown';
  END IF;

  -- Read configurable buffer (default 2000m)
  SELECT (value)::TEXT::INT INTO v_buffer_m
    FROM ops.app_config
   WHERE key = 'geo.service_area_boundary_buffer_m';
  v_buffer_m := COALESCE(v_buffer_m, 2000);

  SELECT REPLACE((value)::TEXT, '"', '') INTO v_org_slug
    FROM ops.app_config
   WHERE key = 'geo.service_area_boundary_org_slug';
  v_org_slug := COALESCE(v_org_slug, 'ffsc');

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  -- ST_Covers (NOT ST_Contains) so on-the-line points are 'in', not 'out'
  SELECT ST_Covers(geom, v_point)
    INTO v_inside
    FROM sot.service_area_boundary
   WHERE org_slug = v_org_slug
   LIMIT 1;

  -- ST_DWithin against the boundary edge for the soft buffer
  SELECT ST_DWithin(
           ST_Boundary(geom)::geography,
           v_point::geography,
           v_buffer_m
         )
    INTO v_near_edge
    FROM sot.service_area_boundary
   WHERE org_slug = v_org_slug
   LIMIT 1;

  IF v_inside IS NULL THEN
    -- No boundary configured for this org → can't classify
    RETURN 'unknown';
  END IF;

  IF v_inside AND NOT COALESCE(v_near_edge, FALSE) THEN
    RETURN 'in';
  ELSIF NOT v_inside AND NOT COALESCE(v_near_edge, FALSE) THEN
    RETURN 'out';
  ELSE
    RETURN 'ambiguous';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.service_area_membership IS
'MIG_3057 (FFS-1183): Returns ''in'' / ''ambiguous'' / ''out'' / ''unknown''
for a lat/lng. Uses ST_Covers (boundary inclusive) and ST_DWithin against
the boundary edge with a configurable buffer (geo.service_area_boundary_buffer_m).';

-- ============================================================================
-- 4. Add columns to ops.intake_submissions
-- ============================================================================

\echo '4. Adding service_area_status columns to ops.intake_submissions...'

ALTER TABLE ops.intake_submissions
  ADD COLUMN IF NOT EXISTS service_area_status TEXT
    CHECK (service_area_status IN ('in','ambiguous','out','unknown')),
  ADD COLUMN IF NOT EXISTS service_area_status_source TEXT
    DEFAULT 'auto'
    CHECK (service_area_status_source IN ('auto','staff_override')),
  ADD COLUMN IF NOT EXISTS service_area_status_set_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_intake_submissions_service_area_status
  ON ops.intake_submissions (service_area_status)
  WHERE service_area_status IS NOT NULL;

COMMENT ON COLUMN ops.intake_submissions.service_area_status IS
'MIG_3057 (FFS-1183): 3-state classification — in / ambiguous / out / unknown.
Auto-populated by trg_intake_submissions_service_area on INSERT/UPDATE of geo_latitude/geo_longitude. Staff overrides set service_area_status_source=staff_override and the trigger never overwrites.';

-- ============================================================================
-- 5. Trigger function — auto-populate on insert/update
-- ============================================================================

\echo '5. Creating trigger function...'

CREATE OR REPLACE FUNCTION ops.compute_service_area_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Never overwrite a staff override
  IF NEW.service_area_status_source = 'staff_override' THEN
    RETURN NEW;
  END IF;

  IF NEW.geo_latitude IS NOT NULL AND NEW.geo_longitude IS NOT NULL THEN
    NEW.service_area_status := sot.service_area_membership(
      NEW.geo_latitude,
      NEW.geo_longitude
    );
    NEW.service_area_status_set_at := NOW();
    NEW.service_area_status_source := 'auto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_submissions_service_area
  ON ops.intake_submissions;

CREATE TRIGGER trg_intake_submissions_service_area
  BEFORE INSERT OR UPDATE OF geo_latitude, geo_longitude
  ON ops.intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION ops.compute_service_area_status();

COMMENT ON FUNCTION ops.compute_service_area_status IS
'MIG_3057 (FFS-1183): Trigger function. Auto-populates service_area_status
from geo_latitude/geo_longitude unless staff_override is set.';

-- ============================================================================
-- 6. Import boundary geometry
--
-- This block embeds a Douglas-Peucker simplified (epsilon=0.001°, ~352
-- points, 7.7KB) version of the Sonoma County administrative boundary
-- fetched from OpenStreetMap via Nominatim. All 7 spot checks pass:
--
--   Santa Rosa downtown (38.4404, -122.7141)  → 'in'  ✓
--   San Rafael          (37.9735, -122.5311)  → 'out' ✓
--   Cotati              (38.3266, -122.7094)  → 'in'  ✓
--   Bodega Bay          (38.3333, -123.0481)  → 'in'  ✓
--   Healdsburg          (38.6102, -122.8694)  → 'in'  ✓
--   Petaluma            (38.2324, -122.6367)  → 'in'  ✓
--   Los Angeles         (34.0522, -118.2437)  → 'out' ✓
--
-- The full-resolution polygon (5544 points) lives in
-- data/boundaries/sonoma_county_boundary.geojson. To replace the
-- embedded simplified polygon with the official Sonoma County GIS
-- Hub polygon (recommended before Go Live), follow the steps in
-- data/boundaries/README.md.
--
-- Source: OpenStreetMap (relation 396468) via Nominatim
-- License: ODbL 1.0 — © OpenStreetMap contributors
-- ============================================================================

\echo '6. Importing FFSC service area boundary (OSM-derived simplified polygon)...'

DELETE FROM sot.service_area_boundary WHERE org_slug = 'ffsc';

INSERT INTO sot.service_area_boundary (org_slug, name, geom, source, source_url)
VALUES (
  'ffsc',
  'Sonoma County',
  ST_Multi(
    ST_GeomFromText(
      'MULTIPOLYGON(((-123.632497 38.758119,-123.615205 38.749912,-123.607061 38.748565,-123.591962 38.740227,-123.586915 38.728075,-123.578005 38.717583,-123.566089 38.709021,-123.549463 38.700135,-123.531889 38.693421,-123.51058 38.68089,-123.498669 38.668943,-123.495084 38.660662,-123.488543 38.651466,-123.477373 38.642226,-123.470521 38.638578,-123.456159 38.614788,-123.448391 38.606292,-123.43049 38.591672,-123.425389 38.582844,-123.394157 38.553942,-123.384567 38.537022,-123.360929 38.510202,-123.348529 38.504241,-123.330921 38.502421,-123.330725 38.499913,-123.32381 38.498614,-123.317345 38.488638,-123.306742 38.478681,-123.289685 38.46758,-123.269188 38.457569,-123.251121 38.452079,-123.236391 38.450428,-123.228013 38.444228,-123.22022 38.441954,-123.204071 38.423903,-123.196159 38.410108,-123.188465 38.40286,-123.171711 38.394079,-123.164757 38.388337,-123.159847 38.374917,-123.155743 38.368396,-123.134312 38.345786,-123.139822 38.331971,-123.141882 38.319379,-123.140681 38.308267,-123.134523 38.296263,-123.123774 38.285787,-123.116335 38.272233,-123.10758 38.264551,-123.100963 38.261358,-123.053297 38.217094,-123.057566 38.228166,-123.059288 38.239618,-123.057575 38.252615,-123.053064 38.262653,-123.063226 38.279133,-123.067155 38.295144,-123.003668 38.2965,-122.993837 38.299673,-122.994896 38.306175,-122.991129 38.305567,-122.987639 38.308162,-122.984722 38.308017,-122.982274 38.311081,-122.974391 38.311512,-122.970346 38.309979,-122.967429 38.316359,-122.964999 38.317278,-122.946994 38.311174,-122.944113 38.312703,-122.939694 38.310833,-122.934261 38.314045,-122.936838 38.311352,-122.935468 38.309571,-122.932436 38.311815,-122.925888 38.312794,-122.921854 38.308406,-122.917965 38.310246,-122.916559 38.312773,-122.920941 38.316956,-122.91583 38.320343,-122.908364 38.320752,-122.906645 38.319768,-122.910673 38.317401,-122.909475 38.314367,-122.899683 38.316662,-122.898207 38.314335,-122.739954 38.207003,-122.722558 38.20708,-122.71504 38.203471,-122.714189 38.200864,-122.709675 38.197338,-122.707279 38.196791,-122.704745 38.198723,-122.70089 38.195977,-122.687765 38.194753,-122.680508 38.189682,-122.667139 38.189762,-122.663649 38.186291,-122.659048 38.186985,-122.649083 38.181134,-122.637988 38.180284,-122.633857 38.178424,-122.628214 38.178834,-122.625644 38.182359,-122.622641 38.182678,-122.604324 38.180621,-122.59856 38.186888,-122.592779 38.188765,-122.590799 38.185942,-122.582362 38.188016,-122.580018 38.185543,-122.578681 38.187269,-122.574479 38.186019,-122.573681 38.183276,-122.57059 38.183625,-122.573247 38.186262,-122.570885 38.187294,-122.565208 38.182488,-122.56835 38.176862,-122.564305 38.174517,-122.563854 38.169725,-122.552204 38.169096,-122.552412 38.16729,-122.557829 38.163894,-122.558055 38.160317,-122.548679 38.157262,-122.544495 38.158729,-122.534807 38.149353,-122.51984 38.140614,-122.513885 38.133546,-122.509007 38.119128,-122.500655 38.111932,-122.352458 38.069527,-122.407528 38.157733,-122.403639 38.160597,-122.39541 38.161524,-122.38343 38.160961,-122.372492 38.157695,-122.366849 38.159728,-122.365686 38.166333,-122.369749 38.175263,-122.369124 38.182037,-122.366173 38.183878,-122.359714 38.181766,-122.357822 38.182738,-122.357058 38.190421,-122.360566 38.195271,-122.36027 38.197198,-122.356155 38.19727,-122.351068 38.192763,-122.349749 38.193693,-122.350773 38.202026,-122.359159 38.209719,-122.357805 38.212393,-122.359576 38.218743,-122.358309 38.227424,-122.360618 38.229482,-122.365254 38.246347,-122.368865 38.247511,-122.370497 38.244645,-122.374004 38.244484,-122.373501 38.247712,-122.376843 38.248572,-122.384543 38.254629,-122.389839 38.260568,-122.387478 38.273466,-122.389179 38.274331,-122.397269 38.272206,-122.400256 38.274334,-122.404787 38.281658,-122.402114 38.284384,-122.400933 38.289393,-122.403728 38.299708,-122.400637 38.303117,-122.39463 38.304551,-122.396332 38.309057,-122.401853 38.314046,-122.405447 38.322004,-122.408068 38.320098,-122.409353 38.320816,-122.409579 38.325652,-122.413815 38.331032,-122.41234 38.334399,-122.416871 38.33731,-122.417461 38.339593,-122.419927 38.338317,-122.421108 38.339228,-122.4251 38.345331,-122.427184 38.346018,-122.42668 38.348714,-122.430639 38.352163,-122.440535 38.358699,-122.447515 38.359399,-122.45722 38.367204,-122.456837 38.370677,-122.453122 38.374444,-122.449233 38.37539,-122.447914 38.379237,-122.454441 38.382724,-122.453903 38.384123,-122.456108 38.386138,-122.465848 38.390486,-122.47031 38.397464,-122.468053 38.400171,-122.470692 38.402566,-122.470536 38.405035,-122.474303 38.405665,-122.476803 38.410214,-122.49788 38.424478,-122.493592 38.429078,-122.494512 38.431213,-122.486109 38.438156,-122.485797 38.441377,-122.47998 38.451152,-122.49248 38.454753,-122.493539 38.456655,-122.4988 38.455551,-122.509321 38.457768,-122.508557 38.459918,-122.51005 38.4622,-122.505884 38.464625,-122.515954 38.470741,-122.529617 38.469589,-122.531301 38.478581,-122.53644 38.48281,-122.541111 38.491994,-122.544826 38.495631,-122.54328 38.498685,-122.537968 38.497956,-122.53552 38.501551,-122.541405 38.504103,-122.542777 38.507366,-122.545937 38.506968,-122.548767 38.511219,-122.542309 38.51338,-122.542794 38.515553,-122.545347 38.516654,-122.543559 38.518174,-122.54453 38.520508,-122.550607 38.522104,-122.554496 38.526228,-122.566598 38.525454,-122.566597 38.528225,-122.569948 38.529959,-122.569931 38.533162,-122.574306 38.540505,-122.577535 38.54254,-122.582258 38.549456,-122.585747 38.5495,-122.587605 38.552661,-122.600453 38.55576,-122.603352 38.558884,-122.619308 38.559595,-122.621547 38.563275,-122.620401 38.565714,-122.62271 38.567816,-122.626911 38.570119,-122.631843 38.569553,-122.630575 38.578755,-122.634586 38.58175,-122.635054 38.58642,-122.646808 38.598465,-122.644829 38.603303,-122.639708 38.608086,-122.639638 38.611871,-122.633475 38.616394,-122.633666 38.620098,-122.628353 38.622911,-122.629534 38.627276,-122.632537 38.628007,-122.631947 38.631984,-122.633995 38.637339,-122.632711 38.640412,-122.627589 38.644506,-122.623162 38.653057,-122.62429 38.657981,-122.623423 38.664453,-122.627503 38.668256,-122.625211 38.673985,-122.631843 38.680368,-122.633614 38.685209,-122.639361 38.689404,-122.637052 38.693776,-122.643945 38.698871,-122.643719 38.702642,-122.647452 38.706947,-122.662261 38.705924,-122.669397 38.708472,-122.673217 38.706225,-122.676706 38.708033,-122.682765 38.707883,-122.68379 38.709445,-122.695526 38.713094,-122.697419 38.718169,-122.69636 38.720203,-122.700701 38.726315,-122.700753 38.728631,-122.710736 38.732383,-122.711951 38.737703,-122.710961 38.73994,-122.712403 38.742007,-122.708687 38.746495,-122.708653 38.74863,-122.719217 38.753212,-122.72157 38.756664,-122.724087 38.756616,-122.722889 38.763039,-122.728497 38.766503,-122.729591 38.770638,-122.734496 38.772406,-122.735989 38.774523,-122.735529 38.777847,-122.738029 38.780984,-122.742422 38.782418,-122.748255 38.787856,-122.746354 38.799319,-122.747795 38.80326,-122.759696 38.808048,-122.761111 38.81075,-122.767344 38.813727,-122.76573 38.81458,-122.768663 38.816591,-122.769991 38.819941,-122.775599 38.822156,-122.780287 38.826855,-122.786025 38.82724,-122.791416 38.830385,-122.796329 38.83891,-122.806121 38.836214,-122.812137 38.838301,-122.811581 38.842288,-122.818257 38.844218,-122.816651 38.847978,-122.818721 38.851484,-122.840034 38.849785,-123.080836 38.852221,-123.08127 38.838284,-123.136445 38.839576,-123.13602 38.808974,-123.251119 38.808871,-123.368385 38.806503,-123.368238 38.777175,-123.431866 38.776387,-123.499548 38.778974,-123.499653 38.77386,-123.507144 38.773463,-123.509887 38.767202,-123.516224 38.767791,-123.519905 38.758434,-123.533638 38.768768,-123.632497 38.758119)))',
      4326
    )
  ),
  'openstreetmap_nominatim_simplified',
  'https://nominatim.openstreetmap.org/details?osmtype=R&osmid=396468'
);

-- ============================================================================
-- 7. Verification
-- ============================================================================

\echo '7. Verification — spot checks...'

DO $$
DECLARE
  v_santa_rosa TEXT;
  v_san_rafael TEXT;
  v_los_angeles TEXT;
  v_cotati TEXT;
  v_bodega_bay TEXT;
  v_healdsburg TEXT;
  v_petaluma TEXT;
BEGIN
  SELECT sot.service_area_membership(38.4404, -122.7141) INTO v_santa_rosa;
  SELECT sot.service_area_membership(37.9735, -122.5311) INTO v_san_rafael;
  SELECT sot.service_area_membership(34.0522, -118.2437) INTO v_los_angeles;
  SELECT sot.service_area_membership(38.3266, -122.7094) INTO v_cotati;
  SELECT sot.service_area_membership(38.3333, -123.0481) INTO v_bodega_bay;
  SELECT sot.service_area_membership(38.6102, -122.8694) INTO v_healdsburg;
  SELECT sot.service_area_membership(38.2324, -122.6367) INTO v_petaluma;

  RAISE NOTICE '   Santa Rosa downtown (38.44, -122.71) → %', v_santa_rosa;
  RAISE NOTICE '   San Rafael          (37.97, -122.53) → %', v_san_rafael;
  RAISE NOTICE '   Cotati              (38.33, -122.71) → %', v_cotati;
  RAISE NOTICE '   Bodega Bay          (38.33, -123.05) → %', v_bodega_bay;
  RAISE NOTICE '   Healdsburg          (38.61, -122.87) → %', v_healdsburg;
  RAISE NOTICE '   Petaluma            (38.23, -122.64) → %', v_petaluma;
  RAISE NOTICE '   Los Angeles         (34.05, -118.24) → %', v_los_angeles;

  -- Santa Rosa is well-inside; should be 'in' (not ambiguous)
  IF v_santa_rosa <> 'in' THEN
    RAISE WARNING 'Santa Rosa expected ''in'', got %', v_santa_rosa;
  END IF;
  -- San Rafael is in Marin, well-outside; should be 'out'
  IF v_san_rafael <> 'out' THEN
    RAISE WARNING 'San Rafael expected ''out'', got %', v_san_rafael;
  END IF;
  -- LA is unambiguously out
  IF v_los_angeles <> 'out' THEN
    RAISE WARNING 'Los Angeles expected ''out'', got %', v_los_angeles;
  END IF;
  -- Cotati and Bodega Bay are inside but near edge — could be 'in' or 'ambiguous'
  IF v_cotati NOT IN ('in', 'ambiguous') THEN
    RAISE WARNING 'Cotati expected ''in'' or ''ambiguous'', got %', v_cotati;
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3057 complete'
\echo ''
