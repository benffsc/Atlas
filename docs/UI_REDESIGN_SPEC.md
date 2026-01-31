# Atlas UI Redesign Specification

**Version:** 1.0
**Created:** 2026-01-29
**Owner:** Engineering (Claude Code is lead engineer)
**Referenced by:** `ATLAS_NORTH_STAR.md` (Relationship to Other Docs)

---

## Table of Contents

1. [Recent Map Changes Review](#1-recent-map-changes-review)
2. [Known Bugs & Technical Debt](#2-known-bugs--technical-debt)
3. [Design Philosophy](#3-design-philosophy)
4. [Navigation Redesign](#4-navigation-redesign)
5. [Dashboard Redesign](#5-dashboard-redesign)
6. [Entity Profile System](#6-entity-profile-system)
7. [People Record](#7-people-record)
8. [Places Record](#8-places-record)
9. [Request Case File](#9-request-case-file)
10. [Address Management UX](#10-address-management-ux)
11. [Place Classification & Categorization](#11-place-classification--categorization)
12. [Native Pin Creation](#12-native-pin-creation)
13. [Photo & Media System](#13-photo--media-system)
14. [Export & Data Portability](#14-export--data-portability)
15. [Mobile Optimization](#15-mobile-optimization)
16. [Implementation Phases](#16-implementation-phases)
17. [North Star Alignment Checklist](#17-north-star-alignment-checklist)

---

## 1. Recent Map Changes Review

### Changes Made (commits aec2f9e through 91063f6)

| Commit | Change | North Star Layer |
|--------|--------|-----------------|
| `1fdfb0b` | Fix markercluster CJS/ESM interop | L7 Beacon (visualization) |
| `21909af` | Show all search results, not just geocoded | L6 Workflow (staff tool) |
| `131f901` | Fix `search_unified` NUMERIC cast | L5 SoT (query infrastructure) |
| `cd18726` | Atlas search drops marker like Google | L6 Workflow (staff UX) |
| `831d80d` | Full-viewport map + mobile optimization | L7 Beacon (visualization) |
| `b9acedc` | Satellite toggle + back navigation | L7 Beacon (visualization) |
| `91063f6` | Unify BackButton across all pages | L6 Workflow (UI consistency) |

### Alignment Assessment

**Aligned with North Star:**
- All changes were additive (INV-6: Active Flows Are Sacred)
- No SoT tables were modified (L7 reads from views, never writes SoT)
- Search fix preserved provenance (INV-4) - the NUMERIC cast was a display bug, not a data bug
- Mobile optimization only changed presentation layer, no data flow changes

**Bug Pattern Observed:**
The markercluster CJS/ESM bug (`n.markerClusterGroup is not a function`) exposed a common Next.js pitfall: ES module namespace objects are frozen/read-only, while CommonJS exports are mutable. The `leaflet.markercluster` plugin mutates the CJS exports object, which is a different object than the ES namespace returned by `import * as L`. The fix (storing a CJS reference in `leafletCjsRef`) is correct but fragile - any future Leaflet plugin integration must follow this same pattern.

**Recommendation:** Document this pattern in CLAUDE.md under a "Leaflet Plugin Integration" section so future sessions don't repeat the 3-commit debugging cycle.

### Search Bug Root Cause

The `search_unified` function was completely broken at the database level - `RETURNS TABLE` declared `score NUMERIC` but the function returned an integer from a CASE expression. This was a latent bug from MIG_792 that was never caught because the search was only used from the map (which filtered results client-side). The fix was a simple cast: `rr.score::NUMERIC`.

**Recommendation:** Add a CI-level check that runs `SELECT * FROM trapper.search_unified('test', 5)` after migration application to catch return-type mismatches.

---

## 2. Known Bugs & Technical Debt

### Critical (affects daily staff workflows)

| # | Bug | Location | Impact | North Star Layer |
|---|-----|----------|--------|-----------------|
| B1 | Dashboard `StatusBadge` uses Tailwind class names as inline style keys (e.g. `bg-blue-100`) but applies them via conditional hex mapping, creating a fragile translation layer | `apps/web/src/app/page.tsx:67-100` | Visual bugs if any status is added | L6 |
| B2 | Request detail page is 200+ lines of monolithic JSX with 10+ modal components imported, no sectioning or lazy loading | `apps/web/src/app/requests/[id]/page.tsx` | Slow load, hard to maintain | L6 |
| B3 | Place detail page mixes Beacon analytics (colony estimates, population trends) with operational data (people, cats, requests) in a single scroll | `apps/web/src/app/places/[id]/page.tsx` | Staff can't quickly find what they need | L6/L7 |
| B4 | Nav bar has no mobile hamburger menu - links overflow/truncate on small screens | `AppShell.tsx:90-136` | Unusable on mobile | L6 |
| B5 | Each `StatusBadge` is re-implemented per page (dashboard, places, requests) with slightly different color mappings | Multiple files | Inconsistent status colors | L6 |

### Moderate (affects efficiency, not correctness)

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B6 | People list table has no horizontal scroll on mobile | `apps/web/src/app/people/page.tsx` | Columns clip on small screens |
| B7 | Person detail inline edit for name uses a raw input with no validation | `people/[id]/page.tsx` | Name normalization bypass |
| B8 | Filter state resets on navigation - no URL param persistence | All list pages | Staff must re-filter after navigating away |
| B9 | AppShell admin menu uses inline `onMouseEnter/Leave` for hover, repeated 10 times | `AppShell.tsx:249-410` | Maintenance burden |
| B10 | GlobalSearch is embedded in nav bar, takes up horizontal space on desktop | `AppShell.tsx:88` | Competes with nav links for space |

### Low (cosmetic or edge-case)

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B11 | Partner org cats page uses emoji icons in JSX | `admin/partner-org-cats/page.tsx` | Inconsistent with rest of UI |
| B12 | Print pages have separate `back-btn` CSS class that could conflict with BackButton component | Print stylesheets | Minor style conflict |
| B13 | Beacon map page (`/beacon`) exists but is separate from main map (`/map`) | Two map pages | Confusion about which map to use |

---

## 3. Design Philosophy

### Inspiration: Google Workspace + Beacon Prototype

The redesign takes cues from two sources:

**Google Workspace (Docs, Sheets, Admin Console):**
- Clean, neutral color palette with purposeful accent colors
- Dense-but-readable information hierarchy
- Left sidebar navigation (collapsible)
- Tabbed detail views instead of endless scrolling
- Inline editing as the default interaction mode
- Top bar: search + user menu (minimal)
- Cards and tables as primary data containers

**Beacon Prototype (`map-app-main`):**
- Geist font family (clean, geometric, modern)
- CSS variable design tokens for full theming
- shadcn/ui component primitives
- Minimal chrome - content takes priority
- Dark mode support built-in
- Map-centric single-page focus

### Design Tokens (New)

```css
/* Extend existing :root with Workspace-inspired tokens */
:root {
  /* Keep existing tokens, add: */
  --sidebar-width: 240px;
  --sidebar-collapsed-width: 56px;
  --topbar-height: 56px;
  --content-max-width: 1200px;

  /* Surface hierarchy (Google Workspace pattern) */
  --surface-0: #ffffff;        /* Page background */
  --surface-1: #f8f9fa;        /* Cards, sidebar */
  --surface-2: #f1f3f4;        /* Hover states, nested cards */
  --surface-3: #e8eaed;        /* Active states, borders */

  /* Entity accent colors (consistent across the app) */
  --entity-person: #4285f4;    /* Google blue */
  --entity-place: #34a853;     /* Google green */
  --entity-cat: #ea4335;       /* Google red (for medical urgency) */
  --entity-request: #fbbc04;   /* Google yellow */
}
```

### Typography

| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page title | Raleway | 1.5rem | 600 |
| Section header | Raleway | 1.125rem | 600 |
| Body text | Raleway | 0.875rem | 400 |
| Label / Caption | Raleway | 0.75rem | 500 |
| Data value | Raleway | 0.875rem | 500 |
| Monospace (IDs, chips) | System mono | 0.8rem | 400 |

---

## 4. Navigation Redesign

### Current State

Top horizontal nav bar with all links in a row. No mobile responsiveness. Admin tools hidden in user dropdown.

### New Design: Collapsible Left Sidebar

```
┌──────────────────────────────────────────────────┐
│ [Logo] Atlas          [Search...]    [User Menu] │  ← Top bar (56px)
├────────┬─────────────────────────────────────────┤
│        │                                         │
│  ☰     │   Content Area                          │
│  📋    │                                         │
│  🗺️   │   (Pages render here)                   │
│  📥    │                                         │
│  👤    │                                         │
│  📍    │                                         │
│  🐱    │                                         │
│        │                                         │
│  ──    │                                         │
│  ⚙️    │                                         │
│        │                                         │
└────────┴─────────────────────────────────────────┘
   56px              Remaining width
```

**Sidebar sections (Staff/Admin):**

| Icon | Label | Route | Section |
|------|-------|-------|---------|
| Home | Dashboard | `/` | Primary |
| Clipboard | Requests | `/requests` | Primary |
| MapPin | Map | `/map` | Primary |
| Inbox | Intake | `/intake/queue` | Primary |
| --- | --- | --- | Divider |
| Users | People | `/people` | Records |
| Building | Places | `/places` | Records |
| Cat | Cats | `/cats` | Records |
| --- | --- | --- | Divider |
| BarChart | Beacon | `/beacon` | Analytics |
| --- | --- | --- | Divider |
| Settings | Admin | `/admin` | Admin (if admin role) |

**Sidebar behavior:**
- **Desktop (>1024px):** Expanded by default, collapsible to icon-only (56px)
- **Tablet (768-1024px):** Collapsed to icon-only by default, expandable
- **Mobile (<768px):** Hidden, accessible via hamburger menu (slide-over drawer)
- Collapsed state shows icons + tooltip on hover
- Active route highlighted with left border accent + background fill
- Sidebar state persisted in localStorage

**Top bar:**
- Left: Logo + "Atlas" (click to go home)
- Center: Global search (expand on focus, Cmd+K shortcut)
- Right: User avatar + dropdown (profile, sign out)
- No nav links in top bar (all moved to sidebar)

**Map page exception:** Sidebar and top bar hidden (existing `isMapPage` bypass), map gets full viewport with its own embedded nav.

### Volunteer View

Volunteers see a reduced sidebar:
- Dashboard, Requests, Map, Beacon only
- No Records section
- No Admin section

---

## 5. Dashboard Redesign

### Current State

Dense grid with stats, request list, intake list, quick actions, and my-items widget all on one page. Feels like a data dump rather than a workspace.

### New Design: Focused Work Queue

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Good morning, {name}                Today: Jan 29, 2026│
├────────────────────┬────────────────────────────────────┤
│                    │                                    │
│  NEEDS ATTENTION   │   MY ACTIVE REQUESTS               │
│  ┌──────────────┐  │   ┌──────────────────────────────┐ │
│  │ 3 Stale      │  │   │ Request card (compact)       │ │
│  │ 2 Overdue    │  │   │ Request card (compact)       │ │
│  │ 5 New Intake │  │   │ Request card (compact)       │ │
│  └──────────────┘  │   └──────────────────────────────┘ │
│                    │                                    │
│  QUICK STATS       │   RECENT INTAKE SUBMISSIONS        │
│  ┌──┐ ┌──┐ ┌──┐   │   ┌──────────────────────────────┐ │
│  │42│ │12│ │89│   │   │ Submission row (compact)     │ │
│  │Act│ │Pnd│ │Mo│  │   │ Submission row (compact)     │ │
│  └──┘ └──┘ └──┘   │   │ Submission row (compact)     │ │
│                    │   └──────────────────────────────┘ │
├────────────────────┴────────────────────────────────────┤
│  MAP PREVIEW (optional, collapsed on mobile)            │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Small map showing active request pins           │   │
│  │  Click to go to full map                         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key changes:**
1. **Personal greeting** with date (Google Workspace pattern)
2. **Needs Attention panel** - counts only, not full lists. Click to filter.
3. **My Active Requests** - only requests assigned to current user (not all requests)
4. **Quick Stats** - 3 compact stat pills, not 4 big cards
5. **Recent Intake** - last 5 submissions needing action
6. **Map Preview** - small embedded map (250px height) showing active request pins. Hidden on mobile. Click opens `/map`.
7. **No Quick Actions grid** - all navigation is in the sidebar now

**Mobile layout:**
- Single column, stacked
- Map preview hidden
- Needs Attention at top (most important)
- My Active Requests (scrollable horizontal cards)
- Recent Intake (compact list)

---

## 6. Entity Profile System

### Core Concept: Profiles as Bridges

The fundamental insight is that Atlas has siloed SoT tables (`sot_people`, `places`, `sot_cats`, `sot_requests`) but users should experience them as **interconnected profiles**. The UI masks the relational complexity into what feels like a unified record.

```
People ←→ Places ←→ Cats
  ↕          ↕         ↕
Requests  Requests  Requests
```

**Every entity profile follows the same structure:**

```
┌─────────────────────────────────────────────┐
│  HEADER BAR                                 │
│  Name · Type Badge · Status · Actions       │
├─────────────────────────────────────────────┤
│  [Overview] [Activity] [Related] [History]  │  ← Tab bar
├─────────────────────────────────────────────┤
│                                             │
│  Tab content area                           │
│                                             │
└─────────────────────────────────────────────┘
```

**Tab structure per entity:**

| Entity | Overview | Activity | Related | History |
|--------|----------|----------|---------|---------|
| Person | Contact info, address | Journal, submissions | Cats, places, requests | Edit history |
| Place | Address, photo, contexts | Journal, observations | People, cats, requests | Edit history, colony data |
| Cat | Identity, health, vitals | Clinic visits, movement | Owners, places | Edit history |
| Request | Case details, location | Journal, site visits | Requester, trapper, cats | Edit history, status log |

**Why tabs instead of scroll:**
- Staff can jump directly to what they need
- Tab state can be URL-parameterized (`/people/123?tab=related`)
- Each tab loads lazily (performance)
- Mobile-friendly (tabs collapse to dropdown or swipe)

---

## 7. People Record

### Design: Contact Record (inspired by Google Contacts)

**Header:**
```
┌─────────────────────────────────────────────────────┐
│  ← Back                                    [Edit]   │
│                                                     │
│  John Smith                                         │
│  Staff · Verified ✓ · Last seen Jan 15              │
│  ─────────────────────────────────────────────────  │
│  📧 john@email.com    📱 (707) 555-1234             │
│  📍 123 Main St, Santa Rosa, CA ← (click to place) │
│                                                     │
│  [Overview] [Activity] [Linked] [History]           │
└─────────────────────────────────────────────────────┘
```

**No image field** - people records do not have photos (as specified).

### Overview Tab

```
CONTACT INFORMATION
┌──────────────────────────────────────────────┐
│  Email      john@email.com        [edit ✎]   │
│  Phone      (707) 555-1234       [edit ✎]   │
│  Source     ClinicHQ                         │
│  Created    Jan 5, 2024                      │
└──────────────────────────────────────────────┘

CURRENT ADDRESS
┌──────────────────────────────────────────────┐
│  📍 123 Main St, Santa Rosa, CA  [change ✎] │
│     Residential House · 3 cats · Colony site │
│     → View Place Record                      │
└──────────────────────────────────────────────┘

ASSOCIATED ADDRESSES (historical)
┌──────────────────────────────────────────────┐
│  📍 456 Oak Ave, Petaluma, CA                │
│     Apartment · Former address               │
│     → View Place Record                      │
│                                              │
│  📍 789 Elm Dr, Sebastopol, CA               │
│     Outdoor Site · Requester at this location│
│     → View Place Record                      │
└──────────────────────────────────────────────┘
```

**Key UX details:**

1. **Current Address** is the `primary_address` from `person_place_relationships`. Clicking the address navigates to that place's profile.

2. **"Change" address** opens an address autocomplete. Under the hood, this:
   - Calls `find_or_create_place_deduped()` for the new address
   - Updates `person_place_relationships` to set the new primary
   - Old address becomes "historical" in Associated Addresses
   - The person record itself is NOT modified (places are separate entities)
   - This is a **relink**, not an edit. See [Address Management UX](#10-address-management-ux).

3. **Associated Addresses** shows all places this person is linked to (via `person_place_relationships`), with their role (requester, owner, resident) and a link to the place profile.

4. **Legacy records without address** - display "No address on file" with an "Add address" button. No error state. Legacy/ingested records are expected to lack addresses.

5. **Natively created records** must always have an address. The create-person form enforces this.

### Linked Tab

```
CATS (3)
┌──────────────────────────────────────────────┐
│  Mittens · 985112345678901 · Spayed          │
│  Owner (ClinicHQ) · Verified                 │
│  → View Cat Record                           │
├──────────────────────────────────────────────┤
│  Whiskers · No microchip · Intact            │
│  Foster (ShelterLuv) · Confirmed             │
│  → View Cat Record                           │
├──────────────────────────────────────────────┤
│  Shadow · 985112345678999 · Neutered         │
│  Caretaker (Atlas UI) · Self-reported        │
│  → View Cat Record                           │
└──────────────────────────────────────────────┘

REQUESTS (2)
┌──────────────────────────────────────────────┐
│  #REQ-234 · Colony TNR · In Progress         │
│  123 Main St · 5 cats needing TNR            │
│  → View Request                              │
├──────────────────────────────────────────────┤
│  #REQ-189 · Single Stray · Completed         │
│  456 Oak Ave · Resolved Jan 10               │
│  → View Request                              │
└──────────────────────────────────────────────┘

RELATED PEOPLE (1)
┌──────────────────────────────────────────────┐
│  Jane Smith · Same household                 │
│  Shares: 123 Main St, (707) 555-1234        │
│  → View Person Record                        │
└──────────────────────────────────────────────┘
```

### Activity Tab

- Journal entries (chronological)
- Website intake submissions
- Communication logs (emails sent)

### History Tab

- Edit history (entity_edits audit trail)
- Data source breakdown (which fields came from which source)
- Identifier history (phones/emails added/removed over time)

---

## 8. Places Record

### Design: Location Profile (inspired by Zillow + Google Maps)

**Header:**
```
┌─────────────────────────────────────────────────────┐
│  ← Back                              [Edit] [Map]   │
│                                                     │
│  123 Main Street                                    │
│  Santa Rosa, CA 95401                               │
│  Residential House · Colony Site · Verified ✓       │
│                                                     │
│  [Overview] [Gallery] [Activity] [Ecology] [History]│
└─────────────────────────────────────────────────────┘
```

### Overview Tab

```
PHOTO (hero image)
┌──────────────────────────────────────────────┐
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │   Main photo (if uploaded)             │  │
│  │   or Street View embed                 │  │
│  │   or "No photo yet" + upload button    │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  "4 more photos" → Gallery tab               │
└──────────────────────────────────────────────┘

ADDRESS & CONTEXT
┌──────────────────────────────────────────────┐
│  Address    123 Main St, Santa Rosa, CA      │
│  Type       Residential House                │
│  Contexts   Colony Site, Volunteer Location   │
│  Zone       Central Santa Rosa               │
│  Coords     38.4404, -122.7141               │
└──────────────────────────────────────────────┘

SMALL MAP
┌──────────────────────────────────────────────┐
│  [Embedded mini-map, 200px height]           │
│  Click to open in full map                   │
└──────────────────────────────────────────────┘

PEOPLE AT THIS ADDRESS (3)
┌──────────────────────────────────────────────┐
│  John Smith · Requester · Primary resident   │
│  → View Person Record                        │
├──────────────────────────────────────────────┤
│  Jane Smith · Household member               │
│  → View Person Record                        │
├──────────────────────────────────────────────┤
│  Maria Garcia · Trapper (assigned)           │
│  → View Person Record                        │
└──────────────────────────────────────────────┘

CATS AT THIS ADDRESS (5)
┌──────────────────────────────────────────────┐
│  Mittens · Spayed · Last seen Oct 2025       │
│  Shadow · Neutered · Last seen Oct 2025      │
│  Unknown Orange Tabby · Intact · Seen twice  │
│  → View all 5 cats                           │
└──────────────────────────────────────────────┘

ACTIVE REQUESTS (1)
┌──────────────────────────────────────────────┐
│  #REQ-234 · Colony TNR · In Progress         │
│  Assigned: Maria Garcia · Since Jan 5        │
│  → View Request                              │
└──────────────────────────────────────────────┘
```

### Gallery Tab (Zillow-style)

```
MAIN PHOTO
┌──────────────────────────────────────────────┐
│  ┌────────────────────────────────────────┐  │
│  │         Large hero image               │  │
│  │         (click to lightbox)            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [Upload Photo]                              │
└──────────────────────────────────────────────┘

MORE PHOTOS (grid, 3 columns)
┌──────────────────────────────────────────────┐
│  ┌────┐  ┌────┐  ┌────┐                     │
│  │    │  │    │  │    │                     │
│  │ 📷 │  │ 📷 │  │ 📷 │                     │
│  │    │  │    │  │    │                     │
│  └────┘  └────┘  └────┘                     │
│  Jan 15   Jan 10  Dec 28                     │
│  "Front"  "Yard"  "Colony"                   │
│                                              │
│  ┌────┐  ┌────┐                              │
│  │    │  │    │                              │
│  │ 📷 │  │ 📷 │                              │
│  │    │  │    │                              │
│  └────┘  └────┘                              │
│  Dec 20  Nov 15                              │
│  "Cats"  "Setup"                             │
└──────────────────────────────────────────────┘
```

Photos use the existing `MediaGallery` and `MediaUploader` components but restructured into a dedicated tab with a hero image + grid layout.

### Ecology Tab (Beacon data)

This tab contains all the analytical/Beacon data that currently clutters the Overview:
- Colony estimates (ColonyEstimates component)
- Population trend chart
- Population timeline
- Alteration history
- Site statistics
- Observations (mark-resight)
- Historical context (Google Maps)

This separation aligns with the North Star's **Two Tracks** principle:
- **Overview tab** = Track 1 (Workflow Data) - staff needs
- **Ecology tab** = Track 2 (Beacon Data) - analytical needs

### Enhanced Place Profiles (Partner Orgs)

Partner organizations, businesses, schools, etc. get an **enhanced** place profile with additional sections:

```
ORGANIZATION INFO
┌──────────────────────────────────────────────┐
│  Name        SCAS (Sonoma County Animal Svcs)│
│  Type        Partner Organization            │
│  Contact     (707) 555-0000                  │
│  Website     sonomacounty.ca.gov/animals     │
│  Status      Active Partner                  │
│                                              │
│  ASSOCIATED PEOPLE                           │
│  Dr. Sarah Chen · Veterinarian               │
│  Mike Torres · Intake Coordinator            │
│  → View all 8 staff/contacts                 │
└──────────────────────────────────────────────┘
```

This emerges naturally from the place_contexts system (context_type = 'partner_org') and person_place_relationships. No new tables needed.

---

## 9. Request Case File

### Design: Case File (inspired by legal/medical case management)

**Header:**
```
┌─────────────────────────────────────────────────────┐
│  ← Back                                            │
│                                                     │
│  Request #REQ-234                                   │
│  Colony TNR · In Progress · High Priority           │
│  123 Main St, Santa Rosa, CA                        │
│                                                     │
│  [COMPLETE] [HOLD] [HANDOFF] [MORE ▼]              │
│                                                     │
│  [Details] [Location] [Activity] [Media] [History]  │
└─────────────────────────────────────────────────────┘
```

### Details Tab

Organized into clear sections with dividers, not a wall of fields:

```
CASE SUMMARY
┌──────────────────────────────────────────────┐
│  Summary     5 cats at residential property  │
│  Type        Colony TNR                      │
│  Status      In Progress (since Jan 5)       │
│  Priority    High                            │
│  Created     Jan 2, 2026 (27 days ago)       │
│  Source      Web Intake                      │
└──────────────────────────────────────────────┘

CAT INFORMATION
┌──────────────────────────────────────────────┐
│  Cats Needing TNR    3 (still unfixed)       │
│  Ear-tipped Seen     2                       │
│  Has Kittens         Yes                     │
│  Cats are Friendly   No                      │
│  Confidence          Moderate                │
└──────────────────────────────────────────────┘

REQUESTER
┌──────────────────────────────────────────────┐
│  John Smith                                  │
│  📧 john@email.com  📱 (707) 555-1234       │
│  Preferred contact: Phone                    │
│  Best times: Evenings after 5pm              │
│  → View Person Record                        │
└──────────────────────────────────────────────┘

TRAPPER ASSIGNMENT
┌──────────────────────────────────────────────┐
│  Maria Garcia · FFSC Trapper                 │
│  Assigned Jan 5 · Last activity Jan 20       │
│  → View Trapper Profile                      │
│  [Reassign] [Add Co-Trapper]                 │
└──────────────────────────────────────────────┘

INTAKE DETAILS (collapsible, if from web intake)
┌──────────────────────────────────────────────┐
│  Permission      Granted                     │
│  Property Owner  Same as requester           │
│  Traps Overnight Safe                        │
│  Access Notes    Gate code: 1234             │
│  Colony Duration 2+ years                    │
│  Feeding         Daily by requester          │
└──────────────────────────────────────────────┘

LINKED CATS (3)
┌──────────────────────────────────────────────┐
│  Mittens · Spayed Jan 10 · 985112345678901  │
│  Shadow · Neutered Jan 10 · 985112345678999 │
│  Unknown tabby · Not yet trapped             │
└──────────────────────────────────────────────┘

COLONY SUMMARY
┌──────────────────────────────────────────────┐
│  Estimated Colony    5 cats                  │
│  Verified Altered    2 (40%)                 │
│  Work Remaining      3 cats                  │
│  → View Ecology Data (place profile)         │
└──────────────────────────────────────────────┘
```

### Location Tab

```
MAP (embedded, 300px height)
┌──────────────────────────────────────────────┐
│  [Interactive map centered on request]       │
│  Shows: request pin, nearby requests,        │
│         nearby places with cats              │
│  → Open in full map                          │
└──────────────────────────────────────────────┘

LOCATION DETAILS
┌──────────────────────────────────────────────┐
│  Address    123 Main St, Santa Rosa, CA      │
│  Type       Residential House                │
│  Zone       Central Santa Rosa               │
│  Safety     No concerns noted                │
│  → View Place Record                         │
└──────────────────────────────────────────────┘

NEARBY ENTITIES
┌──────────────────────────────────────────────┐
│  (NearbyEntities component)                  │
│  Shows requests, places, and cats nearby     │
└──────────────────────────────────────────────┘
```

### Media Tab

Request media (photos, documents) in a gallery layout. Since requests are always at an address, photos uploaded here are also visible on the place's Gallery tab.

```
REQUEST PHOTOS
┌──────────────────────────────────────────────┐
│  ┌────┐  ┌────┐  ┌────┐                     │
│  │ 📷 │  │ 📷 │  │ 📷 │                     │
│  └────┘  └────┘  └────┘                     │
│  [Upload Photo]                              │
│                                              │
│  Photos are shared with the place record     │
│  at 123 Main St                              │
└──────────────────────────────────────────────┘
```

### Activity Tab

- Journal entries (chronological, newest first)
- Site visit logs
- Status change history
- Communication logs
- Classification suggestions

### History Tab

- Full edit history
- Status transition timeline
- Assignment history
- Data source breakdown

---

## 10. Address Management UX

### Core Principle: Address Changes Are Relinks

When a user "changes" someone's address, the UI should feel like an inline edit, but the system actually:

1. Resolves the new address to a place via `find_or_create_place_deduped()`
2. Updates `person_place_relationships` to point to the new place
3. Sets the old relationship as `ended_at = NOW()`
4. Preserves the old place as a historical association

**This aligns with North Star invariants:**
- INV-1: No Data Disappears (old address preserved)
- INV-3: SoT Are Stable Handles (place_id doesn't change)
- INV-4: Provenance Is Required (source tracked)

### UX Flow

```
User clicks [Change ✎] next to address
  → Address autocomplete appears inline
  → User types new address
  → Google Places resolves it
  → Confirmation: "Move John Smith from 123 Main St to 456 Oak Ave?"
  → [Confirm] → API call:
    1. find_or_create_place_deduped('456 Oak Ave...')
    2. UPDATE person_place_relationships SET ended_at = NOW() WHERE person_id = X AND is_primary
    3. INSERT person_place_relationships (person_id, place_id, role, is_primary, source_system='atlas_ui')
  → UI updates instantly
  → Old address appears in "Associated Addresses" section
```

### Rules for Address Requirements

| Record Origin | Address Required? | Rationale |
|---------------|-------------------|-----------|
| Legacy (Airtable import) | No | Many old records lack addresses |
| ClinicHQ import | No | Clinic records may only have phone/email |
| ShelterLuv import | No | Adoption records may lack home address |
| Web Intake (native) | Yes | Intake form requires address |
| Atlas UI (native) | Yes | Staff-created records must have address |
| VolunteerHub import | No | Volunteer records may only have contact info |

The UI shows "No address on file" for records without addresses. No error state, no nagging. Just a subtle "Add address" link.

---

## 11. Place Classification & Categorization

### Automatic Classification from Attached Records

Places should be automatically categorized based on what's attached to them:

| If a place has... | Inferred type | Confidence |
|-------------------|--------------|------------|
| TNR requests + multiple cats | Colony site | High |
| Person with `role = 'foster_parent'` | Foster home | High |
| Person with `role = 'adopter'` | Adopter residence | High |
| Partner org relationship | Partner org | High |
| Business name in address | Business | Medium |
| School name in address | Educational facility | Medium |
| Only one person, residential address | Residential | Medium |
| No people, no cats, no requests | Unknown | Low |

### Orphan Place Detection

**A place with no SoT entity attached (no person, no cat, no request) should be flagged for review.**

Every address in Atlas should have come from an interaction (intake form, clinic visit, request, etc.) and therefore should have at least one person or cat linked.

```sql
-- View: v_orphan_places
SELECT p.place_id, p.formatted_address, p.place_kind, p.created_at, p.source_system
FROM trapper.places p
LEFT JOIN trapper.person_place_relationships ppr ON ppr.place_id = p.place_id
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND ppr.place_id IS NULL
  AND cpr.place_id IS NULL
  AND r.request_id IS NULL;
```

These orphan places should appear in an admin review queue. Staff can:
- Link them to an existing person/request
- Flag them for AI extraction (maybe the address was mentioned in notes)
- Mark as "reviewed - standalone" (valid standalone place, e.g., a known colony site with no formal records)

### AI Extraction Queue for Unclassifiable Places

If a place can't be safely classified from its attached records (e.g., "Elsie Allen High School" booked as a ClinicHQ address), add it to the AI extraction queue:

```sql
INSERT INTO trapper.extraction_queue (entity_type, entity_id, extraction_type, priority, context)
VALUES ('place', place_id, 'classify_place_type', 5,
  jsonb_build_object('address', address, 'linked_records', record_summary));
```

The AI extraction engine (scripts/jobs/) can then:
- Look up the address in Google Places API for business type
- Check the name against known organization patterns
- Analyze clinic appointment notes mentioning this address
- Propose a classification with confidence level

**This aligns with North Star layers:**
- L3 (Enrichment): AI extraction proposes classification
- L4 (Classification): `assign_place_context()` applies it
- INV-2: Manual > AI (staff can override)

---

## 12. Native Pin Creation

### Future Feature: Coordinate-Based Place Profiles

For field work where staff need to mark a location that isn't a formal address:

**UX Flow:**
1. Staff opens map on mobile
2. Long-press or "Drop Pin" button
3. Pin appears at current GPS location (or manually placed)
4. Modal: "Create Place Profile"
   - Name: (optional, e.g., "Colony behind strip mall")
   - Nearest Address: Auto-populated via reverse geocoding ("near 456 Industrial Blvd")
   - Type: Outdoor Site / Colony Site / Other
   - Notes: Free text
   - Photo: Camera capture
5. Creates a place record with:
   - `is_address_backed = FALSE` (no real street address)
   - `coordinates` set from GPS
   - `formatted_address` = "Near 456 Industrial Blvd" (reverse geocoded)
   - `place_kind` = 'outdoor_site'
   - `source_system` = 'atlas_ui'
   - `source_record_id` = 'native_pin_{uuid}'

**Rules:**
- Native pins ONLY work from the mobile app (GPS context required)
- The "address" is always prefixed with "Near" to distinguish from real addresses
- These places can have cats, requests, observations, and photos attached
- They are fully exportable (see [Export](#14-export--data-portability))

**North Star alignment:**
- INV-3: Each pin gets a stable `place_id`
- INV-4: `source_system = 'atlas_ui'`, clear provenance
- L5: Place created through `find_or_create_place_deduped()` (using coordinates for dedup)

### Export Safety

Native pins export with clear metadata:

```json
{
  "place_id": "uuid",
  "formatted_address": "Near 456 Industrial Blvd, Santa Rosa, CA",
  "is_address_backed": false,
  "coordinates": { "lat": 38.4404, "lng": -122.7141 },
  "source": "native_pin",
  "created_by": "staff_name",
  "created_at": "2026-01-29T10:00:00Z"
}
```

Any system importing this data can distinguish native pins from real addresses via `is_address_backed`.

---

## 13. Photo & Media System

### Unified Media Architecture

Photos exist at two levels:
1. **Place-level media** - photos of the location (exterior, yard, colony area)
2. **Request-level media** - photos taken during trapping operations

Since every request has a place, request photos are also accessible from the place's Gallery tab.

### Gallery UX (Zillow-inspired)

```
Hero Image (largest, most recent or staff-selected)
┌──────────────────────────────────────────────┐
│                                              │
│     [Full-width image, 400px max height]     │
│                                              │
│     Click to open lightbox                   │
│                                              │
└──────────────────────────────────────────────┘

Photo Grid (3 columns desktop, 2 columns mobile)
┌────────────┐  ┌────────────┐  ┌────────────┐
│ Thumbnail  │  │ Thumbnail  │  │ Thumbnail  │
│ Date       │  │ Date       │  │ Date       │
│ Caption    │  │ Caption    │  │ Caption    │
└────────────┘  └────────────┘  └────────────┘
```

### Lightbox (MediaLightbox component)

- Full-screen overlay
- Swipe navigation (mobile)
- Arrow keys (desktop)
- Photo metadata: date, uploaded by, caption, source request
- "Set as main photo" action
- "Delete" action (soft delete)

### Upload Flow

- Drag-and-drop on desktop
- Camera capture on mobile (via `<input type="file" capture="environment">`)
- Multiple file support
- Auto-compression to max 2000px wide
- EXIF GPS extraction (populate coordinates if place lacks them)
- Photo grouping by date/visit (existing PhotoGroupingPanel)

---

## 14. Export & Data Portability

### Design Principle: Every Profile is Exportable

The UI masks SoT table boundaries, but exports must preserve the full relational structure so the data can be reconstructed.

### Export Formats

| Format | Use Case | Contains |
|--------|----------|---------|
| CSV | Spreadsheet analysis | Flat denormalized view |
| JSON | API integration | Full nested structure with IDs |
| PDF | Printing, sharing | Formatted report |

### Export Schemas

**Person Export:**
```json
{
  "person_id": "uuid",
  "display_name": "John Smith",
  "identifiers": [
    { "type": "email", "value": "john@email.com", "source": "clinichq" },
    { "type": "phone", "value": "+17075551234", "source": "web_intake" }
  ],
  "addresses": [
    { "place_id": "uuid", "address": "123 Main St", "role": "primary", "since": "2024-01-05" },
    { "place_id": "uuid", "address": "456 Oak Ave", "role": "historical", "period": "2023-2024" }
  ],
  "cats": [
    { "cat_id": "uuid", "name": "Mittens", "relationship": "owner", "microchip": "985112345678901" }
  ],
  "requests": [
    { "request_id": "uuid", "summary": "Colony TNR", "status": "in_progress" }
  ],
  "metadata": {
    "exported_at": "2026-01-29T10:00:00Z",
    "source_system": "atlas",
    "data_version": "1.0"
  }
}
```

**Place Export:**
```json
{
  "place_id": "uuid",
  "formatted_address": "123 Main St, Santa Rosa, CA 95401",
  "place_kind": "residential_house",
  "is_address_backed": true,
  "coordinates": { "lat": 38.4404, "lng": -122.7141 },
  "contexts": ["colony_site", "volunteer_location"],
  "people": [...],
  "cats": [...],
  "requests": [...],
  "colony_estimates": [...],
  "media": [
    { "url": "...", "caption": "Front yard", "date": "2026-01-15", "type": "image/jpeg" }
  ],
  "metadata": { ... }
}
```

This structure allows rebuilding the full "profile" view from exported data. The `place_id` and `person_id` fields serve as join keys.

---

## 15. Mobile Optimization

### Approach: Responsive, Not Separate

The redesign uses responsive CSS, not a separate mobile app. Every feature works on mobile, but the layout adapts.

### Breakpoints

| Breakpoint | Label | Layout |
|------------|-------|--------|
| < 640px | Mobile | Single column, stacked, hamburger nav |
| 640-768px | Small tablet | Single column, expanded cards |
| 768-1024px | Tablet | Two columns where useful, collapsed sidebar |
| > 1024px | Desktop | Full layout, expanded sidebar |

### Mobile-Specific Adaptations

**Navigation:**
- Sidebar becomes slide-over drawer (hamburger menu)
- Search accessible via icon in top bar (expands to full-width input)
- User menu via avatar icon

**Dashboard:**
- Map preview hidden
- Stats as horizontal scroll pills
- Requests and intake as card list (not table)

**Entity Profiles:**
- Tab bar becomes horizontal scroll or dropdown selector
- Gallery grid: 2 columns
- Tables become card lists
- Inline edit fields become full-width
- Modals become full-screen sheets

**Lists (People, Places, Cats, Requests):**
- Table view hidden on mobile
- Card view is default and only view
- Filters collapse into "Filter" button → bottom sheet
- Search bar sticky at top

**Map:**
- Already optimized (full viewport, icon-only controls, bottom-sheet layer panel)

---

## 16. Implementation Phases

### Phase 1: Foundation (Nav + Design Tokens)

**Status:** ~90% Complete (2026-01-30)

**Done:**
- ✅ AppShell redesigned with drawer nav (hamburger menu, slide-over)
- ✅ Mobile hamburger menu
- ✅ GlobalSearch in top bar center
- ✅ Active route highlighting in drawer
- ✅ Map page full viewport bypass

**Remaining:**
- ⬜ Extract shared `StatusBadge` component (fix B1, B5)
- ⬜ Add URL-based filter persistence for list pages (fix B8)
- ⬜ Sidebar state persistence in localStorage (currently resets)

**Files:**
- `AppShell.tsx` (rewrite) ✅
- `globals.css` (extend tokens) — partial
- New: `components/StatusBadge.tsx` (shared) — not yet
- All list pages (URL param filters) — not yet

**Risk:** Medium - touches AppShell which wraps every page. Must not break active flows.

**Safety:** INV-6 compliance - test all ACTIVE pages after nav change.

### Phase 2: Entity Profile Framework (Tabs)

**Status:** Complete (2026-01-30)

All entity profile pages use `ProfileLayout` with tabbed navigation:

| Entity | Tabs | Key Features |
|--------|------|-------------|
| Requests | 6 (Case Summary, Details, Cats & Evidence, Activity, Nearby, Legacy Info) | Inline rename, status workflow buttons, multiple modals |
| People | 4 (Overview, Connections, Activity, Data) | Inline name edit, address autocomplete, verification |
| Places | 5 (Overview, Requests, Ecology, Media, Activity) | Context tagging, colony estimates, photo gallery |
| Cats | 4 (Overview, Medical, Connections, Activity) | Multi-source transparency, birth/mortality tracking |

**Features built:**
- ✅ `ProfileLayout` component with URL tab state (`?tab=...`)
- ✅ Conditional tab visibility (hide tabs based on data availability)
- ✅ Badge counts on tab labels
- ✅ Edit history panels (fixed right panel)
- ✅ Quick actions per entity type
- ✅ Verification badges
- ✅ Inline editing with audit trail

### Phase 3: Dashboard Redesign

**Status:** Not Started

**Changes:**
- Replace current dashboard with focused work queue
- Personal greeting + date
- "Needs Attention" counts panel
- "My Active Requests" (filtered to current user)
- Compact intake list
- Optional map preview

**Files:**
- `app/page.tsx` (rewrite)
- API: May need `GET /api/requests?assigned_to=me`

**Risk:** Low-Medium - dashboard is a display-only page.

### Phase 4: Address Management, Place Deduplication & Classification

**Status:** Partially Started — Data audit complete, migrations written but unapplied

**Data Audit Findings (2026-01-30):**

| Issue | Count | Impact |
|-------|-------|--------|
| Duplicate place pairs (same location, different format) | 3,317 | Fragmented data |
| Distinct places involved in duplicates | 4,019 | ~36% of non-merged places |
| People seeing duplicate place cards | 398 | Confusing Connections tab |
| Cats linked to duplicate places | 704 | Inaccurate place-level cat counts |
| Relationships to relink after merges | 9,584 | Data correctness |

**Root Cause:** `normalize_address()` function misses: ", USA" suffix, trailing whitespace, period stripping, `"--"` placeholders. Different source systems (Google geocoder vs Airtable vs ClinicHQ) produce subtly different formatted_address values for the same physical location.

**Changes (ordered):**
1. ⬜ Apply MIG_793 (`v_orphan_places`) + MIG_794 (`relink_person_primary_address`) — files exist
2. ⬜ Harden `normalize_address()` — prevent future duplicates (MIG_799)
3. ⬜ Auto-merge 73 safe duplicate pairs (MIG_800)
4. ⬜ Merge 415 USA-suffix duplicate pairs (MIG_801)
5. ⬜ Admin UI for reviewing 2,829 structural duplicate pairs (`/admin/duplicate-places`)
6. ⬜ Implement address relink UX on person profiles
7. ⬜ Add orphan place admin review queue
8. ⬜ Add place type inference logic
9. ⬜ Queue unclassifiable places for AI extraction

**Files:**
- `people/[id]/page.tsx` (address section)
- `API: PATCH /api/people/[id]/address` (relink logic)
- New migrations: MIG_799, MIG_800, MIG_801
- New: `admin/duplicate-places/page.tsx`
- New: `admin/orphan-places/page.tsx`

**Risk:** Medium-High - place merges affect person_place_relationships, cat_place_relationships, sot_requests. Must use surgical merge procedure with backup + entity_edits audit trail.

**See:** `TASK_LEDGER.md` DH_E category for full task cards.

### Phase 5: Media Gallery Enhancement

**Changes:**
- Zillow-style hero image + grid on places
- Request-to-place photo bridging
- Mobile camera capture
- Photo metadata (caption, date, GPS)

**Files:**
- `MediaGallery.tsx` (enhance)
- `places/[id]/page.tsx` (Gallery tab)
- `requests/[id]/page.tsx` (Media tab)

**Risk:** Low - additive feature, no existing data modified.

### Phase 6: Mobile Polish

**Changes:**
- Card views for all list pages on mobile
- Filter bottom sheets
- Full-screen modal sheets
- Touch-optimized tap targets
- Swipe gestures where appropriate

**Files:**
- All list pages
- All modal components
- `globals.css` (responsive utilities)

**Risk:** Low - CSS and layout changes only.

### Future: Native Pin Creation

Requires mobile-specific GPS access. Deferred until native app wrapper or PWA implementation.

---

## 17. North Star Alignment Checklist

Every implementation phase must pass this checklist:

| Check | Invariant | How to Verify |
|-------|-----------|---------------|
| No data deleted | INV-1 | No DROP, DELETE, or TRUNCATE in migrations |
| Manual > AI | INV-2 | UI shows verification badges, AI suggestions are dismissible |
| Stable IDs | INV-3 | Entity creation uses `find_or_create_*()` functions |
| Provenance tracked | INV-4 | All new records have `source_system`, `source_record_id` |
| Identity by identifier | INV-5 | No name-based matching anywhere in new code |
| Active flows preserved | INV-6 | All ACTIVE pages pass smoke test after changes |
| One write path | INV-7 | Trace every button to its API call, verify no duplicates |

### Layer Compliance

| UI Change | Layer | Rule |
|-----------|-------|------|
| Sidebar nav | L6 (Workflow) | Additive, no data changes |
| Entity tabs | L6 (Workflow) | Presentation only, same data |
| Dashboard redesign | L6 (Workflow) | Reads only, no writes |
| Address relink | L2 (Identity) + L5 (SoT) | Must use `find_or_create_place_deduped()` |
| Place classification | L4 (Classification) | Must use `assign_place_context()` |
| Orphan detection | L4 (Classification) | Read-only view |
| AI extraction queue | L3 (Enrichment) | Writes to `extraction_queue` only |
| Photo upload | L1 (Raw) + L5 (SoT) | File storage + metadata in media tables |
| Native pins | L5 (SoT) | Must use `find_or_create_place_deduped()` |

---

## Appendix A: Component Inventory for Reuse

These existing components should be reused in the redesign, not recreated:

| Component | Current Use | Redesign Use |
|-----------|-------------|-------------|
| `BackButton` | All detail pages | Keep as-is (unified in 91063f6) |
| `EntityLink` | Detail pages | Keep, use in all profile tabs |
| `EditHistory` | Detail page sidebars | Move to History tab |
| `JournalSection` | Detail pages | Move to Activity tab |
| `MediaGallery` | Places, requests | Enhance for Gallery tab |
| `MediaUploader` | Upload flow | Enhance for mobile camera |
| `MediaLightbox` | Photo viewing | Keep as-is |
| `SubmissionsSection` | People, places | Move to Activity tab |
| `ObservationsSection` | Places | Move to Ecology tab |
| `ColonyEstimates` | Places, requests | Move to Ecology tab |
| `TrapperAssignments` | Requests | Keep in Details tab |
| `NearbyEntities` | Requests | Move to Location tab |
| `QuickActions` | All entities | Keep in header bar |
| `AddressAutocomplete` | Forms | Reuse for address relink |
| `GlobalSearch` | Nav bar | Move to top bar center |
| `PlaceContextEditor` | Places | Keep in Overview tab |
| `VerificationBadge` | Detail headers | Keep in profile headers |

## Appendix B: API Endpoints Needed

| Endpoint | Method | Purpose | Phase |
|----------|--------|---------|-------|
| `GET /api/requests?assigned_to=me` | GET | My active requests | Phase 3 |
| `PATCH /api/people/[id]/address` | PATCH | Address relink | Phase 4 |
| `GET /api/admin/orphan-places` | GET | Orphan place review | Phase 4 |
| `POST /api/places/[id]/classify` | POST | Manual classification | Phase 4 |
| `POST /api/places/from-pin` | POST | Native pin creation | Future |
| `GET /api/places/[id]/media` | GET | Place media (including request photos) | Phase 5 |

## Appendix C: Database Objects Needed

| Object | Type | Purpose | Phase |
|--------|------|---------|-------|
| `v_orphan_places` | View | Places with no linked entities | Phase 4 |
| `v_place_classification_candidates` | View | Places needing type inference | Phase 4 |
| `classify_place_from_records()` | Function | Auto-classify based on attached data | Phase 4 |
| `relink_person_address()` | Function | Atomic address change operation | Phase 4 |
