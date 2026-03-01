# Data Engine Audit Report

**Date:** 2026-01-18
**Auditor:** Claude Code
**Scope:** Deep investigation of data quality issues in Atlas Data Engine

---

## Executive Summary

The Data Engine has created massive data pollution due to three critical bugs:

| Issue | Impact | Scope |
|-------|--------|-------|
| ON CONFLICT identifier bug | 81% of new people missing identifiers | 587 of 726 new_entity decisions |
| Name doubling in source data | Business names doubled | 1,289 records |
| No pre-insert deduplication | Same email creates N duplicates | 462 names with 10+ dupes |

**Overall Impact:**
- 26,132 total people, only 8,795 unique names (3x duplication)
- 14,931 people (57%) have NO identifiers
- Example: Jean Worthey has 119 duplicate records

---

## Root Cause Analysis

### Bug 1: ON CONFLICT DO NOTHING Identifier Bug

**Location:** `MIG_315__data_engine_core_functions.sql`, lines 474-493

**Code:**
```sql
INSERT INTO trapper.person_identifiers (
    person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
) VALUES (
    v_person_id, 'email', p_email_norm, p_email_norm, p_source_system, 1.0
) ON CONFLICT (id_type, id_value_norm) DO NOTHING;  -- ← BUG!
```

**Problem:**
When an identifier (email/phone) already exists for a DIFFERENT person, the INSERT silently fails due to `ON CONFLICT DO NOTHING`. The newly created person has no identifiers stored, making them unmatchable.

**Evidence:**
```sql
-- People created by Data Engine without identifiers
total_new_entity_people: 726
with_identifiers: 139
missing_identifiers: 587 (81%!)
```

**Chain reaction:**
1. Person A created with email `jean@example.com`, identifier stored ✓
2. Record B arrives with same email, Data Engine calls `create_person_basic`
3. Person B created (new row in `sot_people`)
4. INSERT identifier fails silently (email already exists for Person A)
5. Person B has NO identifiers
6. Record C arrives with same email, no match found (Person B unsearchable)
7. Person C created, identifier fails, repeat...
8. Result: 119 duplicate Jean Worthey records

---

### Bug 2: Name Doubling in Source Data

**Location:** Source data from ClinicHQ

**Problem:**
Business names are stored in BOTH first_name AND last_name fields in the source system.

**Evidence:**
```sql
SELECT payload->>'Owner First Name', payload->>'Owner Last Name'
FROM staged_records WHERE source_system = 'clinichq';

-- Result:
-- first_name: "Mick's Door Shop"
-- last_name: "Mick's Door Shop"
```

The Data Engine correctly concatenates: `CONCAT_WS(' ', first, last)` → `"Mick's Door Shop Mick's Door Shop"`

**Affected records:** 1,289 people with doubled names

---

### Bug 3: No Pre-Insert Deduplication

**Location:** `data_engine_resolve_identity` function

**Problem:**
The function doesn't check if the same email/phone is already in the current batch or processing queue before creating a new entity.

**Evidence:**
```sql
-- Jean Worthey example
SELECT COUNT(*) FROM sot_people WHERE display_name = 'Jean Worthey';
-- Result: 119

-- Only first has identifiers
SELECT person_id, identifier_count FROM (
  SELECT p.person_id,
    (SELECT COUNT(*) FROM person_identifiers WHERE person_id = p.person_id) as identifier_count
  FROM sot_people p WHERE display_name = 'Jean Worthey'
) t WHERE identifier_count > 0;
-- Result: Only 1 person has identifiers
```

---

## Impact Summary

### Duplication Stats
| Metric | Value |
|--------|-------|
| Total people | 26,132 |
| Unique display_names | 8,795 |
| Duplication ratio | 3x |
| Names with 5+ duplicates | 1,174 |
| Names with 10+ duplicates | 462 |

### Identifier Stats
| Metric | Value |
|--------|-------|
| People without any identifiers | 14,931 (57%) |
| Data Engine new_entity without identifiers | 587 (81%) |

### Notable Examples
- **Jean Worthey:** 119 duplicates, only 1 with identifiers
- **Mick's Door Shop:** Name doubled as "Mick's Door Shop Mick's Door Shop"
- **Aamco Repair Santa Rosa:** Name doubled
- **sfreele@gmail.com:** Owned by 1 person, but 56 other people have it in primary_email

