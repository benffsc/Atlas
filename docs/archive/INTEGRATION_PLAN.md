# Atlas Integration & Enhancement Plan

**Created**: 2026-01-19
**Status**: Planning Phase

This document outlines the integrations and enhancements needed for Atlas based on the Tippy test suite results and new data source requirements.

---

## Table of Contents
1. [Tippy Warning Fixes](#1-tippy-warning-fixes)
2. [Beacon Enhancements](#2-beacon-enhancements)
3. [VolunteerHub Integration](#3-volunteerhub-integration)
4. [ShelterLuv Data Enrichment](#4-shelterluv-data-enrichment)
5. [Trapper Lookup in Beacon](#5-trapper-lookup-in-beacon)
6. [Data Engine Testing](#6-data-engine-testing)

---

## 1. Tippy Warning Fixes

### Issue: Regional Area Queries Not Working

**Problem**: Queries like "What's the cat population in west county?" return "I'm not sure how to help with that."

**Root Cause**: Tippy tools don't understand regional area terms like:
- "west county" (Sebastopol, Forestville, Guerneville, Monte Rio, Occidental)
- "north county" (Healdsburg, Cloverdale, Geyserville)
- "south county" (Petaluma, Sonoma, Cotati, Rohnert Park)
- "east county" (Glen Ellen, Kenwood, Sonoma Valley)
- "wine country", "russian river", "coastal area"

**Solution**: Add a region-to-cities mapping to Tippy tools.

```typescript
// In tools.ts
const SONOMA_REGIONS: Record<string, string[]> = {
  'west county': ['Sebastopol', 'Forestville', 'Guerneville', 'Monte Rio', 'Occidental', 'Camp Meeker', 'Cazadero'],
  'north county': ['Healdsburg', 'Cloverdale', 'Geyserville', 'Windsor'],
  'south county': ['Petaluma', 'Sonoma', 'Cotati', 'Rohnert Park'],
  'east county': ['Glen Ellen', 'Kenwood', 'Sonoma'],
  'russian river': ['Guerneville', 'Monte Rio', 'Forestville', 'Rio Nido', 'Duncans Mills'],
  'wine country': ['Healdsburg', 'Sonoma', 'Glen Ellen', 'Kenwood', 'Geyserville'],
  'coastal': ['Bodega Bay', 'Jenner', 'Sea Ranch', 'Tomales']
};

// New tool: query_region_stats
// Expands region name to cities, then queries across all
```

**Tasks**:
- [ ] Add SONOMA_REGIONS mapping to tools.ts
- [ ] Create `query_region_stats` tool that expands regions
- [ ] Update system prompt to mention regional query capability
- [ ] Test with all region names

### Other Warning Fixes

| Warning | Issue | Fix |
|---------|-------|-----|
| All zeros microchip | Response is correct but pattern too strict | Update test pattern |
| Too long microchip | Response is correct but pattern too strict | Update test pattern |
| Address with PO Box | No data for address | Expected behavior |
| Multi-step research | Worked but pattern missed | Update test pattern |

---

## 2. Beacon Enhancements

### 2.1 Colony Risk Assessment

**Requirement**: Compare two places and determine which is more at risk for population growth.

**Research Basis**: Cat population dynamics research shows:
- **70% alteration threshold**: Colonies below 70% alteration rate will grow
- **Breeding rate**: 1 unaltered female can produce 100+ kittens over 7 years
- **Cat lives saved formula**: Each spay/neuter prevents ~12 cats over 4 years

**Database Changes**:

```sql
-- MIG_470__colony_risk_metrics.sql
CREATE TABLE trapper.colony_risk_scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),

  -- Current state
  estimated_colony_size INT,
  cats_altered INT,
  alteration_rate DECIMAL(5,2),

  -- Risk factors
  unaltered_females_estimate INT,
  breeding_potential_score DECIMAL(5,2),  -- 0-100
  population_growth_risk TEXT,  -- 'critical', 'high', 'medium', 'low', 'stable'

  -- Impact metrics
  cats_lives_saved_if_completed INT,  -- Projected cats prevented by fixing remaining
  priority_score DECIMAL(5,2),  -- Weighted score for resource allocation

  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  calculation_version TEXT DEFAULT 'v1'
);

-- Function to calculate risk
CREATE OR REPLACE FUNCTION trapper.calculate_colony_risk(p_place_id UUID)
RETURNS trapper.colony_risk_scores AS $$
DECLARE
  v_result trapper.colony_risk_scores;
  v_colony_size INT;
  v_altered INT;
  v_rate DECIMAL;
  v_unaltered INT;
BEGIN
  -- Get current stats from v_place_colony_status
  SELECT
    estimated_size,
    total_altered,
    alteration_rate
  INTO v_colony_size, v_altered, v_rate
  FROM trapper.v_place_colony_status
  WHERE place_id = p_place_id;

  v_unaltered := GREATEST(0, v_colony_size - v_altered);

  -- Estimate unaltered females (assume 50% female)
  v_result.unaltered_females_estimate := v_unaltered / 2;

  -- Breeding potential: each unaltered female = 12 cats/year potential
  v_result.breeding_potential_score := LEAST(100, v_result.unaltered_females_estimate * 10);

  -- Risk level based on alteration rate
  v_result.population_growth_risk := CASE
    WHEN v_rate >= 90 THEN 'stable'
    WHEN v_rate >= 70 THEN 'low'
    WHEN v_rate >= 50 THEN 'medium'
    WHEN v_rate >= 30 THEN 'high'
    ELSE 'critical'
  END;

  -- Cat lives saved if we complete this colony
  -- Each spay prevents ~12 cats over 4 years
  v_result.cats_lives_saved_if_completed := v_result.unaltered_females_estimate * 12;

  -- Priority score (higher = more urgent)
  v_result.priority_score := (100 - v_rate) * (v_colony_size::DECIMAL / 10);

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

**API Endpoint**:
```
GET /api/beacon/compare-risk?place1=UUID&place2=UUID
```

Returns:
```json
{
  "comparison": {
    "place1": {
      "name": "123 Oak St",
      "alteration_rate": 45,
      "risk_level": "high",
      "cats_lives_saved_potential": 36,
      "priority_score": 82
    },
    "place2": {
      "name": "456 Elm St",
      "alteration_rate": 72,
      "risk_level": "low",
      "cats_lives_saved_potential": 8,
      "priority_score": 28
    },
    "recommendation": "123 Oak St has higher impact potential - completing this colony would save an estimated 36 cat lives vs 8 at 456 Elm St"
  }
}
```

**UI Components**:
- `ColonyRiskCard.tsx` - Shows risk level, potential impact
- `CompareColoniesModal.tsx` - Side-by-side comparison
- Beacon map: Color-coded markers by risk level (red=critical, orange=high, yellow=medium, green=low/stable)

### 2.2 Cat Lives Saved Calculator

**Research**: Based on ASPCA and Humane Society studies:
- 1 unspayed female cat can produce 4-6 kittens per litter, 2-3 litters/year
- Over 7 years: 1 cat → theoretically 370,000 descendants
- Realistic estimate: 1 spay prevents ~12 cats over 4 years

**Tippy Tool**: `calculate_impact`
```typescript
{
  name: "calculate_impact",
  description: "Calculate the estimated cat lives saved by completing alteration at a place or set of places",
  input_schema: {
    type: "object",
    properties: {
      place_ids: { type: "array", items: { type: "string" } },
      scenario: { type: "string", enum: ["complete_all", "70_percent", "custom"] }
    }
  }
}
```

---

## 3. VolunteerHub Integration

### API Details
- **API Key**: `hzgWXKHPGWR33kdbeMnrPpAg3XOsQul9LmcvuQbvOkgpHa7Cl7JDy1O6on88ErHuvIxk8bNZuJdgs7Ar`
- **Docs**: https://api.volunteerhub.com/docs (check for actual endpoint)

### Data Available (from Excel export)
- 1,342 users with 52 fields including:
  - Name, Email, Phone
  - Address (Street, City, State, Zip)
  - Skills, Interests
  - Volunteer history

### Sync Strategy

**Important**: Use Airtable as source of truth for active trappers (per user request).

```javascript
// scripts/ingest/volunteerhub_sync.mjs
// 1. Fetch from VolunteerHub API
// 2. Stage in staged_records with source_system='volunteerhub'
// 3. Match to existing people via email/phone
// 4. Add volunteer role, but DON'T override trapper status from Airtable
```

### Cron Job Setup
```bash
# Add to crontab
0 2 * * * cd /path/to/Atlas && node scripts/ingest/volunteerhub_sync.mjs >> /var/log/atlas/volunteerhub.log 2>&1
```

### Tasks
- [ ] Verify VolunteerHub API endpoint and auth method
- [ ] Create `volunteerhub_sync.mjs` ingest script
- [ ] Stage records, match people, add roles
- [ ] Set up cron job
- [ ] Add Tippy tool to query volunteer availability by area

---

## 4. ShelterLuv Data Enrichment

### Data Available (5 years)

| File | Rows | Description |
|------|------|-------------|
| Animals | 3,141 | Cats with 85 columns (microchip, breed, sex, age, status, etc.) |
| Outcomes | 3,217 | Outcome records with 97 columns (adoption, return, transfer, etc.) |
| People | 2,736 | People with 25 columns (adopters, fosters, etc.) |

### Key Fields to Map

**Animals → sot_cats**:
- `Animal ID` → source_record_id
- `Microchip` → microchip (link via cat_identifiers)
- `Name` → display_name
- `Species` → verify is 'Cat'
- `Primary Breed` → breed
- `Sex` → sex
- `Age (Months)` → age_months
- `Altered` → altered_status
- `Intake Date` → source_created_at

**People → sot_people**:
- `Person ID` → source_record_id
- `Name` → first_name, last_name
- `Street Address`, `City`, `State`, `Zip` → address fields
- `Primary Email` → person_identifiers (email)
- `Primary Phone` → person_identifiers (phone)

**Outcomes** → New table or enrichment:
- Link animal to outcome type
- Track adoption/foster/return dates

### Source System Tracking
```sql
-- All ShelterLuv records get:
source_system = 'shelterluv'
source_record_id = 'sl_' + internal_id
```

### Ingest Script
```javascript
// scripts/ingest/shelterluv_import.mjs
// 1. Read Excel files (or API when available)
// 2. Stage in staged_records
// 3. Use find_or_create_* functions
// 4. Log to data_changes
```

### Stress Test Points
- Duplicate detection (same cat from ClinicHQ and ShelterLuv)
- Email/phone matching across systems
- Microchip matching
- Address normalization

### Tasks
- [ ] Create ShelterLuv staged_records table entries
- [ ] Create `shelterluv_import.mjs` script
- [ ] Map all 85 animal fields
- [ ] Handle outcomes (new table?)
- [ ] Set up automated import (email→S3→ingest or API)
- [ ] Test data engine with cross-system matching

---

## 5. Trapper Lookup in Beacon

### Requirement
When a call comes in, Beacon should show:
1. **Approved trappers** in the area (from Airtable - source of truth)
2. **Community trappers** nearby
3. **Volunteers** with trapping history

### Data Sources (Priority Order)
1. **Airtable** - Active trapper roster (SOURCE OF TRUTH)
2. **VolunteerHub** - Volunteer skills/availability
3. **Atlas history** - Past trapping activity

### Database Schema

```sql
-- MIG_471__trapper_service_areas.sql
CREATE TABLE trapper.trapper_service_areas (
  area_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

  -- Geographic coverage
  center_point GEOGRAPHY(POINT),  -- Their base location
  service_radius_miles DECIMAL(5,2) DEFAULT 10,
  preferred_cities TEXT[],

  -- Availability
  available_days TEXT[],  -- ['monday', 'tuesday', ...]
  available_times TEXT,   -- 'mornings', 'evenings', 'flexible'
  max_weekly_requests INT DEFAULT 2,

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_activity_at TIMESTAMPTZ,

  source_system TEXT DEFAULT 'atlas_ui',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- View for quick lookup
CREATE VIEW trapper.v_trappers_by_location AS
SELECT
  p.person_id,
  p.display_name,
  pr.role_type,
  pr.is_ffsc_affiliated,
  tsa.center_point,
  tsa.service_radius_miles,
  tsa.preferred_cities,
  tsa.is_active,
  -- Stats
  (SELECT COUNT(*) FROM trapper.request_trapper_assignments rta
   WHERE rta.person_id = p.person_id) as total_assignments,
  (SELECT MAX(assigned_at) FROM trapper.request_trapper_assignments rta
   WHERE rta.person_id = p.person_id) as last_assignment
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON p.person_id = pr.person_id
LEFT JOIN trapper.trapper_service_areas tsa ON p.person_id = tsa.person_id
WHERE pr.role_type IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
  AND pr.is_active = true;
```

### API Endpoint
```
GET /api/beacon/nearby-trappers?lat=38.5&lng=-122.7&radius=10
```

### Tippy Tool
```typescript
{
  name: "find_nearby_trappers",
  description: "Find available trappers near an address or coordinates",
  input_schema: {
    type: "object",
    properties: {
      address: { type: "string" },
      radius_miles: { type: "number", default: 10 },
      include_community: { type: "boolean", default: true }
    }
  }
}
```

### UI Components
- Beacon map: Toggle layer showing trapper coverage areas
- "Find Trappers" button on request detail page
- Trapper availability sidebar

### Tasks
- [ ] Create trapper_service_areas table
- [ ] Import trapper locations from Airtable
- [ ] Create nearby-trappers API
- [ ] Add Tippy tool
- [ ] Add Beacon map layer
- [ ] Add trapper finder to request workflow

---

## 6. Data Engine Testing

### Stress Test Scenarios

After importing all data sources, verify:

1. **Cross-system deduplication**
   - Same cat from ClinicHQ + ShelterLuv (via microchip)
   - Same person from Airtable + VolunteerHub + ShelterLuv (via email/phone)
   - Same address from different sources

2. **Identity resolution**
   - Person with email in ClinicHQ, phone in Airtable → same person?
   - Cat with microchip from clinic, name from ShelterLuv → merged correctly?

3. **Data quality queries** (via Tippy)
   - "How many cats have data from multiple sources?"
   - "Are there any microchip conflicts?"
   - "How many people have duplicate records?"

4. **Performance**
   - Query response times with 50K+ total records
   - Beacon map load time with all trappers

### Test Tippy Queries

```javascript
const DATA_ENGINE_TESTS = [
  "How many cats are in Atlas from ShelterLuv vs ClinicHQ?",
  "Find any microchip conflicts between data sources",
  "How many people appear in both VolunteerHub and Airtable?",
  "Which cats have the most data discrepancies?",
  "Are there any duplicate person records that need review?",
  "Show me the data source breakdown for cats",
  "Find trappers who are in VolunteerHub but not active in Airtable"
];
```

---

## Implementation Order

### Phase 1: Quick Fixes (Today)
1. Fix Tippy regional query (add SONOMA_REGIONS mapping)
2. Update test patterns that are too strict

### Phase 2: Data Imports (This Week)
1. Create ShelterLuv import script
2. Import 5 years of data
3. Create VolunteerHub sync script
4. Set up cron jobs

### Phase 3: Beacon Enhancements (Next Week)
1. Colony risk assessment
2. Cat lives saved calculator
3. Trapper lookup by location
4. Map layer updates

### Phase 4: Testing (Ongoing)
1. Run expanded Tippy test suite
2. Verify cross-system matching
3. Performance testing
4. UI/UX testing

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/ingest/shelterluv_import.mjs` | Import ShelterLuv Excel data |
| `scripts/ingest/volunteerhub_sync.mjs` | Sync VolunteerHub API |
| `sql/schema/sot/MIG_470__colony_risk_metrics.sql` | Risk scoring tables |
| `sql/schema/sot/MIG_471__trapper_service_areas.sql` | Trapper geography |
| `apps/web/src/app/api/beacon/compare-risk/route.ts` | Risk comparison API |
| `apps/web/src/app/api/beacon/nearby-trappers/route.ts` | Trapper lookup API |
| `apps/web/src/components/ColonyRiskCard.tsx` | Risk display component |
| `apps/web/src/components/TrapperFinderModal.tsx` | Find trappers UI |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/app/api/tippy/tools.ts` | Add regional mapping, new tools |
| `apps/web/src/app/beacon/page.tsx` | Add risk layers, trapper toggle |
| `scripts/test-tippy.mjs` | Fix overly strict patterns |

---

## Notes

- **Airtable is source of truth for active trappers** - Do not override from VolunteerHub
- **ShelterLuv API key requested** - Currently using Excel exports
- **VolunteerHub API key available** - Ready for integration
- **Timezone: Pacific Standard** - All reminders use PST
