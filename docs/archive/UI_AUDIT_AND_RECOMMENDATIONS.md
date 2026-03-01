# Atlas UI Audit & Recommendations

**Date:** 2026-02-21
**Purpose:** Audit current page layouts, understand entity purposes, and recommend improvements based on best practices.

---

## Executive Summary

The Atlas UI has grown organically and now suffers from **fragmentation** and **information overload**. Detail pages are 1,200-1,800 lines each with 5-7 tabs, mixing operational data with ecological analytics. The distinction between **person requests** (residence/caretaker) vs **place requests** (business/site) from Airtable is lost.

### Key Problems Identified

1. **No clear page purpose** — Request pages mix "situation report for trappers" with admin data
2. **Tab overload** — 5-7 tabs per entity makes navigation difficult
3. **Lost context switching** — Clicking linked records loses the parent context
4. **Inconsistent linked record display** — Sometimes cards, sometimes tables, sometimes badges
5. **No "report view"** — Requests can't be easily shared as a trapper-friendly summary
6. **Intake→Request flow unclear** — Purpose of intake vs request isn't visually distinct

---

## Current State Audit

### 1. Request Pages (~1,512 lines)

**Current Structure:**
- Header with status/priority badges + action buttons
- 7 tabs: Case Summary, Details, Cats & Evidence, Activity, Actions, Nearby, Legacy Info

**Purpose (should be):** A "situation report" to share with trappers
- Location context (address, access notes, hazards)
- Cat situation (count, kittens, friendliness)
- People involved (requester, caretaker, trapper assignments)
- Historical context (previous visits, nearby activity)

**Problems:**
- **Too much admin data mixed in** — Edit history, legacy info, metadata visible to trappers
- **Missing "request type" classification** — Was this from a person (residence) or business/site?
- **No print-friendly summary** — Print page exists but isn't the default view
- **Nearby tab requires click** — Important context hidden behind tab

**Airtable Legacy:**
- Had `place_request` vs `person_request` distinction
- Place requests = business/site with reporter
- Person requests = residence/caretaker requesting help

### 2. Intake Queue (~600 lines)

**Current Structure:**
- Queue list with modal detail view
- Triage scoring and priority
- Contact logging

**Purpose (should be):** Show what people want from us
- Submitter info and contact attempts
- Situation description
- Urgency assessment
- Path to creating a request

**Problems:**
- **Modal-based** — Can't see queue while viewing detail
- **No classification** — Business vs residence not captured
- **Triage mixed with contact** — Different purposes in same modal

### 3. People Pages (~1,811 lines)

**Current Structure:**
- Header with name, roles, badges
- Contact card (always visible)
- 4 tabs: Overview, Connections, History, Data

**Purpose (should be):** Profile of a person's relationship with FFSC
- Contact info for reaching them
- Their cats (owned, fostered, trapped)
- Their places (home, trap sites)
- Their role (trapper, volunteer, requester)

**Problems:**
- **Contact card above tabs is good** — But too dense
- **Connections tab is confusing** — Cats, places, clinic history all mixed
- **Volunteer data dominates** — Non-volunteers see mostly empty sections
- **"Data" tab unclear** — Technical term for aliases/identifiers

### 4. Places Pages (~1,224 lines)

**Current Structure:**
- Header with context badges
- 4 tabs: Overview, Requests, Ecology, Media

**Purpose (should be):** Location context for field operations
- Physical location and access
- Who lives/works there
- Cat population and TNR status
- Disease status (ecological, not medical)

**Problems:**
- **Overview tab overloaded** — 15+ sections
- **Ecology tab has critical info** — Colony estimates hidden in tab
- **Context badges good** — But editing them is confusing
- **Media separate from overview** — Hero image should be prominent

### 5. Cats Pages (~290 lines list, detail unknown)

**Purpose:** Individual animal records with medical history

**Problems:**
- **Quality tiers (A/B/C) unclear** — What do they mean to users?
- **Limited detail page** — Less developed than other entities

---

## Best Practices Research

### From Data-Dense Dashboard Design

