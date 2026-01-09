# Scripts Directory

Automation scripts for Atlas.

## Structure

```
scripts/
├── ingest/         # Source-specific data ingests
├── normalize/      # Dedupe and canonicalization
└── lib/            # Shared utilities
```

## Ingest Scripts

| Script | Source | Description |
|--------|--------|-------------|
| `ingest_airtable_appointment_requests.py` | Airtable | Import appointment request forms |
| `ingest_airtable_trapping_requests.py` | Airtable | Import trapping requests |
| `ingest_clinichq_upcoming_appointments.py` | ClinicHQ | Import scheduled appointments |
| `ingest_clinichq_historical.py` | ClinicHQ | Import historical records |

## Running Ingests

```bash
# Activate venv
source .venv/bin/activate

# Dry run (no DB writes)
python scripts/ingest/ingest_airtable_appointment_requests.py --dry-run

# Actual ingest
python scripts/ingest/ingest_airtable_appointment_requests.py
```

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `lib/print_env_exports.mjs` | Safe .env loading (preserves # in passwords) |
| `lib/db_diag.mjs` | Database connection diagnostics |

## Environment Requirements

Scripts expect:
- `DATABASE_URL` in environment (from `.env`)
- Python 3.10+ with venv
- Node.js 18+ for .mjs scripts

## Data Source Locations

Scripts read from Ben's local exports:
- `/Users/benmisdiaz/Desktop/AI_Ingest/` (never committed)

Configure paths via command-line args or environment variables.
