# Atlas Data Cleaning Pipeline

The **Atlas Data Cleaning Pipeline** is a unified system for processing, validating, and cleaning all data that flows through Atlas. This is the single source of truth for data quality rules.

## Architecture

```
Source Data (ClinicHQ, Airtable, ShelterLuv, Web Intake)
    ↓
┌─────────────────────────────────────────────────────────┐
│              STAGING LAYER                               │
│   staged_records, ingest_runs                           │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│              IDENTITY RESOLUTION                         │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │     DATA ENGINE (Single Fortress)               │   │
│   │                                                  │   │
│   │  Phase 0: should_be_person()                    │   │
│   │    - Reject org emails (INV-17)                 │   │
│   │    - Reject location names (INV-18)             │   │
│   │    - Reject garbage names                       │   │
│   │    - Require email OR phone                     │   │
│   │                                                  │   │
│   │  Phase 1: Internal account check                │   │
│   │  Phase 2: Scoring candidates                    │   │
│   │  Phase 3: Decision (match/new/review)           │   │
│   └─────────────────────────────────────────────────┘   │
│                                                          │
│   Key Functions:                                         │
│   - find_or_create_person()                             │
│   - find_or_create_place_deduped()                      │
│   - find_or_create_cat_by_microchip()                   │
│   - data_engine_resolve_identity()                       │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│              ENTITY LINKING                              │
│                                                          │
│   run_all_entity_linking() runs via cron:               │
│   - Step 1a: process_clinichq_cat_info                  │
│   - Step 1b: process_clinichq_owner_info                │
│   - Step 1c: process_clinichq_unchipped_cats            │
│   - Step 1d: process_clinic_euthanasia                  │
│   - Step 1e: process_embedded_microchips_in_animal_names│
│   - Step 1f: retry_unmatched_master_list_entries        │
│   - Step 2:  run_all_entity_linking                     │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│              SOURCE OF TRUTH                             │
│                                                          │
│   sot_people, sot_cats, sot_requests, places            │
│   sot_appointments                                       │
└─────────────────────────────────────────────────────────┘
```

## Key Validation Functions

| Function | Purpose | Invariant |
|----------|---------|-----------|
| `should_be_person()` | Gate: decides if input should create a person record | INV-17, INV-18 |
| `classify_owner_name()` | Classifies names as person/org/address/garbage | INV-18 |
| `is_organization_name()` | Quick check for org name patterns | INV-18 |
| `detect_microchip_format()` | Validates and extracts microchips safely | - |
| `extract_microchip_from_animal_name()` | Extracts embedded chips from names | - |
| `norm_phone_us()` | Normalizes US phone numbers | - |
| `clean_person_name()` | Removes garbage prefixes from names | - |

## Invariants (Rules That Must Never Be Broken)

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-17 | Organizational emails must not create person records | `should_be_person()` Phase 0 |
| INV-18 | Location names must not create person records | `should_be_person()` + `classify_owner_name()` |
| INV-19 | Microchips must be validated before linking | `detect_microchip_format()` |

## Data Gap Tracking

Active data gaps are tracked in `docs/DATA_GAPS.md`. Each gap has:
- Problem description
- Root cause analysis
- Proposed fix
- Migration file reference
- Status

## Running the Pipeline

### Unified Orchestrator (Recommended)

The unified orchestrator runs all processing phases in the correct dependency order:

```bash
# Via API (cron or manual)
curl -X POST https://your-app.vercel.app/api/cron/orchestrator-run \
  -H "Authorization: Bearer $API_SECRET"

# Check health
curl https://your-app.vercel.app/api/cron/orchestrator-run
```

**Orchestrator Phases:**
1. ClinicHQ: `appointments` → `owners` → `cats`
2. VolunteerHub: `people`
3. ShelterLuv: `people` → `animals` → `events`
4. Entity linking
5. Cross-source reconciliation
6. Data quality audit

### Full Reprocess (Nuclear Option)

```bash
# This reprocesses ALL data through the pipeline
./scripts/pipeline/run_full_reprocess.sh

# Steps:
# 1. Apply all data gap fix migrations
# 2. Re-run all entity linking
# 3. Run audit to verify
```

### Audit Only

```bash
# Just check for data quality issues without fixing
./scripts/pipeline/run_audit.sh
```

### Apply Specific Fix

```bash
# Apply a specific data gap fix
psql "$DATABASE_URL" -f sql/schema/sot/MIG_XXX__fix_description.sql
```

## Source Authority Map

When data conflicts between sources, the **survivorship_priority** table determines which source wins:

| Data Type | Primary Authority | Notes |
|-----------|------------------|-------|
| Cat medical data | ClinicHQ | Spay/neuter, procedures, vaccines |
| Cat identity | ClinicHQ (microchip) | Microchip is gold standard |
| Cat origin location | ClinicHQ | Appointment address = where cat came from |
| Cat current location | ShelterLuv | Outcome address = where cat is now |
| Cat outcomes | ShelterLuv | Adoption, foster, death, transfer |
| People (volunteers) | VolunteerHub | Roles, groups, hours, status |
| People (fosters) | VolunteerHub | "Approved Foster Parent" group is authority |
| People (adopters) | ShelterLuv | From adoption outcome events |
| People (clinic clients) | ClinicHQ | From appointment owner info |
| Trapper roles | VolunteerHub | Except community trappers from Airtable |
| Foster relationships | ShelterLuv | Cat→foster links from outcomes; person must be VH approved |

## Field Source Tracking

Multi-source field tracking is available for both cats and people:

- **`cat_field_sources`** (MIG_620) - Tracks which source provided each cat field
- **`person_field_sources`** (MIG_922) - Tracks which source provided each person field

Views for conflict detection:
- **`v_cat_field_conflicts`** - Cats with conflicting field values
- **`v_person_field_conflicts`** - People with conflicting field values
- **`v_all_field_conflicts`** - Combined view for dashboard

## Files

```
scripts/pipeline/
├── README.md                    # This file
├── run_full_reprocess.sh        # Full pipeline reprocess
├── run_audit.sh                 # Audit without changes
├── run_entity_linking.sh        # Just entity linking step
└── apply_data_gap_fixes.sh      # Apply all data gap migrations

scripts/lib/
├── identity-validation.mjs      # JS validation (mirrors SQL)
└── db.mjs                       # Database utilities

sql/schema/sot/
├── MIG_915__should_be_person_email_check.sql    # INV-17 email gate
├── MIG_919__data_engine_consolidated_gate.sql   # Consolidated fortress
├── MIG_920__data_gap_013_audit.sql              # Audit script
└── ... (other migrations)

docs/
├── DATA_GAPS.md                 # Active data gaps tracker
├── TASK_LEDGER.md               # Full development history
└── ATLAS_NORTH_STAR.md          # Architecture vision
```

## Adding a New Data Gap Fix

1. Document in `docs/DATA_GAPS.md`
2. Create migration: `sql/schema/sot/MIG_XXX__fix_description.sql`
3. Test in staging
4. Apply to production
5. Update DATA_GAPS.md status

## Contact

For questions about the pipeline, see CLAUDE.md or ask in #atlas-dev.
