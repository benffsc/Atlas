# Atlas UI & Data Audit — Grounded in Reality

**Date:** 2026-02-21
**Purpose:** Comprehensive audit of actual code, schema, and data patterns to inform UI improvements.

---

## Part 1: Schema & Code Reality Check

### Request Classification — What Actually Exists

| Field | Table | Values | Status |
|-------|-------|--------|--------|
| `raw_property_type` | `ops.raw_intake_request` | private_home, apartment_complex, mobile_home_park, business, farm_ranch, public_park, industrial, other | ✅ EXISTS but only for new requests |
| `raw_request_purpose` | `ops.raw_intake_request` | tnr, wellness, hybrid, relocation, rescue | ✅ EXISTS |
| `request_type` | `ops.requests` | — | ❌ DOES NOT EXIST (contrary to initial assumption) |
| `property_type` | call-sheet form only | house, apartment, business, rural, other | ⚠️ NOT PERSISTED to DB |

**Reality:** The residence vs business distinction IS captured at intake (`raw_property_type`) but:
1. Only exists in `raw_intake_request` (staging table)
2. Not copied to `ops.requests` during promotion
3. Not visible in the UI after conversion

**Action Needed:** Add `property_type` column to `ops.requests` and copy from `raw_intake_request` during promotion.

### Existing Layout Components

| Component | Location | Purpose | Reusable? |
|-----------|----------|---------|-----------|
| `ProfileLayout` | `/components/ProfileLayout.tsx` | Tab-based detail pages | ✅ Yes |
| `SidebarLayout` | `/components/SidebarLayout.tsx` | App navigation | ✅ Yes |
| `Section` | Inline in pages | Content grouping | ❌ Not extracted |
| `EntityLink` | `/components/EntityLink.tsx` | Linked record pills | ✅ Yes |
| `LinkedCatsSection` | `/components/LinkedCatsSection.tsx` | Cat relationship display | ✅ Yes |
| `EntityPreview` | `/components/EntityPreview.tsx` | Hover preview popup | ✅ Underused |

**Missing Components:**
- `LinkedPeopleSection` — No equivalent to LinkedCatsSection
- `LinkedPlacesSection` — No equivalent to LinkedCatsSection
- `TwoColumnLayout` — No sidebar pattern for detail pages
- `ReportView` — No print-friendly summary component

### Badge Components (Already Have)

From `/components/badges/`:
- `StatusBadge`, `PriorityBadge`, `PriorityDot`
- `TrapperBadge`, `TrapperTypePill`, `VolunteerBadge`
- `AtlasCatIdBadge`, `MicrochipStatusBadge`
- `VerificationBadge`, `DataQualityBadge`, `SourceBadge`

From `/components/data-quality/` (Phase 4):
- `QualityBadge`, `SourceIndicator`, `MergeReviewCard`

---

## Part 2: Data Quality Audit

### Request Data (291 total)

| Metric | Value | Assessment |
|--------|-------|------------|
| Requests with place_id | 100% (291/291) | ✅ Excellent |
| Requests with person_id | 98.3% (286/291) | ✅ Good |
| Source: Airtable | 94.8% (276) | Legacy data |
| Source: Atlas UI | 3.4% (10) | New system |
| Source: Web Intake | 1.7% (5) | Conversion working |

**Concern:** Source system is `airtable_ffsc` instead of `airtable` per CLAUDE.md standards.

### Intake Submissions (1,225 total)

| Metric | Value | Assessment |
|--------|-------|------------|
| Converted to requests | 0.4% (5) | ⚠️ Very low |
| Has person_id | 7.2% (88) | ⚠️ Poor linking |
| Has place_id | 2.4% (30) | ⚠️ Poor linking |
| Has triage_category | 0% (0) | ❌ Pipeline not running |
| Status: closed | 78.4% (961) | Archived without conversion |

**Critical Issue:** Triage pipeline is not populating `triage_category`. 92.6% of submissions have neither person nor place linked.

### Person Data (11,453 total)

