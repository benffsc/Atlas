# Atlas Requests System Redesign

**Status:** PLANNING
**Created:** 2026-02-26
**Author:** Claude with FFSC Team

---

## Executive Summary

The current requests system is overly complex due to legacy Airtable compatibility requirements. Now that Atlas is the primary system, we can simplify the workflow, eliminate confusing intermediate states, and create an intuitive dispatch-style interface for trapping coordinators.

---

## Current Problems

### 1. Confusing Status Flow (7 states, 2 unnecessary clicks)
```
Current: new → triaged → scheduled → in_progress → completed
                            ↓
                         on_hold → cancelled
```

**Issues:**
- "Triage" is meaningless to coordinators - it's just "we looked at it"
- To mark "in progress", user must click Triage first, THEN Start
- "Scheduled" only makes sense if there's a scheduled_date
- Status transitions require navigating to detail page

### 2. Filter Pills Duplicate Functionality
- "My Assigned, All Active, Needs Triage, Urgent" duplicate the dropdown filters
- "More" dropdown contains the same presets again
- Mental model: "Am I filtering or changing view?"

### 3. Cards Missing Key Information
- Some cards show addresses, some don't (depends on place_name)
- No quick status change from card view
- No progress indicator (cats fixed / total)
- Trapper assignment buried in small text

### 4. Request Titles Are Random
- Web intake: Whatever the user typed
- Call sheet: First line of notes
- Legacy: Airtable record name
- Result: "TNR Request", "Help!", "Cats on my property" - not useful

### 5. Detail Page Overloaded
- Quick Actions: 3 status buttons that change based on current status
- Action Buttons: Print, Trapper Sheet, History, Edit, Redirect, Hand Off
- Tabs: Details, Activity, Legacy Data, Nearby, Gallery
- Sidebar: Stats, Map, Nearby counts

### 6. Crash Bug
The "Triage" button crashes the app - likely a state rendering issue when status updates.

---

## Proposed Solution

### New Status Flow (4 states, 1 click)

```
Simplified: New → Working → Completed
                  ↓
               Paused
```

| Old Status | New Status | Notes |
|------------|------------|-------|
| new | New | Unchanged |
| triaged | New | Merge into New (already looked at = still New) |
| scheduled | Working | Has scheduled_date, work happening |
| in_progress | Working | Active trapping in progress |
| on_hold | Paused | Waiting on something |
| completed | Completed | Done |
| cancelled | Completed | Done (reason: cancelled) |

**Migration:** `triaged` → `new`, `scheduled`/`in_progress` → `working`, `on_hold` → `paused`

### New Primary View: Kanban Board

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     NEW (12)    │  │  WORKING (8)    │  │   PAUSED (3)    │  │ COMPLETED (47)  │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │
│ │ 123 Oak St  │ │  │ │ 456 Pine Rd │ │  │ │ 789 Elm Ave │ │  │ │ 101 Cedar Ln│ │
│ │ Petaluma    │ │  │ │ Santa Rosa  │ │  │ │ Cotati      │ │  │ │ Rohnert Pk  │ │
│ │ ━━━━━░░░ 3/8│ │  │ │ ━━━━━━━░ 5/6│ │  │ │ Hold: kitns │ │  │ │ ✓ 12 cats  │ │
│ │ 🐱 +kittens │ │  │ │ 📅 Mar 1    │ │  │ └─────────────┘ │  │ └─────────────┘ │
│ └─────────────┘ │  │ │ 👤 Maria L. │ │  │                 │  │                 │
│                 │  │ └─────────────┘ │  │                 │  │                 │
│ ┌─────────────┐ │  │                 │  │                 │  │                 │
│ │ 234 Main St │ │  │ ┌─────────────┐ │  │                 │  │                 │
│ │ Sebastopol  │ │  │ │ 567 2nd St  │ │  │                 │  │                 │
│ │ ━━░░░░░ 2/10│ │  │ │ Petaluma    │ │  │                 │  │                 │
│ └─────────────┘ │  │ └─────────────┘ │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Features:**
- Drag-and-drop between columns to change status
- Cards show: Address, City, Progress bar, Kittens flag, Trapper, Scheduled date
- Click card to open detail sheet (slide-over, not navigation)
- Filter bar above for: Search, Priority, Has Kittens, My Assigned

