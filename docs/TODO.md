# Atlas TODO Tracker

Last Updated: 2026-01-16

This document tracks implementation priorities, fixes, and enhancements for the Atlas codebase. Items are organized by priority and status.

---

## 🐛 Recently Fixed Bugs

### Airtable Sync Issues (Fixed 2026-01-16)

- [x] **Address Parsing Regex Failure**
  - **Symptom**: "Could not parse cat location address" error for valid addresses
  - **Root Cause**: Regex `[^H]+?` in `parseJotformAddress()` failed on addresses like "5th Street House number: 16376" because it couldn't match past the 'H' in "House"
  - **File**: `/apps/web/src/app/api/cron/airtable-sync/route.ts:215`
  - **Fix**: Changed regex from `[^H]+?` to `.+?` to properly match any characters
  - **Example**: "Street name: 5th Street House number: 16376" now correctly parses to "16376 5th Street"

- [x] **Duplicate Content in Situation Description**
  - **Symptom**: Notes and Cat Description appeared twice in the situation summary
  - **Root Cause**: `situationParts` included Notes, then `notesContent` included both `situationParts` AND Notes again
  - **File**: `/apps/web/src/app/api/cron/airtable-sync/route.ts:286-307`
  - **Fix**: Consolidated all fields into single `situationParts` array, removed duplicate additions

- [x] **Cannot Edit Emergency Status**
  - **Symptom**: No way to unmark a submission as emergency from the intake queue
  - **Root Cause**: `is_emergency` was not in the `allowedFields` array for PATCH endpoint
  - **File**: `/apps/web/src/app/api/intake/queue/[id]/route.ts:119-144`
  - **Fix**: Added `is_emergency` to the allowed editable fields

### Urgent/Emergency Wording Update (2026-01-16)

- [x] **Changed "EMERGENCY" to "URGENT" throughout intake queue**
  - FFSC is a spay/neuter clinic, not an emergency vet
  - True emergencies (injury, illness) should go to pet hospitals
  - UI now shows "MARKED AS URGENT" with explanation text

- [x] **Added Urgent Downgrade Feature with Reasons**
  - **File**: `/apps/web/src/app/intake/queue/page.tsx`
  - Clicking "Remove Urgent Flag" shows reason picker
  - 7 predefined reasons covering 99% of situations:
    1. **Not TNR-related** - Request for services outside spay/neuter mission
    2. **Needs emergency vet** - True emergency, referred to pet hospital
    3. **Situation is stable** - Cats being fed, no immediate danger
    4. **Routine spay/neuter** - Standard scheduling, not urgent
    5. **Cat(s) already altered** - No TNR needed
    6. **Duplicate request** - Same location already being handled
    7. **Form misunderstanding** - Normal priority is fine
  - Reason is logged to `review_notes` with timestamp for tracking

---

## 🔴 CRITICAL (Fix Immediately)

### Security

- [x] **Remove Plaintext Password Fallback** ✅ FIXED 2026-01-17
  - File: `/apps/web/src/app/api/auth/verify/route.ts:10`
  - Issue: Hardcoded default password "18201814" if env var not set
  - Risk: Anyone with default password can access system
  - Fix: Removed fallback, now requires ATLAS_ACCESS_CODE env var (returns 500 if missing)

- [x] **SQL Injection in Cat Audit Logging** ✅ FIXED 2026-01-16
  - File: `/apps/web/src/app/api/cats/[id]/route.ts:353-390`
  - Issue: Template literals used instead of parameterized queries for audit INSERTs
  - Fix: Converted to parameterized queries

- [x] **Remove Embedded Airtable Token** ✅ FIXED 2026-01-16
  - Files: 5 scripts in `/scripts/ingest/`
  - Issue: Hardcoded `AIRTABLE_PAT` fallback exposed token in git history
  - Fix: Removed hardcoded values, require env var with explicit error

### Data Integrity

- [x] **Fix Duplicate Migration Numbers** ✅ FIXED 2026-01-17
  - **Impact**: Prevented deterministic migration ordering
  - **Fix**: Renumbered 14 duplicates to MIG_268-281

- [ ] **Extract Missing Microchips from Staged Data** 🔴 MIGRATION CREATED 2026-01-17
  - **Impact**: ~32,311 cats invisible in search, not linked to places
  - **Migration**: `MIG_282__extract_missing_microchips.sql`
  - **Sources**: PetLink pets (8,265), ClinicHQ appointments (24,046)
  - **To run**: `psql $DATABASE_URL -f sql/schema/sot/MIG_282__extract_missing_microchips.sql`

### Database Functions

- [x] **Create `canonical_person_id()` Alias** ✅ FIXED 2026-01-16
  - Issue: MIG_251 calls `canonical_person_id()` but MIG_225 defines `get_canonical_person_id()`
  - Fix: Created MIG_259 with alias function

- [x] **Create/Complete `merge_people()` Function** ✅ FIXED 2026-01-16
  - Issue: Referenced in MIG_251 but implementation not found
  - Fix: Created MIG_260 with complete `merge_people()` and `undo_person_merge()` functions

### Data Flow

- [x] **Auto-Process Staged Records** ✅ FIXED 2026-01-16
  - Issue: 0/41 ingest scripts create `request_cat_links` or `cat_vitals` - only API endpoint does
  - Fix: Created `/api/cron/process-uploads` cron endpoint that auto-processes pending file uploads
  - Impact: Fixes cat linking, vitals capture, and request attribution

---

## 🟡 HIGH PRIORITY (This Sprint)

### Intake Workflow Simplification (Plan exists but was NOT in TODO)

**Context:** The intake workflow has 3+ overlapping status/tracking systems that confuse staff and make the queue hard to manage. A comprehensive plan exists at `/Users/benmisdiaz/.claude/plans/logical-swimming-hearth.md`.

**Current Problem (4 separate systems):**
1. `status` (native) - Auto-set, rarely used in UI
2. `legacy_submission_status` - Actual workflow (Pending → Booked → Complete)
3. `legacy_status` - Contact tracking (Contacted, No response)
4. `communication_logs` table - Separate from journal system

**Solution: Unified Status + Communication Log**
- Single `submission_status` enum: new → in_progress → scheduled → complete → archived
- Reuse journal system as "Communication Log" for notes + calls
- All answers editable with audit logging
- Priority override picker in detail view

- [x] **Create MIG_254: Unified Intake Status** ✅ RAN 2026-01-16
  - File: `sql/schema/sot/MIG_254__unified_intake_status.sql`
  - Created `intake_submission_status` enum (new, in_progress, scheduled, complete, archived)
  - Added `submission_status` and `appointment_date` columns
  - Migrated 1,141 submissions from legacy fields
  - Updated `v_intake_triage_queue` view
  - Created `update_submission_status()` helper function
  - Status distribution: scheduled (619), archived (426), complete (88), in_progress (6), new (2)

- [x] **Update Intake Queue API Endpoints** ✅ COMPLETED 2026-01-17
  - Added `submission_status`, `priority_override`, `appointment_date` to PATCH
  - All form answer fields now editable with audit logging
  - Created `/api/intake/queue/[id]/history` endpoint for edit history

