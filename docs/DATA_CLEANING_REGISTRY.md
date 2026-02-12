# Atlas Data Cleaning Registry

**Purpose:** This document catalogs ALL data cleaning transformations in a single place. These transformations can be re-run on source data to recreate cleaned data at any time.

**Key Principle:** `source.* (raw) → [Transformations] → sot.* (clean)`

If we have the source data and these transformations, we can always recreate the cleaned output.

---

## Transformation Pipeline Order

Transformations MUST run in this order due to dependencies:

```
1. NORMALIZATION (stateless, deterministic)
   └── norm_phone_us(), norm_email(), normalize_person_name()

2. CLASSIFICATION (stateless, deterministic)
   └── classify_owner_name(), classify_petlink_email(), is_organization_name()

3. GATING (uses classification + soft_blacklist)
   └── should_be_person() → routes to sot.people or ops.clinic_accounts

4. IDENTITY RESOLUTION (uses gating + scoring)
   └── data_engine_resolve_identity() → match/create/review decisions

5. ENTITY CREATION (uses identity resolution)
   └── find_or_create_person(), find_or_create_cat_by_microchip(), find_or_create_place_deduped()

6. RELATIONSHIP BUILDING (uses entities)
   └── link_cat_to_place(), link_person_to_cat(), link_person_to_place()

7. ENRICHMENT (uses relationships)
   └── link_cats_to_appointment_places(), link_cats_to_places(), household_modeling
```

---

## Layer 1: Normalization Functions

These are stateless and deterministic. Given the same input, always produce the same output.

### `norm_phone_us(phone TEXT) → TEXT`
**Location:** `atlas.norm_phone_us()`
**Purpose:** Normalize US phone numbers to 10-digit format
**Input:** Any phone string (with formatting, extensions, etc.)
**Output:** 10-digit string or NULL if invalid

```sql
-- Examples:
SELECT atlas.norm_phone_us('(707) 555-1234');     -- '7075551234'
SELECT atlas.norm_phone_us('707.555.1234 x123'); -- '7075551234'
SELECT atlas.norm_phone_us('+1-707-555-1234');   -- '7075551234'
SELECT atlas.norm_phone_us('invalid');            -- NULL
```

**Rerun:** Yes - pure function, no state

---

### `norm_email(email TEXT) → TEXT`
**Location:** `atlas.norm_email()`
**Purpose:** Normalize email addresses (lowercase, trim)
**Input:** Any email string
**Output:** Lowercase, trimmed email or NULL

```sql
-- Examples:
SELECT atlas.norm_email('  John.DOE@Gmail.COM  '); -- 'john.doe@gmail.com'
SELECT atlas.norm_email('');                        -- NULL
```

**Rerun:** Yes - pure function, no state

---

### `normalize_person_name(name TEXT) → TEXT`
**Location:** `atlas.normalize_person_name()`
**Purpose:** Normalize person names for matching (title case, trim punctuation)
**Input:** Any name string
**Output:** Normalized name

```sql
-- Examples:
SELECT atlas.normalize_person_name('JOHN DOE');    -- 'John Doe'
SELECT atlas.normalize_person_name('john  doe');   -- 'John Doe'
SELECT atlas.normalize_person_name('John, Doe.');  -- 'John Doe'
```

**Rerun:** Yes - pure function, no state

---

### `extract_microchip_from_animal_name(name TEXT) → TEXT`
**Location:** `atlas.extract_microchip_from_animal_name()`
**Purpose:** Extract embedded microchip from animal name field
**Input:** Animal name (may contain microchip)
**Output:** 15-digit microchip or NULL

```sql
-- Examples:
SELECT atlas.extract_microchip_from_animal_name('Tabby 981020000000000'); -- '981020000000000'
SELECT atlas.extract_microchip_from_animal_name('9.8102E+14');            -- '981020000000000'
SELECT atlas.extract_microchip_from_animal_name('Just Tabby');            -- NULL
```

**Rerun:** Yes - pure function, no state

---

## Layer 2: Classification Functions

These classify input data into categories. Deterministic given the same rules.

