# Atlas Repository Map

Quick reference for where things live.

## Directory Structure

```
Atlas/
├── docs/                    # Documentation
│   ├── reality/             # Workflow constraints & operational truths
│   │   └── README.md        # Index of reality docs
│   └── runbooks/            # How-to guides
│       ├── START_HERE.md    # Onboarding guide
│       └── PREFLIGHT.md     # Pre-commit safety checks
│
├── sql/                     # Database artifacts
│   ├── migrations/          # Ordered migrations (MIG_NNN__name.sql)
│   ├── schema/
│   │   ├── sot/             # Source of Truth tables
│   │   │   └── addresses.sql, places.sql, people.sql, cats.sql
│   │   ├── raw/             # Raw/staging tables
│   │   │   └── airtable_*.sql, clinichq_*.sql, forms_*.sql
│   │   └── review/          # Review queue tables
│   │       └── data_issues.sql, geocode_queue.sql
│   └── views/               # UI-facing views (minimal set)
│
├── scripts/                 # Automation
│   ├── ingest/              # Source-specific ingests
│   │   └── ingest_airtable.py, ingest_clinichq.py
│   ├── normalize/           # Dedupe & canonicalization
│   │   └── normalize_addresses.py, link_people.py
│   └── lib/                 # Shared utilities
│       └── csv_utils.py, hash_utils.py, db.py
│
├── apps/                    # Applications
│   └── web/                 # Next.js UI (when ready)
│
├── data/                    # LOCAL ONLY - never committed
│   └── README.md            # Points to local export paths
│
└── archive/                 # Curated "maybe useful" files
    └── cockpit_snapshot/    # Files from ffsc-trapper-cockpit
        ├── sql/
        ├── scripts/
        └── docs/
```

## Naming Conventions

### SQL Artifacts
- `MIG_NNN__short_snake_case.sql` — Migrations (zero-padded, double underscore)
- `VIEW_NNN__short_snake_case.sql` — Named views
- `CHK_NNN__short_snake_case.sql` — Sanity check queries

### Schema Prefixes
All database objects live in the `trapper` schema:
- `trapper.addresses` — Canonical addresses (SoT)
- `trapper.airtable_appointment_requests` — Raw Airtable ingest
- `trapper.v_intake_unified_feed` — View for UI

## Key Concepts

### SoT (Source of Truth)
Canonical, deduplicated entities. Created by normalizing raw data + human review.
- `trapper.addresses` — Geocode-validated addresses
- `trapper.places` — Locations with context (may be approximate)
- `trapper.people` — Deduplicated contacts
- `trapper.canonical_cats` — Identified cats (future)

### Raw
Staging tables for ingested data. Preserves original source format.
- `trapper.airtable_*` — Airtable exports
- `trapper.clinichq_*` — ClinicHQ exports
- `trapper.forms_*` — Form submissions

### Review
Queues for human triage. Surfaced in UI for cleanup.
- `trapper.data_issues` — Flagged problems with severity
- `trapper.geocode_review_queue` — Addresses needing manual geocoding

## Data Flow

```
Source (Airtable/ClinicHQ/Forms)
    ↓
[scripts/ingest/*]
    ↓
Raw Tables (sql/schema/raw/)
    ↓
[scripts/normalize/*]
    ↓
SoT Tables (sql/schema/sot/) + Review Queues (sql/schema/review/)
    ↓
Views (sql/views/)
    ↓
UI (apps/web/)
```

---

*See [START_HERE.md](runbooks/START_HERE.md) for how to work with this structure.*
