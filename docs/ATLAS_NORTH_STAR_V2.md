# Atlas North Star v2.0 — Data Architecture Ledger

**Purpose:** This document is the single authoritative reference for Atlas's 3-layer data architecture. It captures critical invariants, patterns, and decisions that MUST survive context compactions and be honored across all development work.

**Read this document FIRST when starting any Atlas development session.**

---

## Physical Structure

**Same repo, same database, different schemas.** No separate repository needed.

- **V2 is deployed and active.** V1 `trapper` schema retained only for staff auth tables (`trapper.staff`, `trapper.staff_sessions`).
- **Migrations:** V2 migrations use 4-digit numbering (`MIG_2000+`) in `sql/schema/v2/`.

---

## The 3-Layer Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: SOURCE (schema: source.*)                                       │
│  Raw ingested data • Append-only • Full provenance • Lowest processing    │
│  Tables: clinichq_raw, shelterluv_raw, volunteerhub_raw, airtable_raw    │
├───────────────────────────────────────────────────────────────────────────┤
│                     ↓ DATA ENGINE (Identity Resolution)                   │
├───────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: OPS (schema: ops.*)                                             │
│  Structured operational data • Domain-organized • Staff workflows         │
│  Domains: clinic_*, intake_*, request_*, volunteer_*, trapper_*, org_*    │
├───────────────────────────────────────────────────────────────────────────┤
│                     ↓ ENTITY LINKING (Relationships)                      │
├───────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: SOT (schema: sot.*)                                             │
│  Canonical entities • Single Source of Truth • Stable handles • Deduped   │
│  Entities: people, cats, places, addresses + relationship tables          │
├───────────────────────────────────────────────────────────────────────────┤
│  ANALYTICS: Beacon views live in ops.* (no separate beacon schema)        │
│  Colony estimates, population models, ecological data                      │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Schema Mapping

| Schema | Purpose | Layer | Examples |
|--------|---------|-------|----------|
| `source` | Raw ingested data (append-only JSONB) | 1 | `clinichq_raw`, `shelterluv_raw`, `volunteerhub_raw`, `airtable_raw` |
| `ops` | Operational workflows + views + config | 2 | `requests`, `appointments`, `file_uploads`, `app_config`, `entity_edits` |
| `sot` | Canonical entities + core functions | 3 | `people`, `cats`, `places`, `addresses`, `person_place`, `cat_place`, `find_or_create_*()` |
| `ref` | Reference/lookup data | Support | `common_first_names`, `occupation_surnames`, `business_service_words` |
| `trapper` | V1 compat (staff auth only) | Legacy | `staff`, `staff_sessions` |

---

## Source Change Detection System

**External systems change over time.** We track these changes to maintain data integrity.

### What Gets Tracked

| Source | Change Type | Example | Action |
|--------|-------------|---------|--------|
| **ClinicHQ** | Owner info changes | Cat booked under different person | Log history, flag for review |
| **ClinicHQ** | Account name updates | "Smith" → "Smith-Jones" | Update linked person |
| **VolunteerHub** | Group membership | Trapper added/removed | Update roles, log event |
| **ShelterLuv** | Outcome changes | Foster → Adoption | Update relationship type |

### Key Tables

| Table | Purpose |
|-------|---------|
| `source.sync_runs` | Track each sync operation |
| `source.sync_record_state` | Current state of each source record (hash-based) |
| `source.change_events` | Log of detected changes |
| `source.volunteerhub_memberships` | Track group membership over time |
| `source.clinichq_owner_history` | Track owner info per animal over time |

### How It Works

```
1. Start sync: source.start_sync_run('volunteerhub', 'group_membership')
2. For each record: source.process_source_record(...) → 'created'/'updated'/'unchanged'
3. Mark missing: source.mark_missing_as_deleted(...) → logs deletions
4. Complete sync: source.complete_sync_run(sync_id)
```

### Views for Monitoring

- `source.v_recent_changes` — All recent changes
- `source.v_pending_reviews` — Changes requiring manual review
- `source.v_trapper_changes` — Trapper group membership changes
- `source.v_cat_owner_changes` — Cat owner changes from ClinicHQ

---

## 10 Unbreakable Invariants

These rules are NON-NEGOTIABLE. Breaking any of these creates cascading data quality issues.

### Identity & Entity Creation

