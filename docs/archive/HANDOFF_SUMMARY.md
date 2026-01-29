# Atlas Project - Handoff Summary

**Last Updated**: January 10, 2026
**Branch**: main
**Latest Commit**: feat(ATLAS_026): Entity match config and architecture docs

---

## Project Overview

**Atlas** is a translational/organizational layer between messy data inputs and Beacon (a cat colony analyst tool). It consolidates data from multiple sources into a unified, searchable database with canonical entity resolution.

### Three-Phase Vision

1. **Phase 1 (Current)**: Coalesce messy data into a usable, flexible database
2. **Phase 2**: Universal search tool for all entity types
3. **Phase 3**: Data collection tool to replace Airtable trapping requests

---

## Tech Stack

- **Database**: PostgreSQL (Supabase) with PostGIS
- **Backend/API**: Next.js 14 App Router (TypeScript)
- **Search**: pg_trgm (trigram similarity), custom search functions
- **Geocoding**: Google Geocoding API with caching
- **Migrations**: Raw SQL files in `sql/migrations/MIG_*.sql`
- **Scripts**: Bash scripts in `scripts/`

---

## Data Sources (Ingested)

| Source | Tables | Records | Canonical People |
|--------|--------|---------|------------------|
| Airtable | trapping_requests | ~1,583 | ✅ Enabled |
| Airtable | appointment_requests | ~1,135 | ❌ Messy |
| ClinicHQ | cat_info, owner_info, appointment_info | ~55,000 | ✅ Enabled |
| VolunteerHub | users | ~1,342 | ✅ Enabled |
| Shelterluv | animals, people, outcomes | ~9,000 | ❌ Disabled (can enable later) |
| PetLink | owners, pets | ~12,000 | ❌ Disabled |
| eTapestry | mailchimp_export | ~7,680 | ❌ Disabled |

Source enablement is controlled by `trapper.source_canonical_config` table.

---

## Core Entities

### People (`trapper.sot_people`)

**Canonicalization**: Phone/email as deterministic keys, fuzzy name matching for candidates

- **Strong identifiers** (phone, email) → deterministic match
- **Fuzzy matching** → review queue or high-confidence auto-merge
- **Soft merges** with full audit trail and undo capability

**Current State**: 264 canonical people with 100% valid names (2+ tokens, no HTML)

**Key Tables**:
- `sot_people` - Canonical person records
- `person_identifiers` - UNIQUE phone/email identifiers
- `person_aliases` - Name variations
- `person_match_candidates` - Fuzzy match queue (status: open/auto_merged/accepted/rejected)
- `staged_record_person_link` - Links raw records to canonical people

### Places (`trapper.places` + `trapper.sot_addresses`)

**Canonicalization**: Google Place ID as deterministic key

- Addresses geocoded via Google API with caching
- Places are 1:1 with addresses (with type classification)
- Failed geocodes go to review queue

**Place Types**: residence, business, colony, shelter, veterinary, park, etc.
**Place Kinds**: residential_house, apartment_unit, apartment_building, business, clinic, outdoor_site

**New**: `is_significant` flag distinguishes primary places (businesses, colonies) from incidental residential addresses

### Cats (`trapper.sot_cats`)

**Canonicalization**: Microchip as deterministic key

- External IDs (ClinicHQ, Shelterluv) for source-specific dedupe
- Linked to owners via `person_cat_relationships`

**Current State**: Cats from ClinicHQ with microchip deduplication

---

## Entity Resolution Architecture

```
Staged Records (raw, immutable)
        ↓
Observations (extracted signals: email, phone, name, address)
        ↓
    ┌───────────────────────────────────────────────────┐
    │            ENTITY RESOLUTION LAYER                │
    ├───────────────────────────────────────────────────┤
    │                                                   │
    │  PEOPLE          PLACES           CATS            │
    │  phone/email → ● Google PID → ●   microchip → ●  │
    │  fuzzy name  → ? fuzzy addr  → ?  fuzzy attrs → ?│
    │                                                   │
    │  ● = deterministic match                          │
    │  ? = candidate for review                         │
    └───────────────────────────────────────────────────┘
        ↓
Canonical Entities (sot_people, places, sot_cats)
        ↓
Relationships (person_cat, person_place, cat_place)
```

---

## Configuration System

### Source Configuration (`source_canonical_config`)

Controls which sources can create canonical people:

```sql
-- Enable Shelterluv for canonical people later:
UPDATE trapper.source_canonical_config
SET allow_canonical_people = TRUE
WHERE source_system = 'shelterluv';
```

### Match Configuration (`entity_match_config`)

Controls fuzzy matching thresholds:

| Entity | Config Key | Value | Description |
|--------|------------|-------|-------------|
| person | auto_merge_threshold | 0.97 | Min score for auto-merge |
| person | review_threshold | 0.75 | Min score for review queue |
| person | name_similarity_min | 0.75 | Min trigram similarity |
| cat | auto_merge_threshold | 0.90 | Cat auto-merge threshold |
| place | geocode_confidence_auto | 0.90 | Auto-accept geocode confidence |

---

## Key Functions

### Person Matching

- `trapper.is_valid_person_name(name)` - Validates 2+ tokens, no HTML
- `trapper.is_valid_person_name_for_canonical(name, source_system, source_table)` - Source-aware validation
- `trapper.name_similarity(a, b)` - Trigram similarity (0-1)
- `trapper.generate_person_match_candidates()` - Creates fuzzy match candidates
- `trapper.apply_automerge_very_confident()` - Auto-merges high-confidence pairs
- `trapper.merge_people(source_id, target_id, reason, note)` - Soft merge
- `trapper.undo_person_merge(merge_id)` - Revert merge

