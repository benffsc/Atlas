# Atlas to Beacon Framework — Meeting Prep

**For:** Ben + Daniel meeting (March 2026)
**Purpose:** Make the case that Atlas IS the Beacon framework — don't rebuild, port.
**Deadline:** MVP demo at Destination Gala, May 30, 2026

---

## The Pitch (TL;DR)

Atlas already implements **~80% of Beacon's P0 features**. The database has 8,000+ cats, 4,000+ people, 5,000+ places, full identity resolution, and 3 years of clinic data. Rebuilding this in Firebase (or anything else) would take 6+ months and lose all the data infrastructure.

**Proposal:** Beacon IS Atlas, rebranded and extended. Same codebase, same database, same deployment. We add the Beacon-specific features (public-facing pages, design system, remaining analytics) on top of what exists.

---

## The Porting Layer (Built)

Three files bridge Atlas → Beacon. No framework change needed.

### 1. `lib/product-context.tsx` — Product Identity

```tsx
const { product, brandName, isBeacon } = useProduct();
// "atlas" on /admin/*, "beacon" on /beacon/*
```

Any component can ask "am I in Atlas or Beacon?" and adapt. Sidebar shows different nav, branding shows different logo, features can be gated per product.

### 2. `components/ThemeSyncer.tsx` — Design Token → CSS Bridge

Reads admin-configured theme from `ops.app_config` via `useDesignTokens()` and writes values into `:root` CSS variables. Every component already using `var(--primary)` automatically themes to Beacon's colors (#4291df) when inside `/beacon/*` routes — **zero component changes needed**.

### 3. `app/beacon/layout.tsx` — Route-Level Wiring

```tsx
<ProductProvider product="beacon">
  <ThemeSyncer>
    {children}
  </ThemeSyncer>
</ProductProvider>
```

All `/beacon/*` routes get Beacon context. Everything else stays Atlas. Pages that get "ported" to Beacon just move under `/beacon/` and automatically get the new identity.

### How Porting Works

To port an Atlas page to Beacon:
1. **Copy** the page from `/admin/whatever/page.tsx` to `/beacon/whatever/page.tsx`
2. It automatically gets Beacon branding + theme (via the layout)
3. Adjust any product-specific UI using `useProduct()` if needed
4. Atlas original stays live until the Beacon version is proven stable
5. Eventually redirect the Atlas route → Beacon route

No new framework. No migration tool. Just file placement + the context layer.

---

## What Atlas Already Has (That Beacon Needs)

### Beacon P0: Atlas Map

| Beacon P0 Feature | Atlas Status | Notes |
|---|---|---|
| Map base layer | **Done** | Google Maps integration, cluster rendering, 5,000+ pins |
| Search by location | **Done** | `/api/search?q=...` — cats, places, people, addresses |
| Map controls | **Done** | Fullscreen, zoom, satellite toggle |
| Map filters | **Done** | Date range, service zone, atlas data layers, operational data |
| Sidebar panel for details | **Done** | Right-hand panel on pin click — address, cats, people, requests, alterations, notes |
| Legend for pin types | **Done** | Dynamic legend, admin-editable colors via `useMapColors()` |
| Toggle layers | **Done** | Layer visibility switches in map control panel |
| Alteration rate overlays | **Done** | `v_request_alteration_stats` view, alteration % on clusters + pins |
| Colony size cluster indicator | **Done** | Heatmap color-coding by colony size |
| Disease badges | **Done** | F(FeLV), V(FIV), R(Ringworm), H(Heartworm), P(Panleukopenia) |
| Data quality indicators | **Partial** | Confidence scores exist on identifiers; no unified "completeness" badge per record |
| Map drill-down (P2) | **Done** | County -> zone -> cluster -> address hierarchy |
| Time period comparison (P2) | **Done** | Location comparison with bar chart (`/beacon/compare`) |

### Beacon P0: Population Analytics Tool