| # | Rule | Why It Matters |
|---|------|----------------|
| **1** | **Never create people without email OR phone** | Identity matching becomes impossible; creates orphan duplicates |
| **2** | **Never match people by name alone** | Thousands of "John Smith" records exist; name-only matching creates phantom merges |
| **3** | **All entity creation via `find_or_create_*` functions** | Ensures deduplication, provenance tracking, proper identity resolution |
| **4** | **`should_be_person()` gates ALL person creation** | Prevents org emails, addresses, garbage from becoming person records |
| **5** | **Org emails go to `ops.clinic_accounts`, not `sot.people`** | @forgottenfelines.com, info@*, etc. are NOT real people |

### Data Integrity

| # | Rule | Why It Matters |
|---|------|----------------|
| **6** | **Never hard delete — use `merged_into_*` chains** | Preserves audit trail; allows following merge history |
| **7** | **All queries MUST filter `merged_into_*_id IS NULL`** | Otherwise returns already-merged duplicates |
| **8** | **Manual > AI — verified data cannot be overwritten** | Staff corrections protected from automated pipelines |
| **9** | **Every record needs `source_system` + `source_record_id`** | Provenance required for audit and reprocessing |
| **10** | **Relationship writes via gatekeeper functions only** | `link_cat_to_place()`, `link_person_to_cat()` enforce validation |

---

## Source System Authority

Each external system is authoritative for specific data. Query the RIGHT source.

| System | Authoritative For | NOT Authoritative For |
|--------|-------------------|----------------------|
| **ClinicHQ** | Medical records, procedures, microchips | Volunteers, outcomes |
| **ShelterLuv** | Adoptions, fosters, transfers, deaths | Clinic procedures |
| **VolunteerHub** | Trappers, fosters, volunteers | Animals |
| **Airtable** | Legacy requests, Project 75 | Current data |
| **PetLink** | Microchip registry | Anything else |

**source_system values (use EXACTLY):** `clinichq`, `shelterluv`, `volunteerhub`, `airtable`, `petlink`, `web_intake`, `google_maps`, `atlas_ui`

---

## Data Engine Entry Points

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ALL PERSON CREATION flows through:                                      │
│                                                                         │
│  should_be_person(first, last, email, phone)                           │
│       ↓ TRUE                    ↓ FALSE                                │
│  data_engine_resolve_identity()  →  clinic_accounts (pseudo-profile)   │
│       ↓                                                                 │
│  find_or_create_person()                                                │
│       ↓                                                                 │
│  sot.people + sot.person_identifiers                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**`should_be_person()` rejects:**
- @forgottenfelines.com/org domains
- Generic org prefixes (info@, office@, contact@, admin@)
- Soft-blacklisted high-threshold emails
- Location names (starts with digits, contains street terms)
- Organization names (Inc., LLC, rescue, shelter, etc.)
- Names classified as 'garbage' or 'address' by `classify_owner_name()`

---

## Source-Dependent Name Validation

**First-name-only records (like "Rosa") are handled differently per source:**

| Source | Allow in sot.people? | Handling | Why |
|--------|---------------------|----------|-----|
| **ShelterLuv** | Yes with flag | `data_quality='incomplete'` | Real adopters/fosters with outcome data |
| **VolunteerHub** | Yes with flag | `data_quality='incomplete'` | Verified volunteers who signed up |
| **ClinicHQ** | No | Route to `ops.clinic_accounts` | Pseudo-profiles, not verified people |
| **Airtable** | Only if salvageable | Quarantine by default | Migrate only if has valuable linked data |
| **Web Intake** | No | Quarantine for review | Form validation should prevent this |
| **PetLink** | Yes with flag | Low confidence identifier | Registry data, often incomplete |

**Salvageability criteria (first-name-only from Airtable):**
- Has email OR phone identifier → can match in future
- Has linked cats with outcomes → valuable relationship data
- Has linked place with colony data → location context
- Can merge into existing complete record

---

## Centralized Functions — NEVER BYPASS

| Entity | Function | Schema |
|--------|----------|--------|
| Person | `find_or_create_person(email, phone, first, last, addr, source)` | `sot` |
| Place | `find_or_create_place_deduped(address, name, lat, lng, source)` | `sot` |
| Cat (microchip) | `find_or_create_cat_by_microchip(chip, name, sex, breed, ...)` | `sot` |
| Cat (no microchip) | `find_or_create_cat_by_clinichq_id(animal_id, name, sex, ...)` | `sot` |
| Request | `find_or_create_request(source, record_id, created_at, ...)` | `ops` |
| Cat→Place | `link_cat_to_place(cat_id, place_id, type, evidence, source)` | `sot` |
| Person→Cat | `link_person_to_cat(person_id, cat_id, type, evidence, source)` | `sot` |

