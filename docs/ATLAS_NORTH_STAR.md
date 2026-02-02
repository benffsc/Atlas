# Atlas North Star

**Version:** 1.0
**Created:** 2026-01-28
**Owner:** Engineering (Claude Code is lead engineer)

---

## What Atlas Is

Atlas is the single operational + analytical data platform for Forgotten Felines of Sonoma County (FFSC). It captures every interaction FFSC has with people, cats, and places, then feeds that data into Beacon for population modeling and strategic TNR.

This document defines the **system layers**, **invariants**, **data zones**, and **do-not-break contracts** that every change must respect.

---

## System Layers

All data in Atlas flows through these layers, in order. No layer may be skipped.

```
┌─────────────────────────────────────────────────────────────────────┐
│  L1  RAW                                                            │
│  Immutable audit trail. staged_records, ingest_runs, file_uploads.  │
│  Rule: append-only. Never mutate. Never delete.                     │
├─────────────────────────────────────────────────────────────────────┤
│  L2  NORMALIZE / IDENTITY                                           │
│  Deduplication, identity resolution, merge chains.                  │
│  find_or_create_* functions, Data Engine scoring, households.       │
│  Rule: use centralized functions. Never inline INSERT to sot_*.     │
├─────────────────────────────────────────────────────────────────────┤
│  L3  ENRICHMENT (AI + Extraction)                                   │
│  AI Extraction Engine, entity_attributes, extraction_queue.         │
│  AI-inferred data from notes, forms, Google Maps, clinic records.   │
│  Rule: all AI output labeled source_type='ai_parsed'. Debuggable.   │
├─────────────────────────────────────────────────────────────────────┤
│  L4  CLASSIFICATION                                                 │
│  Classification Engine: place_contexts, context types, org links.   │
│  Manual staff input (is_verified=TRUE) overrides AI (inferred).     │
│  Rule: Manual > AI. Verified contexts are immutable to automation.  │
├─────────────────────────────────────────────────────────────────────┤
│  L5  SOURCE OF TRUTH (SoT)                                         │
│  Canonical entities: sot_people, sot_cats, sot_requests,           │
│  sot_appointments, places. Stable handles for all workflows.       │
│  Rule: SoT records are never deleted. Soft-merge via merged_into.  │
├─────────────────────────────────────────────────────────────────────┤
│  L6  WORKFLOWS                                                      │
│  Intake queue, request lifecycle, journal, trapper assignments,     │
│  email automation, clinic days. Staff-facing operational tools.     │
│  Rule: ACTIVE flows must not break. Changes must be additive.      │
├─────────────────────────────────────────────────────────────────────┤
│  L7  BEACON (Analytics + Visualization)                             │
│  Population modeling, Chapman estimator, colony clustering,         │
│  seasonal forecasting, map visualization.                           │
│  Rule: reads from views over SoT+Classification. Never writes SoT. │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Direction

```
External Sources → L1 (RAW) → L2 (IDENTITY) → L3 (ENRICHMENT) → L4 (CLASSIFICATION)
                                                                        ↓
                                                    L5 (SoT) ← published surfaces
                                                        ↓
                                              L6 (WORKFLOWS) → staff uses
                                                        ↓
                                              L7 (BEACON) → analytics reads