| Beacon P0 Feature | Atlas Status | Notes |
|---|---|---|
| Analytics base layer | **Done** | `/beacon` page with control panel + preview area |
| Total population estimate | **Done** | Chapman mark-recapture: `N = ((M+1)(C+1)/(R+1)) - 1` |
| Scenario comparison | **Done** | `/beacon/scenarios` — two simulations with delta cards |
| Location comparison | **Done** | `/beacon/compare` — side-by-side bar charts |
| Data quality indicators | **Partial** | Same as map |
| Population curve (P1) | **Done** | SVG chart showing growth/decline +/- intervention |
| Climate variables (P1) | **Not started** | Simulator parameter — need seasonal breeding data |
| Management model variables (P1) | **Partial** | Basic parameters exist (trap rate, return rate); need UI |
| 10-year forecast horizon (P1) | **Done** | Population forecast chart supports configurable year range |

### Beacon: Intake & Request Management

| Feature | Atlas Status | Notes |
|---|---|---|
| Request intake form | **Done** | Multi-step guided form, 9 sections, call sheet aligned |
| Request triage queue | **Done** | Priority-ranked list with status workflow |
| Request lifecycle | **Done** | `new -> triaged -> scheduled -> in_progress -> completed` |
| Print call sheets | **Done** | `/intake/print/[id]` — Jami's daily workflow |
| Request-to-trapper assignment | **Done** | Trapper assignment with service area matching |
| Public intake form | **Done** | Community-facing request submission |

### Beacon: Data Infrastructure

| Feature | Atlas Status | Notes |
|---|---|---|
| Deduplicated database | **Done** | Identity resolution engine, merge functions, 0 clinic leakage |
| ClinicHQ integration | **Done** | 3-file batch upload, stored procedure processing, Ingest Dashboard |
| ShelterLuv integration | **Done** | Program animals, outcomes, foster data |
| VolunteerHub integration | **Done** | Volunteer people, trapper classification |
| Entity linking pipeline | **Done** | Cat-place, cat-request, person-cat linking with monitoring |
| Audit trail | **Done** | `ops.entity_edits` — every field change tracked with reason |
| Admin config system | **Done** | 14 categories, admin-editable, 67+ config hook usages |

### What's NOT in Atlas Yet (Beacon-Specific Gaps)