- [x] **Redesign Intake Queue Detail Modal** ✅ COMPLETED 2026-01-17
  - Single status dropdown (new/in_progress/scheduled/complete/archived)
  - Priority dropdown (Auto/High/Normal/Low)
  - Inline edit for Cats and Situation sections
  - Mark as Urgent button, Edit History with Undo
  - Journal already integrated for communication log

- [x] **Create Edit Answers Modal** ✅ COMPLETED 2026-01-17
  - Inline editing instead of modal (better UX)
  - Editable: cat count, type, fixed status, kittens, medical, situation
  - All changes logged to `entity_edits` table

### API Improvements (Found in Audit 2026-01-16)

- [ ] **Add Auth Context to Endpoints** 🟡 FOUND 2026-01-16
  - Files with TODOs for auth context:
    - `/api/journal/route.ts:199` - defaults to "app_user"
    - `/api/journal/[id]/route.ts:144` - defaults to "app_user"
    - `/api/admin/ecology-config/route.ts:76` - defaults to "admin"
  - Fix: Extract actual user from session/auth context

- [x] **Add Person PATCH Endpoint** ✅ COMPLETED 2026-01-16
  - Added: `/api/people/[id]` PATCH handler
  - Editable fields: `display_name`, `entity_type`, `trapping_skill`, `trapping_skill_notes`
  - Includes audit logging via `logFieldEdits()`
  - Validates against allowed entity types and skill levels
  - Auto-updates `trapping_skill_updated_at` when skill changes

- [x] **Add Cat-Request Linking API** ✅ COMPLETED 2026-01-17
  - Created `/api/requests/[id]/cats` GET/POST/DELETE endpoints
  - Link/unlink cats from requests with audit logging

- [x] **Fix Async Import Pattern** ✅ FIXED 2026-01-17
  - Fixed: `/api/places/[id]/colony-override/route.ts`
  - Changed dynamic import() to static queryRows import

### Multi-Parcel Site Linking & Place Data Quality

**Context:** Large TNR operations like Tresch Dairy span multiple addresses (1054 & 1170 Walker Rd). The system supports linking via `place_place_edges` with `same_colony_site` relationship, but this feature is completely unused. Additionally, there are significant duplicate place records.

**Audit Findings (2026-01-16):**
- 0 `place_place_edges` records exist (feature unused)
- 565 exact duplicate place pairs (same address, different records)
- 11,119 places share streets with other places (candidates for site linking)
- Tresch Dairy example: 2 requests, 164 cats linked across both addresses, but places not linked

**Protocol (No Intake Changes Required):**
1. Keep separate places for different addresses
2. Link related places with `same_colony_site` edges
3. Staff manually identifies and links multi-parcel sites
4. Aggregate views for reporting across linked places

- [ ] **Create Admin UI for Place Linking**
  - Add "Link to Related Site" button on place detail page
  - Dropdown to select relationship type (`same_colony_site`, `adjacent_to`, `nearby_cluster`)
  - Search/select target place
  - Store in `place_place_edges` table
  - [x] API endpoint `/api/places/[id]/edges` created ✅ 2026-01-17
  - [ ] UI component needed

- [ ] **Merge Exact Duplicate Places (MIG_265)**
  - Create migration to identify and merge 565 duplicate place pairs
  - Use existing `merge_places()` function (or create if missing)
  - Strategy: Keep place with more relationships, merge the other
  - Log all merges to `entity_edits` for audit trail

- [ ] **Create Suggested Site Links View**
  - View: `v_suggested_place_links`
  - Heuristics:
    - Same requester at multiple nearby addresses
    - Same street + close house numbers + cat activity at both
    - Places sharing cats (like Tresch Dairy)
  - Include confidence score and suggested relationship type
  - Surface in admin dashboard for staff review

- [ ] **Link Tresch Dairy Places & Update Request Data (Immediate)**
  - Place A: `95509b31-771c-4f7d-8920-29abe39ecf66` (1054 Walker Rd)
  - Place B: `a1f6e0eb-eed3-48e2-92b4-78d1fbac5122` (1170 Walker Rd)
  - SQL to run (creates link + updates requests + adds field observation):
  ```sql
  -- 1. Link places as same colony site
  INSERT INTO trapper.place_place_edges (place_id_a, place_id_b, relationship_type_id, direction, note)
  SELECT '95509b31-771c-4f7d-8920-29abe39ecf66', 'a1f6e0eb-eed3-48e2-92b4-78d1fbac5122',
         id, 'bidirectional', 'Tresch Dairy - single dairy operation spanning two parcels'
  FROM trapper.relationship_types WHERE code = 'same_colony_site';

  -- 2. Update 1170 Walker Rd request with operational data and put on hold
  UPDATE trapper.sot_requests SET
    permission_status = 'granted',
    traps_overnight_safe = FALSE,
    access_without_contact = TRUE,
    access_notes = 'Open ranch property, can access without notifying',
    status = 'on_hold',
    hold_reason = 'resource_constraint',
    hold_reason_notes = 'Majority of cats fixed (~65). Only ~3 unfixed males remain. Moving resources to higher-need sites. Will return to complete.',
    hold_started_at = NOW()
  WHERE request_id = '36331e8e-e480-4d18-b7ae-d6767ddece08';

  -- 3. Update 1054 Walker Rd request similarly
  UPDATE trapper.sot_requests SET
    permission_status = 'granted',
    traps_overnight_safe = FALSE,
    access_without_contact = TRUE,
    access_notes = 'Open ranch property, can access without notifying',
    status = 'on_hold',
    hold_reason = 'resource_constraint',
    hold_reason_notes = 'Site nearly complete. Only handful of unfixed cats remain per requester. Moving resources to higher-need sites.',
    hold_started_at = NOW()
  WHERE request_id = '31e1ce8d-58d6-484a-af00-c0ddf66eeec1';

  -- 4. Add current field observation (captures "3 males remaining" intel)
  INSERT INTO trapper.place_colony_estimates (
    place_id, total_cats, altered_count, unaltered_count,
    source_type, observation_date, is_firsthand, notes, source_system, created_by
  ) VALUES (
    'a1f6e0eb-eed3-48e2-92b4-78d1fbac5122',  -- 1170 Walker
    68,  -- 65 fixed + ~3 remaining
    65,
    3,
    'trapper_site_visit',
    CURRENT_DATE,
    TRUE,
    'Per trapper observation: ~3 unfixed males remaining. Colony nearly complete.',
    'web_app',
    'system'
  );
  ```

- [ ] **Add Aggregate Colony Stats Across Linked Sites (MIG_266)**
  - Create view: `v_site_aggregate_stats`
  - De-duplicates cats that appear at multiple linked places
  - Returns combined: unique cat count, altered count, unique microchips
  - Calculates site-level alteration rate
  - Display on place detail page when links exist
  - SQL approach:
  ```sql
  -- Get all places in a site cluster via recursive CTE
  -- Then DISTINCT cat_id across all linked places
  -- Prevents double-counting Tresch's 82 cats as 154
  ```