```

---

## Atlas Orchestrator (Planned)

### The Problem

Today, each data source (Airtable, ClinicHQ, ShelterLuv, web intake, Google Maps, text dumps) has bespoke ingestion scripts with hand-wired routing to different canonical surfaces. Adding a new source requires custom code at every layer.

### The Solution: Registry-Driven Orchestration

The **Atlas Orchestrator** is a central spine that ensures every data source flows through the same L1→L7 pipeline with configuration-driven routing instead of bespoke glue.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ATLAS ORCHESTRATOR                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ Source        │    │ Pipeline     │    │ Surface      │          │
│  │ Registry      │───▶│ Contract     │───▶│ Router       │          │
│  │ (what/how)    │    │ (stages)     │    │ (where)      │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                     │
│  Registry:                                                          │
│    - Source declaration (name, type, schema, frequency)              │
│    - Field mappings (source_field → canonical_target)               │
│    - Provenance template (how to trace back to raw)                │
│                                                                     │
│  Pipeline Contract:                                                 │
│    RAW → resolve_identity → extract_attributes →                    │
│    classify → publish_surfaces → QA_check                           │
│                                                                     │
│  Surface Router:                                                    │
│    - "cat_count" → place_colony_estimates                          │
│    - "org_name" → place_contexts (organization)                    │
│    - "person_email" → person_identifiers                           │
│    - "microchip" → cat_identifiers                                 │
│    - Routing is declarative, not code                              │
│                                                                     │
│  QA / Sense-Making:                                                │
│    - Anomaly detection (cat_count=500 at a house?)                 │
│    - "Why missing?" diagnostics                                    │
│    - Staff override preserved (Manual > AI)                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Invariants for Orchestrator

1. **Backward compatible** - existing ingestion scripts continue working. Orchestrator wraps, not replaces.
2. **Debuggable** - every routing decision is logged with reason (routed/skipped/merged/rejected).
3. **Staff overrides intact** - Manual > AI at every layer. Orchestrator never overwrites verified data.
4. **Provenance preserved** - every published surface traces back to raw source via (source_system, source_record_id, job_id).

---

## System Invariants (Non-Negotiable)

These rules apply to ALL changes, ALL layers, ALL contributors.

### INV-1: No Data Disappears

- SoT records are **never hard-deleted**. Use `merged_into_*` for merges.
- Merged entities must resolve to a **live canonical** entity (no merge chain black holes).
- Views must follow merge chains: always filter `WHERE merged_into_*_id IS NULL`.
- Orphan cleanup must check ALL foreign keys before deleting.

### INV-2: Manual > AI

- Staff-verified data (`is_verified = TRUE`, `evidence_type = 'manual'`) cannot be overwritten by AI/inferred data.
- AI enrichment can add new data but never downgrade confidence or remove verified classifications.
- The Classification Engine enforces this at the `assign_place_context()` function level.

### INV-3: SoT Are Stable Handles

- `sot_people.person_id`, `sot_cats.cat_id`, `places.place_id`, `sot_requests.request_id` are permanent references.
- All relationship tables reference these IDs.
- Entity creation goes through centralized functions only:
  - `find_or_create_person()` → people
  - `find_or_create_place_deduped()` → places
  - `find_or_create_cat_by_microchip()` → cats
  - `find_or_create_request()` → requests

### INV-4: Provenance Is Required

- Every record must carry `source_system` and `source_record_id`.
- Valid `source_system` values: `airtable`, `clinichq`, `web_intake`, `atlas_ui`, `shelterluv`, `volunteerhub`.
- AI-generated data must be labeled `source_type = 'ai_parsed'` or `evidence_type = 'inferred'`.
- Raw data preserved in `staged_records` (append-only).

### INV-5: Identity Matching By Identifier Only

- People are matched by **email or phone**, never by name alone.
- Phone normalization via `norm_phone_us()`.
- Email normalization via `person_identifiers.id_value_norm`.
- Name-only matches go to review queue, never auto-merge.

### INV-6: Active Flows Are Sacred

- Changes that touch ACTIVE flow tables/endpoints must be additive and backward-compatible.
- See "Do-Not-Break" section below for the explicit list.
- Any change touching these must pass the Active Flow Safety Gate (`docs/ACTIVE_FLOW_SAFETY_GATE.md`).

### INV-7: One Write Path Per Destination Per User Action

- A single user action (button click, form submit, modal confirm) must produce **exactly one INSERT** into any given destination table.
- **Never create parallel write paths** where a UI action sends the same data to multiple endpoints/triggers that each independently write to the same table.
- If a trigger already writes to a table on INSERT (e.g., `trg_site_obs_colony_estimate` writes to `place_colony_estimates` when a `site_observations` row is created), downstream functions that also target the same table **must detect and UPDATE the trigger-created record** rather than INSERT a duplicate.
- The `UNIQUE (source_system, source_record_id)` constraint is **not sufficient** to prevent duplicates when one path sets `source_record_id` and another leaves it NULL (PostgreSQL treats `NULL != NULL` for unique constraints).

**How to audit for this:**
1. Trace every user-facing action to ALL the endpoints it calls (check the frontend component's submit handler).
2. For each endpoint, trace the SQL path including any triggers that fire on INSERT.
3. If two paths write to the same table, one must detect the other's record and UPDATE instead of INSERT.

**Example (MIG_790 fix):**
```
CompleteRequestModal submit:
  → POST /api/observations → site_observations INSERT
      → trigger creates place_colony_estimates record  ← PATH A
  → PATCH /api/requests/{id} → record_completion_observation()
      → DETECTS Path A record, UPDATEs it              ← FIXED
      → (previously: INSERT-ed a duplicate)             ← BUG
