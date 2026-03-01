# Atlas Master Implementation Plan

**Created:** 2026-02-28
**Purpose:** Consolidated roadmap of all pending features from individual plans

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| P0 | Critical - Blocks daily operations or data integrity |
| P1 | High - Staff requested or significant UX improvement |
| P2 | Medium - Nice to have, improves system completeness |
| P3 | Low - Future enhancement, polish |

---

## Chunk 1: Data Quality Fixes (P0)

**Source Plans:** `idempotent-popping-zebra.md`
**Estimated Scope:** 3 tasks, ~2-3 hours

These are data quality issues affecting daily operations.

### 1.1 Fix Cat Search Duplicates
- **File:** `/apps/web/src/app/api/admin/clinic-days/photo-upload/search/route.ts`
- **Problem:** Searching for microchip shows exact match buried under duplicates
- **Fix:** Use `DISTINCT ON (c.cat_id)` + subqueries with LIMIT 1 for place/person
- **Verification:** Search `981020053836755` → Mei Mei appears first

### 1.2 Fix Appointment-Person Linking Gap
- **Problem:** 30 recent appointments have owner_email but no person_id linked
- **Root Cause:** `link_appointments_to_owners()` not running or has bug
- **Fix:** Investigate and re-run entity linking pipeline
- **Verification:** Appointment #26-595 links to Vanessa Vertigan

### 1.3 Prevent Work Address Pollution
- **File:** Create `MIG_973__place_type_aware_cat_linking.sql`
- **Problem:** Cats linked to owner's work address instead of home
- **Fix:** Add place_kind filter to `link_cats_to_places()` - skip business/clinic for `home` relationship
- **Verification:** Hector's cats don't appear at Dutton Ave

---

## Chunk 2: Appointment Entity Unification (P1)

**Source Plans:** `whimsical-jingling-token.md`
**Estimated Scope:** 5 tasks, ~4-5 hours

Makes appointment data the gold standard for cat medical info.

### 2.1 Enrich sot_appointments
- **File:** Create `MIG_870__enrich_sot_appointments.sql`
- **Add:** 22 new columns (health screening, vitals, client, financial)
- **Backfill:** From staged_records by appointment_number

### 2.2 Create v_appointment_detail View
- **Replace:** `v_consolidated_visits` with cleaner view on enriched table
- **Include:** Cat info, person info, place address

### 2.3 Update Ingest Pipeline
- **File:** `/apps/web/src/app/api/ingest/process/[id]/route.ts`
- **Change:** Populate new columns on every upload

### 2.4 Rename visits → appointments
- **Files:** API routes, page components, interfaces
- **Scope:** 8 files with terminology changes

### 2.5 Fix Appointment Detail Modal
- **File:** `AppointmentDetailModal.tsx`
- **Change:** Use enriched data, add cat photo + hyperlinks

---

## Chunk 3: Cat Deduplication System (P1)

**Source Plans:** `reflective-stargazing-muffin.md`
**Estimated Scope:** 4 tasks, ~3-4 hours

Systematic duplicate detection with false-positive protection.

### 3.1 Add Confidence to cat_identifiers
- **File:** Create `MIG_2341__cat_dedup_enhancements.sql`
- **Add:** `confidence` column (1.0=microchip, 0.95=clinichq_id)

### 3.2 Create Common Cat Names Table
- **Purpose:** Block name-only matching for "Tiger", "Shadow", etc.
- **Auto-populate:** Names with 50+ occurrences

### 3.3 Enhanced Duplicate Detection View
- **Create:** `ops.v_cat_dedup_candidates`
- **Scoring:** Microchip exact=1.0, edit distance 1=0.80, same name+owner=0.85

### 3.4 Merge Function with Audit
- **Create:** `sot.merge_cats()` function
- **Features:** Reassign appointments, move identifiers, audit trail

---

## Chunk 4: Clinic History Unification (P2)

**Source Plans:** `sorted-soaring-liskov.md`
**Estimated Scope:** 6 tasks, ~4-5 hours

