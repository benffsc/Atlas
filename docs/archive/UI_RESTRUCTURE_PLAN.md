# Atlas UI Restructure Plan

**Last Updated:** 2026-02-21

---

## Phase 1: Foundation ✅ COMPLETE

**Status:** All Phase 1 tasks completed on 2026-02-21.

| File | Purpose | Status |
|------|---------|--------|
| `/src/lib/constants.ts` | Status enums, soft blacklists, source systems | ✅ Created |
| `/src/lib/guards.ts` | Client-side validation (mirrors SQL gates) | ✅ Created |
| `/src/lib/uuid.ts` | UUID validation and utilities | ✅ Created |
| `/src/types/entities.ts` | Core entity types (Person, Place, Cat, Request) | ✅ Created |
| `/src/types/api.ts` | API request/response types | ✅ Created |
| `/src/types/map.ts` | Map state, pins, layers types | ✅ Created |
| `/src/types/index.ts` | Barrel export | ✅ Created |

---

## Research Findings: Best Practices for Data-Dense UIs

### Data Density Design Principles

Sources: [UXPin Dashboard Design](https://www.uxpin.com/studio/blog/dashboard-design-principles/), [DataCamp Tutorial](https://www.datacamp.com/tutorial/dashboard-design-tutorial), [Design Studio UI/UX](https://www.designstudiouiux.com/blog/dashboard-ui-design-guide/)

1. **Tight but consistent spacing** — Use 4px, 8px, or 12px grid spacing (not 16-24px) for dense UIs
2. **Progressive disclosure** — Hide rarely used controls behind "More" or "..." menus
3. **Visual hierarchy** — Place critical KPIs top/left, group related metrics, use larger type for primaries
4. **Tooltips over labels** — Hide specific labels and show on hover in dense views
5. **Skeleton loaders** — Users expect responsiveness within 2-3 seconds

### Map Performance Strategies

Sources: [Andrej Gajdos Map Guide](https://andrejgajdos.com/leaflet-developer-guide-to-high-performance-map-visualizations-in-react/), [Leigh Halliday Clustering](https://www.leighhalliday.com/leaflet-clustering/), [Sam Kuikka Next.js Clustering](https://www.samikuikka.com/en/blog/how-to-cluster-thousand-of-markers-with-leaflet/)

| Approach | Performance | Use Case |
|----------|-------------|----------|
| **SuperCluster** | 500k markers in 1-2 seconds | Large datasets (our case) |
| **Leaflet.markercluster** | 6+ minutes for 500k markers | Small datasets only |
| **Backend clustering** | Minimal client load | Very large datasets (future) |
| **Canvas rendering** | Better than SVG above 10k | Dense pin areas |

**Key recommendations:**
- Use `useMemo` extensively for 100k+ objects
- Consider @changey/react-leaflet-markercluster for React 18+ compatibility
- Use Supercluster with react-leaflet for best performance

### React Refactoring Strategies

Sources: [Telerik React Patterns 2025](https://www.telerik.com/blogs/react-design-patterns-best-practices), [Steve Kinney TypeScript Migration](https://stevekinney.com/courses/react-typescript/migrating-javascript-to-typescript), [Brainhub React Migration](https://brainhub.eu/library/migrating-to-react)

**Incremental Migration Principles:**
1. **Keep `allowJs: true`** — Let TypeScript and JavaScript coexist
2. **Start at boundaries** — Migrate API interfaces, utility functions, core data models first
3. **Convert file by file** — Don't do big-bang rewrites
4. **Use adapter layers** — Create typed wrappers around untyped legacy code
5. **Enable strict rules gradually** — Fix errors incrementally, not all at once

---

## Risk Mitigation Strategy

### Principles

1. **Never break production** — All changes must be incremental and reversible
2. **Parallel paths during transition** — Old and new components coexist
3. **Feature flags for new UI** — Toggle between old and new implementations
4. **Test coverage before refactor** — Add tests to existing code before changing it
5. **Small PRs** — Each change should be independently deployable

### Specific Risk Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking imports** | Use barrel exports (`index.ts`) so import paths don't change |
| **Type errors cascade** | Start with `// @ts-ignore` or `any`, then tighten incrementally |
| **Map performance regression** | Add performance monitoring (FPS, load time) before changes |
| **State management breakage** | Extract hooks FIRST, then refactor components |
| **API contract changes** | Types are additive only — never remove optional fields |
| **Component coupling** | Use props for data, events for actions — no direct imports between features |

### File Movement Strategy

**DO:**
```
1. Create new directory structure
2. Copy file to new location
3. Update imports to new location
4. Add re-export from old location: `export * from '../new/path'`
5. Verify app works
6. Update remaining imports in batches
7. Remove re-export after all imports updated
```

**DON'T:**
```
1. Move file
2. Fix all imports at once
3. Deploy
```

---

## Current V2 Data Status

All major data sources are integrated and available in V2 SOT tables.

| Source | Status | Records | Notes |
|--------|--------|---------|-------|
| **ClinicHQ** | ✅ Full | 42,486 cats, 10,578 people, 31,989 owner links | Primary source |
| **ShelterLuv** | ✅ Full | 1,204 cats, 2,597 people, 65 owner links | Outcomes/adoptions |
| **PetLink** | ✅ Full | 1,691 cats, 1,713 microchip IDs | Registry data |
| **VolunteerHub** | ✅ Full | 959 roles for 679 people in `ops.volunteer_roles` | MIG_2366-2367 applied |
| **Airtable** | ✅ Full | Legacy requests integrated | Historical data |
| **Web Intake** | ✅ Full | 1,221 submissions in `ops.intake_submissions` | Live intake |

**Volunteer Data (MIG_2366-2367 Applied):**
- 959 role records created
- 679 unique people with roles
- Distribution: volunteer (806), foster (103), trapper (23), caretaker (14), staff (13)

---

## Data Gap Remediation Plan

### Comprehensive Audit Results (2026-02-19)

#### Schema Summary

| Schema | Tables | Key Tables (non-zero) |
|--------|--------|----------------------|
| **source** | 20 | `clinichq_raw` (423,988), `google_map_entries` (5,620), `volunteerhub_*` (1,346+1,876+47) |
| **ops** | 71 | `appointments` (38,762), `cat_procedures` (33,679), `staged_records` (8,713), `requests` (291) |
| **sot** | 47 | `cats` (40,220), `cat_identifiers` (74,841), `people` (10,578), `places` (7,838) |
| **beacon** | 1 | `colony_estimates` (0) — **completely empty** |

#### Relationship Coverage Gaps

| Gap | Count | Root Cause | Impact |
|-----|-------|------------|--------|
| **Cats without place** | 5,433 | No `inferred_place_id` on appointments | Can't show on map |
| **Cats without person** | 7,959 | No owner info in ClinicHQ appointments | Can't contact for follow-up |
| **People without place** | 2,572 | Identity created but no address captured | Can't show on map |
| **Appointments without person** | 5,308 | ClinicHQ appointments without owner info | Expected for colony cats |
| **Appointments without place** | 1,723 | No `place_id` or `inferred_place_id` | Can't attribute to location |
| **Addresses not geocoded** | 616 | Geocoding queue backlog | Places missing from map |

#### Source Data Processing Gaps

| Source | Status | Gap | Remediation |
|--------|--------|-----|-------------|
| **VolunteerHub** | ⚠️ Partial | 178 matched, 1,168 unmatched; `ops.volunteers` empty | Fix function + re-run matching |
| **ShelterLuv** | ⚠️ Partial | 4,000 staged animals pending; no events synced | Process staged + sync events |
| **ClinicHQ** | ⚠️ Partial | 741 staged records pending | Process with existing functions |
| **Beacon** | ❌ Empty | `beacon.colony_estimates` has 0 records | Run colony estimation pipeline |

#### Event Table Gaps

| Table | Count | Data Source | Remediation |
|-------|-------|-------------|-------------|
| `sot.cat_intake_events` | 0 | ShelterLuv events | Sync events + run `process_shelterluv_intake_events()` |
| `sot.cat_mortality_events` | 0 | ShelterLuv + ClinicHQ | Extract from outcomes |
| `sot.cat_movement_events` | 0 | ShelterLuv transfers | Extract from events |
| `sot.place_colony_estimates` | 0 | Calculated | Run colony estimation pipeline |

---

### Remediation Migrations

#### MIG_2350: Fix VolunteerHub Matching Function

**Problem:** `sot.match_volunteerhub_volunteer()` calls `data_engine_resolve_identity()` with wrong parameter signature (8 params vs 6 actual).

```sql
-- Fix the function call signature
CREATE OR REPLACE FUNCTION sot.match_volunteerhub_volunteer(p_volunteerhub_id text)
RETURNS uuid
LANGUAGE plpgsql AS $$
-- ... (update data_engine_resolve_identity call to use only 6 params)
-- p_email, p_phone, p_first_name, p_last_name, p_address, p_source_system
$$;

-- Re-run matching for all unmatched volunteers
SELECT sot.match_all_volunteerhub_volunteers();
```

**Expected Result:** ~1,168 volunteers matched to `sot.people`.

---

#### MIG_2351: Process VolunteerHub Group Roles

**Problem:** Matched volunteers (178) have roles, but 1,168 unmatched don't.

```sql
-- After MIG_2350, run role processing for all matched volunteers
DO $$
DECLARE
  v_record RECORD;
BEGIN
  FOR v_record IN
    SELECT volunteerhub_id, matched_person_id
    FROM source.volunteerhub_volunteers
    WHERE matched_person_id IS NOT NULL
  LOOP
    PERFORM ops.process_volunteerhub_group_roles(v_record.matched_person_id, v_record.volunteerhub_id);
  END LOOP;
END $$;
```

---

#### MIG_2352: Populate ops.volunteers

**Problem:** `ops.volunteers` has 0 records despite 1,346 volunteers in source.

```sql
-- Create function to populate ops.volunteers from matched source data
CREATE OR REPLACE FUNCTION ops.populate_volunteers_from_source()
RETURNS TABLE(inserted INT, updated INT, errors INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_errors INT := 0;
BEGIN
  INSERT INTO ops.volunteers (
    person_id, volunteerhub_id, status,
    is_trapper, is_foster, is_clinic_volunteer, is_coordinator,
    trapper_type, groups, source_system, joined_at
  )
  SELECT
    vv.matched_person_id,
    vv.volunteerhub_id,
    COALESCE(vv.status, 'active'),
    EXISTS (SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = vv.matched_person_id AND pr.role = 'trapper' AND pr.role_status = 'active'),
    EXISTS (SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = vv.matched_person_id AND pr.role = 'foster' AND pr.role_status = 'active'),
    EXISTS (SELECT 1 FROM source.volunteerhub_group_memberships vgm
            JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
            WHERE vgm.volunteerhub_id = vv.volunteerhub_id
            AND vug.name ILIKE '%clinic%' AND vgm.left_at IS NULL),
    EXISTS (SELECT 1 FROM sot.person_roles pr WHERE pr.person_id = vv.matched_person_id AND pr.role = 'staff' AND pr.role_status = 'active'),
    (SELECT pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = vv.matched_person_id AND pr.role = 'trapper' LIMIT 1),
    (SELECT ARRAY_AGG(vug.name) FROM source.volunteerhub_group_memberships vgm
     JOIN source.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
     WHERE vgm.volunteerhub_id = vv.volunteerhub_id AND vgm.left_at IS NULL),
    'volunteerhub',
    vv.joined_at
  FROM source.volunteerhub_volunteers vv
  WHERE vv.matched_person_id IS NOT NULL
  ON CONFLICT (volunteerhub_id) DO UPDATE SET
    status = EXCLUDED.status,
    is_trapper = EXCLUDED.is_trapper,
    is_foster = EXCLUDED.is_foster,
    is_clinic_volunteer = EXCLUDED.is_clinic_volunteer,
    groups = EXCLUDED.groups,
    updated_at = NOW();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN QUERY SELECT v_inserted, v_updated, v_errors;
END $$;

-- Run population
SELECT * FROM ops.populate_volunteers_from_source();
```

---

#### MIG_2353: Process Pending ShelterLuv Animals

**Problem:** 3,998 ShelterLuv animals in `ops.staged_records` not processed.

```sql
-- Process pending ShelterLuv animals
SELECT ops.process_shelterluv_animal(500); -- Run in batches
-- Repeat until all processed
```

---

#### MIG_2354: Sync ShelterLuv Events + Process Intake

**Problem:** No ShelterLuv events synced; `sot.cat_intake_events` is empty.

```bash
# Step 1: Run ShelterLuv API sync with events
node scripts/ingest/shelterluv_api_sync.mjs --events

# Step 2: Process intake events
```

```sql
-- Process intake events from staged records
SELECT * FROM ops.process_shelterluv_intake_events(1000);
```

---

#### MIG_2355: Run Geocoding Backlog

**Problem:** 616 addresses not geocoded.

```sql
-- Check geocoding queue status
SELECT geocoding_status, COUNT(*)
FROM sot.addresses
GROUP BY geocoding_status;

-- Re-queue failed addresses
UPDATE sot.addresses
SET geocoding_status = 'pending', geocoded_at = NULL
WHERE geocoding_status = 'failed';
```

```bash
# Trigger geocoding cron or manual run
curl -X POST https://your-app/api/cron/geocode-addresses
```

---

#### MIG_2356: Initialize Beacon Colony Estimates

**Problem:** `beacon.colony_estimates` is completely empty.

```sql
-- Run colony estimation pipeline
SELECT beacon.calculate_colony_estimates();
-- Or if that doesn't exist, create initial estimates from place data
INSERT INTO beacon.colony_estimates (place_id, estimated_low, estimated_high, confidence, calculation_method)
SELECT
  p.place_id,
  COALESCE(pce.estimated_low, cp.cat_count * 0.8),
  COALESCE(pce.estimated_high, cp.cat_count * 1.2),
  0.5,
  'initial_from_cat_count'
FROM sot.places p
LEFT JOIN sot.place_colony_estimates pce ON pce.place_id = p.place_id
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM sot.cat_place
  GROUP BY place_id
) cp ON cp.place_id = p.place_id
WHERE cp.cat_count > 0
  AND p.merged_into_place_id IS NULL
ON CONFLICT DO NOTHING;
```

---

### Remediation Order

| Priority | Migration | Dependencies | Est. Impact |
|----------|-----------|--------------|-------------|
| 1 | MIG_2350 | None | Enable 1,168 volunteer matches |
| 2 | MIG_2351 | MIG_2350 | Assign roles to matched volunteers |
| 3 | MIG_2352 | MIG_2351 | Populate ops.volunteers (1,346 records) |
| 4 | MIG_2353 | None | Process 3,998 ShelterLuv animals |
| 5 | MIG_2354 | MIG_2353 | Populate cat_intake_events |
| 6 | MIG_2355 | None | Geocode 616 addresses |
| 7 | MIG_2356 | MIG_2355 | Initialize beacon estimates |

**Total estimated new records:**
- ops.volunteers: +1,346
- sot.person_roles: +1,000+
- sot.cats: +3,998 (from ShelterLuv staged)
- sot.cat_intake_events: +500+ (from events)
- beacon.colony_estimates: +2,000+ (from places with cats)

---

### VolunteerHub API Re-sync Option

Since secrets are available, a full VolunteerHub re-sync can be run:

```bash
# Full re-sync from VolunteerHub API
cd /Users/benmisdiaz/Projects/Atlas
node scripts/ingest/volunteerhub_api_sync.mjs --full-sync --verbose
```

This will:
1. Fetch all volunteers from VolunteerHub API
2. Upsert into `source.volunteerhub_volunteers`
3. Sync group memberships to `source.volunteerhub_group_memberships`
4. Attempt matching to `sot.people` (will fail on data_engine call - need MIG_2350 first)

**Recommended Order:**
1. Apply MIG_2350 (fix function signature)
2. Run `node scripts/ingest/volunteerhub_api_sync.mjs --full-sync`
3. Apply MIG_2351 + MIG_2352

---

## Executive Summary

The UI currently mirrors V1's data sprawl problems. Just as V1 had 280+ tables in one schema, the UI has 88 flat components, no centralized types, and scattered validation. This plan applies the same V2 architectural principles to the frontend.

### Changes Made This Session (Ready for Commit)

| Change | File | Fix |
|--------|------|-----|
| Confidence type fix | `ingest/process/[id]/route.ts:740` | `'high'` → `0.8` |
| Operator precedence fix | `ingest/process/[id]/route.ts:846` | Added parentheses around `->>` |
| Enum type fix | `ingest/process/[id]/route.ts:1002-1004` | `test_result_enum` → `test_result` |
| Column name fix | `ingest/process/[id]/route.ts:1118` | `link_purpose` → `link_type` |
| Alias conflict fix | `ingest/process/[id]/route.ts:1129-1131` | `cp` → `catpl`, `proc` |

**Result:** All 3 ClinicHQ batch files now process successfully.

---

## Part 1: The Problem — V1 UI Patterns

### Current State Analysis

| Metric | Current | Problem |
|--------|---------|---------|
| Components at root | 88 files | Hard to navigate |
| Duplicate `formatDate()` | 20+ copies | Inconsistent behavior |
| Duplicate `isValidUUID()` | 6 copies | Maintenance burden |
| Pages over 2000 lines | 4 files | God components |
| Place interface variants | 6 different | No type authority |
| Routes bypassing `@/lib/db` | 3 routes | Connection leaks |

### Data Gaps That Reveal UI Needs

From `DATA_GAPS.md` patterns:

| Data Gap | UI Lesson |
|----------|-----------|
| DATA_GAP_009: Org email pollution | Need email validation UI before submit |
| DATA_GAP_010: Location-as-person | Need name classifier feedback |
| DATA_GAP_011: Org-like names | Need visual indicator for suspect records |
| DATA_GAP_012: Duplicate records | Need merge UI with side-by-side comparison |
| DATA_GAP_013: Scattered validation | Need single validation path like `should_be_person()` |

---

## Part 2: Workflow-Specific Improvements

### 2.1 Clinic Day Operations (Photo Upload + Number Assignment)

**Current Flow:** Upload photos → Manual microchip entry → Assign numbers

**Problems:**
- No batch preview before commit
- No undo for number assignment
- No progress indicator for processing

**Improved Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│  CLINIC DAY: February 18, 2026                                  │
│  45 Appointments | 41 TNR Procedures | 44 Cats Chipped         │
├─────────────────────────────────────────────────────────────────┤
│  [1] Upload Photos                                              │
│      ┌────────────────────────────────────────────────────┐    │
│      │  Drag photos here or click to browse               │    │
│      │  [Pre-Surgery]  [Post-Surgery]  [Ear Tips]        │    │
│      └────────────────────────────────────────────────────┘    │
│                                                                 │
│  [2] Auto-Match to Appointments                                 │
│      [████████████████████░░░░] 85% - Matching 38/45...        │
│                                                                 │
│  [3] Review & Confirm                                           │
│      ┌────┬─────────────┬─────────────┬─────────────┐          │
│      │ #  │ Photo       │ Cat         │ Microchip   │          │
│      ├────┼─────────────┼─────────────┼─────────────┤          │
│      │ 01 │ [preview]   │ Unknown     │ 981020...   │          │
│      │ 02 │ [preview]   │ Whiskers    │ 981020...   │          │
│      └────┴─────────────┴─────────────┴─────────────┘          │
│                                                                 │
│  [Cancel]  [Save as Draft]  [Confirm Assignment]                │
└─────────────────────────────────────────────────────────────────┘
```

**Key Improvements:**
1. **Organized drop zones** — Separate areas for pre/post surgery photos
2. **Progress indicator** — Shows matching progress
3. **Preview table** — See assignments before commit
4. **Save as draft** — Escape hatch to pause work
5. **Undo capability** — Toast with 30-second undo after confirm

### 2.2 Web Intake (Public Form Submission)

**Current Flow:** Multi-step wizard → Submit → Manual triage

**Problems:**
- Address validation only at backend
- No early warning for org names
- No confidence indicator for matched places

**Improved Flow:**

```
STEP 1: Location
┌─────────────────────────────────────────────────────────────────┐
│  Where are the cats located?                                    │
│                                                                 │
│  Address: [123 Main St, Petaluma, CA_______________]            │
│           ✓ Found: 123 Main Street, Petaluma, CA 94952         │
│           📍 Existing Site: 12 cats TNR'd here                  │
│                                                                 │
│  [Map showing pin at location]                                  │
│                                                                 │
│  [Back]  [Continue]                                             │
└─────────────────────────────────────────────────────────────────┘

STEP 2: Cat Information
┌─────────────────────────────────────────────────────────────────┐
│  How many cats need help?                                       │
│                                                                 │
│  Cats needing TNR:  [8_____] ← stepper control                  │
│                                                                 │
│  □ Friendly (can be handled)                                    │
│  ☑ Feral (trap required)                                        │
│  □ Kittens present                                              │
│  □ Injured/sick cats                                            │
│                                                                 │
│  [Back]  [Continue]                                             │
└─────────────────────────────────────────────────────────────────┘

STEP 3: Your Information
┌─────────────────────────────────────────────────────────────────┐
│  How can we contact you?                                        │
│                                                                 │
│  Name:  [John Smith_______________________]                     │
│  Email: [john@example.com_________________] ✓ Valid             │
│  Phone: [(707) 555-1234___________________] ✓ Valid             │
│                                                                 │
│  ⚠️ If you're reporting cats at a business or organization,     │
│     please provide your personal contact info, not the org's.   │
│                                                                 │
│  [Back]  [Continue]                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Key Improvements:**
1. **Dynamic address validation** — Show match status as user types
2. **Existing site indicator** — Show if location already known to FFSC
3. **Stepper for cat count** — Constrained input prevents errors
4. **Format-as-you-type** — Phone auto-formats to `(XXX) XXX-XXXX`
5. **Org email warning** — Tooltip warns against using org emails
6. **Client-side guards** — `shouldBePerson()` before submit

### 2.3 Request Management (Lifecycle Tracking)

**Current Flow:** List view → Detail page → Manual status updates

**Problems:**
- Status transitions not validated client-side
- Timeline hidden, requires SQL to see history
- Attribution not visible

**Improved Flow:**

```
REQUEST #1234 — 123 Main St, Petaluma
┌─────────────────────────────────────────────────────────────────┐
│  Status Pipeline                                                │
│  [New] → [Triaged] → [Scheduled] → [In Progress] → [Completed] │
│           ↓                                                     │
│        [On Hold] → [Cancelled]                                  │
│                                                                 │
│  Current: █████░░░░░ In Progress (Day 12)                       │
├─────────────────────────────────────────────────────────────────┤
│  Details                        │  Timeline                     │
│  ─────────────────────────      │  ─────────────────────────    │
│  Cats Reported: 8               │  Feb 18: In Progress          │
│  Cats TNR'd: 3                  │    └── Site visit by Jane D.  │
│  Trapper: Jane Doe              │  Feb 15: Scheduled            │
│  Zone: North Petaluma           │    └── Assigned to Jane D.    │
│                                 │  Feb 12: Triaged              │
│  [Edit Details]                 │    └── Set priority: High     │
│                                 │  Feb 10: Created              │
│                                 │    └── Via web intake         │
├─────────────────────────────────────────────────────────────────┤
│  Linked Cats (3)                                                │
│  ┌────────┬─────────────┬─────────────┬─────────────┐          │
│  │ Name   │ Microchip   │ Procedure   │ Date        │          │
│  ├────────┼─────────────┼─────────────┼─────────────┤          │
│  │ Unknown│ 981020...   │ Spay        │ Feb 18      │          │
│  │ Whisker│ 981020...   │ Neuter      │ Feb 18      │          │
│  │ Shadow │ 981020...   │ Spay        │ Feb 18      │          │
│  └────────┴─────────────┴─────────────┴─────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Actions (valid from current state)                             │
│  [Complete Request]  [Put On Hold]  [Add Note]                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Improvements:**
1. **Visual status pipeline** — See all states and current position
2. **Progress bar** — Shows completion percentage
3. **Visible timeline** — No SQL needed to see history
4. **Attributed cats** — Shows cats linked via attribution windows
5. **Valid actions only** — Buttons reflect allowed state transitions

### 2.4 Atlas Map (Geographic Visualization)

**Current Flow:** All pins at once → Filter by layer → Click for detail

**Problems:**
- 3,377 line god component
- Slow with many pins
- Detail panel crowded

**Improved Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│  [Search: ___________________] [Layers ▼] [Filter ▼]            │
├───────────────────────────────────────┬─────────────────────────┤
│                                       │  123 Main St            │
│       [12]     📍                     │  ─────────────────────  │
│                                       │                         │
│            📍                         │  Colony Status          │
│     📍           📍                   │  ├── Estimated: 8-12    │
│          [23]                         │  ├── TNR'd: 6           │
│                      📍               │  └── Coverage: 50-75%   │
│  📍                                   │                         │
│                                       │  Recent Activity        │
│       📍    📍                        │  ├── Last TNR: Feb 18   │
│                                       │  ├── Last visit: Feb 18 │
│                                       │  └── Appointments: 3    │
│                                       │                         │
│  [+] [-] [📍 My Location]             │  [View Full Details]    │
│                                       │  [Create Request]       │
└───────────────────────────────────────┴─────────────────────────┘
```

**Key Improvements:**
1. **Clustering** — Aggregate pins at zoom levels to reduce clutter
2. **Split panel** — Map + detail sidebar (70/30 split)
3. **Progressive disclosure** — Summary in panel, full detail on click
4. **Quick actions** — Create request directly from map pin
5. **Shape + color coding** — Accessible status indicators

### 2.5 Admin Data Management

**Current:** Scattered pages for dedup, quality review, etc.

**Improved:** Unified Data Hub with workflow queues

```
DATA HUB
┌─────────────────────────────────────────────────────────────────┐
│  Review Queues                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [Person Duplicates]     12 pending    [Review →]              │
│  [Place Duplicates]       3 pending    [Review →]              │
│  [Cat Duplicates]         8 pending    [Review →]              │
│  [Org Name Review]       47 pending    [Review →]              │
│  [Low Confidence]        39 pending    [Review →]              │
│                                                                 │
│  Quick Stats                                                    │
│  ─────────────────────────────────────────────────────────────  │
│  People: 10,572    Places: 7,837    Cats: 39,757               │
│  Data Quality Score: 94.2%                                      │
│                                                                 │
│  Recent Imports                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Feb 18: ClinicHQ batch (45 appointments, 44 cats)    ✓        │
│  Feb 17: ShelterLuv sync (12 outcomes)                ✓        │
│  Feb 16: Web intake (3 submissions)                   ✓        │
└─────────────────────────────────────────────────────────────────┘
```

**Merge Review Interface:**

```
DUPLICATE REVIEW — People (12 pending)
┌─────────────────────────────────────────────────────────────────┐
│  Match Confidence: 87%  │  Reason: Same email, similar name    │
├─────────────────────────┬───────────────────────────────────────┤
│  RECORD A (Winner)      │  RECORD B (Loser)                     │
├─────────────────────────┼───────────────────────────────────────┤
│  Name: John Smith       │  Name: Johnny Smith                   │
│  Email: john@ex.com ●   │  Email: jsmith@work.com ●             │
│  Phone: (707) 555-1234  │  Phone: —                             │
│  Cats: 3                │  Cats: 1                              │
│  Places: 2              │  Places: 1                            │
│  Source: ClinicHQ       │  Source: Web Intake                   │
│  Created: 2024-01-15    │  Created: 2024-06-20                  │
├─────────────────────────┴───────────────────────────────────────┤
│  After Merge:                                                   │
│  Name: John Smith  |  Emails: 2  |  Cats: 4  |  Places: 2       │
├─────────────────────────────────────────────────────────────────┤
│  [Not a Duplicate]  [Swap Primary]  [Preview]  [Confirm Merge]  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Technical Implementation

### 3.1 Directory Structure (V2 Pattern)

```
/src/
├── components/
│   ├── modals/              # 19 modal components
│   │   ├── ConfirmModal.tsx
│   │   ├── MergePreviewModal.tsx
│   │   ├── PhotoUploadModal.tsx
│   │   └── index.ts         # barrel export
│   ├── wizards/             # 3 wizard components
│   │   ├── IntakeWizard/
│   │   │   ├── IntakeWizard.tsx
│   │   │   ├── StepLocation.tsx
│   │   │   ├── StepCatInfo.tsx
│   │   │   ├── StepContact.tsx
│   │   │   └── useIntakeWizard.ts
│   │   └── index.ts
│   ├── cards/               # 6 card components
│   │   ├── CatCard.tsx
│   │   ├── PlaceCard.tsx
│   │   ├── RequestCard.tsx
│   │   └── index.ts
│   ├── badges/              # 5 badge components
│   │   ├── StatusBadge.tsx
│   │   ├── SourceBadge.tsx
│   │   ├── ConfidenceBadge.tsx
│   │   └── index.ts
│   ├── map/                 # AtlasMap split
│   │   ├── AtlasMap.tsx     # orchestrator (~500 lines)
│   │   ├── MapLayers.tsx
│   │   ├── MapControls.tsx
│   │   ├── MapMarkers.tsx
│   │   ├── MapCluster.tsx
│   │   ├── MapDetailPanel.tsx
│   │   ├── useMapState.ts
│   │   └── index.ts
│   ├── timeline/            # NEW: Request timeline
│   │   ├── Timeline.tsx
│   │   ├── TimelineEntry.tsx
│   │   └── index.ts
│   ├── data-quality/        # NEW: Quality indicators
│   │   ├── QualityBadge.tsx
│   │   ├── ConfidenceBar.tsx
│   │   ├── SourceIndicator.tsx
│   │   └── index.ts
│   └── shared/              # Remaining shared components
│       ├── LoadingSpinner.tsx
│       ├── ErrorBoundary.tsx
│       └── index.ts
├── types/
│   ├── entities.ts          # Person, Place, Cat, Request
│   ├── api.ts               # RouteParams, PaginatedResponse
│   ├── map.ts               # MapPin, MapLayer, MapState
│   ├── workflow.ts          # IntakeStep, RequestStatus
│   └── index.ts             # barrel export
├── lib/
│   ├── guards.ts            # NEW: Client-side validation
│   ├── uuid.ts              # NEW: Centralized UUID validation
│   ├── formatters.ts        # Existing (phone, date, etc.)
│   ├── validators.ts        # NEW: Input validators
│   ├── db.ts                # Existing database access
│   └── constants.ts         # NEW: Status enums, etc.
└── hooks/
    ├── useDebounce.ts
    ├── useValidation.ts     # NEW: Form validation hook
    ├── useEntityMerge.ts    # NEW: Merge workflow hook
    └── index.ts
```

### 3.2 Centralized Types (Source of Truth)

```typescript
// src/types/entities.ts

// Base entity with merge chain support
interface BaseEntity {
  created_at: string;
  updated_at: string;
  merged_into_id: string | null;
}

// Person with all variations covered
export interface Person extends BaseEntity {
  person_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  is_organization: boolean;
  data_quality: 'good' | 'needs_review' | 'garbage';

  // Relationships (loaded on demand)
  identifiers?: PersonIdentifier[];
  cats?: CatSummary[];
  places?: PlaceSummary[];
}

// Place with colony data
export interface Place extends BaseEntity {
  place_id: string;
  display_name: string;
  normalized_address: string | null;
  lat: number | null;
  lng: number | null;

  // Colony data (from beacon layer)
  colony_estimate_low?: number;
  colony_estimate_high?: number;
  tnr_coverage_pct?: number;
  last_tnr_date?: string;
}

// Cat with source tracking
export interface Cat extends BaseEntity {
  cat_id: string;
  name: string | null;
  microchip: string | null;
  sex: 'male' | 'female' | 'unknown';
  altered_status: 'spayed' | 'neutered' | 'intact' | 'unknown' | null;

  // Multi-source fields
  field_sources?: CatFieldSource[];
}

// Request with lifecycle
export interface Request extends BaseEntity {
  request_id: string;
  status: RequestStatus;
  place_id: string;
  estimated_cat_count: number;
  resolved_at: string | null;

  // Timeline loaded on demand
  timeline?: RequestTimelineEntry[];
}

export type RequestStatus =
  | 'new'
  | 'triaged'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

// Valid status transitions
export const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['triaged', 'cancelled'],
  triaged: ['scheduled', 'on_hold', 'cancelled'],
  scheduled: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['completed', 'on_hold'],
  on_hold: ['triaged', 'scheduled', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};
```

### 3.3 Client-Side Guards (Mirror SQL Gates)

```typescript
// src/lib/guards.ts

import { SOFT_BLACKLIST_EMAILS, SOFT_BLACKLIST_PHONES } from './constants';

/**
 * Client-side equivalent of SQL should_be_person()
 * Returns rejection reason or null if valid
 */
export function shouldBePerson(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  phone: string | null
): { valid: false; reason: string } | { valid: true } {
  const name = `${firstName || ''} ${lastName || ''}`.trim().toLowerCase();

  // Check for organization patterns
  const orgPatterns = [
    /\b(inc|llc|corp|organization|foundation|rescue|shelter)\b/i,
    /\b(friends of|society for|association)\b/i,
    /\bfoundation$/i,
  ];

  for (const pattern of orgPatterns) {
    if (pattern.test(name)) {
      return { valid: false, reason: 'Name appears to be an organization' };
    }
  }

  // Check for address patterns
  const addressPatterns = [
    /^\d+\s+\w+\s+(st|street|rd|road|ave|avenue|blvd|dr|drive|ln|lane|ct|court)/i,
    /\b(parking|lot|area|ranch|farm)\b/i,
  ];

  for (const pattern of addressPatterns) {
    if (pattern.test(name)) {
      return { valid: false, reason: 'Name appears to be a location' };
    }
  }

  // Check soft blacklist
  if (email && SOFT_BLACKLIST_EMAILS.includes(email.toLowerCase())) {
    return { valid: false, reason: 'This email is shared/organizational' };
  }

  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, '');
    if (SOFT_BLACKLIST_PHONES.includes(normalizedPhone)) {
      return { valid: false, reason: 'This phone is shared/organizational' };
    }
  }

  // Must have at least email OR phone
  if (!email && !phone) {
    return { valid: false, reason: 'Email or phone required' };
  }

  return { valid: true };
}

/**
 * Validate microchip format
 */
export function isValidMicrochip(chip: string): boolean {
  if (!chip) return false;
  const cleaned = chip.replace(/\D/g, '');
  return cleaned.length === 15 && /^\d{15}$/.test(cleaned);
}

/**
 * Mirror SQL is_positive_value()
 */
export function isPositiveValue(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  const normalized = String(value).toLowerCase().trim();
  return ['yes', 'true', 'y', 'checked', 'positive', '1', 'left', 'right', 'bilateral'].includes(normalized);
}
```

### 3.4 Validation Hook

```typescript
// src/hooks/useValidation.ts

import { useState, useCallback } from 'react';
import { shouldBePerson, isValidMicrochip } from '@/lib/guards';
import { formatPhoneAsYouType, isValidPhone } from '@/lib/formatters';

interface ValidationState {
  email: { value: string; error: string | null; touched: boolean };
  phone: { value: string; error: string | null; touched: boolean };
  firstName: { value: string; error: string | null; touched: boolean };
  lastName: { value: string; error: string | null; touched: boolean };
}

export function usePersonValidation() {
  const [state, setState] = useState<ValidationState>({
    email: { value: '', error: null, touched: false },
    phone: { value: '', error: null, touched: false },
    firstName: { value: '', error: null, touched: false },
    lastName: { value: '', error: null, touched: false },
  });

  const setField = useCallback((field: keyof ValidationState, value: string) => {
    setState(prev => {
      let error: string | null = null;
      let formattedValue = value;

      // Field-specific validation
      if (field === 'phone') {
        formattedValue = formatPhoneAsYouType(value);
        if (value && !isValidPhone(value)) {
          error = 'Enter a valid 10-digit phone number';
        }
      }

      if (field === 'email' && value) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          error = 'Enter a valid email address';
        }
      }

      return {
        ...prev,
        [field]: { value: formattedValue, error, touched: true },
      };
    });
  }, []);

  const validateAll = useCallback((): boolean => {
    const { firstName, lastName, email, phone } = state;

    const result = shouldBePerson(
      firstName.value,
      lastName.value,
      email.value,
      phone.value
    );

    if (!result.valid) {
      // Set error on most relevant field
      if (result.reason.includes('organization') || result.reason.includes('location')) {
        setState(prev => ({
          ...prev,
          firstName: { ...prev.firstName, error: result.reason },
        }));
      } else if (result.reason.includes('email')) {
        setState(prev => ({
          ...prev,
          email: { ...prev.email, error: result.reason },
        }));
      } else if (result.reason.includes('phone')) {
        setState(prev => ({
          ...prev,
          phone: { ...prev.phone, error: result.reason },
        }));
      }
      return false;
    }

    return true;
  }, [state]);

  return { state, setField, validateAll };
}
```

---

## Part 4: Data Quality Indicators

### Status Badges

```tsx
// src/components/badges/QualityBadge.tsx