- [ ] **Add Field Observation Capture Workflow**
  - **Problem**: 0% of places have observation data needed for Chapman estimator
  - **Solution**: Add "Log Site Visit" action on place/request detail pages
  - Fields to capture:
    - `total_cats_seen` (how many cats observed)
    - `eartip_count_observed` (how many had ear tips)
    - `observation_time_of_day` (morning/afternoon/evening/night)
    - `is_at_feeding_station` (TRUE if observed at feeding time)
    - `notes` (e.g., "3 unfixed males seen")
  - Stores in `place_colony_estimates` with `source_type = 'trapper_site_visit'`
  - Enables Chapman population estimator: `N̂ = (M+1)(C+1)/(R+1) - 1`
    - M = cats we've altered (known from clinic)
    - C = cats seen in observation
    - R = ear-tipped cats seen in observation

- [ ] **Add "Monitoring" Hold Reason**
  - Current `hold_reason` enum lacks "mostly complete, monitoring" option
  - Add value: `monitoring` - "Site substantially complete, periodic checks only"
  - Better fits Tresch situation than `resource_constraint`

### Colony Estimate Data Enrichment

**Architecture Audit (2026-01-16):**

| Metric | Count | Notes |
|--------|-------|-------|
| Total places | 13,227 | |
| Places with verified cats (clinic data) | 7,313 | Ground truth for alteration % |
| Places with colony estimates | ~1,200 unique | Across 2,169 total estimates |
| Estimates with eartip observation data | 62 | **Critical gap** - Chapman needs this |
| Estimation method: `verified_only` | 7,060 places | No observation data |
| Estimation method: `max_recent` | 392 places | Has survey/request data |
| Estimation method: `mark_resight` | 4 places | Has eartip data for Chapman |

**🔴 CRITICAL FINDING: Data Exists But In Wrong Columns**

The Project 75 survey data HAS ear-tip observation data, but it's stored in `altered_count` instead of `eartip_count_observed`:

| Source | Records | Has total_cats | Has altered_count | Has eartip_count_observed |
|--------|---------|----------------|-------------------|---------------------------|
| post_clinic_survey | 569 | 569 ✅ | 568 ✅ | 62 ❌ (506 missing!) |
| intake_form | 1,059 | 1,059 ✅ | 0 | 0 (not collected) |
| trapping_request | 541 | 541 ✅ | 0 | 0 (not collected) |

**Impact of Backfill:**
| State | Places with Chapman mark-resight |
|-------|----------------------------------|
| Before backfill | 4 |
| **After backfill** | **422** (100x improvement!) |

**Root Cause:** The sync script maps "Already Ear Tipped" to both `altered_count` AND `eartip_count_observed`, but records imported before the ecology fields were added didn't get updated.

**Why This Matters for Beacon:**
- Beacon needs accurate population estimates to predict TNR completion timelines
- Without observation data (eartip sightings), we can only use "lower bound" estimates
- Chapman mark-resight provides the most accurate population estimate
- **After backfill:** 422 places will have Chapman data (up from 4)

**🟢 CLINIC-GROUNDED APPROACH (Ground Truth)**

The most accurate data comes from clinic records - all cats we've spayed/neutered ARE ear-tipped. This is verified truth, not survey estimates.

**Existing Data:**
| Field | Table | Source | Count |
|-------|-------|--------|-------|
| `is_spay/is_neuter` | `cat_procedures` | ClinicHQ | 2000+ verified |
| `ownership_type` | `sot_cats` + `sot_appointments` | ClinicHQ | Owned/Community/Foster |
| `cat_place_relationships` | Links cats to places | Auto-linked | Via owner contact match |

**Cat Ownership Types (from ClinicHQ `Ownership` field):**
- **Owned** - Owned pets brought in for TNR
- **Community** - Feral/stray cats from colonies
- **Foster** - Cats in foster care

**How This Works:**
1. **M (marked cats)** = `COUNT(DISTINCT cat_id) FROM cat_procedures WHERE is_spay OR is_neuter` joined to `cat_place_relationships`
2. **R (ear-tipped seen)** = trapper observation of ear-tipped cats at site
3. **C (total cats seen)** = trapper observation of all cats at site
4. **Chapman estimate** = `N̂ = ((M+1)(C+1)/(R+1)) - 1`

**Key insight:** We don't need survey data for "altered count" at a place - we have verified clinic records. The only observation data we need is:
- How many cats did you see today? (C)
- How many had ear tips? (R)

The clinic data provides the ground truth M (marked/altered count) automatically.

**View:** `v_place_ecology_stats.a_known` already calculates this via `verified_altered` CTE

**Context:** The Chapman estimator for population estimation requires observation data (cats seen, ear-tipped seen), but only 62 estimates (2.9%) currently have this. Multiple existing data sources could enrich colony estimates without polluting core tables.

**Available Data Sources:**

| Source | Records | Data Quality | Integration Path |
|--------|---------|--------------|------------------|
| Project 75 Surveys (Airtable) | 632+ | High (post-clinic, firsthand) | Already syncs via `airtable_project75_sync.mjs` → `place_colony_estimates` |
| Internal Notes (sot_requests) | 268 requests | Medium (qualitative, needs parsing) | Extract counts via NLP/regex → `place_colony_estimates` |
| Google MyMaps KML | 5,724 pins | High (coords + historical notes) | Export as KML → parse → match to places → enrich |
| Airtable Legacy Requests | 500+ | Medium (cats_to_trap field) | Already in `staged_records`, needs processing |
| ClinicHQ Data | 2000+ cats | High (verified clinic records) | Already integrated via microchip matching |

**Integration Approach (Centralized, Non-Polluting):**

1. **All colony estimates go to ONE table**: `trapper.place_colony_estimates`
2. **Source tracking via columns**:
   - `source_type`: 'post_clinic_survey', 'trapper_site_visit', 'intake_form', 'trapping_request', 'internal_notes_parse'
   - `source_system`: 'airtable', 'web_app', 'atlas_ui', etc.
   - `source_record_id`: Original record ID for traceability
3. **Confidence via `colony_source_confidence` table** (already exists):
   - `verified_cats`: 100% (clinic data)
   - `post_clinic_survey`: 85%
   - `trapper_site_visit`: 80% ✅ Already exists
   - `trapping_request`: 60%
   - `intake_form`: 55%
   - `internal_notes_parse`: 40% ⚠️ **NEEDS ADDING** before notes parser
   - `legacy_mymaps`: 50% ⚠️ **NEEDS ADDING** before KML import

4. **Before new source types can be used**, add them to confidence table:
   ```sql
   INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description)
   VALUES
     ('internal_notes_parse', 0.40, 'Extracted from request notes via regex'),
     ('appointment_notes_parse', 0.35, 'Extracted from appointment internal notes'),
     ('intake_situation_parse', 0.45, 'Extracted from intake situation description'),
     ('legacy_mymaps', 0.50, 'Historical MyMaps data 2001-2019')
   ON CONFLICT (source_type) DO NOTHING;
   ```

### Qualitative Data Sources Inventory

**All sources of qualitative/notes data that could be parsed for colony estimates:**