Sources: [JustInMind](https://www.justinmind.com/ui-design/dashboard-design-best-practices-ux), [DataCamp](https://www.datacamp.com/tutorial/dashboard-design-tutorial), [Aufait UX](https://www.aufaitux.com/blog/dashboard-design-principles/)

1. **Five-Second Rule** — Users should find key info within 5 seconds
2. **Z/F Reading Pattern** — Critical info top-left, then flow naturally
3. **Progressive Disclosure** — Start with overview, drill down for detail
4. **Card-Based Sections** — Group related info into digestible chunks
5. **Reduce Cognitive Load** — Split info into blocks, use white space

### From CRM/Case Management Systems

Sources: [Coveo](https://www.coveo.com/blog/8-case-creation-ux-best-practices/), [Pega Academy](https://academy.pega.com/topic/case-management-uxui-designers/v1)

1. **Case Summary First** — Users should understand status at a glance
2. **Document Suggestions Separate** — 2.5x more clicks when isolated
3. **Response Time Expectations** — Show estimated wait times
4. **Mobile Access** — Field workers need quick access

### From Airtable/Linear Patterns

Sources: [Airtable Support](https://support.airtable.com/docs/airtable-interface-layout-record-detail), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)

1. **Sidesheet Pattern** — View record detail while keeping list visible
2. **Record Hierarchy** — Show parent→child relationships (3 levels max)
3. **Reduce Visual Noise** — Adjust sidebar, tabs, headers for hierarchy
4. **Quick Navigation** — Next/previous record buttons in detail view

### From Animal Shelter Software

Sources: [ShelterLuv](https://www.shelterluv.com/), [24Pet](https://www.24pet.com/blog/best-animal-shelter-software)

1. **Tasks in Real-Time** — Show pending tasks, complete one-by-one
2. **Auto-Populate Records** — One click creates linked records
3. **Movement Tracking** — Show animal's journey from intake to outcome
4. **Location Visibility** — Always know where animals are

---

## Recommended Changes

### Principle: Purpose-Driven Layouts

Each page type should have a clear purpose and audience:

| Page | Primary Audience | Primary Purpose |
|------|-----------------|-----------------|
| Request | Trappers | Situation report for field work |
| Intake | Intake staff | Triage and contact tracking |
| Person | All staff | Contact and relationship lookup |
| Place | Field staff | Location context for operations |
| Cat | Clinic staff | Individual animal records |

### Pattern 1: Two-Column Detail Layout

Replace tab-heavy layouts with a **two-column pattern**:

```
┌─────────────────────────────────────────────────────────┐
│ HEADER: Entity name, key badges, primary actions        │
├───────────────────────────────┬─────────────────────────┤
│ MAIN COLUMN (65%)             │ SIDEBAR (35%)           │
│                               │                         │
│ Primary content for           │ Contextual info:        │
│ this page's purpose           │ - Quick stats           │
│                               │ - Linked records        │
│ • Request: Situation summary  │ - Recent activity       │
│ • Person: Contact + roles     │ - Related entities      │
│ • Place: Location + context   │                         │
│ • Cat: Medical + status       │                         │
│                               │                         │
├───────────────────────────────┴─────────────────────────┤
│ FOOTER TABS: Secondary content (History, Admin, Raw)    │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- Critical info visible without scrolling
- Sidebar provides context without clicking tabs
- Footer tabs for power users only

### Pattern 2: Request Type Classification

Restore Airtable's person/place distinction:

```typescript
type RequestType = 'residence' | 'business' | 'site' | 'unknown';

// Visual treatment:
// residence → "Home Request" with house icon, person-centric layout
// business → "Site Request" with building icon, location-centric layout
// site → "Colony Site" with cat icon, ecology-centric layout
```

**Request Page Variants:**

| Type | Header Emphasis | Main Column | Sidebar |
|------|----------------|-------------|---------|
| Residence | Requester name + address | Situation, cat count, access | Map, nearby requests |
| Business | Site name + address | Reporter info, situation | Map, site history |
| Colony Site | Location + colony estimate | Population, TNR status | Map, observations |

### Pattern 3: Trapper Report View

Create a **"Report Mode"** for requests that's shareable:

```
┌─────────────────────────────────────────────────────────┐
│ TRAPPER ASSIGNMENT REPORT                               │
│ Request #12345 • Assigned: 2026-02-21                   │
├─────────────────────────────────────────────────────────┤
│ LOCATION                                                │
│ 123 Main St, Petaluma CA 94952                         │
│ [Map thumbnail]                                         │
│                                                         │
│ ACCESS: Gate code 1234, dogs in backyard               │
│ HAZARDS: Aggressive dog, uneven terrain               │
├─────────────────────────────────────────────────────────┤
│ SITUATION                                               │
│ • 5-8 cats reported (2 with kittens)                   │
│ • Cat-friendly: Yes                                     │
│ • Feeding: Daily at 6pm                                │
│ • Notes: Cats hide under back porch                    │
├─────────────────────────────────────────────────────────┤
│ CONTACT                                                 │
│ Jane Doe (Requester) • (707) 555-1234                  │
│ "Please text before arriving"                           │
├─────────────────────────────────────────────────────────┤
│ NEARBY ACTIVITY                                         │
│ • 2 requests within 0.5mi (1 completed, 1 scheduled)   │
│ • 12 cats TNR'd at this address (last: Jan 2026)       │
└─────────────────────────────────────────────────────────┘
```

### Pattern 4: Intake Card Format

Show intake submissions as "incoming mail" with clear sender context:

```
┌─────────────────────────────────────────────────────────┐
│ 📬 INTAKE SUBMISSION                                    │
│ Received: Feb 21, 2026 at 3:45 PM                       │
├─────────────────────────────────────────────────────────┤
│ FROM: Jane Doe                                          │
│       jane@email.com • (707) 555-1234                   │
│       123 Main St, Petaluma (🏠 Residence)              │
├─────────────────────────────────────────────────────────┤
│ THEY SAID:                                              │
│ "There are several cats living under my porch.         │
│  I'd like to get them fixed. Some may have kittens."   │
├─────────────────────────────────────────────────────────┤
│ DETAILS:                                                │
│ • Cats: 5-8 estimated • Kittens: Yes • Emergency: No   │
│ • Ownership: Community cats, not mine                   │
│ • Access: I own the property, full access              │
├─────────────────────────────────────────────────────────┤
│ TRIAGE: Score 72 • Category: Standard                  │
│ [Create Request] [Log Contact] [Archive]               │
└─────────────────────────────────────────────────────────┘
```

### Pattern 5: Person Page Simplification

Replace 4 tabs with **role-based sections**:

```
┌─────────────────────────────────────────────────────────┐
│ PERSON: Jane Doe                                        │
│ 🏷️ Trapper • Volunteer                                 │
├───────────────────────────────┬─────────────────────────┤
│ CONTACT                       │ QUICK STATS             │
│ 📧 jane@email.com             │ 5 cats • 2 places       │
│ 📱 (707) 555-1234             │ 3 requests              │
│ 📍 123 Main St, Petaluma      │ Member since 2024       │
├───────────────────────────────┴─────────────────────────┤
│ IF TRAPPER:                                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ TRAPPER PROFILE                                     │ │
│ │ Type: FFSC Volunteer • Active: Yes                  │ │
│ │ Assignments: 12 total (8 completed, 4 active)       │ │
│ │ Last Assignment: Request #12345 (Feb 20)            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ IF VOLUNTEER:                                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ VOLUNTEER PROFILE                                   │ │
│ │ Groups: Approved Trapper, Foster Parent             │ │
│ │ Hours: 45 this year • Events: 12                    │ │
│ └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│ CONNECTIONS                                             │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│ │ 🐱 Cats (5)  │ │ 📍 Places (2)│ │ 📋 Requests  │     │
│ │ Whiskers     │ │ 123 Main St  │ │ #12345 ✓     │     │
│ │ Mittens      │ │ 456 Oak Ave  │ │ #12346 🔄    │     │
│ │ Shadow       │ │              │ │              │     │
│ │ [+2 more]    │ │              │ │              │     │
│ └──────────────┘ └──────────────┘ └──────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### Pattern 6: Place Page with Map Focus

Make the map prominent since places are geographic:

```
┌─────────────────────────────────────────────────────────┐
│ PLACE: 123 Main St, Petaluma                            │
│ 🏠 Residence • 🐱 Colony Site (verified)                │
├───────────────────────────────┬─────────────────────────┤
│ [MAP - 40% of page height]    │ QUICK STATS             │
│                               │ 8 cats linked           │
│                               │ 5 TNR'd (62%)           │
│                               │ Last TNR: Jan 2026      │
│                               │                         │
│                               │ PEOPLE                  │
│                               │ Jane Doe (owner)        │
│                               │ Bob Smith (caretaker)   │
│                               │                         │
│                               │ DISEASE STATUS          │
│                               │ ⚠️ FeLV: Confirmed      │
├───────────────────────────────┴─────────────────────────┤
│ COLONY ESTIMATE: 10-15 cats (Chapman: medium conf)      │
│ ████████░░ 62% altered                                  │
├─────────────────────────────────────────────────────────┤
│ REQUESTS (3)                  │ OBSERVATIONS (5)        │
│ #12345 Completed Jan 2026     │ Feb 20: 6 cats seen     │
│ #12346 Scheduled Feb 2026     │ Feb 15: 4 cats seen     │
│ #10234 Completed Dec 2025     │ Feb 10: 5 cats seen     │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase A: Layout Components (1-2 days)

Create reusable layout components:

```typescript
// /components/layouts/
TwoColumnLayout.tsx    // Main + sidebar pattern
ReportLayout.tsx       // Print-friendly single column
CardGrid.tsx           // Linked records display
StatsSidebar.tsx       // Quick stats sidebar
```

### Phase B: Request Page Redesign (2-3 days)

1. Add `request_type` classification (residence/business/site)
2. Implement two-column layout with situation summary
3. Create "Trapper Report" view mode
4. Move Nearby data to sidebar (always visible)
5. Reduce tabs to: Details | Activity | Admin

### Phase C: Intake Redesign (1-2 days)

1. Replace modal with sidesheet pattern
2. Add sender classification (residence/business)
3. Create "mail card" visual format
4. Separate triage from contact logging

### Phase D: Person Page Redesign (2-3 days)

1. Implement two-column layout
2. Role-based sections (show/hide based on roles)
3. Linked records as compact cards
4. Reduce tabs to: Overview | History | Admin

### Phase E: Place Page Redesign (2-3 days)

1. Implement map-focused header
2. Colony estimate always visible
3. Disease status prominent
4. Reduce tabs to: Overview | Ecology | Admin

---

## Component Inventory

### New Components Needed

| Component | Purpose |
|-----------|---------|
| `TwoColumnLayout` | Main + sidebar responsive layout |
| `ReportView` | Print-friendly summary format |
| `EntityCard` | Compact linked record card |
| `StatsSidebar` | Quick stats panel |
| `RequestTypeBadge` | Residence/business/site indicator |
| `SituationSummary` | Request situation overview |
| `MailCard` | Intake submission display |
| `ColonyGauge` | Visual TNR progress indicator |
| `MapHeader` | Prominent map for places |

### Existing Components to Reuse

From our Phase 4-5 work:
- `QualityBadge` — Data quality indicator
- `SourceIndicator` — Source system badge
- `StatusPipeline` — Request status visualization
- `SkeletonCard` — Loading states
- `Toast` — Notifications

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Tabs per detail page | 5-7 | 2-3 |
| Time to find key info | ~15 sec | <5 sec |
| Clicks to linked record | 2-3 | 1 |
| Request type visibility | None | Always shown |
| Colony estimate visibility | Hidden in tab | Always visible |
| Print-friendly views | 1 (requests) | All entities |

---

## Sources

- [JustInMind: Dashboard Design Best Practices](https://www.justinmind.com/ui-design/dashboard-design-best-practices-ux)
- [DataCamp: Dashboard Design Tutorial](https://www.datacamp.com/tutorial/dashboard-design-tutorial)
- [Aufait UX: Dashboard Design Principles](https://www.aufaitux.com/blog/dashboard-design-principles/)
- [Coveo: Case Creation UX Best Practices](https://www.coveo.com/blog/8-case-creation-ux-best-practices/)
- [Airtable: Record Detail Layout](https://support.airtable.com/docs/airtable-interface-layout-record-detail)
- [Linear: UI Redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [ShelterLuv](https://www.shelterluv.com/)
- [24Pet: Best Animal Shelter Software](https://www.24pet.com/blog/best-animal-shelter-software)
