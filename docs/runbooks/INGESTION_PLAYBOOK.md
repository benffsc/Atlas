# FFSCTrapperApp — Data Ingestion Playbook

## Overview

This document explains how to import data from Airtable and ClinicHQ into the Trapper App database.

## Where to Drop Files

| Data Type | Folder | Format | Naming Convention |
|-----------|--------|--------|-------------------|
| Airtable Appointment Requests | `data/incoming/airtable/appointment_requests/` | CSV | `airtable_appointment_requests_YYYY-MM-DD.csv` |
| Airtable Trapping Requests | `data/incoming/airtable/trapping_requests/` | CSV | `airtable_trapping_requests_YYYY-MM-DD.csv` |
| ClinicHQ Upcoming Appointments | `data/incoming/clinichq/upcoming/` | XLSX | `clinichq_upcoming_appts_YYYY-MM-DD_to_YYYY-MM-DD.xlsx` |

All `data/incoming/` folders are gitignored — files stay local.

## Quick Start

### 1. Drop your export files into the appropriate folders

### 2. Run the ingestion (dry run first)
```bash
bash scripts/ingest_all.sh --dry-run
```

### 3. Run for real
```bash
bash scripts/ingest_all.sh
```

### 4. Verify with checks
```bash
bash scripts/run_checks.sh
```

## Individual Ingest Scripts

### Airtable Appointment Requests
```bash
python ingest_airtable_appointment_requests.py \
    --file data/incoming/airtable/appointment_requests/your_file.csv \
    --schema trapper \
    --dry-run \
    --verbose
```

### ClinicHQ Upcoming Appointments
```bash
python ingest_clinichq_upcoming_appointments.py \
    --file data/incoming/clinichq/upcoming/your_file.xlsx \
    --schema trapper \
    --dry-run \
    --verbose
```

### Airtable Trapping Requests (existing importer)
```bash
python ingest_airtable_trapping_requests.py \
    --csv data/incoming/airtable/trapping_requests/your_file.csv \
    --schema trapper
```

## Preview Feed Views

After ingestion, preview the data:

```bash
# Appointment requests (most recent first)
source .env && psql "$DATABASE_URL" -P pager=off -c \
    "SELECT id, submitted_at, requester_name, cats_address, submission_status FROM trapper.v_appointment_requests_feed LIMIT 10;"

# Upcoming appointments (soonest first)
source .env && psql "$DATABASE_URL" -P pager=off -c \
    "SELECT id, appt_date, client_full_name, client_address, animal_name FROM trapper.v_upcoming_appointments_feed LIMIT 10;"
```

## Idempotency

All ingest scripts are idempotent:
- Re-running with the same file updates existing records (no duplicates)
- Uses `source_row_hash` as unique key for deduplication
- Safe to run multiple times

## Deduplication Keys

| Table | Key Strategy |
|-------|--------------|
| `appointment_requests` | Airtable Record ID if present, else hash of (submitted_at + email/phone + cats_address) |
| `clinichq_upcoming_appointments` | Hash of (appt_date + client name + address + animal name + appt_number) |
| `requests` (trapping) | `case_number` |

## Troubleshooting

### "python: command not found"
```bash
source .venv/bin/activate
# Or use the full path:
.venv/bin/python script.py
```

### "openpyxl not found"
```bash
pip install openpyxl
```

### "psql not found"
```bash
export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
```

### "DATABASE_URL not set"
Ensure `.env` file exists in repo root with `DATABASE_URL=...`

---

*Last updated: 2025-12-31*