---

## Required Fixes

### Fix 1: Identifier Insertion (Critical)

**Change:** Instead of `ON CONFLICT DO NOTHING`, check first and handle appropriately.

```sql
-- BEFORE
INSERT INTO person_identifiers (...)
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

-- AFTER
-- Check if identifier exists first
SELECT person_id INTO v_existing_person_id
FROM person_identifiers
WHERE id_type = 'email' AND id_value_norm = p_email_norm;

IF v_existing_person_id IS NULL THEN
    -- Safe to insert
    INSERT INTO person_identifiers (...);
ELSE
    -- Identifier exists for another person - should have matched earlier
    -- Log warning and skip person creation
    RAISE WARNING 'Identifier % already exists for person %', p_email_norm, v_existing_person_id;
END IF;
```

### Fix 2: Name Deduplication

**Change:** Detect and handle when first_name = last_name

```sql
-- BEFORE
v_display_name := TRIM(CONCAT_WS(' ', p_first_name, p_last_name));

-- AFTER
IF LOWER(TRIM(p_first_name)) = LOWER(TRIM(p_last_name)) THEN
    v_display_name := TRIM(p_first_name);  -- Use only one copy
ELSE
    v_display_name := TRIM(CONCAT_WS(' ', p_first_name, p_last_name));
END IF;
```

### Fix 3: Pre-Resolution Identifier Check

**Change:** Before creating a new entity, verify the identifier isn't already linked.

In `data_engine_resolve_identity`, before the `ELSIF candidates_count = 0` branch:

```sql
-- Check if identifier already exists but wasn't matched (shouldn't happen)
IF v_email_norm IS NOT NULL THEN
    SELECT person_id INTO v_existing_person_id
    FROM person_identifiers
    WHERE id_type = 'email' AND id_value_norm = v_email_norm;

    IF v_existing_person_id IS NOT NULL THEN
        -- Force match to existing person
        v_decision_type := 'auto_match';
        v_decision_reason := 'Matched by existing email identifier';
        RETURN v_existing_person_id;
    END IF;
END IF;
```

### Fix 4: Business Name Detection

**Change:** Add detection for business/organization names

```sql
CREATE OR REPLACE FUNCTION trapper.is_business_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_name ~* '(^|\s)(llc|inc|corp|company|co\.|ltd|shop|store|repair|auto|services?|industries|center|clinic|hospital|dairy|ranch|farm|association|foundation|rescue|shelter|animal|control|society)(\s|$)'
        OR p_name ~* '(^|\s)(the\s+\w+\s+(of|at|on|in))';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Data Cleanup Required

### Step 1: Merge Duplicates
For each set of duplicates (same email/phone), merge into the person with the most identifiers/appointments.

### Step 2: Backfill Missing Identifiers
For people with primary_email/primary_phone but no person_identifiers, create the missing identifiers.

### Step 3: Mark Business Entities
Flag or categorize business names as entity_type = 'organization'.

### Step 4: Fix Doubled Names
For records matching pattern `^(.+) \1$`, update to single copy.

---

## Migration Files Needed

1. `MIG_350__fix_identifier_insertion.sql` - Fix ON CONFLICT bug
2. `MIG_351__fix_name_deduplication.sql` - Fix doubled names
3. `MIG_352__add_business_detection.sql` - Add business name detection
4. `MIG_353__cleanup_duplicates.sql` - Merge existing duplicates
5. `MIG_354__backfill_identifiers.sql` - Add missing identifiers

---

## Verification Queries

After fixes are applied:

```sql
-- No new people without identifiers
SELECT COUNT(*) FROM sot_people p
LEFT JOIN person_identifiers pi ON pi.person_id = p.person_id
WHERE pi.person_id IS NULL
  AND p.primary_email IS NOT NULL;
-- Expected: 0

-- No doubled names
SELECT COUNT(*) FROM sot_people WHERE display_name ~ '^(.+) \1$';
-- Expected: 0

-- Reduced duplication
SELECT COUNT(*), COUNT(DISTINCT display_name) FROM sot_people;
-- Expected: Ratio closer to 1:1
```
