# Technical Documentation: Nearby Computation

This document explains how Atlas computes "nearby" requests and places for the engineering team at Beacon.

## Overview

Atlas uses two different methods for computing nearby entities:

1. **Nearby Requests** - Simple bounding box + Pythagorean distance (fast, approximate)
2. **Nearby Places** - PostGIS ST_DWithin with geography type (accurate, slower)

Both are computed **on-the-fly** per request, not pre-cached.

---

## 1. Nearby Requests (Primary Display)

### Where It's Used
- Dashboard request cards (map preview with nearby count badge)
- Request detail page
- API: `GET /api/requests/[id]/map`

### Database Function
**Location:** `sql/schema/sot/MIG_188__request_map_preview.sql` (lines 48-89)

```sql
CREATE OR REPLACE FUNCTION sot.nearby_requests(
    p_latitude DECIMAL,
    p_longitude DECIMAL,
    p_radius_degrees DECIMAL DEFAULT 0.07,  -- ~5 miles
    p_exclude_request_id UUID DEFAULT NULL
)
RETURNS TABLE (
    request_id UUID,
    summary TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    cat_count INT,
    status TEXT,
    priority TEXT,
    marker_size TEXT,
    distance_approx DECIMAL
)
```

### Query Logic

```sql
SELECT
    r.request_id,
    r.summary,
    r.latitude,
    r.longitude,
    COALESCE(r.cat_count, 0) as cat_count,
    r.status,
    r.priority,
    CASE
        WHEN COALESCE(r.cat_count, 0) < 2 THEN 'tiny'
        WHEN COALESCE(r.cat_count, 0) < 7 THEN 'small'
        WHEN COALESCE(r.cat_count, 0) < 20 THEN 'medium'
        ELSE 'large'
    END as marker_size,
    SQRT(POWER(r.latitude - p_latitude, 2) + POWER(r.longitude - p_longitude, 2)) as distance_approx
FROM ops.requests r
WHERE r.latitude IS NOT NULL
    AND r.longitude IS NOT NULL
    -- Bounding box filter (fast index scan)
    AND r.latitude BETWEEN (p_latitude - p_radius_degrees) AND (p_latitude + p_radius_degrees)
    AND r.longitude BETWEEN (p_longitude - p_radius_degrees) AND (p_longitude + p_radius_degrees)
    -- Exclude self
    AND (p_exclude_request_id IS NULL OR r.request_id != p_exclude_request_id)
    -- Only active requests
    AND r.status NOT IN ('cancelled', 'completed')
ORDER BY distance_approx
```

### Key Technical Details

| Aspect | Value |
|--------|-------|
| **Default Radius** | 0.07 degrees |
| **Approximate Distance** | ~5 miles (varies by latitude) |
| **Indexing** | Uses bounding box (BETWEEN) for fast B-tree index scan |
| **Distance Calculation** | Pythagorean: `SQRT((lat1-lat2)² + (lng1-lng2)²)` |
| **Accuracy** | Approximate - not accounting for Earth's curvature |
| **Performance** | Very fast - simple numeric comparisons |
| **Caching** | HTTP Cache-Control: 3600s (1 hour) on API response |

### Why Not PostGIS?

The bounding box approach was chosen because:
1. **Speed** - Simple numeric comparisons are faster than geospatial functions
2. **Good enough** - At city/county scale, the curvature error is negligible
3. **No extensions required** - Works on any Postgres installation
4. **Predictable** - Easy to understand and debug

### Degree to Mile Conversion

At latitude ~38° (Sonoma County):
- 1 degree latitude ≈ 69 miles
- 1 degree longitude ≈ 54 miles (varies with latitude)
- **0.07 degrees ≈ 4.8 miles** (N/S) to **3.8 miles** (E/W)

This creates a roughly circular search area of ~5 mile radius.

---

## 2. Nearby Places (Place Deduplication)

### Where It's Used
- Place creation workflow (detecting duplicates)
- Address lookup
- API: `GET /api/places/nearby`

### Query Logic
**Location:** `apps/web/src/app/api/places/nearby/route.ts` (lines 49-72)