### New Card Design

```
┌──────────────────────────────────────────┐
│ 📍 123 Oak Street                    🔴  │  ← Priority indicator
│    Petaluma, CA                          │
│                                          │
│ ━━━━━━━━━━━░░░░░░░░ 5/12 cats fixed     │  ← Progress bar
│                                          │
│ 🐱 +kittens  │  📅 Scheduled: Mar 1      │
│ 👤 Maria L.  │  ⏱️ 3 days ago            │
│                                          │
│ [Start] [Pause] [More ▾]                 │  ← Quick actions
└──────────────────────────────────────────┘
```

**Always Show:**
1. Address (from place_address, extract street + city)
2. Progress bar (verified_altered / colony_size_estimate)
3. Key flags (kittens, urgency)
4. Trapper assignment
5. Quick action buttons

### Simplified Detail Sheet (Slide-Over)

Instead of full page navigation, clicking a card opens a slide-over sheet:

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back                                              [Edit]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  123 Oak Street, Petaluma                                   │
│  ━━━━━━━━━━━░░░░░░░░ 5/12 cats fixed (42%)                 │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Start   │  │  Pause   │  │ Complete │  │  Cancel  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  CONTACT                          LOCATION                  │
│  Jane Smith                       [Map Preview]             │
│  jane@email.com                   View in Atlas Map →       │
│  (707) 555-1234                   Open Google Maps →        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  TRAPPER ASSIGNMENT                                         │
│  👤 Maria Lopez (FFSC Trapper)    [Change] [Remove]        │
│  📅 Scheduled: March 1, 2026                                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  COLONY INFO                                                │
│  🐱 12 cats estimated  │  ✂️ 5 verified fixed               │
│  🍼 +kittens reported  │  📋 7 remaining                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                            │
│  • Mar 1: Site visit logged (Maria)                        │
│  • Feb 28: Trapper assigned                                 │
│  • Feb 25: Request created from web intake                  │
│                                                             │
│  [View Full History] [Add Note] [Send Email]               │
└─────────────────────────────────────────────────────────────┘
```

### Auto-Generated Titles

Replace random `summary` with structured titles:

**Format:** `{Street}, {City} ({Cat Count} cats)`

| Source | Current Title | New Title |
|--------|--------------|-----------|
| Web Intake | "Help with cats" | "123 Oak St, Petaluma (8 cats)" |
| Call Sheet | "TNR Request" | "456 Pine Rd, Santa Rosa (3 cats)" |
| Legacy | "Jane Smith" | "789 Elm Ave, Cotati (15 cats)" |

**SQL Migration:**
```sql
UPDATE ops.requests r
SET summary = CONCAT(
  COALESCE(SPLIT_PART(p.formatted_address, ',', 1), 'Unknown'),
  ', ',
  COALESCE(a.city, 'Unknown'),
  ' (',
  COALESCE(r.estimated_cat_count, 0),
  ' cats)'
)
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
WHERE r.place_id = p.place_id
  AND r.summary IS NULL OR r.summary IN ('', 'TNR Request', 'Help', 'Untitled');
```

### Removed/Simplified Elements

| Current | Action | Rationale |
|---------|--------|-----------|
| "Triage" button | Remove | Meaningless intermediate state |
| "Triaged" status | Merge to "New" | No workflow value |
| Filter pills (My Assigned, etc.) | Keep top 3 only | Reduce clutter |
| "More" dropdown | Remove | Already have dropdowns |
| Legacy tab | Move to Settings | Rarely used |
| History button | Move inside Edit | Not primary action |
| Redirect button | Keep | Sometimes needed |
| Hand Off button | Keep | Sometimes needed |

---

## Implementation Plan

### Phase 1: Fix Crash & Prep (1 session)

1. **Fix Types** - Add missing fields to RequestDetail type
2. **Fix Crash** - Trace and fix triage button crash
3. **Add Status Migration** - SQL to map old → new statuses

### Phase 2: New Status System (1 session)

1. **Update enum** - `new`, `working`, `paused`, `completed`
2. **Migrate data** - Run status migration SQL
3. **Update API** - Handle new statuses
4. **Update badges** - New colors for simplified statuses

### Phase 3: Kanban Board (2 sessions)

1. **Create KanbanBoard component** - drag-and-drop columns
2. **Create RequestCard component** - new card design
3. **Add view toggle** - Kanban / Cards / Table
4. **Implement drag-drop status change**

### Phase 4: Detail Sheet (1 session)

1. **Create SlideOverSheet component**
2. **Migrate detail page content to sheet**
3. **Simplify action buttons**
4. **Add quick status buttons**

### Phase 5: Polish (1 session)

1. **Auto-generate titles** - SQL migration + update on create
2. **Mobile optimization** - Touch gestures, responsive
3. **Remove deprecated elements**
4. **Update documentation**

---

## Migration SQL

### Status Migration
```sql
-- MIG_2520__simplify_request_status.sql

