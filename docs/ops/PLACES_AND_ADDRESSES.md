# Places and Addresses (ATLAS_015)

Formalizes the relationship between canonical addresses and places.

## Core Principles

### Address Registry = Canonical Truth

The `sot.addresses` table is the single source of truth for real-world locations:
- Every address is **geocoded** via Google Geocoding API
- Addresses have **structured components** (street_number, route, locality, etc.)
- Addresses have **lat/lng coordinates** for mapping
- Only geocode_status='success' addresses are considered canonical

### Place = Taggable Wrapper

A `place` is a business-domain entity anchored to a canonical address:
- Every address-backed place has exactly one `sot_address_id`
- Places can be tagged with `place_kind` (house, apartment, business, etc.)
- Places track activity flags (has_cat_activity, has_trapping_activity)
- Places support future features (apartment building grouping, neighborhoods)

### Why This Matters

**Houses are valid places** because:
1. The underlying address is real (Google-validated)
2. We can track cats at specific locations
3. We can link owners to their addresses
4. We can later group apartment units into buildings

**We never create places from raw strings** because:
1. Raw addresses may be misspelled or incomplete
2. We can't deduplicate without geocoding
3. We'd create "nonsense" entities that clutter the data

## Data Model

```
sot.addresses (canonical geocoded addresses)
    │
    │ 1:1 (address-backed)
    ▼
sot.places (taggable location entities)
    │
    │ 1:N
    ▼
sot.person_place (who lives/works where)
sot.cat_place (cats at locations)
```

### place_kind Taxonomy

| Kind | Description | Example |
|------|-------------|---------|
| `residential_house` | Single-family home | 123 Main St |
| `apartment_unit` | Individual unit in building | 456 Oak Ave #3 |
| `apartment_building` | Entire multi-unit building | 456 Oak Ave (grouping) |
| `business` | Commercial location | Pet store, grocery |
| `clinic` | Veterinary/animal clinic | Vet offices |
| `neighborhood` | Area grouping (future) | Downtown, etc. |
| `outdoor_site` | Park, trail, colony site | Central Park |
| `unknown` | Not yet classified | Default |

### is_address_backed Flag

| Value | Meaning | sot_address_id |
|-------|---------|----------------|
| `true` | Anchored to canonical address | Required (NOT NULL) |
| `false` | Manual entry (neighborhoods, etc.) | Optional (NULL allowed) |

## Usage

### Ensure All Addresses Have Places

```sql
SELECT * FROM sot.ensure_address_backed_places();
```

Returns:
- `places_created`: New places added
- `places_existing`: Existing places

### Derive Person-Place Relationships

```sql
-- For all sources
SELECT sot.derive_person_place(NULL);

-- For specific source
SELECT sot.derive_person_place('owner_info');
```

This function:
1. First calls `ensure_address_backed_places()` to create missing places
2. Then links people to places via staged_record_address_link
3. Never creates non-address-backed places

### Query Views

```sql
-- All address-backed places with details
SELECT * FROM ops.v_places_address_backed LIMIT 20;

-- Place kind summary
SELECT * FROM ops.v_place_kind_summary;
```

### SQL Files

```bash
psql "$DATABASE_URL" -f sql/queries/QRY_029__place_kind_summary.sql
psql "$DATABASE_URL" -f sql/queries/QRY_030__cats_by_place_kind.sql
```

## Constraints

### CHECK: Address-Backed Must Have Address

```sql
-- Enforced by chk_address_backed_has_address
is_address_backed = false OR sot_address_id IS NOT NULL
```

### UNIQUE: One Place Per Address

```sql
-- Enforced by places_sot_address_id_key
UNIQUE(sot_address_id)
```

## Future: Apartment Building Grouping

When we need to group apartment units:

1. **Current state**: Each unit is a separate place
   - 123 Oak Ave #1 → place (apartment_unit)
   - 123 Oak Ave #2 → place (apartment_unit)
   - 123 Oak Ave #3 → place (apartment_unit)

2. **Future grouping**: Create a parent "apartment_building" place
   - 123 Oak Ave → place (apartment_building, is_address_backed=false)
   - Link units to building via `parent_place_id` (future column)

3. **Why deferred**: Current cat-place linking works at unit level
   - Owners live in specific units
   - Cats are at specific addresses
   - Building-level grouping is a UI/reporting concern

## Troubleshooting

### Places Not Created

Check if addresses are canonical:
```sql
SELECT geocode_status, COUNT(*)
FROM sot.addresses
GROUP BY geocode_status;
-- Only 'success' addresses get places
```

### Missing Cat-Place Links

Verify person-place relationships exist:
```sql
SELECT source_table, COUNT(*)
FROM sot.person_place
GROUP BY source_table;
```

Run the full pipeline:
```sql
SELECT * FROM sot.ensure_address_backed_places();
SELECT sot.derive_person_place(NULL);
SELECT * FROM sot.link_cats_to_places();
```

### Duplicate Places

The UNIQUE constraint prevents duplicates:
```sql
-- This will fail if place already exists
INSERT INTO sot.places (sot_address_id, ...) VALUES (...);
-- ERROR: duplicate key value violates unique constraint
```

Use `ensure_address_backed_places()` which handles conflicts.

## Related Documentation

- [CATS_TO_PLACES.md](./CATS_TO_PLACES.md) - Cat-to-place linking
- [OWNER_ADDRESSES_PIPELINE.md](./OWNER_ADDRESSES_PIPELINE.md) - Geocoding owner addresses
