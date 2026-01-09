# Address Bootstrap Runbook

How to geocode addresses from staged trapping requests into the canonical address registry.

---

## Overview

This pipeline transforms raw address text from `staged_records` into canonical `sot_addresses`:

```
staged_records (trapping_requests)
        ↓
v_candidate_addresses_from_trapping_requests (extract & filter)
        ↓
geocode_candidates.mjs (normalize, cache, geocode)
        ↓
    ┌───┴───┐
    ↓       ↓
sot_addresses   address_review_queue
(canonical)     (needs human review)
```

---

## Prerequisites

1. Database bootstrapped with MIG_001
2. Data ingested into `staged_records` (see [FIRST_INGEST.md](FIRST_INGEST.md))
3. Google Cloud project with Geocoding API enabled

### Setting Up Google Geocoding API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable "Geocoding API" in APIs & Services
4. Create credentials (API key)
5. Add to `.env`:
   ```
   GOOGLE_PLACES_API_KEY=AIza...your-key-here
   ```

**Cost:** $5 per 1000 requests. First $200/month free.

---

## Step 1: Apply Migration

```bash
cd /Users/benmisdiaz/Projects/Atlas
export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
set -a && source .env && set +a

# Apply MIG_002
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_002__sot_addresses_and_geocode_cache.sql
```

---

## Step 2: Discover Address Fields (PREWORK)

Before geocoding, identify which fields contain addresses:

```bash
psql "$DATABASE_URL" -f sql/queries/QRY_001__discover_address_fields.sql
```

Sample output:
```
 field_name      | non_blank_count | fill_rate | recommendation
-----------------+-----------------+-----------+------------------
 Address         |             142 | 94.7%     | *** PRIMARY ***
 Requester Address |            38 | 25.3%     | ** SECONDARY **
 Cats Address    |             25 | 16.7%     |
```

The candidate view (`v_candidate_addresses_from_trapping_requests`) is pre-configured to handle common field names. If your fields differ, update the view.

---

## Step 3: Check Candidate Count

```bash
psql "$DATABASE_URL" -c "
SELECT
  (SELECT COUNT(*) FROM trapper.staged_records WHERE source_table = 'trapping_requests') AS staged,
  (SELECT COUNT(*) FROM trapper.v_candidate_addresses_from_trapping_requests) AS pending_candidates,
  (SELECT COUNT(*) FROM trapper.sot_addresses) AS geocoded,
  (SELECT COUNT(*) FROM trapper.address_review_queue WHERE NOT is_resolved) AS in_review;
"
```

---

## Step 4: Geocode (Small Test First)

### Cheap Test Run (25 candidates, ~$0.13)

```bash
set -a && source .env && set +a

# Dry run first (no API calls)
node scripts/normalize/geocode_candidates.mjs --limit 25 --dry-run --verbose

# If looks good, run for real
node scripts/normalize/geocode_candidates.mjs --limit 25 --verbose
```

Expected output:
```
Atlas Address Geocoder
══════════════════════════════════════════════════
Mode: LIVE
Limit: 25 candidates
✓ Connected to database

Fetching candidates...
  Found 25 pending candidates

Processing...
  Processing: 123 Main St, Santa Rosa, CA 95401...
    Normalized: 123 main st santa rosa ca 95401...
    API call: ok 123 Main St, Santa Rosa, CA 95401...
    Created: sot_address a1b2c3d4... (confidence: 1.0)
  ...

Summary
──────────────────────────────────────────────────
  Candidates processed: 25
  Addresses created: 20
  Sent to review: 5
  Cache hits: 0
  API calls: 25

Estimated cost: $0.13 (25 API calls @ $5/1000)
```

---

## Step 5: Verify Results

### Pipeline Stats

```bash
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_geocode_pipeline_stats;"
```

### Check SoT Addresses

```bash
psql "$DATABASE_URL" -c "
SELECT
  address_id,
  formatted_address,
  unit_raw,
  locality,
  postal_code,
  geocode_status,
  confidence_score
FROM trapper.sot_addresses
ORDER BY created_at DESC
LIMIT 10;
"
```

### Check Review Queue

```bash
psql "$DATABASE_URL" -c "
SELECT
  reason,
  COUNT(*) AS count
FROM trapper.address_review_queue
WHERE NOT is_resolved
GROUP BY reason
ORDER BY count DESC;
"
```

### Verify Units Preserved

```bash
psql "$DATABASE_URL" -c "
SELECT
  formatted_address,
  unit_raw,
  unit_normalized
FROM trapper.sot_addresses
WHERE unit_raw IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
"
```

---

## Step 6: Geocode Remaining Candidates

### Process All Pending (with rate limit)

