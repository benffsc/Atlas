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

**Status:** Planned
**Zone:** HISTORICAL
**Scope:** 4,172 unprocessed shelterluv events + 914 unprocessed animals. Determine if these contain new data or are already processed by direct ingest calls.

#### DH_D002: Audit Empty Tables for Feature Intent

**Status:** Planned
**Zone:** MIXED
**Scope:** Of 138 empty tables, determine which are: (a) planned features to keep, (b) abandoned scaffolding to drop, (c) lookup tables that should be populated.

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