```

**When designing new features:**
- If you add a trigger that writes to table X on INSERT into table Y, check if any existing code path also writes to table X after inserting into table Y.
- If you add a UI modal that calls multiple API endpoints, verify they don't each independently write to the same destination table.

### INV-8: Merge-Aware Queries

- **Every query that returns entities must filter out merged records** via `WHERE merged_into_*_id IS NULL`.
- This applies to all API endpoints, views, and subqueries that join to `places`, `sot_people`, or `sot_cats`.
- Merged entities are NOT deleted (INV-1), so they remain in the table and will appear in results unless filtered.
- **Subqueries are not exempt.** If a query has UNION branches or correlated subqueries that join to entity tables, EACH branch must independently filter merged records.

**Example (bug found 2026-01-29):**
```
/api/people/[id] associated_places subquery:
  Branch 1: person_place_relationships → places
    → MUST filter pl.merged_into_place_id IS NULL
  Branch 2: sot_requests → places
    → MUST filter pl.merged_into_place_id IS NULL
  Branch 3: web_intake_submissions → places
    → MUST filter pl.merged_into_place_id IS NULL
```

**Also (MAP_009, 2026-02-02):**
`search_unified()` PLACES section was missing `merged_into_place_id IS NULL`. Searching "441 Alta Ave" returned both canonical and merged records as separate results. Fixed in MIG_855 re-application.

**SQL functions with UNION ALL are especially vulnerable** — each branch must independently filter merged records. `search_unified()` has 3 branches (cats, people, places); the people branch correctly filtered, the places branch did not.

**When designing new queries:**
- If you JOIN to `places`, add `AND p.merged_into_place_id IS NULL`
- If you JOIN to `sot_people`, add `AND p.merged_into_person_id IS NULL`
- If you JOIN to `sot_cats`, add `AND c.merged_into_cat_id IS NULL`
- Views should include these filters. If a view misses one, fix it immediately.
- **UNION ALL branches must each independently filter** — don't assume one branch's filter covers another.

### INV-9: Cat Linking Requires Owner Contact Info

- The automatic cat→place linking pipeline (`link_appointment_cats_to_places()`) requires `owner_email` or `owner_phone` on the ClinicHQ appointment to resolve the person and find their place.
- When owner contact info is missing, cats **cannot be automatically linked** to any place.
- The `process_clinichq_owner_info()` backfill job must run AFTER each ClinicHQ data ingest to populate owner contact fields. If it stalls, newly ingested appointments will have no owner info.
- **Ongoing gap:** ~1% of historical appointments have no owner contact info. January 2026 spiked to 16.3% due to a pipeline stall (backfill last ran Jan 18).

**Each person's cats belong to their own places, not someone else's:**
```
Person A: Joanie Springer (36 Rancho Verde Cir)
  → Has 1 cat at clinic on 1/26 → links to HER place
  → Has request at 750 Rohnert Park Expressway

Person B: Judy Arnold (898 Butler Ave)
  → Has 8 cats at clinic on 1/26 → links to HER place
  → Has request at 898 Butler Ave

