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

## Atlas Orchestrator (IMPLEMENTED - MIG_923)

### The Problem

Today, each data source (Airtable, ClinicHQ, ShelterLuv, web intake, Google Maps, text dumps) has bespoke ingestion scripts with hand-wired routing to different canonical surfaces. Adding a new source requires custom code at every layer.

### The Solution: Registry-Driven Orchestration

The **Atlas Orchestrator** is a central spine that ensures every data source flows through the same L1→L7 pipeline with configuration-driven routing instead of bespoke glue.

**Implementation Status (2026-02-06):**
- MIG_923: `run_full_orchestrator()` function with phase configuration
- API: `/api/cron/orchestrator-run` for Vercel cron or manual triggering
- Processing: `/api/ingest/process` fixed to handle Vercel cron GET requests

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

## Cross-Source Conflict Detection (IMPLEMENTED - MIG_620, MIG_922, MIG_924)

### Field-Level Source Tracking

Atlas tracks which source provided each field value for cats and people, enabling conflict detection when sources disagree.

**Key Tables:**
- `cat_field_sources` (MIG_620) - Tracks cat field values by source
- `person_field_sources` (MIG_922) - Tracks person field values by source
- `survivorship_priority` (MIG_924) - Defines which source wins for each field type

**Key Views:**
- `v_cat_field_conflicts` - Cats with conflicting field values across sources
- `v_person_field_conflicts` - People with conflicting field values
- `v_all_field_conflicts` - Combined dashboard view

### Source Authority Map (Confirmed 2026-02-06)

| Data Type | Primary Authority | Notes |
|-----------|------------------|-------|
| Cat medical data | ClinicHQ | Spay/neuter, procedures, vaccines |
| Cat identity | ClinicHQ (microchip) | Microchip is gold standard |
| Cat origin location | ClinicHQ | Appointment address = where cat came from |
| Cat current location | ShelterLuv | Outcome address = where cat is now |
| Cat outcomes | ShelterLuv | Adoption, foster, death, transfer |
| People (volunteers) | VolunteerHub | Roles, groups, hours, status |
| People (fosters) | VolunteerHub | "Approved Foster Parent" group is authority |
| People (adopters) | ShelterLuv | From adoption outcome events |
| People (clinic clients) | ClinicHQ | From appointment owner info |
| Trapper roles | VolunteerHub | Except community trappers from Airtable |
| Foster relationships | ShelterLuv | Cat→foster links; person must be VH approved |

### Survivorship Rules

When conflicts occur, `survivorship_priority` determines the winner:
- Lower array index = higher priority
- ClinicHQ wins for cat identity/medical fields
- ShelterLuv wins for outcomes/current location
- VolunteerHub wins for volunteer/foster person data

---

## Data Quality Investigation Findings (2026-02-06)

### Appointment-Cat Linking Status

**Spay/Neuter Appointments:**
- 94.1% (27,167 of 28,871) have cat links ✅
- 5.9% (1,704) unlinked — NOT data quality issues

