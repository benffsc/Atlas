# Intake → Request Data Flow Audit

**Date:** 2026-02-26
**Purpose:** Document how data flows from intake to request, identify redundancies, and define how requests enrich entity data.

---

## Executive Summary

This audit analyzes:
1. **Call Sheet** (phone intake) fields
2. **Web Intake Form** (online submission) fields
3. **Request** table columns
4. **Intake Submissions** table columns

**Key Findings:**
- Many fields are captured in intake but not carried forward to requests
- Some questions are asked twice when converting intake → request
- Request data has untapped potential to enrich People, Places, and Cats
- The relationship between requester and site contact is now tracked (MIG_2522) but not consistently used

---

## Part 1: Field Inventory Comparison

### Contact Information

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| First Name | ✅ | ✅ | `first_name` | via `requester_person_id` | Person linked, not stored on request |
| Last Name | ✅ | ✅ | `last_name` | via `requester_person_id` | Person linked, not stored on request |
| Email | ✅ | ✅ | `email` | via `requester_person_id` | Person linked |
| Phone | ✅ | ✅ | `phone` | via `requester_person_id` | Person linked |
| Third Party Report | ✅ | ✅ | `is_third_party_report` | ❌ | **MISSING from request** |
| Third Party Relationship | ✅ | ✅ | `third_party_relationship` | ❌ | **MISSING from request** |
| Property Owner Name | ✅ | ✅ | `property_owner_name` | via `site_contact_person_id` | Now linked (MIG_2522) |
| Property Owner Phone | ✅ | ✅ | `property_owner_phone` | via `site_contact_person_id` | Now linked (MIG_2522) |
| Property Owner Email | ✅ | ✅ | `property_owner_email` | via `site_contact_person_id` | Now linked (MIG_2522) |

### Location Information

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Address | ✅ | ✅ | `cats_address` | via `place_id` | Place linked |
| City | ✅ | ✅ | `cats_city` | via `place_id` | Place linked |
| ZIP | ✅ | ✅ | `cats_zip` | via `place_id` | Place linked |
| County | ✅ | ✅ | `county` | ❌ | **MISSING - important for service area** |
| Property Type | ✅ | ✅ | `property_type` | `property_type` | ✅ Mapped |
| Is Property Owner | ✅ | ✅ | `is_property_owner` | `is_property_owner` | ✅ Mapped (MIG_2531) |
| Has Property Access | ✅ | ✅ | `has_property_access` | `has_property_access` | ✅ Mapped (MIG_2531) |
| Access Notes | ✅ | ✅ | `access_notes` | `access_notes` | ✅ Mapped (MIG_2531) |

### Cat Count & Colony Assessment

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Cat Count | ✅ | ✅ | `cat_count_estimate` | `total_cats_reported` | ✅ Mapped |
| Cats Needing TNR | ✅ | ✅ | `cats_needing_tnr` | `estimated_cat_count` | ✅ Mapped |
| Count Confidence | ✅ | ✅ | `count_confidence` | `count_confidence` | ✅ Mapped (MIG_2531) |
| Peak Count | ❌ | ✅ | `peak_count` | ❌ | **MISSING - critical for Beacon** |
| Eartip Count | ✅ | ✅ | `eartip_count_observed` | `eartip_count_observed` | ✅ Mapped (MIG_2531) |
| Fixed Status | ✅ | ✅ | `fixed_status` | `fixed_status` | ✅ Mapped (MIG_2531) |
| Colony Duration | ✅ | ✅ | `colony_duration` | `colony_duration` | ✅ Mapped (MIG_2531) |
| Awareness Duration | ✅ | ✅ | `awareness_duration` | ❌ | **MISSING from request** |

### Cat Identification (Single Cat)

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Cat Name | ✅ | ✅ | `cat_name` | `cat_name` | ✅ Mapped (MIG_2531) |
| Cat Description | ✅ | ✅ | `cat_description` | `cat_description` | ✅ Mapped (MIG_2531) |