-- 1. Add new status values to enum
ALTER TYPE ops.request_status ADD VALUE IF NOT EXISTS 'working';
ALTER TYPE ops.request_status ADD VALUE IF NOT EXISTS 'paused';

-- 2. Migrate existing statuses
UPDATE ops.requests SET status = 'new' WHERE status = 'triaged';
UPDATE ops.requests SET status = 'working' WHERE status IN ('scheduled', 'in_progress');
UPDATE ops.requests SET status = 'paused' WHERE status = 'on_hold';
-- completed and cancelled stay as-is (or merge cancelled into completed with reason)

-- 3. Update status history for auditability
INSERT INTO ops.request_status_history (request_id, old_status, new_status, changed_by, reason)
SELECT request_id, 'triaged', 'new', 'MIG_2520', 'Status simplification'
FROM ops.requests WHERE status = 'new';
-- (similar for other migrations)
```

### Title Generation
```sql
-- MIG_2521__auto_generate_request_titles.sql

UPDATE ops.requests r
SET summary = CONCAT(
  COALESCE(SPLIT_PART(p.formatted_address, ',', 1), 'Unknown Location'),
  CASE WHEN a.city IS NOT NULL THEN ', ' || a.city ELSE '' END,
  ' (',
  COALESCE(r.estimated_cat_count, 0)::TEXT,
  ' cats)'
)
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
WHERE r.place_id = p.place_id
  AND (r.summary IS NULL OR r.summary = '' OR r.summary ~* '^(tnr|help|untitled|request)');
```

---

## UI Component Specifications

### KanbanColumn Component
```tsx
interface KanbanColumnProps {
  status: 'new' | 'working' | 'paused' | 'completed';
  requests: Request[];
  onDrop: (requestId: string, newStatus: string) => void;
  onCardClick: (requestId: string) => void;
}
```

### RequestCard Component
```tsx
interface RequestCardProps {
  request: {
    request_id: string;
    address: string;
    city: string;
    progress: { fixed: number; total: number };
    hasKittens: boolean;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    trapperName: string | null;
    scheduledDate: string | null;
    lastActivityDays: number;
  };
  onStatusChange: (newStatus: string) => void;
  onClick: () => void;
  draggable?: boolean;
}
```

### QuickStatusButtons Component
```tsx
interface QuickStatusButtonsProps {
  currentStatus: string;
  onStatusChange: (newStatus: string) => Promise<void>;
  disabled?: boolean;
}

// Always shows available transitions:
// new → [Start Working] [Pause]
// working → [Complete] [Pause]
// paused → [Resume] [Cancel]
// completed → [Reopen]
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Clicks to change status | 2+ (navigate + click) | 1 (drag or click) |
| Time to find request | ~10s (filter + scroll) | ~3s (kanban scan) |
| Crash rate | >0 (triage button) | 0 |
| Status states | 7 | 4 |
| Action buttons on detail | 8+ | 4 |

---

## Appendix: Status Color Scheme

| Status | Background | Text | Icon |
|--------|------------|------|------|
| New | `#dbeafe` (blue-100) | `#1e40af` (blue-800) | 📥 |
| Working | `#fef3c7` (amber-100) | `#92400e` (amber-800) | 🔄 |
| Paused | `#fce7f3` (pink-100) | `#9d174d` (pink-800) | ⏸️ |
| Completed | `#d1fae5` (green-100) | `#065f46` (green-800) | ✅ |

---

## Requestor Intelligence System

### Problem: Requestor vs Resident Confusion

The person who submits a request is often NOT the person who lives at the location:

