# Request Overhaul: Final Implementation Plan

**Status:** Phase 3 DB Complete | ✅ Phase A Frontend Complete | ✅ Phase B Complete | Integration 80%
**Created:** 2026-02-26
**Updated:** 2026-02-26 (Phase A frontend compatibility completed)
**Purpose:** Consolidate all gaps and define remaining work for request/intake standardization

---

## Executive Summary

### What's Done (Database Layer)
- MIG_2530: Simplified 4-state status system
- MIG_2531: Intake-request field unification (30+ columns)
- MIG_2532: Complete request field coverage (Beacon-critical fields)
- MIG_2533: Backfill function for native requests from intakes
- New request form: Added peak_count, county, awareness_duration, third-party fields

### What's Broken (Frontend Layer)
- **TypeScript types** don't include new fields
- **Status constants** conflict between `constants.ts` and `enums.ts`
- **Saved filters** hardcoded with old statuses (triaged, scheduled, etc.)
- **Conversion wizard** doesn't use MIG_2531/2532 fields
- **Request detail page** can't edit new fields

### Key Insight: Web Intakes vs Requests
Web intakes are a **triage point**, not automatically requests:
- 1,242 total intake submissions
- Only ~5 converted to requests (when trapping assistance needed)
- Others: out of county, owned cats, info-only, referrals, declined

---

## Gap Analysis Summary

### Critical Gaps (Blocks Production)

| Area | Issue | Files Affected | Severity |
|------|-------|----------------|----------|
| **Type Definitions** | RequestDetail missing 30+ fields | `requests/[id]/types.ts` | CRITICAL |
| **Status Enums** | Duplicate definitions conflict | `constants.ts` vs `enums.ts` | CRITICAL |
| **Saved Filters** | Old statuses in presets | `SavedFilters.tsx` | HIGH |
| **Quick Actions** | Old status case statements | `QuickActions.tsx` | HIGH |
| **Status Pipeline** | 7-state display instead of 4 | `StatusPipeline.tsx` | MEDIUM |
| **Sidebar Nav** | Links to old status URLs | `SidebarLayout.tsx` | MEDIUM |
| **Request Edit** | editForm missing new fields | `requests/[id]/page.tsx` | HIGH |

### Integration Gaps (Affects Workflow)

| Area | Issue | Impact |
|------|-------|--------|
| **Conversion Wizard** | Doesn't show MIG_2532 fields | peak_count, dogs_on_site lost |
| **No Convert API** | Missing `/api/intake/[id]/convert` | Staff can't convert via API |
| **No Enrich API** | Missing `/api/requests/[id]/enrich` | Can't upgrade from intake |
| **Requestor Intelligence** | MIG_2522 not in UI | No requester vs site contact |
| **Place Enrichment** | Not called after conversion | Beacon doesn't get colony data |
| **Non-Conversion Flow** | No decline/referral statuses | Unclear how to handle non-converts |

---

## UI/UX Best Practices Applied

Based on research of TNR software (ShelterLuv, PetPoint, Alley Cat Allies):

### 1. Triage Priority Matrix
```
| Priority | Impact | Urgency | Atlas Criteria |
|----------|--------|---------|----------------|
| P1 Urgent | High | High | Kittens <8 weeks, injuries, pregnancy |
| P2 High | High | Medium | Large colony (>10), medical concerns |
| P3 Normal | Medium | Medium | Standard TNR, stable colony |
| P4 Low | Low | Low | Single cat, already managed |
```

### 2. Kanban Best Practices
- **WIP Limits**: Prevent volunteer overload
- **Card Info**: Priority badge, cat count, kittens flag, assigned trapper
- **Progress Bar**: verified_altered / estimated_cat_count
- **Quick Status Change**: Dropdown per card (implemented)

### 3. Form Design
- **Conditional Sections**: Show/hide based on answers
- **Pre-fill from Intake**: Don't re-ask captured data
- **Data Quality Indicators**: Completeness %, missing Beacon fields
- **Real-time Duplicate Detection**: Alert on similar addresses