| Source Table | Field | Description | Parse Priority |
|--------------|-------|-------------|----------------|
| `sot_requests` | `notes` | Case information (shareable) | HIGH |
| `sot_requests` | `internal_notes` | Staff working notes (private) | HIGH |
| `sot_requests` | `legacy_notes` | Notes from Airtable migration | MEDIUM |
| `sot_requests` | `access_notes` | Gate codes, dogs, parking | LOW |
| `sot_requests` | `urgency_notes` | Urgency context | MEDIUM |
| `sot_requests` | `location_description` | "behind dumpster", "in barn" | LOW |
| `sot_requests` | `hold_reason_notes` | Why on hold | LOW |
| `sot_requests` | `safety_notes` | Safety concerns | LOW |
| `sot_requests` | `best_times_seen` | When cats visible | LOW |
| `sot_requests` | `feeding_schedule` | Feeding patterns | LOW |
| `sot_appointments` | `internal_notes` | Internal medical notes (ClinicHQ) | MEDIUM |
| `sot_appointments` | `medical_notes` | Procedure notes | LOW |
| `web_intake_submissions` | `situation_description` | Main intake narrative | HIGH |
| `web_intake_submissions` | `access_notes` | Access info | LOW |
| `web_intake_submissions` | `review_notes` | Staff review notes | MEDIUM |
| `place_colony_estimates` | `notes` | Observation notes | ALREADY CAPTURED |
| `journal_entries` | `content` | Structured notes | MEDIUM |
| **KML File** | `description` | Historical notes | **EXTRACTED** |

**Patterns to Extract:**
- Cat counts: `"~3 males"`, `"about 20 cats"`, `"feeds 15"`, `"colony of 8"`
- Eartip observations: `"saw 5 eartipped"`, `"3 with ear tips"`
- Colony status: `"colony complete"`, `"all fixed"`, `"3 remaining"`
- Urgency signals: `"pregnant"`, `"kittens"`, `"sick"`, `"injured"`

- [x] **Create Internal Notes Parser Script** ✅ CREATED 2026-01-16
  - File: `scripts/ingest/parse_request_notes_estimates.mjs`
  - Parse `internal_notes` AND `notes` for cat count patterns
  - Extract from: `sot_requests.internal_notes`, `sot_requests.notes`, `sot_requests.legacy_notes`
  - Patterns: colony size, TNR count, eartip count, remaining count, colony complete
  - Insert as `source_type = 'internal_notes_parse'` with 40% confidence
  - Usage: `node scripts/ingest/parse_request_notes_estimates.mjs --dry-run`

- [ ] **Create Appointment Notes Parser**
  - File: `scripts/ingest/parse_appointment_notes.mjs`
  - Parse `sot_appointments.internal_notes` for colony/cat info
  - Look for: cat counts at location, eartip observations, colony status
  - Less reliable than request notes (focus on procedures, not colonies)
  - Insert as `source_type = 'appointment_notes_parse'` with 35% confidence

- [x] **Create Intake Situation Parser** ✅ CREATED 2026-01-16
  - File: `scripts/ingest/parse_intake_situation.mjs`
  - Parse `web_intake_submissions.situation_description`
  - Rich source - requesters describe their situation in detail
  - Extract: cat counts, kitten counts, fixed/unfixed, urgency signals
  - Insert as `source_type = 'intake_situation_parse'` with 45% confidence
  - Usage: `node scripts/ingest/parse_intake_situation.mjs --dry-run`

- [x] **Import MyMaps Colony History (KML)** ✅ SCRIPT CREATED 2026-01-16
  - **Source File**: `/Users/benmisdiaz/Downloads/FFSC Colonies and trapping assignments.kml`
  - **Import Script**: `scripts/ingest/mymaps_kml_import.mjs`
  - **Records**: 5,724 placemarks with coordinates, names, and historical descriptions

  **⚠️ IMPORTANT: KML Coordinate Accuracy Concern**

  The KML data has coordinates but NOT addresses. Coordinates may not be accurate:
  - Someone may have dropped a pin "near" a location, not at the exact address
  - GPS drift, manual placement error, or intentional approximation
  - Coordinates don't reverse-geocode reliably to addresses

  **Revised Strategy (Conservative Matching):**
  | Distance | Action | Rationale |
  |----------|--------|-----------|
  | < 50m | ✅ Confident match | Close enough to be same location |
  | 50-150m | ⚠️ Log for review | May be valid but uncertain |
  | > 150m | ❌ Skip (no match) | Too far, don't pollute data |

  **Key Decisions:**
  - **DO NOT create new places from KML coordinates** - would pollute places table with coord-only records
  - **Only enrich existing places** that have a confident coordinate match
  - **Unmatched records** are logged but not imported - may need manual review
  - **Historical Context Card** shows data as "historical activity" not "confirmed at this place"

  **Usage:**
  ```bash
  # First run dry-run to see match rates
  node scripts/ingest/mymaps_kml_import.mjs --dry-run --verbose

  # Check match rate - if too low, existing places may lack geocoding
  # If match rate is reasonable, run for real
  node scripts/ingest/mymaps_kml_import.mjs
  ```

  **KML Extraction Analysis (2026-01-16):**

  | Data Type | Count | % of Total | Notes |
  |-----------|-------|------------|-------|
  | Total placemarks | 5,724 | 100% | All have coordinates |
  | With description | 5,648 | 98.7% | Qualitative notes |
  | With date (MM/YY) | 1,035 | 18.1% | Range: 2001-2030, peak 2016-2018 |
  | With TNR count | 274 | 4.8% | 2,886 cats total, avg 10.5/site |
  | With colony size | 177 | 3.1% | avg 8.5 cats |
  | With trapper name | 488 | 8.5% | Top: Emily F (29), Sherry P (26) |
  | With contact phone | 3,440 | 60.1% | Redacted in import |
  | **Importable (coords + useful data)** | **2,546** | **44.5%** | Ready for import |

  **Qualitative Signals Extracted:**
  | Signal | Count | Use Case |
  |--------|-------|----------|
  | temperament | 1,063 | Cat behavior notes |
  | relocated | 497 | Colony moved/dispersed |
  | pregnant_nursing | 481 | Urgent TNR candidates |
  | adopted | 245 | Success tracking |
  | mortality | 233 | Population changes |
  | kittens_present | 93 | Urgent TNR priority |
  | no_cats | 43 | Colony completion |
  | colony_complete | 17 | Success confirmation |
  | new_arrivals | 6 | Ongoing monitoring |

  **Integration script**: `scripts/ingest/mymaps_kml_import.mjs`
  **Process**:
    1. Parse KML XML to extract placemarks
    2. Match to existing places by coordinates (haversine distance < 100m)
    3. Create new places for unmatched (using `find_or_create_place_deduped`)
    4. Extract structured data (TNR counts, colony sizes, dates)
    5. Insert historical estimates with `source_type = 'legacy_mymaps'`
    6. Store qualitative signals as journal-style notes
    7. Create trapper lookups from extracted names
    8. Redact phone numbers from stored notes (privacy)
  **Confidence**: 50% (historical data, dates vary 2001-2019)
  **Exported data**: `/tmp/kml_extracted_data.json` (5,724 records)

