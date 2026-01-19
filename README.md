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

### Centralized Processing Pipeline (MIG_312, MIG_313)

All data ingestion flows through a unified job queue for consistent processing:

```
   CLI Scripts        UI Upload        Airtable Sync       Web Intake
        │                 │                  │                  │
        └────────────────┬┴──────────────────┴──────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   staged_records    │  ◀── Immutable audit trail
              │   + file_uploads    │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   processing_jobs   │  ◀── Job queue (MIG_312)
              │                     │
              │   status: queued    │
              │   → processing      │
              │   → linking         │
              │   → completed       │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  SQL ORCHESTRATOR   │  ◀── process_next_job()
              │                     │
              │  - Claims job       │
              │  - Routes to        │
              │    SQL processor    │
              │  - Runs entity      │
              │    linking          │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │ClinicHQ │    │Airtable │    │ Intake  │
    │Processor│    │Processor│    │Processor│
    └────┬────┘    └────┬────┘    └────┬────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │  ENTITY LINKING     │  ◀── run_all_entity_linking()
              │  (cats↔places,      │
              │   cats↔requests)    │
              └─────────────────────┘
```

**Key Components:**
- **`processing_jobs` table** — Centralized job queue with retry logic
- **`enqueue_processing()`** — Queue jobs for processing
- **`process_next_job()`** — Main orchestrator (called by cron every 10 min)
- **`process_clinichq_owner_info()`** — Backfills owner_email, links person_id
- **`run_all_entity_linking()`** — Links cats to places and requests

**Endpoints:**
- `POST /api/ingest/process` — Unified processor (cron every 10 min)
- `GET /api/health/processing` — Monitoring dashboard with data integrity checks

**Benefits:**
- All data flows through same pipeline regardless of entry point
- Automatic post-processing (no manual steps after ingestion)
- Order-independent processing (can ingest files in any order)
- Idempotent (safe to re-run any step)
- Observable via health endpoint and `v_processing_dashboard` view

### Data Engine (MIG_314-317)

The **Data Engine** is Atlas's unified identity resolution system. It provides robust person matching with:

- **Multi-signal weighted scoring**: Combines email (40%), phone (25%), name similarity (25%), and address (10%)
- **Household modeling**: Recognizes multiple people at the same address sharing identifiers
- **Configurable matching rules**: 9 default rules with adjustable thresholds stored in database
- **Review queue**: Uncertain matches (score 0.50-0.94) flagged for human review
- **Full audit trail**: Every matching decision logged with reasoning and score breakdown

```
                    Incoming Identity Data
                            │
                            ▼
                ┌───────────────────────┐
                │   DATA ENGINE         │
                │   IDENTITY RESOLVER   │
                │                       │
                │  ┌─────────────────┐  │
                │  │ Score Candidates│  │
                │  │ • Email match   │  │
                │  │ • Phone match   │  │
                │  │ • Name similarity│  │
                │  │ • Address match │  │
                │  └────────┬────────┘  │
                │           │           │
                │     ┌─────┴─────┐     │
                │     ▼           ▼     │
                │  ≥0.95       0.50-0.94│
                │  Auto        Review   │
                │  Match       Queue    │
                └───────────────────────┘
```

**Decision Types:**
| Score | Decision | Action |
|-------|----------|--------|
| ≥ 0.95 | `auto_match` | Link to existing person |
| 0.50 - 0.94 | `review_pending` | Create new, flag for review |
| < 0.50 | `new_entity` | Create new person |

**Endpoints:**
- `GET /api/health/data-engine` — Health check
- `GET /api/admin/data-engine/stats` — Statistics
- `GET /api/admin/data-engine/review` — Pending reviews
- `GET /api/admin/data-engine/households` — Household data

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

## Authentication

Atlas uses session-based authentication for staff access. See [docs/AUTH.md](docs/AUTH.md) for details.

### Quick Setup
1. Staff accounts are pre-created from Airtable sync
2. Default password is set via `STAFF_DEFAULT_PASSWORD` env var
3. All staff must change password on first login
4. Admins can reset passwords via `/admin/auth`

### Roles
| Role | Access |
|------|--------|
| `admin` | Full access to all features including Claude Code assistant |
| `staff` | Workflow access (requests, cats, people, places, journal) |
| `volunteer` | Read-only access with field observations |

