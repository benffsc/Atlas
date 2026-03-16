# Owner Addresses Pipeline (ATLAS_014)

Extracts ClinicHQ owner addresses into the geocoding pipeline to dramatically increase cat-to-place coverage.

## Problem

ATLAS_013 linked cats to places via owner → sot.person_place, but only achieved ~100 cat-place links because most owner addresses hadn't been geocoded. This pipeline geocodes owner addresses to create the missing sot.person_place.

## Signal Path

```
ops.staged_records (owner_info)
    ↓ v_clinichq_owner_latest (deduped by animal number)
    ↓ v_clinichq_owner_address_candidates (pending geocoding)
    ↓ geocode_owner_addresses.mjs (Google Geocoding API)
sot.addresses
    ↓ staged_record_address_link
    ↓ derive_person_place('owner_info')
sot.person_place
    ↓ link_cats_to_places()
sot.cat_place
```

## Usage

### Full Pipeline

```bash
set -a && source .env && set +a
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh
```

With options:
```bash
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --limit 500
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --dry-run
```

### Manual Steps

```sql
-- Check candidates
SELECT COUNT(*) FROM ops.v_clinichq_owner_address_candidates;

-- After geocoding, link addresses to staged records
SELECT * FROM sot.link_owner_addresses_to_staged_records();

-- Derive person-place relationships
SELECT sot.derive_person_place('owner_info');

-- Relink cats to places
SELECT * FROM sot.link_cats_to_places();
SELECT sot.update_place_cat_activity_flags();
```

### Query Files

```bash
psql "$DATABASE_URL" -f sql/queries/QRY_026__owner_addresses_stats.sql
psql "$DATABASE_URL" -f sql/queries/QRY_027__address_candidate_funnel.sql
psql "$DATABASE_URL" -f sql/queries/QRY_028__cat_place_coverage.sql
```

## Views

### v_clinichq_owner_latest

Deduplicated owner records (one per animal number, most recent).

| Column | Description |
|--------|-------------|
| staged_record_id | FK to ops.staged_records |
| animal_number | ClinicHQ animal identifier |
| owner_first_name | Owner's first name |
| owner_last_name | Owner's last name |
| owner_address | Raw address string |
| owner_email | Email address |
| owner_phone | Phone number |

### v_clinichq_owner_address_candidates

Owner addresses pending geocoding. Excludes:
- Already-linked addresses (staged_record_address_link exists)
- Addresses in review queue
- Very short addresses (< 10 chars)

### v_owner_address_stats

Pipeline progress statistics:
- total_owners
- owners_with_address
- candidates_pending
- owners_linked_to_address
- owners_linked_to_person

## Functions

### link_owner_addresses_to_staged_records()

Links ClinicHQ owner records to existing sot.addresses by fuzzy matching.

Returns:
- records_linked: Number of staged_record_address_link rows created
- places_created: Number of new places seeded

Match methods:
1. Exact normalized match (lowercase, no punctuation, collapsed whitespace)
2. Component match (street_number + route + locality)

## Prerequisites

1. MIG_022 applied
2. ClinicHQ owner_info ingested
3. GOOGLE_PLACES_API_KEY set in .env (for geocoding)

## Cost Management

The geocoding script respects GEOCODE_LIMIT to control API costs:

```bash
# Default: 200 addresses
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh

# Custom limit
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --limit 1000

# Dry run (no API calls)
./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --dry-run
```

Environment variable:
```bash
export GEOCODE_LIMIT=500
```

## Expected Results

With ~8,500 owner addresses:
- After geocoding 500: ~400 new sot.person_place
- After geocoding all: ~6,000+ cat-place relationships (70%+ coverage)

Coverage depends on:
- Address quality (parseable by Google)
- Duplicate addresses (shared by multiple owners)
- Owner-cat linkage (sot.person_cat must exist)

## Troubleshooting

### No candidates showing

Check if addresses exist:
```sql
SELECT COUNT(*) FROM ops.v_clinichq_owner_latest
WHERE owner_address IS NOT NULL AND TRIM(owner_address) <> '';
```

### Geocoding failures

Check review queue:
```sql
SELECT review_reason, COUNT(*)
FROM ops.address_review_queue arq
JOIN ops.staged_records sr ON sr.id = arq.staged_record_id
WHERE sr.source_table = 'owner_info'
GROUP BY review_reason;
```

### Cats not linking after geocoding

Verify sot.person_place created:
```sql
SELECT COUNT(*) FROM sot.person_place
WHERE source_table = 'owner_info';
```

Verify owner-cat relationships exist:
```sql
SELECT COUNT(DISTINCT cat_id)
FROM sot.person_cat
WHERE relationship_type = 'owner';
```

## Incremental Runs

Safe to re-run:
- Geocoding skips already-processed addresses
- link_owner_addresses_to_staged_records() uses ON CONFLICT DO NOTHING
- link_cats_to_places() uses ON CONFLICT DO NOTHING
- No duplicates created on repeated runs
