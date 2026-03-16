# Atlas Architecture Diagrams

Visual overview of the Atlas system for quick reference.

---

## Executive Summary

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County. It tracks:

| Entity | Count | Purpose |
|--------|-------|---------|
| **People** | ~15,000 | Requesters, trappers, volunteers, staff |
| **Cats** | ~8,000 | With microchips, clinic visits, medical records |
| **Places** | ~3,000 | Addresses where cats are located |
| **Requests** | ~2,500 | TNR service requests |
| **Intake** | ~1,200 | Web form submissions pending review |

**Key Value**: Unifies data from Airtable, ClinicHQ, JotForm, and web forms into a single source of truth with identity resolution.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ATLAS SYSTEM                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│  │   PEOPLE    │   │    CATS     │   │   PLACES    │   │  REQUESTS   │    │
│  │   ~15,000   │   │   ~8,000    │   │   ~3,000    │   │   ~2,500    │    │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘    │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                                    │                                        │
│                          ┌─────────▼─────────┐                             │
│                          │  RELATIONSHIPS    │                             │
│                          │  person↔cat       │                             │
│                          │  person↔place     │                             │
│                          │  cat↔place        │                             │
│                          │  request↔place    │                             │
│                          │  request↔trapper  │                             │
│                          └───────────────────┘                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## High-Level Data Flow (For Stakeholders)

```
                    ┌─────────────────────────────────────────────────────────┐
                    │               HOW DATA ENTERS ATLAS                      │
                    └─────────────────────────────────────────────────────────┘

    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
    │   PUBLIC     │     │   AIRTABLE   │     │   CLINICHQ   │     │   STAFF      │
    │   WEBSITE    │     │   (Legacy)   │     │   (Clinic)   │     │   MANUAL     │
    └──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
           │                    │                    │                    │
           │  Web Intake        │  JotForm Data      │  XLSX Exports      │  UI Entry
           │  Form              │  Sync (Cron)       │  (Upload)          │
           │                    │                    │                    │
           └────────────────────┴────────────────────┴────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                  IDENTITY RESOLUTION                     │
                    │   "Is this person/cat/place already in the system?"     │
                    │                                                         │
                    │   • Match by EMAIL (unique identifier)                  │
                    │   • Match by PHONE (10-digit normalized)                │
                    │   • Match by MICROCHIP (for cats)                       │
                    │   • Match by ADDRESS (Google geocoding)                 │
                    │                                                         │
                    │   RESULT: Either link to existing OR create new         │
                    └─────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │              SOURCE OF TRUTH (SoT)                       │
                    │                                                         │
                    │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
                    │   │ PEOPLE  │  │  CATS   │  │ PLACES  │  │REQUESTS │   │
                    │   │ (Canon) │  │ (Canon) │  │ (Canon) │  │ (Canon) │   │
                    │   └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
                    │                                                         │
                    │   • Single version of truth                             │
                    │   • Merged duplicates preserved for audit               │
                    │   • Full history tracking                               │
                    └─────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                     ATLAS WEB UI                         │
                    │   Dashboard • Intake Queue • People • Cats • Places     │
                    └─────────────────────────────────────────────────────────┘
```

---