### 4. Colony Data Fields (Alley Cat Allies Standard)
- Peak count observed (BEACON CRITICAL for Chapman)
- Colony duration
- Cats altered vs unaltered
- Caretaker info
- Feeding schedule and location

---

## Implementation Plan

### Phase A: Fix Frontend Compatibility (Today)

#### A1. Consolidate Status Enums
**Files:** `src/lib/constants.ts`, `src/lib/enums.ts`

**Problem:** Two conflicting definitions:
```typescript
// constants.ts (OLD - conflicts)
export type RequestStatus = "triaged" | "scheduled" | "in_progress" | "on_hold" | ...

// enums.ts (NEW - correct)
export type REQUEST_STATUS = "new" | "working" | "paused" | "completed" | ...
```

**Solution:**
1. Delete RequestStatus from constants.ts
2. Import from enums.ts everywhere
3. Keep legacy values for backward compat in DB queries

#### A2. Update RequestDetail Type
**File:** `src/app/requests/[id]/types.ts`

Add 35+ new fields:
```typescript
interface RequestDetail {
  // ... existing fields ...

  // MIG_2532: Beacon-critical
  peak_count: number | null;
  awareness_duration: string | null;
  county: string | null;

  // MIG_2531: Structured data
  count_confidence: string | null;
  colony_duration: string | null;
  cat_name: string | null;
  cat_description: string | null;

  // Kitten tracking
  has_kittens: boolean;
  kitten_count: number | null;
  kitten_age_estimate: string | null;
  kitten_behavior: string | null;
  kitten_contained: string | null;
  mom_present: string | null;
  mom_fixed: string | null;
  can_bring_in: string | null;
  kitten_notes: string | null;

  // Feeding
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_frequency: string | null;
  feeding_location: string | null;
  feeding_time: string | null;

  // Access/Property
  is_property_owner: boolean | null;
  has_property_access: boolean | null;
  access_notes: string | null;

  // Medical
  is_emergency: boolean | null;
  has_medical_concerns: boolean | null;
  medical_description: string | null;

  // Third-party (MIG_2522)
  is_third_party_report: boolean | null;
  third_party_relationship: string | null;
  site_contact_person_id: string | null;
  requester_is_site_contact: boolean | null;
  requester_role_at_submission: string | null;

  // Trapping logistics (MIG_2532)
  dogs_on_site: boolean | null;
  trap_savvy: boolean | null;
  previous_tnr: boolean | null;
  best_trapping_time: string | null;

  // Triage
  triage_category: string | null;
  received_by: string | null;
}
```

#### A3. Update SavedFilters.tsx
**File:** `src/components/SavedFilters.tsx`

Change PRESET_FILTERS:
```typescript
// OLD
["new", "triaged", "scheduled", "in_progress", "on_hold"]

// NEW
["new", "working", "paused"]
```

#### A4. Update QuickActions.tsx
Replace old status case statements with new values.

#### A5. Update StatusPipeline.tsx
Change from 7-state to 4-state timeline:
```typescript
// OLD
MAIN_STATUSES = ["new", "triaged", "scheduled", "in_progress", "completed"]

// NEW
MAIN_STATUSES = ["new", "working", "paused", "completed"]
```

#### A6. Update SidebarLayout.tsx
Fix navigation links:
```typescript
// OLD
/requests?status=scheduled

// NEW
/requests?status=working
```

---

### Phase B: Request Detail Enhancement (1-2 Days)

#### B1. Update editForm State
**File:** `src/app/requests/[id]/page.tsx`

Add all new fields to editForm object so they can be saved:
```typescript
const [editForm, setEditForm] = useState({
  // ... existing ...
  peak_count: request.peak_count,
  awareness_duration: request.awareness_duration,
  county: request.county,
  // ... all 30+ fields ...
});
```

#### B2. Add Requestor vs Site Contact Section
**File:** `src/app/requests/[id]/tabs/DetailsTab.tsx`