```sql
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    ST_Distance(
        p.location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
    )::INT as distance_meters
FROM sot.places p
WHERE p.location IS NOT NULL
    AND ST_DWithin(
        p.location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        100  -- 100 meters
    )
ORDER BY distance_meters ASC
LIMIT 10
```

### Key Technical Details

| Aspect | Value |
|--------|-------|
| **Radius** | 100 meters (fixed) |
| **Function** | PostGIS `ST_DWithin` |
| **Type** | Geography (accurate spherical calculations) |
| **Result** | Distance in meters |
| **Limit** | 10 results max |
| **Use Case** | Finding exact duplicates |

---

## 3. API Usage

### Get Request with Nearby Count

```bash
GET /api/requests/{request_id}/map

Response:
{
    "request_id": "abc-123",
    "latitude": 38.4088,
    "longitude": -122.8358,
    "nearby_count": 5,
    "nearby_markers": [
        {
            "request_id": "def-456",
            "latitude": 38.4090,
            "longitude": -122.8340,
            "cat_count": 3,
            "marker_size": "small"
        }
    ]
}
```

### Get Nearby Places

```bash
GET /api/places/nearby?lat=38.4088&lng=-122.8358

Response:
{
    "places": [
        {
            "place_id": "xyz-789",
            "display_name": "123 Main St",
            "distance_meters": 45
        }
    ]
}
```

---

## 4. Performance Considerations

### Current Implementation

| Metric | Nearby Requests | Nearby Places |
|--------|-----------------|---------------|
| **Computation** | On-the-fly | On-the-fly |
| **Index Used** | B-tree on lat/lng | GiST on geometry |
| **Typical Query Time** | <10ms | <50ms |
| **Caching** | HTTP 1 hour | None |

### Recommendations for Scale

If performance becomes an issue at scale:

1. **Materialized View** - Pre-compute nearby counts nightly
```sql
CREATE MATERIALIZED VIEW v_request_nearby_counts AS
SELECT
    r.request_id,
    (SELECT COUNT(*) FROM sot.nearby_requests(r.latitude, r.longitude, 0.07, r.request_id)) as nearby_count
FROM ops.requests r
WHERE r.latitude IS NOT NULL;
```

2. **Geohashing** - Add geohash column for faster grouping
```sql
ALTER TABLE ops.requests ADD COLUMN geohash TEXT
    GENERATED ALWAYS AS (ST_GeoHash(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 6)) STORED;
CREATE INDEX idx_requests_geohash ON ops.requests(geohash);
```

3. **PostGIS for Both** - Migrate to full PostGIS for consistency
```sql
-- Add geography column
ALTER TABLE ops.requests ADD COLUMN location GEOGRAPHY(POINT, 4326);
UPDATE ops.requests SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography;
CREATE INDEX idx_requests_location ON ops.requests USING GIST(location);

-- Use ST_DWithin with meters
SELECT * FROM ops.requests
WHERE ST_DWithin(location, ST_MakePoint(-122.8, 38.4)::geography, 8000);  -- 8km
```

---

## 5. Database Schema Reference

### ops.requests (relevant columns)

| Column | Type | Description |
|--------|------|-------------|
| `request_id` | UUID | Primary key |
| `latitude` | DECIMAL | Geocoded latitude |
| `longitude` | DECIMAL | Geocoded longitude |
| `cat_count` | INT | Estimated cat count |
| `status` | TEXT | Request status |
| `priority` | TEXT | Priority level |

### places (relevant columns)

| Column | Type | Description |
|--------|------|-------------|
| `place_id` | UUID | Primary key |
| `location` | GEOMETRY(POINT, 4326) | PostGIS point |
| `latitude` | DECIMAL | Latitude (denormalized) |
| `longitude` | DECIMAL | Longitude (denormalized) |

---

## 6. Configuration

### Environment Variables

```bash
# Not currently configurable - hardcoded values
# Future: NEARBY_RADIUS_DEGREES=0.07
# Future: NEARBY_PLACES_METERS=100
```

### Changing the Radius

To change the nearby radius, modify:

1. **SQL Function** - `sot.nearby_requests()` default parameter
2. **API Calls** - Where `nearby_requests(lat, lng, 0.07, id)` is called
3. **View** - `v_requests_with_map` line 121

---

## Questions?

Contact: ben@forgottenfelines.com

Last Updated: 2026-01-13