interface QualityBadgeProps {
  quality: 'good' | 'needs_review' | 'garbage';
  confidence?: number;
  sources?: string[];
}

export function QualityBadge({ quality, confidence, sources }: QualityBadgeProps) {
  const config = {
    good: { color: 'green', icon: '✓', label: 'Verified' },
    needs_review: { color: 'yellow', icon: '⚠', label: 'Review Needed' },
    garbage: { color: 'red', icon: '✗', label: 'Invalid' },
  };

  const { color, icon, label } = config[quality];

  return (
    <div className={`badge badge-${color}`}>
      <span>{icon}</span>
      <span>{label}</span>
      {confidence !== undefined && (
        <span className="confidence">{Math.round(confidence * 100)}%</span>
      )}
      {sources && sources.length > 0 && (
        <div className="sources">
          {sources.map(s => (
            <span key={s} className="source-tag">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Source Indicators

```tsx
// src/components/data-quality/SourceIndicator.tsx

const SOURCE_COLORS: Record<string, string> = {
  clinichq: 'blue',
  shelterluv: 'purple',
  airtable: 'orange',
  web_intake: 'green',
  petlink: 'gray',
  atlas_ui: 'teal',
};

interface SourceIndicatorProps {
  sources: string[];
  showLabels?: boolean;
}

export function SourceIndicator({ sources, showLabels = true }: SourceIndicatorProps) {
  return (
    <div className="source-indicator">
      {sources.map(source => (
        <span
          key={source}
          className={`source-badge source-${SOURCE_COLORS[source] || 'gray'}`}
          title={source}
        >
          {showLabels ? source : source[0].toUpperCase()}
        </span>
      ))}
    </div>
  );
}
```

---

## Part 5: Implementation Priority (Risk-Aware Phases)

### Phase 1: Foundation ✅ COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| Create `/src/lib/guards.ts` | ✅ Done | 320 lines, mirrors SQL gates |
| Create `/src/lib/uuid.ts` | ✅ Done | 170 lines, comprehensive UUID utils |
| Create `/src/types/` structure | ✅ Done | entities.ts, api.ts, map.ts |
| Create `/src/lib/constants.ts` | ✅ Done | 180 lines, status enums, blacklists |
| Fix 3 routes using direct Pool | Pending | Low priority, can do during Phase 2 |

### Phase 2: Component Organization (Low Risk)

**Strategy:** Create new structure alongside existing, use re-exports for backward compatibility.

| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Create `/components/modals/` directory | 30 min | None | Empty directory |
| Move `ConfirmModal.tsx` first | 1 hour | Low | Add re-export from old location |
| Move remaining modals one by one | 2 hours | Low | Test each before moving next |
| Create badges directory | 1 hour | None | New components |
| Create data-quality components | 3 hours | None | New components |
| Add barrel exports | 1 hour | None | Additive only |
| Update imports in batches | 2 hours | Low | Grep for old paths, update in batches |
| Remove old re-exports | 30 min | Low | Only after all imports updated |

**Testing checkpoint:** Run full app after each modal move.

### Phase 3: AtlasMap Refactor (High Value, Medium Risk)

**Strategy:** Extract hooks and subcomponents BEFORE touching the main component.

**Step 3.1: Extract Hooks (No UI Changes)**
| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Create `useMapState.ts` | 2 hours | Low | Extract state logic, keep in same file initially |
| Create `useMapLayers.ts` | 2 hours | Low | Extract layer management |
| Create `useMapMarkers.ts` | 2 hours | Low | Extract marker logic |
| Test app thoroughly | 1 hour | N/A | Verify no regressions |

**Step 3.2: Extract View Components (Low Risk)**
| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Create `MapControls.tsx` | 2 hours | Low | Pure presentational component |
| Create `MapDetailPanel.tsx` | 3 hours | Low | Pure presentational component |
| Create `MapLegend.tsx` | 1 hour | Low | Pure presentational component |
| Test app thoroughly | 1 hour | N/A | Verify no regressions |

**Step 3.3: Add SuperCluster (Performance Improvement)**
| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Install use-supercluster | 30 min | None | Dependency only |
| Create `MapCluster.tsx` | 4 hours | Medium | Feature flag, test with subset |
| Add performance monitoring | 1 hour | None | Measure before/after |
| Enable clustering gradually | 1 hour | Low | Start with one layer |

**Step 3.4: Final Orchestrator Slim-Down**
| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Move hooks to separate files | 2 hours | Low | Already tested in Step 3.1 |
| Import subcomponents | 1 hour | Low | Already tested in Step 3.2 |
| Verify AtlasMap.tsx < 600 lines | 1 hour | N/A | Goal metric |

### Phase 4: Workflow Improvements (Medium Risk)

**Strategy:** Add new features alongside existing, don't modify working flows.

| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Add intake form validation | 4 hours | Low | Additive guards, existing form unchanged |
| Add request timeline UI | 4 hours | Low | New component on request detail page |
| Add merge review interface | 6 hours | Medium | New route, doesn't touch existing merge |
| Add photo upload preview | 4 hours | Medium | Add preview step, keep existing upload |

### Phase 5: Polish (Low Risk)

| Task | Effort | Risk | Mitigation |
|------|--------|------|------------|
| Add undo for bulk operations | 4 hours | Low | Toast notification pattern |
| Add progress indicators | 2 hours | Low | Skeleton loaders, non-blocking |
| Replace formatDate duplicates | 2 hours | Low | Search and replace, test each |
| Add keyboard shortcuts | 2 hours | Low | Additive, no existing behavior changed |

---

## Part 6: Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Components at root | 88 | <20 |
| Duplicate utility functions | 26 | 0 |
| Pages over 2000 lines | 4 | 0 |
| Type interface variants | 6+ | 1 per entity |
| Client-side validation coverage | ~20% | 100% |
| Data quality badges visible | 0 pages | All entity pages |

---

## Part 7: AtlasMap Architecture Deep Dive

### Current Problem

The AtlasMap component is 3,377 lines — a "god component" that handles:
- Map initialization and configuration
- Layer management (colonies, requests, disease sites, trapping)
- Marker rendering and clustering
- Detail panel display
- Search and filtering
- Pin creation and editing
- Google Maps integration
- State management for all of the above

### Target Architecture

```
/components/map/
├── AtlasMap.tsx           # Orchestrator (~500 lines)
│   └── Responsibilities: composition, event handling, state coordination
│
├── hooks/
│   ├── useMapState.ts     # Map center, zoom, bounds
│   ├── useMapLayers.ts    # Layer visibility, filtering
│   ├── useMapMarkers.ts   # Marker data, selection
│   └── useMapSearch.ts    # Search query, results
│
├── components/
│   ├── MapContainer.tsx   # Leaflet container + base tiles
│   ├── MapControls.tsx    # Zoom, layer toggle, search
│   ├── MapLayers.tsx      # Layer rendering orchestrator
│   ├── MapCluster.tsx     # SuperCluster integration
│   ├── MapMarkers.tsx     # Individual marker rendering
│   └── MapDetailPanel.tsx # Side panel for selected pin
│
├── layers/
│   ├── ColonyLayer.tsx    # Colony-specific markers
│   ├── RequestLayer.tsx   # Request-specific markers
│   ├── DiseaseLayer.tsx   # Disease site markers
│   └── HeatmapLayer.tsx   # Density visualization
│
└── utils/
    ├── clustering.ts      # SuperCluster configuration
    ├── coordinates.ts     # Lat/lng utilities
    └── markerIcons.ts     # Icon definitions
```

### Performance Targets

| Metric | Current | Target | Strategy |
|--------|---------|--------|----------|
| Initial load | ~4 seconds | <2 seconds | Lazy load layers |
| 15k pins render | ~3 seconds | <500ms | SuperCluster |
| Pin click response | ~200ms | <50ms | useMemo for marker data |
| Layer toggle | ~500ms | <100ms | Pre-computed layer data |
| Memory usage | Unknown | Measure baseline | Profile before changes |

### SuperCluster Implementation

```typescript
// hooks/useMapClustering.ts
import useSupercluster from 'use-supercluster';

export function useMapClustering(pins: MapPin[], bounds: MapBounds, zoom: number) {
  // Convert pins to GeoJSON features
  const points = useMemo(() =>
    pins.map(pin => ({
      type: 'Feature' as const,
      properties: { cluster: false, ...pin },
      geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
    })),
    [pins]
  );

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
    zoom,
    options: {
      radius: 80,
      maxZoom: 16,
      minPoints: 3,
    },
  });

  return { clusters, supercluster };
}
```

### Migration Path (Detailed)

**Week 1: Hooks Extraction**
1. Create `hooks/useMapState.ts` — extract center, zoom, bounds state
2. Create `hooks/useMapLayers.ts` — extract layer visibility state
3. Import hooks into AtlasMap, verify no behavior change
4. Create `hooks/useMapMarkers.ts` — extract marker selection state

**Week 2: Component Extraction**
1. Create `MapDetailPanel.tsx` — copy JSX, pass data via props
2. Create `MapControls.tsx` — copy controls JSX, pass handlers via props
3. Update AtlasMap to use new components
4. Test thoroughly, verify feature parity

**Week 3: Clustering Integration**
1. Install `use-supercluster` dependency
2. Create `useMapClustering.ts` hook
3. Create `MapCluster.tsx` component
4. Add feature flag: `ENABLE_CLUSTERING` in constants
5. Test with feature flag OFF (existing behavior)
6. Test with feature flag ON (new clustering)
7. A/B test performance

**Week 4: Layer Refactor**
1. Create `/layers/` directory
2. Extract `ColonyLayer.tsx` — single layer type
3. Extract remaining layers one by one
4. Create `MapLayers.tsx` orchestrator
5. Verify all layer types work

---

## Part 8: Testing Strategy

### Pre-Refactor Testing

Before any major refactor, establish baseline:

1. **Manual smoke test checklist:**
   - [ ] Map loads with pins
   - [ ] Click pin shows detail panel
   - [ ] Layer toggles work
   - [ ] Search finds locations
   - [ ] Create request from pin works
   - [ ] Zoom and pan smooth

2. **Performance baseline:**
   ```bash
   # Record in docs/PERFORMANCE_BASELINE.md
   - Initial load time: ___s
   - 15k pins render: ___s
   - Pin click response: ___ms
   - Layer toggle: ___ms
   ```

3. **Screenshot comparison:**
   - Take screenshots of key views before changes
   - Compare after each phase

### During Refactor Testing

After each file move or hook extraction:
1. Run the app
2. Execute smoke test checklist
3. Compare performance metrics
4. Roll back if regression detected

### Post-Refactor Testing

1. Full regression test
2. Performance comparison to baseline
3. User acceptance testing with FFSC staff

---

## Summary

This plan applies V2 data architecture principles to the UI:

1. **Clear boundaries** — Component directories like database schemas
2. **Single source of truth** — Centralized types like `sot.*` tables
3. **Gated operations** — Client guards like `should_be_person()`
4. **No sprawl** — Organized imports, no duplicates
5. **Progressive disclosure** — Show summary, expand for detail
6. **Quality visibility** — Badges, confidence indicators, source tracking
7. **Risk-aware migration** — Incremental changes, parallel paths, feature flags

### Phase Status

| Phase | Status | Risk Level |
|-------|--------|------------|
| Phase 1: Foundation | ✅ COMPLETE | N/A |
| Phase 2: Component Organization | ✅ COMPLETE | Low |
| Phase 3: AtlasMap Refactor | ✅ PARTIAL (types + hooks + components extracted) | Medium |
| Phase 4: Workflow Improvements | ✅ COMPLETE | Medium |
| Phase 5: Polish | ✅ COMPLETE | Low |
| **Phase 6: Data Pipeline Fixes** | ✅ COMPLETE (2026-02-21) | High |
| **Phase 7: Layout Components** | ✅ COMPLETE (2026-02-21) | Low |
| **Phase 8: Page Redesigns** | 🔄 NEXT | Medium |

### Phase 3 Progress (2026-02-21)

**Completed:**
- Created `/components/map/` module structure with barrel exports
- Extracted all map types to `/components/map/types.ts`
- Created hooks: `useMapSearch`, `useStreetView`, `useMapClustering` (SuperCluster)
- Created components: `MapControls`, `MapLegend`, `MapClusterMarker`
- Integrated `MapLegend` and `MapControls` into `AtlasMap.tsx`
- Installed `use-supercluster` and `supercluster` dependencies
- **Result:** AtlasMap.tsx reduced from 3,377 → 3,007 lines (370 lines saved)

**Remaining:**
- Further extraction of layer rendering logic (~1,500 lines) would require more extensive refactoring

### Phase 4 Progress (2026-02-21) ✅ COMPLETE

**Completed:**
- Integrated `shouldBePerson` guard into intake form validation
- Created `/components/timeline/` with `StatusPipeline` and `TimelineEntry` components
- Created `/components/data-quality/` with:
  - `MergeReviewCard` — Side-by-side comparison for duplicate review
  - `QualityBadge` — Visual data quality indicator (good/needs_review/garbage)
  - `SourceIndicator` — Source system badge (ClinicHQ, ShelterLuv, etc.)
- All components have barrel exports for clean imports

**Note:** Integration of `StatusPipeline` into request detail page can be done as needed — the component is ready to use.

### Phase 5 Progress (2026-02-21) ✅ COMPLETE

**Completed:**
- Created `/components/feedback/` with:
  - `Skeleton` — Base skeleton with shimmer animation
  - `SkeletonText`, `SkeletonAvatar`, `SkeletonCard`, `SkeletonTable`, `SkeletonList`, `SkeletonStats` — Pre-built variants
  - `SkeletonWrapper` — Conditional loading wrapper
  - `Toast` — Notification system with undo support
  - `ToastProvider`, `useToast` — Context-based toast management
- Created `/hooks/useKeyboardShortcuts.ts`:
  - Global keyboard shortcut system
  - `useGlobalShortcuts` for common navigation shortcuts
  - `formatShortcut` for displaying shortcuts (⌘K vs Ctrl+K)
  - `COMMON_SHORTCUTS` constant for reference
- Consolidated duplicate `formatDate` functions:
  - Migrated 3 components to use centralized `formatRelativeDate`
  - Pattern documented for remaining 30+ files
  - Components updated: `JournalSection`, `ObservationsSection`, `QuickNotes`

**Date Consolidation Pattern:**
```tsx
// Before (35+ inline implementations)
function formatDate(dateStr: string): string {
  // ... 15 lines of duplicate logic
}

// After (use centralized)
import { formatRelativeDate } from "@/lib/formatters";
const formatDate = formatRelativeDate;
```

### Phase 7 Progress (2026-02-21) ✅ COMPLETE

**Components Created:**

| Component | File | Purpose |
|-----------|------|---------|
| `TwoColumnLayout` | `/components/layouts/TwoColumnLayout.tsx` | Main + sidebar pattern for detail pages |
| `Section` | `/components/layouts/Section.tsx` | Collapsible content grouping |
| `StatsSidebar` | `/components/layouts/StatsSidebar.tsx` | Quick stats display for sidebar |
| `PropertyTypeBadge` | `/components/badges/PropertyTypeBadge.tsx` | Residence/business/farm indicator |
| `PlaceKindBadge` | `/components/badges/PlaceKindBadge.tsx` | Place classification indicator |
| `LinkedPeopleSection` | `/components/LinkedPeopleSection.tsx` | People relationships (like LinkedCatsSection) |
| `LinkedPlacesSection` | `/components/LinkedPlacesSection.tsx` | Place relationships (like LinkedCatsSection) |

**Barrel Exports Updated:**
- `/components/layouts/index.ts` — New layouts barrel
- `/components/badges/index.ts` — Added PropertyTypeBadge, PlaceKindBadge

**Ready for Integration:**
- All components export cleanly and follow existing patterns
- PropertyTypeBadge uses values from MIG_2415 (`ops.requests.property_type`)
- PlaceKindBadge uses values from MIG_2417 (`sot.places.place_kind`)

---

## Phase 6: Data Pipeline Fixes (HIGH PRIORITY)

**Why First:** UI improvements are meaningless if the underlying data is broken. These fixes unblock the UI work.

**Audit Findings (2026-02-21):**
- 100% of intake submissions have NULL `triage_category` (pipeline not running)
- 10+ organizations misclassified as `person` (Blentech Corporation, Wiggins Electric, etc.)
- 100% of places have `place_kind = 'unknown'` (never classified)
- 217 Healdsburg Ave has 2,381 cats linked (likely shelter, needs blacklist)
- `property_type` captured at intake but NOT promoted to `ops.requests`
- 92.6% of intake submissions have no person/place linked

### MIG_2414: Fix Organization Misclassification ✅ CREATED

**Problem:** Clear business names classified as `entity_type = 'person'`

**Records to fix:**
- Sartorial Auto Repairs, Blentech Corporation, Wiggins Electric
- Aamco Repair Santa Rosa, Sunrise Farms One
- Speedy Creek Winery, Keller Estates Vineyards
- Mike's Truck Garden, Petaluma Poultry, Petaluma Livestock Auction
- SCAS (Sonoma County Animal Services) - 2 duplicate records
- "Rebooking placeholder" pseudo-profile (delete)

**File:** `sql/schema/v2/MIG_2414__fix_org_misclassification.sql`

**Effort:** 1 hour | **Risk:** Low

---

### MIG_2415: Add property_type to ops.requests ✅ CREATED

**Problem:** `raw_property_type` exists in intake but isn't copied to requests during promotion.

**File:** `sql/schema/v2/MIG_2415__add_property_type_to_requests.sql`

**Effort:** 2 hours | **Risk:** Low

---

### MIG_2416: Investigate & Blacklist Shelter Places ✅ CREATED

**Problem:** 217 Healdsburg Ave has 2,381 cats linked - likely a ShelterLuv shelter location.

**File:** `sql/schema/v2/MIG_2416__blacklist_shelter_places.sql`

**Effort:** 1 hour | **Risk:** Low

---

### MIG_2417: Classify place_kind ✅ CREATED

**Problem:** 100% of places (7,939) have `place_kind = 'unknown'`

**File:** `sql/schema/v2/MIG_2417__classify_place_kind.sql`

**Effort:** 1 hour | **Risk:** Low

---

### MIG_2418: Enhance classify_owner_name() Keywords ✅ CREATED

**Problem:** `classify_owner_name()` missed business keywords found in data audit.

**Add Keywords:**
- Winery, Vineyards, Vineyard
- Poultry, Livestock, Auction
- Garden (as in "Truck Garden")
- Dairy, Orchard, Nursery
- Mechanic
- Corporation

**Files:**
- `sql/schema/v2/MIG_2418__enhance_classify_owner_name.sql` (documentation)
- `apps/web/src/lib/guards.ts` ✅ Updated

**Effort:** 30 min | **Risk:** Low

---

### Phase 6 Summary

| Migration | Problem | Effort | Status | Result |
|-----------|---------|--------|--------|--------|
| MIG_2414 | Org misclassification | 1 hour | ✅ Applied | 9 archived, 8 fixed, SCAS merged |
| MIG_2415 | property_type not on requests | 2 hours | ✅ Applied | Column added (no backfill source) |
| MIG_2416 | Shelter place not blacklisted | 1 hour | ✅ Applied | FFSC verified, 217 Healdsburg flagged |
| MIG_2417 | place_kind all unknown | 1 hour | ✅ Applied | **7,939 places classified** |
| MIG_2418 | classify_owner_name gaps | 30 min | ✅ Applied | 4 keywords added to ref.business_keywords |
| **Total** | | **5.5 hours** | **✅ COMPLETE** |

**MIG_2417 Place Classification Results:**
- 80.6% single_family (6,396)
- 9.0% outdoor_site (716)
- 4.7% apartment_unit (377)
- 3.5% apartment_building (275)
- 1.0% farm (79)
- 0.8% business (60)
- 0.3% mobile_home (21)
- 0.2% clinic (15)

**MIG_2416 High Cat Count Places (Flagged for Review):**
- 217 Healdsburg Ave: 2,381 cats (ClinicHQ - NOT shelter, may be large TNR site)
- 1814 Empire Industrial: 2,353 cats (FFSC Clinic - already blacklisted ✓)
- 1688 Jennings Way: 187 cats
- 2551 Mill Creek Rd: 143 cats
- 1406 Barlow Ln: 139 cats
- 3820 Selvage Road: 139 cats

---

## Phase 7: Layout Components

**Prerequisite:** Phase 6 complete (data fixes)

**Goal:** Create reusable layout infrastructure for page redesigns.

### 7.1 TwoColumnLayout Component

**Purpose:** Replace tab-heavy layouts with main + sidebar pattern.

**File:** `/components/layouts/TwoColumnLayout.tsx`

```typescript
interface TwoColumnLayoutProps {
  header: ReactNode;           // Entity name, badges, actions
  main: ReactNode;             // Primary content (65%)
  sidebar: ReactNode;          // Quick stats, linked records (35%)
  footer?: ReactNode;          // Optional tabs for secondary content
  sidebarPosition?: 'left' | 'right';
  sidebarWidth?: '30%' | '35%' | '40%';
  stickyHeader?: boolean;
  stickySidebar?: boolean;
}
```

**Effort:** 2 hours | **Risk:** Low

---

### 7.2 Section Component (Extract)

**Purpose:** Standardize content grouping across pages.

**File:** `/components/layouts/Section.tsx`

```typescript
interface SectionProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;         // Edit button, etc.
  children: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  emptyState?: ReactNode;      // Show when children empty
}
```

**Effort:** 1 hour | **Risk:** Low

---

### 7.3 PropertyTypeBadge Component

**Purpose:** Visual indicator for residence/business/farm distinction.

**File:** `/components/badges/PropertyTypeBadge.tsx`

```typescript
type PropertyType = 'private_home' | 'apartment_complex' | 'mobile_home_park' |
                    'business' | 'farm_ranch' | 'public_park' | 'industrial' | 'other';

const CONFIG = {
  private_home: { icon: '🏠', label: 'Residence', color: '#22c55e' },
  apartment_complex: { icon: '🏢', label: 'Apartment', color: '#3b82f6' },
  mobile_home_park: { icon: '🏘️', label: 'Mobile Home', color: '#8b5cf6' },
  business: { icon: '🏪', label: 'Business', color: '#f59e0b' },
  farm_ranch: { icon: '🌾', label: 'Farm/Ranch', color: '#84cc16' },
  public_park: { icon: '🌳', label: 'Public', color: '#06b6d4' },
  industrial: { icon: '🏭', label: 'Industrial', color: '#64748b' },
  other: { icon: '📍', label: 'Other', color: '#6b7280' },
};
```

**Effort:** 1 hour | **Risk:** Low

---

### 7.4 PlaceKindBadge Component

**Purpose:** Visual indicator for place classification.

**File:** `/components/badges/PlaceKindBadge.tsx`

```typescript
type PlaceKind = 'single_family' | 'apartment_unit' | 'apartment_building' |
                 'mobile_home' | 'business' | 'farm' | 'outdoor_site' |
                 'clinic' | 'shelter' | 'unknown';
```

**Effort:** 1 hour | **Risk:** Low

---

### 7.5 LinkedPeopleSection & LinkedPlacesSection

**Purpose:** Clone LinkedCatsSection pattern for other entity types.

**Files:**
- `/components/LinkedPeopleSection.tsx`
- `/components/LinkedPlacesSection.tsx`

**Effort:** 2 hours | **Risk:** Low

---

### 7.6 StatsSidebar Component

**Purpose:** Quick stats display for sidebar pattern.

**File:** `/components/layouts/StatsSidebar.tsx`

```typescript
interface StatItem {
  label: string;
  value: string | number;
  icon?: string;
  href?: string;
}

interface StatsSidebarProps {
  stats: StatItem[];
  sections?: Array<{
    title: string;
    content: ReactNode;
  }>;
}
```

**Effort:** 1 hour | **Risk:** Low

---

### Phase 7 Summary

| Component | Purpose | Effort |
|-----------|---------|--------|
| TwoColumnLayout | Main + sidebar pattern | 2 hours |
| Section | Content grouping | 1 hour |
| PropertyTypeBadge | Residence/business indicator | 1 hour |
| PlaceKindBadge | Place classification indicator | 1 hour |
| LinkedPeopleSection | People relationships | 1 hour |
| LinkedPlacesSection | Place relationships | 1 hour |
| StatsSidebar | Quick stats display | 1 hour |
| Barrel exports | `/components/layouts/index.ts` | 30 min |
| **Total** | | **8.5 hours** |

---

## Phase 8: Page Redesigns

**Prerequisite:** Phase 6 & 7 complete

**Goal:** Apply new layout patterns to entity pages.

### 8.1 Request Page Redesign

**Current:** 7 tabs, ~1,512 lines, property type not visible
**Target:** 3 tabs, two-column layout, property type in header

**Changes:**
1. Add `PropertyTypeBadge` to header
2. Implement `TwoColumnLayout`:
   - Main: Situation summary, cats, assignment
   - Sidebar: Quick stats, map preview, nearby activity
3. Reduce tabs: Details | Activity | Admin
4. Move Nearby from tab to sidebar (always visible)

**File:** `/app/requests/[id]/page.tsx`
**Effort:** 4 hours | **Risk:** Medium

---

### 8.2 Person Page Redesign

**Current:** 4 tabs, ~1,811 lines, role info scattered
**Target:** Role-based sections, compact connections

**Changes:**
1. Implement `TwoColumnLayout`:
   - Main: Contact info, role-specific sections
   - Sidebar: Quick stats, recent activity
2. Show/hide sections based on roles:
   - Trapper → Assignments, stats
   - Volunteer → Groups, hours
   - Cat owner → Cats, places
3. Use `LinkedCatsSection`, `LinkedPlacesSection` consistently
4. Reduce tabs: Overview | History | Admin

**File:** `/app/people/[id]/page.tsx`
**Effort:** 4 hours | **Risk:** Medium

---

### 8.3 Place Page Redesign

**Current:** 4 tabs, ~1,224 lines, colony estimate hidden in tab
**Target:** Map prominent, colony always visible

**Changes:**
1. Add `PlaceKindBadge` to header
2. Implement `TwoColumnLayout`:
   - Main: Map (large), location details, people
   - Sidebar: Colony estimate, TNR progress, disease status
3. Move Ecology data to sidebar (always visible)
4. Reduce tabs: Overview | Requests | Admin

**File:** `/app/places/[id]/page.tsx`
**Effort:** 4 hours | **Risk:** Medium

---

### 8.4 Intake Queue Redesign

**Current:** Modal-based, property type not captured
**Target:** Side panel, property type field, mail card format

**Changes:**
1. Replace modal with slide-out panel (keep queue visible)
2. Add `property_type` field to intake form
3. Display submissions as "mail cards" with sender info
4. Show matched person/place inline

**Files:**
- `/app/intake/queue/page.tsx`
- `/app/intake/page.tsx` (add property_type field)

**Effort:** 3 hours | **Risk:** Medium

---

### Phase 8 Summary

| Page | Changes | Effort | Risk |
|------|---------|--------|------|
| Request | Two-column, property type, 3 tabs | 4 hours | Medium |
| Person | Role-based, linked sections | 4 hours | Medium |
| Place | Map header, colony visible | 4 hours | Medium |
| Intake | Side panel, property type | 3 hours | Medium |
| **Total** | | **15 hours** | |

---

## Full Plan Timeline

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| 1-5 | Foundation, components, polish | Done | ✅ COMPLETE |
| **6** | **Data Pipeline Fixes** | **5.5 hours** | ✅ COMPLETE (2026-02-21) |
| **7** | **Layout Components** | **8.5 hours** | ✅ COMPLETE (2026-02-21) |
| **8** | **Page Redesigns** | **15 hours** | 🔄 NEXT |
| **Total Remaining** | | **15 hours** | |

---

## Success Metrics (Updated 2026-02-21)

| Metric | Before Audit | After Phase 7 | Target |
|--------|--------------|---------------|--------|
| Tabs per detail page | 5-7 | 5-7 | 2-3 |
| Property type visible on requests | No | Badge ready ✅ | Yes |
| Places with place_kind | 0% | **100%** ✅ | 100% |
| Organizations correctly classified | ~10% | **8 fixed** ✅ | 100% |
| Intake triage working | No | No | Yes |
| Colony estimate visible without click | No | No | Yes |
| Two-column layouts | 0 pages | Components ready ✅ | 4 pages |
| Layout components | 0 | **7 created** ✅ | 7 |
| Business keywords in ref | 136 | **140** ✅ | 140+ |

### Key Research Sources

- [UXPin Dashboard Design Principles](https://www.uxpin.com/studio/blog/dashboard-design-principles/)
- [Andrej Gajdos: High-Performance Map Visualizations](https://andrejgajdos.com/leaflet-developer-guide-to-high-performance-map-visualizations-in-react/)
- [Telerik React Design Patterns 2025](https://www.telerik.com/blogs/react-design-patterns-best-practices)
- [SuperCluster for Leaflet Clustering](https://www.leighhalliday.com/leaflet-clustering/)
- [DataCamp Dashboard Design Tutorial](https://www.datacamp.com/tutorial/dashboard-design-tutorial)
- [Airtable Record Detail Layout](https://support.airtable.com/docs/airtable-interface-layout-record-detail)
- [Linear UI Redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [JustInMind Dashboard Design](https://www.justinmind.com/ui-design/dashboard-design-best-practices-ux)
