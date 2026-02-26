# Entity Linking Fortification Plan

**Created:** 2026-02-21 (Post-Audit)
**Status:** PLANNED
**Related:** DATA_GAP_040, DATA_GAP_041

---

## Executive Summary

Comprehensive audit identified fragile patterns in entity linking functions that can cause silent data loss, incorrect cat-place links, and cascading failures. This plan addresses all identified issues with prioritized fixes.

---

## Issue Summary

| Priority | Issue | Function | Impact |
|----------|-------|----------|--------|
| **P0** | Clinic fallback pollution | `link_cats_to_appointment_places()` | Cats linked to clinic instead of residential |
| **P0** | Silent NULL updates | `link_appointments_to_places()` | Appointments lose place_id |
| **P1** | No step validation | `run_all_entity_linking()` | Later steps run on bad data |
| **P1** | LATERAL join NULLs | `link_cats_to_places()` | Incomplete relationships |
| **P2** | String confidence | `link_cat_to_place()` | Fragile comparison |
| **P2** | Duplicated confidence filter | 50+ places | Inconsistent filtering |

---

## Phase 1: Critical Fixes (P0)

### 1.1 Remove Clinic Fallback — MIG_2430

**Problem:** `link_cats_to_appointment_places()` uses `COALESCE(a.inferred_place_id, a.place_id)` which falls back to clinic address when owner's inferred place is NULL.

**Current Code (MIG_2010:410):**
```sql
INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, ...)
SELECT DISTINCT ON (a.cat_id)
    a.cat_id,
    COALESCE(a.inferred_place_id, a.place_id),  -- Falls back to clinic!
    'home',
    ...
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL;
```

**Fix:**
```sql
-- MIG_2430: Remove clinic fallback, only link when inferred_place_id exists
CREATE OR REPLACE FUNCTION sot.link_cats_to_appointment_places()
RETURNS INTEGER AS $$
DECLARE
    v_linked INTEGER;
BEGIN
    INSERT INTO sot.cat_place (
        cat_id,
        place_id,
        relationship_type,
        confidence,
        evidence_type,
        source_table,
        source_system
    )
    SELECT DISTINCT ON (a.cat_id)
        a.cat_id,
        a.inferred_place_id,  -- NO FALLBACK - must have real address
        'home',
        'high',
        'appointment',
        'link_cats_to_appointment_places',
        'entity_linking'
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    JOIN sot.places p ON p.place_id = a.inferred_place_id  -- JOIN ensures place exists
    WHERE a.cat_id IS NOT NULL
      AND a.inferred_place_id IS NOT NULL  -- Explicit NULL filter
      AND sot.should_compute_disease_for_place(a.inferred_place_id)  -- Not clinic/blacklisted
      AND NOT EXISTS (
          SELECT 1 FROM sot.cat_place cp
          WHERE cp.cat_id = a.cat_id
            AND cp.place_id = a.inferred_place_id
      )
    ORDER BY a.cat_id, a.appointment_date DESC;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    -- Log cats that couldn't be linked (for monitoring)
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT 'cat', a.cat_id, 'no_inferred_place_id', NOW()
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.inferred_place_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id)
    ON CONFLICT DO NOTHING;

    RETURN v_linked;
END;
$$ LANGUAGE plpgsql;
```

**Verification:**
```sql
-- Should return 0 cats linked to clinic addresses
SELECT COUNT(*) FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE p.place_kind = 'clinic'
   OR p.formatted_address ILIKE '%1814%Empire Industrial%'
   OR p.formatted_address ILIKE '%1820%Empire Industrial%'
   OR p.formatted_address ILIKE '%845 Todd%';
```

---

### 1.2 Prevent Silent NULL Updates — MIG_2431

**Problem:** `link_appointments_to_places()` uses UPDATE with subquery that can return NULL.

**Current Code:**
```sql
UPDATE ops.appointments a
SET place_id = (
    SELECT p.place_id
    FROM sot.places p
    WHERE normalize_address(p.formatted_address) = normalize_address(...)
    LIMIT 1
)
WHERE a.place_id IS NULL;
-- If subquery returns NULL, place_id stays NULL but no error raised
```