| Requestor Type | Example | Is Resident? |
|----------------|---------|--------------|
| FFSC Trapper | Maria (trapper) calls about colony on Oak St | No |
| Neighbor | John reports cats at apartment next door | No |
| Property Manager | ABC Management reports cats at rental | No |
| Actual Resident | Jane reports cats in her backyard | Yes |
| Colony Caretaker | Kim feeds cats at vacant lot | Maybe |

**Current Problem:** We often create `person_place_relationships` linking the requestor to the request's place as a "resident" — this pollutes place data.

### ServiceNow Pattern: Caller vs Affected Party

Industry standard distinguishes:
- **Caller/Opened By:** Who created the record
- **Affected Party/Opened For:** Who the work is actually for

**Applied to Atlas:**
- `requester_person_id`: Who submitted the request (already exists)
- `site_contact_person_id`: Who is the primary contact at the location (NEW)
- `requester_is_site_contact`: Boolean flag when same person (NEW)

### Trapper Detection Intelligence

When a requestor is a known trapper, they're almost certainly NOT the resident:

```sql
-- Check if requestor is a trapper
SELECT EXISTS (
  SELECT 1 FROM sot.person_roles pr
  WHERE pr.person_id = :requester_person_id
    AND pr.role IN ('trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator')
    AND pr.is_active = TRUE
) AS is_trapper;
```

**Auto-Classification Rules:**

| Requestor Role | Default `requester_is_site_contact` | UI Prompt |
|----------------|-------------------------------------|-----------|
| Trapper/Coordinator | `FALSE` | "Who is the site contact?" |
| Unknown (new person) | `NULL` | "Are you the resident?" (intake) |
| Known resident at place | `TRUE` | None needed |

### Schema Changes

```sql
-- MIG_2522__requestor_site_contact_distinction.sql

-- 1. Add site contact tracking
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS site_contact_person_id UUID REFERENCES sot.people(person_id),
ADD COLUMN IF NOT EXISTS requester_is_site_contact BOOLEAN,
ADD COLUMN IF NOT EXISTS requester_role_at_submission TEXT;  -- cached role snapshot

-- 2. Index for site contact lookups
CREATE INDEX IF NOT EXISTS idx_requests_site_contact
ON ops.requests(site_contact_person_id) WHERE site_contact_person_id IS NOT NULL;

-- 3. Function to detect requestor type
CREATE OR REPLACE FUNCTION ops.classify_requestor_role(p_person_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Check trapper roles first (most likely to be "not resident")
  SELECT pr.role INTO v_role
  FROM sot.person_roles pr
  WHERE pr.person_id = p_person_id
    AND pr.role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper')
    AND pr.is_active = TRUE
  ORDER BY
    CASE pr.role
      WHEN 'coordinator' THEN 1
      WHEN 'head_trapper' THEN 2
      WHEN 'ffsc_trapper' THEN 3
      WHEN 'community_trapper' THEN 4
      ELSE 5
    END
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- Check staff
  IF EXISTS (SELECT 1 FROM sot.staff WHERE person_id = p_person_id AND is_active = TRUE) THEN
    RETURN 'staff';
  END IF;

  -- Default: unknown (could be resident or not)
  RETURN 'unknown';
END;
$$ LANGUAGE plpgsql;

-- 4. Auto-set requester_is_site_contact on insert/update
CREATE OR REPLACE FUNCTION ops.auto_classify_requestor()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Get requestor role
  v_role := ops.classify_requestor_role(NEW.requester_person_id);
  NEW.requester_role_at_submission := v_role;

  -- Auto-set is_site_contact based on role
  IF v_role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff') THEN
    -- Trappers/staff are NOT site contacts by default
    NEW.requester_is_site_contact := COALESCE(NEW.requester_is_site_contact, FALSE);
  ELSIF NEW.site_contact_person_id IS NULL AND NEW.requester_is_site_contact IS NULL THEN
    -- Unknown requestor with no explicit site contact - assume they ARE the contact
    NEW.requester_is_site_contact := TRUE;
  END IF;

  -- If requester IS site contact, copy to site_contact_person_id
  IF NEW.requester_is_site_contact = TRUE AND NEW.site_contact_person_id IS NULL THEN
    NEW.site_contact_person_id := NEW.requester_person_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_classify_requestor
BEFORE INSERT OR UPDATE ON ops.requests
FOR EACH ROW EXECUTE FUNCTION ops.auto_classify_requestor();
```