### Kitten Assessment

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Has Kittens | ✅ | ✅ | `has_kittens` | `has_kittens` | ✅ Mapped |
| Kitten Count | ✅ | ✅ | `kitten_count` | `kitten_count` | ✅ Mapped |
| Kitten Age | ✅ | ✅ | `kitten_age_estimate` | `kitten_age_estimate` | ✅ Mapped |
| Kitten Behavior | ✅ | ✅ | `kitten_behavior` | `kitten_behavior` | ✅ Mapped (MIG_2531) |
| Kitten Contained | ✅ | ✅ | `kitten_contained` | ❌ | **MISSING from request** |
| Mom Present | ✅ | ✅ | `mom_present` | `mom_present` | ✅ Mapped (MIG_2531) |
| Mom Fixed | ✅ | ✅ | `mom_fixed` | ❌ | **MISSING from request** |
| Can Bring In | ✅ | ✅ | `can_bring_in` | ❌ | **MISSING from request** |
| Kitten Notes | ✅ | ✅ | `kitten_notes` | ❌ | Goes into notes |

### Medical & Emergency

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Has Medical Concerns | ✅ | ✅ | `has_medical_concerns` | `has_medical_concerns` | ✅ Mapped (MIG_2531) |
| Medical Description | ✅ | ✅ | `medical_description` | `medical_description` | ✅ Mapped (MIG_2531) |
| Is Emergency | ✅ | ✅ | `is_emergency` | ❌ | **Drives priority but not stored** |

### Feeding & Access Logistics

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Cats Being Fed | ✅ | ✅ | `cats_being_fed` | `is_being_fed` | ✅ Mapped (MIG_2531) |
| Feeder Info/Name | ✅ | ✅ | `feeder_info` | `feeder_name` | ✅ Mapped (MIG_2531) |
| Feeding Frequency | ✅ | ✅ | `feeding_frequency` | `feeding_frequency` | ✅ Mapped (MIG_2531) |
| Feeding Time | ✅ | ❌ | `feeding_time` | ❌ | Call sheet only |
| Where Cats Eat | ✅ | ❌ | ❌ | ❌ | **Call sheet only - valuable** |
| Best Day/Time Trapping | ✅ | ❌ | ❌ | `scheduled_time_range` | Partial match |

### Trapping Characteristics

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Handleability | ✅ | ✅ | `handleability` | `handleability` | ✅ Mapped (MIG_2531) |
| Dogs on Site | ✅ | ❌ | ❌ | `dogs_on_site` | **Call sheet → request only** |
| Trap Savvy | ✅ | ❌ | ❌ | `trap_savvy` | **Call sheet → request only** |
| Previous TNR | ✅ | ❌ | ❌ | `previous_tnr` | **Call sheet → request only** |
| Important Notes (flags) | ✅ | ❌ | ❌ | `important_notes` | Array of checkboxes |

### Staff Assessment

| Field | Call Sheet | Web Intake | Intake Table | Request Table | Notes |
|-------|:----------:|:----------:|:------------:|:-------------:|-------|
| Priority | ✅ | Auto | `triage_priority` | `priority` | ✅ Auto-computed |
| Triage Category | ✅ | Auto | `triage_category` | ❌ | Lost after conversion |
| Received By | ✅ | Auto | `received_by` | ❌ | **Should be audit trail** |
| Call Date | ✅ | Auto | `created_at` | `source_created_at` | ✅ Preserved |

---

## Part 2: Data Flow Analysis

### Current Flow: Web Intake → Request

```
1. User submits web form
   ↓
2. Creates ops.intake_submissions record
   ↓
3. Async: match_intake_to_person() - creates/links person
   ↓
4. Async: link_intake_to_place() - creates/links place
   ↓
5. Staff converts via convert_intake_to_request()
   ↓
6. Creates ops.requests record
```