### AI Assistants
- **Tippy** (`/tippy`) - Staff-facing AI that answers operational questions, looks up data, and logs field events
- **Claude Code** (`/admin/claude-code`) - Admin-only development assistant for codebase questions

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase PostgreSQL connection string |
| `STAFF_DEFAULT_PASSWORD` | Yes | Default password for new staff (they must change on first login) |
| `ANTHROPIC_API_KEY` | Yes* | For Tippy AI and Claude Code (*optional if AI disabled) |
| `GOOGLE_PLACES_API_KEY` | Yes | For geocoding and address validation |
| `SUPABASE_URL` | No | For file storage (media uploads) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | For file storage |
| `AIRTABLE_PAT` | No | For Airtable sync |
| `CRON_SECRET` | No | For authenticating cron job requests |
| `RESEND_API_KEY` | No | For sending emails |

See `apps/web/.env.example` for complete list with setup instructions.

## Key Docs

- [DEPLOYMENT.md](docs/runbooks/DEPLOYMENT.md) — Deploy to Vercel
- [START_HERE.md](docs/runbooks/START_HERE.md) — Full onboarding guide
- [ATLAS_REPO_MAP.md](docs/ATLAS_REPO_MAP.md) — Where things live
- [DECISIONS.md](docs/DECISIONS.md) — Architecture decision records
- [TECHNICAL_METHODOLOGY.md](docs/TECHNICAL_METHODOLOGY.md) — Population estimation, data quality, and known limitations
- [COMPREHENSIVE_DATA_AUDIT_2026_01_17.md](docs/COMPREHENSIVE_DATA_AUDIT_2026_01_17.md) — Data pipeline audit and fixes
- [INGEST_GUIDELINES.md](docs/INGEST_GUIDELINES.md) — Ingestion rules and centralized functions

## Architecture: Atlas + Beacon

```
┌─────────────────────────────────────────────────────────────┐
│                        BEACON                               │
│  TNR prioritization, population estimates, alteration rates │
│  Vortex model simulations, strategic targeting              │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Clean data + equations
┌─────────────────────────────────────────────────────────────┐
│                        ATLAS                                │
│  Unified search, canonical data, identity linking           │
│  Staff lookup tool, data collection, review queues          │
│  Colony estimates, Chapman mark-recapture, observation data │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Ingest
┌──────────────┬──────────────┬──────────────┬───────────────┐
│  ClinicHQ    │   Airtable   │    Forms     │  Atlas Native │
│  (primary)   │  (requests)  │  (intake)    │   (active)    │
└──────────────┴──────────────┴──────────────┴───────────────┘
```

### Ground Truth Principle

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.** Other organizations do small quantities; FFSC does mass quantities (4,000+/year). Therefore:

- **FFSC clinic data = verified alterations (ground truth)**
- External alteration rate ≈ 2% (negligible)
- Alteration Rate = `FFSC_altered / Population_estimate`

### Service Zones (Beacon Readiness)

All places are assigned to service zones for geographic analysis:

| Zone | Description |
|------|-------------|
| Santa Rosa | City of Santa Rosa |
| Petaluma | City of Petaluma |
| Rohnert Park/Cotati | Rohnert Park and Cotati areas |
| Sebastopol | City of Sebastopol |
| Healdsburg/Windsor | Healdsburg and Windsor areas |
| Sonoma Valley | Sonoma, Glen Ellen, Kenwood |
| North County | Cloverdale, Geyserville, rural north |
| Coastal | Bodega Bay, Jenner, Sea Ranch, coastal areas |
| Rural/Unincorporated | Other unincorporated Sonoma County |
| Out of Area | Marin, Napa, Lake, Mendocino counties |

Zones enable Beacon to calculate per-zone TNR progress, identify under-served areas, and prioritize resources.

### Key Equations (Beacon Population Model)

Based on Boone et al. 2019 (Vortex model):

```
Chapman Estimator:  N̂ = ((M+1)(C+1)/(R+1)) - 1
                    Where M = FFSC verified alterations

Alteration Rate:    p = A / N

Population Growth:  N(t+1) = N(t) + Births - Deaths + Immigration

Key Finding:        75% TNR intensity → 70% population reduction in 6 years
                    50% TNR intensity → minimal reduction
```

All parameters are configurable via admin panel with scientific defaults. See:
- [ATLAS_MISSION_CONTRACT.md](docs/ATLAS_MISSION_CONTRACT.md) — Full equations and Beacon alignment
- [TODO.md](docs/TODO.md) — Beacon-aligned implementation priorities
- `MIG_220` — Ecology configuration table
- `MIG_288` — Vortex population model parameters

---

*Atlas: Making messy trapping locations make sense in data, powering Beacon for strategic TNR.*
