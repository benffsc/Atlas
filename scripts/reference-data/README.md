# Reference Data Loading Scripts

This directory contains scripts to download and load official reference datasets from US government sources for name classification in Atlas.

## Datasets

| Dataset | Source | Records | License | Used For |
|---------|--------|---------|---------|----------|
| **US Census Surnames 2010** | [census.gov](https://www2.census.gov/topics/genealogy/2010surnames/) | 162,253 | CC0 (Public Domain) | Surname validation, TF-IDF frequency weighting |
| **SSA Baby Names** | [ssa.gov](https://www.ssa.gov/oact/babynames/limits.html) | ~100,364 unique | CC0 (Public Domain) | First name validation, gender inference |

## Quick Start

```bash
# 1. Apply migrations first (creates tables)
psql $DATABASE_URL -f sql/schema/v2/MIG_2370__census_surnames_table.sql
psql $DATABASE_URL -f sql/schema/v2/MIG_2371__ssa_first_names_table.sql
psql $DATABASE_URL -f sql/schema/v2/MIG_2372__business_keywords_table.sql

# 2. Load reference data
./scripts/reference-data/load_census_surnames.sh
./scripts/reference-data/load_ssa_names.sh

# 3. Apply updated classify_owner_name function
psql $DATABASE_URL -f sql/schema/v2/MIG_2373__classify_owner_name_with_ref_tables.sql

# 4. Verify
psql $DATABASE_URL -c "SELECT COUNT(*) FROM ref.census_surnames;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM ref.first_names;"
psql $DATABASE_URL -c "SELECT sot.classify_owner_name('John Carpenter');"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATA_DIR` | No | Where to store downloaded files (default: `data/reference`) |

Scripts will try to load `DATABASE_URL` from `.env` file if not set.

## Migration Dependencies

```
MIG_2370 (census_surnames table)  ─┐
MIG_2371 (first_names table)      ─┼─→ MIG_2373 (updated classify_owner_name)
MIG_2372 (business_keywords)      ─┘
```

## Data Files

After running scripts, these files will exist in `data/reference/`:

```
data/reference/
├── Names_2010Census.csv      # Census surnames (12 MB)
└── ssa_names/
    ├── yob1880.txt           # SSA names by year
    ├── yob1881.txt
    ├── ...
    ├── yob2024.txt
    └── combined_names.csv    # Generated combined file
```

## Database Tables Created

### `ref.census_surnames`
Full US Census 2010 surname data with demographic breakdowns.

```sql
SELECT name, rank, count, prop100k FROM ref.census_surnames ORDER BY rank LIMIT 5;
-- SMITH, 1, 2442977, 828.19
-- JOHNSON, 2, 1932812, 655.24
-- WILLIAMS, 3, 1625252, 550.97
-- ...
```

### `ref.first_names`
Aggregated SSA baby names with popularity and gender data.

```sql
SELECT name, total_count, peak_year, is_primarily_male
FROM ref.first_names ORDER BY total_count DESC LIMIT 5;
-- JAMES, 4748138, 1947, true
-- JOHN, 4510721, 1947, true
-- ROBERT, 4499901, 1947, true
-- ...
```

### `ref.business_keywords`
Curated business indicator keywords.

```sql
SELECT category, COUNT(*) FROM ref.business_keywords GROUP BY 1 ORDER BY 2 DESC;
-- service, 45
-- retail, 20
-- ...
```

## Helper Functions

### Census Surnames

```sql
-- Check if name is a surname
SELECT ref.is_census_surname('Smith');  -- true

-- Get surname rank
SELECT ref.get_surname_rank('Smith');   -- 1

-- Check if occupation surname (needs safelist)
SELECT ref.is_occupation_surname('Carpenter');  -- true

-- Get TF-IDF weight for identity matching
SELECT ref.get_surname_frequency_weight('Smith');  -- 0.52 (common)
SELECT ref.get_surname_frequency_weight('Papadopoulos');  -- 1.45 (rare)
```

### First Names

```sql
-- Check if common first name
SELECT ref.is_common_first_name('John', 1000);  -- true

-- Get popularity data
SELECT * FROM ref.get_first_name_popularity('Mary');

-- Gender classification
SELECT ref.is_male_name('John');    -- true
SELECT ref.is_female_name('Mary');  -- true
SELECT ref.is_unisex_name('Taylor'); -- true
```

### Business Keywords

```sql
-- Get business score for a name
SELECT ref.get_business_score('Atlas Tree Surgery');  -- 1.7

-- Get keywords found
SELECT ref.get_business_keywords_found('World Of Carpets');  -- {carpets}

-- Quick business check
SELECT ref.is_business_name('Bob''s Plumbing');  -- true
```

### Name Classification

```sql
-- Classify a name
SELECT sot.classify_owner_name('John Carpenter');     -- likely_person
SELECT sot.classify_owner_name('Carpenter Plumbing'); -- organization
SELECT sot.classify_owner_name('World Of Carpets');   -- organization

-- Get explanation for debugging
SELECT * FROM sot.explain_name_classification('John Carpenter');
-- Returns: first_word, last_word, is_common_first_name, is_census_surname, business_score, etc.
```

## Updating Data

### Census Surnames
Census data is released decennially. The 2020 Census surname data may be released around 2023-2024. When available:

```bash
# Update URL in script, then:
rm -rf data/reference/Names_2010Census.csv
./scripts/reference-data/load_census_surnames.sh
```

### SSA Baby Names
SSA releases new data annually around Mother's Day. To update:

```bash
# Remove old data
rm -rf data/reference/ssa_names

# Re-download and load
./scripts/reference-data/load_ssa_names.sh
```

The scripts use `ON CONFLICT` upserts, so running them again is safe and will update existing records.

## Troubleshooting

### "ERROR: DATABASE_URL not set"
Set the environment variable or add to `.env`:
```bash
export DATABASE_URL='postgresql://user:pass@host:5432/atlas'
```

### "relation ref.census_surnames does not exist"
Apply the migrations first:
```bash
psql $DATABASE_URL -f sql/schema/v2/MIG_2370__census_surnames_table.sql
```

### Slow loading
The SSA names load can take 2-5 minutes due to 145 years of data. The aggregation step may also take a minute.

### Disk space
Total download is ~30MB, expanded to ~100MB on disk. Safe to delete after loading.

## Related Documentation

- `docs/ATLAS_DATA_REMEDIATION_PLAN.md` - Phase 6 reference data integration
- `CLAUDE.md` - INV-43, INV-44, INV-45 (business name classification invariants)
- `docs/DATA_GAPS.md` - DATA_GAP_033 (business names not classified)