**Problems with Current Flow:**
- Some fields dumped into `situation_description` text (FIXED by MIG_2531)
- Some fields stored in `custom_fields` JSONB (FIXED by MIG_2531)
- Property owner creates separate person but not linked as site_contact
- Peak count and eartip count not carried to request (Beacon impact)
- Third-party report flag lost (affects requester intelligence)

### Current Flow: Call Sheet → Request

```
1. Staff enters data in call sheet form
   ↓
2. Creates ops.intake_submissions record
   ↓
3. Same flow as web intake...
```

**Additional Problems with Call Sheet:**
- More fields captured but not all have columns
- Where cats eat, feeding time → not stored
- Dogs, trap savvy, previous TNR → only on request if staff re-enters

---

## Part 3: Entity Enrichment Opportunities

### How Request Data Can Enrich PLACES

| Request Field | Place Enrichment | Mechanism |
|--------------|------------------|-----------|
| `property_type` | `place.place_kind` | Direct mapping |
| `colony_duration` | `place_colony_estimates.established_duration` | Create/update estimate |
| `total_cats_reported` | `place_colony_estimates.reported_count` | Create/update estimate |
| `peak_count` | `place_colony_estimates.peak_observed` | **Critical for Beacon** |
| `eartip_count_observed` | `place_colony_estimates.eartipped_count` | Mark-resight data |
| `has_property_access` | `place.access_level` | New field needed |
| `access_notes` | `place.access_notes` | New field needed |
| `dogs_on_site` | `place.safety_concerns[]` | Add 'dogs' to array |
| `trap_savvy` | `place.trapping_notes` | Historical context |
| `previous_tnr` | `place.historical_tnr_status` | New field needed |
| `is_property_owner` via person | `person_place.relationship_type` | Set 'owner' vs 'resident' |
| `handleability` | `place.typical_handleability` | New field needed |

### How Request Data Can Enrich PEOPLE

| Request Field | Person Enrichment | Mechanism |
|--------------|-------------------|-----------|
| `requester_role_at_submission` | `person.is_trapper`, `person.is_frequent_caller` | Update flags |
| `is_third_party_report` | `person_place.relationship_type` | Set 'referrer' not 'resident' |
| `feeder_name` | Create/link person | New feeder person record |
| `site_contact_*` | Create/link person | MIG_2522 handles this |
| Requester's other addresses | `person_place` | Learn about their properties |
| Contact preferences | `person.preferred_contact_method` | Exists, should update |

### How Request Data Can Enrich CATS

| Request Field | Cat Enrichment | Mechanism |
|--------------|----------------|-----------|
| `cat_name` | `cat.name` | If linked via appointment |
| `cat_description` | `cat.description` | Physical description |
| `handleability` | `cat.temperament` | New field needed |
| `has_medical_concerns` + `medical_description` | `cat.medical_notes` | Link if cat identified |

---

## Part 4: Proposed Solutions

### A. Fields to Add to Requests Table

```sql
-- MIG_2532: Complete request field coverage
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_third_party_report BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS third_party_relationship TEXT,
ADD COLUMN IF NOT EXISTS county TEXT,
ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS awareness_duration TEXT,
ADD COLUMN IF NOT EXISTS peak_count INTEGER,  -- Critical for Beacon
ADD COLUMN IF NOT EXISTS kitten_contained TEXT,
ADD COLUMN IF NOT EXISTS mom_fixed TEXT,
ADD COLUMN IF NOT EXISTS can_bring_in TEXT,
ADD COLUMN IF NOT EXISTS feeding_location TEXT,
ADD COLUMN IF NOT EXISTS feeding_time TEXT,
ADD COLUMN IF NOT EXISTS triage_category TEXT,  -- Preserve for analytics
ADD COLUMN IF NOT EXISTS received_by TEXT;
```

### B. Entity Enrichment Functions