**Fix:**
```sql
-- MIG_2431: Use explicit JOIN to prevent NULL updates
CREATE OR REPLACE FUNCTION sot.link_appointments_to_places()
RETURNS INTEGER AS $$
DECLARE
    v_linked INTEGER;
    v_unmatched INTEGER;
BEGIN
    -- Use explicit CTE + JOIN pattern instead of subquery UPDATE
    WITH appointment_place_matches AS (
        SELECT
            a.appointment_id,
            p.place_id,
            ROW_NUMBER() OVER (
                PARTITION BY a.appointment_id
                ORDER BY p.created_at DESC
            ) as rn
        FROM ops.appointments a
        JOIN sot.places p ON normalize_address(p.formatted_address) =
            normalize_address(a.owner_address)
        WHERE a.place_id IS NULL
          AND a.owner_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
    ),
    updates AS (
        UPDATE ops.appointments a
        SET place_id = m.place_id
        FROM appointment_place_matches m
        WHERE a.appointment_id = m.appointment_id
          AND m.rn = 1
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_linked FROM updates;

    -- Count appointments that couldn't be matched (for monitoring)
    SELECT COUNT(*) INTO v_unmatched
    FROM ops.appointments
    WHERE place_id IS NULL
      AND owner_address IS NOT NULL;

    -- Log if significant unmatched count
    IF v_unmatched > 100 THEN
        RAISE NOTICE 'link_appointments_to_places: % appointments could not be matched', v_unmatched;
    END IF;

    RETURN v_linked;
END;
$$ LANGUAGE plpgsql;
```

---

## Phase 2: High Priority Fixes (P1)

### 2.1 Add Step Validation to Orchestrator — MIG_2432

**Problem:** `run_all_entity_linking()` runs all steps sequentially with no validation between steps.

**Fix:**
```sql
-- MIG_2432: Add validation and monitoring to entity linking orchestrator
CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_step_result INTEGER;
    v_appointments_with_place INTEGER;
    v_cats_with_place INTEGER;
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Step 1: Link appointments to places
    PERFORM sot.link_appointments_to_places();
    SELECT COUNT(*) INTO v_appointments_with_place
    FROM ops.appointments WHERE place_id IS NOT NULL;
    v_result := v_result || jsonb_build_object(
        'step1_appointments_to_places', v_appointments_with_place
    );

    -- Validation: At least 90% of appointments should have places
    IF v_appointments_with_place < (SELECT COUNT(*) * 0.9 FROM ops.appointments) THEN
        RAISE WARNING 'Step 1 validation failed: only % appointments have places', v_appointments_with_place;
        v_result := v_result || '{"warning": "step1_low_coverage"}'::jsonb;
    END IF;

    -- Step 2: Link cats to appointment places (depends on Step 1)
    v_step_result := sot.link_cats_to_appointment_places();
    v_result := v_result || jsonb_build_object(
        'step2_cats_to_appointment_places', v_step_result
    );

    -- Step 3: Link cats to places via person chain
    v_step_result := sot.link_cats_to_places();
    v_result := v_result || jsonb_build_object(
        'step3_cats_to_places', v_step_result
    );

    -- Final validation
    SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_place
    FROM sot.cat_place;
    v_result := v_result || jsonb_build_object(
        'total_cats_with_place', v_cats_with_place,
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::int,
        'status', 'completed'
    );

    -- Log result to audit table
    INSERT INTO ops.entity_linking_runs (result, created_at)
    VALUES (v_result, NOW());

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Supporting table for run history
CREATE TABLE IF NOT EXISTS ops.entity_linking_runs (
    run_id SERIAL PRIMARY KEY,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supporting table for skipped entities
CREATE TABLE IF NOT EXISTS ops.entity_linking_skipped (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, reason)
);

CREATE INDEX idx_entity_linking_skipped_type ON ops.entity_linking_skipped(entity_type, reason);
```

---

### 2.2 Fix LATERAL Join NULL Returns — MIG_2433

**Problem:** `link_cats_to_places()` uses LATERAL join that can return incomplete data.

