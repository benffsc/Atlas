# Atlas Engineering Guide

**Audience:** Engineers, AI assistants, database admins
**Version:** 1.0
**Created:** 2026-01-29

---

## System Overview

Atlas is a Next.js application backed by PostgreSQL (with PostGIS) that manages TNR (Trap-Neuter-Return) operations for Forgotten Felines of Sonoma County. All database objects live in the `trapper` schema.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (App Router), React, Tailwind CSS |
| Backend | Next.js API Routes (App Router) |
| Database | PostgreSQL 15 + PostGIS |
| Hosting | Vercel (web), Supabase (database) |
| External APIs | ClinicHQ, Airtable, ShelterLuv, PetLink, Google Places, Resend |

### File Structure

```
/apps/web/              Next.js web application
  /src/app/api/         API routes
  /src/app/admin/       Admin pages
  /src/app/             Public/staff pages
  /src/components/      React components
  /src/lib/             Shared utilities (db.ts, email.ts)
/scripts/ingest/        Data sync scripts (Node.js)
/scripts/jobs/          AI enrichment scripts
/sql/schema/sot/        Database migrations (MIG_NNN__description.sql)
/docs/                  Documentation
```

---

## Seven-Layer Architecture

All data flows through these layers in order. No layer may be skipped.

```
L1  RAW           → staged_records (append-only, never delete)
L2  IDENTITY      → find_or_create_* functions, Data Engine scoring
L3  ENRICHMENT    → AI extraction, entity_attributes
L4  CLASSIFICATION → place_contexts, known_organizations
L5  SOURCE OF TRUTH → sot_people, sot_cats, sot_requests, places
L6  WORKFLOWS     → intake queue, request lifecycle, journal
L7  BEACON        → population modeling, Chapman estimator, colony clustering
```

### Key Invariants

| ID | Rule |
|----|------|
| INV-1 | **No Data Disappears.** SoT records are never hard-deleted. L1 RAW is append-only. |
| INV-2 | **Manual > AI.** Staff-verified data cannot be overwritten by inference. |
| INV-3 | **SoT Are Stable Handles.** `person_id`, `cat_id`, `place_id`, `request_id` are permanent. |
| INV-4 | **Provenance Required.** Every record carries `source_system` + `source_record_id`. |
| INV-5 | **Identity by Identifier Only.** Match people by email/phone, never name alone. |
| INV-6 | **Active Flows Are Sacred.** Changes must be additive + backward-compatible. |

---

## Entity Creation (Mandatory Functions)

Direct INSERT to SoT tables is **prohibited**. Always use:

| Entity | Function | Key Behavior |
|--------|----------|-------------|
| Person | `find_or_create_person(email, phone, first, last, addr, source)` | Data Engine scoring, merge chain following, identifier creation |
| Place | `find_or_create_place_deduped(address, name, lat, lng, source)` | Address normalization, geocoding queue, dedup |
| Cat | `find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` | Microchip validation, survivorship rules |
| Request | `find_or_create_request(source, record_id, created_at, ...)` | Auto-creates people/places, attribution windows |

### Valid source_system Values

`'airtable'`, `'clinichq'`, `'web_intake'`, `'atlas_ui'`, `'shelterluv'`, `'volunteerhub'`

Do not invent new values. If a new source is needed, register it in `orchestrator_sources` first.

---

## Data Zones

| Zone | Tables | Hygiene Rule |
|------|--------|-------------|
| **ACTIVE** | `web_intake_submissions`, `sot_requests`, `journal_entries`, `request_trapper_assignments`, `places`, `sot_people`, `sot_cats`, `staff`, `staff_sessions`, `communication_logs` | Do not touch without Safety Gate |
| **SEMI-ACTIVE** | `colonies/*`, `place_contexts/*`, `known_organizations`, `extraction_queue/*`, `tippy_*`, `data_engine_*` | Soft-archive only, test before changing |
| **HISTORICAL** | `staged_records`, `processing_jobs`, `entity_edits`, `place_colony_estimates`, `cat_birth_events`, `cat_mortality_events`, all `v_beacon_*` views | Can clean more aggressively, but `staged_records` is append-only (INV-1) |

---

## Active Flow Call Graphs