```sql
-- Function to enrich place from request data
CREATE OR REPLACE FUNCTION ops.enrich_place_from_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT * INTO v_req FROM ops.requests WHERE request_id = p_request_id;
  IF NOT FOUND OR v_req.place_id IS NULL THEN RETURN; END IF;

  -- Update place colony estimate
  INSERT INTO sot.place_colony_estimates (
    place_id,
    reported_count,
    peak_observed,
    eartipped_count,
    established_duration,
    source_type,
    source_request_id
  ) VALUES (
    v_req.place_id,
    v_req.total_cats_reported,
    v_req.peak_count,
    v_req.eartip_count_observed,
    v_req.colony_duration,
    'request_report',
    v_req.request_id
  )
  ON CONFLICT (place_id) DO UPDATE
  SET reported_count = COALESCE(EXCLUDED.reported_count, place_colony_estimates.reported_count),
      peak_observed = GREATEST(EXCLUDED.peak_observed, place_colony_estimates.peak_observed),
      updated_at = NOW();

  -- Add safety concerns if dogs
  IF v_req.dogs_on_site = 'yes' THEN
    UPDATE sot.places
    SET safety_concerns = array_append(
      COALESCE(safety_concerns, '{}'),
      'dogs'
    )
    WHERE place_id = v_req.place_id
      AND NOT ('dogs' = ANY(COALESCE(safety_concerns, '{}')));
  END IF;
END;
$$ LANGUAGE plpgsql;
```

### C. Intake → Request Conversion Improvements

The `convert_intake_to_request()` function should:
1. Map ALL intake fields to request columns (not just some)
2. Create site_contact person if property owner info provided
3. Set `is_third_party_report` and link requester as 'referrer' not 'resident'
4. Call `enrich_place_from_request()` after creating request
5. Preserve `triage_category` for analytics

### D. Call Sheet Improvements

1. **Add missing columns to intake_submissions:**
   - `feeding_location` (where cats eat)
   - `feeding_time` (what time fed)
   - `dogs_on_site`, `trap_savvy`, `previous_tnr` (currently only on request)

2. **Sync call sheet fields with intake_submissions:**
   - Ensure API route saves all call sheet fields
   - Don't require manual re-entry when converting

---

## Part 5: "Don't Re-Ask" Rules

### When Converting Intake → Request:

| Category | Rule | Implementation |
|----------|------|----------------|
| **Contact Info** | Never re-ask | Person already linked |
| **Location** | Never re-ask | Place already linked |
| **Cat Count** | Never re-ask | Copy from intake |
| **Kittens** | Never re-ask | Copy from intake |
| **Medical** | Never re-ask | Copy from intake |
| **Access** | Show pre-filled | Allow edit if changed |
| **Feeding** | Show pre-filled | Allow edit if changed |
| **Trapping specifics** | Ask if missing | Dogs, trap savvy, etc. |

### Staff Quick-Add Fields (Not in Web Intake):

These are only asked during call sheet or when staff reviews:
- Dogs on site
- Trap savvy
- Previous TNR
- Best trapping times
- Important notes/flags
- Detailed cat descriptions

---

## Part 6: Implementation Priority

### Phase 1: Critical (Do Now)
1. Add `peak_count` to requests (Beacon needs this)
2. Add `is_third_party_report` to requests (affects entity linking)
3. Update `convert_intake_to_request()` to map ALL fields
4. Create `enrich_place_from_request()` function

### Phase 2: Important (Next)
1. Add missing columns to intake_submissions (feeding_location, etc.)
2. Update call sheet API to save all fields
3. Create `enrich_person_from_request()` function
4. Add relationship_type inference for third-party reporters

### Phase 3: Enhancement (Later)
1. Build request enrichment cron job
2. Backfill existing requests → place/person enrichment
3. Create data quality dashboard for field coverage
4. Add "don't re-ask" UI indicators in request view

---

## Appendix: Field Mapping Reference

### Web Intake Form Field → Database Column