WRONG: Linking Judy's 8 cats to Joanie's request place
RIGHT: Each person's cats link to that person's own place
```

**Pipeline requirements:**
1. `process_clinichq_owner_info()` must run after each ClinicHQ ingest
2. Cats are linked via: appointment → person_id → person_place_relationships → place
3. If owner_email/phone is missing, Step 6 of entity linking falls back to person_id lookup
4. 3,511 cats (9.6%) system-wide have no place link — most due to missing owner contact info

### INV-10: Relationship Tables Require Centralized Functions

- **Never INSERT directly** into `cat_place_relationships` or `person_cat_relationships`.
- Relationship creation must go through centralized functions that validate:
  1. The cat exists and is not merged (`merged_into_cat_id IS NULL`)
  2. The place/person exists and is not merged
  3. There is **evidence** linking the cat to that place/person (appointment, observation, or staff verification)
  4. The `source_system` and `source_table` are set for provenance
- This prevents arbitrary links from being created without proof.

**Centralized functions (MIG_797):**
- `link_cat_to_place(cat_id, place_id, relationship_type, evidence_type, source_system, ...)` — validates cat+place exist and are not merged, requires evidence_type, logs to entity_edits
- `link_person_to_cat(person_id, cat_id, relationship_type, evidence_type, source_system, ...)` — validates person+cat exist and are not merged, requires evidence_type, logs to entity_edits

Both functions: reject merged entities, validate evidence_type and relationship_type against allowed lists, upgrade confidence on conflict if new evidence is stronger, and create audit trail in entity_edits.

**Migrated callers:** `link_cats_to_places()`, `link_appointment_cats_to_places()`, `link_appointment_to_person_cat()`, and the ownership transfer API all route through these functions.

**Valid evidence types:**
- `'appointment'` — cat seen at clinic with this person/place connection
- `'observation'` — cat observed at place during site visit
- `'intake_report'` — reported by requester during intake
- `'staff_verified'` — staff manually verified the link
- `'ai_inferred'` — AI extraction suggested the link (lower confidence)
- `'manual_transfer'` — ownership transfer via UI

**Why this matters (bug found 2026-01-29):**
A manual SQL fix incorrectly linked 8 cats from Person B to Person A's request place. The system accepted this without any warning because relationship tables have no semantic validation — only FK and uniqueness constraints.

### INV-11: Pipeline Functions Must Reference Actual Schema

- SQL functions that reference table columns must use the **actual column names** from the schema.
- Before creating a function that reads/writes a column, verify the column exists with `information_schema.columns`.
- When creating functions in migrations, add verification queries that confirm referenced columns exist.
- If a function creates a column dependency, the migration must also `ADD COLUMN IF NOT EXISTS`.

**Why this matters (MIG_795):**
Four bugs blocked the ingestion pipeline for 12+ days:
1. `update_person_contact_info()` was called but never created
2. `process_next_job()` referenced `next_attempt_at` (actual: `next_retry_at`)
3. `data_engine_resolve_identity()` wrote `'needs_review'` (not in check constraint)
4. `process_next_job()` wrote to `result` column (never created)

**Also (MAP_009, 2026-02-02):**
Search API `route.ts` referenced `ppr.is_primary` on `person_place_relationships` — a column that never existed. This caused **all person searches to return HTTP 500**, completely breaking person search on the map. Fixed by replacing with role-based ordering.

### INV-12: ClinicHQ Relationships Must Not Assume Residency

- The clinichq pipeline creates `person_place_relationships` for the owner/contact on each appointment. For regular pet owners (1-2 addresses), `role = 'resident'` is correct.
- **For trappers, staff, and volunteers who bring cats from many locations**, the pipeline creates false `resident` links at every trapping site. Crystal Furtado (trapper) had 36 false `resident` links. Sandra Nicander (staff) had 317.
- **Root cause of Sandra's 317 links:** FFSC's organizational phone `7075767999` was used on 1,200+ appointments. Pipeline matched it to Sandra via `person_identifiers`, creating a `resident` link at every appointment address.
- **Org phone blacklisted (MIG_856):** `7075767999` added to `data_engine_soft_blacklist`.
- **Role heuristic:** For people with active trapper/staff/volunteer roles and >3 clinichq `resident` links, only the highest-confidence one is kept as `resident`. The rest are reclassified to `contact`.

**When designing pipelines that assign roles:**
1. Check if the person has active trapper/staff/volunteer roles before assigning `resident`
2. Use `confidence` to distinguish actual home (higher) from trapping sites (lower)
3. Check `data_engine_soft_blacklist` for organizational identifiers before matching
4. Prefer `owner` role (0.90 confidence) over `resident` (0.70 confidence) for home address determination

**Coordinate lookup ordering (for search, map, etc.):**
```sql
ORDER BY
  ppr.confidence DESC,                    -- highest confidence first (0.90 owner > 0.70 resident)
  CASE ppr.source_system                  -- prefer verified sources
    WHEN 'volunteerhub' THEN 1
    WHEN 'atlas_ui' THEN 2
    WHEN 'airtable' THEN 3
    ELSE 4 END,
  CASE ppr.role                           -- prefer owner over resident
    WHEN 'owner' THEN 1
    WHEN 'resident' THEN 2
    ELSE 3 END,
  ppr.created_at DESC
