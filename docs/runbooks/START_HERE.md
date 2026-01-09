# Start Here: Atlas Onboarding Guide

Welcome to Atlas! This guide explains the repository structure and how to work with it.

---

## What Is Atlas?

Atlas is the operational data platform for FFSC trapping operations. It:
- Consolidates data from Airtable, ClinicHQ, and form submissions
- Creates canonical (deduplicated) people, places, and addresses
- Provides review queues for data quality triage
- Powers operational dashboards for coordinators

**Key principle:** Airtable remains the primary operational system until Atlas proves itself. We run both in parallel.

---

## Repository Structure

```
Atlas/
├── docs/
│   ├── reality/        # Operational constraints, workflow truths
│   └── runbooks/       # How-to guides (you are here)
├── sql/
│   ├── migrations/     # Ordered migrations (apply manually)
│   ├── schema/
│   │   ├── sot/        # Canonical entities (addresses, places, people)
│   │   ├── raw/        # Staging tables (airtable_*, clinichq_*)
│   │   └── review/     # Review queue tables
│   └── views/          # UI-facing views
├── scripts/
│   ├── ingest/         # Source-specific data ingests
│   ├── normalize/      # Dedupe and canonicalization
│   └── lib/            # Shared utilities
├── apps/
│   └── web/            # Next.js UI (when ready)
├── data/               # LOCAL ONLY - never committed
└── archive/            # Reference files from previous work
```

---

## What Goes Where

### SoT (Source of Truth) — `sql/schema/sot/`
Canonical, deduplicated entities. The "gold" data.
- Created by normalizing raw data + human review
- Examples: `addresses`, `places`, `people`, `canonical_cats`

### Raw — `sql/schema/raw/`
Staging tables that preserve original source format.
- Ingests are idempotent (re-run without duplicating)
- Examples: `appointment_requests`, `clinichq_upcoming_appointments`

### Review — `sql/schema/review/`
Queues for human triage. Surfaces data quality issues.
- Issues are additive; resolved issues are marked, not deleted
- Examples: `data_issues`, `geocode_review_queue`

---

## Local Data Location

Ben's exports live at:
```
/Users/benmisdiaz/Desktop/AI_Ingest/
```

This directory is **never committed**. The `.gitignore` ensures data files stay local.

Typical structure:
```
AI_Ingest/
├── airtable/
│   ├── appointment_requests/
│   └── trapping_requests/
├── clinichq/
│   ├── upcoming/
│   └── historical/
└── forms/
```

---

## Running Migrations

Migrations are applied **manually**. No auto-apply on startup.

### Via psql

```bash
# Load environment
source .env

# Apply a migration
psql "$DATABASE_URL" -f sql/migrations/MIG_050__create_appointment_requests_table.sql
```

### Via Supabase SQL Editor

1. Open Supabase Dashboard → SQL Editor
2. Copy migration SQL
3. Run
4. Verify with a sanity query

### Migration Order

For a fresh database, apply in numeric order:
1. Schema/table migrations (MIG_0xx)
2. View migrations (after tables exist)
3. Index migrations (last)

---

## Running Ingests

```bash
# Set up Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install psycopg2-binary pandas openpyxl

# Load DATABASE_URL
source .env

# Dry run first (no DB writes)
python scripts/ingest/ingest_airtable_appointment_requests.py --dry-run

# Actual ingest
python scripts/ingest/ingest_airtable_appointment_requests.py
```

---

## Safety Rules

### Never Commit
- Data exports (CSV, XLSX, JSON)
- `.env` files with real credentials
- API keys or tokens

### Never Run Without Review
- DROP TABLE, DROP SCHEMA
- DELETE FROM without WHERE
- TRUNCATE

### Always Check
- `git status` before commit
- Secret scan: `rg -n "AIza|postgres://|supabase" .`
- `.gitignore` covers new file types

See [PREFLIGHT.md](PREFLIGHT.md) for detailed safety checks.

---

## Key Docs to Read

| Document | What It Covers |
|----------|----------------|
| [ATLAS_REPO_MAP.md](../ATLAS_REPO_MAP.md) | Where everything lives |
| [DECISIONS.md](../DECISIONS.md) | Why things are built this way |
| [docs/reality/](../reality/) | Operational constraints |
| [PREFLIGHT.md](PREFLIGHT.md) | Pre-commit safety checks |

---

## Getting Help

- Check `docs/reality/` for operational context
- Check `archive/cockpit_snapshot/` for previous implementations
- Ask in the project chat

---

*Atlas: Making messy trapping locations make sense in data.*
