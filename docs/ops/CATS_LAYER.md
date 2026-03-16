# Cats Layer (ATLAS_012)

The canonical Cats layer provides a unified view of cats across data sources, with links to their owners.

## What's Canonical Now

### Tables

| Table | Purpose |
|-------|---------|
| `sot.cats` | Source of Truth for cat records |
| `sot.cat_identifiers` | Unique identifiers (animal ID, microchip) |
| `sot.person_cat` | Links cats to owners |

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
SELECT * FROM sot.upsert_cats_from_clinichq();
```

Or via the wrapper:

```sql
SELECT * FROM sot.upsert_cats_from_observations('cat_info');
```

The function:
1. Reads `cat_info` staged records
2. Creates `sot.cats` entry if animal ID not seen
3. Adds `sot.cat_identifiers` for animal ID and microchip
4. Fills in cat details (name, sex, breed, etc.)

### Owner Linking

Owner relationships are created when:
1. Cat exists in `sot.cats` (has animal ID)
2. `owner_info` record exists for that animal ID
3. Owner's email or phone matches an existing `sot.people` record

```
owner_info.Owner Email → sot.person_identifiers.email → sot.people
         ↓
sot.person_cat (relationship_type = 'owner')
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
SELECT * FROM sot.upsert_cats_from_clinichq();

-- Check results
SELECT * FROM ops.v_cats_stats;
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

## Cat Merging (MIG_225)

Atlas supports manual merging of duplicate cat records with full stability across re-imports.

### Merge Functions

```sql
-- Merge source cat INTO target cat (target becomes canonical)
SELECT sot.merge_cats(
    'source_cat_uuid',
    'target_cat_uuid',
    'duplicate',     -- reason
    'admin'          -- who
);

-- Undo a merge if needed
SELECT sot.undo_cat_merge('merged_cat_uuid');

-- Get canonical cat_id (follows merge chain)
SELECT sot.get_canonical_cat_id('any_cat_uuid');

-- Find canonical cat by microchip
SELECT sot.find_canonical_cat_by_microchip('981020012345678');
```

### Canonical View

Use `v_canonical_cats` to exclude merged cats from UI queries:

```sql
SELECT * FROM ops.v_canonical_cats WHERE ...;
```

### Merge Stability

Merges survive re-imports because:
1. Merged cats have `merged_into_cat_id` set
2. Ingest uses `get_canonical_cat_id()` when linking
3. Relationships always point to canonical cat

---

## What's Intentionally Deferred

### Not Yet Implemented

1. **Cross-source cat dedupe** - Matching cats across ClinicHQ, Shelterluv, PetLink by microchip or fuzzy name match

2. **Shelterluv/PetLink integration** - Currently only ClinicHQ cats are processed

3. **Colony tracking** - Distinguishing owned cats from colony/community cats

4. **Cat merge UI** - Currently SQL-only, no web interface

### Why Deferred

- Keep initial scope focused on "surfaceable" cats
- Avoid premature optimization before data patterns are understood
- Cross-source matching requires careful validation to avoid false merges

## Data Model

```
sot.cats
  ├── cat_id (PK)
  ├── display_name
  ├── sex
  ├── altered_status
  ├── birth_year
  ├── breed
  ├── primary_color
  └── timestamps

sot.cat_identifiers
  ├── cat_identifier_id (PK)
  ├── cat_id (FK → sot.cats)
  ├── id_type (clinichq_animal_id, microchip, ...)
  ├── id_value
  └── source_system, source_table

sot.person_cat
  ├── person_cat_id (PK)
  ├── person_id (FK → sot.people)
  ├── cat_id (FK → sot.cats)
  ├── relationship_type (owner, caretaker)
  ├── confidence (high, medium, low)
  └── source_system, source_table
```

## Next Steps (ATLAS_013+)

1. Place linkage via owner addresses
2. Appointment location signals
3. Cats page in UI/search
4. Shelterluv/PetLink cat integration