### Flow 1: Phone Intake (POST /api/intake)

```
INSERT INTO web_intake_submissions
  → trg_auto_triage_intake → compute_intake_triage()
  → trg_intake_create_person → find_or_create_person()
  → trg_intake_link_place → link_intake_submission_to_place()
  → trg_check_intake_duplicate → check_intake_duplicate()
  → trg_intake_colony_estimate → INSERT place_colony_estimates
  → trg_queue_intake_extraction → INSERT extraction_queue
```

Required POST body: `first_name`, `last_name`, (`email` OR `phone`), `cats_address`

### Flow 2: Intake Queue (GET /api/intake/queue)

Reads from `v_intake_triage_queue` view over `web_intake_submissions`.

### Flow 3: Request Lifecycle (GET/PATCH /api/requests/[id])

- GET: Joins `sot_requests` + `places` + `sot_people` + `v_place_colony_status` + `request_status_history` + `request_trapper_assignments`
- PATCH triggers:
  - `trg_log_request_status` → `request_status_history`
  - `trg_set_resolved_at` → sets `resolved_at` on completion/cancellation
  - `trg_request_activity` → updates activity timestamps
  - `trg_assign_colony_context_on_request` → auto-tags place as colony_site
  - `trg_request_colony_estimate` → creates colony estimate from request data

### Flow 4: Journal (GET/POST /api/journal)

- INSERT into `journal_entries` → `trg_journal_entry_history_log` → `journal_entry_history`
- Optionally updates `web_intake_submissions` for contact tracking

### Flow 5: Auth (GET /api/auth/me)

Reads `staff` + `staff_sessions`. Session-based authentication.

---

## Writing Migrations

### File Naming

```
sql/schema/sot/MIG_{NNN}__{description}.sql
```

Use the next available number. Check existing files with `ls sql/schema/sot/MIG_*.sql | tail -5`.

### Template

```sql
-- ============================================================================
-- MIG_NNN: Description
-- ============================================================================
-- TASK_LEDGER reference: TASK_XXX or DH_XXXX
-- ACTIVE Impact: Yes/No — explain
--
-- What this migration does (2-3 sentences).
-- ============================================================================

\echo '=== MIG_NNN: Description ==='

-- Step 1: ...
\echo ''
\echo 'Step 1: Description'

-- SQL here

-- Verification
\echo ''
\echo 'Verification:'
-- Diagnostic queries

-- Summary
\echo ''
\echo '====== MIG_NNN SUMMARY ======'
\echo 'What happened.'
\echo '=== MIG_NNN Complete ==='
```

### Rules

1. Use `IF NOT EXISTS` for CREATE TABLE/INDEX
2. Use `CREATE OR REPLACE` for views and functions
3. Add `COMMENT ON` for documentation
4. End with `\echo` summary
5. Include pre/post diagnostics
6. Include rollback instructions

### Running Migrations

```bash
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -f sql/schema/sot/MIG_NNN__description.sql
```

---

## Processing Pipeline

### Architecture

```
External Source → staged_records (L1 RAW)
  → enqueue_processing() → processing_jobs (queue)
  → process_next_job() → routes by source_system
  → Entity creation via find_or_create_* functions
  → run_all_entity_linking() → links across entities
```

### Job Queue

`processing_jobs` uses `FOR UPDATE SKIP LOCKED` for non-blocking job claiming:

```sql
SELECT * FROM trapper.process_next_job(500);
```

Routes by `source_system`:
- `clinichq` → `process_clinichq_owner_info()`, `process_clinichq_cat_info()`, `process_clinichq_appointment_info()`
- `shelterluv` → `process_shelterluv_people_batch()`, `process_shelterluv_outcomes()`
- `airtable` → `process_airtable_request()`
- Default → `data_engine_process_batch()`

### Cron Endpoints

| Endpoint | Schedule | What It Does |
|----------|----------|-------------|
| `POST /api/ingest/process` | Every 10 min | Process next batch of queued jobs |
| `POST /api/cron/entity-linking` | Daily 7:30 AM | Link cats→places, appointments→trappers |
| `POST /api/cron/beacon-enrich` | Daily 10 AM | AI birth/mortality extraction |
| `POST /api/cron/send-emails` | Daily | Send queued emails |

