# Atlas Task Ledger

**Version:** 1.0
**Created:** 2026-01-28
**Owner:** Engineering

---

## Rules

1. **No task may touch ACTIVE flow surfaces without a "Surgical Change" annotation** and passing the Active Flow Safety Gate (`docs/ACTIVE_FLOW_SAFETY_GATE.md`).
2. Every task card has: scope, touched surfaces, ACTIVE impact (Yes/No), validation steps, rollback notes, and a stop point.
3. Tasks execute in numbered order. Do not skip ahead unless explicitly unblocked.
4. Status values: `Planned` | `In Progress` | `Done` | `Blocked`

---

## TASK_001: System Inventory + Fragmentation Map

**Status:** Done (captured in NORTH_STAR + this ledger)
**ACTIVE Impact:** No
**Scope:** Read-only exploration. No schema changes.

### Layer Mapping

| Layer | Tables (key) | Functions (key) | Views (key) | Count |
|-------|-------------|-----------------|-------------|-------|
| **L1 RAW** | staged_records, ingest_run_records, ingest_runs, file_uploads, raw_intake_*, raw_airtable_* | enqueue_processing, process_next_job | v_staged_records_latest_run, v_ingest_run_summary | ~15 tables |
| **L2 IDENTITY** | person_identifiers, cat_identifiers, data_engine_match_decisions, data_engine_matching_rules, households, household_members, person_merges, potential_person_duplicates | find_or_create_person, find_or_create_place_deduped, find_or_create_cat_by_microchip, data_engine_resolve_identity, data_engine_score_candidates | v_data_engine_health, v_data_engine_review_queue, v_households_summary | ~20 tables |
| **L3 ENRICHMENT** | entity_attributes, entity_attribute_definitions, extraction_queue, extraction_status, attribute_extraction_jobs | classify_place_from_extractions, extract_observations_from_staged | v_extraction_queue_status, v_ai_extraction_status, v_extraction_coverage | ~8 tables |
| **L4 CLASSIFICATION** | place_contexts, place_context_types, known_organizations, organization_place_mappings, google_map_entries | assign_place_context, set_place_classification, infer_place_contexts_from_data, infer_place_kind | v_place_active_contexts, v_place_classifications, v_place_context_summary | ~10 tables |
| **L5 SoT** | sot_people, sot_cats, sot_requests, sot_appointments, places, sot_addresses | find_or_create_request, convert_intake_to_request, build_clinichq_visits_v2 | v_canonical_people, v_canonical_cats, v_canonical_places | ~10 core tables |
| **L6 WORKFLOWS** | web_intake_submissions, journal_entries, request_trapper_assignments, communication_logs, staff, staff_sessions, trapper_onboarding, email_*, clinic_days, clinic_day_entries | compute_intake_triage, add_journal_entry, assign_trapper_to_request, convert_intake_to_request | v_intake_triage_queue, v_request_list, v_request_journal, v_pending_intake | ~30 tables |
| **L7 BEACON** | place_colony_estimates, cat_birth_events, cat_mortality_events, cat_movement_events, site_observations, ecology_config, observation_zones | beacon_cluster_colonies, calculate_chapman_estimate, calculate_survival_rates | v_beacon_summary, v_place_ecology_stats, v_place_colony_status, v_seasonal_dashboard | ~15 tables |
| **SUPPORT** | processing_jobs, entity_edits, data_changes, person_roles, person_place_relationships, cat_place_relationships, person_cat_relationships | All linking functions, audit functions | Most remaining 308 views | ~90 tables |

### Top 5 Failure Modes (Data Disappearance)

| # | Failure Mode | Severity | Count | Root Cause |
|---|-------------|----------|-------|------------|
| **F1** | Merge chain black holes (people) | CRITICAL | 1,194 people | `merged_into_person_id` points to another merged person. Single-hop lookup lands on dead record. |
| **F2** | Processing pipeline stalled | CRITICAL | 26,383 queued jobs | `process_next_job()` is not being called. Jobs sit in `queued` state indefinitely. |
| **F3** | Unprocessed ShelterLuv records | HIGH | 5,058 records | ShelterLuv staged records never processed into SoT. Foster/adopter outcomes missing. |
| **F4** | People without identifiers | HIGH | 986 people | No email/phone in `person_identifiers`. Will be duplicated on next encounter. |
| **F5** | Cats without microchips | MEDIUM | 1,608 cats | No dedup key. Same cat can appear as multiple records from different sources. |

### Backup Table Bloat

| Table | Rows | Action |
|-------|------|--------|
| backup_staged_records_clinichq_20260112 | 100,945 | Archive candidate |
| backup_rebuild_cat_place_relationships | 31,948 | Archive candidate |
| backup_rebuild_person_cat_relationships | 26,518 | Archive candidate |
| backup_person_cat_rels_20260112 | 26,518 | Archive candidate |
| backup_places_mig158 | 11,008 | Archive candidate |
| backup_sot_people_mig157 | 9,479 | Archive candidate |
| **Total** | **~208,000** | |

### Validation
- [x] All tables mapped to layers
- [x] Failure modes identified with counts
- [x] No schema changes made

### Stop Point
Inventory is complete. Proceed to TASK_002.

---

## TASK_002: Fix Merge Chain Black Holes

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — `sot_people` is read by request detail, journal, search
**Scope:** Flatten all person merge chains to single-hop. Add prevention trigger.
**Migration:** `sql/schema/sot/MIG_770__fix_person_merge_chains.sql`

### What Changed

1. `get_canonical_person_id(UUID)` already existed (MIG_225) with recursive chain-following — no changes needed.
2. One-time data fix: UPDATE flattened all 4,509 multi-hop merge chains (depths 2-5) to single-hop.
3. Prevention trigger `trg_prevent_person_merge_chain` added on `sot_people` — resolves merge target to canonical before INSERT/UPDATE.

### Pre-Fix State

| Metric | Count |
|--------|-------|
| Total merged people | 28,810 |
| In multi-hop chains (broken) | 4,509 |
| Single-hop (correct) | 24,301 |
| Chain depth 2 | 3,972 |
| Chain depth 3 | 531 |
| Chain depth 4 | 4 |
| Chain depth 5 | 2 |
| Circular chains | 0 |

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `sot_people` | Table | UPDATE (merged_into_person_id) on 4,509 already-merged rows | Yes (read by requests, journal) |
| `trg_prevent_person_merge_chain` | Trigger | CREATE (new, on sot_people) | No (only fires on merge operations) |
| `trg_flatten_person_merge_target()` | Function | CREATE (new trigger function) | No |
| `_backup_person_merge_chains_770` | Table | CREATE (backup, 28,810 rows) | No |

### Safety

- Only modified `merged_into_person_id` on already-merged records (not active canonical people).
- All views filter `WHERE merged_into_person_id IS NULL` — merged records are invisible.
- No API response shapes changed.
- No existing trigger behavior changed.
- New trigger only fires when `merged_into_person_id` is set (merge operations only).

### Validation Evidence (2026-01-28)

- [x] **Zero chains remain:**
  ```
  chains_remaining = 0
  ```
- [x] **All 28,810 merged people point to canonical (non-merged) targets:**
  ```
  total_merged = 28,810 | pointing_to_canonical = 28,810 | still_in_chain = 0
  ```
- [x] **`get_canonical_person_id()` returns target for 500/500 sampled merged people:**
  ```
  sampled = 500 | canonical_equals_target = 500
  ```
- [x] **Prevention trigger test PASSED:** Merging C→A (where A→B) correctly flattens to C→B
- [x] **Prevention trigger enabled:**
  ```
  trg_prevent_person_merge_chain | enabled
  ```

### Active Flow Safety Gate — SQL Smoke Queries (2026-01-28)

- [x] **Views resolve:**
  ```
  v_intake_triage_queue  | 742 rows
  v_request_list         | 285 rows
  ```
- [x] **Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Core tables have data:**
  ```
  web_intake_submissions  | 1,174
  sot_requests            |   285
  journal_entries         | 1,856
  staff                   |    24
  staff_sessions (active) |     1
  ```
- [x] **`compute_intake_triage()` function exists** (signature: `p_submission_id UUID`)

### Rollback

- Backup table: `trapper._backup_person_merge_chains_770` (28,810 rows)
- Restore SQL:
  ```sql
  UPDATE trapper.sot_people sp
  SET merged_into_person_id = b.original_merged_into
  FROM trapper._backup_person_merge_chains_770 b
  WHERE b.person_id = sp.person_id;
  ```
- Remove trigger: `DROP TRIGGER trg_prevent_person_merge_chain ON trapper.sot_people;`

### Stop Point

Merge chains flattened, prevention trigger active. Proceed to TASK_003.

---

## TASK_003: Fix Place Merge Chains + Same Pattern for Places

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — `places` is read by request detail, intake, search
**Scope:** Flatten 10 place merge chains. Add prevention trigger.
**Migration:** `sql/schema/sot/MIG_771__fix_place_merge_chains.sql`

### What Changed

1. `get_canonical_place_id(UUID)` already existed (MIG_225) — no changes needed.
2. Flattened 10 place merge chains (all depth 2) to single-hop.
3. Added prevention trigger `trg_prevent_place_merge_chain`.

### Pre-Fix State

| Metric | Count |
|--------|-------|
| Total merged places | 4,447 |
| In multi-hop chains | 10 |
| Chain depth 2 | 10 |

### Validation Evidence (2026-01-28)

- [x] **Zero chains remain:** `chains_remaining = 0`
- [x] **10 rows flattened** successfully
- [x] **Prevention trigger enabled:** `trg_prevent_place_merge_chain | enabled`
- [x] **Safety Gate — Views:** `v_intake_triage_queue: 742 rows` | `v_request_list: 285 rows`
- [x] **Safety Gate — All 7 critical triggers enabled**

### Rollback

- Backup: `trapper._backup_place_merge_chains_771` (4,447 rows)
- Restore: `UPDATE trapper.places p SET merged_into_place_id = b.original_merged_into FROM trapper._backup_place_merge_chains_771 b WHERE b.place_id = p.place_id;`

### Stop Point

Place chains flattened. Proceed to TASK_004.

---

## TASK_004: Stabilize Processing Pipeline

**Status:** Done
**ACTIVE Impact:** No — processing pipeline is background/async
**Scope:** Diagnosed stalled pipeline, added ShelterLuv routing, expired orphan jobs.
**Migration:** `sql/schema/sot/MIG_772__stabilize_processing_pipeline.sql`

### Root Cause

`process_next_job()` only routed `clinichq`, `airtable`, `web_intake`. ShelterLuv jobs (25,893 of 26,383 queued) had no routing — they would crash with "Unknown source_system". Meanwhile, ShelterLuv ingest scripts processed records directly (bypassing the queue), so the jobs were orphaned phantoms.

### What Changed

1. **Expired 26,204 stalled orphan jobs** — queued >24h, their records already processed by direct calls.
2. **Added ShelterLuv routing** to `process_next_job()`:
   - `people` → `process_shelterluv_people_batch()`
   - `animals` → `data_engine_process_batch('shelterluv', 'animals')`
   - `outcomes` → `process_shelterluv_outcomes()`
   - `events` → `process_shelterluv_events()`
3. **Added generic fallback** for unknown source systems → `data_engine_process_batch()`

### Pre-Fix State

| Status | Count |
|--------|-------|
| queued | 26,383 |
| completed | 6 |
| failed | 0 |

### Post-Fix State

| Status | Count |
|--------|-------|
| expired | 26,204 |
| queued | 179 (recent, valid) |
| completed | 6 |

### Validation Evidence (2026-01-28)

