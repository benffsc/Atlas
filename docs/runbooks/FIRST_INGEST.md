# First Ingest Runbook

How to run your first data ingest into Atlas.

---

## Prerequisites

Before ingesting:

1. Database bootstrapped (see [DB_BOOTSTRAP.md](DB_BOOTSTRAP.md))
2. Smoke test passing: `./scripts/smoke_db.mjs`
3. CSV file ready

---

## Step 1: Put CSV in Local-Only Directory

Place your Airtable Trapping Requests CSV export in:

```
/Users/benmisdiaz/Desktop/AI_Ingest/airtable/trapping_requests/
```

Or any local path (never committed to git).

### CSV Format

The ingest script handles standard Airtable CSV exports:
- First row is headers
- Supports quoted fields with commas
- Any columns accepted (stored as JSON payload)

### Recommended Columns

| Column | Description |
|--------|-------------|
| `Record ID` | Airtable record ID (for traceability) |
| `Created` | When request was submitted |
| `Name` | Requester name |
| `Email` | Contact email |
| `Phone` | Contact phone |
| `Address` | Location address |
| `City` | City |
| `Description` | Issue description |
| *(any others)* | All columns preserved in payload |

---

## Step 2: Run Ingest (Dry Run First)

```bash
# Navigate to Atlas
cd /Users/benmisdiaz/Projects/Atlas

# Load environment
set -a && source .env && set +a

# Dry run - validates CSV, shows what would be inserted
node scripts/ingest/airtable_trapping_requests_csv.mjs \
  --csv ~/Desktop/AI_Ingest/airtable/trapping_requests/your_file.csv \
  --dry-run

# Check output looks correct, then run for real:
node scripts/ingest/airtable_trapping_requests_csv.mjs \
  --csv ~/Desktop/AI_Ingest/airtable/trapping_requests/your_file.csv
```

### Ingest Output

```
Airtable Trapping Requests Ingest
══════════════════════════════════════════════════

Source: /path/to/your_file.csv
Mode: LIVE

Parsing CSV...
  Columns: 15
  Rows: 150

Connecting to database...
  ✓ Connected

Ingesting rows...

Summary
──────────────────────────────────────────────────
  Total rows:     150
  Inserted:       150
  Skipped (dupe): 0

Ingest complete!
```

---

## Step 3: Verify with Sanity Queries

After ingest, run these queries to verify:

### Query 1: Row Counts

```sql
-- Total staged records
SELECT
  source_system,
  source_table,
  COUNT(*) AS row_count,
  MIN(created_at) AS earliest,
  MAX(created_at) AS latest
FROM ops.staged_records
GROUP BY source_system, source_table
ORDER BY source_table;
```

### Query 2: Check for Duplicates

```sql
-- Should return 0 rows (no duplicates)
SELECT
  source_system,
  source_table,
  row_hash,
  COUNT(*) AS occurrences
FROM ops.staged_records
GROUP BY source_system, source_table, row_hash
HAVING COUNT(*) > 1;
```

### Query 3: Null Rate Check

```sql
-- Check for missing source_row_id (Airtable Record ID)
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE source_row_id IS NULL) AS missing_record_id,
  ROUND(100.0 * COUNT(*) FILTER (WHERE source_row_id IS NULL) / COUNT(*), 1) AS null_pct
FROM ops.staged_records
WHERE source_table = 'trapping_requests';
```

### Quick One-Liner

```bash
psql "$DATABASE_URL" -c "
SELECT source_table, COUNT(*) AS rows,
       COUNT(source_row_id) AS with_id,
       COUNT(*) - COUNT(source_row_id) AS missing_id
FROM ops.staged_records
GROUP BY source_table;
"
```

---

## Step 4: Test Idempotency

Re-run the same ingest and verify no new rows are inserted:

```bash
# Run ingest again
node scripts/ingest/airtable_trapping_requests_csv.mjs \
  --csv ~/Desktop/AI_Ingest/airtable/trapping_requests/your_file.csv
```

Expected output:

```
Summary
──────────────────────────────────────────────────
  Total rows:     150
  Inserted:       0
  Skipped (dupe): 150

Idempotent: All 150 rows already exist.
```

---

## How Idempotency Works

Each row gets a unique hash computed from:
- All column values (sorted alphabetically)
- Trimmed whitespace
- Lowercased strings

The database has a unique constraint on `(source_system, source_table, row_hash)`.

If you re-ingest the same CSV:
- Rows with matching hash are skipped (ON CONFLICT DO NOTHING)
- Only genuinely new rows are inserted

### When Rows Get Re-Inserted

Rows are considered "new" if any canonicalized field value changes:
- Spelling fixes → new hash → new row
- Case changes → same hash → skipped
- Whitespace changes → same hash → skipped

---

## Troubleshooting

### "DATABASE_URL not set"

```bash
set -a && source .env && set +a
```

### "Connection failed: timeout"

Check Supabase Network Restrictions (see [DB_BOOTSTRAP.md](DB_BOOTSTRAP.md))

### "No CSV file specified"

Provide explicit path:
```bash
node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv
```

### "CSV file is empty"

Verify CSV has:
- Header row
- At least one data row
- UTF-8 encoding (no BOM)

---

## Next Steps

After first ingest:

1. Review payload in staged_records:
   ```sql
   SELECT id, source_row_id, payload->>'Name' AS name, payload->>'Address' AS address
   FROM ops.staged_records
   WHERE source_table = 'trapping_requests'
   LIMIT 10;
   ```

2. Plan normalization pipeline (staged → SoT tables)
3. Set up additional ingests (ClinicHQ, other Airtable tables)

---

*Ingest early, ingest often, normalize later.*