---

## Data Engine (Identity Resolution)

### How It Works

`find_or_create_person()` delegates to `data_engine_resolve_identity()`:

1. Score candidates using multi-signal weights: email (40%), phone (25%), name (25%), address (10%)
2. Score >= 0.95 → **auto_match** (return existing person)
3. Score 0.50-0.94 → **review_pending** (create new, flag for review)
4. Score < 0.50 → **new_entity** (create new person)

### Key Tables

| Table | Purpose |
|-------|---------|
| `data_engine_matching_rules` | Configurable weights/thresholds |
| `data_engine_match_decisions` | Full audit trail of every identity decision |
| `data_engine_soft_blacklist` | Shared identifiers (e.g., shared family phone) |
| `households` + `household_members` | Same-address groupings |

### Admin Endpoints

- `GET /api/admin/data-engine/review` — View pending reviews
- `POST /api/admin/data-engine/review/[id]` — Resolve a review (merge/reject/keep separate)
- `GET /api/admin/data-engine/stats` — Comprehensive statistics

---

## Orchestrator (Source Registry)

The orchestrator tracks all data sources and their routing rules:

```sql
-- See all registered sources
SELECT source_system, source_table, display_name, is_active, total_records_ingested
FROM trapper.orchestrator_sources ORDER BY source_system;

-- See routing rules for a source
SELECT source_field, target_surface, target_field, routing_type
FROM trapper.orchestrator_routing_rules
WHERE source_system = 'clinichq' AND source_table = 'owner_info';

-- Register a new source
SELECT trapper.register_source('new_source', 'table', 'Display Name', '{person,cat}', 'api_sync');

-- Map source fields
SELECT trapper.map_source_field('new_source', 'table', 'email', 'sot_people', 'email', 'function_call', 'find_or_create_person');
```

### Health Views

| View | Purpose |
|------|---------|
| `v_orchestrator_health` | Pipeline throughput per source (healthy/stale/errors/backlogged) |
| `v_data_why_missing` | Entities missing expected data (no identifiers, no microchip, no place link) |
| `v_merge_chain_health` | Detects merge chain black holes (should be 0 rows) |
| `v_routing_anomalies` | Flags suspicious data (high cat counts, stale sources, too many identifiers) |

---

## Ingest Scripts

### Location

```
scripts/ingest/          Data sync scripts
scripts/ingest/_lib/     Shared utilities (batch_ingest.mjs)
```

### Running

```bash
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
node scripts/ingest/shelterluv_import.mjs
node scripts/ingest/master_list_import.mjs
```

### Pattern

Every ingest script must:

1. Stage raw records in `staged_records`
2. Use `find_or_create_*` functions for entity creation
3. Track `source_system` + `source_record_id` on all records
4. Log changes to `entity_edits` for audit

See `docs/INGEST_GUIDELINES.md` for complete documentation.

---

## AI Enrichment Scripts

| Script | Purpose | Output |
|--------|---------|--------|
| `scripts/jobs/populate_birth_events_from_appointments.mjs` | Birth events from lactating appointments | `cat_birth_events` |
| `scripts/jobs/populate_mortality_from_clinic.mjs` | Mortality from euthanasia records | `cat_mortality_events` |
| `scripts/jobs/parse_quantitative_data.mjs` | Cat counts from informal notes | `place_colony_estimates` |
| `scripts/jobs/paraphrase_google_map_entries.mjs` | Light cleanup of Google Maps notes | `google_map_entries.ai_summary` |

All AI-generated data is labeled `source_type = 'ai_parsed'`.

---

## Beacon (Population Modeling)

### Ground Truth Principle

FFSC is the only dedicated spay/neuter clinic for community cats in Sonoma County. FFSC clinic data = verified alterations = ground truth. External alteration rate is ~2% (negligible).

### Chapman Mark-Recapture Estimator

```
N̂ = ((M+1)(C+1)/(R+1)) - 1

M = Marked cats (FFSC verified alterations)
C = Total cats observed
R = Ear-tipped cats observed
```

Implemented in `v_place_ecology_stats`.

### Key Beacon Views