## Three-Layer Data Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        THE THREE-LAYER MODEL                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LAYER 1: RAW DATA (Immutable)                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  staged_records                                                         │ │
│  │  • Every imported record preserved exactly as received                  │ │
│  │  • NEVER modified - permanent audit trail                               │ │
│  │  • Includes: source_system, source_table, payload (JSONB), timestamp   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  LAYER 2: IDENTITY RESOLUTION                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  sot.person_identifiers  sot.cat_identifiers    geocode_cache           │ │
│  │  • email (normalized)    • microchip           • Google Place ID       │ │
│  │  • phone (10-digit)      • clinichq_id         • formatted_address     │ │
│  │                          • shelterluv_id                                │ │
│  │                                                                         │ │
│  │  UNIQUE CONSTRAINTS ensure same identifier = same entity                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  LAYER 3: SOURCE OF TRUTH (Canonical)                                        │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  sot.people  sot.cats  sot.places  ops.requests  ops.appointments     │ │
│  │                                                                         │ │
│  │  • Deduplicated entities with merge tracking                            │ │
│  │  • merged_into_* column points to canonical record                      │ │
│  │  • Full relationship graph                                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            ATLAS DATA FLOW - COMPLETE                                │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│ PUBLIC                                                                               │
│ INTAKE                  ┌─────────────────────────────────────────────────────────┐ │
│                         │                                                         │ │
│  ┌──────────┐          │   ops.web_intake_submissions                             │ │
│  │ JotForm  │──────────┼─▶ • Contact info (name, email, phone)                    │ │
│  │   OR     │          │   • Cat location (address, city, zip)                    │ │
│  │ Website  │          │   • Cat details (count, fixed status, kittens)           │ │
│  └──────────┘          │   • Situation (emergency, medical, property access)      │ │
│                         │   • custom_fields (JSONB - admin-defined questions)     │ │
│                         │                                                         │ │
│                         │   AUTO-TRIAGE ───┐                                      │ │
│                         │   • triage_score  │  Based on urgency indicators        │ │
│                         │   • triage_reasons│  (kittens, emergency, medical)      │ │
│                         │   • triage_category  high_priority / standard / etc.    │ │
│                         └──────────┬──────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    ▼                                                 │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │  INTAKE QUEUE (Staff Reviews)                           │ │
│                         │                                                         │ │
│                         │  status: new → in_progress → scheduled → complete       │ │
│                         │           └────────────────────────────────────▶ archived│
│                         │                                                         │ │
│                         │  Staff Actions:                                         │ │
│                         │  • Add notes (journal system)                           │ │
│                         │  • Contact requester (log attempts)                     │ │
│                         │  • Correct address (Google autocomplete)                │ │
│                         │  • Convert to Request (when approved)                   │ │
│                         └──────────┬──────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    ▼                                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ IDENTITY                                                                             │
│ RESOLUTION              ┌─────────────────────────────────────────────────────────┐ │
│                         │   find_or_create_person(email, phone, name)             │ │
│                         │                                                         │ │
│                         │   1. Normalize: email→lowercase, phone→10digits         │ │
│                         │   2. Check email match → if found, verify name          │ │
│                         │   3. Check phone match → if found, verify name          │ │
│                         │   4. Name similar? → Link to existing                   │ │
│                         │   5. Name different? → Create new, flag duplicate       │ │
│                         │   6. No match? → Create new person                      │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   find_or_create_place_deduped(address, lat, lng)       │ │
│                         │                                                         │ │
│                         │   1. Normalize address text                             │ │
│                         │   2. Check Google geocode cache                         │ │
│                         │   3. Match existing? → Return existing place_id         │ │
│                         │   4. New? → Queue for geocoding → Create place          │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   find_or_create_cat_by_microchip(chip, name, sex)      │ │
│                         │                                                         │ │
│                         │   1. Lookup by microchip (UNIQUE identifier)            │ │
│                         │   2. Found? → Update with new info, return existing     │ │
│                         │   3. New? → Create cat record                           │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ SOURCE OF                                                                            │
│ TRUTH                   ┌─────────────────────────────────────────────────────────┐ │
│                         │                     sot.people                          │ │
│                         │   person_id │ display_name │ merged_into │ source       │ │
│                         │   ──────────┼──────────────┼─────────────┼──────────    │ │
│                         │   uuid-123  │ Sarah Jones  │ NULL        │ web_intake   │ │
│                         │   uuid-456  │ Sarah J.     │ uuid-123    │ airtable     │ │
│                         │                            ▲                            │ │
│                         │                            │ MERGED (points to canon)   │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    ▼                                                 │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │                   RELATIONSHIPS                         │ │
│                         │                                                         │ │
│                         │   sot.person_place             sot.person_cat           │ │
│                         │   ├─ requester                 ├─ owner                 │ │
│                         │   ├─ property_owner            ├─ caretaker             │ │
│                         │   └─ feeder                    └─ brought_by            │ │
│                         │                                                         │ │
│                         │   sot.cat_place                request_trapper_assign.  │ │
│                         │   ├─ resident                  ├─ is_primary: true      │ │
│                         │   ├─ trapped_at                ├─ assigned_at           │ │
│                         │   └─ appointment_site          └─ unassigned_at         │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ AIRTABLE                                                                             │
│ SYNC                    ┌─────────────────────────────────────────────────────────┐ │
│                         │   Airtable "Atlas Sync" Base                            │ │
│                         │   ├─ Public Intake Submissions (JotForm)                │ │
│                         │   └─ Sync Status tracking                               │ │
│                         └──────────┬──────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    │  Cron Job (Daily 6am UTC)                       │
│                                    │  /api/cron/airtable-sync                        │
│                                    │  • Batch size: 100 records                      │ │
│                                    │  • Marks synced in Airtable                     │ │
│                                    ▼                                                 │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   ops.web_intake_submissions (intake_source='airtable') │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ CLINICHQ                                                                             │
│ INGEST                  ┌─────────────────────────────────────────────────────────┐ │
│                         │   ClinicHQ XLSX Exports (Manual Upload)                 │ │
│                         │                                                         │ │
│                         │   Upload Order (IMPORTANT):                             │ │
│                         │   1. cat_info.xlsx      → Updates cat sex data          │ │
│                         │   2. owner_info.xlsx    → Links people to appointments  │ │
│                         │   3. appointment_info   → Creates procedures            │ │
│                         └──────────┬──────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    ▼                                                 │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   staged_records (source_system='clinichq')             │ │
│                         │   • Raw XLSX data preserved                             │ │
│                         └──────────┬──────────────────────────────────────────────┘ │
│                                    │                                                 │
│                                    ▼                                                 │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   Processing Pipeline                                   │ │
│                         │                                                         │ │
│                         │   1. find_or_create_cat_by_microchip()                  │ │
│                         │      └─▶ sot.cats (with altered_status)                 │ │
│                         │                                                         │ │
│                         │   2. Create cat_procedures                              │ │
│                         │      └─▶ spay/neuter based on service_type + sex        │ │
│                         │                                                         │ │
│                         │   3. Create ops.appointments                            │ │
│                         │      └─▶ Links cat, person, place, date                 │ │
│                         │                                                         │ │
│                         │   4. link_appointment_cats_to_places()                  │ │
│                         │      └─▶ sot.cat_place (appointment_site)               │ │
│                         │                                                         │ │
│                         │   5. link_appointments_to_trappers()                    │ │
│                         │      └─▶ ops.appointments.trapper_person_id             │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ REQUEST                                                                              │
│ WORKFLOW                ┌─────────────────────────────────────────────────────────┐ │
│                         │                    ops.requests                         │ │
│                         │                                                         │ │
│                         │   [NEW] ─▶ [TRIAGED] ─▶ [SCHEDULED] ─▶ [IN_PROGRESS]   │ │
│                         │     │         │              │              │           │ │
│                         │     │         │              │              ▼           │ │
│                         │     │         │              │         [COMPLETED]      │ │
│                         │     │         │              │              │           │ │
│                         │     ▼         ▼              ▼              ▼           │ │
│                         │   [CANCELLED]          [ON_HOLD]      resolved_at set   │ │
│                         │                            │                            │ │
│                         │                            ▼                            │ │
│                         │                     (waiting on                         │ │
│                         │                      permission,                        │ │
│                         │                      weather, etc.)                     │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
│                         ┌─────────────────────────────────────────────────────────┐ │
│                         │   request_trapper_assignments (Many-to-Many)            │ │
│                         │                                                         │ │
│                         │   request_id │ trapper_id │ is_primary │ assigned_at    │ │
│                         │   ───────────┼────────────┼────────────┼─────────────   │ │
│                         │   req-001    │ kim-123    │ TRUE       │ 2025-01-10     │ │
│                         │   req-001    │ jami-456   │ FALSE      │ 2025-01-10     │ │
│                         │                                                         │ │
│                         │   Supports: multiple trappers, full history tracking    │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ CAT                                                                                  │
│ ATTRIBUTION             ┌─────────────────────────────────────────────────────────┐ │
│ (TNR Metrics)           │   v_request_alteration_stats (Rolling Window System)    │ │
│                         │                                                         │ │
│                         │   "Which cats count toward this request's TNR numbers?" │ │
│                         │                                                         │ │
│                         │   WINDOW TYPES:                                         │ │
│                         │   ┌────────────────────────────────────────────────────┐│ │
│                         │   │ Legacy (<May 2025)                                 ││ │
│                         │   │ source_created_at ± 6 months (fixed window)        ││ │
│                         │   ├────────────────────────────────────────────────────┤│ │
│                         │   │ Resolved (completed/cancelled)                     ││ │
│                         │   │ resolved_at + 3 months (grace period)              ││ │
│                         │   ├────────────────────────────────────────────────────┤│ │
│                         │   │ Active (ongoing)                                   ││ │
│                         │   │ NOW() + 6 months (rolls forward)                   ││ │
│                         │   └────────────────────────────────────────────────────┘│ │
│                         │                                                         │ │
│                         │   MATCHING (within window):                             │ │
│                         │   • request_cat_links (explicit)                        │ │
│                         │   • sot.cat_place (same place)                          │ │
│                         │   • sot.person_cat (requester knows cat)                │ │
│                         │                                                         │ │
│                         │   OUTPUT: cats_caught, cats_altered, alteration_rate    │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│ GEOCODING               ┌─────────────────────────────────────────────────────────┐ │
│ PIPELINE                │   Address → Geocode → Deduplicate → Canonical Place     │ │
│                         │                                                         │ │
│                         │   1. Raw address entered (intake form, manual)          │ │
│                         │      └─▶ Added to geocoding_queue                       │ │
│                         │                                                         │ │
│                         │   2. Cron job processes queue (daily 7am UTC)           │ │
│                         │      └─▶ /api/cron/geocode (batch: 50)                  │ │
│                         │                                                         │ │
│                         │   3. Google Geocoding API                               │ │
│                         │      └─▶ Returns: lat, lng, formatted_address           │ │
│                         │      └─▶ Cached in geocode_cache (15 min TTL)           │ │
│                         │                                                         │ │
│                         │   4. Duplicate detection                                │ │
│                         │      └─▶ Same Google Place ID = merge places            │ │
│                         │                                                         │ │
│                         │   5. geo_confidence assigned                            │ │
│                         │      • exact (ROOFTOP)                                  │ │
│                         │      • high (RANGE_INTERPOLATED)                        │ │
│                         │      • medium (GEOMETRIC_CENTER)                        │ │
│                         │      • low (APPROXIMATE)                                │ │
│                         └─────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          ENTITY RELATIONSHIPS                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │    sot.people    │
                              │                  │
                              │  person_id (PK)  │
                              │  display_name    │
                              │  first_name      │
                              │  last_name       │
                              │  merged_into_*   │
                              └────────┬─────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│sot.person_idents │       │  sot.person_roles│       │sot.person_place  │
