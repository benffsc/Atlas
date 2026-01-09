# Atlas

**Trapper Operations Data Platform** — A stable, trustworthy system for managing trapping locations, requests, and clinic schedules.

## What Atlas Is

Atlas is the operational backbone for FFSC trapping operations. It consolidates data from:
- **Airtable** — Current primary source of truth for requests and workflows
- **ClinicHQ** — Historical appointments and surgery records
- **Form submissions** — Appointment requests from Typeform/Jotform

Atlas provides:
1. **Canonical data** — Deduplicated people, places, and addresses (SoT layer)
2. **Review queues** — Surfaces for human triage and data cleanup
3. **Operational views** — Week planning, capacity tracking, intake management

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

See [docs/runbooks/START_HERE.md](docs/runbooks/START_HERE.md) for:
- Repository structure
- How to run migrations
- Where local data lives (never committed)

## Directory Structure

```
Atlas/
├── docs/
│   ├── reality/        # Workflow constraints, Airtable/ClinicHQ truths
│   └── runbooks/       # How to ingest, migrate, run sanity checks
├── sql/
│   ├── migrations/     # Ordered, manual-apply migrations
│   ├── schema/
│   │   ├── sot/        # Canonical entities (addresses, places, people)
│   │   ├── raw/        # Raw staging tables (airtable_*, clinichq_*)
│   │   └── review/     # Review queue tables and views
│   └── views/          # UI-facing views (minimal set)
├── scripts/
│   ├── ingest/         # Source-specific data ingests
│   ├── normalize/      # Dedupe and canonicalization
│   └── lib/            # Shared utilities
├── apps/
│   └── web/            # Next.js UI (when stable)
├── data/               # LOCAL ONLY - never committed
└── archive/            # Curated "maybe useful" files for later review
```

## Key Docs

- [ATLAS_REPO_MAP.md](docs/ATLAS_REPO_MAP.md) — Where things live
- [START_HERE.md](docs/runbooks/START_HERE.md) — Onboarding guide
- [DECISIONS.md](docs/DECISIONS.md) — Architecture decision records

---

*Atlas: Making messy trapping locations make sense in data.*