| Metric | Value | Assessment |
|--------|-------|------------|
| entity_type = person | 99.99% (11,452) | ⚠️ Over-classification |
| entity_type = organization | 0.01% (1) | ⚠️ Under-detection |
| data_quality = normal | 100% | No review queue items |
| No identifiers (orphans) | 8 | Should be orgs |
| >5 place relationships | 1 (SCAS) | Acceptable |

**Critical Issues:**
1. **Organization misclassification:** Found 6+ clear business names marked as `person`:
   - Sartorial Auto Repairs, Blentech Corporation, Wiggins Electric
   - Aamco Repair Santa Rosa, Sunrise Farms One
   - Speedy Creek Winery, Keller Estates Vineyards
   - Mike's Truck Garden, Petaluma Poultry, Petaluma Livestock Auction

2. **Pseudo-profile:** "Rebooking placeholder" exists as a person record

3. **SCAS duplicates:** Sonoma County Animal Services exists as 2 person records, both should be org

### Place Data (7,939 total)

| Metric | Value | Assessment |
|--------|-------|------------|
| place_kind = unknown | 100% | ❌ No classification |
| is_geocoded | 92.2% (7,316) | ✅ Good |
| is_address_backed | 93.5% (7,421) | ✅ Good |
| Has place_contexts | 0% | ❌ Empty table |
| Street-only addresses | 1.6% (125) | ✅ Acceptable |

**Critical Issues:**
1. **217 Healdsburg Ave** — 2,381 cats linked. Likely a shelter/org, needs investigation and soft blacklist.
2. **1814 Empire Industrial Ct** — 2,353 cats linked. FFSC Clinic is in soft blacklist but legacy links remain.
3. **place_kind never classified** — All places are "unknown"
4. **place_contexts empty** — No colony site, feeding station, etc. classifications

### Cat Data (42,486 total)

| Metric | Value | Assessment |
|--------|-------|------------|
| Altered (spayed/neutered) | 84.5% (35,867) | ✅ Good |
| NULL altered_status | 14.2% (6,018) | ⚠️ Gap |
| No place relationship | 19.2% (8,162) | ⚠️ High unlinked |
| Source: ClinicHQ | 86.8% | Primary source |
| Source: ShelterLuv | 9.3% | Secondary |
| Source: PetLink | 4.0% | Registry only |

### Relationship Type Usage

| Relationship Table | Types Used | Types Available but Unused |
|-------------------|------------|---------------------------|
| person_cat | owner (99.99%), caretaker (0.01%) | adopter, foster, colony_caretaker, trapper |
| person_place | resident (100%) | owner, landlord, caretaker, trapper_for |
| cat_place | home (97.3%), appointment_site (2.7%) | colony_member, trapped_at, found_at |

**Critical Issue:** Relationship types are severely underutilized. The schema supports rich relationships but the pipeline only creates `owner`, `resident`, and `home`.

---

## Part 3: Grounded Recommendations

### What We CAN Do (Schema Supports It)

1. **Add property_type to requests** — Field exists in staging, just needs promotion
2. **Use place_kind for classification** — Column exists, needs population
3. **Use place_contexts** — Table exists, needs population
4. **Use relationship types** — Schema supports rich types, pipeline needs update
5. **Use existing badges** — Full badge system exists
6. **Use EntityLink pattern** — Proven pattern for linked records

### What We NEED to Build

1. **TwoColumnLayout** — New component for sidebar pattern
2. **LinkedPeopleSection** — Clone of LinkedCatsSection
3. **LinkedPlacesSection** — Clone of LinkedCatsSection
4. **PropertyTypeBadge** — New badge for residence/business/etc
5. **ReportView** — Print-friendly summary component

### What We NEED to Fix (Data Pipeline)

1. **Triage pipeline** — Not running, all submissions have NULL category
2. **Intake linking** — 92.6% have no person/place linked
3. **Organization classification** — 6+ businesses misclassified as person
4. **Place kind classification** — All places are "unknown"
5. **Place contexts** — Empty table
6. **Relationship types** — Underutilized

---

## Part 4: Implementation Plan

### Phase 1: Data Pipeline Fixes (Before UI Work)