**Root Cause of Unlinked:**
- 85.9% (1,463) are from "Forgotten Felines Foster" account
- These have internal Foster IDs (#6795 format)
- Foster parent names in parentheses: "(Canepa)"
- SCAS cats with A439019-style IDs

### FFSC Foster & SCAS Cat Matching Opportunity (DATA_GAP_023)

The 1,463 foster account cats CAN potentially be matched via:
1. **Foster parent name extraction** - Parse "(LastName)" from cat name
2. **SCAS ID matching** - Match A439019 format to ShelterLuv records
3. **VolunteerHub cross-reference** - Link foster parent to approved fosters

**Current Status:** Documented as enhancement opportunity, not blocking issue.

### Why This Matters

- 94%+ cat linking rate means the system IS working correctly
- Unlinked cats are legitimate edge cases (foster program workflow)
- No junk data — these are real cats with medical records

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

### INV-13: Ingest Pipeline Must Be Resilient to Serverless Timeouts

- **Every ingest/processing API route must export `maxDuration`** (typically 120s). Without it, Vercel kills the lambda at 10-15s default — too short for post-processing that calls `find_or_create_person()` hundreds of times.
- **Post-processing must scope to the current upload** via `file_upload_id`. Without scoping, re-uploading data re-processes ALL historical staged records, causing exponential slowdown.
- **Processing must save intermediate progress** to `file_uploads.post_processing_results` after each step. This enables the UI to poll for step-by-step progress and prevents complete data loss if the lambda is killed mid-flight.
- **The cron must auto-reset stuck uploads**: Any upload in `status='processing'` for >5 minutes is auto-reset to `failed` so it can be retried.
- **UI must never block on processing**: Use fire-and-forget POST + polling instead of awaiting the full processing response.

**When adding new ingest source types:**
1. Export `maxDuration` on the processing route
2. Pass `uploadId` to all post-processing functions
3. Add `file_upload_id` filter to every `staged_records` query
4. Use `saveProgress()` between steps
5. Parse CSV files via XLSX library (handles RFC 4180 quoted fields), never `line.split(',')`

### INV-14: Microchip Values Must Be Validated Before Storage

All code paths that create or match cats by microchip **MUST** validate format via `validate_microchip()`:

- **Reject all-zeros** (`^0+$`) — the phantom cat pattern. Excel scientific notation `9.8102E+14` converts to `981020000000000` which is junk.
- **Reject length > 15** — prevents concatenated microchips (two chips stuck together from XLSX export corruption). Valid formats: ISO 15-digit, AVID 9-digit, HomeAgain 10-digit.
- **Reject all-same-digit** (`^(\d)\1+$`) and known test patterns (`^123456789`, `^999999999`).
- **Log rejections** (RAISE NOTICE) for debugging — never silently accept junk identifiers.
- **Never create a cat record from an invalid microchip.** `find_or_create_cat_by_microchip()` must return NULL for invalid input.

**Why this matters (DQ_004):** A phantom cat "Daphne" was created from junk microchip `981020000000000`. It accumulated 2,155 ShelterLuv IDs and polluted 1,202 person_cat_relationships + 1,331 cat_place_relationships. 76.9% of SL adopter links pointed to this phantom. The pollution cascaded through `link_cats_to_places()` (MIG_870 Step 8).

**Applies to:** `find_or_create_cat_by_microchip()`, `process_shelterluv_animal()`, `process_shelterluv_outcomes()`, ClinicHQ appointment processing, any future microchip ingest path.

**Existing asset:** `detect_microchip_format()` (MIG_553) already supports multi-format detection. The new `validate_microchip()` wraps it with rejection logic.

### INV-15: Canonical Views Must Not Be Recreated From Old Migrations

**`v_map_atlas_pins`** is a canonical view defined in MIG_820. It merges features from multiple migrations:
- MIG_820: Two-tier pins, apartment_building filter, Google Maps integration
- MIG_822: Co-located empty place filter
- MIG_857: `needs_trapper_count` column
- DQ_002: Merged cat filter on cat count subquery (INV-8)

**Rule:** When modifying `v_map_atlas_pins`, ALWAYS edit MIG_820's canonical definition. **NEVER** recreate the view from an older migration — this drops columns and filters added by later migrations.

The view has a `COMMENT ON VIEW` that lists all contributing migrations. Check it before modifying:
```sql
COMMENT ON VIEW trapper.v_map_atlas_pins IS
'Canonical map pins view. Merges: MIG_820 (...), MIG_822 (...), MIG_857 (...), DQ_002 (...).
IMPORTANT: This is the single canonical definition — do not recreate from older migrations.';
```

### INV-16: ShelterLuv Outcome Data Requires API Re-pull, Not XLSX Export

ShelterLuv XLSX exports are prone to:
- **Scientific notation corruption** — Excel converts microchips like `981020053524791` to `9.8102E+14`
- **Column concatenation** — Two microchip columns merged into one (30-31 char strings)
- **Stale data** — XLSX exports are point-in-time snapshots with no incremental sync

**Rule:** ShelterLuv outcomes must be pulled via the ShelterLuv API (`shelterluv_api_sync.mjs`), NOT from XLSX file uploads. The API provides clean, structured JSON without Excel corruption.

**Current state:** The API cron syncs `animals`, `people`, and `events` daily, but **does not yet sync `outcomes`**. The 6,420 outcome records currently in `staged_records` are from XLSX imports (Jan 9 & 19, 2026). These need to be replaced with API-sourced data.

### INV-17: Organizational Emails Must Not Create Person Records

**Core problem:** Organizational emails (e.g., `info@forgottenfelines.com`) match to whoever registered first, creating phantom caretaker links between people and thousands of cats.

**Root cause:** ClinicHQ staff enters org email for community cats. `should_be_person()` only checked name patterns, not email patterns. Data Engine has email rejection logic, but ClinicHQ processing called `find_or_create_person()` directly, bypassing those checks.

**Impact detected (DATA_GAP_009):**
- Sandra Brady: 1,253 cats linked via `info@forgottenfelines.com`
- Sandra Nicander: 1,171 cats linked via org email matching

**Solution (MIG_915, MIG_916):**
- `should_be_person()` now checks email patterns BEFORE routing
- FFSC emails added to `data_engine_soft_blacklist` with 0.99 threshold
- Erroneous caretaker relationships removed

**When designing new features:**
1. Check `data_engine_soft_blacklist` for organizational emails before person matching
2. Reject `@forgottenfelines.com` and similar org domains at the routing gate
3. Generic emails (`info@`, `office@`, `contact@`, `admin@`) require manual review

**Applies to:** `should_be_person()`, `find_or_create_person()`, `process_clinichq_owner_info()`

### INV-18: Location Names Must Not Create Person Records

**Core problem:** ClinicHQ owner fields contain site names ("Golden Gate Transit SR", "The Villages", "So. Co. Bus Transit Yard"), creating fake person records.

**Root cause:** ClinicHQ staff enters trapping site name in Owner First Name field.

**Impact detected (DATA_GAP_010):**
- Linda Price merged INTO "The Villages" (wrong direction!)
- "Golden Gate Transit SR" had Linda's phone/email but was a location name
- 28 location-as-person records accumulated with complex merge chains

**Solution (MIG_573, MIG_917):**
- `classify_owner_name()` detects location patterns
- `should_be_person()` routes pseudo-profiles to `clinic_owner_accounts`, not `sot_people`
- Location-as-person records cleaned up, Linda Price restored with correct identifiers

**When designing new features:**
1. Call `should_be_person()` before any person creation
2. Names containing address patterns → route to clinic_owner_accounts
3. Names matching known_organizations → route to org system
4. Never create person records without at least email OR phone

**Applies to:** `should_be_person()`, `classify_owner_name()`, all ClinicHQ processing

### INV-19: Fellegi-Sunter Probabilistic Scoring (Phase 3 - 2026-02-08)

**Core problem:** Fixed-weight identity matching (40% email, 25% phone, etc.) penalizes records with missing data and lacks mathematical foundation for decision thresholds.

**Solution (MIG_947, MIG_948, MIG_949):**
- Log-odds scoring: `score = Σ log2(M/U)` for agreements, negative weights for disagreements
- Missing data is neutral (weight = 0), not penalizing
- Thresholds stored in `fellegi_sunter_thresholds` table (configurable)
- M/U probabilities stored in `fellegi_sunter_parameters` table (tunable)
- Match decisions include `fs_composite_score`, `fs_match_probability`, `fs_field_scores`, `comparison_vector`

**When designing new features:**
1. Use `data_engine_score_candidates_fs()` for identity matching, not legacy function
2. Decision thresholds come from database, not hardcoded values
3. Match probability (0-1) is derived from log-odds: `P = 1/(1+2^(-score))`
4. Display probability percentages to staff, not tier numbers
5. Field comparison shows agree/disagree/missing, not just match/no-match

**Key Tables:** `fellegi_sunter_parameters`, `fellegi_sunter_thresholds`, `data_engine_match_decisions` (extended columns)

### INV-20: Identity Graph Tracking (Phase 4 - 2026-02-08)

**Core problem:** Merge relationships were tracked only via `merged_into_*_id` columns with no graph structure, making it hard to audit merge history or find transitive relationships.

**Solution (MIG_951, MIG_952):**
- `identity_edges` table tracks all merge relationships as directed graph
- Backfilled from existing `merged_into_person_id` and `merged_into_place_id`
- Triggers automatically record new merges
- `get_identity_cluster()` enables graph traversal
- `get_canonical_entity()` resolves to final canonical entity
- `get_merged_aliases()` finds all entities merged into a canonical

**Edge types:**
- `merged_into` - Entity A was merged into Entity B (soft delete)
- `same_as` - Equivalence relationship (not used yet, future)
- `household_member` - People at same address (related but distinct)

**When designing new features:**
1. After any merge operation, an edge is automatically recorded via trigger
2. To find all records related to an entity, use `get_identity_cluster()`
3. To find the current canonical entity, use `get_canonical_entity()`
4. Never delete from `identity_edges` - it's an audit trail

**Key Tables:** `identity_edges`
**Key Views:** `v_identity_graph_stats`, `v_merge_chains`, `v_person_identity_summary`, `v_place_identity_summary`

### INV-21: Stale Reference Prevention (2026-02-08)

**Core problem:** After merging entities, records in relationship tables may still point to the merged (soft-deleted) entity instead of the canonical entity.

**Root cause discovered (MIG_950):** During the identity resolution overhaul, we found:
- 7,295 cat_place_relationships pointing to merged places
- 1,258 person_place_relationships pointing to merged entities
- 592 appointments pointing to merged people
- Records get stale when merges happen but downstream tables aren't updated

**Solution (MIG_950):**
- Ran one-time fix to update/delete all stale references
- For relationship tables: deleted stale records (canonical relationship already existed)
- For core tables (appointments): updated to point to canonical entity

**When designing new features:**
1. After merging, check if downstream tables need updating
2. Use merge-aware queries: `WHERE merged_into_*_id IS NULL`
3. Consider adding a post-merge hook to update common relationship tables
4. The `identity_edges` table now provides audit trail for what was merged into what

**Verification queries:**
```sql
-- Check for stale references (should all return 0)
SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE p.merged_into_place_id IS NOT NULL;
```

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
5. **Cats without microchips RESOLVED (MIG_891)**: Cats euthanized before microchipping (e.g., cancer cases) were silently dropped by ClinicHQ ingest. New `process_clinichq_unchipped_cats()` creates cats using `clinichq_animal_id` via `enrich_cat()`. Marked with `needs_microchip = TRUE`. Visible in Clinic Day Cat Gallery at `/admin/clinic-days`. Re-ingestion safe via cat_identifiers UNIQUE constraint.
6. **Backup table bloat RESOLVED (MIG_774)**: 10 tables dropped, 149 MB reclaimed.
7. **Places without geometry**: 93 places invisible to Beacon maps. Geocode cron runs every 30 min.
8. **INV-10 centralized functions IMPLEMENTED (MIG_797)**: `link_cat_to_place()` and `link_person_to_cat()` created. Remaining callers should be migrated as encountered.
9. **Duplicate places RESOLVED (MIG_799, MIG_800, MIG_803)**: `normalize_address()` hardened with 11 new normalizations. 188 exact pairs auto-merged. MIG_803 detected 3,853 fuzzy candidates via PostGIS proximity + trigram similarity (753 T1 + 691 T2 + 2,409 T3). Admin review at `/admin/place-dedup` with `place_safe_to_merge()` safety guard. 11,100 active places.
10. **Unapplied migrations RESOLVED**: MIG_793 (v_orphan_places) and MIG_794 (relink functions) applied. Column name mismatches fixed.
11. **Duplicate people DETECTED (MIG_801, MIG_802)**: 5-tier detection found 1,178 candidates. Tiers 1-2 (email/phone+name) already clean — Data Engine handled them. 1,178 remaining are tier 4-5 (name+place, name only) queued for staff review at `/admin/person-dedup`. `person_safe_to_merge()` safety guard blocks staff merges and same-person pairs.
12. **Email notifications NOT LIVE**: Resend email fully implemented in code (`lib/email.ts`, templates, `/api/cron/send-emails`). Needs `RESEND_API_KEY` environment variable set in Vercel to activate.
13. **ClinicHQ false resident links RESOLVED (MIG_856)**: Trappers/staff had hundreds of false `resident` relationships from clinichq appointments. Sandra Nicander: 317 (FFSC org phone reuse), Crystal Furtado: 36 (trapping sites). 347 relationships reclassified to `contact`. FFSC org phone `7075767999` blacklisted. INV-12 added.
14. **Search bugs RESOLVED (MAP_009)**: Person search 500 (is_primary column DNE), merged place duplicates in search_unified, map search opening new tabs. All fixed.
15. **Ingest pipeline silent failures RESOLVED (INGEST_001)**: Admin UI uploads failed silently. 6 bugs: missing `maxDuration` (Vercel killed lambda at 10s), CSV parser broke on quoted commas, post-processing queried ALL staged records (not current upload), stuck status on lambda kill, no progress UI, alert() errors. All fixed with upload-scoped processing, fire-and-forget + polling UI, stuck-job auto-recovery in cron. INV-13 added.
16. **ShelterLuv phantom cat RESOLVED (DQ_004, MIG_872)**: Phantom cat "Daphne" created from junk microchip `981020000000000` (Excel scientific notation artifact). Accumulated 2,155 ShelterLuv IDs, polluted 1,202 person_cat + 1,331 cat_place relationships. 76.9% of SL adopter links were fake. Phantom cleaned, cat merged. INV-14 added. `validate_microchip()` gatekeeper created (MIG_873).
17. **Concatenated microchips RESOLVED (DQ_004, MIG_873)**: 23 cats had two microchips concatenated (30-31 chars) from ShelterLuv XLSX export corruption. Split into individual records. `validate_microchip()` now rejects chips > 15 chars. INV-14 prevents recurrence.
18. **ShelterLuv outcomes NOT from API**: The 6,420 SL outcome records are from XLSX imports (Jan 9 & 19), not the API cron. The API cron syncs animals/people/events but NOT outcomes. Outcomes should be re-pulled from the API for clean data. INV-16 added.
19. **Foster home place context gap RESOLVED (MIG_871)**: 95 active foster parents from VolunteerHub had places but 0 tagged as `foster_home`. `link_vh_volunteer_to_place()` now auto-tags foster homes. Backfill applied.
20. **v_map_atlas_pins view fragmentation RESOLVED (MIG_820 update)**: Multiple migrations (MIG_820, MIG_822, MIG_857) each defined the complete view with different features. Refreshing from any one overwrote the others. MIG_820 now holds the single canonical definition with all features merged. INV-15 added.
21. **IDENTITY RESOLUTION OVERHAUL COMPLETE (Phase 2-4, 2026-02-08)**:
    - **Phase 2 (Unified Review Hub)**: Consolidated 6 review pages into `/admin/reviews`. Shared components: ReviewComparisonCard, BatchActionBar, ReviewStatsBar.
    - **Phase 2.5 (Data Quality)**: Fixed geocoding normalization bug (MIG_946 - root cause of ShelterLuv duplicates), removed Tier 5 name-only matches (MIG_943), auto-verified high-confidence AI estimates (MIG_945).
    - **Phase 3 (Fellegi-Sunter)**: Implemented probabilistic matching (MIG_947/948/949). Log-odds scoring replaces fixed weights. Missing data is neutral. Staff see probability percentages. INV-19 added.
    - **Phase 4 (Identity Graph)**: Created `identity_edges` table (MIG_951), transitive closure functions (MIG_952), legacy cleanup (MIG_953). INV-20 added.
    - **Data Quality Audit**: Verified NO data loss. Fixed 9,000+ stale references (MIG_950). All FK constraints intact. INV-21 added.
    - **Final counts**: 14,211 active people (92 merged), 13,998 active places (1,918 merged), 36,828 cats, 47,676 appointments.
    - **Verification (2026-02-08)**: `verify_ingest_routing.mjs` passes 17/17 (1 warning - no recent F-S decisions yet). `data_integrity_edge_cases.mjs` passes 21/21. E2E tests added: `identity-review-workflow.spec.ts`, `tippy-identity-resolution.spec.ts`.
22. **Geocoding duplicate root cause RESOLVED (MIG_946)**: `save_geocoding_result()` was setting `normalized_address = p_google_address` (raw) instead of `normalize_address(p_google_address)`. This caused case-sensitive mismatches creating duplicates on ShelterLuv imports. Function patched, 679 duplicates merged.
23. **Stale merged references RESOLVED (MIG_950)**: After soft-delete cleanup, 9,528 records still pointed to merged entities. All updated/deleted to point to canonical entities. Zero stale references remain.
24. **Identifier backfill RESOLVED (MIG_466 re-run)**: 88% identifier coverage (up from 86%). Remaining gaps are email conflicts (same email linked to different person - expected behavior).

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
| **MAP_010_F** | L7 | Person detail drawer on map (parity with PlaceDetailDrawer) | Done |
| **MAP_011_F** | L7 | Cat detail drawer on map (view cat info without leaving map) | Done |
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

---

## Data Gap Backlog (For Future Implementation)

### DATA_GAP_024: Reference Pin Source Traceability

**Date Identified:** 2026-02-08
**Priority:** Medium
**Impact:** Staff confusion about where people/pins came from

**Problem:**
Reference pins correctly hold people who reached out but didn't become active (no cats, not volunteer, not adopter, etc.) and legacy Google Maps pins. However, there's no visibility into the SOURCE of these records.

Example: "Jaime Calvillo" at "38 N East St, Cloverdale" shows as "Requester" but staff can't tell:
- Was this a legacy appointment request?
- Did they call in?
- Web intake submission?
- ClinicHQ record?

**Current State:**
- `sot_people.data_source` stores the source system
- `sot_people.source_record_id` stores the original record ID
- But this isn't exposed in the UI

**Proposed Solution:**
1. Add source badge to person cards: "via ClinicHQ", "via Web Intake", "via Airtable"
2. Make source clickable to show original staged_record data
3. Create `v_person_source_trace` view joining to staged_records
4. Add "Source History" section to person detail page

**Affected Views:**
- Person cards in place detail
- Person detail page
- Reference pin popups

**Not Blocking:** This is a UX improvement, not data integrity issue.