Design:
```
┌─────────────────────────────────────────┐
│ REQUESTOR                               │
│ Maria L. (Trapper)                      │
│ 707-555-1234 | maria@email.com          │
│ [Same as Site Contact] ← toggle         │
├─────────────────────────────────────────┤
│ SITE CONTACT                            │
│ Jane Smith (Resident)                   │
│ 707-555-5678 | jane@email.com           │
└─────────────────────────────────────────┘
```

#### B3. Add Data Quality Sidebar
Show missing Beacon-critical fields:
```
┌────────────────────────────────────┐
│ Data Completeness: 65%            │
├────────────────────────────────────┤
│ ⚠ Missing Beacon fields:          │
│   • Peak count observed           │
│   • Colony duration               │
│   • Awareness duration            │
│                                    │
│ [Enrich from Intake]              │
└────────────────────────────────────┘
```

#### B4. Add Colony Progress Bar
Show TNR completion:
```
verified_altered / estimated_cat_count
[██████████░░░░░░░░░░] 12/24 (50%)
```

---

### Phase C: API Endpoints (1-2 Days)

#### C1. Create /api/intake/[id]/convert
**Purpose:** Convert intake submission to request via API

```typescript
// POST /api/intake/[id]/convert
{
  priority: "normal",
  permission_status: "yes",
  urgency_reasons: ["kittens"],
  trapper_notes: "..."
}

// Response
{
  success: true,
  request_id: "uuid",
  message: "Converted successfully"
}
```

**Implementation:**
- Call `ops.convert_intake_to_request(submission_id, staff_id)`
- Update `intake_submissions.converted_to_request_id`
- Return new request_id

#### C2. Create /api/requests/[id]/enrich
**Purpose:** Upgrade request by pulling data from linked intake

```typescript
// POST /api/requests/[id]/enrich
// No body needed - pulls from source intake

// Response
{
  success: true,
  fields_updated: ["county", "peak_count", "has_kittens"],
  source_intake_id: "uuid"
}
```

**Implementation:**
- Call `ops.upgrade_request_from_intake(request_id)`
- Return list of fields that were enriched

#### C3. Update PATCH /api/requests/[id]
Accept all new fields in request body for saving edits.

---

### Phase D: Conversion Wizard Enhancement (2-3 Days)

#### D1. Show Captured Intake Data
Pre-fill wizard with intake answers (read-only):
```
┌────────────────────────────────────────────┐
│ From Intake Submission                     │
├────────────────────────────────────────────┤
│ Cat Count: 5 (good estimate)              │
│ Peak Count: 8 seen at once                │
│ Colony Duration: 6 months - 2 years       │
│ Has Kittens: Yes (3 kittens, ~8 weeks)    │
│ Dogs on Site: Yes                         │
│ Trap Savvy: Unknown                       │
│ Feeding Time: 7am and 5pm                 │
│ Feeding Location: Back porch              │
│                                            │
│ [Edit in Request] ← opens edit form       │
└────────────────────────────────────────────┘
```

#### D2. Don't Re-Ask Captured Fields
- Show "Captured" badge next to pre-filled answers
- Only show editable fields if intake data was incomplete
- Progress indicator: "Step 2 of 3 (2 pre-filled)"

#### D3. Add Non-Conversion Actions
Add buttons for intakes that don't need trapping:
- **Decline** → Opens reason modal (out of county, owned cat, etc.)
- **Send Referral** → Opens referral template modal
- **Mark Info-Only** → Sets status without creating request

---

### Phase E: Non-Conversion Workflow (1 Day)

#### E1. Add Decline Status
New submission_status value: `declined`

#### E2. Add Decline Reasons
```sql
CREATE TABLE ops.intake_decline_reasons (
  id UUID PRIMARY KEY,
  submission_id UUID REFERENCES ops.intake_submissions,
  reason_code TEXT CHECK (reason_code IN (
    'out_of_county', 'owned_cat', 'already_fixed',
    'withdrawn', 'duplicate', 'spam', 'no_response',
    'referred_to_other_org', 'not_tnr_case'
  )),
  reason_notes TEXT,
  declined_at TIMESTAMPTZ DEFAULT NOW(),
  declined_by TEXT
);
```