```

**Scale of the problem (MIG_856):** 20 people with >3 false `resident` links, 347 relationships reclassified to `contact`.

---

## Data Zones

### ACTIVE Data

Data actively used by staff daily. Changes require Safety Gate validation.

| Table/View | Used By | Flow |
|------------|---------|------|
| `web_intake_submissions` | Phone intake, intake queue | Intake capture |
| `sot_requests` | Request detail, dashboard | Request lifecycle |
| `journal_entries` | Request detail | Journal/notes |
| `request_trapper_assignments` | Request detail | Trapper assignment |
| `places` | Place detail, intake form | Address management |
| `sot_people` | People pages, intake | Person records |
| `sot_cats` | Cat pages, request detail | Cat records |
| `staff` / `staff_sessions` | Auth, navigation | Authentication |
| `communication_logs` | Intake queue detail | Intake comms |

### SEMI-ACTIVE Data

Used by admin/power-user flows. Changes require testing but have lower blast radius.

| Table/View | Used By | Flow |
|------------|---------|------|
| `colonies` / `colony_*` | Colony management | Admin colonies page |
| `place_contexts` / `place_context_types` | Classification Engine | Place detail, intake |
| `known_organizations` | Org registry | Place classification |
| `extraction_queue` / `extraction_status` | AI Extraction Engine | Admin AI extraction |
| `tippy_*` | Tippy AI assistant | Tippy chat |
| `email_*` | Email system | Admin email |
| `trapper_onboarding` | Trapper pipeline | Admin trappers |
| `data_engine_*` | Data Engine | Admin data engine |

### HISTORICAL / ANALYTICAL Data

Read-only by Beacon and analytics. Changes are lower risk.

| Table/View | Used By | Flow |
|------------|---------|------|
| `staged_records` | Audit trail | Raw layer |
| `cat_birth_events` / `cat_mortality_events` | Beacon ecology | Population modeling |
| `place_colony_estimates` | Beacon | Colony sizing |
| `google_map_entries` | Google Maps context | Historical context |
| `site_observations` | Beacon | Mark-recapture |
| `cat_movement_events` | Beacon | Migration tracking |
| `entity_attributes` | AI extraction output | Enrichment |
| All `v_beacon_*` views | Beacon map | Analytics |
| All `v_place_ecology_*` views | Beacon | Population stats |
| `backup_*` tables | Recovery only | Not in active use |

---

## Do-Not-Break Contract

### ACTIVE Pages (staff uses daily)

| Page | Route | What Breaks If Down |
|------|-------|---------------------|
| Dashboard | `/` | Staff can't see work queue |
| Phone Intake | `/admin/intake/call` | Can't capture new calls |
| Intake Queue | `/intake/queue` | Can't triage submissions |
| Intake Detail | `/intake/queue/[id]` | Can't process individual intakes |
| Request Detail | `/requests/[id]` | Can't update requests, add notes, assign trappers |
| Request List | `/requests` | Can't find requests |

### ACTIVE API Endpoints

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/api/intake` | POST | Creates intake submission |
| `/api/intake/queue` | GET | Lists intake queue |
| `/api/requests` | GET | Lists requests |
| `/api/requests/[id]` | GET/PUT/PATCH | Request CRUD |
| `/api/journal` | GET/POST | Journal entries |
| `/api/requests/[id]/trappers` | GET/POST/DELETE | Trapper assignments |
| `/api/auth/me` | GET | Current user auth |
| `/api/auth/login` | POST | Staff login |
| `/api/staff` | GET | Staff list |
| `/api/search` | GET | Global search |

### ACTIVE Database Objects