### UI Changes for Requestor Prominence

#### Card Design (Updated)

```
┌──────────────────────────────────────────┐
│ 📍 123 Oak Street                    🔴  │
│    Petaluma, CA                          │
│                                          │
│ ━━━━━━━━━━━░░░░░░░░ 5/12 cats fixed     │
│                                          │
│ 📞 REQUESTOR: Maria L. (Trapper)         │  ← NEW: Prominent requestor
│ 🏠 SITE CONTACT: Jane Smith              │  ← NEW: Separate site contact
│                                          │
│ 📅 Mar 1  │  👤 Assigned: Toni P.        │
│                                          │
│ [Start] [Pause] [More ▾]                 │
└──────────────────────────────────────────┘
```

#### Detail Sheet (Updated)

```
┌─────────────────────────────────────────────────────────────┐
│  REQUESTOR                        SITE CONTACT              │
│  ┌─────────────────────┐          ┌─────────────────────┐   │
│  │ 📞 Maria Lopez      │          │ 🏠 Jane Smith       │   │
│  │ (707) 555-1234      │          │ jane@email.com      │   │
│  │ 🏷️ FFSC Trapper     │          │ (707) 555-4321      │   │
│  │ "Called in colony"  │          │ "Lives at address"  │   │
│  └─────────────────────┘          └─────────────────────┘   │
│                                                             │
│  [✓ Same Person]  ← Toggle when requestor IS site contact   │
└─────────────────────────────────────────────────────────────┘
```

---

## Cross-Source Data Matching

### Problem: Request Created Before Clinic Data

Timeline:
1. **Day 1:** Request created via Web Intake for "123 Oak St"
2. **Day 5:** Trapping happens, cats brought to clinic
3. **Day 5:** ClinicHQ appointment created with "Owner: Jane Smith, 123 Oak St"
4. **Goal:** Connect appointment to request automatically

### Matching Strategy

```
┌──────────────────────────────────────────────────────────────┐
│                    MATCHING HIERARCHY                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  TIER 1: Place Match (Highest Confidence)                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ request.place_id = appointment.inferred_place_id       │  │
│  │ OR                                                      │  │
│  │ request.place_id IN get_place_family(appt.place_id)    │  │
│  │                                                         │  │
│  │ → AUTO-LINK if within 6 months                         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  TIER 2: Address Fuzzy Match (Medium Confidence)            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Normalize both addresses                                │  │
│  │ If >85% similarity AND same city:                      │  │
│  │ → Suggest link in review queue                         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  TIER 3: Person Match (Lower Confidence)                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ request.requester_person_id = appointment.person_id    │  │
│  │ OR request.site_contact_person_id = appointment.person │  │
│  │                                                         │  │
│  │ → Only if ALSO same general area (5km radius)          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Link Function

```sql
-- MIG_2523__request_appointment_linking.sql

CREATE OR REPLACE FUNCTION ops.link_appointments_to_requests()
RETURNS TABLE(linked_count INT, review_queue_count INT) AS $$
DECLARE
  v_linked INT := 0;
  v_review INT := 0;
  v_record RECORD;
