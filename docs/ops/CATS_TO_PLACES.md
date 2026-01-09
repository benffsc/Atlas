# Cat-to-Place Linking (ATLAS_013)

Links canonical cats to canonical places using owner address signals.

## How It Works

### Signal Path

```
sot_cats
    ↓ person_cat_relationships (owner link)
sot_people
    ↓ person_place_relationships (address link)
places
    ↓
cat_place_relationships (derived)
```

### Link Types

| relationship_type | Description | Confidence |
|-------------------|-------------|------------|
| `home` | Cat's home via owner's geocoded address | high |
| `appointment_site` | Location where cat had an appointment | low-medium |
| `trapped_at` | Location where cat was trapped (future) | medium |

### Confidence Levels

- **high**: Owner has a geocoded address linked to a place
- **medium**: Address exists but place linkage is indirect
- **low**: Approximate or inferred location

## Usage

### Run Linker

```bash
./scripts/post_ingest/atlas_013_link_cats_to_places.sh
```

Or manually:

```sql
-- Link cats to places
SELECT * FROM trapper.link_cats_to_places();

-- Update place activity flags
SELECT trapper.update_place_cat_activity_flags();

-- Check results
SELECT * FROM trapper.v_cat_place_stats;
```

### Query Views

```sql
-- Best place per cat
SELECT * FROM trapper.v_cat_primary_place
WHERE place_id IS NOT NULL
LIMIT 20;

-- Places with cats
SELECT * FROM trapper.v_places_with_cat_activity
ORDER BY total_cats DESC
LIMIT 20;
```

### SQL Files

```bash
psql "$DATABASE_URL" -f sql/queries/QRY_023__cats_places_summary.sql
psql "$DATABASE_URL" -f sql/queries/QRY_024__top_places_by_cat_count.sql
psql "$DATABASE_URL" -f sql/queries/QRY_025__cats_missing_place.sql
```

## Data Model

```
cat_place_relationships
  ├── cat_place_id (PK)
  ├── cat_id (FK → sot_cats)
  ├── place_id (FK → places)
  ├── relationship_type (home, appointment_site, trapped_at)
  ├── confidence (high, medium, low)
  ├── source_system, source_table
  ├── evidence (JSONB - audit trail)
  └── created_at
```

### Views

- `v_cat_primary_place` - One row per cat with their "best" place
- `v_places_with_cat_activity` - Places with cat counts and activity flags
- `v_cat_place_stats` - Summary statistics

## What's Implemented

1. **Owner address linking** - Cats linked to places via owner's person_place_relationships
2. **Evidence storage** - Each link stores the method and person_id used
3. **Confidence tracking** - High confidence for direct owner-address links
4. **Activity flags** - Places marked with `has_cat_activity = TRUE`

## What's Deferred

### Not Yet Implemented

1. **Appointment site linking** - ClinicHQ appointment_info doesn't have location fields
   - Future: Add clinic/venue location when available

2. **Trapped-at location** - Linking cats to trapping request locations
   - Requires: Cross-referencing cats with trapping_requests by address

3. **Radius matching** - Finding nearby places when exact match unavailable
   - Would need: PostGIS ST_DWithin queries

4. **Apartment rollups** - Grouping cats by building when unit differs
   - Would need: Address component parsing (street_number + route)

5. **Cross-source place reconciliation** - Merging duplicate places from different sources
   - Would need: Place matching/merge workflow

6. **Address text matching** - Matching raw owner addresses to places without geocoding
   - Would need: Fuzzy address matching algorithm

### Why Deferred

- Keep initial scope focused on surfaceable cat locations
- Avoid complexity before validating the simple path works
- No appointment location data in current ClinicHQ exports
- Additional signals require more sophisticated matching

## Coverage Expectations

With current data:
- **~100 cats** can be linked via owner → place path
- **~8,500 cats** cannot be linked (owners without geocoded addresses)

To improve coverage:
1. Geocode more owner addresses via ATLAS_003 pipeline
2. Re-run `link_cats_to_places()` after new addresses resolve
3. Add appointment site linking when venue data available

## Troubleshooting

### No cats linked

Check person_place_relationships:
```sql
SELECT COUNT(*) FROM trapper.person_place_relationships;
-- If 0, run address geocoding pipeline first
```

### Cats with owners but no place

Owner's address hasn't been geocoded:
```sql
SELECT COUNT(DISTINCT pcr.person_id) AS owners_without_places
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_place_relationships ppr
    WHERE ppr.person_id = trapper.canonical_person_id(pcr.person_id)
  );
```

### Re-running after more geocoding

```sql
-- Safe to re-run - uses ON CONFLICT
SELECT * FROM trapper.link_cats_to_places();
SELECT trapper.update_place_cat_activity_flags();
```