│                  │       │                  │       │                  │
│ id_type (email/  │       │ role (trapper,   │       │ role (requester, │
│   phone)         │       │   foster, staff) │       │   feeder,        │
│ id_value_norm    │       │ trapper_type     │       │   property_owner)│
│ UNIQUE constraint│       │ role_status      │       │                  │
└──────────────────┘       └──────────────────┘       └────────┬─────────┘
                                                               │
                                                               │
                                                               ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│    sot.cats      │◄─────▶│sot.cat_place     │◄─────▶│   sot.places     │
│                  │       │                  │       │                  │
│  cat_id (PK)     │       │ type (resident,  │       │  place_id (PK)   │
│  display_name    │       │   trapped_at,    │       │  display_name    │
│  sex             │       │   appointment_   │       │  formatted_addr  │
│  altered_status  │       │   site)          │       │  lat, lng        │
│  merged_into_*   │       │                  │       │  merged_into_*   │
└────────┬─────────┘       └──────────────────┘       └────────┬─────────┘
         │                                                      │
         │                                                      │
         ▼                                                      ▼
┌──────────────────┐                              ┌──────────────────┐
│sot.cat_identfrs  │                              │   ops.requests   │
│                  │                              │                  │
│ id_type (micro-  │                              │  request_id (PK) │
│   chip, etc.)    │                              │  status          │
│ id_value         │                              │  priority        │
│ UNIQUE constraint│                              │  place_id (FK)   │
└──────────────────┘                              │  requester_id    │
         │                                        │  resolved_at     │
         │                                        └────────┬─────────┘
         ▼                                                 │