| Object | Type | Critical For |
|--------|------|-------------|
| `web_intake_submissions` | Table | Intake capture |
| `sot_requests` | Table | Request lifecycle |
| `journal_entries` | Table | Notes/journal |
| `request_trapper_assignments` | Table | Trapper management |
| `staff` / `staff_sessions` | Tables | Authentication |
| `compute_intake_triage()` | Function | Auto-triage on intake |
| `trg_auto_triage_intake` | Trigger | Triage on insert |
| `trg_log_request_status` | Trigger | Status history |
| `trg_set_resolved_at` | Trigger | Completion tracking |
| `trg_intake_create_person` | Trigger | Person creation on intake |
| `trg_intake_link_place` | Trigger | Place linking on intake |
| `convert_intake_to_request()` | Function | Queue → request conversion |
| `v_intake_triage_queue` | View | Intake queue display |
| `v_request_journal` | View | Journal display |

### ACTIVE Triggers on sot_requests (6 total)

These fire on every request insert/update. Do not disable or alter behavior:

1. `trg_auto_suggest_classification` - Suggests place context on new request
2. `trg_request_activity` - Updates activity timestamps
3. `trg_log_request_status` - Logs status changes to history
4. `trg_validate_request_place_link` - Validates place FK
5. `set_kitten_assessed_timestamp` - Tracks kitten assessment timing
6. `trg_set_resolved_at` - Sets resolved_at on completion/cancellation
7. `trg_assign_colony_context_on_request` - Auto-assigns colony_site context
8. `trg_request_colony_estimate` - Creates colony estimate from request data
9. `trg_queue_request_extraction` - Queues for AI extraction

---

## Current System Scale

| Object | Count |
|--------|-------|
| Tables | 198 |
| Views | 308 |
| Functions | 598 |
| Triggers | 55 |
| Migrations | 253 |
| API Routes | 192 |
| UI Pages | 98 |
| Components | 75 |
| Scripts | 150+ |
| Docs | 80+ |

### Entity Counts

| Entity | Active Records |
|--------|---------------|
| People | ~41,800 |
| Cats | ~36,600 |
| Appointments | ~47,500 |
| Places | ~11,400 active + 4,400 merged |
| Requests | (in sot_requests) |
| Staged Records | ~174,000 |
| Processing Jobs | ~26,400 (mostly queued) |

---

## Known Debt / Failure Modes

Ranked by impact (see TASK_LEDGER.md for remediation):

1. **Merge chain black holes RESOLVED (MIG_770/771)**: 4,509 person + 10 place chains flattened. Prevention triggers added.
2. **Processing pipeline bugs RESOLVED (MIG_795)**: Four blocking bugs fixed. Pipeline operational. **Backfill needed:** Staff must re-upload owner_info for Jan 19-30 gap via `/admin/ingest`.
3. **Unprocessed ShelterLuv RESOLVED (MIG_786)**: All 5,058 records triaged. 909 chipless animals marked, 4 people processed.
4. **People without identifiers PARTIALLY RESOLVED (MIG_773)**: 13 recovered, 973 remaining (no recoverable identifiers).
5. **Cats without microchips**: 1,608 cats with no dedup key. Same cat can appear as multiple records.
6. **Backup table bloat RESOLVED (MIG_774)**: 10 tables dropped, 149 MB reclaimed.
7. **Places without geometry**: 93 places invisible to Beacon maps. Geocode cron runs every 30 min.
8. **INV-10 centralized functions IMPLEMENTED (MIG_797)**: `link_cat_to_place()` and `link_person_to_cat()` created. Remaining callers should be migrated as encountered.
9. **Duplicate places RESOLVED (MIG_799, MIG_800, MIG_803)**: `normalize_address()` hardened with 11 new normalizations. 188 exact pairs auto-merged. MIG_803 detected 3,853 fuzzy candidates via PostGIS proximity + trigram similarity (753 T1 + 691 T2 + 2,409 T3). Admin review at `/admin/place-dedup` with `place_safe_to_merge()` safety guard. 11,100 active places.
10. **Unapplied migrations RESOLVED**: MIG_793 (v_orphan_places) and MIG_794 (relink functions) applied. Column name mismatches fixed.
11. **Duplicate people DETECTED (MIG_801, MIG_802)**: 5-tier detection found 1,178 candidates. Tiers 1-2 (email/phone+name) already clean — Data Engine handled them. 1,178 remaining are tier 4-5 (name+place, name only) queued for staff review at `/admin/person-dedup`. `person_safe_to_merge()` safety guard blocks staff merges and same-person pairs.
12. **Email notifications NOT LIVE**: Resend email fully implemented in code (`lib/email.ts`, templates, `/api/cron/send-emails`). Needs `RESEND_API_KEY` environment variable set in Vercel to activate.
13. **ClinicHQ false resident links RESOLVED (MIG_856)**: Trappers/staff had hundreds of false `resident` relationships from clinichq appointments. Sandra Nicander: 317 (FFSC org phone reuse), Crystal Furtado: 36 (trapping sites). 347 relationships reclassified to `contact`. FFSC org phone `7075767999` blacklisted. INV-12 added.
14. **Search bugs RESOLVED (MAP_009)**: Person search 500 (is_primary column DNE), merged place duplicates in search_unified, map search opening new tabs. All fixed.