These must be fixed first or the UI improvements won't have good data to display.

#### MIG_2370: Fix Organization Misclassification
```sql
-- Mark known businesses as organizations
UPDATE sot.people
SET entity_type = 'organization'
WHERE display_name IN (
  'Sartorial Auto Repairs', 'Blentech Corporation', 'Wiggins Electric',
  'Aamco Repair Santa Rosa', 'Sunrise Farms One', 'Speedy Creek Winery',
  'Keller Estates Vineyards', 'Mike''s Truck Garden', 'Petaluma Poultry',
  'Petaluma Livestock Auction', 'SCAS'
);

-- Delete pseudo-profile
DELETE FROM sot.people WHERE display_name = 'Rebooking placeholder';
```

#### MIG_2371: Add property_type to ops.requests
```sql
-- Add column
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS property_type TEXT;

-- Update promotion function to copy property_type
-- (modify trapper.promote_intake_request)
```

#### MIG_2372: Investigate and blacklist 217 Healdsburg Ave
```sql
-- Check what this place is
SELECT * FROM sot.places WHERE display_name ILIKE '%217 Healdsburg%';

-- If shelter/org, add to soft blacklist
INSERT INTO sot.place_soft_blacklist (place_id, blacklist_type, reason)
SELECT place_id, 'all', 'Shelter location - not residential'
FROM sot.places WHERE display_name ILIKE '%217 Healdsburg%';
```

#### MIG_2373: Classify place_kind
```sql
-- Classify based on patterns
UPDATE sot.places SET place_kind =
  CASE
    WHEN display_name ~* '(apt|unit|#)\s*\d' THEN 'apartment_unit'
    WHEN display_name ~* 'apartment|apts' THEN 'apartment_building'
    WHEN display_name ~* 'ranch|farm|vineyard|winery' THEN 'farm'
    WHEN display_name ~* 'clinic|hospital|vet' THEN 'clinic'
    WHEN display_name ~* 'shelter|rescue|spca' THEN 'shelter'
    WHEN display_name ~* 'mobile|mhp|trailer' THEN 'mobile_home'
    WHEN display_name ~* 'business|corp|inc|llc|store|shop' THEN 'business'
    ELSE 'single_family'
  END
WHERE place_kind = 'unknown' OR place_kind IS NULL;
```

### Phase 2: Layout Components (1-2 days)

Create reusable components that work with existing patterns.

#### 2.1 TwoColumnLayout Component
```typescript
// /components/layouts/TwoColumnLayout.tsx
interface TwoColumnLayoutProps {
  header: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
  footer?: ReactNode;
  sidebarWidth?: '30%' | '35%' | '40%';
}
```

#### 2.2 Section Component (Extract from pages)
```typescript
// /components/layouts/Section.tsx
interface SectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
}
```

#### 2.3 LinkedPeopleSection & LinkedPlacesSection
Clone `LinkedCatsSection` pattern for other entity types.

#### 2.4 PropertyTypeBadge
```typescript
// /components/badges/PropertyTypeBadge.tsx
type PropertyType = 'private_home' | 'apartment_complex' | 'mobile_home_park' |
                    'business' | 'farm_ranch' | 'public_park' | 'industrial' | 'other';

const PROPERTY_TYPE_CONFIG = {
  private_home: { icon: '🏠', label: 'Residence', color: '#22c55e' },
  apartment_complex: { icon: '🏢', label: 'Apartment', color: '#3b82f6' },
  business: { icon: '🏪', label: 'Business', color: '#f59e0b' },
  farm_ranch: { icon: '🌾', label: 'Farm/Ranch', color: '#84cc16' },
  // ...
};
```

### Phase 3: Request Page Redesign (2-3 days)

#### 3.1 Add PropertyTypeBadge to header
Show residence/business/farm distinction prominently.