#### E3. Add Referral Tracking
```sql
ALTER TABLE ops.intake_submissions
ADD COLUMN referred_to_org TEXT,
ADD COLUMN referral_sent_at TIMESTAMPTZ,
ADD COLUMN referral_notes TEXT;
```

---

### Phase F: Entity Enrichment (1-2 Days)

#### F1. Call enrich_place_from_request() After Conversion
When intake converts to request:
1. Create request
2. Call `enrich_place_from_request(request_id)` to update:
   - `place_colony_estimates` with peak_count, duration
   - `place_contexts` if feeding location mentioned

#### F2. Create enrich_person_from_request()
Extract from request:
- Feeder name → Create/link person with feeder role
- Property owner → Create/link person with property_owner role
- Third-party reporter → Create/link with referrer role

---

## File Change Checklist

### Critical (Today) — ✅ PHASE A COMPLETE

| File | Change | Status |
|------|--------|--------|
| `src/lib/request-status.ts` | **NEW** Single source of truth for all status logic | ✅ Created |
| `src/lib/constants.ts` | Remove duplicate RequestStatus, import from request-status | ✅ Done |
| `src/lib/enums.ts` | Import from request-status.ts | ✅ Done |
| `src/types/entities.ts` | Import RequestStatus from request-status | ✅ Done |
| `src/app/requests/[id]/types.ts` | Add 35+ new fields (Beacon-critical, kitten tracking, third-party) | ✅ Done |
| `src/components/SavedFilters.tsx` | Update PRESET_FILTERS with expandStatusFilter() | ✅ Done |
| `src/components/QuickActions.tsx` | Update to use mapToPrimaryStatus() | ✅ Done |
| `src/components/timeline/StatusPipeline.tsx` | Update to 4-state system with legacy support | ✅ Done |
| `src/components/SidebarLayout.tsx` | Update nav links to new statuses | ✅ Done |

### High Priority (This Week) — ✅ COMPLETE

| File | Change | Status |
|------|--------|--------|
| `src/app/requests/[id]/page.tsx` | Add editForm fields (16 new fields) | ✅ Done |
| `src/app/requests/[id]/page.tsx` | Requestor vs Site Contact section (already in page) | ✅ Done |
| `src/app/api/requests/[id]/route.ts` | Accept 30+ new fields in PATCH | ✅ Done |
| `src/app/api/intake/convert/route.ts` | Endpoint exists (verified) | ✅ Done |
| `src/app/api/requests/[id]/enrich/route.ts` | Created endpoint | ✅ Done |

### Medium Priority (Next Week)

| File | Change | Status |
|------|--------|--------|
| `src/app/requests/page.tsx` | **Rework list UI**: Group by status, show active prominently | ⬜ |
| `src/components/requests/CreateRequestWizard.tsx` | Pre-fill from intake | ⬜ |
| `src/components/intake/DeclineModal.tsx` | Create component | ⬜ |
| `sql/schema/v2/MIG_2534__decline_reasons.sql` | Create table | ⬜ |
| `src/app/admin/request-upgrades/page.tsx` | Create dashboard | ⬜ |

### UI Rework Details (requests/page.tsx)

**Problem:** Current list mixes all statuses together, making it hard to see what needs attention.

**Solution:**
1. **Group by status visually** - Show sections: New → Working → Paused (active statuses first)
2. **Status headers** - Clear colored headers with counts: "New (12)" "Working (55)" etc.
3. **Collapse completed** - Show completed section collapsed by default or at bottom
4. **Focus on active** - Default filter to active statuses only (new, working, paused)
5. **Larger status badges** - Make status more prominent on cards

**Current active request breakdown:**
- New: 12 requests
- Working: 55 requests
- Paused: 15 requests
- **Total Active: 82 requests**

### Navigation Overhaul (SidebarLayout.tsx - RequestsSidebar)

**Current sidebar has:**
- Quick Filters: New, Working, Paused, Completed (✅ already updated in code)
- Links to Intake Queue and Trappers