- [x] **Create "Log Observation" Quick Action API** ✅ CREATED 2026-01-16
  - **API**: `POST /api/places/[id]/observations` → inserts `place_colony_estimates`
  - **GET**: Returns list of trapper observations for a place
  - **Required fields**: `cats_seen`, `eartips_seen`
  - **Optional fields**: `time_of_day`, `at_feeding_station`, `notes`, `observer_name`
  - **Source tracking**: `source_type = 'trapper_site_visit'`, `source_system = 'atlas_ui'`
  - Returns Chapman estimate when ear-tip data available

### AI-Interpreted Colony Data (Future Enhancement)

**Goal:** Maximize value from years of historical data collection using AI interpretation, without polluting the source-of-truth data model.

**Problem We're Solving:**
- Historical data is fragmented: KML notes, request notes, intake descriptions, clinic records
- Data quality varies: some exact counts, some "about 20 cats", some just qualitative
- Hard for staff to synthesize 10+ years of notes into actionable understanding
- Current system shows raw data but doesn't interpret it

**Architectural Principles (Must Follow):**
1. **AI interpretations are SEPARATE from raw data** - never overwrite source records
2. **Clear provenance** - always marked as `source_type = 'ai_interpretation'`
3. **Regeneratable** - can be refreshed when new data arrives
4. **Additive only** - doesn't change existing colony_estimates or ecology views
5. **Confidence-aware** - AI estimates include uncertainty

**Proposed Approaches (Pick One or Combine):**

#### Option A: AI Colony Assessment Table (Recommended)
```sql
CREATE TABLE trapper.place_ai_assessments (
  assessment_id UUID PRIMARY KEY,
  place_id UUID REFERENCES places(place_id),

  -- AI-synthesized estimates
  estimated_colony_size INT,
  estimated_altered_count INT,
  estimated_remaining INT,
  confidence_level TEXT,  -- 'high', 'medium', 'low'

  -- AI-generated summary
  situation_summary TEXT,  -- "Active colony of ~15 cats, 10 fixed. Friendly feeder..."
  status_assessment TEXT,  -- 'active', 'nearly_complete', 'monitoring', 'resolved', 'unknown'
  priority_suggestion TEXT,  -- 'high', 'medium', 'low' with reasoning

  -- What data was used
  data_sources_used JSONB,  -- ['kml', 'request_notes', 'clinic', 'intake']
  data_date_range JSONB,    -- {earliest: '2015-03-01', latest: '2024-01-15'}
  raw_data_snapshot JSONB,  -- All input data for reproducibility

  -- Metadata
  model_version TEXT,       -- 'claude-3-sonnet-20240229'
  generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,   -- Regenerate after this date

  UNIQUE(place_id)  -- One current assessment per place
);
```

#### Option B: On-Demand API with Caching
- Don't store in database, generate via API when requested
- Cache in Redis/memory for 24 hours
- Pros: Always fresh, no schema changes
- Cons: Slower, can't query across all places

#### Option C: JSONB Column on Places
- Add `ai_assessment JSONB` to places table
- Pros: Simple, no new table
- Cons: Mixes AI data with canonical place data

**AI Interpretation Use Cases:**

| Use Case | Input Data | AI Output |
|----------|------------|-----------|
| **Colony Summary** | All notes, estimates, clinic data | Natural language "what's going on here" |
| **Size Estimation** | Conflicting counts from multiple sources | Synthesized estimate with confidence |
| **Status Assessment** | Activity patterns, recent observations | active/monitoring/complete/unknown |
| **Priority Scoring** | Kittens, pregnant, unfixed count, urgency signals | Suggested priority with reasoning |
| **Timeline Estimation** | Historical TNR rate, remaining count | "At current pace, ~3 months to complete" |
| **Pattern Detection** | Multi-year data | "Seasonal influx every spring", "New cats from neighboring colony" |

**Implementation Steps:**

1. [ ] **Design AI Assessment Schema** - Finalize table structure
2. [ ] **Create Assessment Generation Function** - SQL function or API endpoint
3. [ ] **Build AI Prompt Template** - Structured prompt for colony interpretation
4. [ ] **Add to Historical Context Card** - Show AI summary when available
5. [ ] **Create Regeneration Cron** - Refresh stale assessments periodically
6. [ ] **Add Manual Regenerate Button** - Staff can request fresh assessment

**Sample AI Prompt Structure:**
```
You are analyzing colony data for a TNR (trap-neuter-return) program.

Location: {place_name} ({address})

Historical Data:
- KML Notes (2015-2019): {kml_notes}
- Request Notes: {request_notes}
- Intake Descriptions: {intake_descriptions}
- Clinic Records: {altered_count} cats altered at this location
- Recent Observations: {recent_observations}

Based on ALL available data, provide:
1. Estimated current colony size (with confidence: high/medium/low)
2. Estimated cats still needing TNR
3. Brief situation summary (2-3 sentences)
4. Status: active / nearly_complete / monitoring / resolved / unknown
5. Suggested priority: high / medium / low (with brief reasoning)

Be conservative in estimates. When data conflicts, favor more recent sources.
Clinic data (verified alterations) is ground truth.
```