Show clinic appointments on people and places pages.

### 4.1 Rewrite /api/appointments/route.ts
- **Change:** Use `v_appointment_detail` instead of `v_appointment_list`
- **Add:** `vaccines[]`, `treatments[]` arrays, cat photo URL

### 4.2 Create ClinicHistorySection Component
- **File:** `/apps/web/src/components/ClinicHistorySection.tsx`
- **Props:** `personId` OR `placeId`
- **Features:** Table with cat thumbnails, clickable rows → modal

### 4.3 Enhance AppointmentDetailModal
- **Add:** Cat photo + hyperlinks in header
- **Links:** Cat name and microchip → `/cats/{cat_id}`

### 4.4 Update /api/appointments/[id]
- **Add:** `cat_microchip` + `cat_photo_url` to response

### 4.5 Add to People Page
- **File:** `/apps/web/src/app/people/[id]/page.tsx`
- **Location:** After Cats section in Connections tab

### 4.6 Add to Places Page
- **File:** `/apps/web/src/app/places/[id]/page.tsx`
- **Location:** After Cats section in Overview

---

## Chunk 5: Colony Estimate Reconciliation (P2)

**Source Plans:** `kind-soaring-quill.md`
**Estimated Scope:** 5 tasks, ~3-4 hours

Fix contradictory colony stats when verified > estimated.

### 5.1 Create Reconciliation Migration
- **File:** Create `MIG_562__reconcile_colony_views.sql`
- **Formula:** `effective_colony_size = MAX(verified_altered, reported_estimate)`

### 5.2 Auto-Reconcile on Upgrade
- **File:** `/apps/web/src/app/api/requests/[id]/upgrade/route.ts`
- **Logic:** When staff provides remaining count, calculate new colony size

### 5.3 Update v_place_colony_status
- **Add:** GREATEST pattern, respect overrides, cap rate at 100%

### 5.4 Create v_request_colony_summary
- **Purpose:** Request-scoped alteration stats

### 5.5 Update Request Detail UI
- **Add:** Reconciliation notice when verified > estimated
- **Add:** "Set Manual Override" button

---

## Chunk 6: ClinicHQ Notes Ingestion (P2)

**Source Plans:** `quiet-cooking-bubble.md`
**Estimated Scope:** 7 tasks, ~4-5 hours

Ingest 11,761 client notes into ops.clinic_accounts.

### 6.1 Schema Migration
- **File:** Create `MIG_2550__clinichq_client_notes.sql`
- **Add:** `clinichq_client_id`, `quick_notes`, `long_notes`, `tags`

### 6.2 Create Matching Function
- **Create:** `ops.match_clinichq_client()`
- **Priority:** client_id → email → phone → display_name

### 6.3 Create Upsert Function
- **Create:** `ops.upsert_clinichq_notes()`
- **Actions:** Update existing OR create new account

### 6.4 Create Ingestion Script
- **File:** `/scripts/ingest/clinichq_notes_ingest.ts`
- **Process:** Parse CSV, match, upsert, report stats

### 6.5 Run Ingestion
- **Data:** 11,761 rows from CSV
- **Expected:** ~8K matches, ~3K new creates

### 6.6 Enhance Tippy Functions
- **File:** Create `MIG_2551__tippy_place_notes.sql`
- **Add:** `clinic_notes` to `tippy_place_full_report()`

### 6.7 Create UI Component
- **File:** `/apps/web/src/components/ClinicHQNotesSection.tsx`
- **Add to:** places/[id], people/[id] pages

---

## Chunk 7: Clinic Days Improvements (P2)

**Source Plans:** `moonlit-zooming-cocoa.md`
**Estimated Scope:** 4 tasks, ~4-5 hours

Improve master list matching and clinic day workflow.

### 7.1 Enhanced Client Name Parser
- **Add:** Foster detection, shelter ID extraction, address parsing
- **Store:** New columns in `clinic_day_entries`

### 7.2 Multi-Strategy Matching Pipeline
- **Create:** `MIG_900__smart_master_list_matching.sql`
- **Passes:** Owner name → Unique cat name → Sex compatibility → Cardinality

