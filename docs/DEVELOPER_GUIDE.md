# Atlas Developer Guide

**For Beacon Engineers - Security Review & Launch Preparation**

This guide provides everything needed to understand, run, and maintain Atlas - FFSC's cat colony and TNR management system.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Repository Structure](#repository-structure)
4. [Data Model](#data-model)
5. [Running the System](#running-the-system)
6. [Data Ingestion](#data-ingestion)
7. [Security Considerations](#security-considerations)
8. [Key Files Reference](#key-files-reference)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ (with PostGIS extension)
- npm or pnpm

### Environment Variables
Create `.env.local` in `apps/web/`:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/atlas

# Google APIs
GOOGLE_MAPS_API_KEY=AIza...      # Frontend maps
GOOGLE_PLACES_API_KEY=AIza...   # Geocoding backend

# Airtable (for syncing existing data)
AIRTABLE_PAT=pat...             # Personal Access Token
AIRTABLE_BASE_ID=appl...        # Base ID

# Optional: VolunteerHub
VOLUNTEERHUB_API_KEY=...
VOLUNTEERHUB_URL=...
VOLUNTEERHUB_ORG_ID=...
```

### Install & Run

```bash
# From repository root
cd apps/web
npm install
npm run dev
```

The app runs at `http://localhost:3000`

---

## Architecture Overview

### Three-Layer Data Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LAYER 1: RAW STAGING                        │
│  ops.staged_records                                             │
│  - Immutable audit trail                                        │
│  - Exact data as received from source                           │
│  - Keyed by (source_system, source_table, row_hash)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  LAYER 2: IDENTITY RESOLUTION                   │
│  Functions: find_or_create_person(), find_or_create_cat()       │
│  - Matches to existing entities by phone/email/microchip        │
│  - Respects blacklists and exclusion rules                      │
│  - Logs all decisions                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              LAYER 3: SOURCE OF TRUTH (SoT)                     │
│  sot.people  │  sot.cats  │  places  │  ops.requests             │
│  - Canonical, deduplicated records                              │
│  - Full relationship graphs                                      │
│  - All historical data preserved                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Core Principle: Preserve Everything

Atlas is the canonical source for ALL entities FFSC has ever interacted with:
- Every **person** contacted, serviced, or worked with
- Every **address** where we've been or had requests
- Every **cat** with a microchip or that we've processed
- Every **request** for service

"If FFSC touched it, it's in Atlas."

---

## Repository Structure

```
Atlas/
├── apps/
│   └── web/                    # Next.js 15 application
│       ├── src/
│       │   ├── app/            # App Router pages & API routes
│       │   │   ├── api/        # REST API endpoints
│       │   │   ├── cats/       # Cat pages
│       │   │   ├── people/     # Person pages
│       │   │   ├── places/     # Place pages
│       │   │   ├── requests/   # Request pages
│       │   │   └── intake/     # Intake queue & forms
│       │   ├── components/     # React components
│       │   └── lib/            # Utilities
│       └── package.json
│
├── scripts/
│   ├── ingest/                 # Data ingestion scripts
│   │   ├── _lib/               # Shared utilities
│   │   ├── clinichq_*.mjs      # ClinicHQ imports
│   │   ├── airtable_*.mjs      # Airtable syncs
│   │   ├── petlink_*.mjs       # PetLink imports
│   │   └── shelterluv_*.mjs    # ShelterLuv imports
│   └── normalize/              # Data normalization scripts
│
├── sql/
│   └── schema/
│       └── sot/                # SQL migrations (MIG_130 - MIG_205)
│
├── docs/                       # Documentation
│   ├── DATA_INGESTION_RULES.md # ⭐ CRITICAL - Read this first
│   ├── ARCHITECTURE_ENTITY_RESOLUTION.md
│   ├── DEPLOYMENT.md
│   └── DEVELOPER_GUIDE.md      # This file
│
└── data/                       # Data files (not in git)
    └── exports/                # CSV/XLSX exports for import
```

---

## Data Model

### Core Tables (Source of Truth)

| Table | Purpose | Primary Key | Identity Match |
|-------|---------|-------------|----------------|
| `sot.people` | All people | `person_id` (UUID) | Email, Phone |
| `sot.cats` | All cats | `cat_id` (UUID) | Microchip |
| `sot.places` | All locations | `place_id` (UUID) | Address, Coords |
| `ops.requests` | Service requests | `request_id` (UUID) | Source ID |

### Relationship Tables

| Table | Links | Purpose |
|-------|-------|---------|
| `sot.person_cat` | Person ↔ Cat | Ownership, brought_by |
| `sot.person_place` | Person ↔ Place | Residence, requester |
| `sot.cat_place` | Cat ↔ Place | Residence, trapped_at |
| `sot.person_identifiers` | Person → Identifiers | Email, phone, external IDs |
| `sot.cat_identifiers` | Cat → Identifiers | Microchip numbers |

### Identity Resolution

```sql
-- Find or create a person by email/phone
SELECT sot.find_or_create_person(
  'email@example.com',  -- email
  '5551234567',         -- phone
  'John',               -- first name
  'Doe',                -- last name
  '123 Main St',        -- address
  'airtable'            -- source system
) AS person_id;

-- Find or create a cat by microchip
SELECT sot.find_or_create_cat_by_microchip(
  '985121012345678',    -- microchip
  'Whiskers',           -- name
  'clinichq'            -- source
) AS cat_id;
```

---

## Running the System

### Development Mode

```bash
cd apps/web
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Database Migrations

Migrations are in `sql/schema/sot/`. Run them in order:

```bash
# Connect to database
psql $DATABASE_URL

# Run a specific migration
\i sql/schema/sot/MIG_205__entity_edit_audit.sql
```

### Running All Migrations (Fresh Database)

```bash
cd sql/schema/sot
for f in MIG_*.sql; do
  echo "Running $f..."
  psql $DATABASE_URL -f "$f"
done
```

---

## Data Ingestion

### Master Ingestion Script

See `scripts/ingest/rebuild_all.sh` for the complete ingestion pipeline.

### Ingestion Order (Dependencies Matter!)

```
1. Base Schema Setup
   └── Run migrations MIG_130 through MIG_205

2. Raw Data Import (Layer 1)
   ├── clinichq_cat_info_xlsx.mjs       # Cats with microchips
   ├── clinichq_owner_info_xlsx.mjs     # People from ClinicHQ
   ├── clinichq_appointment_info_xlsx.mjs # Appointment history
   ├── petlink_pets_xls.mjs             # PetLink microchip registrations
   ├── petlink_owners_xls.mjs           # PetLink owner data
   └── shelterluv_*.mjs                 # ShelterLuv imports

3. Identity Resolution (Layer 2)
   └── Run MIG_180__unified_clinichq_rebuild.sql

4. External System Sync
   ├── airtable_trapping_requests_sync.mjs  # Pull requests from Airtable
   ├── airtable_trappers_sync.mjs           # Sync trapper data
   └── airtable_link_requests_to_trappers.mjs

5. Data Quality Improvements
   ├── MIG_203__lmfm_name_cleanup.sql   # Clean organization prefixes
   └── normalize_intake_names.mjs        # Normalize submission names
```

### Running a Single Ingest Script

```bash
# From repository root
cd scripts/ingest

# Example: Sync Airtable trapping requests
node airtable_trapping_requests_sync.mjs

# Example: Import ClinicHQ data (requires XLSX in data/exports/)
node clinichq_cat_info_xlsx.mjs
```

### Adding New Data Sources

1. Create script in `scripts/ingest/{source}_{table}_sync.mjs`
2. Stage raw records in `ops.staged_records` table
3. Use `find_or_create_*` functions for identity resolution
4. Add relationships to link tables
5. Update `DATA_INGESTION_RULES.md`

---

## Admin Features

### Custom Intake Fields

Admins can add custom questions to the intake form without code changes.

**Location:** `/admin/intake-fields`

**Workflow:**
1. Go to Admin → Intake Fields
2. Click "Add Field" to create a custom question
3. Configure: label, type, options, help text, required status
4. Optionally restrict to specific call types
5. Click "Sync to Airtable" to push to Airtable table
6. Add the same question to Jotform and map it

**Database Table:** `ops.intake_custom_fields`

**Supported Field Types:**
- `text` - Single line text
- `textarea` - Multi-line text
- `number` - Numeric input
- `select` - Dropdown (single choice)
- `multiselect` - Dropdown (multiple choices)
- `checkbox` - Yes/no checkbox
- `date` - Date picker
- `phone` - Phone number
- `email` - Email address

**Show for Call Types:**
Fields can be shown only for specific call types (pet_spay_neuter, wellness_check, single_stray, colony_tnr, kitten_rescue, medical_concern). Leave empty to show for all.

**Beacon Critical:**
Mark fields as "Beacon Critical" if they're important for colony analytics. These are highlighted in the form and prioritized in data collection.

**Airtable Sync:**
The "Sync to Airtable" button uses the Airtable Metadata API to create fields in the `Public Intake Submissions` table. After syncing, you must:
1. Add the same question to your Jotform
2. Map the Jotform field to the new Airtable column

### Intake Queue Management

**Location:** `/intake/queue`

**Tabs:**
- **Needs Attention** - New submissions requiring action
- **Recent** - Recent submissions including booked
- **Booked** - Submissions with appointments scheduled
- **All Submissions** - Everything
- **Legacy** - Imported historical data

**Appointment Booking:**
- Click "Booked" to open booking modal with date picker
- "Change Appt" to modify existing appointment
- "Undo" to reset accidentally booked submissions
- "Reset to Pending" in detail modal for recovery

---

## Security Considerations

### API Security

| Endpoint | Auth | Notes |
|----------|------|-------|
| `/api/*` | None currently | Internal use only |
| `/api/intake/public` | CORS-restricted | Rate limited, honeypot |

### Environment Variables

**NEVER commit these:**
- `DATABASE_URL` - Database credentials
- `AIRTABLE_PAT` - Airtable access token
- `GOOGLE_MAPS_API_KEY` - API keys
- `VOLUNTEERHUB_API_KEY` - External API keys

### Database Access

- All queries use parameterized statements (no SQL injection)
- `pg` library with connection pooling
- No raw SQL string concatenation

### Input Validation

- Intake forms validate required fields
- Phone/email normalized before storage
- Address geocoding validated via Google API

### Data Sensitivity

| Data Type | Sensitivity | Storage |
|-----------|-------------|---------|
| Names | Medium | Plaintext |
| Email | Medium | Plaintext, indexed |
| Phone | Medium | Normalized, indexed |
| Address | Medium | Geocoded, stored |
| Microchip | Low | Plaintext |
| Medical Records | Low | ClinicHQ source |

### Audit Trail

All changes logged in:
- `ops.entity_edits` - Field-level edit history
- `ops.data_changes` - Ingest-time changes
- `ops.staged_records` - Raw input preservation

---

## Key Files Reference

### Critical Documentation

| File | Purpose |
|------|---------|
| `docs/DATA_INGESTION_RULES.md` | ⭐ Rules for adding data |
| `docs/ARCHITECTURE_ENTITY_RESOLUTION.md` | How identity resolution works |
| `docs/DEPLOYMENT.md` | Deployment instructions |
| `docs/TECHNICAL_NEARBY_COMPUTATION.md` | Nearby algorithm docs |

### Critical Code

| File | Purpose |
|------|---------|
| `sql/schema/sot/MIG_180__unified_clinichq_rebuild.sql` | Main ClinicHQ data processing |
| `apps/web/src/app/api/entities/[type]/[id]/edit/route.ts` | Entity editing API |
| `apps/web/src/app/api/intake/public/route.ts` | Public intake form API |
| `scripts/ingest/_lib/batch_ingest.mjs` | Shared ingestion utilities |

### Critical Functions (SQL)

| Function | Purpose |
|----------|---------|
| `sot.find_or_create_person()` | Identity resolution for people |
| `sot.find_or_create_cat_by_microchip()` | Identity resolution for cats |
| `sot.log_field_edit()` | Audit logging for edits |
| `sot.search_unified()` | Cross-entity search |

---

## Troubleshooting

### Common Issues

**"Person not found" when they should exist**
- Check `sot.person_identifiers` for their email/phone
- Phone might be in blacklist (`identity_phone_blacklist`)
- Name might be in exclusions (`identity_name_exclusions`)

**Duplicate records appearing**
- Check if `merged_into_person_id` is set (soft merge)
- Verify phone/email are normalized
- Run deduplication migration if needed

**Airtable sync failing**
- Verify `AIRTABLE_PAT` is valid (expires periodically)
- Check rate limits (5 requests/second)
- Verify base ID is correct

**Geocoding failing**
- Check `GOOGLE_PLACES_API_KEY` quota
- Verify address format
- Check `geocode_status` in places table

### Database Queries for Debugging

```sql
-- Find person by any identifier
SELECT * FROM sot.people p
JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
WHERE pi.id_value_norm LIKE '%5551234%';

-- Check staged records for a source
SELECT * FROM ops.staged_records
WHERE source_system = 'airtable'
ORDER BY created_at DESC
LIMIT 10;

-- View recent edits
SELECT * FROM ops.entity_edits
ORDER BY created_at DESC
LIMIT 20;

-- Check for duplicate people
SELECT display_name, COUNT(*)
FROM sot.people
WHERE merged_into_person_id IS NULL
GROUP BY display_name
HAVING COUNT(*) > 1;
```

---

## Active Flow Call Graphs

### Flow 1: Phone Intake (POST /api/intake)

```
INSERT INTO ops.web_intake_submissions
  → trg_auto_triage_intake → ops.compute_intake_triage()
  → trg_intake_create_person → sot.find_or_create_person()
  → trg_intake_link_place → sot.link_intake_submission_to_place()
  → trg_check_intake_duplicate → ops.check_intake_duplicate()
  → trg_intake_colony_estimate → INSERT ops.place_colony_estimates
  → trg_queue_intake_extraction → INSERT ops.extraction_queue
```

Required POST body: `first_name`, `last_name`, (`email` OR `phone`), `cats_address`

### Flow 2: Intake Queue (GET /api/intake/queue)

Reads from `ops.v_intake_triage_queue` view over `ops.web_intake_submissions`.

### Flow 3: Request Lifecycle (GET/PATCH /api/requests/[id])

- GET: Joins `ops.requests` + `sot.places` + `sot.people` + `ops.v_place_colony_status` + `ops.request_status_history` + `ops.request_trapper_assignments`
- PATCH triggers:
  - `trg_log_request_status` → `ops.request_status_history`
  - `trg_set_resolved_at` → sets `resolved_at` on completion/cancellation
  - `trg_request_activity` → updates activity timestamps
  - `trg_assign_colony_context_on_request` → auto-tags place as colony_site
  - `trg_request_colony_estimate` → creates colony estimate from request data

### Flow 4: Journal (GET/POST /api/journal)

- INSERT into `ops.journal_entries` → `trg_journal_entry_history_log` → `ops.journal_entry_history`
- Optionally updates `ops.web_intake_submissions` for contact tracking

### Flow 5: Auth (GET /api/auth/me)

Reads `sot.staff` + `sot.staff_sessions`. Session-based authentication.

---

## Common Column Name Gotchas

| What You Expect | What It Actually Is |
|----------------|-------------------|
| `sot.people.first_name` | `sot.people.display_name` (single field) |
| `sot.cats.name` | `sot.cats.display_name` |
| `sot.cats.source_system` | `sot.cats.data_source` (enum type, cast `::text` in UNIONs) |
| `ops.requests.formatted_address` | `ops.requests.place_id` → JOIN `sot.places` for address |
| `ops.processing_jobs.error_message` | `ops.processing_jobs.last_error` |
| `ops.processing_jobs.attempts` | `ops.processing_jobs.attempt_count` |
| `sot.person_identifiers.id_value` | `sot.person_identifiers.id_value_raw` (+ `id_value_norm` for normalized) |

---

## Contact

For questions about Atlas:
- **Ben Mis** - Primary developer
- **FFSC** - https://www.ffsc.org

For Beacon integration questions:
- See `docs/TECHNICAL_NEARBY_COMPUTATION.md` for Beacon-specific docs