```bash
# Check how many remain
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM trapper.v_candidate_addresses_from_trapping_requests;"

# Process in batches of 100
node scripts/normalize/geocode_candidates.mjs --limit 100

# Or process all (up to 10000)
node scripts/normalize/geocode_candidates.mjs --all
```

### Re-running Is Safe

The script is idempotent:
- Cache prevents duplicate API calls
- `ON CONFLICT DO NOTHING` prevents duplicate SoT entries
- Already-processed records excluded from candidate view

```bash
# Run again - should show 0 API calls (all from cache)
node scripts/normalize/geocode_candidates.mjs --limit 25
```

---

## Step 7: Handle Review Queue

Review queue contains addresses that:
- Returned zero results
- Had partial/ambiguous matches
- Had low confidence scores

### View Queue Items

```bash
psql "$DATABASE_URL" -c "
SELECT
  id,
  address_raw,
  reason,
  suggested_formatted,
  source_row_id
FROM trapper.address_review_queue
WHERE NOT is_resolved
ORDER BY created_at
LIMIT 20;
"
```

### Resolution Options

1. **Accept suggested geocode:**
   ```sql
   -- Create SoT address from suggestion, then resolve
   UPDATE trapper.address_review_queue
   SET is_resolved = TRUE,
       resolution = 'accepted',
       resolved_at = NOW(),
       resolved_by = 'ben'
   WHERE id = 'uuid-here';
   ```

2. **Manual entry:**
   ```sql
   -- Insert manually geocoded address
   INSERT INTO trapper.sot_addresses (formatted_address, lat, lng, geocode_status)
   VALUES ('123 Fixed St, Santa Rosa, CA 95401', 38.4404, -122.7141, 'manual_override');

   -- Then resolve
   UPDATE trapper.address_review_queue
   SET is_resolved = TRUE,
       resolution = 'manual_entry',
       resolved_at = NOW()
   WHERE id = 'uuid-here';
   ```

3. **Reject (invalid/garbage):**
   ```sql
   UPDATE trapper.address_review_queue
   SET is_resolved = TRUE,
       resolution = 'rejected',
       resolved_at = NOW(),
       resolved_by = 'ben'
   WHERE id = 'uuid-here';
   ```

---

## Sanity Queries

### 1. Row Counts

```sql
SELECT * FROM trapper.v_geocode_pipeline_stats;
```

### 2. Check for Duplicates

```sql
-- Should return 0 rows
SELECT
  formatted_address,
  unit_normalized,
  COUNT(*) AS occurrences
FROM trapper.sot_addresses
GROUP BY formatted_address, unit_normalized
HAVING COUNT(*) > 1;
```

### 3. Null Rate Check

```sql
SELECT
  COUNT(*) AS total,
  COUNT(lat) AS with_lat,
  COUNT(unit_raw) AS with_unit,
  ROUND(100.0 * COUNT(lat) / NULLIF(COUNT(*), 0), 1) AS geocoded_pct
FROM trapper.sot_addresses;
```

### 4. Geocode Status Distribution

```sql
SELECT
  geocode_status,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.sot_addresses
GROUP BY geocode_status
ORDER BY count DESC;
```

### 5. Verify staged_records Unchanged

```sql
-- staged_records should only grow, never shrink
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE is_processed) AS processed
FROM trapper.staged_records
WHERE source_table = 'trapping_requests';
```

---

## Cost Management

| Batch Size | Estimated Cost |
|------------|---------------|
| 25 | $0.13 |
| 100 | $0.50 |
| 500 | $2.50 |
| 1000 | $5.00 |

### Check Cache Hit Rate

```bash
# After multiple runs
psql "$DATABASE_URL" -c "
SELECT
  geocode_status,
  COUNT(*) AS cached_entries
FROM trapper.geocode_cache
GROUP BY geocode_status;
"
```

---

## Troubleshooting

### "GOOGLE_PLACES_API_KEY not set"

Add to `.env`:
```
GOOGLE_PLACES_API_KEY=AIza...
```

### "API returned OVER_QUERY_LIMIT"

Rate limited. Wait and try again with smaller batch:
```bash
node scripts/normalize/geocode_candidates.mjs --limit 10
```

### "zero_results" in Review Queue

Address too vague or doesn't exist. Options:
- Fix the source data in Airtable
- Manually geocode and add to SoT
- Mark as rejected

### "partial_match" in Review Queue

Google found something but wasn't sure. Review the `suggested_formatted` and decide if it's correct.

---

## Next Steps

After geocoding:

1. Link places to addresses (future migration)
2. Build location-based views for ops
3. Enable spatial queries for nearby requests

---

*Geocode once, use everywhere.*