### Search

- `trapper.search_unified(query, entity_type, limit, offset)` - Main search
- `trapper.search_suggestions(query, limit)` - Typeahead suggestions
- `trapper.search_deep(query, limit)` - Raw data search (all sources)

### Name Extraction

- `trapper.combine_first_last_name(payload, first_key, last_key)` - Combines First+Last into full name
- `trapper.extract_observations_from_staged(record_id)` - Extracts all signals from staged record
- `trapper.populate_observations_for_latest_run(table_name)` - Batch extraction

---

## API Endpoints

| Endpoint | Purpose | View Used |
|----------|---------|-----------|
| `/api/search` | Unified search | search_unified, search_suggestions |
| `/api/people` | List people | v_person_list_v2 |
| `/api/people/[id]` | Person detail | v_person_detail |
| `/api/cats` | List cats | v_cat_list |
| `/api/cats/[id]` | Cat detail | v_cat_detail |
| `/api/places` | List places | v_place_list |
| `/api/places/[id]` | Place detail | v_place_detail_v2 |

---

## Review Queues

### Person Match Candidates

```sql
-- View open candidates ordered by score
SELECT * FROM trapper.person_match_candidates
WHERE status = 'open'
ORDER BY match_score DESC;

-- Accept a match
SELECT trapper.accept_person_match(candidate_id);

-- Reject a match
SELECT trapper.reject_person_match(candidate_id, 'Different people - unrelated');
```

### Address Review Queue

```sql
-- View addresses needing review
SELECT * FROM trapper.address_review_queue
WHERE is_resolved = FALSE
ORDER BY created_at;
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fresh_rebuild.sh` | Apply all migrations, clear derived data, rebuild from observations |
| `scripts/rebuild_canonical_people.sql` | Clear and rebuild just people (preserves staged records) |
| `scripts/acceptance_test_atlas_019.sh` | 22 acceptance tests for search and data quality |
| `scripts/ingest/*.ts` | Source-specific ingest scripts |

---

## Recent Migrations (Key Ones)

| Migration | Purpose |
|-----------|---------|
| MIG_028 | Fixed search API 500 error (metadata column) |
| MIG_029 | Hardened canonical people (v_person_list_v2 with validation) |
| MIG_030 | **ROOT CAUSE FIX** - Combined First+Last name extraction |
| MIG_031 | Configurable source enablement (source_canonical_config) |
| MIG_032 | Configurable match thresholds (entity_match_config) |

---

## Current State Summary

| Metric | Value |
|--------|-------|
| Canonical People | 264 (100% valid names) |
| Places | 120 (5 significant, 115 incidental) |
| Cats | ~8,600 (from ClinicHQ) |
| Person Aliases | 273 |
| Staged Records | ~88,000 |
| Sources Enabled for Canonical | 3 (Airtable trapping_requests, ClinicHQ, VolunteerHub) |

---

## Known Gaps / Future Work

### High Priority
1. **Phonetic matching** - Add Soundex/Metaphone for "Susan" vs "Susana"
2. **Review UI** - Web interface for person match candidates
3. **Place editing** - Mark places as significant via UI

### Medium Priority
4. **Fuzzy cat matching** - For cats without microchip
5. **Cross-source cat dedupe** - Match Shelterluv cats to ClinicHQ cats
6. **Enable more sources** - Shelterluv for adopter tracking when ready

### Phase 3
7. **Trapping request creation** - Atlas as data entry tool
8. **Entity selection UX** - Select or create person/place/cat in forms
9. **Relationship types** - fosterer, adopter, colony manager, etc.

---

## File Structure

```
Atlas/
├── apps/web/                    # Next.js application
│   └── src/app/api/            # API routes
├── sql/
│   ├── migrations/             # MIG_*.sql files (32 migrations)
│   └── queries/                # QRY_*.sql for ad-hoc queries
├── scripts/
│   ├── ingest/                 # Source-specific ingest TypeScript
│   ├── fresh_rebuild.sh        # Full rebuild script
│   └── acceptance_test_*.sh    # Test scripts
└── docs/
    ├── ARCHITECTURE_ENTITY_RESOLUTION.md  # Full architecture docs
    └── HANDOFF_SUMMARY.md      # This file
```

---

## Quick Commands

```bash
# Load environment
set -a && source .env && set +a

# Apply a migration
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_032__entity_match_config.sql

# Run acceptance tests
./scripts/acceptance_test_atlas_019.sh

# Start dev server
cd apps/web && npm run dev

# Check canonical people quality
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE trapper.is_valid_person_name(display_name)) AS valid FROM trapper.sot_people WHERE merged_into_person_id IS NULL;"

# View source configuration
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_source_config;"

# View match thresholds
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_entity_match_config;"
```

---

## The Susan Smith Problem (Solved)

When "Susan Smith" submits via Airtable with phone 555-1234, then later calls in as "Susana" or "Susan Smyth":

1. **First submission**: Phone 555-1234 creates canonical person with alias "Susan Smith"
2. **Second contact**: Same phone → links to existing person, adds alias "Susana"
3. **Display name**: Uses most common alias ("Susan Smith")
4. **Fuzzy matching**: If different phone but similar name + shared address → candidate for review

The system handles this via deterministic phone/email matching first, then fuzzy name matching for edge cases.
