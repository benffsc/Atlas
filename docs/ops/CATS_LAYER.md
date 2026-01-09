# Cats Layer (ATLAS_012)

The canonical Cats layer provides a unified view of cats across data sources, with links to their owners.

## What's Canonical Now

### Tables

| Table | Purpose |
|-------|---------|
| `trapper.sot_cats` | Source of Truth for cat records |
| `trapper.cat_identifiers` | Unique identifiers (animal ID, microchip) |
| `trapper.person_cat_relationships` | Links cats to owners |

### Supported Identifiers

| id_type | Description | Source |
|---------|-------------|--------|
| `clinichq_animal_id` | ClinicHQ "Number" field (e.g., "24-1234") | cat_info |
| `microchip` | ISO microchip number (15-digit) | cat_info |

### Views

- `v_cats_unified` - All cats with aggregated identifiers and owner names
- `v_people_with_cats` - People with their cat counts and names
- `v_cats_stats` - Summary statistics

## How It Works

### Cat Creation

Cats are upserted from ClinicHQ staged records via:

```sql
SELECT * FROM trapper.upsert_cats_from_clinichq();
```

Or via the wrapper:

```sql
SELECT * FROM trapper.upsert_cats_from_observations('cat_info');
```

The function:
1. Reads `cat_info` staged records
2. Creates `sot_cats` entry if animal ID not seen
3. Adds `cat_identifiers` for animal ID and microchip
4. Fills in cat details (name, sex, breed, etc.)

### Owner Linking

Owner relationships are created when:
1. Cat exists in `sot_cats` (has animal ID)
2. `owner_info` record exists for that animal ID
3. Owner's email or phone matches an existing `sot_people` record

```
owner_info.Owner Email → person_identifiers.email → sot_people
         ↓
person_cat_relationships (relationship_type = 'owner')
```

If no matching person is found, the cat is created without an owner link.

## Usage

### Post-Ingest Script

```bash
./scripts/post_ingest/atlas_012_upsert_cats.sh
```

### Manual Upsert

```sql
-- Upsert cats from ClinicHQ
SELECT * FROM trapper.upsert_cats_from_clinichq();

-- Check results
SELECT * FROM trapper.v_cats_stats;
```

### Queries

```bash
# Summary with sample data
psql "$DATABASE_URL" -f sql/queries/QRY_020__cats_summary.sql

# Top owners by cat count
psql "$DATABASE_URL" -f sql/queries/QRY_021__top_owners_by_cat_count.sql

# Cats missing owner links (data quality)
psql "$DATABASE_URL" -f sql/queries/QRY_022__cats_missing_owner_links.sql
```

## What's Intentionally Deferred

### Not Yet Implemented

1. **Cross-source cat dedupe** - Matching cats across ClinicHQ, Shelterluv, PetLink by microchip or fuzzy name match

2. **Shelterluv/PetLink integration** - Currently only ClinicHQ cats are processed

3. **Place linkage** - Linking cats to locations via owner address or appointment location

4. **Fuzzy cat matching** - Detecting duplicate cats with similar names/characteristics

5. **Cat merge workflow** - UI for merging duplicate cat records

6. **Colony tracking** - Distinguishing owned cats from colony/community cats

### Why Deferred

- Keep initial scope focused on "surfaceable" cats
- Avoid premature optimization before data patterns are understood
- Cross-source matching requires careful validation to avoid false merges

## Data Model

```
sot_cats
  ├── cat_id (PK)
  ├── display_name
  ├── sex
  ├── altered_status
  ├── birth_year
  ├── breed
  ├── primary_color
  └── timestamps

cat_identifiers
  ├── cat_identifier_id (PK)
  ├── cat_id (FK → sot_cats)
  ├── id_type (clinichq_animal_id, microchip, ...)
  ├── id_value
  └── source_system, source_table

person_cat_relationships
  ├── person_cat_id (PK)
  ├── person_id (FK → sot_people)
  ├── cat_id (FK → sot_cats)
  ├── relationship_type (owner, caretaker)
  ├── confidence (high, medium, low)
  └── source_system, source_table
```

## Next Steps (ATLAS_013+)

1. Place linkage via owner addresses
2. Appointment location signals
3. Cats page in UI/search
4. Shelterluv/PetLink cat integration