┌──────────────────┐                              ┌────────▼─────────┐
│  cat_procedures  │                              │request_trapper_  │
│                  │                              │  assignments     │
│ procedure_type   │                              │                  │
│ procedure_date   │                              │ trapper_id (FK)  │
│ is_spay/neuter   │                              │ is_primary       │
└──────────────────┘                              │ assigned_at      │
                                                  └──────────────────┘


                    ┌──────────────────────────────────────────┐
                    │      ops.web_intake_submissions          │
                    │                                          │
                    │  submission_id (PK)                      │
                    │  contact: first_name, email, phone       │
                    │  location: cats_address, city, zip       │
                    │  triage: score, category, reasons        │
                    │  status: new → ... → complete            │
                    │                                          │
                    │  matched_person_id ─────────────────────▶│ sot.people
                    │  matched_place_id  ─────────────────────▶│ places
                    │  created_request_id ────────────────────▶│ ops.requests
                    └──────────────────────────────────────────┘
```

---

## Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CORE TABLES                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐                      │
│  │    sot.people       │      │     sot.cats        │                      │
│  ├─────────────────────┤      ├─────────────────────┤                      │
│  │ person_id (PK)      │      │ cat_id (PK)         │                      │
│  │ display_name        │      │ display_name        │                      │
│  │ first_name/last     │      │ sex                 │                      │
│  │ merged_into_person  │      │ altered_status      │                      │
│  │ source_system       │      │ merged_into_cat     │                      │
│  └─────────────────────┘      └─────────────────────┘                      │
│                                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐                      │
│  │    sot.places       │      │    ops.requests     │                      │
│  ├─────────────────────┤      ├─────────────────────┤                      │
│  │ place_id (PK)       │      │ request_id (PK)     │                      │
│  │ display_name        │      │ status              │                      │
│  │ formatted_address   │      │ priority            │                      │
│  │ latitude/longitude  │      │ place_id (FK)       │                      │
│  │ merged_into_place   │      │ requester_person_id │                      │
│  │ geo_confidence      │      │ resolved_at         │                      │
│  └─────────────────────┘      └─────────────────────┘                      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                        RELATIONSHIP TABLES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │sot.person_cat           │  │sot.person_place          │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ person_id (FK)          │  │ person_id (FK)          │                  │
│  │ cat_id (FK)             │  │ place_id (FK)           │                  │
│  │ relationship_type       │  │ role                    │                  │
│  │ confidence              │  │ confidence              │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │ sot.cat_place           │  │request_trapper_assign.  │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ cat_id (FK)             │  │ request_id (FK)         │                  │
│  │ place_id (FK)           │  │ trapper_person_id (FK)  │                  │
│  │ relationship_type       │  │ is_primary              │                  │
│  └─────────────────────────┘  │ assigned_at/unassigned  │                  │
│                               └─────────────────────────┘                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         IDENTITY TABLES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │  sot.person_identifiers │  │   sot.cat_identifiers   │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ person_id (FK)          │  │ cat_id (FK)             │                  │
│  │ id_type (email/phone)   │  │ id_type (microchip)     │                  │
│  │ id_value_norm           │  │ id_value                │                  │
│  │ UNIQUE(type,value_norm) │  │ UNIQUE(type, value)     │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           AUDIT TABLES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │     staged_records      │  │   entity_merge_history  │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ source_system           │  │ entity_type             │                  │
│  │ source_table            │  │ source_entity_id        │                  │
│  │ payload (JSONB)         │  │ target_entity_id        │                  │
│  │ created_at              │  │ merged_by, merged_at    │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Views

| View | Purpose |
|------|---------|
| `v_request_alteration_stats` | Per-request TNR metrics with rolling windows |
| `v_place_alteration_history` | Per-location TNR progress over time |
| `v_trapper_full_stats` | Comprehensive trapper performance metrics |
| `v_intake_triage_queue` | Submissions awaiting review |
| `v_canonical_people` | People not merged (active records) |
| `v_canonical_cats` | Cats not merged (active records) |
| `v_canonical_places` | Places not merged (active records) |
| `v_search_sot_unified` | Unified typeahead search across entities |
| `v_place_colony_status` | Weighted colony size estimates |

---

## Critical Functions (MUST USE)

| Function | Purpose | Never Do Instead |
|----------|---------|------------------|
| `find_or_create_person()` | Create/match person by email/phone | Direct INSERT into sot.people |
| `find_or_create_place_deduped()` | Create/match place with geocoding | Direct INSERT into sot.places |
| `find_or_create_cat_by_microchip()` | Create/match cat by microchip | Direct INSERT into sot.cats |
| `merge_people()` | Merge duplicate people | UPDATE merged_into directly |
| `merge_places()` | Merge duplicate places | UPDATE merged_into directly |
| `merge_cats()` | Merge duplicate cats | UPDATE merged_into directly |
| `get_canonical_*_id()` | Follow merge chain | Assume ID is canonical |

---

## API Route Structure

```
/api
├── /cats
│   └── /[id]               GET, PATCH - Cat details
├── /people
│   ├── /[id]               GET, PATCH - Person details
│   │   ├── /address        PATCH, DELETE - Address management
│   │   ├── /trapper-stats  GET - Trapper performance
│   │   └── /submissions    GET - Linked intake submissions
│   ├── /search             GET - Search people
│   └── /check-email        GET - Email lookup
├── /places
│   ├── /[id]               GET, PATCH - Place details
│   │   ├── /submissions    GET - Linked submissions
│   │   ├── /colony-*       GET, POST - Colony estimates
│   │   └── /alteration-history GET - TNR history
│   ├── /autocomplete       GET - Google autocomplete
│   ├── /geocode-queue      GET, POST - Geocoding management
│   └── /check-duplicate    GET - Duplicate detection
├── /requests
│   ├── /[id]               GET, PATCH - Request details
│   │   ├── /trappers       GET, POST - Trapper assignments
│   │   ├── /media          GET, POST - Photo management
│   │   └── /alteration-stats GET - TNR metrics
│   └── (root)              GET, POST - List/create requests
├── /intake
│   ├── /public             POST - Public intake form (CORS)
│   ├── /queue              GET - Intake queue list
│   ├── /queue/[id]         GET, PATCH - Queue item details
│   ├── /custom-fields      GET - Admin-defined questions
│   └── /convert            POST - Convert to request
├── /admin
│   ├── /stats              GET - Dashboard statistics (CACHED)
│   ├── /ecology-config     GET, POST - Colony parameters
│   ├── /intake-fields      CRUD - Custom intake questions
│   ├── /duplicates         GET - Potential duplicates
│   └── /staff              CRUD - Staff management
├── /cron
│   ├── /airtable-sync      GET - Sync Airtable submissions
│   └── /geocode            GET - Process geocoding queue
├── /trappers               GET, PATCH, POST - Trapper management
├── /staff                  GET, POST - Staff directory
├── /journal                GET, POST - Notes/communications
└── /search                 GET - Universal search
```

---

## Trapper Types

| Type | Is FFSC? | Description |
|------|----------|-------------|
| `coordinator` | Yes | FFSC staff coordinator |
| `head_trapper` | Yes | FFSC head trapper |
| `ffsc_trapper` | Yes | FFSC trained volunteer (completed orientation) |
| `community_trapper` | No | Signed contract only, does NOT represent FFSC |

---

## Source Systems

| Source | Confidence | Description |
|--------|------------|-------------|
| `web_intake` | 0.95 | Direct website form submission |
| `atlas_ui` | 0.90 | Manual entry in Atlas |
| `manual` | 0.85 | Data entry by staff |
| `airtable` | 0.70 | JotForm → Airtable sync |
| `clinichq` | 0.50 | Clinic records (booked under location) |

---

## Files Quick Reference

```
Repository Structure:

Atlas/
├── apps/web/                     # Next.js Application
│   ├── src/app/                  # App Router
│   │   ├── api/                  # API Routes
│   │   ├── admin/                # Admin pages
│   │   ├── intake/               # Intake pages
│   │   ├── cats/[id]/            # Cat detail page
│   │   ├── people/[id]/          # Person detail page
│   │   ├── places/[id]/          # Place detail page
│   │   └── requests/[id]/        # Request detail page
│   └── src/components/           # React components
│
├── scripts/                      # Data Scripts
│   ├── rebuild_all.sh            # Master rebuild
│   └── ingest/                   # Ingestion scripts
│       ├── _lib/                 # Shared utilities
│       ├── clinichq_*.mjs        # ClinicHQ imports
│       └── airtable_*.mjs        # Airtable syncs
│
├── sql/schema/sot/               # SQL Migrations
│   ├── MIG_130-160               # Core schema
│   ├── MIG_161-200               # Entity resolution
│   └── MIG_201-260               # Features & improvements
│
└── docs/                         # Documentation
    ├── DEVELOPER_GUIDE.md        # Start here
    ├── DATA_INGESTION_RULES.md   # Ingestion rules
    ├── INGEST_GUIDELINES.md      # Function usage
    └── ARCHITECTURE_DIAGRAMS.md  # This file
```

---

## Known Issues / Technical Debt

1. **Polymorphic FK ambiguity**: `ops.requests` has both `place_id` AND `primary_place_id`
2. **Legacy columns**: `ops.requests.assigned_to` (text) alongside `request_trapper_assignments` table
3. **Orphaned status fields**: `ops.web_intake_submissions` has multiple overlapping status columns
4. **Manual Airtable sync**: Custom fields require clicking "Sync to Airtable" button
5. **Geocoding async**: No webhook/notification when geocoding completes

---

## Quick Links for Stakeholders

- **Dashboard**: `/` - Overview of recent activity
- **Intake Queue**: `/intake/queue` - Review new submissions
- **Admin**: `/admin` - System configuration
- **Trappers**: `/trappers` - Trapper management
- **Search**: `/search` - Find people, places, cats, requests