#### 3.2 Implement Two-Column Layout
```
┌────────────────────────────────────────────────────────┐
│ Request #12345 • 🏠 Residence • Status: In Progress   │
├─────────────────────────────┬──────────────────────────┤
│ SITUATION SUMMARY           │ QUICK INFO               │
│ Location: 123 Main St       │ 📍 Petaluma, Zone 3     │
│ Cats: 5-8 (2 with kittens)  │ 📞 (707) 555-1234       │
│ Access: Gate code 1234      │ 👤 Jane Doe (requester) │
│                             │ 🗓️ Created: Feb 20     │
│ ASSIGNMENT                  │                          │
│ Trapper: Bob Smith          │ NEARBY (3)               │
│ Status: Scheduled Feb 25    │ • 2 requests within 0.5mi│
│                             │ • 12 cats TNR'd here    │
├─────────────────────────────┴──────────────────────────┤
│ [Details] [Activity] [Admin]                           │
└────────────────────────────────────────────────────────┘
```

#### 3.3 Reduce tabs from 7 to 3
- **Details** — Cats, kittens, property info
- **Activity** — Timeline, notes, communications
- **Admin** — Edit history, legacy data, technical info

### Phase 4: Person Page Redesign (2-3 days)

#### 4.1 Role-based layout
Show different sections based on person's roles:
- Trapper → Show assignments, stats
- Volunteer → Show groups, hours
- Requester → Show requests, submissions
- Cat owner → Show cats, places

#### 4.2 Simplify connections display
Use LinkedCatsSection, LinkedPeopleSection, LinkedPlacesSection consistently.

### Phase 5: Place Page Redesign (2-3 days)

#### 5.1 Map-prominent header
Make the map visible immediately, not hidden in overview.

#### 5.2 Colony status always visible
Move colony estimate from Ecology tab to sidebar.

#### 5.3 Use place_kind badge
Show property type (residence, business, farm) in header.

### Phase 6: Intake Redesign (1-2 days)

#### 6.1 Side panel instead of modal
Keep queue visible while viewing submission detail.

#### 6.2 "Mail card" format
Display submissions as incoming requests with clear sender info.

#### 6.3 Add property_type field
Capture residence/business at intake time.

---

## Part 5: Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Tabs per detail page | 5-7 | 2-3 |
| Time to find property type | N/A (not shown) | <2 sec |
| Requests with property_type | 0% | 100% of new |
| Places with place_kind | 0% | 100% |
| Intake conversion rate | 0.4% | Track and improve |
| Organizations correctly classified | ~10% | 100% |

---

## Part 6: Priority Order

### Must Fix First (Blocks UI Work)
1. MIG_2370 — Fix organization misclassification
2. MIG_2371 — Add property_type to requests
3. MIG_2373 — Classify place_kind

### High Value UI Changes
1. PropertyTypeBadge — Shows residence/business distinction
2. TwoColumnLayout — Reduces tab overload
3. Request page redesign — Trapper-friendly view

### Nice to Have
1. Intake sidesheet pattern
2. Person role-based layout
3. Place map-prominent header

---

## Appendix: Files to Modify

### Migrations (SQL)
- `sql/schema/v2/MIG_2370__fix_org_misclassification.sql`
- `sql/schema/v2/MIG_2371__add_property_type_to_requests.sql`
- `sql/schema/v2/MIG_2372__blacklist_shelter_places.sql`
- `sql/schema/v2/MIG_2373__classify_place_kind.sql`

### Components (TypeScript)
- `/components/layouts/TwoColumnLayout.tsx` (new)
- `/components/layouts/Section.tsx` (new)
- `/components/layouts/index.ts` (new)
- `/components/badges/PropertyTypeBadge.tsx` (new)
- `/components/LinkedPeopleSection.tsx` (new)
- `/components/LinkedPlacesSection.tsx` (new)

### Pages (TypeScript)
- `/app/requests/[id]/page.tsx` — Two-column layout, property type badge
- `/app/people/[id]/page.tsx` — Role-based sections
- `/app/places/[id]/page.tsx` — Map header, place_kind badge
- `/app/intake/queue/page.tsx` — Sidesheet pattern

### API Routes
- `/app/api/requests/route.ts` — Return property_type
- `/app/api/requests/[id]/route.ts` — Return property_type
