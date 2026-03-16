# Atlas Entity Resolution Architecture

## Vision

Atlas serves as a **translational/organizational layer** between messy data inputs and Beacon (cat colony analyst tool), with three phases:

1. **Phase 1 (Current)**: Coalesce messy data into a usable, flexible database
2. **Phase 2**: Universal search tool for all entity types
3. **Phase 3**: Data collection tool to replace Airtable trapping requests

The key insight: **data becomes more accurate over time** as entities get re-encountered and relationships get confirmed. A nonsense owner profile today may be linked to a real person when that cat comes around again.

---

## Core Principles

### 1. Evidence-Based Canonicalization
Every canonical entity is derived from **observations** (signals) extracted from raw staged records. The staged record is never modified - it's the immutable source of truth. Canonical entities are our best current interpretation.

### 2. Deterministic Keys First, Fuzzy Second
- **Strong identifiers** (email, phone, microchip, Google Place ID) provide deterministic matching
- **Fuzzy matching** (name similarity, address similarity) generates candidates for review or high-confidence auto-merge

### 3. Conservative Auto-Merge, Easy Undo
- Auto-merge only when VERY confident (multiple confirming signals)
- All merges are soft (pointer-based) and reversible
- Full audit trail for every decision

### 4. Configurable, Not Hard-Coded
- Source-level configuration (which sources can create canonical entities)
- Match threshold configuration (per entity type, per signal type)
- All business rules in database tables, not application code

### 5. Progressive Quality Improvement
- Manual review queues for uncertain matches
- Decisions feed back into blocking/allowing future matches
- UI for bulk review and merge operations

---

## Entity Types

### People (`sot.people`)

**Canonicalization Strategy:**
```
Priority 1: Phone match → Same person (deterministic)
Priority 2: Email match → Same person (deterministic)
Priority 3: Fuzzy name + shared context → Candidate for merge
```

**Current State:**
- ✅ Deterministic matching on normalized phone/email
- ✅ Fuzzy matching via trigram similarity (pg_trgm)
- ✅ Auto-merge with conflicting identifier guard
- ✅ Shared address context requirement
- ✅ Reversible merges with audit trail
- ✅ Source-level configuration (MIG_031)

**The "Susan Smith" Problem:**
When Susan Smith submits appointment request with phone 555-1234, then calls in as "Susana" or "Susan Smyth":
1. Phone 555-1234 is deterministic key → Same person
2. Name "Susana" vs "Susan Smith" → Added as alias
3. Display name uses most common alias

**Confidence Scoring (Current):**
| Match Type | Confidence | Action |
|------------|------------|--------|
| Same phone + any name | 1.0 | Auto-link |
| Same email + any name | 1.0 | Auto-link |
| Fuzzy name ≥0.97 + shared address + no conflicts | HIGH | Auto-merge |
| Fuzzy name ≥0.75 + same last token | MEDIUM | Review queue |
| Fuzzy name only | LOW | Deep search only |

### Places (`sot.places` + `sot.addresses`)

**Canonicalization Strategy:**
```
Google Place ID (if available) → Canonical address
Geocoded address + unit normalization → Unique address
Address → Place (1:1 mapping with type classification)
```

**Current State:**
- ✅ Google Geocoding integration with cache
- ✅ Place ID as canonical key
- ✅ Unit normalization (apartment handling)
- ✅ Address review queue for failed geocodes
- ✅ Place types (residence, business, colony, etc.)
- ✅ Place kinds (residential_house, apartment_unit, etc.)
- ✅ Address-backed constraint (no phantom places)

**Important Distinction:**
| Concept | Definition | Example |
|---------|------------|---------|
| **Address** (`sot.addresses`) | A geocoded physical location | "123 Main St, Unit 4, Austin TX" |
| **Place** (`sot.places`) | A meaningful location with type | "The Smith Residence" or "PetSmart #1234" |

**Place Significance:**
- **Primary Places**: Businesses, colonies, shelters, clinics - places you would call or visit intentionally
- **Incidental Places**: Residential addresses from form submissions - auto-generated when geocoding

### Cats (`sot.cats`)

**Canonicalization Strategy:**
```
Microchip → Deterministic (same chip = same cat forever)
External ID (ClinicHQ, Shelterluv) → Source-specific dedupe
No microchip → Fuzzy match on name + attributes + location
```

**Current State:**
- ✅ Microchip as strong identifier
- ✅ Source-specific external IDs
- ✅ Person-cat relationships with owner linking
- ⚠️ No fuzzy cat matching yet (name + description)