### `classify_owner_name(first TEXT, last TEXT) → classification_result`
**Location:** `atlas.classify_owner_name()`
**Purpose:** Determine if a name represents a person, organization, address, or garbage
**Output:** `'likely_person' | 'organization' | 'address' | 'apartment_complex' | 'garbage' | 'unknown'`

```sql
-- Examples:
SELECT atlas.classify_owner_name('John', 'Doe');           -- 'likely_person'
SELECT atlas.classify_owner_name('Silveira', 'Ranch');     -- 'organization' or 'address'
SELECT atlas.classify_owner_name('890 Rockwell', 'Rd');    -- 'address'
SELECT atlas.classify_owner_name('SCAS', NULL);            -- 'organization'
SELECT atlas.classify_owner_name('Test', 'Test');          -- 'garbage'
```

**Detection patterns:**
- **Address:** Starts with digits, contains street suffixes (rd, st, ave, etc.)
- **Organization:** Contains Inc, LLC, Corp, rescue, shelter, humane, church, school
- **Apartment:** Contains apartment, village, terrace, manor, gardens, towers
- **Garbage:** Test/dummy names, repeated characters, just numbers

**Rerun:** Yes - deterministic rules

---

### `classify_petlink_email(email TEXT) → classification_result`
**Location:** `atlas.classify_petlink_email()`
**Purpose:** Classify PetLink emails as fabricated or legitimate
**Output:** `'clearly_fabricated' | 'likely_fabricated' | 'uncertain' | 'likely_real'`

```sql
-- Examples:
SELECT atlas.classify_petlink_email('gordon@lohrmanln.com');    -- 'clearly_fabricated' (street domain)
SELECT atlas.classify_petlink_email('kathleen@jeffersonst.com'); -- 'clearly_fabricated'
SELECT atlas.classify_petlink_email('john.doe@gmail.com');       -- 'likely_real'
```

**Confidence mapping:**
| Classification | Confidence Score |
|----------------|------------------|
| clearly_fabricated | 0.1 |
| likely_fabricated | 0.2 |
| uncertain | 0.3 |
| likely_real | 0.5 |

**Rerun:** Yes - deterministic patterns

---

### `is_organization_name(name TEXT) → BOOLEAN`
**Location:** `atlas.is_organization_name()`
**Purpose:** Quick check if name looks like an organization
**Uses:** Part of `classify_owner_name()` logic

---

### `is_address_name(name TEXT) → BOOLEAN`
**Location:** `atlas.is_address_name()`
**Purpose:** Quick check if name looks like an address
**Uses:** Part of `classify_owner_name()` logic

---

## Layer 3: Gating Functions

These make routing decisions based on classification and soft blacklist.

### `should_be_person(first TEXT, last TEXT, email TEXT, phone TEXT) → BOOLEAN`
**Location:** `atlas.should_be_person()`
**Purpose:** Gate for person creation - routes to sot.people (TRUE) or ops.clinic_accounts (FALSE)
**Dependencies:** `classify_owner_name()`, `atlas.soft_blacklist`

```sql
-- Examples:
SELECT atlas.should_be_person('John', 'Doe', 'john@gmail.com', '7075551234');     -- TRUE
SELECT atlas.should_be_person('FFSC', 'Foster', 'info@forgottenfelines.com', NULL); -- FALSE (org email)
SELECT atlas.should_be_person('890 Rockwell', 'Rd', 'test@test.com', NULL);        -- FALSE (address name)
SELECT atlas.should_be_person('Rosa', NULL, NULL, NULL);                           -- FALSE (no identifier)
```

