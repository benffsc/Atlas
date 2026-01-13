# Atlas

**Trapper Operations Data Platform** — A stable, trustworthy system for managing trapping locations, requests, and clinic schedules.

**Live at:** [atlas.forgottenfelines.com](https://atlas.forgottenfelines.com)

## What Atlas Is

Atlas is the operational backbone for FFSC trapping operations and the foundation for **Beacon** (TNR prioritization analytics). It consolidates data from:
- **ClinicHQ** — 47,000+ historical appointments and surgery records (primary data source)
- **Airtable** — Current operational workflows for requests (re-exportable)
- **Form submissions** — Appointment requests from Typeform/Jotform
- **Atlas native** — Direct request intake and data collection

Atlas provides:
1. **Unified Search** — Find cats, people, places by any identifier (microchip, phone, address)
2. **Canonical Data** — Deduplicated people, places, and addresses (SoT layer)
3. **Clean Identity Linking** — Cats linked to people and places with quality safeguards
4. **Review Queues** — Surfaces for human triage and data cleanup
5. **Native Data Collection** — Request intake forms with validation pipeline
6. **Foundation for Beacon** — Accurate cat counts per location for TNR prioritization

## Guiding Principles

### 1. Airtable Stays Primary (For Now)
Airtable is the trusted operational system until Atlas proves itself. We run both in parallel during transition. Atlas reads from Airtable; it does not (yet) write back.

### 2. Location Ambiguity Is Real
Cats aren't always at a clean street address. Trail segments, parks, "behind the barn" — these are real locations. Atlas preserves "anchor locations" that capture context without pretending precision.

### 3. No Destructive Operations
We never DROP, DELETE, or TRUNCATE production data. Migrations are additive. Bad data goes to review queues, not the void.

### 4. Small, Shippable Steps
Each change should be small, testable, and independently valuable. Prefer incremental progress over ambitious rewrites.

### 5. Secrets Never Committed
DATABASE_URL, API keys, and tokens stay in `.env` files (gitignored). Never commit secrets, even in "test" configs.

## Quick Start

### Run Locally
```bash
cd apps/web
npm install
cp .env.example .env.local  # Add DATABASE_URL and GOOGLE_MAPS_API_KEY
npm run dev
# Open http://localhost:3000
```

### Deploy to Production
See [docs/runbooks/DEPLOYMENT.md](docs/runbooks/DEPLOYMENT.md) for Vercel setup.

### Full Setup Guide
See [docs/runbooks/START_HERE.md](docs/runbooks/START_HERE.md) for:
- Repository structure
- How to run migrations
- Data ingestion process

## Directory Structure

```
Atlas/
├── apps/
│   └── web/            # Next.js UI (deployed to Vercel)
│       └── src/
│           ├── app/        # Pages and API routes
│           │   ├── api/    # Backend API endpoints
│           │   ├── cats/   # Cat profile pages
│           │   ├── people/ # Person profile pages
│           │   └── requests/ # Request management
│           ├── components/ # Shared React components
│           └── lib/        # Database and utilities
├── docs/
│   ├── reality/        # Workflow constraints, Airtable/ClinicHQ truths
│   ├── runbooks/       # How to ingest, migrate, deploy
│   └── ops/            # Operational documentation
├── sql/
│   ├── migrations/     # Ordered, manual-apply migrations
│   └── schema/
│       ├── sot/        # Canonical entities + data quality migrations
│       ├── raw/        # Raw staging tables
│       └── review/     # Review queue tables
├── scripts/
│   └── ingest/         # Source-specific data ingests (Node.js)
├── data/               # LOCAL ONLY - never committed
└── archive/            # Curated reference files
```

## Data Architecture

Atlas follows a **Raw → Normalize → SoT** pipeline to ensure data integrity:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Raw Intake    │────▶│   Normalizer    │────▶│   SoT Tables    │
│  (append-only)  │     │  (validation)   │     │   (canonical)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Review Queue   │
                        │ (needs human)   │
                        └─────────────────┘
```

### Key Invariants
1. **No UI route writes directly to SoT tables** — All data goes through raw intake first
2. **Append-only raw tables** — Updates create new rows with `supersedes_raw_id`
3. **Validation before promotion** — Garbage names, invalid data caught before SoT
4. **Audit trail** — Every SoT write logged to `intake_audit_log`
5. **Stable keys** — Microchips always preserved, never overwritten

### Request Intake Fields
The enhanced request form captures comprehensive TNR data:
- **Location**: Place selection/creation, property type, location description
- **Contact**: Requester, property owner, best contact times
- **Permission & Access**: Permission status, overnight traps, access notes
- **Cat Details**: Count, confidence, colony duration, ear-tip status, friendliness
- **Kittens**: Count, age in weeks
- **Feeding**: Feeder info, schedule, best times seen
- **Urgency**: Reasons, deadline, priority level

## Data Quality

Atlas includes safeguards to ensure clean, trustworthy data:

### Identity Linking Rules
- **Phone Blacklist**: Shared phones (FFSC main line, Animal Services) are excluded from person linking to prevent "mega-persons"
- **Name Exclusions**: FFSC programs, locations, placeholders filtered from person profiles
- **See**: `sql/schema/sot/MIG_157__clean_identity_linking.sql`

### Place Deduplication
- Coordinate-proximity matching (within 50m)
- Exact address matching
- Exclusion patterns for non-places
- **See**: `sql/schema/sot/MIG_156__deduplicate_places.sql`, `MIG_158__clean_places.sql`

### Backup & Recovery
All cleanup migrations create backup tables (`backup_*_mig15X`) for data rescue if needed.

### Operational Features (MIG_182)
- **Request Status Tracking**: new, needs_review, triaged, scheduled, in_progress, active, on_hold, completed, partial, cancelled
- **Hold Reasons**: weather, callback_pending, access_issue, resource_constraint, client_unavailable, scheduling_conflict, trap_shy
- **Safety Notes**: Per-place safety concerns and notes for trappers
- **Staleness Detection**: `v_stale_requests` view flags inactive requests
- **Hotspot Detection**: `v_place_hotspots` identifies locations with multiple active requests
- **Status History**: Full audit trail of status changes

### Intake Pipeline (MIG_183, MIG_184)
- `raw_intake_request` — Append-only request intake
- `raw_intake_person` — New person submissions
- `raw_intake_place` — New place submissions
- `review_queue` — Items needing human review
- `intake_audit_log` — Promotion audit trail
- `promote_intake_request()` — Validates and promotes to SoT
- `is_garbage_name()` — Prevents invalid people creation

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `GOOGLE_MAPS_API_KEY` | For geocoding and address validation |

## Key Docs

- [DEPLOYMENT.md](docs/runbooks/DEPLOYMENT.md) — Deploy to Vercel
- [START_HERE.md](docs/runbooks/START_HERE.md) — Full onboarding guide
- [ATLAS_REPO_MAP.md](docs/ATLAS_REPO_MAP.md) — Where things live
- [DECISIONS.md](docs/DECISIONS.md) — Architecture decision records

## Architecture: Atlas + Beacon

```
┌─────────────────────────────────────────────────────────────┐
│                        BEACON                               │
│  TNR prioritization, population estimates, alteration rates │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Clean data
┌─────────────────────────────────────────────────────────────┐
│                        ATLAS                                │
│  Unified search, canonical data, identity linking           │
│  Staff lookup tool, data collection, review queues          │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Ingest
┌──────────────┬──────────────┬──────────────┬───────────────┐
│  ClinicHQ    │   Airtable   │    Forms     │  Atlas Native │
│  (primary)   │  (requests)  │  (intake)    │   (active)    │
└──────────────┴──────────────┴──────────────┴───────────────┘
```

---

*Atlas: Making messy trapping locations make sense in data.*