**Future: Fuzzy Cat Matching**
For cats without microchip, match on:
- Name similarity (weighted low - "Fluffy" is common)
- Physical attributes (sex, color, breed)
- Location proximity (cats don't travel far)
- Time window (same cat seen at same location within weeks)

---

## Match Confidence System

### Proposed: Multi-Signal Confidence Aggregation

```sql
-- Example: person_match_score calculation
score =
  (phone_match * 1.0) +     -- deterministic
  (email_match * 0.9) +     -- deterministic (but families share)
  (name_similarity * 0.3) + -- fuzzy
  (shared_address * 0.2) +  -- context
  (shared_cats * 0.1)       -- context

-- Normalize to 0-1, apply thresholds
```

### Configurable Thresholds

```sql
CREATE TABLE entity_match_config (
    entity_type TEXT NOT NULL,  -- 'person', 'cat', 'place'
    config_key TEXT NOT NULL,
    config_value NUMERIC,
    description TEXT,
    PRIMARY KEY (entity_type, config_key)
);

-- Example settings
INSERT INTO entity_match_config VALUES
('person', 'auto_merge_threshold', 0.95, 'Auto-merge if score >= this'),
('person', 'review_threshold', 0.70, 'Add to review if score >= this'),
('person', 'name_sim_weight', 0.30, 'Weight for name similarity'),
('person', 'shared_address_weight', 0.20, 'Weight for shared address'),
('cat', 'auto_merge_threshold', 0.90, 'Cat auto-merge threshold'),
('cat', 'location_proximity_km', 2.0, 'Max km for location match');
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     INGESTION LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  Raw Sources → Staged Records (immutable) → Observations        │
│  (Airtable, ClinicHQ, Shelterluv, PetLink, VolunteerHub)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ENTITY RESOLUTION LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   PEOPLE    │    │   PLACES    │    │    CATS     │        │
│  ├─────────────┤    ├─────────────┤    ├─────────────┤        │
│  │ phone/email │    │ Google PID  │    │  microchip  │ ← Keys │
│  │ → person    │    │ → address   │    │  → cat      │        │
│  │             │    │ → place     │    │             │        │
│  ├─────────────┤    ├─────────────┤    ├─────────────┤        │
│  │ fuzzy name  │    │ fuzzy addr  │    │ fuzzy attrs │ ← Soft │
│  │ → candidate │    │ → review    │    │ → candidate │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
│  Configuration: source_canonical_config, entity_match_config   │
│                                                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RELATIONSHIP LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  sot.person_cat  (owner, fosterer, adopter, etc.)              │
│  sot.person_place (resident, works_at, manages)                │
│  sot.cat_place (seen_at, trapped_at, colony_member)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│  Search API (unified, suggestions, deep)                       │
│  Detail Views (v_person_detail_v2, v_place_detail_v2, etc.)   │
│  Review Queues (person_match_candidates, address_review_queue) │
│  Data Entry (future: trapping request creation)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Future: Trapping Request Creation Flow

When Atlas becomes the data collection tool:

```
User Creates Trapping Request
        │
        ▼
┌───────────────────┐
│ Select Requester  │ → Search existing people OR create new
│ (Person)          │   - If new: require phone OR email (creates canonical)
└───────────────────┘   - If existing: link to canonical person
        │
        ▼
┌───────────────────┐
│ Select Location   │ → Search existing places OR enter new address
│ (Place)           │   - If new address: geocode → create address → create place
└───────────────────┘   - User specifies type: house, apartment, business, colony
        │
        ▼
┌───────────────────┐
│ Add Cat(s)        │ → Search existing cats OR create new
│ (Optional)        │   - If known microchip: link to existing
└───────────────────┘   - If new: capture attributes for future matching
        │
        ▼
┌───────────────────┐
│ Request Details   │ → Problem description, urgency, etc.
└───────────────────┘
        │
        ▼
    Staged Record (new source: 'atlas')
        │
        ▼
    Observations extracted
        │
        ▼
    Entities linked (already canonical from selection)
```

This flow ensures **data is clean at entry** rather than requiring post-hoc cleanup.

---

## Review Queue Strategy

### Person Match Review
1. **Auto-merge** (no review needed): score ≥ 0.95 + no conflicts + shared context
2. **Review queue**: score ≥ 0.70 but doesn't meet auto-merge criteria
3. **Deep search only**: score < 0.70 (too uncertain for canonical)

### Address Review
1. **Auto-accept**: geocode_status = 'ok', confidence ≥ 0.9
2. **Review queue**: partial_match, low_confidence, ambiguous
3. **Rejected**: zero_results, invalid_format (needs manual entry)

### Cat Match Review (Future)
1. **Auto-merge**: same microchip
2. **Review queue**: similar attributes + same location + time window
3. **No match**: insufficient evidence

---

## Key Tables Summary

| Table | Purpose | Canonical Key |
|-------|---------|---------------|
| `sot.people` | Canonical people | UUID (phone/email for dedupe) |
| `sot.person_identifiers` | Strong identifiers | UNIQUE(type, normalized_value) |
| `person_aliases` | Name variations | Links to person |
| `sot.addresses` | Geocoded addresses | google_place_id + unit |
| `sot.places` | Meaningful locations | 1:1 with sot.addresses |
| `sot.cats` | Canonical cats | UUID (microchip for dedupe) |
| `sot.cat_identifiers` | Cat identifiers | UNIQUE(type, value) |
| `source_canonical_config` | Source enablement | Per source_system/table |

---

## Current Gaps (Prioritized)

### High Priority
1. **Entity match config table** - Make thresholds configurable like sources
2. **Phonetic matching for names** - Soundex/Metaphone in addition to trigram
3. **Place significance flag** - Distinguish primary places from incidental

### Medium Priority
4. **Fuzzy cat matching** - For cats without microchip
5. **Cross-source cat dedupe** - Match Shelterluv cats to ClinicHQ cats
6. **Address fuzzy matching** - When Google can't geocode

### Lower Priority (Phase 3)
7. **Atlas as data source** - Trapping request creation UI
8. **Multi-purpose person-cat relationships** - fosterer, adopter, etc.
9. **Cat-place relationships** - colony membership, sighting locations

---

## Success Metrics

1. **Precision**: % of auto-merges that are correct (target: 99%+)
2. **Recall**: % of true matches identified (target: 90%+)
3. **Review queue velocity**: Avg time to resolve open candidates
4. **Data quality over time**: Reduction in orphan entities as relationships confirmed