BEGIN
  -- TIER 1: Direct place_id match
  FOR v_record IN
    SELECT DISTINCT a.appointment_id, r.request_id
    FROM ops.appointments a
    JOIN ops.requests r ON (
      a.inferred_place_id = r.place_id
      OR a.inferred_place_id = ANY(sot.get_place_family(r.place_id))
    )
    WHERE a.request_id IS NULL
      AND r.status NOT IN ('completed', 'cancelled')
      AND a.appointment_date >= r.created_at - INTERVAL '7 days'
      AND a.appointment_date <= r.created_at + INTERVAL '6 months'
  LOOP
    UPDATE ops.appointments
    SET request_id = v_record.request_id
    WHERE appointment_id = v_record.appointment_id
      AND request_id IS NULL;

    IF FOUND THEN v_linked := v_linked + 1; END IF;
  END LOOP;

  -- TIER 2 & 3: Queue for review (address/person fuzzy match)
  INSERT INTO ops.data_quality_review_queue (
    entity_type, entity_id, issue_type, suggested_action, details
  )
  SELECT
    'appointment', a.appointment_id, 'potential_request_match',
    'link_to_request', jsonb_build_object(
      'request_id', r.request_id,
      'match_type', 'address_similarity',
      'similarity', similarity(
        COALESCE(p1.formatted_address, ''),
        COALESCE(p2.formatted_address, '')
      )
    )
  FROM ops.appointments a
  JOIN sot.places p1 ON p1.place_id = a.inferred_place_id
  JOIN ops.requests r ON r.status NOT IN ('completed', 'cancelled')
  JOIN sot.places p2 ON p2.place_id = r.place_id
  WHERE a.request_id IS NULL
    AND p1.place_id != p2.place_id
    AND similarity(
      COALESCE(p1.formatted_address, ''),
      COALESCE(p2.formatted_address, '')
    ) > 0.85
    AND a.appointment_date >= r.created_at - INTERVAL '7 days'
    AND a.appointment_date <= r.created_at + INTERVAL '6 months'
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_review = ROW_COUNT;

  RETURN QUERY SELECT v_linked, v_review;
END;
$$ LANGUAGE plpgsql;
```

### Place Classification from Request Context

When a request is created, we can pre-classify the place:

```sql
-- MIG_2524__request_place_classification.sql

CREATE OR REPLACE FUNCTION ops.classify_request_place()
RETURNS TRIGGER AS $$
DECLARE
  v_requestor_role TEXT;
BEGIN
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_requestor_role := ops.classify_requestor_role(NEW.requester_person_id);

  -- If requestor is a trapper reporting a colony, it's likely a colony site
  IF v_requestor_role IN ('ffsc_trapper', 'community_trapper', 'trapper') THEN
    -- Add colony context if not already present
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'colony_site',
      'inferred',
      'request_from_trapper',
      jsonb_build_object('request_id', NEW.request_id, 'trapper_role', v_requestor_role)
    );
  END IF;

  -- If request has kittens, add breeding_site context
  IF NEW.has_kittens = TRUE THEN
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'breeding_site',
      'inferred',
      'request_has_kittens',
      jsonb_build_object('request_id', NEW.request_id)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_classify_request_place
AFTER INSERT ON ops.requests
FOR EACH ROW EXECUTE FUNCTION ops.classify_request_place();
```

---

## Updated Implementation Plan

### Phase 1: Fix Crash & Schema Prep (1 session)

1. **Fix Types** - Add missing fields to RequestDetail type ✅ DONE
2. **Fix Crash** - Trace and fix triage button crash
3. **Add Requestor Intelligence Schema** - MIG_2522
4. **Add Request-Appointment Linking** - MIG_2523
5. **Add Place Classification Trigger** - MIG_2524

### Phase 2: New Status System (1 session)

1. **Update enum** - `new`, `working`, `paused`, `completed`
2. **Migrate data** - Run status migration SQL
3. **Update API** - Handle new statuses
4. **Update badges** - New colors for simplified statuses

### Phase 3: Kanban Board (2 sessions)

1. **Create KanbanBoard component** - drag-and-drop columns
2. **Create RequestCard component** - new card design with requestor/site contact
3. **Add view toggle** - Kanban / Cards / Table
4. **Implement drag-drop status change**

### Phase 4: Detail Sheet (1 session)

1. **Create SlideOverSheet component**
2. **Add Requestor vs Site Contact section**
3. **Add "Same Person" toggle**
4. **Simplify action buttons**

### Phase 5: Polish & Integration (1 session)

1. **Auto-generate titles** - SQL migration + update on create
2. **Run request-appointment linking** - Backfill existing data
3. **Add trapper detection to web intake**
4. **Mobile optimization**
5. **Update documentation**

---

## Questions for FFSC Team

1. **Cancelled vs Completed:** Should cancelled be a separate status, or completed with a `reason` field?
2. **Scheduled Date:** Keep as separate field, or just use "Working" status?
3. **Legacy Data:** Archive old triaged/in_progress history, or migrate to new statuses?
4. **Mobile Priority:** Should Kanban be the primary mobile view, or cards?
5. **Requestor Display:** Show trapper badge prominently, or subtle indicator?
6. **Site Contact Default:** For web intake where user IS the resident, auto-check "Same Person"?