**Rejection reasons:**
1. Email matches @forgottenfelines.com/org pattern
2. Email matches generic org prefix (info@, office@, contact@, admin@)
3. Email in `atlas.soft_blacklist` with `require_name_similarity = TRUE`
4. No email AND no phone (can't match identity)
5. No first name
6. `classify_owner_name()` returns non-person classification

**Rerun:** Yes - deterministic given soft_blacklist state

---

## Layer 4: Identity Resolution

These score and match candidates to existing entities.

### `data_engine_score_candidates(email, phone, first, last, address) → scored_candidates[]`
**Location:** `atlas.data_engine_score_candidates()`
**Purpose:** Find and score potential matches for a new identity
**Dependencies:** `sot.person_identifiers`, `atlas.soft_blacklist`

**Scoring weights:**
| Signal | Weight |
|--------|--------|
| Email exact match | 40% |
| Phone exact match | 25% |
| Name similarity | 25% |
| Address match | 10% |

**Confidence thresholds:**
| Score | Action |
|-------|--------|
| ≥ 0.95 | Auto-match (merge into existing) |
| 0.50-0.95 | Review queue (needs staff decision) |
| < 0.50 | Create new entity |

**Rerun:** Yes - deterministic given current SOT state

---

### `data_engine_resolve_identity(email, phone, first, last, address, source) → decision`
**Location:** `atlas.data_engine_resolve_identity()`
**Purpose:** Single fortress for all identity decisions
**Output:** `{decision_type, person_id, confidence, match_details}`

**Decision types:**
- `auto_match` - High confidence match to existing person
- `review_pending` - Medium confidence, needs staff review
- `new_entity` - Low confidence, create new person
- `rejected` - Failed gating (no identifiers, org email, etc.)
- `household_member` - Same address as existing, different person

**Rerun:** Yes - deterministic given SOT state

---

## Layer 5: Entity Creation Functions

These create or find existing entities. All are idempotent.

### `find_or_create_person(email, phone, first, last, address, source) → person_id`
**Location:** `atlas.find_or_create_person()`
**Purpose:** Get or create a canonical person record
**Dependencies:** `should_be_person()`, `data_engine_resolve_identity()`

**Behavior:**
1. Calls `should_be_person()` - if FALSE, returns NULL (route to clinic_accounts)
2. Calls `data_engine_resolve_identity()` - gets match decision
3. If match: returns existing person_id
4. If new: creates person, adds identifiers, returns new person_id
5. If review: creates person, flags for review, returns new person_id

**Idempotent:** Yes - same input → same person_id

---

### `find_or_create_cat_by_microchip(chip, name, sex, breed, ...) → cat_id`
**Location:** `atlas.find_or_create_cat_by_microchip()`
**Purpose:** Get or create a canonical cat record by microchip
**Dependencies:** `extract_microchip_from_animal_name()`, microchip validation

**Behavior:**
1. Validates microchip format (15 digits, not junk pattern)
2. Looks up existing cat by microchip
3. If found: returns existing cat_id, optionally updates fields (survivorship)
4. If not found: creates new cat with microchip identifier

**Idempotent:** Yes - same microchip → same cat_id

---

### `find_or_create_place_deduped(address, name, lat, lng, source) → place_id`
**Location:** `atlas.find_or_create_place_deduped()`
**Purpose:** Get or create a canonical place record
**Dependencies:** `normalize_address()`, geocoding

**Deduplication order:**
1. Google Place ID (most reliable)
2. Normalized address exact match
3. Coordinate proximity (10m for coordinate-only)
4. If no match: create new place

**Idempotent:** Yes - same address → same place_id

---

## Layer 6: Relationship Functions

These create relationships between entities. All use ON CONFLICT for idempotency.

### `link_cat_to_place(cat_id, place_id, rel_type, evidence_type, source, confidence)`
**Location:** `atlas.link_cat_to_place()`
**Purpose:** Create cat-place relationship with validation

**Validation:**
- Cat exists and not merged
- Place exists and not merged
- rel_type valid (home, appointment_site, trapped_at, etc.)
- evidence_type valid (appointment, observation, manual, etc.)

**Behavior:** ON CONFLICT updates confidence if higher

**Idempotent:** Yes

---

### `link_person_to_cat(person_id, cat_id, rel_type, evidence_type, source)`
**Location:** `atlas.link_person_to_cat()`
**Purpose:** Create person-cat relationship with validation

**Validation:**
- Person exists and not merged
- Cat exists and not merged
- rel_type valid (owner, caretaker, foster, adopter, etc.)
- evidence_type valid

**Idempotent:** Yes

---

### `link_cats_to_appointment_places()`
**Location:** `atlas.link_cats_to_appointment_places()`
**Purpose:** Batch link cats to places using appointment booking address (ground truth)
**Priority:** Primary method - uses `inferred_place_id` from appointments

**Idempotent:** Yes - uses ON CONFLICT

---

### `link_cats_to_places()`
**Location:** `atlas.link_cats_to_places()`
**Purpose:** Batch link cats to places via person_cat → person_place chain
**Priority:** Secondary method (fallback)

**Critical constraints:**
- LIMIT 1 per person (not ALL addresses)
- Excludes staff/trappers (prevents pollution)
- Excludes business/clinic/outdoor_site place types

**Idempotent:** Yes - uses ON CONFLICT

---

## Layer 7: Enrichment & Household

### `run_all_entity_linking()`
**Location:** `atlas.run_all_entity_linking()`
**Purpose:** Orchestrate all linking in correct order

**Execution order:**
1. `link_appointments_to_owners()` - Backfill owner info on appointments
2. `create_places_from_intake()` - Create places from geocoded intake
3. `link_intake_requesters_to_places()` - Link intake requester to place
4. `run_cat_place_linking()` - Both appointment-based and person-based
5. `run_appointment_trapper_linking()` - Link appointments to trappers

**Idempotent:** Yes - all sub-functions are idempotent

---

## Soft Blacklist (State Required)

The soft blacklist is the ONLY stateful dependency for reprocessing.

**Table:** `atlas.soft_blacklist`

**Current entries:**
| identifier | type | reason |
|------------|------|--------|
| info@forgottenfelines.com | email | FFSC org email |
| sandra@forgottenfelines.com | email | FFSC staff |
| marinferals@yahoo.com | email | Partner org |
| 7075767999 | phone | FFSC org phone |
| (other org emails) | email | Shared org identifiers |

**To recreate cleaned data:**
1. Export `atlas.soft_blacklist`
2. Run transformations from source
3. Soft blacklist ensures same routing decisions

---

## Reprocessing Workflow

**To recreate all cleaned data from source:**

```sql
-- 1. Ensure soft_blacklist is current
-- (Export/import from production if needed)

-- 2. Truncate destination tables (careful!)
TRUNCATE sot.people CASCADE;
TRUNCATE sot.cats CASCADE;
TRUNCATE sot.places CASCADE;
-- etc.

-- 3. Reprocess all source records
SELECT atlas.reprocess_all_from_source();

-- This function should:
-- a. Read all source.staged_records
-- b. Run through classification + gating
-- c. Create entities via find_or_create_*
-- d. Build relationships via link_*
-- e. Run entity linking pipeline
```

**OR incrementally:**

```sql
-- Reprocess single source system
SELECT atlas.reprocess_source_system('clinichq');
SELECT atlas.reprocess_source_system('shelterluv');
-- etc.
```

---

## Transformation Validation

After reprocessing, validate counts match:

```sql
-- Entity counts
SELECT 'people' as entity,
       COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) as count
FROM sot.people
UNION ALL
SELECT 'cats', COUNT(*) FILTER (WHERE merged_into_cat_id IS NULL)
FROM sot.cats
UNION ALL
SELECT 'places', COUNT(*) FILTER (WHERE merged_into_place_id IS NULL)
FROM sot.places;

-- Relationship counts
SELECT 'person_cat' as rel, COUNT(*) FROM sot.person_cat
UNION ALL
SELECT 'cat_place', COUNT(*) FROM sot.cat_place
UNION ALL
SELECT 'person_place', COUNT(*) FROM sot.person_place;

-- Data quality distribution
SELECT data_quality, COUNT(*)
FROM sot.people
WHERE merged_into_person_id IS NULL
GROUP BY data_quality;
```

---

## Scripts Consolidation

All data cleaning scripts should be consolidated into:

```
scripts/pipeline/
├── README.md                      # This registry in runnable form
├── run_full_reprocess.sh          # Nuclear option: source → clean
├── run_entity_linking.sh          # Just relationship building
├── run_source_system.sh           # Reprocess single source
├── validate_counts.sh             # Post-reprocess validation
└── functions/
    ├── 01_normalization.sql       # norm_*, normalize_*
    ├── 02_classification.sql      # classify_*, is_*
    ├── 03_gating.sql              # should_be_person
    ├── 04_identity.sql            # data_engine_*
    ├── 05_entity_creation.sql     # find_or_create_*
    ├── 06_relationships.sql       # link_*
    └── 07_enrichment.sql          # run_all_entity_linking
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-11 | Initial registry creation |