**Improvements needed:**
1. **Add assignment filters** - "My Assigned", "Needs Trapper", "Client Trapping"
2. **Add urgency filter** - "Urgent" quick link
3. **Add counts to sidebar** - Show "(12)" next to each status
4. **Highlight attention items** - Badge for requests needing attention
5. **Quick actions** - "Enter Call Sheet", "Print Call Sheet" in sidebar

### Filter Bar Improvements (SavedFilters.tsx)

**Current preset filters (first 4 show as chips):**
1. My Assigned (if logged in)
2. All Active (new + working + paused)
3. Needs Attention (new only)
4. Urgent (priority: urgent)
5. Has Kittens (in More dropdown)
6. Paused (in More dropdown)
7. Working (in More dropdown)
8. Completed (in More dropdown)

**Improvements needed:**
1. **Add "Needs Trapper"** - `trapperStatus: "pending"` filter
2. **Add "Stale (30+ days)"** - requests not updated in 30 days
3. **Reorder chips** - Most useful first: My Assigned, Needs Attention, All Active, Urgent
4. **Add counts** - Show "(12)" next to filter names

---

## CRITICAL: Deployment Checklist

**Key commit:** `8813bbe` (Phase A frontend status overhaul)

If production is missing these changes, ensure deployment includes:
- `src/lib/request-status.ts` (single source of truth) **NEW FILE**
- `src/lib/constants.ts` (removed duplicate RequestStatus)
- `src/lib/enums.ts` (imports from request-status)
- `src/types/entities.ts` (imports from request-status)
- `src/app/requests/[id]/types.ts` (35+ new fields)
- `src/components/SavedFilters.tsx` (expandStatusFilter for legacy compat)
- `src/components/QuickActions.tsx` (mapToPrimaryStatus)
- `src/components/timeline/StatusPipeline.tsx` (4-state system)
- `src/components/SidebarLayout.tsx` (new status links)

---

## Success Metrics

| Metric | Before | Target | Method |
|--------|--------|--------|--------|
| Requests with county | 0% | 100% | Form + backfill |
| Requests with peak_count | 0% | 50% | Form collection |
| Requests with has_kittens | 0% | 40% | Backfill from intakes |
| Frontend status errors | Possible | 0 | Fix type conflicts |
| Saved filter accuracy | Broken | 100% | Update presets |
| Conversion wizard completion | Unknown | Track | Add analytics |
| Decline reasons tracked | 0% | 100% | Add decline flow |

---

## Risk Mitigation

### If Migrations Not Applied Yet
1. Apply MIG_2530, 2531, 2532 to staging first
2. Verify status values migrated correctly
3. Test frontend with both old and new statuses
4. Apply to production during maintenance window

### Backward Compatibility
- Keep legacy status values in enums.ts
- API accepts both old and new values
- DB queries use CASE mapping
- Kanban maps old→new for display

### Rollback Plan
- Type changes are additive (no breaking changes)
- Status changes are mapped (not replaced)
- Old data preserved, new columns nullable

---

## Related Documents

- `docs/REQUEST_UPGRADE_STRATEGY.md` - Data upgrade paths
- `docs/INTAKE_REQUEST_DATA_FLOW_AUDIT.md` - Field gap analysis
- `sql/schema/v2/MIG_2530-2533` - Database migrations
- `.claude/plans/spicy-conjuring-sifakis.md` - Master plan

---

## Appendix: UI Research Highlights

### From Alley Cat Allies
- Colony tracking: peak count, duration, caretaker info
- Ear-tip as universal TNR indicator
- Standard flow: Trap → Intake → Surgery → Recovery → Return

### From Shelter Software (ShelterLuv, PetPoint)
- Configurable status stages
- Auto-population from applications
- Templates for common data
- Status-at-a-glance views

### From Kanban Best Practices
- WIP limits prevent burnout
- Card shows: priority, cat count, kittens flag, assignee
- Progress bar for completion
- Quick actions per card

### From Form UX Research
- Progress indicators for multi-step
- Conditional show/hide sections
- Real-time validation
- Duplicate detection on submit