**Integration with Existing Architecture:**
- AI assessments are READ from `place_ai_assessments` table
- They do NOT feed into `v_place_ecology_stats` (keeps ground truth clean)
- Historical Context Card shows AI summary alongside raw data
- Beacon analytics can use AI estimates as a SEPARATE signal
- Staff can always see raw data to verify AI interpretation

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────┐
│                    RAW DATA (Source of Truth)               │
├─────────────────────────────────────────────────────────────┤
│  place_colony_estimates ← KML, notes, intake, Project 75    │
│  cat_procedures ← ClinicHQ (verified alterations)           │
│  sot_requests.notes ← Staff observations                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    [AI Interpretation Layer]
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              place_ai_assessments (Derived)                 │
├─────────────────────────────────────────────────────────────┤
│  - Synthesized from all raw data                            │
│  - Clearly marked as AI-generated                           │
│  - Regeneratable, not source of truth                       │
│  - Used for UI summaries and suggestions only               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    UI / Analytics                           │
├─────────────────────────────────────────────────────────────┤
│  Historical Context Card: Shows AI summary + raw notes      │
│  Place Detail: AI status badge + confidence indicator       │
│  Beacon: Can use AI estimates as additional signal          │
└─────────────────────────────────────────────────────────────┘
```

- [x] **Create Historical Context Card Component** ✅ CREATED 2026-01-16
  - **Goal**: Surface historical qualitative data from KML, notes, and legacy sources
  - **Component**: `/apps/web/src/components/HistoricalContextCard.tsx`
  - **API**: `/apps/web/src/app/api/places/[id]/history/route.ts`
  - **Shows**:
    - Quasi-quantitative data (TNR counts, colony sizes from historical sources)
    - Summarized notes (filtered for inappropriate language)
    - Attribution (MP = predecessor, JK = Jami, HF = Heidi, DF = Diane, etc.)
    - Date range of historical activity
    - Qualitative signals (temperament, relocated, kittens, etc.)
  - **Data sources**:
    - `place_colony_estimates` where `source_type IN ('legacy_mymaps', 'internal_notes_parse')`
    - KML extracted signals (temperament, relocated, pregnant_nursing, etc.)
    - Request/intake notes summaries
  - **Privacy**: Filters profanity, redacts phone numbers, uses staff abbreviations
  - **Future**: AI-summarized "what's going on here" overview (placeholder added)
  - ~~**TODO**: Integrate into place detail page, request detail page~~ ✅ DONE

- [x] **Create Observation UI Component** ✅ COMPLETED 2026-01-16
  - **Goal**: Simple way for trappers to capture site observations without friction
  - **Components created**:
    - `/apps/web/src/components/LogObservationModal.tsx` - Modal for logging observations
    - `/apps/web/src/components/ObservationsSection.tsx` - List of observations with add button
  - **Features implemented**:
    - Required fields: cats_seen, eartips_seen with validation
    - Optional fields: time_of_day, at_feeding_station, notes
    - POST to `/api/places/[id]/observations`
    - Shows Chapman population estimate after successful save
    - Error handling with user feedback
  - **Integration points**:
    - Place detail page: ObservationsSection with "Log Visit" button
    - Request detail page: "Log Site Visit" button in Location card
  - **Post-save behavior**: Shows Chapman estimate if available, auto-refreshes observation list

- [x] **Add Observation to Request Detail Page** ✅ COMPLETED 2026-01-16
  - Added "Log Site Visit" button in Location card (next to Google Maps link)
  - Button appears when request has a place_id (works with or without coordinates)
  - Uses LogObservationModal component
  - Observations stored in place_colony_estimates with source_type='trapper_site_visit'

- [ ] **Leverage Cat Ownership Types for Analytics**
  - **Data exists in**: `sot_cats.ownership_type` and `sot_appointments.ownership_type`
  - **Values**: Owned, Community, Foster (from ClinicHQ `Ownership` field)
  - **Use cases**:
    - Filter colony stats to only "Community" cats (exclude owned pets)
    - Separate reporting: TNR vs low-cost spay/neuter for owned pets
    - Accurate colony-specific alteration rates (exclude fosters/owned)
  - **Implementation**:
    - Add `WHERE ownership_type = 'Community'` filter option to ecology views
    - Add ownership breakdown to place detail page
    - Surface in Beacon analytics for accurate colony population

### Architecture Validation Checklist

**Before implementing any new data flow, verify:**

| Check | Rule | Reference |
|-------|------|-----------|
| ✅ Entity creation | Use `find_or_create_*` functions, never direct INSERT | CLAUDE.md |
| ✅ Place dedup | Via `normalized_address` in `find_or_create_place_deduped` | MIG_214 |
| ✅ Colony estimates | All go to `place_colony_estimates` table | MIG_209 |
| ✅ Source tracking | `source_type` + `source_system` + `source_record_id` | Schema |
| ✅ Confidence | New `source_type` must be in `colony_source_confidence` | MIG_209 |
| ✅ Idempotency | Use `(source_system, source_record_id)` UNIQUE constraint | Schema |
| ✅ Audit trail | Raw data in `staged_records`, track via `ingest_runs` | MIG_001/003 |

**Observation API Validation (Created 2026-01-16):**
- ✅ Uses `place_colony_estimates` table (correct)
- ✅ Uses `source_type = 'trapper_site_visit'` (in confidence table, 80%)
- ✅ Uses `source_system = 'atlas_ui'` (valid TEXT value)
- ✅ Parameterized queries (secure)
- ✅ Returns Chapman estimate when data available
- ✅ No direct entity creation (place must exist)

### Ongoing Sync Strategy

**Goal:** Keep colony estimates up-to-date without manual intervention, using centralized patterns.

**Current State:**
- Project 75 sync exists (`airtable_project75_sync.mjs`) but has enum mismatch bug
- No scheduled sync - must run manually
- 569 estimates imported from `post_clinic_survey` source (62 with eartip data)

**Implementation Plan:**

1. **Fix Enum Mismatch (MIG_266)** ✅ CREATED
   - File: `sql/schema/sot/MIG_266__add_airtable_to_data_source_enum.sql`
   - Add 'airtable' to `trapper.data_source` enum
   - Run migration, then re-run Project 75 sync

2. **Backfill Project 75 Eartip Data (MIG_266 addition)** 🔴 HIGH PRIORITY
   - 506 records have ear-tip data in wrong column
   - Enables Chapman estimation for 422 places (up from 4)
   - Add to MIG_266:
   ```sql
   -- Backfill eartip observation data from Project 75 surveys
   UPDATE trapper.place_colony_estimates
   SET
     eartip_count_observed = altered_count,
     total_cats_observed = total_cats
   WHERE source_type = 'post_clinic_survey'
     AND altered_count IS NOT NULL
     AND eartip_count_observed IS NULL;
   ```

3. **Centralized Sync Cron**
   - Create `/api/cron/sync-colony-estimates` endpoint
   - Runs: Project 75 sync → new observations populate `place_colony_estimates`
   - Vercel cron schedule: daily or weekly
   - Logs sync stats to `ingest_runs` table

4. **Sync Status Dashboard**
   - Add to `/admin` page: last sync time, records synced, errors
   - Show out-of-sync warning if Airtable count > DB count

**Files to Create/Modify:**
- `sql/schema/sot/MIG_267__add_airtable_to_data_source_enum.sql` - Enum fix
- `/apps/web/src/app/api/cron/sync-colony-estimates/route.ts` - Cron endpoint
- Update `vercel.json` to add cron schedule

### Data Stability & Future-Proofing

**Audit Findings (2026-01-16) - Tresch Dairy Case Study:**

| Issue | Finding | Impact |
|-------|---------|--------|
| Cats at multiple places | 82 unique cats, but 154 place-links (double-counted) | Inflated colony stats |
| Duplicate colony estimates | Each place has 2 identical estimates | Bug in intake trigger |
| 0% observation data | No places have ear-tip observation data | Chapman estimator never runs |
| "Complete" but incomplete | System shows 100% altered but 3 males remain | Misleading progress |

- [ ] **Fix Duplicate Colony Estimate Bug**
  - `trg_request_colony_estimate` trigger appears to fire twice
  - Investigate and add duplicate prevention (ON CONFLICT DO NOTHING)

- [ ] **Ensure Future Intake Stability**
  - New submissions should NOT create duplicate places (already handled by `find_or_create_place_deduped`)
  - New submissions SHOULD link to existing place if address matches
  - When place already has colony estimate, new estimate should ADD not replace
  - Verify `source_type` distinguishes intake estimates from trapper observations

- [ ] **Add Data Validation for Cat-Place Links**
  - When cat linked to place A, and place A linked to place B via `same_colony_site`:
    - Auto-create cat-place link to B? (NO - could cause issues)
    - At minimum: show on UI that cat is part of larger site
  - Ensure merged cats don't create orphaned cat_place_relationships

- [ ] **Create Site-Level Reporting View**
  - `v_site_summary` - Groups linked places, de-duplicates cats
  - Required for accurate alteration rates at multi-parcel sites
  - Tresch example should show: 82 unique cats, not 154

### API Fixes

- [x] **Remove Legacy Fallback in Requests Endpoint** ✅ FIXED 2026-01-16
  - File: `/apps/web/src/app/api/requests/route.ts`
  - Issue: Fallback writes directly to `sot_requests` bypassing validation
  - Fix: Removed `handleLegacyDirectWrite()`, now throws explicit error

- [x] **Add Canonical Cat Resolution to Request Detail** ✅ FIXED 2026-01-16
  - File: `/apps/web/src/app/api/requests/[id]/route.ts:215-229`
  - Issue: Linked cats query didn't follow merge chain
  - Fix: Added LEFT JOIN to canonical_cat and COALESCE for merged entities

- [x] **Update Intake API to Use Centralized Functions** ✅ FIXED 2026-01-16
  - File: `/apps/web/src/app/api/intake/public/route.ts`
  - Issue: Direct INSERT without identity matching or place deduplication
  - Fix: Updated to use `web_intake_submissions` table, call `match_intake_to_person()` and `link_intake_submission_to_place()`

### Ingest Scripts

- [x] **Document ClinicHQ Processing Order** ✅ FIXED 2026-01-16
  - Files: `clinichq_*.mjs` scripts
  - Issue: Must run in order: appointment → owner → cat_info
  - Fix: Added warning comments to all three script headers

- [x] **Replace Direct INSERTs in Procedures Script** ✅ FIXED 2026-01-16
  - File: `/scripts/ingest/extract_procedures_from_appointments.mjs`
  - Issue: Direct INSERT into `sot_appointments` bypasses validation
  - Fix: Created MIG_261 with `process_pending_clinichq_appointments()` and `create_procedures_from_appointments()`, updated script to use them

### Database Integrity

- [x] **Add Ingest Guards for Merged Entities** ✅ FIXED 2026-01-16
  - Issue: Can recreate merged entities during ingest
  - Fix: Created MIG_262 with BEFORE INSERT triggers that auto-redirect to canonical entities

- [x] **Cascade Orphaned Identifiers to Canonical Entities** ✅ FIXED 2026-01-16
  - Issue: `person_identifiers` may point to merged people
  - Fix: MIG_262 includes migration to update all links and adds constraint triggers

---

## 🟠 MEDIUM PRIORITY (Next Sprint)

### UI Consistency

- [x] **Create Centralized Date Formatting Utility** ✅ CREATED 2026-01-16
  - Issue: 7+ files use different date formatting methods
  - Fix: Created `/apps/web/src/lib/formatters.ts` with `formatDateLocal()`, `formatDateTime()`, `formatRelativeDate()`, plus `formatPhone()`, `truncate()`, `formatCurrency()`, `formatNumber()`
  - TODO: Update pages to use new formatters (cats, people, places, requests)

- [x] **Add Requester Contact to Request List View** ✅ FIXED 2026-01-16
  - File: `/apps/web/src/app/api/requests/route.ts`
  - Issue: List only returns name, not phone/email
  - Fix: Created MIG_263 adding `requester_email`, `requester_phone` to v_request_list view, updated API

- [x] **Standardize Linked Cats Display** ✅ FIXED 2026-01-16
  - Issue: Different pages show different cat info (microchip, source badge)
  - Fix: Created `/apps/web/src/components/LinkedCatsSection.tsx` shared component
  - Handles different data shapes from requests, places, and people contexts

### Database Schema

- [x] **Add Missing FK Cascades** ✅ FIXED 2026-01-16
  - Tables: `person_place_relationships`, `cat_place_relationships`
  - Fix: Added `ON DELETE CASCADE` constraints via MIG_264

- [x] **Add Performance Indexes** ✅ FIXED 2026-01-16
  - `person_identifiers(id_type, id_value_norm)`
  - `sot_requests(place_id, status, source_system)`
  - `request_trapper_assignments(request_id, trapper_person_id)`
  - Fix: Created MIG_264 with comprehensive indexes for all core tables

- [x] **Add Unique Index on `normalized_address`** ✅ FIXED 2026-01-16
  - Issue: Race conditions during concurrent place creation
  - Fix: MIG_264 includes unique index on places.normalized_address

### API Improvements

- [x] **Standardize Audit Logging Pattern** ✅ FIXED 2026-01-16
  - Issue: Cat endpoint uses template literals, places uses parameterized queries, requests had none
  - Fix: Created `/apps/web/src/lib/audit.ts` centralized utility
  - Updated cats, places, and requests endpoints to use `logFieldEdits()` → `entity_edits` table

- [x] **Sanitize Error Messages** ✅ FIXED 2026-01-16
  - Issue: Some endpoints expose full database error details
  - Fix: Updated 15+ API endpoints to return generic messages, log details server-side

---

## 🟢 LOW PRIORITY (Backlog)

### UI Enhancements

- [ ] **Add Colony Health Section to Places Page**
  - Show aggregated cat vitals (avg weight, FeLV rates) for location

- [ ] **Add Medical Badges to Linked Cats**
  - Show FeLV status, altered status next to cat names on people/places pages

- [ ] **Implement Photo Upload for Cats**
  - Current: PhotoSection shows "Add Photo" but no upload capability

- [ ] **Create Shared Error Display Component**
  - Unify error/empty state display across pages

### Data Quality

- [ ] **Add Name Validation to All Ingest Scripts**
  - Use `is_valid_person_name()` consistently

- [ ] **Create Periodic Duplicate Detection Job**
  - Run `SELECT * FROM v_pending_person_duplicates` periodically
  - Notify staff when duplicates exceed threshold

### Documentation

- [ ] **Document Attribution Window Logic**
  - Explain MIG_208 rolling windows in developer docs

- [ ] **Create Ingest Flow Diagram**
  - Visual showing staging → processing → entity creation

---

## ✅ COMPLETED

_Move items here when done with date completed_

### 2026-01-16
- [x] **KML Data Extraction** - Parsed FFSC Colonies KML file
  - Extracted 5,724 placemarks, 2,546 with useful data ready for import
  - Identified 274 records with TNR counts (2,886 cats total)
  - Extracted qualitative signals: temperament (1,063), relocated (497), pregnant_nursing (481)
  - Identified top trappers: Emily F (29), Sherry P (26), Susan E (19)
  - Output saved to `/tmp/kml_extracted_data.json`
- [x] **Documented Clinic-Grounded Approach** - Using verified clinic data as ground truth for M (marked cats)
  - `ownership_type` field exists in `sot_cats` and `sot_appointments` (Owned/Community/Foster)
  - `v_place_ecology_stats.a_known` already calculates verified altered cats
  - Added task to leverage ownership types for accurate colony analytics
- [x] **Inventoried All Qualitative Data Sources** - Complete inventory of parseable notes fields
  - 16+ notes fields across sot_requests, sot_appointments, web_intake_submissions
  - Prioritized by data quality: HIGH (notes, internal_notes, situation_description), MEDIUM (legacy_notes, urgency_notes), LOW (access_notes, etc.)
  - Defined parse patterns: cat counts, eartip observations, colony status, urgency signals
  - Added 4 new source_types with confidence levels (internal_notes_parse: 40%, appointment_notes_parse: 35%, intake_situation_parse: 45%, legacy_mymaps: 50%)
- [x] **Created MIG_267 Data Enrichment Infrastructure** - Prerequisites for all parser scripts
  - File: `sql/schema/sot/MIG_267__data_enrichment_infrastructure.sql`
  - Adds new source_types to colony_source_confidence
  - Adds 'monitoring' hold reason for nearly-complete sites
  - Adds 'web_app' to data_source enum
  - Adds duplicate prevention index for colony estimates
- [x] **Created Parser Scripts** - Ready for deployment after MIG_267
  - `scripts/ingest/parse_request_notes_estimates.mjs` - Request notes parser
  - `scripts/ingest/parse_intake_situation.mjs` - Intake situation parser
  - `scripts/ingest/mymaps_kml_import.mjs` - KML historical import
- [x] **Ran All Parser Scripts** ✅ COMPLETED 2026-01-16
  - **KML Import**: 1,810 estimates inserted (73% match rate, 1,746 unique places)
  - **Intake Situation**: 32 estimates inserted (31 unique places)
  - **Request Notes**: 41 estimates inserted (40 unique places)
  - **Total**: 1,883 new colony estimates added to database
  - **Verification**: `SELECT source_type, COUNT(*) FROM place_colony_estimates GROUP BY source_type`
- [x] **Created Historical Context Card** - UI component + API for surfacing historical data
  - Component: `/apps/web/src/components/HistoricalContextCard.tsx`
  - API: `/apps/web/src/app/api/places/[id]/history/route.ts`
  - Shows: quasi-quantitative data, date range, qualitative signals, notes with attribution
  - Privacy: filters profanity, redacts phones, uses staff abbreviations (MP, JK, HF, DF)
  - Labels as "nearby activity" since KML coords may not be exact (within ~50m)
  - Includes disclaimer about coordinate-based matching
  - Placeholder for future AI-generated summary
- [x] **Database & Architecture Audit** - Validated TODO implementations against core patterns
  - Verified observation API uses correct centralized patterns
  - **Found critical data gap:** 506 Project 75 records have eartip data in wrong column
  - **Solution:** Backfill enables Chapman for 422 places (100x improvement from 4)
  - Confirmed 7,313 places have verified clinic data (ground truth)
  - Added architecture validation checklist to TODO
- [x] Created MIG_266: Add 'airtable' to data_source enum + Project 75 eartip backfill
- [x] Created observation API endpoint: `POST /api/places/[id]/observations`
- [x] Documented colony estimate data enrichment strategy in TODO
- [x] Documented ongoing sync strategy with cron approach
- [x] Comprehensive codebase audit (API, UI, ingest, database)
- [x] Created TODO tracking document
- [x] Fixed SQL injection in cat audit logging (parameterized queries)
- [x] Removed embedded Airtable tokens from 5 ingest scripts
- [x] Created MIG_259 for `canonical_person_id()` alias
- [x] Removed legacy fallback direct write in requests endpoint
- [x] Added canonical cat resolution to request detail (merged cat handling)
- [x] Documented ClinicHQ processing order in script headers
- [x] Created centralized formatters utility (`/apps/web/src/lib/formatters.ts`)
- [x] Created MIG_260 for `merge_people()` and `undo_person_merge()` functions
- [x] Created `/api/cron/process-uploads` auto-processing cron endpoint
- [x] Updated public intake API to use centralized person/place functions
- [x] Created MIG_261 with centralized ClinicHQ appointment processing functions
- [x] Updated procedures script to use SQL functions instead of direct INSERTs
- [x] Created MIG_262 for merge entity guards (auto-redirect identifiers to canonical entities)
- [x] Cascaded orphaned identifiers/relationships to canonical entities
- [x] Created MIG_263 adding requester contact info to v_request_list
- [x] Created MIG_264 with comprehensive performance indexes and FK cascades
- [x] Sanitized error messages in 15+ API endpoints
- [x] Created `LinkedCatsSection` shared component (`/apps/web/src/components/LinkedCatsSection.tsx`)
- [x] Created centralized audit utility (`/apps/web/src/lib/audit.ts`)
- [x] Added audit logging to requests endpoint (previously had none)
- [x] Audited place data quality: found 565 duplicate pairs, 0 place_place_edges
- [x] Documented multi-parcel site linking protocol (Tresch Dairy case study)

---

## Notes

### Source System Values
Always use exactly:
- `'airtable'` - All Airtable data
- `'clinichq'` - All ClinicHQ data
- `'web_intake'` - Web intake form submissions

### Centralized Functions (MUST USE)
| Entity | Function |
|--------|----------|
| Person | `trapper.find_or_create_person()` |
| Place | `trapper.find_or_create_place_deduped()` |
| Cat | `trapper.find_or_create_cat_by_microchip()` |

### Key Views
| View | Purpose |
|------|---------|
| `v_request_alteration_stats` | Cat attribution with rolling windows |
| `v_trapper_full_stats` | Trapper statistics |
| `v_place_colony_status` | Colony size estimates |

### Atlas → Beacon Data Flow

**How Atlas provides clean data for Beacon analytics:**

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA COLLECTION                           │
├─────────────────────────────────────────────────────────────┤
│  Intake Forms → place_colony_estimates (source: intake_form) │
│  Project 75   → place_colony_estimates (source: post_clinic) │
│  Trappers     → place_colony_estimates (source: site_visit)  │
│  ClinicHQ     → sot_cats + cat_place_relationships           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    ANALYTICS VIEWS                           │
├─────────────────────────────────────────────────────────────┤
│  v_place_ecology_stats:                                      │
│    - a_known: Verified altered cats (ground truth)           │
│    - n_hat_chapman: Population estimate (mark-resight)       │
│    - p_hat_chapman_pct: Alteration % (Chapman-based)         │
│    - estimated_work_remaining: Cats still needing TNR        │
│                                                              │
│  v_place_colony_status:                                      │
│    - colony_size_estimate: Weighted average of all sources   │
│    - final_confidence: Weighted by recency + source type     │
│    - is_multi_source_confirmed: 2+ sources agree             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    BEACON ANALYTICS                          │
├─────────────────────────────────────────────────────────────┤
│  Population Predictions:                                     │
│    - Uses n_hat_chapman when eartip data available           │
│    - Falls back to n_recent_max when not                     │
│    - Applies confidence weights to predictions               │
│                                                              │
│  TNR Timeline Predictions:                                   │
│    - Work remaining = best_estimate - a_known                │
│    - Prioritization based on alteration rate                 │
│    - Resource allocation optimization                        │
└─────────────────────────────────────────────────────────────┘
```

**Critical Gap for Beacon:**
- Only 4 of 7,456 places have mark-resight data
- This limits Beacon to "lower-bound" estimates for 99.9% of places
- Observation API + UI will increase mark-resight coverage

### Multi-Parcel Site Protocol
For large operations spanning multiple addresses (like dairies, ranches, apartment complexes):

1. **DO NOT merge** different addresses - they're distinct places
2. **Link with `same_colony_site`** edge in `place_place_edges` table
3. **Keep separate requests** per address for attribution accuracy
4. **Aggregate reporting** uses linked places for combined stats

```sql
-- Link two places as same colony site
INSERT INTO trapper.place_place_edges (place_id_a, place_id_b, relationship_type_id, direction, note)
SELECT
  'place-uuid-1',
  'place-uuid-2',
  id,
  'bidirectional',
  'Description of relationship'
FROM trapper.relationship_types
WHERE code = 'same_colony_site';
```