**DO NOT write direct INSERTs to these tables — use the functions above:**
- `sot.people`, `sot.cats`, `sot.places`, `sot.addresses`
- `sot.person_cat`, `sot.cat_place`, `sot.person_place`
- `ops.requests` (use `ops.find_or_create_request()`)

---

## Confidence & Soft Blacklist Rules

### Confidence Thresholds

| Score | Meaning | Action |
|-------|---------|--------|
| ≥0.95 | Strong match | Auto-merge |
| 0.50-0.95 | Possible match | Review queue |
| <0.50 | Weak/no match | Create new or household member |

### PetLink Emails (Fabricated)

FFSC staff fabricates emails for microchip registration (e.g., `gordon@lohrmanln.com`).

**EVERY query on `sot.person_identifiers` MUST include:**
```sql
AND pi.confidence >= 0.5
```

### Soft Blacklist

`sot.soft_blacklist` contains identifiers that should NOT auto-match:
- Org emails (info@forgottenfelines.com, marinferals@yahoo.com)
- FFSC phone numbers
- Known shared household phones

---

## Cat-Place Linking Rules

Two methods, in priority order:

| Priority | Method | Function | What It Uses |
|----------|--------|----------|--------------|
| **1st** | Appointment-based | `link_cats_to_appointment_places()` | Booking address (ground truth) |
| **2nd** | Person-based | `link_cats_to_places()` | person_cat → person_place chain |

**Critical constraints on person-based linking:**
- `LIMIT 1` per person (not ALL addresses)
- Exclude staff/trappers (prevents residential pollution)
- Exclude business/clinic/outdoor_site place types

---

## Known Data Patterns to Handle

### Patterns That Slip Through

| Pattern | Detection | Handling |
|---------|-----------|----------|
| Org email as person | `should_be_person()` | Route to clinic_accounts |
| Address as person | `classify_owner_name()` | Route to clinic_accounts |
| Shared household phone | `data_engine_soft_blacklist` | Reduce confidence, review queue |
| PetLink fabricated email | `classify_petlink_email()` | Set confidence 0.1-0.2 |
| Pre-2024 bad relationships | Historical flag | Quarantine, don't migrate to new schema |

### Legacy Data Categories

| Category | Count (approx) | Treatment |
|----------|----------------|-----------|
| Org-as-person | 213 | Quarantine for staff review |
| Address-as-person | 100+ | Quarantine for staff review |
| First-name-only | 590 | Quarantine for staff review |
| No identifiers | 999 | Flag, allow future matching |
| Bad person-cat links (org email) | 2,400+ | Quarantine relationships |

---

## Active Workflow Preservation

These workflows MUST continue working during and after migration:

### 1. Web Intake → Request

```
User submits form
    → ops.intake_submissions
    → sot.find_or_create_person() (if email/phone)
    → sot.find_or_create_place_deduped()
    → ops.requests
    → ops.request_assignments (when assigned)
```

### 2. ClinicHQ Upload

```
CSV upload
    → source.ingest_batches + source.staged_records
    → ops.process_clinichq_*()
    → sot.cats (via find_or_create_cat_by_microchip)
    → sot.places (via find_or_create_place_deduped)
    → ops.clinic_appointments
    → sot.people (ONLY if email/phone exists)
```

### 3. Atlas Map

```
ops.v_map_atlas_pins
    → sot.places (for location)
    → ops.requests (for request markers)
    → Colony data from sot.place_colony_estimates
```

---

## Quarantine Pattern

Records that fail validation go to quarantine, NOT deleted:

**Note:** A dedicated quarantine schema was planned but not implemented. Failed records are currently handled by:
- `should_be_person()` → routes non-people to `ops.clinic_accounts`
- `sot.match_decisions` → logs identity resolution decisions for review
- `ops.entity_linking_skipped` → tracks entities that couldn't be linked with reasons

**Quarantine Triggers:**
- `should_be_person()` returns FALSE but has identifier
- Confidence score in "review pending" range
- Name classified as organization/address/garbage
- Duplicate detection finds potential match

---

## Phone vs Email Priority

**ALWAYS prefer Owner Phone over Owner Cell Phone:**
```sql
COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')
```

**Why:** Cell phones are shared in households (spouses, family). Using cell phone as primary causes cross-linking between household members.

---

## Views vs Tables

| Pattern | Use |
|---------|-----|
| **Tables** | Write operations, entity storage |
| **Views** | Read operations, map display, reports |

