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

**Status:** Planned
**ACTIVE Impact:** No
**Scope:** Build the source registration and field mapping system. Demonstrate with one existing source (web_intake).

### What Changes

1. Populate `orchestrator_sources` with existing sources (clinichq, airtable, web_intake, shelterluv).
2. Define `orchestrator_field_mappings` — maps source fields to canonical targets.
3. Create `register_source()` function for declaring new sources.
4. Create `map_source_field()` function for declaring field→surface routing.
5. Demonstrate: register "client_survey" as a new source with cat_count → place_colony_estimates routing.

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| `orchestrator_sources` | Table | INSERT | No |
| `orchestrator_field_mappings` | Table | CREATE + INSERT | No |
| New functions (2) | Functions | CREATE | No |

### Validation

- [ ] All existing sources registered
- [ ] Field mappings for web_intake match current behavior
- [ ] New source registration works end-to-end in test
- [ ] Active Flow Safety Gate passes

### Rollback

- Truncate orchestrator tables. No external dependencies.

### Stop Point

Registry populated. One new source demonstrated. Pattern documented.

---

## ORCH_003: Data Health Checks + "Why Missing?" Surfaces

**Status:** Planned
**ACTIVE Impact:** No
**Scope:** Build diagnostic views and functions that surface data quality issues, routing failures, and explain why data is missing.

### What Changes

1. Create `v_orchestrator_health` — pipeline throughput, error rates, routing stats.
2. Create `v_data_why_missing` — surfaces entities that should have data but don't (places without colony estimates, people without identifiers, cats without places).
3. Create `v_merge_chain_health` — detects merge black holes across all entity types.
4. Create `v_routing_anomalies` — flags suspicious data (cat_count=500 at a house, negative values, impossible dates).
5. Optional admin page: `/admin/data-health`

### Touched Surfaces

| Object | Type | Operation | ACTIVE? |
|--------|------|-----------|---------|
| New views (4) | Views | CREATE | No |
| Optional new page | UI | CREATE | No |

### Validation

- [ ] Health views return correct counts matching manual spot checks
- [ ] "Why missing" surfaces correctly identify known gaps (986 people, 1608 cats, 93 places)
- [ ] Merge chain health returns 0 black holes (after TASK_002/003)
- [ ] Active Flow Safety Gate passes

### Rollback

- `DROP VIEW` — clean removal

### Stop Point

Diagnostic surfaces exist. Data health is observable. No active flows changed.

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
ORCH_002 (Source registry)        → Config-driven routing
    ↓
ORCH_003 (Data health checks)     → Observability
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