---

## Remaining UI Work (TASK_LEDGER UI_001–005)

All data quality and infrastructure tasks (TASK_001–006, ORCH_001–003, DH_A–E, SC_001–004, MAP_001) are **Done**. UI_001–005 are **Done**. The remaining work is L6 cosmetics:

| Task | Layer | Description | Status |
|------|-------|-------------|--------|
| **UI_001** | L6 | Dashboard redesign — "Needs Attention" panel, my active requests, intake list, map preview | Done |
| **UI_002** | L6 | Filter persistence (URL params) + mobile card views + consolidate /map vs /beacon | Done |
| **UI_003** | L6 | Zillow-style media gallery — hero image, "set as main photo", request-place bridging | Done |
| **UI_004** | L3/L5/L6 | AI place type inference, partner org enhanced profiles, orphan places admin page | Done |
| **UI_005** | L6 | Name edit validation, emoji cleanup, print CSS conflict | Planned |

## Map Improvements (MAP_002–011)

L7 (Visualization) improvements based on staff feedback:

| Task | Layer | Description | Status |
|------|-------|-------------|--------|
| **MAP_002** | L7 | Pin differentiation: split active/active_requests, add legend | Done |
| **MAP_003** | L7 | Cluster color threshold: majority-wins instead of any-match | Done |
| **MAP_004** | L7 | Nearby people shown in navigated-location popup | Done |
| **MAP_005** | L7 | Street View fullscreen + mini map with nearby colored dots | Done |
| **MAP_006** | L7 | Search bar minimizes during Street View, higher z-index for nav marker | Done |
| **MAP_007** | L2/L7 | System account / org name filtering from map, org display name fallback | Done |
| **MAP_008** | L5/L6/L7 | People-first map search, role badges, manual people-place linking, Tippy context | Done |
| **MAP_009** | L5/L7 | Fix search: person search 500 (is_primary), merged place duplicates, map navigation | Done |

## Planned Map Improvements

| Task | Layer | Description | Status |
|------|-------|-------------|--------|
| **MAP_010_F** | L7 | Person detail drawer on map (parity with PlaceDetailDrawer) | Planned |
| **MAP_011_F** | L7 | Cat detail drawer on map (view cat info without leaving map) | Planned |
| **MAP_012_F** | L2/L7 | 441 Alta Ave duplicate place dedup (2 non-merged records for same address) | Planned |

Full task cards in `TASK_LEDGER.md`.

---

## Relationship to Other Docs

| Document | Purpose |
|----------|---------|
| `ATLAS_MISSION_CONTRACT.md` | Beacon science, population modeling, ground truth principle |
| `ACTIVE_FLOW_SAFETY_GATE.md` | Concrete validation steps after any change |
| `TASK_LEDGER.md` | Ordered task cards with scope, safety, rollback. UI_001–005 are current work. |
| `CLAUDE.md` | Developer rules, coding conventions, API patterns |
| `CENTRALIZED_FUNCTIONS.md` | Entity creation function reference |
| `DATA_INGESTION_RULES.md` | Ingest script conventions |
| `UI_REDESIGN_SPEC.md` | UI redesign spec: nav, profiles, mobile, address mgmt, classification, export |
| `TIPPY_DATA_QUALITY_REFERENCE.md` | Staff-facing data quality explanations, session logs for Tippy AI |