**Current Issue:**
```sql
SELECT ...
FROM sot.person_cat pc
JOIN sot.people p ON ...
CROSS JOIN LATERAL (
    SELECT pp.place_id
    FROM sot.person_place pp
    WHERE pp.person_id = p.person_id
    ORDER BY pp.confidence DESC
    LIMIT 1
) best_place
-- If person has no person_place, cat is silently skipped
```

**Fix:**
```sql
-- MIG_2433: Make LATERAL join explicit and log skipped cats
CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS INTEGER AS $$
DECLARE
    v_linked INTEGER;
BEGIN
    -- Link cats via person chain (owner/adopter/foster → residence)
    INSERT INTO sot.cat_place (
        cat_id,
        place_id,
        relationship_type,
        confidence,
        evidence_type,
        source_table,
        source_system
    )
    SELECT
        pc.cat_id,
        pp.place_id,
        CASE pc.relationship_type
            WHEN 'owner' THEN 'home'
            WHEN 'adopter' THEN 'home'
            WHEN 'foster' THEN 'home'
            WHEN 'caretaker' THEN 'residence'
            WHEN 'colony_caretaker' THEN 'colony_member'
            ELSE 'residence'
        END,
        CASE pc.relationship_type
            WHEN 'owner' THEN 'high'
            WHEN 'adopter' THEN 'high'
            ELSE 'medium'
        END,
        'person_relationship',
        'link_cats_to_places',
        'entity_linking'
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    JOIN sot.people p ON p.person_id = pc.person_id AND p.merged_into_person_id IS NULL
    JOIN LATERAL (
        SELECT pp.place_id, pp.confidence
        FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
        WHERE pp.person_id = p.person_id
          AND sot.should_compute_disease_for_place(pp.place_id)  -- Exclude clinic/blacklisted
        ORDER BY pp.confidence DESC, pp.created_at DESC
        LIMIT 1
    ) pp ON TRUE
    -- Exclude staff/trappers (INV-12)
    WHERE NOT EXISTS (
        SELECT 1 FROM sot.person_roles pr
        WHERE pr.person_id = p.person_id
          AND pr.role IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'staff')
    )
    AND NOT EXISTS (
        SELECT 1 FROM sot.cat_place cp
        WHERE cp.cat_id = pc.cat_id AND cp.place_id = pp.place_id
    )
    ON CONFLICT (cat_id, place_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    -- Log cats that couldn't be linked (person has no place)
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT DISTINCT 'cat', pc.cat_id, 'person_has_no_place', NOW()
    FROM sot.person_cat pc
    JOIN sot.people p ON p.person_id = pc.person_id AND p.merged_into_person_id IS NULL
    WHERE NOT EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.person_id = p.person_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id
    )
    ON CONFLICT DO NOTHING;

    RETURN v_linked;
END;
$$ LANGUAGE plpgsql;
```

---

## Phase 3: Medium Priority Fixes (P2)

### 3.1 Convert String Confidence to Enum — MIG_2434

**Problem:** `confidence` column uses TEXT with values 'high', 'medium', 'low'. String comparison is fragile.

**Fix:**
```sql
-- MIG_2434: Add confidence enum and migrate data
CREATE TYPE sot.confidence_level AS ENUM ('high', 'medium', 'low');

-- Add new column
ALTER TABLE sot.cat_place ADD COLUMN confidence_level sot.confidence_level;

-- Migrate data
UPDATE sot.cat_place SET confidence_level = confidence::sot.confidence_level
WHERE confidence IN ('high', 'medium', 'low');

-- Default NULL to 'medium'
UPDATE sot.cat_place SET confidence_level = 'medium'
WHERE confidence_level IS NULL;

-- Set NOT NULL after migration
ALTER TABLE sot.cat_place ALTER COLUMN confidence_level SET NOT NULL;

-- Update insert function to use enum
-- (Update link_cat_to_place and related functions)
```

---

### 3.2 Apply Confidence Helper Functions — MIG_2421 Already Created

**Status:** Migration exists at `/sql/schema/v2/MIG_2421__confidence_helper_function.sql`

**Adoption Plan:**

| Step | Action | Files to Update |
|------|--------|-----------------|
| 1 | Apply MIG_2421 | Database |
| 2 | Update views to use `sot.get_email()` | v_request_list, v_person_list_v3 |
| 3 | Update API routes | `/api/requests/[id]`, `/api/people/[id]` |
| 4 | Remove inline confidence filters | Grep for `confidence >= 0.5` |