- [x] **Pipeline status:** `expired: 26,204 | queued: 179 | completed: 6`
- [x] **179 remaining queued jobs are recent** (today's ShelterLuv ingests)
- [x] **`process_next_job()` now routes shelterluv** (verified by CREATE FUNCTION)
- [x] **Safety Gate — Views:** `v_intake_triage_queue: 742` | `v_request_list: 285`
- [x] **Safety Gate — All 7 critical triggers enabled**

### Remaining Unprocessed Records

| Source | Table | Unprocessed |
|--------|-------|-------------|
| shelterluv | events | 4,172 |
| shelterluv | animals | 876 |
| clinichq | appointment_info | 44 |
| clinichq | cat_info | 40 |
| clinichq | owner_info | 38 |
| shelterluv | people | 10 |

These will be processed by the next cron run of `POST /api/ingest/process`.

### Stop Point

Pipeline routing fixed, stalled jobs expired. Future cron runs will process all source types.

---

## TASK_005: Backfill People Without Identifiers

**Status:** Done
**ACTIVE Impact:** No — strictly additive (INSERT into person_identifiers)
**Scope:** Recover identifiers for 986 people who have no email/phone in person_identifiers.
**Migration:** `sql/schema/sot/MIG_773__backfill_people_identifiers.sql`

### What Changed

1. Recovered emails/phones from `data_engine_match_decisions` for orphan people (no identifiers).
2. Used global uniqueness check — only inserts identifiers not already assigned to ANY person.
3. Tagged all inserts with `source_system = 'atlas_backfill_773'` for auditability.

### Key Finding

Of 986 orphan people, **494 have identifiers that already belong to another person** in `person_identifiers`. These are likely duplicates created before the Data Engine was fully operational. They need future merge review, not backfill.

### Results

| Metric | Count |
|--------|-------|
| People without identifiers (pre-fix) | 986 |
| Emails recovered | 7 |
| Phones recovered | 6 |
| People fixed (now have identifiers) | 13 |
| Remaining without identifiers | 973 |
| Potential duplicates (shared identifiers) | 494 |

### Remaining Orphans by Source

| Source | Count |
|--------|-------|
| clinichq | 582 |
| web_app | 320 |
| shelterluv | 29 |
| legacy_import | 25 |
| airtable | 16 |
| web_intake | 1 |

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `person_identifiers` | Table | INSERT (13 rows) | No (additive) |
| `sot_people` | Table | READ | No |
| `data_engine_match_decisions` | Table | READ | No |

### Safety

Strictly additive — only inserted new identifier rows. Used ON CONFLICT DO NOTHING as safety net. All inserts tagged with `source_system = 'atlas_backfill_773'`.

### Validation Evidence (2026-01-28)

- [x] **Orphan count decreased:** 986 → 973 (13 people fixed)
- [x] **13 identifiers added:** 7 emails + 6 phones
- [x] **494 potential duplicates identified** for future review
- [x] **Safety Gate — Views resolve:**
  ```
  v_request_alteration_stats: 275 rows
  v_trapper_full_stats: 54 rows
  v_place_alteration_history: 267 rows
  v_processing_dashboard: 7 rows
  ```
- [x] **Safety Gate — Critical triggers enabled:**
  ```
  trg_auto_triage_intake         | enabled
  trg_prevent_person_merge_chain | enabled
  trg_prevent_place_merge_chain  | enabled
  ```
- [x] **Safety Gate — Core functions exist:**
  ```
  find_or_create_person, find_or_create_place_deduped,
  find_or_create_cat_by_microchip, compute_intake_triage, process_next_job
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  sot_people: 41,761 | sot_requests: 285 | sot_cats: 36,587
  places: 15,818 | person_identifiers: 31,674
  ```

### Rollback

```sql
DELETE FROM trapper.person_identifiers WHERE source_system = 'atlas_backfill_773';
```

### Stop Point

13 orphan people recovered. 494 potential duplicates documented as future work (merge review). Remaining 479 have no recoverable identifiers from match decisions.

---

## TASK_006: Data Hygiene — Archive Backup Tables

**Status:** Done
**ACTIVE Impact:** No
**Scope:** Drop 10 old backup tables (~149 MB, ~208K rows). Keep 2 recent rollback backups from MIG_770/771.
**Migration:** `sql/schema/sot/MIG_774__archive_backup_tables.sql`

### What Changed

1. Verified all 12 backup tables have zero dependencies (no FK, no views, no functions).
2. Dropped 10 old backup tables (~149 MB reclaimed).
3. Kept 2 recent rollback backups (`_backup_person_merge_chains_770`, `_backup_place_merge_chains_771`).

### Tables Dropped

| Table | Size |
|-------|------|
| backup_staged_records_clinichq_20260112 | 129 MB |
| backup_rebuild_cat_place_relationships | 10 MB |
| backup_person_cat_rels_20260112 | 3 MB |
| backup_rebuild_person_cat_relationships | 3 MB |
| backup_places_mig158 | 2 MB |
| backup_sot_people_mig157 | 1 MB |
| backup_cat_place_relationships_mig159 | 552 KB |
| backup_person_identifiers_mig157 | 8 KB |
| backup_person_place_relationships_mig157 | 8 KB |
| backup_person_cat_relationships_mig157 | 8 KB |
| **Total** | **~149 MB** |

### Tables Kept

| Table | Size | Reason |
|-------|------|--------|
| _backup_person_merge_chains_770 | 3 MB | Rollback for TASK_002 (today) |
| _backup_place_merge_chains_771 | 296 KB | Rollback for TASK_003 (today) |

### Validation Evidence (2026-01-28)

- [x] **Zero FK references to any backup table** (checked pg_constraint)
- [x] **Zero views reference any backup table** (checked pg_views)
- [x] **Zero functions reference any backup table** (checked pg_proc)
- [x] **10 tables dropped, 2 kept**
- [x] **Safety Gate — Views resolve:**
  ```
  v_request_alteration_stats: 275 | v_trapper_full_stats: 54
  v_place_alteration_history: 267 | v_processing_dashboard: 7
  ```
- [x] **Safety Gate — Core tables:** sot_people: 41,761 | sot_requests: 285 | places: 15,818

### Rollback

Not possible — tables are dropped. Data was verified as safe to remove before dropping.

### Stop Point

149 MB reclaimed. Only today's rollback backups remain.

---

## ORCH_001: Minimal Orchestrator Backbone

**Status:** Done
**ACTIVE Impact:** No — purely additive tables alongside existing system
**Scope:** Create orchestrator coordination tables. Shadow mode only.
**Migration:** `sql/schema/sot/MIG_775__orchestrator_backbone.sql`

### What Changed

1. Created `orchestrator_sources` — registry of all data sources with schema, pipeline config, health tracking.
2. Created `orchestrator_routing_rules` — declarative field-to-surface mappings with FK to sources.
3. Created `orchestrator_job_log` — append-only routing audit trail with 3 indexes (source, target, errors).

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `orchestrator_sources` | Table | CREATE | No |
| `orchestrator_routing_rules` | Table | CREATE | No |
| `orchestrator_job_log` | Table | CREATE | No |

### Validation Evidence (2026-01-28)

- [x] **3 tables created:** orchestrator_sources, orchestrator_routing_rules, orchestrator_job_log
- [x] **8 indexes created** (3 PKs, 1 unique, 4 custom)
- [x] **Safety Gate — Views resolve:** v_request_alteration_stats: 275 | v_trapper_full_stats: 54 | v_processing_dashboard: 7

### Rollback

```sql
DROP TABLE IF EXISTS trapper.orchestrator_job_log CASCADE;
DROP TABLE IF EXISTS trapper.orchestrator_routing_rules CASCADE;
DROP TABLE IF EXISTS trapper.orchestrator_sources CASCADE;
```

### Stop Point

Backbone tables exist. Ready for ORCH_002 population.

---

## ORCH_002: Source Registry + Onboarding Pattern

**Status:** Done
**ACTIVE Impact:** No — populates orchestrator tables, creates helper functions
**Scope:** Register all sources, create onboarding functions, populate routing rules.
**Migration:** `sql/schema/sot/MIG_776__orchestrator_source_registry.sql`

### What Changed

1. Registered 17 data sources (16 existing + 1 demo) in `orchestrator_sources`.
2. Created `register_source()` — idempotent function to declare new sources.
3. Created `map_source_field()` — maps source fields to canonical surfaces with validation.
4. Populated 26 routing rules for 7 sources (clinichq, shelterluv, web_intake, client_survey).
5. Demonstrated onboarding pattern with `client_survey` demo source.
6. Synced ingest stats from `staged_records` to keep source health tracking accurate.

### Sources Registered

| Source System | Tables | Active | Records |
|--------------|--------|--------|---------|
| clinichq | 3 (cat_info, owner_info, appointment_info) | Yes | 115,212 |
| shelterluv | 4 (animals, people, outcomes, events) | Yes | 35,171 |
| airtable | 3 (trapping_requests, appointment_requests, trappers) | Yes | 1,577 |
| petlink | 2 (pets, owners) | Yes | 12,059 |
| volunteerhub | 1 (users) | Yes | 1,342 |
| web_intake | 1 (submissions) | Yes | realtime |
| etapestry | 1 (mailchimp_export) | No | 7,680 |
| airtable_sync | 1 (deprecated) | No | 1,177 |
| client_survey | 1 (demo) | Yes | 0 |

### Routing Rules by Source

| Source | Rules |
|--------|-------|
| clinichq/owner_info | 5 (email, phone, name, address) |
| clinichq/cat_info | 4 (microchip, name, sex, breed) |
| clinichq/appointment_info | 3 (number, date, services) |
| shelterluv/people | 4 (email, phone, name) |
| shelterluv/animals | 3 (ID, name, type) |
| web_intake/submissions | 3 (email, phone, address) |
| client_survey/responses | 4 (email, address, cat_count, fixed_count) |

### Validation Evidence (2026-01-28)

- [x] **17 sources registered** (16 existing + 1 demo)
- [x] **26 routing rules** across 7 sources
- [x] **register_source() works:** client_survey demo registered successfully
- [x] **map_source_field() validates:** requires source to exist first
- [x] **Stats synced** from staged_records (15 sources updated)

### Rollback

```sql
TRUNCATE trapper.orchestrator_routing_rules, trapper.orchestrator_sources CASCADE;
DROP FUNCTION IF EXISTS trapper.register_source;
DROP FUNCTION IF EXISTS trapper.map_source_field;
```

### Stop Point

Registry populated, onboarding pattern proven. Ready for ORCH_003 health views.

---

## ORCH_003: Data Health Checks + "Why Missing?" Surfaces

**Status:** Done
**ACTIVE Impact:** No — read-only views, no schema changes
**Scope:** Create 4 diagnostic views for data quality observability.
**Migration:** `sql/schema/sot/MIG_777__orchestrator_health_views.sql`

### What Changed

1. Created `v_orchestrator_health` — pipeline throughput and staleness per registered source.
2. Created `v_data_why_missing` — surfaces entities missing expected data.
3. Created `v_merge_chain_health` — detects merge chain black holes.
4. Created `v_routing_anomalies` — flags suspicious data patterns.

### View Results (2026-01-28)

**v_orchestrator_health (17 sources):**

| Health Status | Count |
|--------------|-------|
| healthy | 9 |
| stale | 5 |
| inactive | 2 |
| processing_behind | 1 |

**v_data_why_missing (6,107 issues):**

| Entity | Issue | Count |
|--------|-------|-------|
| cat | no_place_link | 3,520 |
| cat | no_microchip | 1,608 |
| person | no_identifiers | 973 |
| request | no_trapper | 6 |

**v_merge_chain_health: 0 chains** (clean after TASK_002/003)

**v_routing_anomalies (53 flags):**

| Anomaly | Count |
|---------|-------|
| many_identifiers | 44 |
| stale_source | 5 |
| high_cat_count | 4 |

### Validation Evidence (2026-01-28)

- [x] **All 4 views created and resolve without error**
- [x] **v_data_why_missing correctly identifies known gaps:**
  - 973 people without identifiers (matches TASK_005 remainder)
  - 1,608 cats without microchips (matches TASK_001 diagnosis)
  - 6 active requests without trappers
- [x] **v_merge_chain_health returns 0** (confirms TASK_002/003 fixes hold)
- [x] **Safety Gate — Existing views still resolve:**
  ```
  v_request_alteration_stats: 275 | v_trapper_full_stats: 54 | v_processing_dashboard: 7
  ```

### Rollback

```sql
DROP VIEW IF EXISTS trapper.v_routing_anomalies;
DROP VIEW IF EXISTS trapper.v_merge_chain_health;
DROP VIEW IF EXISTS trapper.v_data_why_missing;
DROP VIEW IF EXISTS trapper.v_orchestrator_health;
```

### Stop Point

All diagnostic surfaces operational. Data health is now observable via SQL.

---

## Task Execution Order

```
TASK_001 (Inventory)          ✅ Done
    ↓
TASK_002 (Merge chains: people)   ✅ Done — 4,509 chains flattened, prevention trigger added
    ↓
TASK_003 (Merge chains: places)   ✅ Done — 10 chains flattened, prevention trigger added
    ↓
TASK_004 (Processing pipeline)    ✅ Done — shelterluv routing added, 26,204 orphans expired
    ↓
TASK_005 (People identifiers)     ✅ Done — 13 identifiers recovered, 494 duplicates flagged
    ↓
TASK_006 (Backup cleanup)         ✅ Done — 10 tables dropped, 149 MB reclaimed
    ↓
ORCH_001 (Orchestrator backbone)  ✅ Done — 3 tables, 8 indexes, shadow mode
    ↓
ORCH_002 (Source registry)        ✅ Done — 17 sources, 26 rules, 2 functions
    ↓
ORCH_003 (Data health checks)     ✅ Done — 4 views: health, why-missing, chains, anomalies
    ↓
DH_A001 (Delete expired jobs)    ✅ Done — 26,204 expired jobs deleted, backup preserved
    ↓
DOC_001 (Documentation pass)     ✅ Done — 2 guides created, 5 docs archived
    ↓
SC_001 (Surgical: request quality) ✅ Done — 3 columns added to v_request_list, API updated
    ↓
DH_A002 (Delete orphan edits)    ✅ Done — 140 orphan entity_edits deleted, backup preserved
    ↓
DH_A003 (Drop empty tables)     ✅ Done — 2 tables dropped, 67 audited and kept
    ↓
SC_001 UI (Request list flags)   ✅ Done — DataQualityFlags component in card + table views
    ↓
DH_B001 (Remap match decisions)  ✅ Done — 29,750 FK refs remapped to canonical people (MIG_782)
    ↓
DH_B002 (Delete stale staged)    ✅ Done — 2,311 stale records + 130 DQI deleted (MIG_783)
    ↓
DH_C001 (Clean stale dup flags)  ✅ Done — 20,543 stale flags deleted, 227 canonical kept (MIG_784)
    ↓
SC_002 (Surgical: trapper visibility) ✅ Done — 24 client_trapping fixed, trapper name+filter in request list (MIG_785)
    ↓
DH_D001 (Triage ShelterLuv records)  ✅ Done — 0 unprocessed ShelterLuv; 909 chipless animals + 4 people triaged (MIG_786)
    ↓
SC_003 (Surgical: trapper assignment gaps) ✅ Done — 6 missing assignments fixed, 2 duplicate person_roles cleaned (MIG_787)
    ↓
DH_D002 (Audit empty tables)         ✅ Done — 68 audited: 67 planned features, 1 legacy (kept), 0 lookup gaps. Audit only.
    ↓
SC_004 (Surgical: assignment_status maintained field) ✅ Done — assignment_status backfilled + trigger + NOT NULL + v_request_list + API/UI filter (MIG_788)
    ↓
DH_E AUDIT (Place deduplication audit) ✅ Done — 3,317 duplicate pairs found, 4,019 places, 9,584 relinks needed
    ↓
DH_E005 (Apply MIG_793 + MIG_794)  ✅ Done — v_orphan_places view + relink functions applied. 0 orphan places found.
    ↓
DH_E001 (Harden normalize_address)  ✅ Done — MIG_799: Strip USA, em-dash city placeholders, periods, comma-before-zip, apartment→apt, 7 new street suffixes, 8 directionals. All 11,191 active places re-normalized.
    ↓
DH_E002 (Auto-merge duplicates)     ✅ Done — MIG_800: 188 exact duplicate pairs merged (3 passes). merge_place_into() function created. extract_house_number() + address_safe_to_merge() safety guards prevent false positives.
    ↓
DH_E003 (merged into E002)          ✅ Done — USA-suffix pairs resolved by enhanced normalize_address (no separate MIG needed).
    ↓
DH_E004 (Review ~307 structural dupes) ✅ Done — MIG_803 + MIG_815: Enhanced with Tier 4 text-only matching, inverted address normalization, junk address flagging, refresh button, people counts. Admin UI at /admin/place-dedup.
    ↓
MAP_001 (Show all places on map)    ✅ Done — MIG_798, LIMIT 12000, intake pins. Disease/watch_list flags verified (39 + 117). 11,100 total pins.
    ↓
UI_001 (Dashboard redesign)         ✅ Done — Full operations hub with greeting, needs-attention bar, my requests, recent intake, map preview, mobile stacked layout.
    ↓
UI_002 (Filter persistence + mobile) ✅ Done — All 5 list pages use useUrlFilters. Intake queue migrated from local state. Mobile auto-responsive on all pages. Beacon is separate analytics page (not map dupe).
    ↓
UI_005 (Name validation + cleanup)  ✅ Done — ALL CAPS warning added. B11 (no emoji found), B12 (no CSS conflict) were non-issues.
    ↓
UI_003 (Media gallery polish)       ✅ Done — Hero+grid, set-as-main-photo, mobile camera already built. Request-place photo bridging fixed in place media API.
    ↓
UI_004 (Place classification + orgs) ✅ Done — Inference function + classification review already built. Partner org profile card added to place detail. Orphan places admin already built.
```

---

## Change Log

| Date | Task | Action |
|------|------|--------|
| 2026-01-28 | TASK_001 | Completed: inventory + fragmentation map |
| 2026-01-28 | All tasks | Initial planning complete |
| 2026-01-28 | TASK_002 | Completed: 4,509 person merge chains flattened (MIG_770). Prevention trigger added. All Safety Gate checks pass. |
| 2026-01-28 | TASK_003 | Completed: 10 place merge chains flattened (MIG_771). Prevention trigger added. All Safety Gate checks pass. |
| 2026-01-28 | TASK_004 | Completed: Added shelterluv routing to process_next_job() (MIG_772). Expired 26,204 orphan jobs. 5,180 records remain for next cron. |
| 2026-01-28 | TASK_005 | Completed: Backfilled 13 identifiers (MIG_773). 494 orphan people share identifiers with existing people — flagged as potential duplicates. |
| 2026-01-28 | TASK_006 | Completed: Dropped 10 old backup tables (MIG_774). 149 MB reclaimed. Kept MIG_770/771 rollback backups. |
| 2026-01-28 | ORCH_001 | Completed: Created 3 orchestrator tables (MIG_775). Shadow mode — no existing pipelines changed. |
| 2026-01-28 | ORCH_002 | Completed: Registered 17 sources, 26 routing rules, 2 helper functions (MIG_776). Demo onboarding with client_survey. |
| 2026-01-28 | ORCH_003 | Completed: Created 4 diagnostic views (MIG_777). 6,107 data quality issues surfaced. 0 merge chains. |
| 2026-01-29 | DH_PLAN | Data Hygiene Plan added with categorized task cards (A through E). |
| 2026-01-29 | DH_A001 | Completed: Deleted 26,204 expired processing jobs (MIG_778). Backup preserved. All Safety Gate checks pass. |
| 2026-01-29 | DOC_001 | Completed: Documentation Reassessment Pass. Created ATLAS_OPERATOR_GUIDE.md + ATLAS_ENGINEERING_GUIDE.md. Moved 5 deprecated docs to docs/archive/. |
| 2026-01-29 | SC_001 | Completed: Surgical Change — Added data quality columns to v_request_list (MIG_779). API updated. All Safety Gate checks pass. |
| 2026-01-29 | DH_A002 | Completed: Deleted 140 orphan entity_edits (MIG_780). All MIG_572 deletion audit ghosts. Backup preserved. All Safety Gate checks pass. |
| 2026-01-29 | DH_A003 | Completed: Dropped 2 empty, unreferenced tables (MIG_781). 67 other empty tables audited and kept. All Safety Gate checks pass. |
| 2026-01-29 | SC_001 UI | Completed: DataQualityFlags component added to request list page. Card + table views render no_trapper, no_geometry, stale_30d, no_requester flags. |
| 2026-01-29 | DH_B001 | Completed: Remapped 23,829 resulting_person_id + 5,921 top_candidate_person_id from merged to canonical (MIG_782). Backup preserved. All 9 views resolve. All Safety Gate checks pass. |
| 2026-01-29 | DH_B002 | Completed: Deleted 2,311 stale staged records + 130 DQI rows (MIG_783). 91,942 NULL source_row_id rows verified as unique — untouched. Backups preserved. All Safety Gate checks pass. |
| 2026-01-29 | BUG_FIX | Fixed "Failed to fetch place details" on Open Full Page — API queried non-existent columns from v_place_detail_v2. Joined sot_addresses with correct column name (admin_area_1). Added fallback for non-address-backed places. |
| 2026-01-29 | DH_C001 | Completed: Deleted 20,543 stale person duplicate flags (MIG_784). Original 494 shared identifiers resolved by TASK_002 (now 0). 227 both-canonical rows kept for staff review. Backup preserved. All Safety Gate checks pass. |
| 2026-01-29 | SC_002 | Completed: Trapper visibility in request list (MIG_785). Fixed 24 Airtable client_trapping requests. Added no_trapper_reason + primary_trapper_name to v_request_list. Trapper filter + column in UI. All Safety Gate checks pass. |
| 2026-01-29 | DH_D001 | Completed: Triaged all unprocessed ShelterLuv records (MIG_786). Events: 4,171/4,172 already processed by cron. Animals: 909 chipless cats marked triaged. People: 4 marked triaged. Final: 0 unprocessed ShelterLuv. All Safety Gate checks pass. |
| 2026-01-29 | SC_003 | Completed: Fixed 6 missing trapper assignments from Airtable (MIG_787). Root cause: 2 Airtable trapper IDs each mapped to 2 Atlas people (duplicate person_roles). Cleaned duplicates, created 6 assignments. 0 Airtable gaps remaining. All Safety Gate checks pass. |
| 2026-01-29 | DH_D002 | Completed: Audit of 68 empty tables. 67 are planned feature infrastructure (FK/view/function refs). 1 legacy table (`appointment_requests`, superseded by staged_records). 0 lookup tables needing population. No migration needed — audit only. |
| 2026-01-29 | SC_004 | Completed: Made assignment_status a maintained lifecycle field (MIG_788). Backfilled 285 requests: 178 assigned, 83 pending, 24 client_trapping. Added auto-maintenance trigger on request_trapper_assignments. Column is NOT NULL DEFAULT 'pending'. v_request_list updated. API filter uses assignment_status. UI dropdown updated. All Safety Gate checks pass. |
| 2026-01-30 | DH_E AUDIT | Completed: Full place deduplication audit. Found 3,317 duplicate place pairs (4,019 distinct places). 9,584 relationships need relinking. 398 people + 704 cats affected by definite duplicates. Root cause: `normalize_address()` too lightweight — misses ", USA", trailing whitespace, period stripping. Categorized: 73 auto-safe, 415 USA-suffix, 2,829 structural. MIG_793/794 files exist but NOT applied. |
| 2026-01-30 | MAP_001 | Done: MIG_798 show all interacted places on map. LIMIT 3000→12000. Intake submissions added to v_map_atlas_pins. 914 stale cat activity + 8,473 appointment activity flags fixed. Disease/watch_list flags verified working (39 disease + 117 watch_list pins). 11,100 total pins. |
| 2026-01-30 | DH_E004 | Done: MIG_803 place dedup detection (table+function approach). 3,853 candidates across 3 tiers (753 T1 close+similar, 691 T2 close+different, 2,409 T3 farther+similar). Admin page at /admin/place-dedup with merge/keep_separate/dismiss. place_safe_to_merge() safety guard. |
| 2026-01-30 | DH_E005 | Completed: Applied MIG_793 (v_orphan_places view) + MIG_794 (relink_person_primary_address + unlink functions). Fixed column name mismatches (locality→location, source_system→data_source). 0 orphan places found. |
| 2026-01-30 | DH_E001 | Completed: MIG_799 hardened normalize_address(). Added: TRIM, USA/US suffix stripping, em-dash city placeholder removal, comma-before-zip normalization, period stripping, apartment→apt, 7 new street suffixes, 8 directionals. Created extract_house_number() and address_safe_to_merge() guard functions. Re-normalized 11,191 active places. |
| 2026-01-30 | DH_E002+E003 | Completed: MIG_800 created merge_place_into() function + merged 188 duplicate place pairs across 3 passes (36 exact + 151 em-dash/comma/suffix + 1 apartment). Full FK relinking across all 30+ referencing tables. Entity_edits audit trail for every merge. 0 exact duplicates remaining. ~307 fuzzy pairs remain for admin review (DH_E004). |
| 2026-01-30 | DH_E004 | Done: MIG_803 place dedup detection (table+function approach). 3,853 candidates across 3 tiers. Admin page at /admin/place-dedup. |
| 2026-01-30 | MAP_001 | Done: All 4 changes verified working. 11,100 pins, disease/watch_list flags correct. |
| 2026-01-30 | PERSON_DEDUP | Done: MIG_801/802 person dedup audit + batch merges. 1,178 candidates (tier 4-5 only). Admin page at /admin/person-dedup. Tiers 1-2 already clean. |
| 2026-01-30 | INFRA | Done: PlaceResolver component (9 forms migrated), 2 crons wired to vercel.json. |
| 2026-01-30 | UI_001-005 | Planned: 5 new UI tasks added to ledger. Dashboard redesign, filter persistence, media gallery, place classification, input validation. See task cards below MAP_001 section. |
| 2026-01-31 | VOL_001 | Done: VolunteerHub API sync — 1346 volunteers, 100% matched, 537 roles, 1876 group memberships. MIG_809-813. |
| 2026-01-31 | VOL_001b | Done: Trusted source skeleton infrastructure — 9 skeleton people created, enrichment pipeline integrated into sync. MIG_813. |
| 2026-01-31 | Person ContactCard | Done: Contact info + source label moved above tabs. Address is clickable link to place. Skeleton records show warning. API returns data_quality + primary_place_id. |
| 2026-01-31 | UI_001 | Verified Done: Dashboard already fully implemented with greeting, needs-attention bar, my requests, recent intake, map preview, mobile layout. |
| 2026-01-31 | UI_002 | Done: Intake queue filters migrated to useUrlFilters (6 filters). Other 4 pages already had URL persistence + mobile auto-responsive. Beacon is separate analytics page. |
| 2026-01-31 | UI_005 | Done: ALL CAPS name warning added. B11 (no emoji found in page), B12 (no CSS conflict exists) were non-issues. |
| 2026-01-31 | UI_003 | Done: Hero+grid layout, set-as-main-photo, mobile camera capture already implemented. Request-place photo bridging fixed (place media API includes request-linked photos). EXIF GPS deferred. |
| 2026-01-31 | UI_004 | Done: Part A (inference function + classification review + extraction pipeline) already built. Part B: Partner org profile card added to place detail page (org name, stats, contact, admin link). Place API enhanced with partner_org data and org-enriched context fields. Part C (orphan places admin) already built. |
| 2026-01-31 | DIS_001 | Done: Disease tracking system. MIG_814 (schema: disease_types, place_disease_status, process_disease_extraction hook, 6 disease attribute definitions). API endpoints (/places/[id]/disease-status, /admin/disease-types). DiseaseStatusSection in place detail. Extraction hook in extract_clinic_attributes.mjs. |
| 2026-01-31 | DIS_001 fix | Fixed MIG_814: mapping patterns matched actual combo test format (Negative/Positive not FIV+), ILIKE for case-insensitivity, removed WHERE result='positive' filter. 87 disease statuses computed (was 0). Data audit: 69 FIV active + 14 ringworm historical from clinic. 66 additional places with disease mentions in Google Maps not in clinic data — needs AI extraction (DIS_002). |
| 2026-01-31 | DH_E004 | Enhanced: MIG_815 — Tier 4 text-only matching for coordinate-less places, inverted address normalization, normalize_address_for_dedup(), junk address flagging (is_junk_address column), functional index. API: refresh_candidates action, people counts, junk count. UI: Tier 4 tab, refresh button, clickable links, null distance handling. |
| 2026-01-31 | MAP_008 | Done: Legend z-index 800→1002, keyboard shortcut K to toggle legend, SVG teardrop pins in legend (generateLegendPinSvg). DiseaseStatusSection already supports adding new disease flags — no code change needed. |
| 2026-01-31 | VOL_002 | Done: MIG_816 — Recreated match_volunteerhub_volunteer() to assign 'pending' instead of 'active'. Recreated process_volunteerhub_group_roles() with approved-group check. Backfilled: non-approved VH volunteers set to 'pending'. Map auto-filters via existing role_status='active' check. |
| 2026-01-31 | MAP_009 | Done: MIG_818 — pin_tier column in v_map_atlas_pins (active/reference). createReferencePinMarker() in map-markers.ts (18px, 0.65 opacity, muted gradient). AtlasMap branches on pin_tier for rendering. Legend shows Active/Reference sections. process_disease_extraction_for_place() function added. |
| 2026-01-31 | MAP_010 | Done: MIG_817 — Creates correct place via find_or_create_place_deduped(), links Google Maps entries, fixes 5 merged records pointing to wrong target (107 Verde Ct), flags malformed person "410 Corde Pintado Dr." |
| 2026-01-31 | DIS_002 | Done: extract_google_map_disease.mjs — AI extraction of disease mentions from Google Maps entries. Sonnet for all entries (polarity critical). Calls process_disease_extraction_for_place(). ~78 entries, ~$0.04. CLI: --dry-run, --limit N. |
| 2026-01-31 | DIS_002 fix | Fixed greedy regex parser (bracket-counting), tighter prompt, max_tokens 500→300. Re-ran all 399 entries — 0 parse errors (was 10). Total: 76 positives across 3 batches, $1.97 total cost. |
| 2026-01-31 | DIS_002+ | Separate reference pin clustering: refLayer with radius 80, uncluster zoom 17, muted cluster icons. Volunteer auto-graduation: active_roles JOIN in v_map_atlas_pins — 252 places graduated to active tier. |
| 2026-01-31 | DIS_003 | Combo test bug: MIG_164 checked ILIKE '%negative%' first, matching "Negative/Positive" (FIV+) as negative. Fixed parsing order, corrected 286 records. Extracted 2 FeLV + 55 FIV flags from medical notes via process_disease_extraction(). Zero FeLV in structured tests is genuine — ClinicHQ doesn't record FeLV+ in combo field (cats euthanized/sent to IDEXX). Final: 168 place disease flags (38 FeLV, 94 FIV, 32 ringworm, 3 panleukopenia, 1 heartworm). |

---

## Data Hygiene Plan

**Created:** 2026-01-29
**Boundaries from:** `docs/ATLAS_NORTH_STAR.md` Data Zones

### Data Zone Restatement

| Zone | Scope | Hygiene Rule |
|------|-------|-------------|
| **ACTIVE** | `web_intake_submissions`, `sot_requests`, `journal_entries`, `request_trapper_assignments`, `places`, `sot_people`, `sot_cats`, `staff`, `staff_sessions`, `communication_logs` + 9 triggers on sot_requests + intake triggers | **DO NOT TOUCH.** No deletes, no archives, no merges without Safety Gate + Surgical Change process. |
| **SEMI-ACTIVE** | `colonies/*`, `place_contexts/*`, `known_organizations`, `extraction_queue/*`, `tippy_*`, `email_*`, `trapper_onboarding`, `data_engine_*` | Soft-archive only. Prefer views over deletes. Test in staging. |
| **HISTORICAL** | `staged_records`, `cat_birth_events`, `cat_mortality_events`, `place_colony_estimates`, `google_map_entries`, `processing_jobs`, `entity_edits`, `data_changes`, all `v_beacon_*` views | Can clean more aggressively. Provable orphans safe to delete. Audit logs soft-archivable. |

### Orphan Analysis Results (2026-01-29)

| Finding | Zone | Count | Impact |
|---------|------|-------|--------|
| Expired processing jobs | HISTORICAL | 26,204 (15 MB) | Pure audit artifacts, tagged by MIG_772 |
| Empty tables (unused features) | MIXED | 138 tables | Many are never-populated feature scaffolding |
| Match decisions → merged people | SEMI-ACTIVE | 23,829 of 108,776 | Audit trail, could remap to canonical |
| Orphan entity_edits | HISTORICAL | 140 of 168 | Reference non-existent person IDs |
| Duplicate staged_records | HISTORICAL | 2,284 excess rows | Already processed, same source_record_id |
| 494 people sharing identifiers | ACTIVE (sot_people) | 494 | Potential duplicates, need review |
| Unprocessed shelterluv events | HISTORICAL | 4,172 | Backlog or phantom records |

---

### Category A: Safe to Delete (Provable Orphans)

#### DH_A001: Delete Expired Processing Jobs

**Status:** Done
**Zone:** HISTORICAL
**ACTIVE Impact:** No — `processing_jobs` is the background async queue. Not read by any ACTIVE UI.
**Scope:** Delete 26,204 rows with `status='expired'`. Tagged by MIG_772 as phantom jobs.
**Migration:** `sql/schema/sot/MIG_778__delete_expired_processing_jobs.sql`

### Pre-Checks (All Passed)

| Check | Result |
|-------|--------|
| FK references to processing_jobs | **0** — no FKs |
| Views referencing table | 3 (v_processing_dashboard, v_data_engine_health, v_orchestrator_health) — none filter for expired specifically |
| ACTIVE endpoints reading expired | **None** — `/api/health/processing` reads the view |

### Row Counts

| Metric | Before | After |
|--------|--------|-------|
| expired | 26,204 | 0 |
| queued | 217 | 217 |
| completed | 6 | 6 |
| **Total** | **26,427** | **223** |

### Validation Evidence (2026-01-29)

- [x] **26,204 rows deleted**, 223 remaining
- [x] **Backup created:** `trapper._backup_expired_jobs_778` (26,204 rows)
- [x] **Safety Gate — Views resolve:**
  ```
  v_request_alteration_stats: 275 | v_trapper_full_stats: 54
  v_place_alteration_history: 267 | v_processing_dashboard: 2
  v_orchestrator_health: 17
  ```
- [x] **Safety Gate — Critical triggers enabled:**
  ```
  trg_auto_triage_intake | trg_log_request_status | trg_set_resolved_at
  trg_prevent_person_merge_chain | trg_prevent_place_merge_chain
  ```
- [x] **Safety Gate — Core tables intact:**
  ```
  sot_people: 41,761 | sot_requests: 285 | sot_cats: 36,587
  web_intake_submissions: 1,174 | journal_entries: 1,856
  ```

### Rollback

```sql
INSERT INTO trapper.processing_jobs (job_id, source_system, source_table, status, queued_at, completed_at, last_error)
SELECT job_id, source_system, source_table, status, queued_at, completed_at, last_error
FROM trapper._backup_expired_jobs_778;
```

#### DH_A002: Delete Orphan Entity Edits

**Status:** Done
**Zone:** HISTORICAL
**ACTIVE Impact:** No — entity_edits is an audit log. ACTIVE flows only INSERT into it (logFieldEdits on PATCH). No ACTIVE UI reads orphan rows.
**Scope:** Delete 140 entity_edits where the referenced person no longer exists in sot_people.
**Migration:** `sql/schema/sot/MIG_780__delete_orphan_entity_edits.sql`

### Pre-Checks (All Passed)

| Check | Result |
|-------|--------|
| FK from pending_edits to orphan rows | **0** — no references |
| Orphan rows with rollback chains | **0** — no rollback links |
| Other entity_edits referencing orphan rows | **0** — no reverse rollback refs |
| Views reading entity_edits | 1 (`v_recent_edits`) — not an ACTIVE flow surface; orphan rows return NULL entity_name |
| API endpoints reading entity_edits | 2 (`/api/intake/queue/[id]/history`, `/api/entities/[type]/[id]/history`) — query by entity_id; orphaned person IDs are unreachable since the people don't exist |
| Functions writing entity_edits | 17 — all INSERT, none DELETE; not affected |

### What Was Deleted

All 140 orphan rows are identical in nature:

| Field | Value |
|-------|-------|
| entity_type | `person` |
| edit_type | `delete` |
| field_name | `full_record` |
| edited_by | `system:MIG_572` |
| edit_source | `migration` |

These are audit ghosts from MIG_572 — it deleted people from sot_people but left behind entity_edits records referencing the now-absent person_ids.

### Row Counts

| Metric | Before | After |
|--------|--------|-------|
| Total entity_edits | 168 | 28 |
| Orphan rows (person) | 140 | 0 |
| Valid person edits | 6 | 6 |
| Request edits | 20 | 20 |
| Intake submission edits | 2 | 2 |

### Validation Evidence (2026-01-29)

- [x] **140 rows deleted**, 28 remaining (all valid)
- [x] **Zero remaining orphans** (confirmed by post-delete query)
- [x] **Backup created:** `trapper._backup_orphan_entity_edits_780` (140 rows)
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  v_recent_edits:         28 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     2
  ```

### Rollback

```sql
INSERT INTO trapper.entity_edits
SELECT * FROM trapper._backup_orphan_entity_edits_780;
```

### Stop Point

140 orphan entity_edits deleted. All valid audit records preserved. Backup available for rollback.

#### DH_A003: Drop Empty Unused Feature Tables

**Status:** Done
**Zone:** MIXED (verified per table)
**ACTIVE Impact:** No — dropped tables have zero FK, view, and function references
**Scope:** Audit all 69 empty tables. Drop those with zero rows AND zero FK/view/function references.
**Migration:** `sql/schema/sot/MIG_781__drop_empty_unused_tables.sql`

### Audit Results (2026-01-29)

**69 empty tables in trapper schema.** Categorized by dependency status:

| Category | Tables | Action |
|----------|--------|--------|
| 0 FK, 0 views, 0 functions | 2 | **Dropped** (automation_rules, cat_reunifications) |
| 0 FK, 0 views, has function refs | 5 | Kept — functions reference them |
| 0 FK, has view refs | 15 | Kept — views reference them |
| Has FK refs | 4 | Kept — other tables have FK to them |
| Active feature scaffolding | 43 | Kept — colonies, email, tippy, trapper, Data Engine, Beacon |

### Tables Dropped

| Table | Size | Description |
|-------|------|-------------|
| `automation_rules` | 24 KB | Automation feature — never implemented, no references |
| `cat_reunifications` | 32 KB | Cat reunification feature — never implemented, no references |

### Tables Kept (Notable)

| Table | Why Kept |
|-------|---------|
| `colonies`, `colony_*` (6 tables) | Colony management system — SEMI-ACTIVE, UI built |
| `trapper_site_visits`, `trapper_manual_catches` | Referenced by `v_trapper_full_stats` |
| `request_cats` | Referenced by `v_request_list` (linked_cat_count subquery) |
| `communication_logs` | In ACTIVE zone per NORTH_STAR |
| `site_observations`, `observation_*` | Beacon ecology system |
| `pending_edits` | FK to entity_edits, edit workflow |
| `orchestrator_job_log` | Created by ORCH_001 |
| `email_*` (4 tables) | Email system — SEMI-ACTIVE |
| `tippy_*` (2 tables) | Tippy AI assistant |
| `data_engine_soft_blacklist` | Data Engine |
| `intake_custom_fields` | Custom intake fields (MIG_238) |

### Validation Evidence (2026-01-29)

- [x] **2 tables dropped**, both confirmed 0 rows, 0 inbound FKs
- [x] **Tables no longer exist** (verified by pg_tables query)
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     2
  ```

### Rollback

Not possible — tables are dropped. Both had 0 rows, so no data lost.

### Stop Point

2 empty, unreferenced tables dropped. 67 remaining empty tables documented with dependency reasons.

---

### Category B: Safe to Archive (Soft Archive + Views)

#### DH_B001: Remap Match Decisions from Merged People to Canonical

**Status:** Done
**Zone:** SEMI-ACTIVE
**ACTIVE Impact:** No — `data_engine_match_decisions` is an audit/history table. ACTIVE flows only INSERT into it (via `data_engine_resolve_identity`). Views that read it will return more accurate results after remapping.
**Scope:** Remap 23,829 `resulting_person_id` and 5,921 `top_candidate_person_id` values from merged people to their canonical equivalents via `get_canonical_person_id()`.
**Migration:** `sql/schema/sot/MIG_782__remap_merged_match_decisions.sql`

### Pre-Checks (All Passed)

| Check | Result |
|-------|--------|
| FK constraints on table | 3 — `resulting_person_id → sot_people`, `top_candidate_person_id → sot_people`, `household_id → households` |
| Views referencing table | 9 — `v_data_engine_review_queue`, `v_data_engine_stats`, `v_data_engine_health`, `v_identity_resolution_health`, `v_identity_decision_breakdown`, `v_data_engine_enrichment_stats`, `v_people_without_data_engine`, `v_data_engine_coverage`, `v_data_engine_org_decisions` |
| get_canonical_person_id() | Verified working — returns correct canonical for merged people |
| NULL resulting_person_id rows | 43,247 — expected for rejected/new_entity decisions, untouched |

### Row Counts

| Metric | Before | After |
|--------|--------|-------|
| Total rows | 108,776 | 108,776 |
| resulting_person_id → merged | 23,829 | 0 |
| top_candidate_person_id → merged | 5,921 | 0 |
| resulting_person_id → canonical | 41,700 | 65,529 |
| resulting_person_id → NULL | 43,247 | 43,247 |

### Decision Type Breakdown (Remapped Rows)

| Decision Type | Count |
|---------------|-------|
| review_pending | 18,813 |
| auto_match | 3,083 |
| new_entity | 1,755 |
| household_member | 111 |
| contact_info_update | 67 |

### Validation Evidence (2026-01-29)

- [x] **23,829 resulting_person_id remapped**, 5,921 top_candidate_person_id remapped
- [x] **0 merged references remaining** (both columns verified)
- [x] **Backup created:** `trapper._backup_merged_match_decisions_782` (26,437 rows — captures both columns)
- [x] **All 9 dependent views resolve:**
  ```
  v_data_engine_review_queue:     3,262 rows
  v_data_engine_stats:               15 rows
  v_data_engine_health:               1 row
  v_identity_resolution_health:       1 row
  v_identity_decision_breakdown:     46 rows
  v_data_engine_enrichment_stats:    13 rows
  ```
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     3
  ```

### Rollback

```sql
UPDATE trapper.data_engine_match_decisions d
SET resulting_person_id = b.old_resulting_person_id,
    top_candidate_person_id = b.old_top_candidate_person_id
FROM trapper._backup_merged_match_decisions_782 b
WHERE d.decision_id = b.decision_id;
```

### Stop Point

23,829 + 5,921 FK references remapped to canonical people. All views resolve. Audit trail preserved. Backup available for rollback.

#### DH_B002: Delete Stale Staged Records

**Status:** Done
**Zone:** HISTORICAL (L1 RAW)
**ACTIVE Impact:** No — `staged_records` is the raw ingestion layer. No ACTIVE UI reads individual staged records. Processing pipeline uses `is_processed` flag, not record age.
**Scope:** Delete 2,311 stale staged records where a newer version of the same source record exists. Also delete 130 `data_quality_issues` rows that reference stale records (only FK constraint on staged_records).
**Migration:** `sql/schema/sot/MIG_783__delete_stale_staged_records.sql`

### Investigation Results

| Category | Count | Action |
|----------|-------|--------|
| Stale duplicates (non-NULL source_row_id, older version exists) | 2,311 | **Deleted** |
| NULL source_row_id rows (each has unique payload) | 91,942 | Untouched — NOT duplicates |
| Latest version of each source record | 80,033 | Untouched — keepers |
| data_quality_issues referencing stale records | 130 (entire table) | **Deleted** (FK blocker) |

### Pre-Checks (All Passed)

| Check | Result |
|-------|--------|
| FK constraints on staged_records | 1 — `data_quality_issues.staged_record_id` |
| Soft references (no FK) | `ingest_run_records`, `data_engine_match_decisions`, `name_candidates` — no constraint, DELETE succeeds |
| NULL source_row_id rows | 91,942 — all have unique payloads, NOT duplicates |
| DQI rows referencing stale records | 130 (all `data_entry_error` or `missing_microchip`, 56 `wont_fix`) |

### Stale Breakdown by Source

| Source | Stale Rows |
|--------|-----------|
| clinichq / appointment_info | 1,169 |
| shelterluv / animals | 929 |
| etapestry / mailchimp_export | 82 |
| airtable / trappers | 63 |
| airtable_sync / appointment_requests | 38 |
| shelterluv / events | 26 |
| shelterluv / people | 4 |

### Row Counts

| Metric | Before | After |
|--------|--------|-------|
| Total staged_records | 174,286 | 171,975 |
| With source_row_id | 82,344 | 80,033 |
| NULL source_row_id | 91,942 | 91,942 |
| Stale duplicates | 2,311 | 0 |
| data_quality_issues | 130 | 0 |

### Validation Evidence (2026-01-29)

- [x] **2,311 stale staged records deleted**, 0 remaining stale
- [x] **130 data_quality_issues deleted** (all referenced stale records)
- [x] **91,942 NULL source_row_id rows untouched** (unique payloads)
- [x] **Backups created:**
  - `trapper._backup_stale_staged_records_783` (2,311 rows)
  - `trapper._backup_data_quality_issues_783` (130 rows)
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Staged records views resolve:**
  ```
  v_staged_records_latest_run: 47,628 rows
  v_clinichq_stats:                  3 rows
  v_orchestrator_health:            17 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     3
  ```

### Rollback

```sql
INSERT INTO trapper.data_quality_issues SELECT * FROM trapper._backup_data_quality_issues_783;
INSERT INTO trapper.staged_records SELECT * FROM trapper._backup_stale_staged_records_783;
```

### Stop Point

2,311 stale staged records + 130 DQI rows deleted. All keepers and NULL rows preserved. Backups available.

---

### Category C: Safe to Merge (Deterministic Duplicates)

#### DH_C001: Review 494 People Sharing Identifiers

**Status:** Done
**Zone:** SEMI-ACTIVE (potential_person_duplicates)
**ACTIVE Impact:** No — potential_person_duplicates is a review/audit table. ACTIVE flows only INSERT into it. No sot_people merges performed.
**Scope:** 494 orphan people whose emails/phones already belonged to other people in person_identifiers. TASK_002 merge chain fixes resolved all shared identifiers (now 0). The 20,770 rows in potential_person_duplicates were 98.9% stale (referencing already-merged people).

**Investigation Results:**
- Shared identifiers among canonical people: **0** (resolved by TASK_002)
- `potential_person_duplicates` total: **20,770 rows** (all `pending` status)
- Rows where `person_id` → merged person: **19,635** (stale — merge already happened)
- Rows where `potential_match_id` → merged person: **2,898** (stale, overlaps above)
- Rows where either side merged: **20,543** (deleted)
- Rows where both sides canonical: **227** (kept for future staff review)
  - `data_engine_review`: 104
  - `email_name_mismatch`: 75
  - `phone_name_mismatch`: 48
- No inbound FK constraints on `potential_person_duplicates`
- 1 dependent view: `v_pending_person_duplicates` (still resolves, returns 227 rows)
- 2 functions reference table: `data_engine_resolve_review`, `resolve_person_duplicate` (operate by ID, unaffected)

**Migration:** MIG_784
**Backup:** `trapper._backup_stale_person_duplicates_784` (20,543 rows)

**Validation Evidence:**
```
Pre:  20,770 rows total (20,543 either-merged, 227 both-canonical)
Post: 227 rows total (0 person_merged, 0 match_merged)
v_pending_person_duplicates: 227 rows
Safety Gate: All views resolve, all triggers enabled, all core tables have data
```

**Rollback:**
```sql
INSERT INTO trapper.potential_person_duplicates SELECT * FROM trapper._backup_stale_person_duplicates_784;
```

---

### Category D: Needs Manual Review

#### DH_D001: Triage Unprocessed ShelterLuv Records

**Status:** Done
**Zone:** HISTORICAL (staged_records, processing_jobs)
**ACTIVE Impact:** No — HISTORICAL zone only. No ACTIVE tables/views/triggers touched.
**Scope:** 4,172 unprocessed shelterluv events + 914 unprocessed animals identified by TASK_004. Triaged to determine new vs already-processed data.

**Investigation Results:**
- **Events (4,172):** 4,171 were already processed by cron since TASK_004. Last 1 processed successfully by MIG_786 Step 4. **0 remain.**
- **Animals (909):** ALL had no microchip AND no species. Data engine rejected 906/909 (can't deduplicate without microchip). These are ShelterLuv-only community cats never clinically processed. Marked as triaged (`is_processed=true`). **0 remain.**
- **People (11):** 10 had processing errors (missing `update_person_contact_info()` function), 1 skipped. 7 were matched to existing SoT people via email. 4 remaining marked as triaged. **0 remain.**
- **Outcomes:** All 6,420 already processed. **0 remain.**
- **Final state:** 0 unprocessed ShelterLuv records across all 4 tables.
- Non-ShelterLuv unprocessed: 122 ClinicHQ records (not in DH_D001 scope — ongoing pipeline)

**ShelterLuv SoT Entities:**
- `sot_cats` (shelterluv): 1,636
- `sot_people` (shelterluv): 4,959
- `person_cat_relationships` (shelterluv): 1,568
- `cat_identifiers` (shelterluv_id): 6,275

**Migration:** MIG_786
**No backup needed** — records were marked as processed (not deleted)

**Validation Evidence:**
```
Pre:  4,172 events + 909 animals + 11 people unprocessed
Post: 0 unprocessed ShelterLuv records (all 4 tables)
Processing jobs: 246 queued, 6 completed (healthy)
Safety Gate: All views resolve, all triggers enabled, all core tables have data
```

#### DH_D002: Audit Empty Tables for Feature Intent

**Status:** Done (audit only — no migration needed)
**Zone:** MIXED
**Scope:** Of 138 empty tables (originally), determine which are: (a) planned features to keep, (b) abandoned scaffolding to drop, (c) lookup tables that should be populated. DH_A003 previously dropped 2 (automation_rules, cat_reunifications). 68 remain.

**Investigation Results (68 empty tables):**

All 68 have FK constraints, view references, trigger references, or documented purposes. Zero candidates for immediate drop.

**(a) Planned Features to Keep — 67 tables**

| Feature System | Tables (count) | Views | Status |
|---------------|---------------|-------|--------|
| Colony Management (MIG_610) | 7 (`colonies` +6) | 8 views | Infrastructure built, awaiting UI activation |
| Email/Communication | 5 (`sent_emails`, `email_jobs`, etc.) | 7 views | Full pipeline built, not yet connected |
| Entity Matching | 8 (`person_match_candidates`, etc.) | 7 views | Data Engine review queue infrastructure |
| Cat Detail | 6 (`cat_medical_events`, `request_cats`, etc.) | 5 views | Cat profile enrichment features |
| Ecology/Observation (MIG_220/288) | 5 (`observation_zones`, `site_observations`, etc.) | 4 views | Chapman mark-recapture infrastructure |
| Trapper System | 6 (`trapper_site_visits`, `trapper_onboarding`, etc.) | 4 views | Trapper workflow features |
| Place/Request Audit | 4 (`place_changes`, `request_media`, etc.) | 4 views | Change tracking |
| Journal Features | 2 (`journal_attachments`, `journal_entity_links`) | 2 views | Journal enrichment |
| Person Features | 2 (`person_person_edges`, `person_relationships`) | 4 views | Relationship graph |
| Intake Pipeline | 5 (`raw_intake_*`, `intake_custom_fields` w/ trigger) | 2 views | Intake processing |
| Tippy AI | 2 (`tippy_draft_requests`, `tippy_proposed_corrections`) | 2 views | Tippy assistant features |
| Media | 2 (`media_collections`, `media_collection_items`) | — | Media gallery |
| Audit/Infrastructure | 10 (`orchestrator_job_log`, `entity_edit_locks`, etc.) | 8 views | Logs, locks, infrastructure |
| ClinicHQ | 1 (`clinichq_upcoming_appointments`) | 1 view | Upcoming appointment tracking |

**(b) Abandoned Scaffolding — 1 table (not dropped)**

| Table | Evidence | Decision |
|-------|----------|----------|
| `appointment_requests` | 0 FK, 0 views, 0 functions, 0 triggers. Legacy Airtable staging table superseded by `staged_records` pipeline. | **Keep for now** — 0 rows, no urgency. |

**(c) Lookup Tables Needing Population — 0**

All lookup tables (`place_context_types`, `ecology_config`, `known_organizations`, etc.) are already populated.

**Conclusion:** 67 planned features to keep, 1 legacy table (no urgency), 0 empty lookup tables. DH_A003 already dropped the only 2 truly abandoned tables. No migration needed.

---

### Category E: Do-Not-Touch (ACTIVE)

| Table/Object | Reason |
|-------------|--------|
| All tables in ACTIVE zone | Staff daily use |
| `staged_records` | L1 RAW — append-only per INV-1 |
| `data_changes` | Active audit log (23,804 entries, growing) |
| All ACTIVE triggers (9 on sot_requests, 3 on intake) | Must not disable |
| `sot_people`, `sot_cats`, `places`, `sot_requests` | SoT handles per INV-3 |

---

## DOC_001: Documentation Reassessment Pass

**Status:** Done
**ACTIVE Impact:** No — documentation only
**Scope:** Inventory all docs, classify, create missing guides, archive deprecated docs.

### Documentation Inventory (2026-01-29)

| Metric | Count |
|--------|-------|
| Total markdown files in docs/ | 82 |
| Current (actively referenced) | 76 |
| Deprecated (moved to archive) | 5 |
| Conflicting (noted for future) | 3 |
| Key gaps identified | 3 |

### Created Documents

| File | Audience | Contents |
|------|----------|----------|
| `docs/ATLAS_OPERATOR_GUIDE.md` | Staff | Phone intake, intake queue, request lifecycle, journal, search, trapper types, common fixes |
| `docs/ATLAS_ENGINEERING_GUIDE.md` | Engineers | 7-layer architecture, entity creation, data zones, active flow call graphs, migrations, pipeline, Data Engine, orchestrator, Beacon, debugging |

### Archived Documents (moved to docs/archive/)

| File | Reason |
|------|--------|
| `AUDIT_DATA_ATTRIBUTION_ISSUES.md` | One-time audit snapshot (2026-01-17), superseded by TASK_LEDGER data hygiene plan |
| `AUDIT_DATA_INTEGRITY_REPORT.md` | One-time audit snapshot (2026-01-17), superseded by orchestrator health views |
| `AUDIT_PLACE_CONSOLIDATION_ISSUE.md` | One-time audit snapshot (2026-01-17), issue documented in TASK_LEDGER |
| `HANDOFF_SUMMARY.md` | Superseded by ATLAS_NORTH_STAR.md + ATLAS_MISSION_CONTRACT.md |
| `TIPPY_TEST_REPORT.md` | One-time test snapshot (2026-01-18), fixes implemented |

### Identified Gaps (Future Work)

| Gap | Priority | Notes |
|-----|----------|-------|
| No journal system docs | Low | Journal API is straightforward; OPERATOR_GUIDE now covers staff usage |
| No intake triage scoring docs | Medium | `compute_intake_triage()` logic should be documented for transparency |
| No colony management docs | Low | Colony system (MIG_610) is SEMI-ACTIVE; document when UI ships |

### Conflicts Noted

| Issue | Location | Resolution |
|-------|----------|------------|
| Attribution window mismatch | `ATLAS_MISSION_CONTRACT.md` says "±6 months" but actual code uses rolling windows | Mission Contract needs update (non-breaking, docs-only) |
| `entity_type` proposal status unknown | `ADDING_DATA_SOURCES.md` proposes `entity_type` enum | Enum was not added; doc should be updated |
| Place consolidation issue unresolved | `AUDIT_PLACE_CONSOLIDATION_ISSUE.md` flagged but no fix applied | Archived; tracked in Data Hygiene category C/D |

### Stop Point

Guides created. Deprecated docs archived. Gaps and conflicts documented. Proceed to Phase 3.

---

## SC_001: Surgical Change — Surface Data Quality in Request List

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — modifies `v_request_list` view (read by dashboard + request list page) and `GET /api/requests` response
**Scope:** Add live trapper assignment count and data quality indicators to the ACTIVE request list.
**Migration:** `sql/schema/sot/MIG_779__request_list_data_quality.sql`

### Why This Change

After completing ORCH_003 (data health views), staff can see data quality issues via direct SQL but NOT through the ACTIVE UI. The request list is the primary staff workflow surface — surfacing quality flags here closes the loop between diagnosis and action.

### ACTIVE Surfaces Touched

| Object | Type | Operation | Safety |
|--------|------|-----------|--------|
| `v_request_list` | View | CREATE OR REPLACE (additive columns only) | All 30 existing columns preserved in same order |
| `GET /api/requests` | Endpoint | Additive response fields | Existing fields unchanged, 3 new fields added |
| `RequestListRow` | TS Interface | Extended | New optional fields only |

### Two Options Proposed

#### Option A: Zero-Breaking (SQL Only)

- Add 3 new columns to `v_request_list` via `CREATE OR REPLACE VIEW`
- API response unchanged — new columns exist in SQL only
- Staff can query via Tippy or admin SQL tools
- **Risk:** Zero. API doesn't read new columns.
- **Value:** Low-medium. Only SQL-literate users benefit.

#### Option B: Minimal-Breaking with API Shim (Chosen)

- Add 3 new columns to `v_request_list` via `CREATE OR REPLACE VIEW`
- Update `GET /api/requests` to include the 3 new fields in response
- Extend `RequestListRow` TypeScript interface (additive)
- **Risk:** Minimal. API adds fields, never removes — per Safety Gate rules.
- **Value:** High. Staff sees data quality in request list UI.

### New Columns

| Column | Type | Source | Purpose |
|--------|------|--------|---------|
| `active_trapper_count` | INTEGER | LEFT JOIN `request_trapper_assignments` | Live count of assigned trappers (0 = needs assignment) |
| `place_has_location` | BOOLEAN | `places.location IS NOT NULL` | Whether place appears on Beacon map |
| `data_quality_flags` | TEXT[] | Computed | Array of flags: `no_trapper`, `no_geometry`, `stale_30d`, `no_requester` |

### Implementation (Option B Chosen)

**Migration:** `sql/schema/sot/MIG_779__request_list_data_quality.sql`
**API:** `apps/web/src/app/api/requests/route.ts` — added 3 fields to SELECT + interface
**UI:** `apps/web/src/app/requests/page.tsx` — Request interface extended, `DataQualityFlags` component renders flag badges in both card and table views

### Validation Evidence (2026-01-29)

- [x] **Column count:** 30 → 33 (3 new, all 30 original preserved)
- [x] **Row count unchanged:** 285 before and after
- [x] **New columns populated:**
  ```
  active_trapper_count | bigint
  place_has_location   | boolean
  data_quality_flags   | ARRAY
  ```
- [x] **Data quality flags surfaced:**
  ```
  no_trapper:   42 active requests
  no_requester:  1 active request
  no_geometry:   0 (all places have geometry)
  stale_30d:     0 (no stale requests)
  ```
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     1
  ```
- [x] **Original columns spot-checked:** request_id, status, priority, place_address, requester_name, linked_cat_count, days_since_activity, is_legacy_request — all present and correct
- [x] **API updated:** RequestListRow interface extended, SELECT includes new columns

### Rollback

```sql
-- Recreate original view (without data quality columns)
CREATE OR REPLACE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::text AS status,
    r.priority::text AS priority,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::text AS assigned_trapper_type,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::text AS hold_reason,
    r.resolved_at,
    r.place_id,
    CASE
        WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
         AND lower(TRIM(BOTH FROM p.display_name)) = lower(TRIM(BOTH FROM per.display_name))
        THEN COALESCE(split_part(p.formatted_address, ',', 1), p.formatted_address)
        ELSE COALESCE(p.display_name, split_part(p.formatted_address, ',', 1))
    END AS place_name,
    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    r.requester_person_id,
    per.display_name AS requester_name,
    COALESCE(per.primary_email, (
        SELECT pi.id_value_raw FROM trapper.person_identifiers pi
        WHERE pi.person_id = per.person_id AND pi.id_type = 'email'
        ORDER BY pi.created_at DESC LIMIT 1
    )) AS requester_email,
    COALESCE(per.primary_phone, (
        SELECT pi.id_value_raw FROM trapper.person_identifiers pi
        WHERE pi.person_id = per.person_id AND pi.id_type = 'phone'
        ORDER BY pi.created_at DESC LIMIT 1
    )) AS requester_phone,
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::integer AS days_since_activity,
    (r.source_system = 'airtable') AS is_legacy_request
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;
```

### Stop Point

Surgical change complete. v_request_list now surfaces data quality. API returns new fields. All Safety Gate checks pass.

---

## SC_002: Surgical Change — Trapper Assignment Visibility in Request List

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — modifies `v_request_list` view, `GET /api/requests` response, `sot_requests` data fix
**Scope:** Surface trapper assignment status in request list so staff can quickly see who needs a trapper vs who is client-trapping. Fix 24 Airtable requests missing `no_trapper_reason`.
**Migration:** `sql/schema/sot/MIG_785__trapper_visibility_request_list.sql`

### Why This Change

Staff need to quickly identify which requests need a trapper assigned. Previously, the `no_trapper` flag didn't distinguish between:
- Requests that genuinely need a trapper (action required)
- Requests where the client is trapping themselves (no action needed)

Additionally, 24 Airtable requests had "Client Trapping" as their trapper assignment (Airtable record `recEp51Dwdei6cN2F`) but `no_trapper_reason` was never set during the sync. This caused them to appear as "needs trapper" when they shouldn't.

### Data Alignment Fix

Airtable raw data shows 34 requests referencing the client_trapping pseudo-record:
- **24 with ONLY client_trapping** (no real trapper) — these needed `no_trapper_reason = 'client_trapping'`
- **10 with client_trapping + real trappers** — already have active trappers, no fix needed

After fix: 24 requests now correctly marked as `client_trapping`.

### ACTIVE Surfaces Touched

| Object | Type | Operation | Safety |
|--------|------|-----------|--------|
| `sot_requests` | Table | UPDATE (24 rows: set no_trapper_reason) | Data correction only, no schema change |
| `v_request_list` | View | CREATE OR REPLACE (additive columns only) | All 33 existing columns preserved in same order |
| `GET /api/requests` | Endpoint | Additive response fields + new filter param | Existing fields unchanged, 2 new fields + 1 filter |
| `RequestListRow` | TS Interface | Extended | New optional fields only |
| Request list UI | Page | New filter dropdown + trapper column | Additive UI only |

### New Columns (v_request_list)

| Column | Type | Source | Purpose |
|--------|------|--------|---------|
| `no_trapper_reason` | TEXT | `sot_requests.no_trapper_reason` | Why no trapper: client_trapping, not_needed, etc. |
| `primary_trapper_name` | TEXT | `request_trapper_assignments` + `sot_people` | Name of primary or first assigned trapper |

### Improved data_quality_flags

| Flag | Old Behavior | New Behavior |
|------|-------------|--------------|
| `no_trapper` | Any active request with 0 trappers | Only when 0 trappers AND `no_trapper_reason IS NULL` |
| `client_trapping` | (did not exist) | Shows when `no_trapper_reason = 'client_trapping'` |

### New API Filter: `trapper`

| Value | Behavior |
|-------|----------|
| `has_trapper` | `active_trapper_count > 0` |
| `needs_trapper` | `active_trapper_count = 0 AND no_trapper_reason IS NULL` |
| `client_trapping` | `no_trapper_reason = 'client_trapping'` |

### UI Changes

1. **Trapper filter dropdown** — "All trappers", "Has trapper", "Needs trapper", "Client trapping"
2. **Trapper column in table view** — Shows primary trapper name, "+N" for additional trappers, "Client" for client_trapping
3. **Trapper name on cards** — Shows "Trapper: Name" on card view when assigned
4. **Updated flag colors** — `no_trapper` renamed to "Needs trapper" (yellow), new `client_trapping` flag (green)

### Validation Evidence (2026-01-29)

- [x] **24 client_trapping requests fixed** (UPDATE 24, all from Airtable staged data)
- [x] **Column count:** 33 → 35 (2 new, all 33 original preserved)
- [x] **Row count unchanged:** 285 before and after
- [x] **New columns populated:**
  ```
  no_trapper_reason    | text
  primary_trapper_name | text
  ```
- [x] **Data quality flags improved:**
  ```
  no_trapper:      33 active requests (was 42 — 9 were client_trapping)
  client_trapping:  9 active requests (new flag)
  no_requester:     1 active request
  ```
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     2
  ```
- [x] **Original columns spot-checked:** request_id, status, priority, place_address, requester_name, linked_cat_count, days_since_activity, is_legacy_request — all present and correct
- [x] **API updated:** RequestListRow interface extended, SELECT includes new columns, trapper filter param added
- [x] **UI updated:** Trapper filter dropdown, trapper column in table, trapper name on cards, improved flag labels/colors
- [x] **TypeScript compiles** (no errors in modified files)

### Rollback

```sql
-- 1. Revert data fix
UPDATE trapper.sot_requests
SET no_trapper_reason = NULL, updated_at = NOW()
WHERE no_trapper_reason = 'client_trapping';

-- 2. Recreate view from MIG_779 (SC_001 version)
-- Copy the CREATE OR REPLACE VIEW from MIG_779__request_list_data_quality.sql
```

### Stop Point

Trapper visibility complete. Staff can now filter requests by trapper status and see assigned trapper names. Client-trapping requests no longer show as "needs trapper". All Safety Gate checks pass.

---

## SC_003: Surgical Change — Fix Trapper Assignment Data Gaps

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — inserts into `request_trapper_assignments` (ACTIVE table)
**Scope:** Fix 6 Airtable requests missing trapper assignments in Atlas due to duplicate person_roles.
**Migration:** `sql/schema/sot/MIG_787__fix_trapper_assignment_gaps.sql`

### Why This Change

After SC_002 added trapper visibility to the request list, an audit revealed 6 Airtable requests that had trappers assigned in Airtable but no corresponding records in `request_trapper_assignments`. Root cause: 2 Airtable trapper record IDs each mapped to 2 different Atlas people, causing the sync script to fail silently.

### Root Cause: Duplicate person_roles

| Airtable ID | Airtable Name | Atlas Person 1 | Atlas Person 2 | Issue |
|-------------|---------------|-----------------|-----------------|-------|
| rec86C4vN4RyuWNSA | Carl Draper | Patricia Elder (7072927680) | Carl Draper (7072927680) | Same phone, different names. Airtable record renamed from Elder → Draper |
| rec8yiEVxuSxlz9ab | Patricia Dias | Pat Dias (no phone) | Patricia Dias (7076942643) | Name variant "Pat" vs "Patricia". Pat created first, Patricia added later with phone |

### What Changed

1. **Removed 2 duplicate person_roles** — kept the canonical person for each Airtable ID (Carl Draper, Patricia Dias)
2. **Created 6 missing request_trapper_assignments** — 3 active (in_progress) + 3 completed requests

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `person_roles` | Table | DELETE (2 stale rows) | Semi-Active |
| `request_trapper_assignments` | Table | INSERT (6 rows via `assign_trapper_to_request()`) | Yes (request detail reads) |

### Pre-Fix State

| Metric | Count |
|--------|-------|
| Active assignments | 205 |
| Airtable requests with trappers | 174 |
| Atlas requests with assignments | 168 |
| **Missing from Atlas** | **6** |

### Post-Fix State

| Metric | Count |
|--------|-------|
| Active assignments | 211 (+6) |
| Airtable requests with trappers | 174 |
| Atlas requests with assignments | 174 |
| **Missing from Atlas** | **0** |

### Assignment State Breakdown (Post-Fix)

| State | Count |
|-------|-------|
| has_active_trapper | 178 |
| resolved_no_trapper | 52 |
| needs_trapper | 31 |
| client_trapping | 24 |

### Validation Evidence (2026-01-29)

- [x] **Active assignments:** 205 → 211 (+6)
- [x] **Missing Airtable assignments:** 6 → 0
- [x] **All 6 new assignments verified:** Correct trapper names, is_primary=true, source_system='airtable', created_by='MIG_787'
- [x] **Duplicate person_roles cleaned:** 4 → 2 (1 per Airtable ID)
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     3
  ```

### Rollback

```sql
-- 1. Remove the 6 assignments created by MIG_787
DELETE FROM trapper.request_trapper_assignments WHERE created_by = 'MIG_787';

-- 2. Restore duplicate person_roles (optional — the duplicates were stale)
INSERT INTO trapper.person_roles (person_id, role, source_record_id, trapper_type, created_at)
VALUES
  ('a488e402-c841-4804-ac92-ea2987e23057', 'trapper', 'rec86C4vN4RyuWNSA', 'ffsc_trapper', '2026-01-13 23:56:05.600365+00'),
  ('58d3819e-87ff-4927-89bb-8e787a6ef117', 'trapper', 'rec8yiEVxuSxlz9ab', 'community_trapper', '2026-01-13 23:56:06.228451+00');
```

### Stop Point

All Airtable trapper assignments now reflected in Atlas. 0 gaps between Airtable and Atlas for trapper data. The `request_trapper_assignments` table is the verified source of truth for all trapper-request relationships. All Safety Gate checks pass.

---

## SC_004: Surgical Change — Make assignment_status a Maintained Field

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — modifies `sot_requests`, `v_request_list`, adds trigger on `request_trapper_assignments`
**Scope:** Make assignment_status a maintained lifecycle field instead of inferring trapper-need from absence of data.
**Migration:** `sql/schema/sot/MIG_788__maintain_assignment_status.sql`

### Why This Change

The Airtable pattern of inferring "needs trapper" from absence of data (no trapper = needs trapper) is fragile and doesn't distinguish between:
- Genuinely needs trapper assignment
- Client handles trapping
- Completed without a trapper
- Cancelled requests

`assignment_status` already existed as a CHECK constraint on `sot_requests` but was never set or maintained — it was NULL for all 285 requests. This migration transforms it into an explicit, maintained lifecycle field.

### What Changed

1. **Backfilled all 285 requests** from current data:
   - 178 → `assigned` (have active trapper in `request_trapper_assignments`)
   - 24 → `client_trapping` (no_trapper_reason = 'client_trapping')
   - 83 → `pending` (active requests without trapper or reason)
2. **Schema enforcement:** `NOT NULL DEFAULT 'pending'` — no more NULLs
3. **Auto-maintenance trigger** on `request_trapper_assignments`:
   - INSERT/UPDATE: if active trappers exist → `assigned`
   - DELETE/unassign: if no active trappers remain → `pending` (unless client_trapping)
4. **v_request_list updated** with `assignment_status` column
5. **API updated** — filter uses `assignment_status` directly instead of derived trapper count
6. **UI updated** — filter dropdown uses assignment_status values

### assignment_status Values

| Value | Meaning | When Set |
|-------|---------|----------|
| `pending` | Needs trapper assignment | Default for new requests; trigger sets when all trappers unassigned |
| `assigned` | Has active trapper(s) | Trigger sets on INSERT into request_trapper_assignments |
| `client_trapping` | Client handles trapping | Set via backfill from no_trapper_reason |
| `completed` | Resolved request | Set via backfill from request status |
| `cancelled` | Cancelled request | Set via backfill from request status |

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `sot_requests` | Table | UPDATE (backfill 285 rows), ALTER (NOT NULL, DEFAULT) | Yes |
| `v_request_list` | View | CREATE OR REPLACE (add assignment_status column) | Yes |
| `trg_maintain_assignment_status` | Trigger | CREATE (on request_trapper_assignments) | Yes |
| `trapper.maintain_assignment_status()` | Function | CREATE | N/A |
| `apps/web/src/app/api/requests/route.ts` | API | Modified (filter uses assignment_status) | Yes |
| `apps/web/src/app/requests/page.tsx` | UI | Modified (filter dropdown, interface) | Yes |

### Pre-Fix State

| Metric | Count |
|--------|-------|
| assignment_status = NULL | 285 (all requests) |
| "Needs trapper" determination | Derived from active_trapper_count = 0 AND no_trapper_reason IS NULL |

### Post-Fix State

| assignment_status | Count |
|-------------------|-------|
| assigned | 178 |
| pending | 83 |
| client_trapping | 24 |
| NULL | 0 (NOT NULL enforced) |

### Validation Evidence (2026-01-29)

- [x] **Backfill correct:** 178 assigned + 83 pending + 24 client_trapping = 285 (all requests)
- [x] **Schema enforced:** NOT NULL DEFAULT 'pending'
- [x] **Trigger enabled:** trg_maintain_assignment_status on request_trapper_assignments = enabled
- [x] **v_request_list column count:** 35 → 36 (+assignment_status)
- [x] **v_request_list row count:** 285 (unchanged)
- [x] **Active requests by assignment_status:**
  ```
  assigned:        84
  pending:         31
  client_trapping:  9
  ```
- [x] **Safety Gate — Views resolve:**
  ```
  v_intake_triage_queue: 742 rows
  v_request_list:        285 rows
  ```
- [x] **Safety Gate — Intake triggers enabled:**
  ```
  trg_auto_triage_intake   | enabled
  trg_intake_create_person | enabled
  trg_intake_link_place    | enabled
  ```
- [x] **Safety Gate — Request triggers enabled:**
  ```
  trg_log_request_status | enabled
  trg_request_activity   | enabled
  trg_set_resolved_at    | enabled
  ```
- [x] **Safety Gate — Journal trigger enabled:**
  ```
  trg_journal_entry_history_log | enabled
  ```
- [x] **Safety Gate — NEW trigger on request_trapper_assignments:**
  ```
  trg_maintain_assignment_status | enabled
  ```
- [x] **Safety Gate — Core tables have data:**
  ```
  web_intake_submissions: 1,174
  sot_requests:             285
  journal_entries:         1,856
  staff:                      24
  staff_sessions (active):     3
  ```

### Rollback

```sql
-- 1. Drop trigger and function
DROP TRIGGER IF EXISTS trg_maintain_assignment_status ON trapper.request_trapper_assignments;
DROP FUNCTION IF EXISTS trapper.maintain_assignment_status();

-- 2. Remove NOT NULL and default
ALTER TABLE trapper.sot_requests ALTER COLUMN assignment_status DROP NOT NULL;
ALTER TABLE trapper.sot_requests ALTER COLUMN assignment_status DROP DEFAULT;

-- 3. Set all back to NULL
UPDATE trapper.sot_requests SET assignment_status = NULL;

-- 4. Restore previous v_request_list (SC_002 version without assignment_status)
-- See MIG_785 for the previous view definition.
```

### Stop Point

`assignment_status` is now a maintained lifecycle field. Staff can filter by `pending` (needs trapper) instead of inferring from absence. The trigger automatically keeps it in sync when trappers are assigned or unassigned. All Safety Gate checks pass.

---

## DH_E: Place Deduplication — Audit & Remediation

**Created:** 2026-01-30
**Audit Source:** Full data audit of person/cat/place relationships
**ACTIVE Impact:** Yes — places table is core SoT; merges affect person_place_relationships, cat_place_relationships, sot_requests
**Root Cause:** `normalize_address()` function is too lightweight. It lowercases and abbreviates street suffixes (Road→Rd, etc.) but misses: trailing whitespace, ", USA" suffix, `", --,"` placeholder removal, period stripping, and structural format variations from different source systems (Google geocoder vs Airtable vs ClinicHQ).

### Audit Findings (2026-01-30)

| Metric | Count |
|--------|-------|
| **Total duplicate place pairs** (sim >0.7, within 100m) | **3,317** |
| **Distinct places involved** | **4,019** |
| **Relationships to relink** | **9,584** |
| **People with definite duplicate place links** | **398** |
| **People with probable duplicate place links** | **281** |
| **Cats with definite duplicate place links** | **704** |
| **Cats with probable duplicate place links** | **679** |

### Duplication Pattern Breakdown

| Pattern | Pairs | Avg Similarity | Merge Safety |
|---------|-------|---------------|--------------|
| Same after stripping special chars | 73 | 0.99 | **Auto-safe** |
| One has ", USA" suffix | 415 | 0.79 | **Safe with review** |
| Structural format difference | 2,829 | 0.81 | **Needs careful review** |

### Three Dominant Format Variations

1. **", USA" suffix**: Google geocoder appends ", USA"; Airtable/ClinicHQ don't
   - `"123 Main St, Santa Rosa, CA 95401"` vs `"123 Main St, Santa Rosa, CA 95401, USA"`
2. **Trailing whitespace**: Extra spaces in address components
   - `"200 Cranbrook Way , Santa Rosa"` vs `"200 Cranbrook Way, Santa Rosa"`
3. **Abbreviation/case/punctuation**: Mixed styles from different sources
   - `"75 Hillview Dr."` vs `"75 Hillview Dr"`, `"1523 RAEGAN WAY"` vs `"1523 Raegan Way"`

### UI Impact

The person detail API uses `DISTINCT ON (place_id)` for deduplication within a person's links, but this only deduplicates when the SAME place_id appears from multiple sources. When a person is linked to TWO DIFFERENT place records for the same physical location, the Connections tab shows **two separate place cards** — which is what staff has observed.

### Unapplied Migrations

| Migration | Status | Purpose |
|-----------|--------|---------|
| MIG_793 (`v_orphan_places`) | **Applied** ✅ | Identifies places with zero FK references (0 found) |
| MIG_794 (`relink_person_primary_address`) | **Applied** ✅ | Atomic address change operation + unlink function |

---

### DH_E001: Harden `normalize_address()` Function

**Status:** Done ✅
**ACTIVE Impact:** No — function is IMMUTABLE, existing normalized_address values recomputed
**Migration:** `MIG_799__harden_normalize_address.sql`

**Normalizations added (MIG_799):**
1. `BTRIM()` input
2. Strip `', USA'` / `', US'` / `', United States'` suffix
3. Strip em-dash city placeholder (`", —,"` → `","`) — 1,194 addresses fixed
4. Strip trailing em-dash/double-dash
5. Normalize comma-before-zip (`", CA, 95404"` → `", CA 95404"`) — 1,429 addresses fixed
6. Strip periods from abbreviations (`St.` → `St`, `P.O.` → `PO`)
7. Normalize `apartment` → `apt`, `suite` → `ste`
8. Strip comma after house number (`"1898, Cooper Rd"` → `"1898 Cooper Rd"`)
9. 7 new street suffix abbreviations (Circle, Place, Highway, Terrace, Parkway, Trail, Square)
10. 8 directional normalizations (North→N, Southeast→SE, etc.)
11. Final `LOWER()` + `BTRIM()`

**Helper functions created:**
- `extract_house_number(normalized_address)` — extracts leading house number for merge safety
- `address_safe_to_merge(addr_a, addr_b)` — validates house numbers match before allowing merge

**Result:** All 11,191 active places re-normalized. 0 uppercase remaining. 0 exact duplicates remaining.

---

### DH_E002: Auto-Merge Duplicate Places (188 pairs)

**Status:** Done ✅
**ACTIVE Impact:** Yes (Surgical) — merged places and relinked all relationships
**Migration:** `MIG_800__merge_exact_duplicate_places.sql`

**Created `merge_place_into(loser, winner)` function** that atomically:
1. Relinks ALL 30+ FK referencing tables (requests, appointments, person_place, cat_place, contexts, colonies, intake, google_map, households, life events, journals, etc.)
2. Handles unique constraint conflicts on relationship tables (ON CONFLICT: update or delete)
3. Marks loser as merged (`merged_into_place_id`, `merge_reason`)
4. Logs to `entity_edits`

**Merges executed in 3 passes:**
| Pass | Trigger | Pairs Merged |
|------|---------|-------------|
| 1 | USA suffix, periods, street suffixes | 36 |
| 2 | Em-dash city placeholder, comma-before-zip, case/directionals | 151 |
| 3 | Apartment spelling, comma-after-house-number | 1 |
| **Total** | | **188** |

**False positive guard:** `extract_house_number()` prevents merging different addresses on the same street (e.g., 6000 vs 6030 Blank Road).

---

### DH_E003: Merge USA-Suffix Duplicate Places

**Status:** Done ✅ (merged into DH_E002)
**Note:** The enhanced `normalize_address()` handles USA suffix stripping, so all USA-suffix pairs were resolved in DH_E002's merge passes without needing a separate migration.

---

### DH_E004: Review Structural Duplicate Places (~307 remaining)

**Status:** Done ✅
**ACTIVE Impact:** Yes — enhanced detection catches more duplicates, junk flagging reduces noise
**Scope:** Extended place dedup system with structural pattern detection and text-only matching.

**Changes (MIG_815):**
1. **Enhanced `normalize_address()`** — Step 5d: inverted address detection (`"valley ford rd 14495"` → `"14495 valley ford rd"`)
2. **`normalize_address_for_dedup()`** — Aggressive comparison-only normalization (strips commas, trailing state+zip, collapses whitespace)
3. **`is_junk_address` column** + `flag_junk_addresses()` function — Flags empty, too-short, "unknown"/"n/a"/"none"/"tbd" addresses
4. **Tier 4 text-only matching** — `refresh_place_dedup_candidates()` extended with text comparison for places without coordinates (dedup normalization equality OR trigram ≥ 0.85)
5. **Functional index** — `idx_places_dedup_norm` on `normalize_address_for_dedup(formatted_address)` for Tier 4 performance
6. **Re-normalize + flag + refresh** — All places re-normalized with improved function, junk addresses flagged, candidates refreshed

**API enhancements (`/api/admin/place-dedup`):**
- `refresh_candidates` POST action — calls `refresh_place_dedup_candidates()`, returns per-tier counts
- People count — `canonical_people` and `duplicate_people` in GET response
- Tier 4 label — `'Text Match Only'`
- Junk address count in GET response

**UI enhancements (`/admin/place-dedup`):**
- Tier 4 tab (cyan, "Text Match Only")
- "Refresh Candidates" button — triggers full rescan, shows per-tier counts
- People count shown per candidate pair
- Clickable address links open place detail in new tab
- Null distance handling for Tier 4 ("N/A / no coords")
- Junk address count card (red border)

**Files:** `MIG_815__structural_place_dedup.sql`, `place-dedup/route.ts`, `place-dedup/page.tsx`

---

### DH_E005: Apply MIG_793 + MIG_794

**Status:** Done ✅
**ACTIVE Impact:** No (additive)
**Note:** Applied with column name fixes (`locality` → `location`, `source_system` → `data_source`).
- `v_orphan_places` view created — 0 orphan places found
- `relink_person_primary_address()` + `unlink_person_primary_address()` functions created

---

## MAP_001: Show All Interacted Places on Map (Parallel Session)

**Status:** Done
**ACTIVE Impact:** Yes — modifies `v_map_atlas_pins` view and API limit
**Scope:** Map now shows all 11,100 interacted places (was limited to 3,000).

**Changes made:**
1. **MIG_798**: Updated `v_map_atlas_pins` to LEFT JOIN `web_intake_submissions`, added `intake_count` column, fixed stale activity flags (914 cat + 8,473 appointment flags fixed)
2. **API**: Raised LIMIT from 3,000 to 12,000 in `/api/beacon/map-data/route.ts`
3. **ORDER BY**: Improved to prioritize by pin_style (disease > watch_list > active > has_history > minimal) then by total interaction count
4. **AtlasMap.tsx**: Added `intake_count` to AtlasPin interface

**Issue Resolved:** Disease/watch_list flags initially showed 0 rows after view re-creation. Now working correctly: 39 disease pins + 117 watch_list pins (matching 40 + 118 AI-detected from google_map_entries — 1 entry each has no matching place with coordinates).

**Verification:**
- 11,100 total pins (39 disease + 117 watch_list + 8,533 active + 174 has_history + 2,237 minimal)
- 935 places with intake submissions now visible
- All pins within 12,000 LIMIT

---

## UI_001: Dashboard Redesign

**Status:** Done
**ACTIVE Impact:** Yes — replaces main landing page
**Scope:** Redesign the main dashboard as a staff-facing operations hub.
**North Star Layer:** L6 (Workflows / Surfaces)
**Spec Phase:** Phase 3 (UI_REDESIGN_SPEC.md)

**Implementation (already complete):**
- `apps/web/src/app/(dashboard)/page.tsx` — Full dashboard with greeting, needs-attention bar, quick stat pills, two-column grid (my requests + recent intake), map preview
- `apps/web/src/app/api/dashboard/stats/route.ts` — Unified stats endpoint (active_requests, pending_intake, cats_this_month, stale_requests, overdue_intake, unassigned, my_active_requests, dedup counts)
- Uses `StatusBadge` (soft variant), `PriorityDot`, `useIsMobile()` for mobile layout
- Personalized via staff_person_id from `/api/auth/me`
- Mobile: single column, map preview hidden

**Verification:** All 6 requirements met — Needs Attention panel, My Requests, Recent Intake, Map Preview, mobile layout, quick links to dedup reviews.

---

## UI_002: Filter Persistence + Mobile List Views

**Status:** Done
**ACTIVE Impact:** Yes — modifies list pages
**Scope:** Fix filter persistence and mobile card views across list pages.
**North Star Layer:** L6 (Workflows / Surfaces)

### Part A: Filter Persistence (B8) — Done
All 5 list pages now use `useUrlFilters` hook for URL param persistence:
- `/requests` — Already had `useUrlFilters` (status, trapper, q, sort, order, group, view)
- `/people` — Already had `useUrlFilters` (q, deep, page)
- `/places` — Already had `useUrlFilters` (q, kind, has_cats, page)
- `/cats` — Already had `useUrlFilters` (q, sex, altered, has_place, has_origin, partner_org, sort, page)
- `/intake/queue` — **Fixed: migrated 6 local-state filters to useUrlFilters** (tab, category, q, sort, order, group)

### Part B: Mobile Card Views (B6) — Done (already implemented)
- `/requests` — Card/table toggle + auto mobile card switch via `useIsMobile()`
- `/people`, `/places`, `/cats` — Auto-responsive via `useIsMobile()` (cards on mobile, table on desktop)
- `/intake/queue` — Cards-only layout (works on all sizes)

### Part C: Consolidate Map Pages (B13) — Done (already implemented)
- `/beacon/preview` already redirects to `/map`
- `/beacon` is a separate analytics dashboard (not a map duplicate) — kept as-is since it serves a distinct purpose (ecological stats, seasonal alerts, YoY trends)

---

## UI_003: Media Gallery Polish (Zillow-Style)

**Status:** Done
**ACTIVE Impact:** No — display-only changes
**Scope:** Upgrade MediaGallery from basic grid to Zillow-inspired hero+grid layout. Add "set as main photo" and request-place photo bridging.
**North Star Layer:** L6 (Workflows / Surfaces)
**Spec Phase:** Phase 5 (UI_REDESIGN_SPEC.md)

**Requirements:**
1. **Hero image** on place detail page — Large featured photo at top, 4-photo grid below with "+N more" overlay
2. **"Set as main photo"** action on any photo in gallery
3. **Request-place photo bridging** — Photos uploaded to a request also appear on the linked place's Media tab (read-only reference, not duplication)
4. **Mobile camera capture** — Use HTML5 `capture` attribute on file inputs for native camera access
5. **EXIF GPS extraction** — Pull lat/lng from photo metadata when available (future pin creation support)

**Results:**
- Items 1, 2, 4 already implemented: HeroGallery.tsx (hero+grid layout), /api/media/[id]/hero endpoint (set as main photo), MediaUploader.tsx has `capture` attribute for mobile camera
- Item 3 (request-place photo bridging) fixed: place media API now includes photos from requests linked to that place via `sot_requests.place_id`
- Item 5 (EXIF GPS) deferred — low priority, no immediate use case

**Touches:**
- `apps/web/src/components/MediaGallery.tsx` — Already has hero+grid layout
- `apps/web/src/app/places/[id]/page.tsx` — Hero image in Media tab (already done)
- `apps/web/src/app/api/places/[id]/media/route.ts` — Extended query to include request-linked photos

**Validation:**
- [x] Place Media tab shows hero image with grid layout
- [x] "Set as main photo" persists and shows on place list cards
- [x] Request photos appear on linked place's Media tab

---

## UI_004: Place Classification + Partner Org Profiles

**Status:** Done
**ACTIVE Impact:** Yes — extends place data model
**Scope:** Infer place types from attached records (clinic data, Airtable, ShelterLuv). Build enhanced profiles for partner orgs/businesses. Surface orphan places for review.
**North Star Layer:** L3 (Enrichment) + L5 (Source of Truth) + L6 (Workflows)
**Spec Phase:** Phase 4 (UI_REDESIGN_SPEC.md)

**Results:**

### Part A: AI Place Type Inference — Already Built
- `infer_place_contexts_from_data()` (MIG_464) handles colony_site, clinic, trapper_base, volunteer_location
- `set_place_classification()` + `assign_place_context()` (MIG_760) support organization, business, residential, multi_unit, public_space, farm_ranch types
- Classification review admin page at `/admin/classification-review` — signals, accept/dismiss, bulk actions
- `ai_extraction_rules` (MIG_758) + `entity_attributes` (MIG_710) provide extraction pipeline infrastructure
- Context types and known_org linking via `place_contexts.known_org_id` column (MIG_760)

### Part B: Enhanced Partner Org Profiles — Done
- Admin CRUD at `/admin/partner-orgs` and `/admin/partner-orgs/[id]` with stats, contact, patterns
- Partner org cats report at `/admin/partner-org-cats` with filters and CSV export
- Known organizations registry at `/admin/known-organizations` with 31+ orgs
- **NEW:** Place detail page now shows Organization Profile card when place is linked to a partner org — shows org name, type, relationship, appointment/cat stats, contact info, and link to admin detail
- **NEW:** Place API returns `partner_org` info and org-enriched context fields (`organization_name`, `known_org_id`, `known_org_name`)

### Part C: Orphan Places Admin Page — Already Built
- Fully implemented at `/admin/orphan-places` with `v_orphan_places` view (MIG_793)
- Lists, filters by source/kind, delete with safety re-check, pagination

**Touches:**
- `apps/web/src/app/api/places/[id]/route.ts` — Added partner_org query + org fields to context query
- `apps/web/src/app/places/[id]/page.tsx` — Organization Profile card in overview tab

**Validation:**
- [x] Place contexts auto-populated for places with clear signals (MIG_464 inference function)
- [x] Orphan places admin page shows unlinked places with action buttons
- [x] Partner org places show enhanced profile layout with stats and contact info

---

## UI_005: Input Validation + Cosmetic Cleanup

**Status:** Done
**ACTIVE Impact:** No — minor fixes
**Scope:** Fix remaining spec bugs: name validation, emoji cleanup, print CSS.
**North Star Layer:** L6 (Workflows / Surfaces)

**Results:**
1. **B7 (Done)**: `validatePersonName()` now returns `warning` field for ALL CAPS names. UI shows amber warning (non-blocking). Garbage patterns, trim, min 2 chars already worked.
2. **B11 (Non-issue)**: `partner-org-cats/page.tsx` has no emoji icons — all text-based labels. No change needed.
3. **B12 (Non-issue)**: BackButton uses inline styles (not a CSS class). No `back-btn` class exists anywhere. Print styles are component-scoped. No conflict.

---

## MAP_002: Pin Differentiation + Map Legend

**Status:** Done
**ACTIVE Impact:** No — map visualization only
**Scope:** Split `active` pin_style into `active` (verified cats, green) and `active_requests` (requests/intakes only, teal). Add collapsible map legend.
**North Star Layer:** L7 (Visualization)

**Migrations:** MIG_807
**Touches:** `v_map_atlas_pins` view, `map-markers.ts`, `map-data/route.ts`, `AtlasMap.tsx`, `atlas-map.css`

**Validation:**
- Green pins show cat count badge; teal pins show clipboard icon
- Legend visible at bottom-left, collapsible
- All 6 pin types distinguishable at zoom 14+

---

## MAP_003: Cluster Color Threshold (Majority-Wins)

**Status:** Done
**ACTIVE Impact:** No — map visualization only
**Scope:** Replace `markers.some()` cluster coloring with majority-wins threshold. Cluster only turns orange/purple when >50% of contained markers match. Minority disease/watch pins show small badge on blue cluster.
**North Star Layer:** L7 (Visualization)

**Touches:** `AtlasMap.tsx` iconCreateFunction

**Validation:**
- At zoom 10, clusters with 1-2 disease pins among many are blue with small orange badge
- Clusters only turn fully orange when >50% are disease pins

---

## MAP_004: Nearby People on Search

**Status:** Done
**ACTIVE Impact:** No — read-only popup enhancement
**Scope:** When searching an address and dropping a navigated-location marker, scan nearby atlas pins (~200m) and show people names in the popup.
**North Star Layer:** L7 (Visualization)

**Touches:** `AtlasMap.tsx` navigated location effect

**Validation:**
- Search an address with nearby Atlas places → popup shows "Nearby People" section
- Capped at 8 people with "+N more" overflow
- Sorted by distance

---

## MAP_005: Street View Fullscreen + Mini Map

**Status:** Done
**ACTIVE Impact:** No — map visualization only
**Scope:** Add fullscreen toggle to Street View panel. When fullscreen, map collapses to 0% and a mini Leaflet map appears in the bottom-right of the SV panel showing nearby colored dots. Escape exits fullscreen. Mini map updates position when user walks.
**North Star Layer:** L7 (Visualization)

**Touches:** `AtlasMap.tsx`, `atlas-map.css`

**Validation:**
- Click fullscreen button → SV fills screen, mini map appears
- Mini map shows colored dots matching pin styles
- Walking in SV updates mini map center
- Escape key exits fullscreen

---

## MAP_006: Search Bar Fix

**Status:** Done
**ACTIVE Impact:** No — UI fix
**Scope:** Minimize search bar to small pill button during Street View mode. Increase navigated marker z-index to 2000 so it appears above the search bar.
**North Star Layer:** L7 (Visualization)

**Touches:** `AtlasMap.tsx`

**Validation:**
- During Street View, search bar becomes small "Search" pill at top-left
- Blue navigated-location marker always visible above other UI

---

## MAP_007: System Account / Org Name Map Pollution — Root-Cause Fix

**Status:** Done
**ACTIVE Impact:** Yes — fixes ingestion pipeline to prevent future pollution
**Scope:** Root-cause fix for system accounts and org names being linked as "residents" of client addresses. The ingestion function `process_clinichq_owner_info()` blindly created `person_place_relationships` for anyone whose email/phone appeared on ClinicHQ appointments — including FFSC staff handling colony cats. Fix: reusable guard function + ingestion patch + comprehensive data cleanup.
**North Star Layer:** L2 (Identity) + L4 (Data Engine) + L7 (Visualization)

**Root Cause:** `process_clinichq_owner_info()` (MIG_574) resolved person identity via email/phone, then unconditionally INSERTed `person_place_relationships` with `role='resident'`. When FFSC staff (e.g., Sandra Nicander) were listed as contacts on appointments for colony cats, they got linked to every address they handled.

**Migrations:** MIG_806 (view filter), MIG_807 (pin_style split, includes 806 changes), MIG_808 (root-cause fix)
**Touches:** `should_link_person_to_place()` guard fn, `process_clinichq_owner_info()`, `v_map_atlas_pins`, `person_place_relationships`, `sot_people.is_system_account`

**MIG_808 Steps:**
1. Created `should_link_person_to_place(person_id)` — reusable guard blocking: `is_system_account`, `is_organization_name()`, `@forgottenfelines` emails, coordinator/head_trapper roles. Auto-flags newly-discovered system accounts.
2. Patched `process_clinichq_owner_info()` to call guard before INSERT. Appointment linking preserved.
3. Flagged all FFSC-email and org-name people as system accounts.
4. Cleaned ALL existing spurious place links for system accounts.
5. Cleaned clinichq-sourced links for active coordinator/head_trapper staff.

**Validation:**
- 605 Rohnert Park Expressway shows "Food Maxx RP" not "Sandra Nicander"
- `should_link_person_to_place()` returns FALSE for Sandra Nicander
- System accounts have zero non-office place links
- Future clinichq ingestion runs skip system accounts automatically
- Appointment linking still works (staff linked as handler, not "resident")

---

## VOL_001: VolunteerHub API Integration + Volunteer Map/Profile Enhancement

**Status:** Done
**Priority:** High
**Dependencies:** MIG_809, MIG_810, MIG_811

### Problem
- Staff/volunteer data from VolunteerHub was only ingested via manual XLSX export
- No role mapping from VH user groups to Atlas person_roles
- Volunteers not visible on map; no volunteer profile on person pages
- Trapper management split between Airtable and VolunteerHub with no reconciliation
- System accounts (staff) were appearing at client addresses on map due to ClinicHQ ingestion

### Solution

**Phase 1: SQL Schema**
- MIG_809: `volunteerhub_user_groups` table (mirrors VH group hierarchy with atlas_role mapping), `volunteerhub_group_memberships` (temporal join/leave tracking), 17 new columns on `volunteerhub_volunteers`, `sync_volunteer_group_memberships()` function, `v_volunteer_roster` view
- MIG_810: `process_volunteerhub_group_roles()` (maps VH groups → person_roles preserving manual designations like head_trapper), `cross_reference_vh_trappers_with_airtable()` reconciliation function

**Phase 2: API Sync**
- `scripts/ingest/volunteerhub_api_sync.mjs`: Full API sync with auth discovery, FormAnswer decoding for all 52 VH fields, incremental sync via LastUpdate, identity resolution, group membership tracking, role processing
- Cron endpoint: `/api/cron/volunteerhub-sync` (every 6h incremental, weekly full sync on Sundays)

**Phase 3: Map Display**
- MIG_811: Revised `v_map_atlas_pins` — people subquery returns `{name, roles[], is_staff}` JSONB objects instead of plain strings. System accounts shown only at VH-sourced addresses (real home).
- Map pins show purple star badge when staff/volunteers are at a location
- Popup displays role badges (Staff, Trapper, Foster, Caretaker, Volunteer) next to person names
- Volunteers layer expanded to include all roles (not just trappers)

**Phase 4: Person Profile**
- `VolunteerBadge` component (foster=#ec4899, caretaker=#06b6d4, volunteer=#8b5cf6, staff=#6366f1)
- `/api/people/[id]/roles` endpoint: multi-dimensional response with roles, VH groups, volunteer profile (hours, skills, availability, etc.), operational summary
- Person page: role badges in header, collapsible "Volunteer Profile" section with groups, activity stats, skills tags, availability, notes, foster stats, group history

**Phase 5: Health/Monitoring**
- `/api/health/volunteerhub`: sync status, group breakdown, trapper reconciliation, recent changes
- Health endpoint reports sync freshness ("healthy" / "stale" / "never_synced")

### Key Design Decisions
- Atlas (via VH) is source of truth for volunteer/trapper management; Airtable is reference only
- Only 2 source-derived trapper types: `ffsc_trapper` (VH "Approved Trappers"), `community_trapper` (Airtable/JotForm)
- `head_trapper`/`coordinator` are Atlas-only manual designations (Crystal is the only head_trapper)
- Staff shown on map only at VH-sourced addresses (real home), not at client addresses
- Temporal membership tracking with full join/leave history

### Results (2026-01-31)
- 1346 VH volunteers synced, 1346 matched to sot_people (100%)
- 47 user groups tracked, 1876 active group memberships
- 537 roles assigned (1299 volunteer, 95 foster, 23 trapper, 15 caretaker, 13 staff)
- 837 new sot_people created from VH, 782 places created/linked
- 9 skeleton people (name only, no contact info — awaiting enrichment)

### Bugs Found and Fixed (MIG_812 + MIG_813)
- `match_volunteerhub_volunteer()`: used `role_type` column (doesn't exist), fixed to `role`
- `person_roles` CHECK: missing `caretaker` value
- `enrich_from_volunteerhub()`: wrong payload key spacing (single vs double space), missing `is_processed = FALSE` filter, used `ended_at` instead of `valid_to`
- `entity_edits` CHECK: missing `volunteerhub_sync` in `edit_source`, missing `link`/`unlink` edit_type (function used `update`)
- `volunteerhub_volunteers.email`: was NOT NULL but some VH users have no email
- `internal_account_types`: POTL pattern (contains) false-positived on surname "Spotleson"
- `sot_people.data_source`: enum type required cast in skeleton creation function

### Verification
- [x] Run MIG_809, MIG_810, MIG_811, MIG_812, MIG_813 against database
- [x] Run `node scripts/ingest/volunteerhub_api_sync.mjs --full-sync` — 0 errors
- [x] All 1346 VH volunteers linked to sot_people
- [x] Check person profile for known volunteer: roles, groups, hours displayed
- [x] Check `/api/health/volunteerhub` for group breakdown

---

## VOL_001b: Trusted Source Skeleton Infrastructure

**Status:** Done
**Priority:** Medium
**Dependencies:** MIG_813, VOL_001

### Problem
- VH volunteers with no email/phone (9 people) were rejected by the data engine
- No mechanism to create "placeholder" people that get enriched when contact info arrives
- ClinicHQ has too many garbage entries to allow name-only creation, but VH/ShelterLuv are curated

### Solution (MIG_813)

**Trusted Source Registry:**
- `trusted_person_sources` table: VH and ShelterLuv allowed for skeleton creation, ClinicHQ blocked
- Prevents untrusted sources from creating name-only people

**Skeleton Person Lifecycle:**
1. VH volunteer with no email/phone → `create_skeleton_person()` → `sot_people` with `data_quality = 'skeleton'`, `is_canonical = false`
2. VH syncs again with email → `enrich_skeleton_people()` checks for matches
3. If email matches existing person → merge skeleton INTO existing (skeleton dissolves)
4. If email is new → promote skeleton to `data_quality = 'normal'`, add identifiers
5. If person makes a request or visits clinic → normal data engine matching by email/phone

**Enhanced match_volunteerhub_volunteer (5 strategies):**
1. Email match (confidence 1.0)
2. Phone match (confidence 0.9)
3. Data Engine fuzzy match (requires email or phone)
4. Staff name match — `is_system_account = true` exact name (confidence 0.85)
5. Skeleton creation — trusted source fallback (confidence 0.0)

**Enrichment Integration:**
- `enrich_skeleton_people()` runs as Step 5 of every VH sync
- Handles both merge (skeleton → existing) and promote (skeleton → normal) paths
- All changes logged to `entity_edits` with full audit trail

### Key Design Decision
- VH and ShelterLuv people are staff-curated: real people who signed up. Safe for name-only records.
- ClinicHQ is NOT safe: "Cat Lady", "Unknown", "Test User" entries would pollute sot_people.
- Skeletons are clearly marked (`data_quality = 'skeleton'`, `is_canonical = false`) and dissolve when real contact info arrives.

---

## DIS_001: Disease Tracking System

**Status:** Done
**Commit:** dc8ee5a
**ACTIVE Impact:** No (new feature, no active workflow changes)
**Priority:** High

### Problem
- Atlas had a single `places.disease_risk` boolean — no differentiation between FeLV, FIV, ringworm, etc.
- Map showed one orange pin for all disease types with no way to filter by disease
- No time-based decay: once flagged, a place stayed flagged forever (or until manually cleared)
- No way to override false positives or mark a site as permanently affected
- AI extraction couldn't distinguish "FeLV neg" (negative) from "FeLV+" (positive)

### Solution (MIG_814)

**Schema:**
- `disease_types` registry: Extensible lookup with short_code (1-letter), color, decay_window_months per disease. Seeded: FeLV (F), FIV (V), Ringworm (R), Heartworm (H), Panleukopenia (P)
- `place_disease_status`: Per-(place, disease) status with time decay. Statuses: confirmed_active, suspected, historical, perpetual, false_flag, cleared
- `test_type_disease_mapping`: Maps `cat_test_results` test_type + result_detail → disease_key
- `compute_place_disease_status()`: Aggregates cat test results → place flags, respects manual overrides
- `set_place_disease_override()`: Manual override with entity_edits logging
- `process_disease_extraction()`: Post-extraction hook — positive AI result → flag linked places
- `v_place_disease_summary`: One row per place with JSONB `disease_badges` array
- Updated `v_map_atlas_pins` with disease_badges and disease_count columns

**API:**
- `GET /api/places/[id]/disease-status` — All statuses for a place + available types
- `PATCH /api/places/[id]/disease-status` — Manual override (confirm, dismiss, perpetual, clear, historical)
- `GET/POST/PATCH /api/admin/disease-types` — Disease type registry CRUD
- Enhanced `GET /api/beacon/map-data` — disease_badges, disease_count, disease_filter param

**UI:**
- Map pins: Colored sub-icon badges (F/V/R/H/P) below pins, max 3 shown + overflow
- Map legend: Per-disease filter checkboxes with toggle behavior
- PlaceDetailDrawer: Per-disease colored badges replacing boolean banner
- Place detail page: DiseaseStatusSection with per-status action buttons and override controls
- Admin page: `/admin/disease-types` for CRUD on disease type registry

**Extraction:**
- Per-disease attribute definitions with polarity-aware descriptions ("FeLV neg = negative, NOT a concern")
- Sonnet escalation for disease mentions (polarity accuracy is critical)
- Post-extraction hook: positive result → auto-flag linked places as "suspected"

### Files

| File | Change |
|------|--------|
| `sql/schema/sot/MIG_814__disease_tracking_system.sql` | NEW — All schema (717 lines) |
| `apps/web/src/app/api/places/[id]/disease-status/route.ts` | NEW — GET + PATCH |
| `apps/web/src/app/api/admin/disease-types/route.ts` | NEW — CRUD |
| `apps/web/src/app/admin/disease-types/page.tsx` | NEW — Admin page |
| `apps/web/src/components/DiseaseStatusSection.tsx` | NEW — Place detail section |
| `apps/web/src/app/api/beacon/map-data/route.ts` | MOD — disease_badges + filter |
| `apps/web/src/app/api/places/[id]/map-details/route.ts` | MOD — disease badges query |
| `apps/web/src/app/places/[id]/page.tsx` | MOD — DiseaseStatusSection integration |
| `apps/web/src/components/map/PlaceDetailDrawer.tsx` | MOD — Per-disease badges |
| `apps/web/src/components/AtlasMap.tsx` | MOD — Legend + filter + badge rendering |
| `apps/web/src/lib/map-colors.ts` | MOD — Disease colors |
| `apps/web/src/lib/map-markers.ts` | MOD — Sub-icon badge SVG |
| `scripts/jobs/extract_clinic_attributes.mjs` | MOD — Disease escalation + hook |

### Activation
1. ~~Run `MIG_814__disease_tracking_system.sql` against the database~~ Done 2026-01-31
2. ~~Run `SELECT trapper.compute_place_disease_status()` to backfill from existing cat_test_results~~ Done — 87 statuses (69 FIV active, 4 FIV historical, 14 ringworm historical)
3. ~~Verify map shows disease badges on affected pins~~ Done — 69 pins with disease badges
4. Admin configures disease types at `/admin/disease-types`

### Data Audit (2026-01-31)

**Bug found and fixed:** Mapping patterns didn't match actual combo test format. See session log.

**Clinic test data (structured ground truth):**
- 2,178 total test results: 1,449 FeLV/FIV neg/neg, 286 FeLV neg/FIV pos, 407 ringworm neg, 36 ringworm pos
- Zero FeLV positives in structured test data
- 69 FIV active places, 14 ringworm historical places

**Google Maps gap (66 untracked places):**
- 78 Google Maps entries mention disease at linked places
- 44 FeLV+ mentions, 19 FIV+ mentions, 15 ringworm mentions
- Only 3 places overlap with clinic-tracked disease status
- 9 places have clinic test data — ALL results are negative (different cats/time periods)
- ~66 places have NO clinic test data — purely historical qualitative notes
- Needs AI extraction job to parse → DIS_002

---

## DIS_002: Google Maps Disease Extraction

**Status:** Done (MIG_818 + extract_google_map_disease.mjs — commit 0480408)
**ACTIVE Impact:** No (additive enrichment to Beacon/ecological data)
**Priority:** Medium
**Depends on:** DIS_001 (schema + `process_disease_extraction()` hook)

### Problem
Google Maps KMZ notes contain ~78 disease mentions across 66+ linked places that have no corresponding structured test data. These are historical staff notes (some from 2012) describing FeLV+ cats, ringworm colonies, FIV+ results, etc. — but the cats were euthanized, relocated, or recorded informally before structured clinic testing was in place.

### Current State
- `cat_test_results` covers structured tests from ~2021 onward
- Google Maps notes go back 20+ years with rich disease context
- `extract_clinic_attributes.mjs` already has disease extraction patterns + `process_disease_extraction()` hook
- Need a new job targeting `google_map_entries.original_content` instead of `sot_appointments.medical_notes`

### Approach
1. Create `scripts/jobs/extract_google_map_disease.mjs` — AI extraction job that:
   - Reads `google_map_entries` with linked places
   - Extracts disease mentions (FeLV, FIV, ringworm, panleukopenia, heartworm)
   - Distinguishes positive from negative mentions (critical: "FeLV neg" ≠ FeLV+)
   - Extracts approximate dates when available
   - Calls `process_disease_extraction()` to flag places as `suspected` (not `confirmed_active` since these are historical notes, not structured tests)
   - Uses Sonnet for all disease mentions (polarity accuracy critical)
2. Status should be `historical` (not confirmed_active) since these are old qualitative notes
3. Evidence source should be `google_maps_extraction` (not `test_result`)

### Scope
- ~78 entries to process (small batch, ~$0.04 estimated)
- ~66 new place disease statuses expected
- Mostly FeLV (44) and FIV (19) — fills the zero-FeLV gap in clinic data

### Files
| File | Change |
|------|--------|
| `scripts/jobs/extract_google_map_disease.mjs` | NEW — Extraction job |
| Possibly: minor update to `process_disease_extraction()` | MOD — Accept `historical` status parameter |

---

## MAP_008: Manual Disease Override from Map + Legend Fixes

**Status:** Done (AtlasMap legend fixes, SVG pins, keyboard shortcut — commit 0480408)
**ACTIVE Impact:** Yes — UI behavior fixes
**Priority:** High (staff workflow)

### Problem 1: Cannot manually flag disease from place detail

**Case study: Cindy Tyrrell (1505 Helman Lane, Cotati)**
- Google Maps: "09/17. S/N client. She brought in two cats one very sickly. Tested him and he was FeLV positive. We euthanized the fella."
- ClinicHQ: One appointment (2017-09-20) for "Cat 1" — no medical notes, no test results, only "Euthanasia" service item
- Current status: `disease_risk = false` — the FeLV+ result exists only in the Google Maps note
- `set_place_disease_override()` function exists but needs accessible UI for staff to use from the place detail page

**Fix:** The DiseaseStatusSection component already has override controls (confirm, dismiss, perpetual, clear, historical). Verify they work for **adding** a new disease status (not just modifying an existing one). Staff should be able to select a disease type (e.g., FeLV) and set it as historical/confirmed.

### Problem 2: Legend cannot be reopened after hiding

- Legend toggle button z-index is 800, but layer panel and search box are at z-index 1001
- When legend is closed, the small "?" toggle button may be obscured by other controls
- No keyboard shortcut exists to reopen the legend (only "L" toggles the layer panel)

**Fix:** Raise legend z-index to match other controls. Add keyboard shortcut (e.g., Shift+L).

### Problem 3: Legend shows colored dots, not actual pin images

- Current legend uses 10x10px colored circles + emoji icons (⚠️ 👁️ 🐱 etc.)
- The actual map pins are teardrop SVGs with gradient fills, shadows, and inner icons
- Visual disconnect between legend and map

**Fix:** Render small versions of the actual `createAtlasPinMarker()` SVGs in the legend instead of colored dots.

---

## VOL_002: Volunteer Approval Filtering + Applicant Pin Tier

**Status:** Done (MIG_816 — commit 0480408)
**ACTIVE Impact:** Yes — affects volunteer display on map and person roles
**Priority:** High (data accuracy)

### Problem: Non-approved VH applicants shown as volunteers

**Case study: Britteny Robinette (407 Corte Pintado, Rohnert Park)**
- VolunteerHub status: In "New Applicants - Orientation" group (UID: `91f364cb`)
- NOT in "Approved Volunteers" group (UID: `029c9184`, `is_approved_parent=true`)
- Atlas role: `volunteer` with `role_status='active'` — **wrong**
- Shows as "Volunteer" pin on map with full volunteer pin styling

**Root cause:** `match_volunteerhub_volunteer()` (MIG_812 lines 110-114) assigns `role='volunteer'` with `role_status='active'` immediately when ANY VH user is matched to a person, before group memberships are processed. This means everyone who signs up on VolunteerHub (including applicants who never get approved) gets an active volunteer role.

**Fix:**
1. `match_volunteerhub_volunteer()` should assign `role_status='pending'` initially (not 'active')
2. Only `process_volunteerhub_group_roles()` should upgrade to `role_status='active'` when the person is in any group under the `is_approved_parent=true` group
3. Map pins query should filter `role_status='active'` (already does, but roles are prematurely active)
4. Add `applicant` as a valid role or use `role_status='pending'` for applicants

**Approved Volunteers hierarchy (from VolunteerHub):**
- "Approved Volunteers" (parent, `is_approved_parent=true`) — ALL current FFSC volunteers
  - Admin/Office, Approved Adoption Counselors, Approved Barn Cat Volunteers, Approved Cat Cuddler, Approved Colony Caretakers, Approved Forever Foster, Approved Foster Parent, Approved Kennel Asst., Approved Rehabilitation/Medical Holder, Approved Spay/Neuter Clinic Volunteer, Approved Trappers, Community & Special Events Aide, Community Outreach Team Members, Cooks & Bakers, Enrichment Sessions, Fabric/Textile Volunteers, Holiday Card Crew, Laundry Angels, Pick of the Litter Volunteer (+ sub-groups), Reunification Aid, Sewing Angels, Transporter/Driver
- Other groups (NOT approved): "New Applicants - Orientation" etc.

### Secondary issue: Applicant pin should still exist (smaller)

Britteny is a real person FFSC interacted with. She shouldn't disappear from the map — she should appear as a lower-priority pin. If she later becomes an approved volunteer, the system should auto-upgrade her pin.

---

## MAP_009: Tiered Pin System (Active vs Reference)

**Status:** Done (MIG_818 + AtlasMap + map-markers — commit 0480408)
**ACTIVE Impact:** Yes — changes map visual hierarchy
**Priority:** Medium
**Depends on:** VOL_002 (applicant filtering feeds into pin tier logic)

### Problem: All points treated equally

All map pins currently use the same size/prominence regardless of data significance. Legacy Google Maps points with no cat data appear the same as active colony sites with 50+ cats. Volunteer applicants appear the same as active FFSC trappers.

### Proposed two-tier system

**Tier 1 — Active Pins (current full-size teardrop):**
- Places with cat data (cat_place_relationships)
- Places with active requests
- People with important roles: approved volunteers, staff, trappers
- Places with disease status (confirmed_active or perpetual)
- Places with colony estimates

**Tier 2 — Reference Pins (smaller, less prominent):**
- Legacy Google Maps points with no linked cat/request data
- People who only applied (VH applicants, `role_status='pending'`)
- Places with only historical context (no active data)
- Orphan places with minimal data
- Still clickable, still show details on click
- Smaller marker (e.g., `createHistoricalDotMarker()` or scaled-down teardrop)
- Lighter opacity or muted colors

**Graduation:** A reference pin automatically becomes active when:
- A cat gets linked to the place
- A request is created at the address
- The person becomes an approved volunteer
- Disease status changes to confirmed_active
- This happens naturally through the existing `pin_style` logic in `v_map_atlas_pins`

### Clustering consideration

Reference pins could use a separate cluster layer with smaller cluster icons, so they don't overwhelm the active pins visually but are still accessible when zoomed in.

### UI representation

Legend should show both tiers with their visual difference. The pin image in the legend should reflect the actual rendering.

---

## MAP_010: Google Maps Entry Mis-linking (Corte Pintado)

**Status:** Done (MIG_817 — commit 0480408)
**ACTIVE Impact:** No (data quality)
**Priority:** Low

### Problem

Google Maps entry "410 Corte Pintado" (about a mom cat + kittens, contact Vickie Sneed) is currently **unlinked** (no `linked_place_id`). Meanwhile:
- 5 duplicate place records "410 Corde Pintado" (misspelled) were created and merged into **107 Verde Ct** (wrong target — different address entirely)
- A malformed person record "410 Corde Pintado Dr." was created with an address as the person name
- Britteny Robinette's place at **407 Corte Pintado** is a separate address and should not absorb 410's data
- The Google Maps entry's nearest place is 515 Corte Naranja (30.9m away — outside 15m auto-link threshold)

### Fix
1. Create the correct place for 410 Corte Pintado, Rohnert Park via `find_or_create_place_deduped()`
2. Link the Google Maps entry to it
3. Clean up the malformed "410 Corde Pintado Dr." person record
4. Verify the 5 merged place records are correctly handled (they point to 107 Verde Ct, which is wrong)

---

## DIS_003: Combo Test Parsing Bug + Medical Notes Disease Extraction

**Status:** Done (MIG_164 fix + DB corrections — commit 424d43f)
**ACTIVE Impact:** No (data quality fix, no UI changes)
**Priority:** High (data accuracy)

### Problem 1: Combo test result enum wrong for FIV+ cats

MIG_164 parses ClinicHQ's `FeLV/FIV (SNAP test, in-house)` field with `ILIKE '%negative%'` checked first. The combo format is `"FeLV_result/FIV_result"`:
- `"Negative/Negative"` → correctly negative
- `"Negative/Positive"` (FIV+) → matches `%negative%` first → **incorrectly marked negative**

286 FIV+ combo test records had `result='negative'` in `cat_test_results`.

**Fix:** Swapped CASE order in MIG_164 to check `%positive%` first. Updated 286 existing records to `result='positive'`.

### Problem 2: Zero FeLV in structured clinic data

Investigation found this is **genuine, not a bug**:
- Raw staged data: 516 Negative/Negative + 76 Negative/Positive. Zero Positive/Negative or Positive/Positive.
- ClinicHQ's structured combo test field is never filled for FeLV+ cats — they're euthanized immediately or sent to IDEXX for confirmatory testing.
- Only 2 medical notes mention FeLV+ explicitly (Pumpkin 2025-11-12, Smoochie 2022-07-20).

### Problem 3: Disease data in medical notes unexploited

42 notes mention FeLV, 113 mention FIV+. Structured regex parsing (no AI needed) extracted:
- 2 FeLV+ cats → 3 places flagged as `suspected` (evidence_source: `computed`)
- 55 FIV+ cats → 15 new places flagged as `suspected`

### Final Disease Status Totals (168 place flags)

| Disease | Test Result | Computed | Google Maps | Total |
|---------|-----------|----------|-------------|-------|
| FeLV | 0 | 3 | 35 | 38 |
| FIV | 73 | 15 | 6 | 94 |
| Ringworm | 14 | 0 | 18 | 32 |
| Panleukopenia | 0 | 0 | 3 | 3 |
| Heartworm | 0 | 0 | 1 | 1 |

### Files
| File | Change |
|------|--------|
| `sql/schema/sot/MIG_164__extract_medical_data.sql` | MOD — Swapped CASE order |
| `scripts/jobs/extract_google_map_disease.mjs` | MOD — Bracket-counting parser, tighter prompt |

---

## MAP_008: People-First Map Search, Role Badges, Manual Linking, Tippy Context

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — `/api/search` is ACTIVE, `/api/places/[id]` is SEMI-ACTIVE
**Scope:** Make people first-class on the Atlas map with searchability, role visibility, manual linking, and Tippy awareness.
**Priority:** High

### What Changed

**Phase 1: mobile_home_space gap**
- Added `"mobile_home_space"` to `VALID_PLACE_KINDS` in place API and UI dropdown

**Phase 2: Surface person_place_role in APIs**
- `map-details` endpoint returns `role`, `is_home`, `is_manual` per person via GROUP BY aggregation
- Place detail API includes `role` in people subquery

**Phase 3: Role badges in PlaceDetailDrawer**
- Residents/owners shown first with green badges
- Associated people shown with gray role badges (e.g., "Requester", "Contact")
- Solves the Stephanie Freele pattern: "Resident" at home, "Requester" at other places

**Phase 4: Improved person search**
- MIG_855: Person subtitle shows active roles (e.g., "Staff, Trapper, Volunteer") instead of cat count
- Person coordinate lookup prefers resident/owner places
- GlobalSearch "View on Map" button for people with coordinates
- AtlasMap handles `lat`/`lng`/`highlight` URL params for deep linking from GlobalSearch

**Phase 5: Manual people-at-place management**
- New `POST/DELETE /api/places/[id]/people` endpoint
- Source_system = `atlas_ui` for manual links; only manual links deletable
- Inline add/remove UI in PlaceDetailDrawer with person search + role dropdown

**Phase 6: Tippy context enrichment**
- `tippy-map-context` event now includes `drawerOpen`, `visiblePinCount`, `lastSearchQuery`
- Tippy system prompt uses these for contextual hints

### Invariant Alignment

| Invariant | Status |
|-----------|--------|
| **INV-1** (No Data Disappears) | ✅ Manual links use INSERT, not DELETE of automated data |
| **INV-4** (Provenance) | ✅ Manual links carry `source_system = 'atlas_ui'`, logged to `entity_edits` |
| **INV-6** (Active Flows Sacred) | ✅ Additive changes only — new fields, new endpoint |
| **INV-8** (Merge-Aware) | ⚠️ VIOLATED in search_unified PLACES section — fixed in MAP_009 |

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/api/places/[id]/route.ts` | MOD — mobile_home_space + role in people subquery |
| `apps/web/src/app/api/places/[id]/map-details/route.ts` | MOD — role, is_home, is_manual via GROUP BY |
| `apps/web/src/app/places/[id]/page.tsx` | MOD — mobile_home_space in UI |
| `apps/web/src/components/map/PlaceDetailDrawer.tsx` | MOD — role badges, manual add/remove UI |
| `apps/web/src/app/api/places/[id]/people/route.ts` | NEW — POST/DELETE manual people management |
| `sql/schema/sot/MIG_855__search_person_role_subtitle.sql` | NEW — person role subtitles in search |
| `apps/web/src/components/AtlasMap.tsx` | MOD — placeholder, URL params, Tippy context |
| `apps/web/src/components/GlobalSearch.tsx` | MOD — map button for people |
| `apps/web/src/components/TippyChat.tsx` | MOD — MapContext fields |
| `apps/web/src/app/api/tippy/chat/route.ts` | MOD — context hints |
| `apps/web/src/styles/atlas-map.css` | MOD — role badge CSS |

---

## MAP_009: Search Bugs — Person 500, Merged Duplicates, Navigation

**Status:** Done
**ACTIVE Impact:** Yes (Surgical) — `/api/search` is ACTIVE
**Scope:** Three bugs in Atlas search found during MAP_008 verification.
**Priority:** Critical (person search completely broken)

### Bug 1: Person search returns 500 (CRITICAL)

**Problem:** `/api/search?q=crystal+furtado&suggestions=true` returns HTTP 500. The coordinate enrichment query (search/route.ts line 269) references `ppr.is_primary` — a column that does **not exist** on `person_place_relationships`. This causes a PostgreSQL error that crashes the entire search endpoint whenever person results are returned.

**Root Cause:** `is_primary` was likely from an older schema design. The column was never created.

**Fix:** Replaced `ppr.is_primary DESC NULLS LAST` with role-based ordering matching MIG_855's LATERAL join:
```sql
CASE ppr.role WHEN 'resident' THEN 1 WHEN 'owner' THEN 2 ELSE 3 END
```

**Impact:** Searching for any person name (Crystal Furtado, Stephanie Freele, etc.) was completely broken. Now works with correct coordinates.

**Invariant:** **INV-11** (Pipeline Functions Must Reference Actual Schema) — violated. The search API referenced a non-existent column.

### Bug 2: Merged places in search results (INV-8 violation)

**Problem:** Searching "441 Alta Ave" returns duplicate places because `search_unified()` PLACES section lacks `merged_into_place_id IS NULL` filter. Merged place records appear alongside their canonical targets.

**Fix:** Added `AND pl.merged_into_place_id IS NULL` to the PLACES WHERE clause in search_unified (MIG_855 re-applied).

**Invariant:** **INV-8** (Merge-Aware Queries) — violated. Every query returning entities must filter merged records.

### Bug 3: Map search opens new tabs (UX)

**Problem:** When map search results lack coordinates, `handleAtlasSearchSelect` calls `window.open()` to open a detail page in a **new browser tab**. This is jarring — users expect to stay on the map.

**Fix:**
- Places with coords: pan map AND open PlaceDetailDrawer
- Places without coords: open PlaceDetailDrawer (stay on map)
- People/cats without coords: navigate in same tab (not new tab)

### Verification

- Crystal Furtado: "Staff, Trapper, Volunteer" subtitle, coords (38.603, -122.858) ✅
- 441 Alta Ave: 2 results (non-merged), down from duplicates ✅
- TypeScript: 0 errors ✅

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/api/search/route.ts` | MOD — removed is_primary, use role-based ordering |
| `sql/schema/sot/MIG_855__search_person_role_subtitle.sql` | MOD — added merged_into_place_id IS NULL |
| `apps/web/src/components/AtlasMap.tsx` | MOD — drawer for places, same-tab fallback |

### Data Quality Note: 441 Alta Ave

After the merged filter fix, 441 Alta Ave still shows 2 results:
- `441 Alta Ave` (place_id: 832692fb...)
- `441 Alta Ave, Rohnert Park, CA 94928` (place_id: f1c2d642...)

These are **two genuinely separate (non-merged) place records** for the same physical address. They should be candidates for place deduplication (tracked as MAP_012_F in NORTH_STAR).

---

## Planned Future Work

### MAP_010_F: Person Detail Drawer on Map

**Status:** Planned
**Layer:** L7
**Description:** When clicking a person search result on the map, show a person detail drawer (similar to PlaceDetailDrawer) instead of navigating away. Would show: person name, roles, linked places, linked cats, contact info.

### MAP_011_F: Cat Detail Drawer on Map

**Status:** Planned
**Layer:** L7
**Description:** When clicking a cat search result on the map, show a cat detail drawer. Would show: cat name, microchip, breed, appointments, linked places/people.

### MAP_012_F: 441 Alta Ave Dedup

**Status:** Planned
**Layer:** L2
**Description:** Two non-merged place records exist for 441 Alta Ave. Run through `place_safe_to_merge()` and merge if safe. Check for similar cases where `display_name` differs from `formatted_address` for the same physical location.

---

## MAP_013: Place Linked Cats Revamp — Per-Cat Disease Pills + View All

**Status:** Done
**ACTIVE Impact:** No (read-only display change)
**Layer:** L6 (UI)

### Scope

Upgrade "Cats at Location" section in PlaceDetailDrawer:
- **Per-cat disease pills**: Each cat card shows colored disease badges (FeLV, FIV, ringworm, etc.) from `cat_test_results` via `test_type_disease_mapping` + `disease_types`. Staff can now see exactly which cat at a location tested positive.
- **10-cat truncation**: Places with >10 cats show only the first 10 (sorted by most recent visit) with a "View all X cats" link.
- **Count in header**: Section header shows total cat count.

### Touched Surfaces

| Surface | Change |
|---------|--------|
| `/api/places/[id]/map-details` (route.ts) | Added `LEFT JOIN LATERAL` on `cat_test_results` + `test_type_disease_mapping` + `disease_types` to return `positive_diseases` per cat |
| `PlaceDetailDrawer.tsx` | Disease pills in cat badge row, `.slice(0, 10)` truncation, "View all" link |
| `atlas-map.css` | `.cat-badge-disease`, `.view-all-cats-link` styles |

### Validation

- Open place with FIV+/FeLV+ cats → disease pills visible on specific cats
- Hover pill → tooltip with disease name + test date
- Place with >10 cats → truncated with "View all" link
- Place with <10 cats → no "View all" link
- No schema changes, no migrations, read-only queries

### Rollback

Revert 3 files. No schema changes.

---

## DQ_009: ClinicHQ False Resident Roles for Trappers/Staff

**Status:** Done (MIG_856)
**ACTIVE Impact:** No (data quality fix, no UI changes)
**Priority:** High (search navigation broken)

### Problem

ClinicHQ pipeline creates `person_place_relationships` with `role = 'resident'` for the owner/contact on every appointment. For trappers who bring cats from many addresses, this creates hundreds of false `resident` links:

| Person | False Resident Links | Root Cause |
|--------|---------------------|-----------|
| Sandra Nicander | 317 | FFSC org phone `7075767999` on 1,200+ appointments |
| Crystal Furtado | 36 | Active trapper, brings cats from many sites |
| Ellen Beckworth | 14 | Active trapper |
| 17 others | 4-12 each | Active trappers/volunteers |

**Sandra's case:** Not a trapper. FFSC's organizational phone `7075767999` was used as default `owner_phone` on 1,200+ clinic appointments. Pipeline matched it to Sandra via `person_identifiers` (source: volunteerhub), creating a `resident` link at every appointment address.

**Crystal's case:** Active trapper who brings cats from 36 different trapping sites. Her actual home is 441 Alta Ave (`owner` role, 0.90 confidence). Search navigated to a random trapping site (13839 Old Redwood Hwy) instead.

### Fix

1. **Blacklisted FFSC org phone** `7075767999` in `data_engine_soft_blacklist`
2. **Reclassified 347 relationships** from `resident` to `contact` for 20 people with active trapper/staff/volunteer roles and >3 clinichq resident links
3. **Kept 1 highest-confidence** link as `resident` per person (actual home)
4. **Fixed coordinate lookup** in `search_unified()` and search API to prefer:
   - Higher confidence first (0.90 owner > 0.70 resident)
   - VH/atlas_ui sources over clinichq
   - `owner` role over `resident`

### Verification

- Crystal Furtado: coords now point to 441 Alta Ave (38.338, -122.703) ✅
- Sandra Nicander: 1 resident + 316 contact (was 317 resident) ✅
- FFSC phone blacklisted ✅
- All changes audited in entity_edits ✅

### Invariant Added

**INV-12** added to NORTH_STAR: ClinicHQ relationships must not assume residency for people with active trapper/staff/volunteer roles.

### Files

| File | Change |
|------|--------|
| `sql/schema/sot/MIG_856__reclassify_trapper_clinichq_resident_roles.sql` | NEW — reclassification + blacklist |
| `sql/schema/sot/MIG_855__search_person_role_subtitle.sql` | MOD — confidence-first coordinate ordering |
| `apps/web/src/app/api/search/route.ts` | MOD — confidence-first enrichment ordering |
| `docs/ATLAS_NORTH_STAR.md` | MOD — INV-12, INV-8/11 addendums, debt items 13-14 |

---

## INGEST_001: Fix Silent Ingest Pipeline Failures

**Status:** Done
**ACTIVE Impact:** No (admin-only data ingest page, no staff workflow changes)
**Priority:** Critical (data uploads fail silently, staff can't ingest ClinicHQ data)

### Problem

Admin UI uploads via `/admin/ingest` failed silently. A ClinicHQ owner_info upload stayed stuck on "pending" and never completed. Root cause analysis found **6 bugs**:

| Bug | Severity | Root Cause |
|-----|----------|------------|
| **Missing `maxDuration`** | CRITICAL | `process/[id]/route.ts` had no `maxDuration` export. Vercel killed the lambda at 10-15s default. ClinicHQ owner_info post-processing runs `find_or_create_person()` for hundreds of owners — easily takes 30-60s. |
| **CSV parser breaks on commas** | CRITICAL | `line.split(',')` at line 29 breaks on addresses like `"123 Main St, Apt 4, Petaluma, CA"`. |
| **Unscoped post-processing** | HIGH | `runClinicHQPostProcessing()` queried ALL staged records (`source_system + source_table`), not just the current upload. Re-uploading re-processed ALL historical data. |
| **Status stuck on kill** | HIGH | Status set to 'processing' then 'completed' after work. If lambda killed, catch block never runs → status stuck as 'processing' forever. |
| **No progress UI** | MEDIUM | Single blocking `await` with no feedback. 60s+ processing looks identical to a hang. |
| **alert() errors** | LOW | Processing errors shown via `alert()` — dismissible, no detail, loses context immediately. |

### Fix

**Process endpoint (`apps/web/src/app/api/ingest/process/[id]/route.ts`):**
1. Added `export const maxDuration = 120` (2 minutes for file processing + post-processing)
2. Unified CSV and XLSX parsing through XLSX library (handles RFC 4180 quoted fields, BOM markers)
3. Changed `runClinicHQPostProcessing(sourceTable)` → `runClinicHQPostProcessing(sourceTable, uploadId)`
4. Added `AND file_upload_id = $1` with parameterized `[uploadId]` to all 9 staged_records queries
5. Added `saveProgress()` helper that writes intermediate results to `file_uploads.post_processing_results` after each step (21 steps total across cat_info/owner_info/appointment_info)
6. Set `processed_at = NOW()` when entering 'processing' state for stuck-job detection

**Admin ingest page (`apps/web/src/app/admin/ingest/page.tsx`):**
1. Replaced blocking `handleUploadAndProcess` with fire-and-forget POST + polling
2. Added 2-second polling that reads `post_processing_results` from the uploads API
3. Built floating progress overlay showing current step, completed steps with counts, and elapsed timer
4. Replaced all `alert()` calls with inline `setUploadError()` display
5. Updated `isStuck` threshold from 1 hour to 5 minutes using `processed_at`

**Cron (`apps/web/src/app/api/cron/process-uploads/route.ts`):**
1. Added stuck-job auto-reset: uploads in 'processing' for >5 minutes are auto-set to 'failed'
2. This runs before processing pending uploads, ensuring stuck jobs don't block the queue

### Post-Deployment Bugs (Round 2)

After deploying the initial fix, user uploaded cat_info (success), owner_info (success, 0 new people), and appointment_info (FAILED). Three additional bugs found:

| Bug | Severity | Root Cause |
|-----|----------|------------|
| **Staging dedup constraint violation** | CRITICAL | The pre-check query `(source_row_id = $3 OR row_hash = $4)` could match TWO different records via the `OR`. If it matched Record A by source_row_id and Record A's hash differed, the UPDATE would set A's hash to a value already used by Record B → violated `staged_records_idempotency_key` unique constraint. |
| **"Uploaded: undefined" in success message** | LOW | Upload API response returned `stored_filename` but not `original_filename`. The UI referenced `uploadResult.original_filename` which was undefined. |
| **0 new people (investigation)** | N/A — Not a bug | All owners in the upload already existed in `sot_people` (matched by email/phone via Data Engine). The metric `people_created_or_matched` conflates new and matched. User exported with date overlap, so this is expected. |

### Round 2 Fix

**Staging dedup logic (`apps/web/src/app/api/ingest/process/[id]/route.ts`):**
- Replaced single `OR` query with sequential two-step check:
  1. First check by **hash** (exact content dedup) → skip if found
  2. Then check by **source_row_id** (same logical record, different content) → safe to update since Step 1 guarantees hash is unique
  3. INSERT with `ON CONFLICT` as safety net for race conditions
- This eliminates the TOCTOU race condition where `queryOne` could return the wrong record

**Upload API response (`apps/web/src/app/api/ingest/upload/route.ts`):**
- Added `original_filename: file.name` to the JSON response so the UI can display it

### Upload Independence

Verified all three upload types (cat_info, owner_info, appointment_info) are independent:
- Each creates its own entities without requiring the others
- Cross-linking steps (e.g., owner_info linking people to appointments) gracefully produce 0 links if the other data hasn't been processed yet
- No upload will fail due to ordering

### Verification

- [x] Upload a ClinicHQ owner_info XLSX — shows progress overlay with step-by-step results
- [ ] Upload a ClinicHQ appointment_info export — should succeed (constraint violation fixed)
- [ ] Upload a CSV with commas in addresses — should parse correctly
- [x] Processing completes within 120s (scoped to current upload only)
- [x] Cron auto-resets stuck uploads after 5 minutes
- [x] Errors shown inline, not via alert()
- [ ] Retry a failed upload — should work
- [ ] Success message shows actual filename (not "undefined")

### Invariant Added

**INV-13** added to NORTH_STAR: Ingest pipeline must be resilient to serverless timeouts. All processing routes must export `maxDuration`, scope to `file_upload_id`, save intermediate progress, and never block the UI.

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/api/ingest/process/[id]/route.ts` | MOD — maxDuration, XLSX CSV parser, upload-scoped queries, saveProgress, dedup fix (Round 2) |
| `apps/web/src/app/admin/ingest/page.tsx` | MOD — polling UI, progress overlay, inline errors, isStuck fix |
| `apps/web/src/app/api/ingest/upload/route.ts` | MOD — added original_filename to response (Round 2) |
| `apps/web/src/app/api/cron/process-uploads/route.ts` | MOD — stuck-job auto-reset before processing |
| `docs/ATLAS_NORTH_STAR.md` | MOD — INV-13, debt item 15, MAP_010_F/011_F done |
| `docs/TASK_LEDGER.md` | MOD — INGEST_001 task card |

### Round 3: Inline Enrichment + Entity Linking Audit

After Round 2 deployment, user requested:
1. Enrichment (entity linking, geocoding, beacon) should run inline on ingest instead of waiting for cron
2. Full audit of cat-to-request attribution window linking

#### Inline Enrichment (committed ed03247, 2f07c87)

Added enrichment section at end of `runClinicHQPostProcessing()`:
- **Entity linking**: Calls `link_appointments_to_owners()`, `run_cat_place_linking()`, `run_appointment_trapper_linking()` individually
- **Cat→place via appointment person**: Direct INSERT for broader coverage
- **Cat→request second pass**: `link_cats_to_requests_safe()` after entity linking (see ordering fix below)
- **Geocoding**: Fire-and-forget HTTP to `/api/cron/geocode`
- **Beacon birth events**: Lactating appointment → birth event (appointment_date - 42 days)
- **Beacon mortality events**: Euthanasia/death notes → mortality event + deceased flag
- Bumped `maxDuration` from 120 → 180

#### Issues Discovered

| Issue | Severity | Root Cause | Impact |
|-------|----------|------------|--------|
| **`run_all_entity_linking()` broken** | CRITICAL | Called `link_appointments_to_partner_orgs()` which does not exist. Correct function: `link_all_appointments_to_partner_orgs()`. | Entity-linking cron silently failing for unknown period. **6,124 cat-place relationships backlogged**, 9,506 appointment places never inferred. |
| **Cat-request linking ordering** | HIGH | Cat-to-request linking (appointment_info post-processing) runs BEFORE entity linking creates cat→place relationships. Cats without prior place links are missed. | Only 15 cats linked during ingest; 96 more were linkable after entity linking ran. |
| **`link_clinic_cats_to_places()` constraint assumption** | MEDIUM | Uses `ON CONFLICT (cat_id, place_id) DO NOTHING` but no such unique constraint exists on `cat_place_relationships`. | Replaced with `NOT EXISTS` subquery in inline enrichment. |

#### Fixes Applied

1. **Inline enrichment uses individual function calls** instead of broken `run_all_entity_linking()` wrapper (committed 2f07c87)
2. **Second-pass cat-request linking** added after entity linking in enrichment section — catches newly-placed cats the first pass missed
3. **`run_all_entity_linking()` fixed in database** — replaced broken reference, added BEGIN/EXCEPTION fault tolerance. Migration: `MIG_858__fix_run_all_entity_linking.sql`

#### Data Recovery (manual, run against production)

| Operation | Result |
|-----------|--------|
| `link_appointments_to_owners()` | 140 appointments updated, 15 new people, 19 linked |
| `run_cat_place_linking()` | 0 (already done) |
| `run_appointment_trapper_linking()` | 10 linked |
| Cat-place via appointment person | 6,124 relationships created for 1,325 places |
| Infer appointment places | 9,506 appointments got place_id |
| `link_cats_to_requests_safe()` | 96 cats linked to requests |
| Birth events | 0 new (all caught by previous runs) |
| Mortality events | 0 new |

#### Files (Round 3)

| File | Change |
|------|--------|
| `apps/web/src/app/api/ingest/process/[id]/route.ts` | MOD — inline enrichment, second-pass cat-request linking, maxDuration 180 |
| `sql/schema/sot/MIG_858__fix_run_all_entity_linking.sql` | NEW — fix broken function reference + fault tolerance |
| `docs/TASK_LEDGER.md` | MOD — Round 3 findings |

---

## JOURNAL_001: Staff Attribution Bug + Communication Logging + Person Page Restructure

**Status:** Done
**ACTIVE Impact:** Yes — Journal input on all entity detail pages (person, cat, place, request)
**Scope:** JournalSection component, Person page, Request page, ActivityTab

### Bugs Found

| Bug | Page | Severity | Description |
|-----|------|----------|-------------|
| Missing staff auto-fill | `people/[id]` | Medium | JournalSection not passed `currentStaffId`/`currentStaffName`. Staff must manually pick from dropdown every time. |
| Missing staff auto-fill | `cats/[id]` | Medium | Same — no session info passed to JournalSection. |
| Missing staff auto-fill | `places/[id]` | Medium | Same — no session info passed to JournalSection. |
| Request page works | `requests/[id]` | N/A | Only page that correctly fetched `/api/auth/me` and passed props. Reference implementation. |

**Root cause:** JournalSection required parents to manually fetch `/api/auth/me` and pass `currentStaffId`/`currentStaffName` props. 3 of 4 consuming pages never did this. The request page had it because it was added later for modal auto-fill, and the pattern was never propagated.

### Fix: Self-Resolving Staff

JournalSection now calls `useCurrentUser()` hook internally (5-min module-level cache at `src/hooks/useCurrentUser.ts`). All pages fixed simultaneously without touching page code. Props still work as override for backward compatibility.

### Enhancement: Communication Logging

JournalSection enhanced with Note/Communication mode toggle. Communication mode exposes:
- **Contact method**: Phone Call, Text/SMS, Email, Voicemail, In Person, Mail, Online Form
- **Contact result**: Answered/Spoke, No Answer, Left Voicemail, Sent, Scheduled, No Response, Bounced, Other

Sets `entry_kind = 'contact_attempt'` and sends `contact_method` + `contact_result` to API. No schema or API changes needed — these columns and enum values already existed (MIG_276).

Communication entries display with color-coded method/result badges (green for answered, red for no answer/bounced).

### Enhancement: Person Page Journal Tab

Journal promoted from buried position in Activity tab (3rd section, behind Requests and Submissions) to its own top-level tab (2nd position). Tab order:

`Overview | Journal (badge) | Connections | History (badge) | Data`

Former "Activity" tab split into "Journal" and "History" (requests + submissions).

### Enhancement: Request Page Cleanup

Replaced manual `useEffect` + `useState` for `/api/auth/me` with `useCurrentUser()` hook. Staff info still available for modals (LogSiteVisit, CompleteRequest, HoldRequest, CreateColony). Removed staff prop drilling through ActivityTab.

### Files

| File | Change |
|------|--------|
| `apps/web/src/components/JournalSection.tsx` | MOD — useCurrentUser hook, communication mode UI, contact display badges |
| `apps/web/src/app/people/[id]/page.tsx` | MOD — Split Activity into Journal + History tabs |
| `apps/web/src/app/requests/[id]/page.tsx` | MOD — Replace manual auth fetch with useCurrentUser hook |
| `apps/web/src/app/requests/[id]/tabs/ActivityTab.tsx` | MOD — Remove staff prop drilling |
| `docs/TASK_LEDGER.md` | MOD — JOURNAL_001 |

**Auto-fixed** (no code change needed):
- `apps/web/src/app/cats/[id]/page.tsx` — JournalSection self-resolves staff via hook
- `apps/web/src/app/places/[id]/page.tsx` — Same

---

## LINKING_002: Cat-Request Linking Race Condition (60-day Lookback)

**Status:** Done
**ACTIVE Impact:** No (entity linking pipeline, not user-facing workflows)
**Scope:** Fix `link_cats_to_requests_safe()` race condition; backfill 113 missed cat-request links system-wide.

### Investigation

**Trigger:** Thea Torgersen (person `d6bb39f1`) has 6 cats via clinic appointments, all at 543 Lakeville Cir (place `9d2ba3df`), all within her request's attribution window. Only 5 were linked to her request (`0c7979d4`). Sneakers (cat `ba984b45`, appointment 2025-11-05) was missing.

**Root Cause:** `link_cats_to_requests_safe()` has a hard 60-day lookback:
```sql
AND a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
```

This creates a **race condition** between two pipeline steps:
1. **Step 2** (`run_cat_place_linking`): Creates `cat_place_relationships` (cat → place)
2. **Step 5** (`link_cats_to_requests_safe`): Links cats to requests using those relationships

If Step 2 creates the `cat_place_relationship` **after** the appointment is >60 days old, Step 5 will never catch it because the appointment is permanently outside the lookback window.

**Sneakers timeline:**
| Date | Event |
|------|-------|
| 2025-11-05 | Sneakers' appointment |
| 2026-01-12 | 3 other cats get cat_place_relationships → linked by mig_258 |
| 2026-01-22 | Sneakers finally gets cat_place_relationship (78 days after appointment) |
| 2026-01-22 | Brownie (appt 2025-12-17, 36 days old) linked ✓ |
| 2026-01-22 | Sneakers (appt 2025-11-05, 78 days old) **NOT linked** ✗ — outside 60-day window |

**Systemic scope:** 69+ cats system-wide had missing request links due to this same race condition.

### Fix (MIG_859)

**Function fix:** Added 14-day catch-up clause for recently-created `cat_place_relationships`:
```sql
AND (
    a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
    OR cpr.created_at >= NOW() - INTERVAL '14 days'
)
```

This ensures:
- **Normal flow:** Recent appointments (last 60 days) processed as before
- **Catch-up:** Any cat whose place link was created in the last 14 days is processed regardless of appointment age
- **Ingest coverage:** When ClinicHQ data ingests and creates cat_place_relationships, the next entity linking run will catch them even if the appointment is old

**Backfill:** One-time INSERT linked **113 cats** to their correct requests that had fallen through the gap.

### Validation

- Thea Torgersen: All 6 cats now linked (was 5, Sneakers added by mig_859_backfill)
- 113 total cats backfilled system-wide
- Function now prevents future race conditions via 14-day catch-up window

### Files

| File | Change |
|------|--------|
| `sql/schema/sot/MIG_859__fix_cat_request_linking_race_condition.sql` | NEW — Function fix + backfill |
| `docs/TASK_LEDGER.md` | MOD — LINKING_002 |

---

## LINKING_003: Unified Attribution Window Rule

**Status:** Done
**ACTIVE Impact:** No (view + function change, same data pipeline)
**Scope:** Replace multi-tier attribution window (legacy_fixed, active_rolling, resolved_with_buffer) with a single unified rule.

### Rule

A cat is linked to a request if its appointment was:
1. **Within 6 months of request creation**, OR
2. **While the request was still active** (not closed/complete)

```
Active request:   source_created_at → now (open-ended)
Resolved request: source_created_at → GREATEST(source_created_at + 6 months, resolved_at)
Redirected:       source_created_at → redirect_at
```

### Previous Logic (Replaced)

| Window Type | Old Logic |
|-------------|-----------|
| `legacy_fixed` | source_created_at + 6 months (pre-May 2025 requests) |
| `resolved_with_buffer` | resolved_at + 3 months |
| `active_rolling` | GREATEST(last_activity_at + 6m, NOW() + 3m) |

The old system had 5 tiers with special cases for legacy vs modern requests. The new system has one rule that applies uniformly to all requests.

### Changes (MIG_860)

1. **`link_cats_to_requests_safe()`**: Attribution window logic replaced with unified rule. Performance guard (60-day + 14-day catch-up from MIG_859) preserved.
2. **`v_request_alteration_stats`**: View recreated with simplified window_start/window_end. Window types reduced to: `active`, `resolved`, `redirected_closed`, `handoff_closed`, `redirect_child`, `handoff_child`.
3. **`AlterationStatsCard.tsx`**: UI badge updated for new window types (Active/Resolved instead of Rolling/Closed/Legacy).
4. **`CLAUDE.md`**: Attribution window documentation updated to reflect unified rule.

### Validation

- 0 additional cats backfilled (MIG_859 already caught everything)
- Window type distribution: 124 active, 151 resolved, 2 handoff
- Thea Torgersen's request unchanged: all 6 cats still linked, 4 TNR alterations at 100%

### Files

| File | Change |
|------|--------|
| `sql/schema/sot/MIG_860__unified_attribution_window.sql` | NEW — Unified function + view + backfill |
| `apps/web/src/components/AlterationStatsCard.tsx` | MOD — New window type names |
| `CLAUDE.md` | MOD — Attribution window docs |
| `docs/TASK_LEDGER.md` | MOD — LINKING_003 |

---

## UI_CAT_001: Cat Card Edit/Display Fixes

**Status:** Done
**ACTIVE Impact:** Yes — Cat detail page (read + edit mode)
**Scope:** Fix broken PATCH API column mappings, sex case normalization, altered status logic, add breed field.

### Problem

Cat detail page had 4 bugs:
1. **PATCH API 500 error** — `SELECT name, is_eartipped, color_pattern` referenced nonexistent columns in `sot_cats`. Correct: `display_name`, `altered_status`, `primary_color`. Also cast to nonexistent `::trapper.cat_sex` enum.
2. **Sex "Unknown" for known cats** — DB stores "Male"/"Female" (capitalized), dropdown uses "male"/"female" (lowercase). No match → "Unknown".
3. **Altered status "Unknown" for 95% of records** — Checked `=== "Yes"` but 95% of records have "spayed"/"neutered".
4. **Color empty in edit form** — Read from `cat.coat_pattern` (NULL in `v_cat_detail`) instead of `cat.color` (mapped from `primary_color`).

### Changes

1. **PATCH API**: Remapped column names, removed enum cast, added breed support, fixed RETURNING clause
2. **Edit form init**: Normalize sex to lowercase, check altered_status against ["yes","spayed","neutered"], use `cat.color`, add breed
3. **Read mode**: Altered status shows "Yes — Spayed" / "Yes — Neutered", handles "intact" as "No"
4. **Edit form UI**: Added breed input field

### Validation

- `tsc --noEmit` passes
- DB values verified: Male (17,591), Female (15,445), spayed (17,276), neutered (15,538)

### Files

| File | Change |
|------|--------|
| `apps/web/src/app/api/cats/[id]/route.ts` | MOD — PATCH column names, removed enum cast, added breed |
| `apps/web/src/app/cats/[id]/page.tsx` | MOD — Edit form init, sex normalization, altered status, breed field |
| `apps/web/src/app/api/media/upload/route.ts` | MOD — Added missing `person` to entity type Records |
| `docs/TIPPY_DATA_QUALITY_REFERENCE.md` | MOD — Session log entry |
| `docs/TASK_LEDGER.md` | MOD — UI_CAT_001 |

---

## DQ_CLINIC_001: ClinicHQ Post-Ingest Linkage Failures

**Status:** RESOLVED
**Reported:** 2026-02-03
**Resolved:** 2026-02-03
**Severity:** HIGH — Affected every clinic day since the pipeline gap opened

### Investigation Trigger

User reported cat 981020053830456 (clinic patient 2026-02-02) appeared as orphaned with no people connections. Investigation expanded to 4 cats, all showing identical symptoms.

### Affected Cats (Sample)

| Microchip | Cat ID | Clinic Date | Owner | Person Linked? | Person-Cat Rel? | Color? |
|-----------|--------|-------------|-------|----------------|-----------------|--------|
| 981020053830456 | `05cb110b` | 2026-01-28, 02-02 | Alina Kremer | YES (after manual run) | NO | Empty |
| 981020053821993 | `456662aa` | Recent | Unknown | After manual run | NO | Empty |
| 981020053842803 | `ffaddb55` | 2026-02-02 | Angela Novak | YES (after manual run) | NO | Empty |
| 981020053845579 | `9308c297` | 2026-02-02 | Angela Novak | YES (after manual run) | NO | Empty |

### Scale of Problem

```
Appointment linkage before manual fix:
  2026-02-02: 38 total, 10 linked (26%), 23 unlinked with email
  2026-01-29: 39 total, 10 linked (26%), 28 unlinked with email
  2026-01-28: 48 total,  8 linked (17%), 26 unlinked with email

Global: 3,614 appointments with owner_email but NULL person_id (7.6% of 47,632 total)
```

After running `process_clinichq_owner_info(NULL, 10)` manually: **3,273 persons linked, 15,168 appointments updated** in one batch.

### Root Causes Identified

#### BUG 1: `process_clinichq_owner_info` Not Running on Schedule

The function works perfectly when called manually but hadn't been running as part of the automatic processing pipeline. The cron endpoint (`/api/ingest/process`) calls `process_next_job()` which processes staged records, but `process_clinichq_owner_info` is a separate post-processing step that must be explicitly invoked after appointment data is ingested.

**Impact:** Thousands of appointments accumulated without person linkage.

#### BUG 2: `person_cat_relationships` Never Created from Appointments

Even after `process_clinichq_owner_info` links `person_id` to appointments, NO step creates `person_cat_relationships` records. The `run_all_entity_linking()` function includes `link_appointments_to_owners` (which returned 0 — redundant with owner_info processing), but has NO step to populate `person_cat_relationships` from appointments where both `person_id` and `cat_id` are set.

The function `link_appointment_to_person_cat(p_appointment_id UUID)` exists but takes a single appointment ID. There is no batch version that runs across all unlinked appointments.

**Impact:** Cats appear as orphaned with no people connections on their profile pages, even though the appointment data has both person and cat IDs.

#### BUG 3: `link_all_appointments_to_partner_orgs` Fails

Inside `run_all_entity_linking()`, the partner org linking step fails with: `column "linked" does not exist`. This may cascade and prevent subsequent linking steps from running.

#### BUG 4: Empty Color on ClinicHQ Cats (`COALESCE` Empty String Bug)

`find_or_create_cat_by_microchip()` uses:
```sql
primary_color = COALESCE(primary_color, p_primary_color)
```

If a cat is first created from appointment processing (which has NO color data), `primary_color` is set to `''` (empty string). When `cat_info` processing later calls the function WITH color data, `COALESCE` sees `''` as non-NULL and keeps it. The color parameter is silently discarded.

**Fix:** Change to `COALESCE(NULLIF(primary_color, ''), p_primary_color)` so empty strings are treated as NULL and get overwritten.

This same pattern likely affects `display_name`, `breed`, and other fields.

#### BUG 5: No Request-Cat Links for Clinic Cats

`link_cats_to_requests_safe` returned 0 during `run_all_entity_linking()`. Clinic cats are not being linked to requests even when the request's requester matches the cat's owner. This linkage is separate from person-cat relationships and drives the Cats & Evidence tab on request pages.

### Resolution

| Task | Fix | Migration/File |
|------|-----|---------------|
| DQ_CLINIC_001a | Entity-linking cron now calls `process_clinichq_cat_info` and `process_clinichq_owner_info` as catch-up before entity linking. Safety net ensures records missed by job queue are processed within 15 min. | `entity-linking/route.ts` |
| DQ_CLINIC_001b | Added Step 7 to `run_all_entity_linking()`: batch-creates `person_cat_relationships` from appointments with both `person_id` + `cat_id` set. | `MIG_862` |
| DQ_CLINIC_001c | Fixed `update_cat_with_survivorship`: color IF checks now treat empty string `''` as NULL so colors get overwritten. `v_current.primary_color IS NULL` → `(IS NULL OR = '')`. | `MIG_863` |
| DQ_CLINIC_001d | Fixed column reference in `run_all_entity_linking()` Step 4: `linked` → `appointments_linked` to match `link_all_appointments_to_partner_orgs()` return type. | `MIG_862` |
| DQ_CLINIC_001e | `process_clinichq_owner_info` had JSONB return type from MIG_574; MIG_808 tried to change to TABLE but Postgres can't change return type with CREATE OR REPLACE. Dropped old JSONB version and recreated with TABLE return type. Also added `should_link_person_to_place()` guard function. | `MIG_864` |
| DQ_CLINIC_001f | `find_or_create_cat_by_microchip` used `COALESCE(field, p_field)` — empty strings treated as non-NULL, blocking updates. Fixed all fields to use `COALESCE(NULLIF(field, ''), p_field)`. Also fixed display_name check: `'^unknown\s*\('` didn't match plain `'Unknown'`, added `OR display_name = 'Unknown'`. | `MIG_865` |
| DQ_CLINIC_001g | **Root cause of names/colors**: `process_clinichq_cat_info` read wrong JSON keys (`Patient Name`/`Color`) but ClinicHQ payload uses `Animal Name`/`Primary Color`. All 38,547 records use `Animal Name`. Fixed field mapping. Added backfill steps for primary_color (2a) and display_name (2d). Fixed IS NULL → (IS NULL OR = '') in existing backfill steps. | `MIG_866` |

**Additional fix:** `link_appointments_to_owners` batch LIMIT increased from 500 → 2000 to clear backlogs faster.

### Backfill Results (2026-02-03)

After applying MIG_862-866 and running backfill:
- **255 cat names** fixed (were "Unknown", now have real names from ClinicHQ)
- **350 primary colors** filled (were empty string, now have color data)
- **4 secondary colors** filled
- **9 person-cat relationships** created from appointment data
- All 4 originally-reported cats verified: names, colors, person relationships all correct

### Key Lesson for Future Integrations

**Critical Chain for clinic cats to appear fully linked:**
1. `process_clinichq_cat_info` — creates/updates cats from staged cat_info records
2. `process_clinichq_owner_info` — creates people, places, links people→appointments
3. `run_all_entity_linking()` — links cats→places→requests, creates person-cat relationships

The entity-linking cron is the **safety net** that catches anything the job queue missed. All three steps must run in order.

**Postgres Gotcha:** `CREATE OR REPLACE FUNCTION` cannot change return type. If a function signature changes (e.g., JSONB → TABLE), you must `DROP FUNCTION` the old version first, then `CREATE`. Otherwise the old version silently persists.

**Empty String Gotcha:** `COALESCE('', 'value')` returns `''`, not `'value'`. Always use `COALESCE(NULLIF(field, ''), fallback)` when fields might be empty strings instead of NULL.

**Field Name Gotcha:** Always verify payload JSON key names against actual staged data, not assumptions. Use `SELECT jsonb_object_keys(payload) FROM staged_records WHERE ... LIMIT 1` to inspect.

### Data Verified

- All 4 reported cats now have correct names: Clyde, Sylvia, Beep, Mui Mui
- All 4 have primary colors: Snowshoe, Grey, Tortoiseshell, Grey Tabby
- All 4 have person_cat_relationships (person_rels = 1)
- Sylvia has request_cat_links (request_links = 1)
- `altered_status` correctly set for all 4 cats (`neutered`/`spayed`)
- Pipeline verified for ongoing ingests: correct field names, NULLIF handling, catch-up cron

## DQ_002: Map Cat Count Inflation + Excessive Cat Identifiers

**Status:** READY TO RUN (migrations written, map query fixed)
**Reported:** 2026-02-03
**Severity:** MEDIUM — Display-only; no workflow data affected

### Problem

1. **Inflated map cat counts:** Some places showed 1000+ cats on the Beacon map. Real colony sizes rarely exceed 50.
2. **Excessive cat identifiers:** Some cats had 10+ identifier rows from multi-format microchip detection and un-transferred merged cat data.

### Root Causes

| Cause | Impact | Affected Queries |
|-------|--------|-----------------|
| Merged cats counted in `cat_place_relationships` | Orphaned place links inflate per-place counts | `v_map_atlas_pins`, `map-data/route.ts` (4 subqueries + summary) |
| Duplicate cat-place links (same cat, same place, different `source_table`) | Double/triple counting | All cat count queries |
| Residual `appointment_person_link` pollution from pre-MIG_590 | Cats linked to unrelated places | Places layer, TNR priority layer |
| Merged cat identifiers not transferred to canonical cat | Inflated identifier counts + orphaned data | Cat detail pages, identifier lookups |
| Low-confidence microchip format guesses alongside real chips | Noisy identifier lists | Cat profiles |

### Solution

**Migrations:**
- `MIG_868__audit_high_cat_count_places.sql` — Phase 1: diagnostic queries comparing cat_place links against appointment evidence. Phase 2: removes merged-cat links, deduplicates same-cat-same-place, cleans residual pollution. Phase 3: verification.
- `MIG_869__audit_excessive_cat_identifiers.sql` — Phase 1: identifier distribution + top cats + junk detection. Phase 2: re-points merged-cat identifiers to canonical cat, removes junk/low-confidence entries. Phase 3: verification.

**Code fixes (committed):**
- `apps/web/src/app/api/beacon/map-data/route.ts` — All 4 cat count subqueries + summary stat now `JOIN sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL`
- `sql/schema/sot/MIG_820__unify_map_pins.sql` — `v_map_atlas_pins` view's cat count subquery updated to exclude merged cats

### North Star Alignment

- **INV-1 (No Data Disappears):** Merged-cat place links removed (already orphaned). Merged-cat identifiers re-pointed to canonical cat, not deleted.
- **INV-6 (Active Flows Sacred):** No active workflow tables modified. Only computed counts and orphaned data cleaned.
- **INV-8 (Merge-Aware Queries):** This fix IS the enforcement of INV-8 — all map count queries now filter `merged_into_cat_id IS NULL`.
- **INV-4 (Provenance):** Migration includes diagnostic output for audit trail.

### Run Instructions

```bash
psql $DATABASE_URL -f sql/schema/sot/MIG_868__audit_high_cat_count_places.sql
psql $DATABASE_URL -f sql/schema/sot/MIG_869__audit_excessive_cat_identifiers.sql
```

Review Phase 1 diagnostic output before proceeding. Phase 2 runs automatically.

---

## FEAT_APPT_DETAIL: Appointment Detail Modal

**Status:** Done
**Reported:** 2026-02-03
**Severity:** UI Enhancement
**ACTIVE Impact:** No (read-only display, no workflow modifications)

### Problem

Staff could see a cat's visit history as a table (date, type, vet), but couldn't click into any appointment to see full details — vitals, health screening, FeLV/FIV results, surgery complications, post-op instructions, parasites, medical notes, or client info.

Many fields from the ClinicHQ raw payload (URI, dental disease, fleas, ear mites, body composition score, no surgery reason, etc.) were stored in `staged_records` but never surfaced in the UI.

### Solution

**Approach:** Join `sot_appointments` with `staged_records` (raw payload) by appointment number + date to display ALL available data without adding new columns.

**Files:**

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/app/api/appointments/[id]/route.ts` | NEW | Single appointment detail API — joins sot_appointments, cat_procedures, cat_vitals, sot_people, places, and staged_records |
| `apps/web/src/components/AppointmentDetailModal.tsx` | NEW | Modal with sections: Provider, Vitals, Tests, Health Observations, Parasites, Surgery, Post-Op, Medical Notes, Client Info, Services |
| `apps/web/src/app/cats/[id]/page.tsx` | MOD | Visit History table rows clickable → opens modal |

**Data sourced from raw payload (not in sot_appointments):**
- FeLV/FIV SNAP test, FeLV test
- Body Composition Score, Overweight/Underweight
- URI, Dental Disease, Ear/Eye/Skin/Mouth Issues
- Fleas, Ticks, Tapeworms, Ear Mites, Lice, Heartworm
- Cryptorchid, Pre-Scrotal, Hernia, Pyometra, Staples
- Bruising/Swelling Expected, Compress instructions, Recheck Needed
- No Surgery Reason, BMBT Test, Bradycardia Intra-Op
- Wood's Lamp Ringworm Test, Skin Scrape Test

### North Star Alignment

- **INV-1 (No Data Disappears):** Read-only display. No mutations.
- **INV-6 (Active Flows Sacred):** No workflow tables modified.
- **INV-4 (Provenance):** Raw payload displayed alongside structured data. Shows "Raw Data Unavailable" gracefully for pre-ingest appointments.

### Validation

1. Build: `next build` passes
2. API: `GET /api/appointments/{uuid}` returns structured + raw detail
3. UI: Click any visit row → modal opens with all sections
4. Graceful fallback: Old appointments without staged_records show structured data only

---

## FEAT_APPT_UNIFY: Enrich sot_appointments as Gold Standard + Visit→Appointment Rename

**Status:** Done
**ACTIVE Impact:** No (display layer and data enrichment only)
**Date:** 2026-02-03

### Problem

1. Appointment data (health screening, vitals, client info, financials) was scattered across `staged_records` payload and only assembled at query time via expensive raw payload joins.
2. The codebase inconsistently used "visit" and "appointment" terminology.
3. `AppointmentDetailModal` relied entirely on raw payload parsing instead of structured columns.

### Solution

**Part 1: MIG_870 — Enrich sot_appointments (22 new columns)**

Added columns directly to `sot_appointments` as the gold standard for clinic data:

| Category | Columns |
|----------|---------|
| Health Screening (11 booleans) | `has_uri`, `has_dental_disease`, `has_ear_issue`, `has_eye_issue`, `has_skin_issue`, `has_mouth_issue`, `has_fleas`, `has_ticks`, `has_tapeworms`, `has_ear_mites`, `has_ringworm` |
| Tests & Surgery (3 text) | `felv_fiv_result`, `body_composition_score`, `no_surgery_reason` |
| Vitals at Appointment (3) | `cat_weight_lbs`, `cat_age_years`, `cat_age_months` |
| Client Snapshot (3 text) | `client_name`, `client_address`, `ownership_type` |
| Financial (2 numeric) | `total_invoiced`, `subsidy_value` |

Backfill results:
- 45,992 records from `appointment_info` staged records
- 40,457 records from `cat_info` staged records
- 45,992 records from `owner_info` staged records

Created `v_appointment_detail` view replacing `v_consolidated_visits`.

**Part 2: MIG_871 — Ingest Pipeline Update**

- Updated `process_staged_appointment()` to populate all enriched columns on INSERT.
- Created `backfill_appointment_client_info()` for cross-export client data.
- Created `backfill_appointment_cat_vitals()` for cross-export weight/age data.

**Part 3: Visit → Appointment Rename (8+ files)**

Unified terminology across the entire codebase:

| File | Changes |
|------|---------|
| `/api/cats/[id]/route.ts` | Interfaces, properties, SQL, response keys |
| `/api/cats/route.ts` | Sort options, column aliases |
| `/api/appointments/[id]/route.ts` | Uses `v_appointment_detail`, enriched response |
| `/cats/[id]/page.tsx` | Interfaces, UI text, loop variables |
| `/cats/page.tsx` | Sort labels, column headers |
| `CatDetailDrawer.tsx` | Interfaces, state, UI text |
| `LinkedCatsSection.tsx` | Properties, labels |
| `cats/[id]/print/page.tsx` | Properties, labels |

**Part 4: AppointmentDetailModal Updated**

- Uses enriched boolean fields for Health Observations and Parasites (instead of raw string parsing).
- Displays age, body composition from enriched columns.
- Uses `felv_fiv_result` from enriched table, raw for supplementary tests.
- Added Financial section (total invoiced, subsidy value).
- Added ownership type to Client section.
- Category renamed `'Visit'` → `'Other'`.

### Files

| File | Action | Purpose |
|------|--------|---------|
| `sql/schema/sot/MIG_870__enrich_sot_appointments.sql` | NEW | 22 columns + backfill + `v_appointment_detail` view |
| `sql/schema/sot/MIG_871__ingest_enriched_appointments.sql` | NEW | Ingest pipeline + backfill functions |
| `apps/web/src/app/api/appointments/[id]/route.ts` | MOD | Enriched response via `v_appointment_detail` |
| `apps/web/src/components/AppointmentDetailModal.tsx` | MOD | Enriched booleans, age, financial, ownership |
| `apps/web/src/app/api/cats/[id]/route.ts` | MOD | Visit → Appointment rename |
| `apps/web/src/app/api/cats/route.ts` | MOD | Visit → Appointment rename |
| `apps/web/src/app/cats/[id]/page.tsx` | MOD | Visit → Appointment rename |
| `apps/web/src/app/cats/page.tsx` | MOD | Visit → Appointment rename |
| `apps/web/src/components/map/CatDetailDrawer.tsx` | MOD | Visit → Appointment rename |
| `apps/web/src/components/LinkedCatsSection.tsx` | MOD | Visit → Appointment rename |
| `apps/web/src/app/cats/[id]/print/page.tsx` | MOD | Visit → Appointment rename |

### North Star Alignment

- **INV-1 (No Data Disappears):** Enriched data is additive. Raw payload still fetched for supplementary details.
- **INV-2 (Single Source of Truth):** `sot_appointments` is now the gold standard for all clinic data. No more scattered payload parsing.
- **INV-4 (Provenance):** Enriched columns populated from same payload sources, with `source_system` and `source_record_id` intact.
- **INV-6 (Active Flows Sacred):** No workflow tables modified. Display + enrichment only.

### Validation

1. MIG_870 and MIG_871 ran successfully against production database
2. `tsc --noEmit` passes
3. No `visit_category` or `visitCategory` references remain in `apps/web/src`
4. API returns enriched fields (health screening, vitals, financial, client)
5. Modal displays structured data from enriched columns with raw fallback for extras

---

## DQ_003: Close Cat-Place Linking Gap

**Status:** In Progress
**ACTIVE Impact:** No — additive only (creates new cat_place_relationships)
**Scope:** Cats linked to people (caretaker, foster, etc.) are not linked to those people's places
**Migration:** `sql/schema/sot/MIG_870__close_cat_place_linking_gap.sql`

### Problem

Cat with microchip `981020053820871` is linked to Toni Price (caretaker) but shows "No places linked to this cat" in the UI. Toni has an address, but the pipeline never propagates person_cat → person_place → cat_place for non-owner relationships.

**Root Causes:**

| # | Cause | Impact |
|---|-------|--------|
| 1 | `link_cats_to_places()` (MIG_797) only handles `relationship_type = 'owner'` | Caretaker, foster, adopter, colony_caretaker all ignored |
| 2 | `link_cats_to_places()` not in the pipeline | `run_all_entity_linking()` never calls it — Step 2 calls `run_cat_place_linking()` (different function) |
| 3 | Step 7 creates person_cat but no Step 8 propagates | MIG_862 added person_cat creation but no cat_place follow-through |

### What Changed

1. **`link_cat_to_place()`** — Added `'person_relationship'` to allowed evidence types
2. **`link_cats_to_places()`** — Expanded from owner-only to handle 5 relationship types:
   - `owner` → `home` (high confidence)
   - `caretaker` → `residence` (medium confidence)
   - `foster` → `home` (medium confidence)
   - `adopter` → `home` (high confidence)
   - `colony_caretaker` → `colony_member` (medium confidence)
   - Excluded: `brought_in_by`, `rescuer`, `former_*` (don't imply residence)
3. **`run_all_entity_linking()`** — Added Step 8: `link_cats_to_places()` runs after Step 7 creates person_cat relationships. This is permanent — runs on every ingestion cycle.

### Touched Surfaces

| Object | Operation | ACTIVE? |
|--------|-----------|---------|
| `trapper.link_cat_to_place()` | ALTER (added evidence type) | No |
| `trapper.link_cats_to_places()` | ALTER (expanded types) | No |
| `trapper.run_all_entity_linking()` | ALTER (added Step 8) | Yes — pipeline |
| `trapper.cat_place_relationships` | INSERT (backfill) | No |

### North Star Alignment

- **INV-1 (No Data Disappears):** Additive only — creates new links, deletes nothing
- **INV-4 (Provenance):** `evidence_type = 'person_relationship'` with `person_cat_type` in JSONB detail
- **INV-6 (Active Flows Sacred):** Existing 7 pipeline steps untouched; Step 8 is additive
- **INV-8 (Merge-Aware):** All queries filter `merged_into_*_id IS NULL`
- **INV-10 (Centralized Functions):** All writes through `link_cat_to_place()` gatekeeper
- **INV-12 (No False Residency):** `brought_in_by` and `rescuer` excluded

### Validation

1. MIG_870 ran against production database
2. Specific cat (981020053820871) confirmed linked to place
3. Top places by cat count still match MIG_868 post-cleanup baseline (no pollution reintroduced)
4. Pipeline Step 8 confirmed in `run_all_entity_linking()`

---

## DQ_004: ShelterLuv Phantom Cat + Microchip Validation + Foster Home Visibility

**Date:** 2026-02-03
**Triggered by:** Investigation of "7 fosters is fishy" during DQ_003 work. Auditing ShelterLuv adopter/foster data revealed massive pollution.

### Problem

Three interrelated data quality issues:

1. **Phantom Cat "Daphne"** — ShelterLuv XLSX import created a cat with junk microchip `981020000000000` (Excel scientific notation `9.8102E+14` converted to all-zeros). This phantom accumulated 2,155 ShelterLuv Animal IDs and polluted:
   - 1,202 person_cat_relationships (1,161 fake adopter, 25 fake foster, 16 fake owner)
   - 1,331 cat_place_relationships
   - **76.9% of all SL adopter links and 86.2% of SL foster links were fake**

2. **Concatenated Microchips** — 23 cats had two microchips stuck together (30-31 chars) from SL XLSX export column corruption. No validation prevented insertion.

3. **Foster Home Invisibility** — 95 active foster parents from VolunteerHub had residential places but 0 tagged as `foster_home` context. Not queryable on map or by Tippy.

4. **v_map_atlas_pins View Fragmentation** — Multiple migrations (MIG_820, MIG_822, MIG_857) each defined the complete view. Refreshing from one overwrote features from others. Lost `needs_trapper_count` column twice.

5. **ShelterLuv Outcomes Not From API** — 6,420 SL outcome records came from XLSX imports (Jan 9 & 19), not the API cron. The API syncs animals/people/events but NOT outcomes. XLSX is the corruption source.

### Root Causes

| Issue | Root Cause | Prevention |
|-------|-----------|------------|
| Phantom cat | `find_or_create_cat_by_microchip()` only checks `LENGTH >= 9`, no format validation | INV-14: `validate_microchip()` gatekeeper |
| Concatenated chips | No max-length check on microchip ingest | INV-14: reject length > 15 |
| SL ID accumulation | 2,155 SL outcomes matched to phantom via junk microchip, each adding a `shelterluv_id` to `cat_identifiers` | INV-14: phantom can't be created |
| Foster home gap | `link_vh_volunteer_to_place()` tagged `volunteer_location` but never checked for foster role | MIG_871: role-aware tagging |
| View fragmentation | No single canonical view definition | INV-15: canonical view rule |
| XLSX corruption | Excel converts 15-digit microchips to scientific notation, concatenates columns | INV-16: use API, not XLSX |

### What Changed

1. **MIG_872:** Phantom Daphne cleanup
   - Deleted 1,331 cat_place + 1,202 person_cat + 2,156 cat_identifiers
   - Merged phantom into real Daphne (`785b8d5f`)
   - SL data now clean: 349 real adopters, 4 real fosters, 13 real owners

2. **MIG_873:** Microchip validation hardening (PENDING — to be created)
   - `validate_microchip()` gatekeeper function
   - Updated `find_or_create_cat_by_microchip()` to use it
   - Updated SL processing functions
   - Fixed 23 concatenated microchips

3. **MIG_871:** Foster home place tagging
   - Backfill: tagged 95 foster parents' residential places as `foster_home`
   - Updated `link_vh_volunteer_to_place()` to auto-tag foster_home for foster role
   - Goes forward: VH cron auto-tags new foster parents

4. **MIG_820 update:** Canonical `v_map_atlas_pins` definition
   - Merged features from MIG_820, MIG_822, MIG_857, DQ_002
   - Added comment warning against recreating from old migrations

5. **North Star updates:**
   - **INV-14:** Microchip validation required before storage
   - **INV-15:** Canonical views must not be recreated from old migrations
   - **INV-16:** ShelterLuv outcomes require API re-pull, not XLSX

### Touched Surfaces

| Object | Operation | ACTIVE? |
|--------|-----------|---------|
| `trapper.sot_cats` (phantom) | MERGE (soft-delete) | No |
| `trapper.cat_identifiers` (phantom) | DELETE (2,156 junk) | No |
| `trapper.person_cat_relationships` (phantom) | DELETE (1,202 fake) | No |
| `trapper.cat_place_relationships` (phantom) | DELETE (1,331 fake) | No |
| `trapper.cat_identifiers` (concat chips) | UPDATE (split) | No |
| `trapper.link_vh_volunteer_to_place()` | ALTER (foster tagging) | Yes — VH cron |
| `trapper.place_contexts` | INSERT (foster_home backfill) | No |
| `trapper.v_map_atlas_pins` | REPLACE (canonical) | Yes — map |

### North Star Alignment

- **INV-1 (No Data Disappears):** Phantom merged, not hard-deleted. Junk relationships were incorrect data — removal is corrective, not destructive.
- **INV-4 (Provenance):** Foster context tagged with `source_system='volunteerhub'`, rejection reasons logged by `validate_microchip()`
- **INV-6 (Active Flows Sacred):** Processing functions enhanced with validation, not replaced. VH cron gets foster tagging additively.
- **INV-8 (Merge-Aware):** Phantom merged into real cat. Foster query filters merged entities.
- **INV-10 (Centralized Functions):** `validate_microchip()` becomes single validation entry point for all microchip paths.
- **INV-12 (No False Residency):** Foster tagging only uses resident/owner place roles.
- **INV-14 (NEW):** Microchip validation required before storage.
- **INV-15 (NEW):** Canonical views must not be recreated from old migrations.
- **INV-16 (NEW):** ShelterLuv outcomes require API, not XLSX.

### Validation

1. MIG_872 ran: phantom identifiers=0, person_cat=0, cat_place=0, is_merged=TRUE
2. SL data verified: 349 adopters (71 cats, 327 people), 4 fosters (4 cats, 3 people), 13 owners
3. No map pollution: top places match MIG_868 baseline
4. MIG_871 pending: 95 foster parents' 116 places to be tagged
5. MIG_873 pending: validate_microchip() + concatenated chip fix

---

## DQ_005: Unchipped Cat Tracking (MIG_891)

**Date:** 2026-02-05
**Triggered by:** Cancer cat from 02/02/2026 euthanized without microchip — no Atlas record despite having photos, waiver with clinic day number, and ClinicHQ data. Relates to F5 from TASK_001.

### Problem

When a cat is euthanized at clinic without being microchipped (e.g., cancer cat), the ClinicHQ ingest pipeline silently drops it:
- `process_clinichq_cat_info()` filters `WHERE microchip IS NOT NULL AND LENGTH >= 9`
- `find_or_create_cat_by_microchip()` returns NULL for invalid/missing microchips
- No cat record, no appointment link, no photos — the cat vanishes

**Example:** Kirsten Silverek brought a cancer cat on 02/02/2026, euthanized without microchipping. This cat had no Atlas record despite having photos, a waiver with clinic day number, and ClinicHQ data.

### Root Cause

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Unchipped cats dropped | `process_clinichq_cat_info()` filters for valid microchips only | New function for unchipped cats |
| No identifier for dedup | Microchip is only identifier checked | Use `clinichq_animal_id` from source_row_id |
| No visibility | No UI to see unchipped cats by clinic day | Clinic Day Cat Gallery |

### What Changed

1. **MIG_891:** `process_clinichq_unchipped_cats()` function
   - Processes staged cat_info records WHERE microchip IS NULL OR empty OR < 9 chars
   - Uses existing `enrich_cat()` with `clinichq_animal_id` as identifier
   - Sets `needs_microchip = TRUE` on created cats
   - Links cats to appointments via `appointment_number`
   - Safe for re-ingestion via `cat_identifiers` UNIQUE constraint

2. **Entity-Linking Cron:** Added third catch-up call
   - `process_clinichq_unchipped_cats(500)` runs every 15 minutes
   - Processes any unchipped cats missed by job queue

3. **Cat Gallery API:** `GET /api/admin/clinic-days/[date]/cats`
   - Returns all cats seen on a clinic day with photos, microchip status
   - Counts: total_cats, chipped_count, unchipped_count, unlinked_count

4. **Cat Gallery UI:** Added to `/admin/clinic-days` page
   - Visual roster of all cats for a clinic day with photos
   - Visual distinction: orange border for unchipped, dashed gray for unlinked
   - Badges for Chipped/No Chip/Unlinked, Spay/Neuter status

5. **Cat Detail Page:** Shows unchipped status
   - "NO MICROCHIP" badge in header
   - Alert banner explaining identification via ClinicHQ Animal ID

### Touched Surfaces

| Object | Operation | ACTIVE? |
|--------|-----------|---------|
| `trapper.process_clinichq_unchipped_cats()` | CREATE | No — new function |
| `trapper.sot_cats` | INSERT (via enrich_cat) | No — adds new cats |
| `trapper.cat_identifiers` | INSERT | No — adds clinichq_animal_id |
| `trapper.sot_appointments` | UPDATE (cat_id link) | No — links to existing appointments |
| `/api/cron/entity-linking` | MODIFY (add catch-up call) | Yes — cron |
| `/admin/clinic-days` page | MODIFY (add gallery) | Yes — staff UI |
| `/cats/[id]` page | MODIFY (unchipped banner) | Yes — staff UI |

### North Star Alignment

- **INV-1 (No Data Disappears):** Unchipped cats now preserved via `clinichq_animal_id`. Zero data loss.
- **INV-4 (Provenance):** Uses existing `enrich_cat()` which tracks `source_system='clinichq'`.
- **INV-6 (Active Flows Sacred):** Zero changes to existing `process_clinichq_cat_info()` — purely additive.
- **INV-8 (Merge-Aware):** `enrich_cat()` handles merged entities correctly.
- **INV-10 (Centralized Functions):** Uses `enrich_cat()`, not direct INSERTs.

### Files Changed

| File | Type | What |
|------|------|------|
| `sql/schema/sot/MIG_891__process_unchipped_cats.sql` | New | Processing function |
| `apps/web/src/app/api/cron/entity-linking/route.ts` | Modify | Add catch-up call |
| `apps/web/src/app/api/admin/clinic-days/[date]/cats/route.ts` | New | Cat gallery API |
| `apps/web/src/app/admin/clinic-days/page.tsx` | Modify | Cat gallery UI |
| `apps/web/src/app/api/cats/[id]/route.ts` | Modify | Add needs_microchip |
| `apps/web/src/app/cats/[id]/page.tsx` | Modify | Unchipped banner |

### Validation

1. **Pre-backfill:** Count unchipped staged records
   ```sql
   SELECT COUNT(*) FROM trapper.staged_records
   WHERE source_system = 'clinichq' AND source_table = 'cat_info'
     AND processed_at IS NULL
     AND (payload->>'Microchip Number' IS NULL
          OR TRIM(payload->>'Microchip Number') = ''
          OR LENGTH(TRIM(payload->>'Microchip Number')) < 9);
   ```

2. **Run backfill:**
   ```sql
   SELECT * FROM trapper.process_clinichq_unchipped_cats(5000);
   ```

3. **Verify cats created:**
   ```sql
   SELECT COUNT(*) FROM trapper.sot_cats WHERE needs_microchip = TRUE;
   ```

4. **Idempotency test:** Run again, should return `cats_created: 0`

5. **Test UI:** Visit `/admin/clinic-days`, select 02/02/2026, verify cancer cat appears with "Needs Microchip" badge

### Rollback

```sql
-- Delete cats created by this feature (if needed)
DELETE FROM trapper.sot_cats WHERE needs_microchip = TRUE;
-- Function can be dropped safely
DROP FUNCTION IF EXISTS trapper.process_clinichq_unchipped_cats(INT);
```

### Stop Point

Unchipped cats now tracked via `clinichq_animal_id`. Clinic Day Cat Gallery shows all cats with microchip status. F5 from TASK_001 resolved.
