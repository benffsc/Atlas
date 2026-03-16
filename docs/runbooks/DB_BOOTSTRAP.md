# Database Bootstrap Runbook

How to bootstrap Atlas on a fresh Supabase database.

---

## Prerequisites

- Supabase project created (or local Postgres with PostGIS)
- `DATABASE_URL` in your `.env` file
- `psql` available (see below for installation)

### Installing psql (macOS)

```bash
# Via Homebrew
brew install libpq

# Add to PATH (add to ~/.zshrc for permanence)
export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"

# Verify
psql --version
```

---

## Connection Types: Direct vs Pooler

Supabase provides two connection methods:

| Type | Port | Use Case | Transaction Mode |
|------|------|----------|------------------|
| **Direct** | 5432 | Local dev, migrations, CLI | Session |
| **Pooler** | 6543 | Cloud apps, serverless | Transaction |

### Recommendation

- **Local development:** Use direct connection (port 5432)
- **Production/Cloud:** Use pooler connection (port 6543)

### Finding Your Connection String

1. Go to Supabase Dashboard → Project Settings → Database
2. Scroll to "Connection String"
3. Copy the URI format
4. For direct: use port 5432
5. For pooler: use port 6543

---

## Step 1: Configure Environment

Create `.env` from example:

```bash
cd /Users/benmisdiaz/Projects/Atlas
cp .env.example .env
```

Edit `.env` and set DATABASE_URL:

```bash
# Use your actual Supabase credentials
DATABASE_URL=postgres://postgres.xxxx:PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

**IMPORTANT:** Never commit `.env` to git. It's in `.gitignore`.

---

## Step 2: Test Connection

```bash
# Load environment
set -a && source .env && set +a

# Quick test
psql "$DATABASE_URL" -c "SELECT version();"
```

### Troubleshooting Connection Issues

**Timeout / Connection refused:**
1. Check Supabase Network Restrictions
2. Go to: Dashboard → Settings → Database → Network Restrictions
3. Either:
   - Disable network restrictions (less secure)
   - Add your IP address to allowlist

**Password authentication failed:**
1. Verify DATABASE_URL password in `.env`
2. Check you copied the correct project password

**SSL errors:**
```bash
# Try with SSL mode
psql "$DATABASE_URL?sslmode=require" -c "SELECT 1"
```

---

## Step 3: Run Bootstrap Migration

```bash
# Ensure psql is in PATH
export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"

# Load environment
set -a && source .env && set +a

# Run bootstrap (idempotent - safe to re-run)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_001__atlas_bootstrap.sql
```

### What Bootstrap Creates

| Item | Description |
|------|-------------|
| **Extensions** | postgis, pg_trgm, uuid-ossp |
| **Schema** | `trapper` |
| **Tables** | staged_records, appointment_requests, clinichq_upcoming_appointments, data_issues |
| **Indexes** | For queries and idempotency constraints |

### Re-running Bootstrap

The migration uses `IF NOT EXISTS` throughout. Re-running is safe:
- Won't duplicate schemas/tables/indexes
- Won't delete existing data
- No errors on second run

---

## Step 4: Run Smoke Test

```bash
# From Atlas root
set -a && source .env && set +a
./scripts/smoke_db.mjs
```

Expected output on success:

```
Atlas Database Smoke Test
══════════════════════════════════════════════════

1. Environment Check
──────────────────────────────────────────────────
  ✓ DATABASE_URL set (aws-0-us-west-1.pooler.supabase.com:5432)
  ✓ Using direct port (5432) - good for local development

2. Database Connection
──────────────────────────────────────────────────
  ✓ Connected to database
  ✓ Server: PostgreSQL 15.x

3. Extensions
──────────────────────────────────────────────────
  ✓ postgis (3.x)
  ✓ pg_trgm (1.x)

4. Schemas
──────────────────────────────────────────────────
  ✓ Schema: sot, ops, source, ref

5. Required Tables
──────────────────────────────────────────────────
  ✓ ops.staged_records (0 rows)
  ✓ ops.appointment_requests (0 rows)
  ✓ source.clinichq_upcoming_appointments (0 rows)
  ✓ ops.data_issues (0 rows)

6. Idempotency Constraints
──────────────────────────────────────────────────
  ✓ staged_records_idempotency_key
  ✓ appointment_requests_source_row_hash_key
  ✓ clinichq_upcoming_source_row_hash_key

Summary
──────────────────────────────────────────────────

All checks passed! (6/6)

Ready for ingest:
  See docs/runbooks/FIRST_INGEST.md
```

---

## Step 5: Ready for First Ingest

Once smoke test passes, proceed to [FIRST_INGEST.md](FIRST_INGEST.md).

---

## Reference: Manual SQL Verification

If you prefer manual checks:

```sql
-- Check extensions
SELECT extname, extversion FROM pg_extension
WHERE extname IN ('postgis', 'pg_trgm');

-- Check schema
SELECT schema_name FROM information_schema.schemata
WHERE schema_name = 'trapper';

-- Check tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check constraints (idempotency keys)
SELECT constraint_name, table_name
FROM information_schema.table_constraints
WHERE table_schema = 'trapper' AND constraint_type = 'UNIQUE';
```

---

## Appendix: Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `LOCAL_INGEST_PATH` | No | Override default ingest path |

---

*Bootstrap once, ingest many.*