**All map/display queries should use views:**
- `ops.v_map_atlas_pins` — Map visualization (two-tier pin system)
- `ops.v_request_list` — Request list with status/priority
- `ops.v_beacon_summary` — Beacon analytics data

---

## Migration Checklist

Before any schema migration:

- [ ] All entity counts validated
- [ ] `merged_into_*` chains preserved
- [ ] Provenance (`source_system`, `source_record_id`) intact
- [ ] Active workflows tested
- [ ] Quarantine queue populated (not silently dropped)
- [ ] Rollback plan documented

---

## Data Zones

| Zone | Tables | Hygiene Rule |
|------|--------|-------------|
| **ACTIVE** | `ops.web_intake_submissions`, `ops.requests`, `ops.journal_entries`, `ops.request_trapper_assignments`, `sot.places`, `sot.people`, `sot.cats`, `sot.staff`, `sot.staff_sessions`, `ops.communication_logs` | Do not touch without Safety Gate |
| **SEMI-ACTIVE** | `ops.place_contexts/*`, `ref.known_organizations`, `ops.extraction_queue/*`, `ops.tippy_*`, `ops.data_engine_*` | Soft-archive only, test before changing |
| **HISTORICAL** | `ops.staged_records`, `ops.processing_jobs`, `ops.entity_edits`, `ops.place_colony_estimates`, `ops.cat_birth_events`, `ops.cat_mortality_events`, all `ops.v_beacon_*` views | Can clean more aggressively, but `ops.staged_records` is append-only (INV-1) |

---

## Quick Reference: Don't Do This

| Action | Why Not | Do Instead |
|--------|---------|------------|
| Direct INSERT to sot.people | Bypasses deduplication | `find_or_create_person()` |
| Direct INSERT to sot.cat_place | Bypasses validation | `link_cat_to_place()` |
| Query without `merged_into_*_id IS NULL` | Returns duplicates | Always filter merged |
| Match people by name only | Too many false positives | Email/phone only |
| Use @forgottenfelines.com as person email | Creates org-as-person | Route to clinic_accounts |
| COALESCE cell phone before owner phone | Cross-links households | Owner phone first |
| Use PetLink email for matching | Fabricated emails | Filter confidence >= 0.5 |
| Hard delete entities | Breaks references | Use merge chains |

---

## Document Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.1 | 2026-03-16 | Fix schema refs (atlas→sot/ops), remove non-existent schemas (quarantine/audit/beacon), update views/docs |
| 2.0 | 2026-02-11 | 3-layer architecture, schema-based organization |
| 1.0 | 2026-01-25 | Original North Star (7-layer system) |

---

---

## Data Pattern Detection

**Catch edge cases automatically before they cause "running in circles."**

| Category | Patterns | Action |
|----------|----------|--------|
| **Identity** | IDENT_001-009 (org email, address name, firstname-only, etc.) | AUTO_FIX / QUARANTINE |
| **Relationship** | REL_001-008 (pollution, orphans, circular merge) | ALERT / BLOCK |
| **Volume** | VOL_001-005 (duplicate burst, spike, missing fields) | ALERT |
| **Quality** | QUAL_001-005 (confidence drift, source conflict) | ALERT |

**Note:** Pattern detection was planned but not fully implemented as dedicated tables. Edge cases are currently tracked in `docs/DATA_GAP_RISKS.md` and monitored via `ops.check_entity_linking_health()`.

See `DATA_PATTERN_DETECTION.md` for the planned detection catalog.

---

## Reprocessing Principle

**All transformations are idempotent and can recreate cleaned data from source.**

```
source.* (raw) → [Transformation Registry] → sot.* (clean)
```

If you have the source data + soft_blacklist + transformation functions, you can always recreate the cleaned output. See `CENTRALIZED_FUNCTIONS.md` for function details and `INGEST_GUIDELINES.md` for the pipeline patterns.

**Key transformation order:**
1. Normalization (stateless)
2. Classification (stateless)
3. Gating (uses soft_blacklist)
4. Identity Resolution (uses SOT state)
5. Entity Creation (idempotent)
6. Relationship Building (idempotent)
7. Enrichment (idempotent)

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `CENTRALIZED_FUNCTIONS.md` | Function signatures with examples |
| `CORE_FUNCTIONS.md` | Quick reference for all centralized DB functions |
| `DATA_GAPS.md` | Active data quality issues |
| `DATA_GAP_RISKS.md` | Edge cases & unusual scenarios |
| `INGEST_GUIDELINES.md` | Data ingestion rules and templates |
| `CLAUDE.md` | Development rules (detailed) |
