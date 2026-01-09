# SQL Directory

Database artifacts for Atlas.

## Structure

```
sql/
├── migrations/         # Ordered migrations (MIG_NNN__name.sql)
├── schema/
│   ├── sot/            # Source of Truth tables
│   ├── raw/            # Raw/staging tables
│   └── review/         # Review queue tables
└── views/              # UI-facing views
```

## Applying Migrations

Migrations are applied **manually** via psql or Supabase SQL Editor.

```bash
# Via psql
source .env
psql "$DATABASE_URL" -f sql/migrations/MIG_050__create_appointment_requests_table.sql

# Via Supabase
# Copy contents to SQL Editor and run
```

## Naming Convention

- `MIG_NNN__short_snake_case.sql` — Migrations (zero-padded NNN, double underscore)
- `VIEW_NNN__short_snake_case.sql` — Named views
- `CHK_NNN__short_snake_case.sql` — Sanity check queries
- `QRY_NNN__short_snake_case.sql` — Ad-hoc queries

All objects use the `trapper` schema.

## Migration Order

For a fresh database, apply migrations in numeric order:
1. Schema/table migrations first
2. View migrations after tables exist
3. Index migrations last

## Schema Philosophy

### SoT (Source of Truth)
Canonical, deduplicated entities. Created by normalizing raw data + human review.
- Location: `sql/schema/sot/`
- Examples: addresses, places, people, canonical_cats

### Raw
Staging tables for ingested data. Preserves original source format.
- Location: `sql/schema/raw/`
- Examples: appointment_requests, clinichq_upcoming_appointments

### Review
Queues for human triage. Surfaced in UI for cleanup.
- Location: `sql/schema/review/`
- Examples: data_issues, geocode_review_queue
