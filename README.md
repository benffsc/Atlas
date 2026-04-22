# Atlas

**TNR Management System for Forgotten Felines of Sonoma County**

Atlas is the operational backbone for FFSC's Trap-Neuter-Return program, tracking cats, locations, requests, and clinic operations across Sonoma County.

**Live at:** [atlas.forgottenfelines.com](https://atlas.forgottenfelines.com)

---

## Current Status (March 2026)

| Phase | Status |
|-------|--------|
| V2 Data Overhaul | ✅ Complete |
| E2E Test Stabilization | 🔄 In Progress |
| Production Ready | ⏳ Upcoming |

**Recent milestones:**
- 3-layer data architecture deployed (source → ops → sot)
- Entity linking pipeline with monitoring
- API standardization complete
- 592/1132 E2E tests passing (stabilization in progress)

---

## What Atlas Does

### For Staff
- **Unified Search** — Find cats, people, places by microchip, phone, address, or name
- **Intake Queue** — Process public TNR submissions through triage, scheduling, and conversion to requests
- **Request Management** — Track TNR requests from intake to completion
- **Clinic Operations** — Schedule clinic days, process ClinicHQ data
- **Data Quality** — Review queues for duplicates, uncertain matches

### For Trappers
- **Location Info** — Safety notes, access details, cat counts per location
- **Assignment Tracking** — Which requests are assigned, scheduled, in progress

### For Beacon (Analytics)
- **Population Modeling** — Colony estimates using Chapman mark-recapture
- **TNR Progress** — Alteration rates by location and service zone
- **Disease Tracking** — FeLV/FIV prevalence by geographic area

---

## Architecture

Atlas uses a **3-layer data architecture** to ensure data quality and full auditability:

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: SOURCE                                             │
│ Raw data from external systems (immutable audit trail)      │
│ Tables: source.staged_records, source.clinichq_raw          │
└─────────────────────────────────────────────────────────────┘
                    ↓ Data Engine (Identity Resolution)
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: OPS                                                │
│ Operational workflows, staff-facing data                    │
│ Tables: ops.appointments, ops.clinic_accounts               │
└─────────────────────────────────────────────────────────────┘
                    ↓ Entity Linking
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: SOT (Source of Truth)                              │
│ Canonical deduplicated entities                             │
│ Tables: sot.people, sot.cats, sot.places, sot.requests      │
└─────────────────────────────────────────────────────────────┘
                    ↓ Analytics
┌─────────────────────────────────────────────────────────────┐
│ BEACON                                                      │
│ Population modeling, TNR prioritization                     │
│ Views: ops.v_beacon_summary, beacon.colony_estimates        │
└─────────────────────────────────────────────────────────────┘
```

### Data Sources

| System | What It Provides | Authority |
|--------|------------------|-----------|
| **ClinicHQ** | Appointments, microchips, medical records | Cats, procedures |
| **VolunteerHub** | Trappers, volunteers, group memberships | Volunteer status |
| **ShelterLuv** | Adoptions, foster data, outcomes | Program animals |
| **Airtable** | Legacy requests, Project 75 | Historical data |
| **Web Intake** | Public TNR request submissions | New requests |

---

## Quick Start

```bash
# Clone and install
git clone <repo>
cd Atlas
npm install
cd apps/web && npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with DATABASE_URL, GOOGLE_PLACES_API_KEY, etc.

# Start dev server
npm run dev
# Open http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `STAFF_DEFAULT_PASSWORD` | Yes | Default password for new staff |
| `GOOGLE_PLACES_API_KEY` | Yes | For geocoding and address validation |
| `ANTHROPIC_API_KEY` | No | For Tippy AI assistant |

See `apps/web/.env.example` for complete list.

---

## Core Invariants

These rules are non-negotiable. Breaking them causes cascading data quality issues.

1. **No Data Disappears** — Use `merged_into_*` chains, never hard delete
2. **Manual > AI** — Staff-verified data cannot be overwritten by automation
3. **Identity By Identifier Only** — Match people by email/phone, NEVER by name alone
4. **Merge-Aware Queries** — All queries MUST filter `merged_into_*_id IS NULL`
5. **Provenance Required** — Every record needs `source_system`, `source_record_id`, `source_created_at`
6. **Centralized Functions** — Never INSERT directly to `sot.*` tables; use `find_or_create_*` functions

**Full invariants:** See `CLAUDE.md` in repo root.

---

## Address Input Standards

All address fields that write to the database MUST use the `PlaceResolver` component (`@/components/forms/PlaceResolver`). Plain `<input>` fields allow bad data — PlaceResolver validates against both existing Atlas places and Google Places API.

| Component | Use Case |
|-----------|----------|
| **PlaceResolver** | Any form creating/linking a place (requests, intake, org creation, map panel, redirects) |
| **AddressAutocomplete** | ONLY for correcting an existing place's address (needs raw Google Place Details for lat/lng/components) |
| **Plain `<input>`** | ONLY for non-address text (feeding location descriptions) or print-only forms |

**Resilience:** `usePlaceResolver` uses `Promise.allSettled` for parallel Atlas + Google search. If Google's API fails (expired key, quota), Atlas results still appear. See FFS-117.

**Coverage (16 PlaceResolver fields):** `/requests/new`, `/intake/call-sheet`, `/intake/queue`, `/intake` (2x), `/intake/queue/new`, `/admin/intake/call`, `/places/new`, `/people/[id]`, `/admin/colonies/[id]`, `/admin/organizations` (create modal), `/components/map/PlacementPanel`, `/components/modals/RedirectRequestModal`, `/components/modals/HandoffRequestModal`

---

## Cat Determining System (CDS)

CDS is the 12-phase pipeline that matches paper master list entries (the handwritten surgery log) to ClinicHQ digital bookings. This is how Atlas knows "line 7 on the paper = appointment for Mr. Whiskers."

**Key concept: Validate-Before-Commit.** CDN (Clinic Day Number) assignments are proposed as candidates, validated against the master list, and only committed when verified. Waiver OCR misreads ~5% of clinic numbers — this prevents bad CDNs from cascading.

```
Phase 0-0.5:  Assembly + Appointment Dedup
Phase 1:      CDN Candidates (waiver chip + weight bridge → validate → commit)
Phase 2-3:    Cancelled Detection + CDN-First Matching
Phase 4-6:    SQL Deterministic + Shelter ID Bridge + Waiver Bridge
Phase 7:      Composite Scoring (8 signals, foster-aware)
Phase 8:      Weight Disambiguation (sex-partitioned)
Phase 9-10:   Constraint Propagation + LLM Tiebreaker
Phase 11-12:  Propagate Matches + Classify Unmatched
```

**Full docs:** [`docs/CDS_PIPELINE.md`](docs/CDS_PIPELINE.md)

**Quick test (read-only, no writes):**
```bash
npx tsx scripts/cds-candidate-diff.ts 2026-04-06   # Single date
npx tsx scripts/cds-candidate-diff.ts --all         # All ground truth dates
```

---

## Known Pitfalls

### ClinicHQ Data ≠ People Data
ClinicHQ tells us about **CATS and PLACES**, not necessarily people. The person who booked an appointment is often a trapper or caretaker, not where the cat lives.

- **46.5%** of person links are unreliable (trappers, caretakers, FFSC staff)
- **Place is the anchor** — Show cats on map via place, NOT person→place chain

### Phone Matching Requires Address Check
Never match people by phone alone across different addresses. Same phone + different address = household members, not same person.

### PetLink Emails Are Fabricated
Always filter `confidence >= 0.5` when querying `person_identifiers`. PetLink generates fake emails.

### Cell Phones Are Shared
Always use `COALESCE(Owner Phone, Owner Cell Phone)` — cell phones are often shared by household members.

---

## Directory Structure

```
Atlas/
├── apps/web/               # Next.js application
│   ├── src/app/            # Pages and API routes
│   ├── src/components/     # React components
│   │   └── intake/         # Intake queue components (FFS-107–112)
│   │       ├── IntakeQueueRow.tsx      # Table row with actions
│   │       ├── IntakeDetailPanel.tsx   # Side panel for submission detail
│   │       ├── IntakeBadges.tsx        # Status/triage badge components
│   │       ├── ContactLogModal.tsx     # Communication log modal
│   │       ├── BookingModal.tsx        # Appointment booking modal
│   │       └── DeclineModal.tsx        # Decline submission modal
│   ├── src/lib/            # Utilities, types, DB helpers
│   │   └── intake-types.ts # Shared intake types & constants
│   └── e2e/                # Playwright E2E tests
├── sql/schema/v2/          # Database migrations (253 files)
├── scripts/pipeline/       # Data quality scripts
├── docs/                   # Documentation
└── CLAUDE.md               # Development rules (START HERE)
```

---

## Key Documentation

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` | **START HERE** — All development rules and invariants |
| `docs/CDS_PIPELINE.md` | Cat Determining System — 12-phase matching pipeline |
| `docs/CENTRALIZED_FUNCTIONS.md` | Function signatures for entity operations |
| `docs/DATA_FLOW_ARCHITECTURE.md` | How data moves through the system |
| `docs/INGEST_GUIDELINES.md` | Rules for data ingestion |

---

## Testing

```bash
# Fast tests (no API costs)
npm run test:e2e

# Specific file
npx playwright test e2e/ui-workflows.spec.ts --debug

# Full suite (includes Tippy, uses Claude credits)
npm run test:e2e:full
```

---

## Ground Truth Principle

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.**

- FFSC clinic data = verified alterations (ground truth)
- Chapman mark-recapture: `N = ((M+1)(C+1)/(R+1)) - 1`
- 75% TNR intensity → 70% population reduction in 6 years

---

## Future Scope

### Near Term (E2E Stabilization)
- Fix remaining test failures (~340 tests)
- Deploy missing database views
- Entity linking fortification

### Medium Term
- Real-time ClinicHQ sync (vs batch upload)
- Mobile-friendly trapper interface
- Automated scheduling suggestions

### Long Term (Beacon Full)
- Predictive colony growth modeling
- Resource allocation optimization
- Cross-county data sharing

---

## Contributing

1. Read `CLAUDE.md` first — it contains all development rules
2. Check Linear for current issues: [linear.app/ffsc/project/atlas](https://linear.app/ffsc)
3. Use centralized functions; never INSERT directly to `sot.*` tables
4. Run E2E tests before submitting PRs

---

*Atlas: Making TNR data trustworthy, powering Beacon for strategic prioritization.*