### 7.3 Photo Removal Feature
- **Create:** `DELETE /api/media/[id]` endpoint
- **Action:** Set `is_archived = TRUE` (soft delete)

### 7.4 Clinic Day Number Assignment
- **File:** `/apps/web/src/app/admin/clinic-days/page.tsx`
- **Add:** Number input when cat selected for photo upload

---

## Chunk 8: Ingest UI Improvements (P3)

**Source Plans:** `abstract-napping-stardust.md`
**Estimated Scope:** 4 tasks, ~3 hours

Better admin experience for ClinicHQ uploads.

### 8.1 Create ClinicHQUploadModal
- **File:** `/apps/web/src/components/ClinicHQUploadModal.tsx`
- **Features:** 3 drag-drop zones, batch tracking, progress feedback

### 8.2 Add Card to Admin Dashboard
- **File:** `/apps/web/src/app/admin/page.tsx`
- **Action:** Opens modal on click

### 8.3 Add Quick-Action to Data Hub
- **File:** `/apps/web/src/app/admin/data/page.tsx`
- **Button:** "Upload ClinicHQ Batch"

### 8.4 Fix Dark Mode
- **File:** `/apps/web/src/app/admin/ingest/page.tsx`
- **Fix:** Replace 14 hardcoded colors with CSS variables

---

## Chunk 9: Request System Polish (P3)

**Source Plans:** `spicy-conjuring-sifakis.md`
**Status:** 90% complete, finishing touches

### 9.1 Add "Show Archived" Toggle
- **File:** `/apps/web/src/app/requests/page.tsx`
- **Feature:** Toggle to show/hide archived requests
- **URL:** Persist in `?include_archived=true`

### 9.2 Restore Functionality (Future)
- **API:** `POST /api/requests/[id]/restore`
- **Action:** Set `is_archived = FALSE`

---

## Implementation Order Recommendation

**Phase 1 (Immediate - P0):**
1. Chunk 1: Data Quality Fixes

**Phase 2 (This Sprint - P1):**
2. Chunk 2: Appointment Entity Unification
3. Chunk 3: Cat Deduplication System

**Phase 3 (Next Sprint - P2):**
4. Chunk 4: Clinic History Unification
5. Chunk 5: Colony Estimate Reconciliation
6. Chunk 6: ClinicHQ Notes Ingestion
7. Chunk 7: Clinic Days Improvements

**Phase 4 (Polish - P3):**
8. Chunk 8: Ingest UI Improvements
9. Chunk 9: Request System Polish

---

## Dependencies Graph

```
Chunk 1 (Data Quality)
    └── Chunk 3 (Cat Dedup) - uses improved linking

Chunk 2 (Appointment Unification)
    └── Chunk 4 (Clinic History) - depends on v_appointment_detail

Chunk 5 (Colony Reconciliation) - standalone

Chunk 6 (ClinicHQ Notes)
    └── Chunk 4 (Clinic History) - notes visible in history

Chunk 7 (Clinic Days) - standalone

Chunk 8 (Ingest UI) - standalone

Chunk 9 (Request Polish) - standalone
```

---

## Quick Reference: Source Plan Files

| Chunk | Source Plan File | Status |
|-------|------------------|--------|
| 1 | `idempotent-popping-zebra.md` | Design complete |
| 2 | `whimsical-jingling-token.md` | Design complete |
| 3 | `reflective-stargazing-muffin.md` | Design complete |
| 4 | `sorted-soaring-liskov.md` | Design complete |
| 5 | `kind-soaring-quill.md` | Design complete |
| 6 | `quiet-cooking-bubble.md` | Design complete |
| 7 | `moonlit-zooming-cocoa.md` | In progress |
| 8 | `abstract-napping-stardust.md` | Design only |
| 9 | `spicy-conjuring-sifakis.md` | 90% complete |

**Completed (archived):**
- `federated-launching-pascal.md` - Phone formatting (DONE)