| View | What It Computes |
|------|-----------------|
| `v_place_ecology_stats` | Chapman population estimate, alteration rate |
| `v_place_colony_status` | Weighted colony size from all sources |
| `v_request_alteration_stats` | Per-request TNR attribution with rolling windows |
| `v_seasonal_breeding_patterns` | Monthly kitten/pregnancy rates |
| `v_place_immigration_stats` | Immigration vs local births per place |
| `v_trapper_full_stats` | Comprehensive trapper statistics |

---

## Active Flow Safety Gate

Any change touching ACTIVE flow surfaces must pass this gate. See `docs/ACTIVE_FLOW_SAFETY_GATE.md` for the full checklist.

### Quick SQL Smoke Queries

```sql
-- Views still resolve
SELECT COUNT(*) FROM trapper.v_intake_triage_queue;
SELECT COUNT(*) FROM trapper.v_request_list;

-- Critical triggers still enabled
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'trapper.web_intake_submissions'::regclass
  AND tgname IN ('trg_auto_triage_intake', 'trg_intake_create_person', 'trg_intake_link_place');

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'trapper.sot_requests'::regclass
  AND tgname IN ('trg_log_request_status', 'trg_set_resolved_at', 'trg_request_activity');

-- Core tables have data
SELECT 'web_intake_submissions' AS t, COUNT(*) FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'journal_entries', COUNT(*) FROM trapper.journal_entries
UNION ALL SELECT 'staff', COUNT(*) FROM trapper.staff;
```

### Rules for ACTIVE Changes

1. Must be **additive** — new columns OK, removing columns requires migration path
2. Must not **rename** tables, views, columns, or functions without deprecation
3. Must not **change trigger behavior** without explicit documentation
4. Must not **change API response shapes** — add fields, never remove
5. Must run **Safety Gate** — all checks must pass
6. Must have **rollback** documented

---

## Debugging

### Common Column Name Gotchas

| What You Expect | What It Actually Is |
|----------------|-------------------|
| `sot_people.first_name` | `sot_people.display_name` (single field) |
| `sot_cats.name` | `sot_cats.display_name` |
| `sot_cats.source_system` | `sot_cats.data_source` (enum type, cast `::text` in UNIONs) |
| `sot_requests.formatted_address` | `sot_requests.place_id` → JOIN `places` for address |
| `processing_jobs.error_message` | `processing_jobs.last_error` |
| `processing_jobs.attempts` | `processing_jobs.attempt_count` |
| `person_identifiers.id_value` | `person_identifiers.id_value_raw` (+ `id_value_norm` for normalized) |

### Database Connection

```bash
# Load DATABASE_URL from .env
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)

# Run a migration
psql "$DATABASE_URL" -f sql/schema/sot/MIG_NNN__description.sql

# Interactive session
psql "$DATABASE_URL"
```

Note: `source .env` alone is unreliable — use the `export` pattern above.

### Key Diagnostic Queries

```sql
-- Pipeline health
SELECT * FROM trapper.v_orchestrator_health;

-- Why is data missing?
SELECT entity_type, issue, COUNT(*) FROM trapper.v_data_why_missing
GROUP BY entity_type, issue ORDER BY COUNT(*) DESC;

-- Merge chain integrity (should be 0)
SELECT entity_type, COUNT(*) FROM trapper.v_merge_chain_health
GROUP BY entity_type;

-- Processing queue status
SELECT status, COUNT(*) FROM trapper.processing_jobs GROUP BY status;

-- Data Engine health
SELECT * FROM trapper.v_data_engine_health;

-- Identity review queue
SELECT * FROM trapper.v_data_engine_review_queue LIMIT 20;
```

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` | AI development rules, coding conventions |
| `ATLAS_NORTH_STAR.md` | System layers, invariants, data zones |
| `ATLAS_MISSION_CONTRACT.md` | Beacon science, population modeling |
| `ACTIVE_FLOW_SAFETY_GATE.md` | Validation checklist for active flow changes |
| `TASK_LEDGER.md` | Task cards with scope, validation, rollback |
| `CENTRALIZED_FUNCTIONS.md` | Entity creation function reference |
| `INGEST_GUIDELINES.md` | Data ingestion patterns |
| `DATA_FLOW_ARCHITECTURE.md` | Overall data flow diagrams |