---

## Phase 4: Monitoring & Prevention

### 4.1 Create Audit Views — MIG_2435

```sql
-- MIG_2435: Entity linking health monitoring

-- View: Cats without any place links
CREATE OR REPLACE VIEW ops.v_cats_without_places AS
SELECT
    c.cat_id,
    c.name,
    c.microchip,
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
    (SELECT MAX(a.appointment_date) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as last_appointment
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id);

-- View: Clinic leakage detection
CREATE OR REPLACE VIEW ops.v_clinic_leakage AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    COUNT(DISTINCT cp.cat_id) as cat_count,
    cp.source_table,
    cp.relationship_type
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE p.place_kind = 'clinic'
   OR p.formatted_address ILIKE '%1814%Empire Industrial%'
   OR p.formatted_address ILIKE '%1820%Empire Industrial%'
   OR p.formatted_address ILIKE '%845 Todd%'
GROUP BY p.place_id, p.display_name, p.formatted_address, cp.source_table, cp.relationship_type;

-- View: Entity linking run history
CREATE OR REPLACE VIEW ops.v_entity_linking_history AS
SELECT
    run_id,
    result->>'status' as status,
    (result->>'step1_appointments_to_places')::int as step1_count,
    (result->>'step2_cats_to_appointment_places')::int as step2_count,
    (result->>'step3_cats_to_places')::int as step3_count,
    (result->>'total_cats_with_place')::int as total_cats,
    (result->>'duration_ms')::int as duration_ms,
    created_at
FROM ops.entity_linking_runs
ORDER BY created_at DESC;

-- View: Skipped entities summary
CREATE OR REPLACE VIEW ops.v_entity_linking_skipped_summary AS
SELECT
    entity_type,
    reason,
    COUNT(*) as count,
    MAX(created_at) as last_seen
FROM ops.entity_linking_skipped
GROUP BY entity_type, reason
ORDER BY count DESC;
```

---

## Implementation Order

| Order | Migration | Description | Depends On |
|-------|-----------|-------------|------------|
| 1 | MIG_2430 | Remove clinic fallback | None |
| 2 | MIG_2431 | Fix silent NULL updates | None |
| 3 | MIG_2432 | Add orchestrator validation | MIG_2430, MIG_2431 |
| 4 | MIG_2433 | Fix LATERAL join NULLs | None |
| 5 | MIG_2421 | Apply confidence helpers | None |
| 6 | MIG_2434 | Convert confidence to enum | MIG_2421 |
| 7 | MIG_2435 | Add monitoring views | MIG_2432 |

---

## Verification Checklist

```bash
# 1. Run cat-place audit query
psql -f sql/queries/QRY_050__cat_place_audit.sql

# 2. Check clinic leakage (should be 0 after fix)
psql -c "SELECT * FROM ops.v_clinic_leakage;"

# 3. Check entity linking history
psql -c "SELECT * FROM ops.v_entity_linking_history LIMIT 5;"

# 4. Check skipped entities
psql -c "SELECT * FROM ops.v_entity_linking_skipped_summary;"

# 5. Verify confidence filter adoption
grep -r "confidence >= 0.5" apps/web/src/app/api/
# Should decrease after MIG_2421 adoption
```

---

## Success Criteria

- [ ] No cats linked to clinic addresses (clinic leakage = 0)
- [ ] Entity linking runs logged with validation metrics
- [ ] Skipped entities tracked with reasons
- [ ] Confidence helpers adopted in 90%+ of views/routes
- [ ] All audit queries pass (QRY_050)
- [ ] CLAUDE.md updated with new invariants

---

## Related Documentation

| Document | Section |
|----------|---------|
| `docs/DATA_GAPS.md` | DATA_GAP_040, DATA_GAP_041 |
| `CLAUDE.md` | INV-26, INV-28, INV-41, INV-42 |
| `sql/queries/QRY_050__cat_place_audit.sql` | Audit query |
| `sql/schema/v2/MIG_2421__confidence_helper_function.sql` | Confidence helpers |