```typescript
const INTAKE_TO_DB_MAPPING = {
  // Contact
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
  is_third_party_report: 'is_third_party_report',
  third_party_relationship: 'third_party_relationship',
  property_owner_name: 'property_owner_name',
  property_owner_phone: 'property_owner_phone',
  property_owner_email: 'property_owner_email',

  // Location
  cats_address: 'cats_address',
  cats_city: 'cats_city',
  cats_zip: 'cats_zip',
  county: 'county',
  property_type: 'property_type',
  is_property_owner: 'is_property_owner',
  has_property_access: 'has_property_access',
  access_notes: 'access_notes',

  // Cats
  cat_count_estimate: 'cat_count_estimate',
  cats_needing_tnr: 'cats_needing_tnr',
  count_confidence: 'count_confidence',
  peak_count: 'peak_count',
  eartip_count: 'eartip_count_observed',
  fixed_status: 'fixed_status',
  colony_duration: 'colony_duration',
  cat_name: 'cat_name',
  cat_description: 'cat_description',
  handleability: 'handleability',

  // Kittens
  has_kittens: 'has_kittens',
  kitten_count: 'kitten_count',
  kitten_age_estimate: 'kitten_age_estimate',
  kitten_behavior: 'kitten_behavior',
  kitten_contained: 'kitten_contained',
  mom_present: 'mom_present',
  mom_fixed: 'mom_fixed',
  can_bring_in: 'can_bring_in',

  // Medical
  has_medical_concerns: 'has_medical_concerns',
  medical_description: 'medical_description',
  is_emergency: 'is_emergency',

  // Feeding
  cats_being_fed: 'cats_being_fed',
  feeder_info: 'feeder_info',
  feeding_frequency: 'feeding_frequency',
  feeding_situation: 'feeding_situation',

  // Notes
  situation_description: 'situation_description',
  referral_source: 'referral_source',
};
```

### Intake → Request Mapping

```typescript
const INTAKE_TO_REQUEST_MAPPING = {
  // These are NOW properly mapped via MIG_2531:
  'cat_name': 'cat_name',
  'cat_description': 'cat_description',
  'count_confidence': 'count_confidence',
  'colony_duration': 'colony_duration',
  'has_kittens': 'has_kittens',
  'kitten_count': 'kitten_count',
  'kitten_age_estimate': 'kitten_age_estimate',
  'kitten_behavior': 'kitten_behavior',
  'mom_present': 'mom_present',
  'has_medical_concerns': 'has_medical_concerns',
  'medical_description': 'medical_description',
  'is_being_fed': 'is_being_fed',  // from cats_being_fed
  'feeder_name': 'feeder_name',    // from feeder_info
  'feeding_frequency': 'feeding_frequency',
  'handleability': 'handleability',
  'fixed_status': 'fixed_status',
  'is_property_owner': 'is_property_owner',
  'has_property_access': 'has_property_access',
  'access_notes': 'access_notes',

  // These NEED TO BE ADDED (MIG_2532):
  'is_third_party_report': 'is_third_party_report',
  'third_party_relationship': 'third_party_relationship',
  'county': 'county',
  'is_emergency': 'is_emergency',
  'awareness_duration': 'awareness_duration',
  'peak_count': 'peak_count',
  'kitten_contained': 'kitten_contained',
  'mom_fixed': 'mom_fixed',
  'can_bring_in': 'can_bring_in',
  'triage_category': 'triage_category',
};
```

---

## Summary

This audit identified:
- **15 fields** not being carried from intake to request
- **5 Beacon-critical fields** (peak_count, etc.) need to be added
- **Entity enrichment** opportunities for places, people, and cats
- **"Don't re-ask"** rules to improve staff efficiency

Next steps:
1. Create MIG_2532 to add missing request columns
2. Update `convert_intake_to_request()` function
3. Create entity enrichment functions
4. Update call sheet to capture all fields consistently