| Gap | Priority | Effort | Notes |
|---|---|---|---|
| **Beacon design system** | P1 | Medium | Colors (#4291df primary), fonts (Questrial/DM Sans), 8px grid. Currently Atlas uses its own design tokens. |
| **External/public map** | P3 | Medium | Interactive county map with limited data for public. Atlas map is internal-only. |
| **Public cat sighting report** | P1 | Small | Lead capture after sighting submission. Currently only request form exists. |
| **Trap inventory tracking** | P3 | Medium | Equipment management — traps owned, deployed, linked to location. (Schema started: MIG_2977/2978) |
| **Financial impact model** | P3 | Small | Projected shelter cost savings per alteration rate. Data exists, need visualization. |
| **Cross-species reports** | P4 | Large | Bird population recovery correlation. Need external data sources. |
| **Partner org data ingestion** | P3 | Large | Marin Humane, Sonoma County Animal Services imports. |
| **Photo documentation** | P3 | Medium | Per-cat photo taken during clinic intake. Need storage + UI. |
| **Onboarding/user help** | P1 | Medium | First-run experience, tooltips, contextual help. Nothing exists. |

---

## Architecture: How Atlas Becomes Beacon

### Principle: Same App, Different Faces

```
┌─────────────────────────────────────────────────────┐
│                    Next.js App                       │
│                                                     │
│  /beacon/*          Staff-facing analytics,         │
│                     map, population tools            │
│                     (Beacon brand + design system)   │
│                                                     │
│  /admin/*           Staff admin tools               │
│                     (Atlas internal, existing)       │
│                                                     │
│  /public/*          External-facing pages            │
│                     (Beacon brand, limited data)     │
│                                                     │
│  /api/*             Shared API layer                 │
│                     (serves all faces)               │
│                                                     │
├─────────────────────────────────────────────────────┤
│              Supabase / PostgreSQL                   │
│  sot.* | ops.* | source.* | ref.*                   │
│  (single database, same schema)                     │
└─────────────────────────────────────────────────────┘
```

**Why NOT a separate app:**
1. Same data — Beacon needs the same cats, places, people that Atlas manages
2. Same functions — `find_or_create_*`, identity resolution, entity linking
3. Same auth — staff users access both Atlas admin tools and Beacon analytics
4. Same deployment — one Vercel project, one database, one CI pipeline
5. Already white-label ready — `ops.app_config` has org branding, geo config, terminology

### Route Strategy

| Route Prefix | Purpose | Auth | Design System |
|---|---|---|---|
| `/beacon` | Analytics, scenarios, population tools | Staff login required | Beacon design tokens |
| `/beacon/map` | Full interactive map | Staff login required | Beacon design tokens |
| `/admin/*` | All current Atlas admin pages | Staff login required | Atlas design tokens (migrate later) |
| `/intake/*` | Intake call workflow | Staff login required | Atlas (Jami's workflow — don't touch) |
| `/public/*` | External-facing map, request form, sighting report | No auth | Beacon public design |
| `/api/*` | All API routes | Mixed (some public, most authed) | N/A |

### Design System Transition

Don't redesign everything at once. Layer the Beacon design system on new pages only:

```
Phase 1 (May 30 MVP):
  - /beacon/* pages use Beacon design tokens
  - Everything else stays as-is

Phase 2 (Post-gala):
  - Migrate /admin/* to Beacon design tokens page by page
  - Extract shared Beacon component library

Phase 3 (White-label):
  - All design tokens are org-configurable via ops.app_config
  - No hardcoded colors/fonts anywhere
```

**Already in place for this:**
- `useOrgConfig()` — org name, phone, website, email, tagline
- `useMapColors()` — admin-editable map color palettes
- `useDesignTokens()` — theme tokens hook
- `useGeoConfig()` — county, service area, map center/zoom
- `ops.app_config` — 14 config categories, full admin UI

---

## What Daniel Needs to Know About the Codebase

### Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript | 123 pages, `"use client"` throughout |
| API | Next.js Route Handlers (`/app/api/`) | 404 route files, standardized `apiSuccess`/`apiError` |
| Database | PostgreSQL via Supabase | 3-schema design: `sot.*`, `ops.*`, `source.*` |
| Auth | Session-based (`lib/auth.ts`) | Role-permission matrix (admin/staff/volunteer) |
| Maps | Google Maps JavaScript API | Cluster rendering, custom pins, layers |
| Deployment | Vercel | Auto-deploy on push to `main` |
| Project mgmt | Linear | 500+ issues tracked, MCP integration with Claude Code |

### Key Patterns Daniel Should Understand

1. **Centralized entity creation** — Never `INSERT INTO sot.cats`. Always `sot.find_or_create_cat_by_microchip()`. These functions handle dedup, normalization, audit trail.

2. **Config over code** — Options registries in `form-options.ts`, runtime config in `ops.app_config`, display labels admin-editable. Adding a new dropdown option = one line in `form-options.ts`.

3. **Standardized API** — Every route uses `apiSuccess(data)` / `apiError(message)`. Frontend uses `fetchApi()` which auto-unwraps. 2,231+ usages.

4. **View contracts** — SQL views have matching TypeScript interfaces in `view-contracts.ts`. The type system guarantees frontend/backend alignment.

5. **Entity linking pipeline** — Cats link to places, requests, people via SQL functions. After any backfill, run `sot.run_all_entity_linking()`.

6. **Provenance everywhere** — Every record has `source_system` + `source_record_id` + `source_created_at`. You can trace any data point back to its origin.

### File Structure

```
apps/web/
  src/
    app/
      admin/       # 68 admin pages (internal Atlas tools)
      api/         # 404 API route files
      beacon/      # Beacon analytics pages (map, compare, scenarios)
      intake/      # Intake workflow (Jami's domain)
      public/      # Public-facing pages
    components/
      beacon/      # Beacon-specific components
      feedback/    # Toast, EmptyState, Skeleton
      layouts/     # ListDetailLayout, TwoColumnLayout
      modals/      # 21 modal components
      preview/     # EntityPreviewPanel + 5 content mappers
      search/      # GlobalSearch, EntityPreview hover
      shared/      # ActionDrawer, RowActionMenu, Breadcrumbs
      ui/          # TabBar, StatCard, Modal, SmartField
    hooks/         # 30+ data/config/utility hooks
    lib/
      api-client.ts      # fetchApi, postApi (frontend)
      api-response.ts    # apiSuccess, apiError (backend)
      api-validation.ts  # requireValidUUID, parsePagination
      enums.ts           # Centralized enum registry
      form-options.ts    # Single source of truth for all options
      auth.ts            # Session auth (566 lines)
sql/
  schema/v2/       # Database migrations (MIG_2000+)
scripts/
  pipeline/        # Data cleaning, entity linking, audit scripts
docs/              # Architecture docs, data gap tracking
```

---

## Proposed Sprint Plan (through May 30 Gala)

### Sprint 1: Foundation (Now - April 7)

**Goal:** Daniel can run Atlas locally and understand the codebase.

| Task | Owner | Notes |
|---|---|---|
| Dev environment setup | Daniel | `pnpm install`, env vars, local Supabase or shared staging |
| Codebase walkthrough | Ben + Daniel | Key files: auth.ts, api-validation.ts, form-options.ts, enums.ts |
| Run existing Beacon pages | Daniel | `/beacon`, `/beacon/compare`, `/beacon/scenarios` |
| Review Helix architecture doc | Daniel | `docs/HELIX_ARCHITECTURE.md` — understand kernel layers |
| Agree on design token approach | Both | How to layer Beacon design system without breaking Atlas |

### Sprint 2: Beacon Map Enhancements (April 7-21)

**Goal:** The map is Gala-demo-ready.

| Task | Priority | Notes |
|---|---|---|
| Beacon design tokens on `/beacon/*` | P0 | CSS variables for Beacon brand colors/fonts, scoped to `/beacon` routes |
| Map filter UX polish | P0 | Floating filter panel, service zone selector, data layer toggles |
| Pin detail sidebar redesign | P1 | More context: cat photos (if available), linked requests, alteration history |
| Data quality badge per record | P1 | Completeness score visible on pins and sidebar |
| Layer toggle UX | P1 | Clean switch components for showing/hiding layers |

### Sprint 3: Analytics + Storytelling (April 21 - May 5)

**Goal:** Population analytics tell a compelling story for donors/civic leaders.

| Task | Priority | Notes |
|---|---|---|
| Scenario comparison polish | P0 | Side-by-side with clear delta cards, meaningful parameter labels |
| Population curve animation | P1 | Animated SVG showing growth → intervention → decline |
| County rollup dashboard | P0 | Already built (`/api/beacon/county-rollup`), needs UI polish |
| Financial impact projection | P2 | "Every cat altered saves $X in shelter costs over Y years" |
| Export/share capability | P2 | Generate shareable link or PDF of a scenario |

### Sprint 4: Demo Prep (May 5-30)

**Goal:** Polished, stable, demo-able product.

| Task | Priority | Notes |
|---|---|---|
| Demo script + data | P0 | Curated walkthrough for Pip to present at Gala |
| Performance optimization | P0 | Map load time, initial render, largest contentful paint |
| Onboarding flow | P1 | First-run experience for new users at Gala |
| Error handling audit | P1 | No raw errors visible to users |
| Mobile responsiveness | P2 | Gala attendees may view on phones |

---

## Parallel Operations — Zero Disruption Guarantee

**Critical constraint: Jami, Bridget, Crystal, and Pip use Atlas every day. Nothing breaks during transition.**

### The Rule

Every Atlas page and workflow continues to work exactly as-is while Beacon features are built alongside. There is no "switch day" — it's a gradual handoff where Beacon pages become the primary interface only when they're proven stable.

### How This Works

```
         ATLAS (current)                    BEACON (new)
         ──────────────                     ────────────
Day 1:   /admin/*  ← staff uses this       /beacon/*  ← analytics only
         /intake/* ← Jami's workflow        (no overlap with Atlas)
         /map      ← Ben + Crystal

Day 60:  /admin/*  ← still works            /beacon/map  ← enhanced map
         /intake/* ← untouched              /beacon/*    ← analytics
         /map      ← still works            (staff can use either map)

Day 120: /admin/*  ← still works            /beacon/*  ← primary interface
         /intake/* ← untouched              /beacon/intake ← new intake (optional)
         /map      ← redirect to beacon
```

### Protected Zones (DO NOT TOUCH without explicit approval)

| Path | Owner | Why |
|---|---|---|
| `/intake/print/[id]/page.tsx` | Jami | Her daily call sheet workflow. Paper form generation. |
| `/intake/call/*` | Jami | Intake call flow — 10-30 min calls, muscle memory matters. |
| `lib/intake-options.ts` | Jami | Re-export layer for intake forms — changing values breaks print alignment. |
| `/admin/data` | Ben | Data quality review dashboard. |
| Trapper management pages | Crystal/Ben | Active assignment workflow. |

### Parallel Running Strategy

1. **Beacon pages are additive** — new routes under `/beacon/*` that don't replace anything
2. **Shared API layer** — Beacon pages call the same `/api/*` routes. No data duplication.
3. **Feature flags for gradual rollout** — `ops.app_config` key `beacon.feature.X` gates new features
4. **Staff can access both** — sidebar shows both Atlas sections and Beacon sections
5. **No schema migrations that break existing queries** — new columns/tables only, never drop/rename in-use columns
6. **Rollback plan** — if a Beacon page has issues, the Atlas equivalent is still there

### Sidebar Navigation (Dual Mode)

```
┌─────────────────────────┐
│  BEACON                 │  ← new section
│    Map                  │
│    Analytics            │
│    Scenarios            │
│    Compare              │
│                         │
│  ATLAS                  │  ← existing, unchanged
│    Requests             │
│    Intake               │
│    People               │
│    Cats                 │
│    Places               │
│    Trappers             │
│    Admin ▸              │
│    Ingest Dashboard     │
└─────────────────────────┘
```

Staff see both sections. Over time, Beacon sections absorb Atlas functionality. Atlas sections remain available as long as anyone uses them. Removal happens only after:
1. Beacon equivalent is proven stable (2+ weeks in production)
2. Staff confirm they've switched
3. Analytics show zero traffic to old page

---

## Decision Points for the Meeting

1. **Same codebase or separate?** (Recommendation: same — rationale above)

2. **Beacon design system scope for MVP?** (Recommendation: `/beacon/*` only, everything else stays as-is)

3. **Daniel's focus area?** (Recommendation: Beacon map UX + design system. Ben continues data infrastructure + analytics.)

4. **Database access for Daniel?** (He needs read access to understand the schema. Can share staging Supabase credentials or set up a read-only role.)

5. **Branch strategy?** (Recommendation: feature branches off `main`, PR reviews, same as current flow)

6. **Firebase decision?** (Recommendation: don't use Firebase. Supabase/PostgreSQL has 2,978 migrations of schema work, stored procedures, identity resolution. Firebase can't replicate this.)

---

## Why Not Rebuild

| Concern | Atlas Answer |
|---|---|
| "The code is messy" | 404 standardized API routes, 2,231 `apiSuccess`/`apiError` usages, comprehensive type safety |
| "It's FFSC-specific" | White-label config already exists: org branding, geo config, terminology, form options, permissions — all admin-editable |
| "We need better design" | Agreed — but design is CSS/components, not architecture. Layer Beacon design tokens on existing page structure. |
| "We need a mobile app" | Next.js supports PWA. Add `manifest.json` + service worker. The API layer already exists for any mobile client. |
| "Firebase is easier" | Easier to start, harder to maintain. Atlas has identity resolution, entity merging, provenance, audit trails, stored procedures. Recreating these in Firestore would take months. |
| "Too much technical debt" | Helix audit shows L1 (data) and L2 (config) are both "Ready". L3 (presentation) has gaps but they're all tracked in Linear with extraction plans. |

---

## Appendix: Beacon P0 Feature Checklist (from Product Spec)

### Atlas Map Page

- [x] Atlas Map base layer
- [x] Search by location
- [x] Map controls (fullscreen, zoom, satellite)
- [x] Map filters (date range, service zone, data layers)
- [x] Sidebar panel for details
- [x] Legend for pin types
- [x] Toggle layers
- [x] Alteration rate overlays
- [x] Colony size cluster indicator
- [x] Disease badges (FeLV, FIV, Ringworm, Heartworm, Panleukopenia)
- [ ] Data quality indicators (partial — need unified completeness badge)
- [x] Map drill-down (county → zone → cluster → address)
- [x] Time period comparison

### Population Analytics Tool

- [x] Analytics base layer
- [x] Total population estimate
- [x] Scenario comparison
- [x] Location comparison
- [ ] Data quality indicators (partial)
- [x] Population curve visualization
- [ ] Climate input variables for seasonal analysis
- [ ] Management model variable UI
- [x] 10-year forecast horizon
