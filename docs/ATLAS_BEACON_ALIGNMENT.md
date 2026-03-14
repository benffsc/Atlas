# Atlas State Document — Beacon Alignment Audit

**Version:** 1.0 | **Last Updated:** March 13, 2026
**Document Owner:** Ben Mis
**Purpose:** Mirror the Beacon Product Spec structure, filled in with Atlas's current state. Identifies what exists, what's partial, and what's missing relative to Beacon P0-P4 requirements.

**Reference:** Beacon Product Spec (Google Doc, owned by Dominique Fougère, last updated March 9, 2026)

---

## Table of Contents

1. [Overview & Alignment Summary](#overview--alignment-summary)
2. [Atlas Map — Feature Audit](#page-atlas-map--feature-audit)
3. [Population Analytics Tool — Feature Audit](#page-population-analytics-tool--feature-audit)
4. [Intake & Workflow System](#intake--workflow-system)
5. [Entity Management (Cats, People, Places)](#entity-management)
6. [Data Infrastructure & Quality](#data-infrastructure--quality)
7. [Admin & Configuration](#admin--configuration)
8. [External / Public-Facing](#external--public-facing)
9. [Trapper Management](#trapper-management)
10. [Email & Communications](#email--communications)
11. [AI / Tippy Integration](#ai--tippy-integration)
12. [Gap Summary & Recommended Linear Issues](#gap-summary--recommended-linear-issues)
13. [Design System Alignment](#design-system-alignment)

---

## Overview & Alignment Summary

### What Atlas IS Today

Atlas is a fully operational internal tool with **123 pages**, **350+ API routes**, and **68 admin pages**. It handles:

- **Data unification** — ClinicHQ, Airtable, ShelterLuv, VolunteerHub, Google Maps all ingested into a single PostgreSQL database
- **Entity management** — Full CRUD for cats, people, places, requests with identity resolution and deduplication
- **Map visualization** — Leaflet-based interactive map with 15+ layers, disease overlays, clustering
- **Intake pipeline** — Public form → auto-triage → queue → staff review → request creation
- **Trapper coordination** — Assignment, onboarding, materials, field reporting
- **Basic analytics** — Alteration rates, colony estimates, seasonal alerts, year-over-year comparison
- **Data quality engine** — Identity resolution, confidence scoring, merge pipeline, soft blacklists

### What Atlas IS NOT (Yet)

- **No scenario modeling** — Can't compare "what if we trap 2x more?" outcomes
- **No time-range filtering on map** — Can't view "only cats altered in 2025"
- **No 10-year population forecast** — Parameters exist but no projection UI
- **No public-facing map** — Map is internal-only
- **No partner org data ingestion** — Only FFSC's own data sources
- **No design system** — Uses default shadcn/Tailwind, not Beacon brand colors/typography

### Beacon P0 Readiness Scorecard

| Beacon P0 Requirement | Atlas Status | Gap |
|------------------------|-------------|-----|
| Atlas Map (internal base layer) | ✅ Ready | — |
| Search by location | ✅ Ready | Keyboard shortcut missing |
| Map controls (zoom, fullscreen, satellite) | ✅ Ready | No fullscreen toggle |
| Map filters (date range, etc.) | ⚠️ Partial | No date-range picker |
| Sidebar Panel for Details | ✅ Ready | — |
| Legend for Pin Types | ✅ Ready | No keyboard shortcut |
| Toggle Overlay layers | ✅ Ready | — |
| Alteration rate overlays | ✅ Ready | Per-place & cluster; no county rollup |
| Colony size cluster indicator | ✅ Ready | Cluster markers with zone stats |
| Disease Badges | ✅ Ready | FeLV, FIV, Ringworm, Heartworm, Panleukopenia |
| Data quality indicators | ⚠️ Partial | Per-record confidence; no global dashboard |
| Population estimate | ⚠️ Partial | Chapman framework exists; no forecast UI |
| Scenario comparison | ❌ Missing | Parameters exist, no comparison UI |
| Location comparison | ❌ Missing | — |
| 10-year forecast horizon | ❌ Missing | Ecology config exists, no projection engine |

---

## Page: Atlas Map — Feature Audit

### P0 Features

#### Atlas Map (internal base layer) — ✅ READY
- **Implementation:** `/app/map/page.tsx` with Leaflet + MarkerCluster
- **Layers:** 15+ toggleable layers organized in 4 groups:
  - **Atlas Data:** All Places, Disease Risk (5 diseases), Watch List, Needs TNR, Needs Trapper
  - **Disease Filter:** FeLV, FIV, Ringworm, Heartworm, Panleukopenia (individually toggleable)
  - **Operational:** Observation Zones, Volunteers, Clinic Clients
  - **Historical:** Cat Locations, Google Pins, TNR Priority, Historical Sources, Data Coverage
- **State persistence:** Layer state encoded in URL params (`?layers=atlas_all,atlas_disease`)
- **Mobile:** Responsive design with mobile breakpoint detection

#### Search by location — ✅ READY
- **Implementation:** Global search via `/api/search?q=...&limit=8&suggestions=true`
- **Types:** Searches across cats, people, places, requests simultaneously
- **Integration:** Search results link to map pins
- **Gap:** No keyboard shortcut (Cmd+K) to focus search bar

#### Map controls — ✅ READY (mostly)
- **Implemented:** Zoom in/out, pan, layer visibility toggles
- **Implemented:** Satellite view toggle (map/satellite)
- **Gap:** No fullscreen mode toggle
- **Gap:** No keyboard shortcuts documented

#### Map filters — ⚠️ PARTIAL
- **Implemented:** Viewport-based filtering (`bounds=lat1,lng1,lat2,lng2`)
- **Implemented:** Layer toggles (disease, operational, historical)
- **Gap:** ❌ No date-range picker (critical P0 requirement per spec: "Date range" is #1 filter)
- **Gap:** ❌ No temporal filtering at all (can't view "cats altered in Q1 2026")
- **Spec says:** "Filters to display, in descending order of importance: 1. Date range"

#### Sidebar Panel for Details — ✅ READY
- **Implementation:** 4 detail drawer types (place, annotation, person, cat)
- **Data shown:** Address, cat count, people count, request count, alteration stats, disease status, long notes
- **Spec requirements met:** Address ✅, Cat count ✅, People count ✅, Request count ✅, Alterations ✅, Long Notes ✅

#### Legend for Pin Types — ✅ READY
- **Implementation:** `MapLegend` component, bottom-left card
- **Shows:** Color-coded legend for all active layers
- **Gap:** No expand/collapse control, no keyboard shortcut toggle

#### Toggle Overlay layers — ✅ READY
- **Implementation:** Grouped layer control panel with per-layer toggles

#### Alteration rate overlays — ✅ READY
- **Implementation:**
  - Per-place: `ops.mv_beacon_place_metrics` materialized view
  - Per-cluster: `ops.v_beacon_cluster_summary` by observation zone
  - Global: `/api/beacon/summary` using `ops.v_beacon_summary`
  - Color coding: Green ≥80%, Orange ≥50%, Red <50%
  - Fixed denominator (MIG_2861): Uses `known_status_cats` not total cats
- **Gap:** No county-level rollup (address alteration → county impact)
- **Gap:** No time-range filtering on alteration rates

#### Colony size cluster indicator — ✅ READY
- **Implementation:** MarkerCluster with zoom-aware grouping
- **Data:** Zone-level stats via `ops.v_beacon_cluster_summary`
- **Gap:** No heatmap color-coding for colony sizes (spec says "cold-to-warm color scheme")

#### Disease Badges — ✅ READY
- **Implementation:** `DiseaseStatusSection` component + map layer
- **Diseases tracked:** FeLV (F), FIV (V), Ringworm (R), Heartworm (H), Panleukopenia (P)
- **Status workflow:** confirmed_active → suspected → historical → cleared
- **Data:** `ops.place_disease_status` with evidence sources, positive counts, date ranges
- **Map integration:** `disease_badges` JSONB array on pins, filterable by disease key

#### Data quality indicators — ⚠️ PARTIAL
- **Implemented:**
  - `DataQualityBadge` component (source system, confidence level, verification status)
  - `is_verified` boolean on people (staff-verified suppresses auto-updates)
  - `confidence` field on identifiers (0.0–1.0)
  - Beacon summary: `cat_place_coverage_pct`, `geocoding_rate_pct`, `known_status_cats`
- **Gap:** No overall data quality score per record
- **Gap:** No completeness meter (% of fields filled)
- **Gap:** No global quality dashboard

### P2 Features

#### Map drill-down (county → zone → cluster → address) — ⚠️ PARTIAL
- **Implemented:** Zoom-based clustering (cluster → individual pins)
- **Implemented:** Observation zones group places geographically
- **Gap:** No formal county → zone → cluster hierarchy
- **Gap:** No breadcrumb-style drill-down navigation

#### Compare time periods — ❌ MISSING
- Year-over-year comparison exists in `/beacon` dashboard but NOT on the map
- No side-by-side temporal comparison

### P3 Features

#### External map (public-facing) — ❌ MISSING
- No public-facing map exists
- Auth required for all map access currently

#### Photo documentation per cat — ⚠️ PARTIAL
- Media upload API exists (`/api/media/upload`)
- Hero image support (`/api/media/[id]/hero`)
- Gap: No systematic photo workflow for clinic days

#### Partner org data ingestion — ⚠️ PARTIAL
- ClinicHQ ✅, Airtable ✅, ShelterLuv ✅, VolunteerHub ✅
- Gap: No Marin Humane, Sonoma County Animal Services, or other partner data

#### Trap inventory tracking — ⚠️ PARTIAL
- Equipment management page exists (`/admin/equipment`)
- Gap: Not linked to map locations, no check-in/check-out workflow

#### Financial impact model — ❌ MISSING

### P4 Features

#### Cross-species bird/wildlife data — ❌ MISSING
#### Predation rate report — ❌ MISSING
#### White-label Beacon — ❌ MISSING (architecture being prepared via FFS-485/FFS-496)

---

## Page: Population Analytics Tool — Feature Audit

### P0 Features

#### Analytics tool base layer — ⚠️ PARTIAL
- **Implemented:** Beacon dashboard (`/beacon`) with:
  - Total cats, places, verified, altered, alteration rate
  - Colony status breakdown (managed, in-progress, needs-work, needs-attention, no-data)
  - Cluster metrics with management rates
  - TNR target progress
  - Year-over-year comparison charts
  - Seasonal alerts card
- **Gap:** No separate "Population Analytics Tool" page with control panel + preview area as spec describes
- **Gap:** No parameter adjustment UI ("adjust levers and inputs")

#### Total population estimate — ⚠️ PARTIAL
- **Implemented:**
  - Chapman mark-recapture framework referenced in `EcologyMethodologyPanel`
  - `n_hat_chapman` field in forecast API
  - Colony estimates from multiple sources (trapping_request, intake_form, trapper_report, etc.)
  - Per-place forecasts with `estimated_remaining` cats
- **Gap:** No county-level total population estimate
- **Gap:** No aggregate "total estimated cats in Sonoma County" number
- **Gap:** Chapman formula implementation may be incomplete (in DB, not verified)

#### Scenario comparison — ❌ MISSING
- Ecology config parameters exist (`ops.ecology_config`) with categories: reproduction, survival, tnr, immigration, colony, observation
- No UI to adjust parameters and see projected outcomes
- No A/B comparison between strategies
- **This is the single largest gap for Beacon P0**

#### Location comparison — ❌ MISSING
- Can view individual place metrics but cannot compare 2 places side-by-side

#### Data quality indicators — ⚠️ PARTIAL (see Map section above)

### P1 Features

#### Population curve visualization — ⚠️ PARTIAL
- Forecast page shows per-place estimates with `estimated_cycles_to_complete`
- Gap: No actual curve/chart showing growth/decline over time
- Gap: No "with intervention vs. without" comparison line

#### Climate input variables — ❌ MISSING
- Seasonal analysis page exists as stub
- `v_breeding_season_indicators`, `v_kitten_surge_prediction` are SQL stubs, not implemented
- No weather/climate data integration

#### Management model variables — ⚠️ PARTIAL
- `ops.ecology_config` has parameters for reproduction, survival, tnr rates
- No UI to adjust these and see real-time forecast changes

#### 10-year forecast horizon — ❌ MISSING
- No projection engine
- Have the parameter framework but no time-series forecasting

---

## Intake & Workflow System

### Current State — ✅ STRONG

Atlas has a comprehensive intake system that is actively used daily by Jami:

#### Intake Flow
1. **Public submission** → Jotform/Airtable → synced to `ops.intake_submissions`
2. **Auto-triage** → `compute_intake_triage()` scores submissions
3. **Queue** → `/intake/queue` with tabs (Active, Scheduled, Completed, All, Archived)
4. **Staff review** → Detail page with accept/decline actions
5. **Conversion** → `convert_intake_to_request()` creates request + person + place

#### Forms
- **Digital intake** → `/intake/call-sheet/page.tsx` (phone intake form for Jami)
- **Manual intake** → `/intake/queue/new/page.tsx` (admin intake entry)
- **Print forms** → `/intake/print/[id]/page.tsx` (Jami prints daily — sacred workflow)
- **Request form** → `/requests/new/page.tsx` (FFR request creation)

#### Active Modernization (FFS-485)
- Centralized form option registry (`form-options.ts`) — FFS-486 ✅ done
- Section extraction (FFS-487, FFS-488) — planned
- Page recomposition (FFS-494) — planned
- JSON config layer (FFS-496) — planned (foundational for white-label)
- Admin UI (FFS-497) — planned

### Gaps for Beacon
- **No "one ramp onto the freeway" experience** — Jami described wanting: call → see map → see case context → book appointment, all in one flow
- **No ClinicHQ booking integration** — Still requires separate ClinicHQ login to book appointments
- **No phone call transcription** — Jami manually logs call notes
- **No automated duplicate detection during intake** — Person/place dedup happens post-creation

---

## Entity Management

### Cats — ✅ COMPREHENSIVE
- List page with filters, sorting, search
- Detail page with: medical history, place history, person links, test results, alteration status
- Print view
- Identity: microchip primary, `clinichq_animal_id` fallback, recheck detection (15-digit pattern)
- Linked to places via `cat_place_relationships`
- Linked to requests via attribution windows (6mo before, during, 3mo after)
- **No create flow in UI** (cats created via ingest pipeline or API only)

### People — ✅ COMPREHENSIVE
- List page with filters, sorting, search
- Detail page with: identifiers, addresses, cat links, request history, trapper profile
- Print view
- Identity resolution via `data_engine_resolve_identity()`
- Create modal with dedup (`CreatePersonModal` + `usePersonSuggestion`)
- Household grouping via `sot.households`
- Clinic account tracking (`ops.clinic_accounts`)

### Places — ✅ COMPREHENSIVE
- List page with filters, sorting, search
- Detail page with: address, people, cats, requests, disease status, colony estimates, alteration history
- New place form with `PlaceResolver` (geocoding + dedup)
- Print view
- `get_place_family()` for parent/child/sibling/co-located places
- `find_or_create_place_deduped()` centralized creation
- `merge_place_into()` for deduplication

### Requests — ✅ COMPREHENSIVE
- List page with filters, sorting, search
- Detail page with: status, priority, trapper assignments, cats, alteration stats, handoff history
- New request form (extensive — being modularized via FFS-485)
- Trapper assignment sheet (`/[id]/trapper-sheet`)
- Print batch view (`/requests/print`)
- Lifecycle: new → triaged → scheduled → in_progress → completed
- Handoff (`ops.handoff_request()`), redirect, archive capabilities
- 4 creation paths: direct, intake conversion, handoff, redirect

---

## Data Infrastructure & Quality

### Data Sources — ✅ OPERATIONAL
| Source | Status | Data |
|--------|--------|------|
| ClinicHQ | ✅ Active ingestion | Appointments, cats, procedures, microchips |
| Airtable | ✅ Synced | Legacy requests, public intake, Project 75 |
| ShelterLuv | ✅ Synced | Program animals, outcomes, foster data |
| VolunteerHub | ✅ Synced | Volunteer people, group memberships |
| Google Maps | ✅ Synced | Place pins, long notes |
| PetLink | ✅ Imported | Microchip registry (confidence-filtered) |
| Web Intake | ✅ Active | Public form submissions |

### Identity Resolution — ✅ ROBUST
- `data_engine_resolve_identity()` — Single fortress for identity matching
- Email/phone matching with address verification (MIG_2548/2560)
- `classify_owner_name()` → person/org/address classification
- `should_be_person()` gate → prevents false person creation
- Soft blacklist for org emails
- Confidence thresholds (≥0.5 for identity matching)

### Deduplication — ✅ STRONG
- 10 admin pages dedicated to dedup (person, place, cat, address, request, merge review)
- `merge_person_into()`, `merge_place_into()` with safety checks
- Phone matching requires address similarity verification
- `merged_into_*_id IS NULL` filter enforced across all queries

### Data Quality — ⚠️ MODERATE
- Source tracking on all records
- Confidence scoring on identifiers
- Verification flags (staff-verified suppresses auto-updates)
- Entity linking health monitoring (`ops.check_entity_linking_health()`)
- **Gap:** No unified data quality dashboard
- **Gap:** No completeness scoring per entity
- **Gap:** No data lineage visualization

---

## Admin & Configuration

### Built — ✅ EXTENSIVE (68 admin pages)

| Category | Pages | Key Capabilities |
|----------|-------|-----------------|
| Data Quality & Dedup | 10 | Person/place/cat/address/request merge, review queues |
| Intake & Forms | 6 | Form templates, custom fields, preview, Airtable sync |
| Data Engine | 8 | Identity resolution, households, processor status, health metrics |
| Entity Management | 5 | Organizations, partner orgs, colonies |
| Beacon & Ecology | 6 | Colony estimates, reproduction, mortality, seasonal, forecasts |
| Email | 7 | Templates, jobs, batches, audit, settings |
| Clinical & Ingest | 5 | Clinic days, batch uploads, AI extraction, disease config |
| Review & QA | 6 | Quality queues, identity review, AI extraction review |
| Configuration | 8 | Staff, departments, equipment, knowledge base, auth |
| External Integrations | 8+ | Tippy AI, Google Maps sync, Linear integration |
| Operational Monitoring | 8+ | Trapper linking, role audit, automations, test mode |

### Gaps for Beacon
- **No user role management UI** — Roles exist but no admin page to manage permissions
- **No onboarding flow** — No guided setup for new staff members
- **No audit log UI** — Entity edits tracked in DB but no browse/search interface
- **No form builder** — Custom fields exist but no drag-and-drop form construction (planned FFS-497)

---

## External / Public-Facing

### Current State — ⚠️ MINIMAL

- **Login page** — Public (`/login`)
- **Public intake API** — CORS-enabled endpoint for external form submissions
- **Volunteer portal** — `/volunteer` (auth required, limited dashboard)

### Gaps for Beacon
- **No public-facing map** (Spec P3, but critical for gala demo May 30)
- **No "Report a Cat Sighting" page** (exists in sonoma-cat-tracker app, not Atlas)
- **No About/FAQ page**
- **No confirmation/thank-you flow after reporting**
- **No donor engagement features**
- **No community awareness content**

---

## Trapper Management

### Current State — ✅ STRONG

- **Trapper list** with tier classification (Tier 1: FFSC, Tier 2: Community, Tier 3: Unofficial)
- **Trapper profiles** with `sot.trapper_profiles` (type, rescue name, contract status, service places)
- **Request assignment** via `request_trapper_assignments` table
- **Trapper sheet** — Print-ready field assignment sheet
- **Observations** — Community trapper observation logging
- **Onboarding flow** — `/trappers/onboarding`
- **Training materials** — `/trappers/materials`
- **Equipment tracking** — `/admin/equipment`

### Gaps for Beacon
- **No trapper mobile app/portal** — Trappers can't log data from the field
- **No GPS tracking** for trap deployments
- **No real-time status updates** from field to office

---

## Email & Communications

### Current State — ✅ BUILT
- Template-based email system
- Batch sending capability
- Email audit log
- Job queue management
- AI-suggested templates

### Gaps for Beacon
- **No SMS/text integration** (many people prefer text)
- **No automated follow-ups** (e.g., post-service survey)
- **No Outlook integration for intake** (Jami's pain point: transcribing voicemails)

---

## AI / Tippy Integration

### Current State — ⚠️ BUILT BUT UNDERUSED
- **Tippy drafts** — AI-suggested data corrections
- **Tippy conversations** — Chat about corrections
- **Tippy feedback** — Feedback loop on suggestions
- **Tippy gaps** — AI-identified data gaps
- **Tippy signals** — Alerts/signals from AI analysis
- **AI extraction** — Extract data from documents

### Gaps for Beacon
- **No conversational AI assistant** (the spec mentions "Tippy, AI Assistant" as a page)
- **No natural language search** (e.g., "show me all places with FeLV in Petaluma")
- **No AI-powered intake triage** (auto-categorize calls based on description)

---

## Gap Summary & Recommended Linear Issues

### Critical Gaps (P0 — Must Have for Beacon)

| # | Gap | Impact | Recommended Issue |
|---|-----|--------|-------------------|
| 1 | **No date-range filter on map** | Can't view historical data by time period | Create issue: "Add date-range picker to Atlas Map" |
| 2 | **No scenario comparison tool** | Can't demonstrate TNR strategy effectiveness | Create issue: "Build population scenario comparison UI" |
| 3 | **No population forecast projection** | Can't show 10-year impact curves | Create issue: "Implement population projection engine + UI" |
| 4 | **No county-level alteration rollup** | Can't show address → county cascading impact | Create issue: "Add county/zone-level alteration aggregation" |
| 5 | **No location comparison** | Can't compare 2 places/zones side-by-side | Create issue: "Build location comparison view" |
| 6 | **No fullscreen map mode** | Missing basic map UX requirement | Create issue: "Add fullscreen toggle to Atlas Map" |

### High Gaps (P1 — First Sprint Post-Launch)

| # | Gap | Impact | Recommended Issue |
|---|-----|--------|-------------------|
| 7 | **No population curve visualization** | Can't show growth/decline charts | Create issue: "Population growth/decline charts with intervention lines" |
| 8 | **No seasonal forecasting** | Can't predict kitten season severity | Create issue: "Implement seasonal breeding forecast from ecology config" |
| 9 | **No global data quality dashboard** | Can't assess overall data trustworthiness | Create issue: "Build data quality dashboard with completeness metrics" |
| 10 | **Colony size heatmap** | No cold-to-warm visual for colony density | Create issue: "Add heatmap layer for colony size" |

### Medium Gaps (P2 — Second Sprint)

| # | Gap | Impact | Recommended Issue |
|---|-----|--------|-------------------|
| 11 | **No public-facing map** | Can't show demo at gala | Create issue: "Build read-only public map view" |
| 12 | **No map drill-down hierarchy** | Can't navigate county → zone → cluster → address | Create issue: "Implement hierarchical map drill-down" |
| 13 | **No time-period comparison** | Can't show year-over-year on map | Create issue: "Add temporal comparison to map view" |
| 14 | **No keyboard shortcuts** | Missing UX polish per spec | Create issue: "Add keyboard shortcuts to map (Cmd+K search, etc.)" |

### Low Gaps (P3 — Fast Follow)

| # | Gap | Impact |
|---|-----|--------|
| 15 | No partner org data ingestion pipeline |
| 16 | No trap inventory check-in/check-out |
| 17 | No financial impact model |
| 18 | No cross-species data overlay |
| 19 | No white-label deployment (architecture being prepared) |
| 20 | No design system alignment (Beacon brand colors, typography, spacing) |

---

## Design System Alignment

### Current Atlas
- **Framework:** shadcn/ui + Tailwind CSS
- **Colors:** Default Tailwind palette, no brand alignment
- **Typography:** System fonts, no Questrial/Raleway/DM Sans
- **Spacing:** Tailwind default (not 8px base unit system)

### Beacon Spec Requirements
- **Primary:** Brand Blue #4291df
- **Secondary:** Teal #55c2bf, Yellow #E1C942, Purple #7F57A8, Light Blue #A0D3F1
- **Semantic:** Red #E73232, Orange #E77732, Green #5DB01B
- **Background:** #faf9f5 (warm white)
- **Headings:** Questrial or Raleway
- **Body:** DM Sans or Mulish
- **Spacing:** 8px base unit system

### Alignment Work Needed
- Define CSS custom properties for Beacon brand colors
- Import Google Fonts (Questrial/Raleway + DM Sans)
- Update Tailwind config with Beacon color tokens
- Review and update spacing across components
- This should be a separate design system issue, NOT mixed with feature work

---

## User Personas — Atlas Coverage

| Persona | Beacon Spec | Atlas Coverage |
|---------|-------------|----------------|
| **FFSC Leadership (Pip)** | Population forecasting, analytics, donor storytelling | ⚠️ Beacon dashboard exists but no forecasting/scenarios |
| **FFSC Intake Coordinator (Jami)** | "One ramp onto the freeway" — call → map → context → book | ⚠️ Intake works but requires ClinicHQ for booking |
| **FFSC Trapping Coordinator (Ben)** | Data-driven trapper assignment, clean database | ✅ Strong — request management, trapper assignment |
| **FFSC Volunteer Coordinator (Bridget)** | Volunteer targeting, event management | ❌ Minimal — no volunteer management features |
| **FFSC Clinician/Vet Staff** | Cat medical records, masterlist, real-time updates | ⚠️ Cat records exist, no real-time clinic workflow |
| **Trapper Volunteer** | Field data entry, trap management | ⚠️ Observer page exists, no mobile field app |
| **Community Requester** | Submit sighting, learn about TNR, track request | ⚠️ Public intake API exists, no status tracking portal |
| **Colony Caretaker** | Colony management, food tracking | ❌ No caretaker portal |
| **Wildlife Enthusiast** | Cross-species data, ecological impact | ❌ No wildlife data |
| **Environmentalist** | Environmental impact storytelling | ❌ No environmental data |

---

*This document should be updated as alignment work progresses. Each gap should have a corresponding Linear issue before work begins.*
