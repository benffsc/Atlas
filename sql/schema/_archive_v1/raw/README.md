# Raw Schema

Staging tables for ingested data. Preserves original source format exactly.

## Tables

| Table | Source | Purpose |
|-------|--------|---------|
| `trapper.appointment_requests` | Airtable | Form submissions requesting appointments |
| `trapper.clinichq_upcoming_appointments` | ClinicHQ | Scheduled appointments |
| `trapper.clinichq_hist_owners` | ClinicHQ | Historical owner records |
| `trapper.clinichq_hist_cats` | ClinicHQ | Historical cat records |
| `trapper.clinichq_hist_appts` | ClinicHQ | Historical appointments |

## Design Principles

1. **Preserve Original** — Don't transform on ingest; keep source fidelity
2. **Idempotent Ingest** — Re-running ingest updates existing rows, doesn't duplicate
3. **Source Tracking** — Every row has `source_file` and `source_row_hash`
4. **Timestamps** — `created_at`, `updated_at` for audit trail

## Ingest Pattern

```python
# Each row gets a unique key from source
source_row_hash = hash_row(row)

# Upsert: insert or update on conflict
INSERT INTO trapper.appointment_requests (...)
ON CONFLICT (source_row_hash) DO UPDATE SET ...
```

## Files

- `MIG_050__create_appointment_requests_table.sql`
- `MIG_051__create_clinichq_upcoming_appointments_table.sql`
- `MIG_078__clinichq_hist_tables.sql`
