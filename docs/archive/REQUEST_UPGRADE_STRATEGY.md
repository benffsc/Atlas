# Request Data Upgrade Strategy

**Created:** 2026-02-26
**Purpose:** Define how to upgrade existing requests to the new structured data standard (MIG_2530/2531/2532)

---

## Executive Summary

Atlas has accumulated requests from multiple eras and sources:

| Source | Count | Data Quality | Upgrade Path |
|--------|-------|--------------|--------------|
| **Airtable Legacy** | 276 | Notes-only (97% have free text) | AI extraction from notes |
| **Web Intake (native)** | 5 | Linked to intake submissions | Auto-upgrade from intake |
| **Atlas UI (direct)** | 10 | Minimal structured data | Manual enrichment |
| **Unconverted Intakes** | ~1,237 | Full structured data | Convert to requests |

**Key Insight:** 1,242 intake submissions have rich structured data (county, cat count, kittens, medical concerns), but only 291 requests exist and they have almost zero structured fields populated.

---

## The Data Gap

### What Intake Submissions Have (1,242 records)

| Field | Population Rate | Notes |
|-------|-----------------|-------|
| `county` | 76% (942) | Service area routing |
| `cat_count_estimate` | 98% (1,218) | Colony size |
| `has_kittens` | 40% (498) | Kitten flag |
| `has_medical_concerns` | 16% (201) | Medical urgency |
| `is_emergency` | <1% (3) | Emergency flag |
| `ownership_status` | 100% (1,242) | Stray vs owned vs colony |
| `situation_description` | ~95% | Free text notes |

### What Requests Have (291 records)

| Field | Population Rate | Notes |
|-------|-----------------|-------|
| `county` | 0% | Never populated |
| `estimated_cat_count` | 99% (289) | Only field with data |
| `has_kittens` | 0% | Lost in conversion |
| `has_medical_concerns` | 0% | Lost in conversion |
| `is_emergency` | 0% | Lost in conversion |
| `notes` | 92% (Airtable only) | Free text |

---

## Upgrade Paths

### Path 1: Web Intake Requests (Automatic)

**Scope:** 5 requests from `source_system = 'web_intake'`

**Method:** MIG_2533 `upgrade_request_from_intake()` function

**Process:**
1. Link request to source intake via `source_record_id`
2. Copy structured fields where request field is NULL
3. Preserve any manual edits (COALESCE pattern)

**Fields Upgraded:**
- `county`, `estimated_cat_count`, `has_kittens`, `kitten_count`
- `has_medical_concerns`, `is_emergency`, `medical_description`
- `is_being_fed`, `feeding_frequency`, `feeding_location`, `feeding_time`
- `is_property_owner`, `has_property_access`, `access_notes`
- `colony_duration`, `awareness_duration`, `eartip_count_observed`
- `is_third_party_report`, `third_party_relationship`
- `dogs_on_site`, `trap_savvy`, `previous_tnr`
- `handleability`, `fixed_status`, `triage_category`

**SQL:**
```sql
-- Upgrade single request
SELECT ops.upgrade_request_from_intake('request-uuid-here');

-- Batch upgrade all linkable
SELECT * FROM ops.upgrade_all_linkable_requests();
```

---

### Path 2: Airtable Legacy Requests (AI Extraction)

**Scope:** 276 requests from `source_system = 'airtable_ffsc'`

**Method:** AI-powered notes parsing job (similar to existing `scripts/jobs/`)

**Process:**
1. Extract structured data from free-text `notes` field
2. Parse for: kittens, feeding behavior, medical concerns, temperament
3. Store extracted values in structured columns
4. Flag as `source_type = 'ai_extracted'` for audit

**Current Notes Analysis:**
- 138 (52%) mention kittens → extract `has_kittens`, `kitten_count`
- 116 (43%) mention trapping → extract trapping history
- 71 (27%) mention feeding → extract `is_being_fed`, `feeding_frequency`
- 33 (12%) mention temperament → extract `handleability`
- 13 (5%) mention medical → extract `has_medical_concerns`

**Implementation:**
```typescript
// scripts/jobs/extract-legacy-request-data.ts
interface ExtractedFields {
  has_kittens?: boolean;
  kitten_count?: number;
  is_being_fed?: boolean;
  feeding_frequency?: string;
  has_medical_concerns?: boolean;
  handleability?: string;
  extraction_confidence: number;
}

async function extractFromNotes(notes: string): Promise<ExtractedFields> {
  // Use Claude API to extract structured data from free text
  const prompt = `Extract structured TNR request data from these notes...`;
  // ... implementation
}
```

---

### Path 3: Atlas UI Direct Requests (Manual Enrichment)

**Scope:** 10 requests from `source_system = 'atlas_ui'`

**Method:** Manual staff enrichment via request detail page

**Process:**
1. Show "Data Quality" panel on request detail page
2. Highlight missing Beacon-critical fields (peak_count, etc.)
3. Allow staff to fill in during normal workflow
4. Track enrichment progress

**UI Component:** Add to `/requests/[id]/page.tsx`:
```
┌─────────────────────────────────────┐
│ Data Completeness                   │
├─────────────────────────────────────┤
│ ⚠ Missing Beacon-critical fields:  │
│   • Peak count observed             │
│   • County                          │
│   • Colony duration                 │
│                                     │
│ [Enrich Now]                        │
└─────────────────────────────────────┘
```

---

### Path 4: Unconverted Intake Submissions (Convert)

**Scope:** ~1,237 intake submissions without linked requests

**Method:** Bulk conversion via `convert_intake_to_request()` function

**Considerations:**
- Many may be duplicates of Airtable requests (same address/person)
- Need deduplication logic before conversion
- Some may be spam/test submissions

**Recommended Approach:**
1. Review intake queue (existing UI at `/admin/intake-review`)
2. Convert legitimate submissions to requests
3. Mark spam/duplicates appropriately
4. Run entity enrichment after conversion

---

## Reconciliation UI Concept

### Request Upgrade Dashboard (`/admin/request-upgrades`)

```
┌────────────────────────────────────────────────────────────────────┐
│ Request Data Upgrade Dashboard                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │
│ │ Web Intake       │ │ Airtable Legacy  │ │ Atlas UI Direct  │    │
│ │ ✓ 5/5 upgraded   │ │ ⚠ 0/276 upgraded │ │ ◐ 2/10 complete  │    │
│ │ [Refresh]        │ │ [Run AI Extract] │ │ [View List]      │    │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘    │
│                                                                    │
│ Data Quality Metrics                                               │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ Field              │ Before  │ After   │ Coverage           │   │
│ ├─────────────────────────────────────────────────────────────┤   │
│ │ county             │ 0%      │ 76%     │ ████████░░ 76%    │   │
│ │ has_kittens        │ 0%      │ 40%     │ ████░░░░░░ 40%    │   │
│ │ has_medical        │ 0%      │ 16%     │ ██░░░░░░░░ 16%    │   │
│ │ is_emergency       │ 0%      │ 1%      │ ░░░░░░░░░░ 1%     │   │
│ │ peak_count         │ 0%      │ 0%      │ ░░░░░░░░░░ 0%     │   │
│ └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ Unconverted Intakes: 1,237                                         │
│ [Review Queue →]                                                   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Request Detail Enrichment Panel

On each request detail page, show missing fields:

```
┌────────────────────────────────────────────┐
│ 📊 Data Completeness: 45%                  │
├────────────────────────────────────────────┤
│                                            │
│ ✓ Basic Info (3/3)                         │
│   • Summary                                │
│   • Location                               │
│   • Requester                              │
│                                            │
│ ⚠ Colony Data (1/4)                        │
│   • Cat count: 5 ✓                         │
│   • Peak count: [___] ← BEACON CRITICAL    │
│   • Colony duration: [___]                 │
│   • Awareness duration: [___]              │
│                                            │
│ ⚠ Kitten Info (0/3)                        │
│   • Has kittens: [Yes/No]                  │
│   • Kitten count: [___]                    │
│   • Ages: [___]                            │
│                                            │
│ ◐ Feeding Info (1/3)                       │
│   • Being fed: Yes ✓                       │
│   • Location: [___]                        │
│   • Time: [___]                            │
│                                            │
│ [Save Enrichments]                         │
└────────────────────────────────────────────┘
```

---

## Implementation Priority

### Phase 1: Immediate (This Week)

1. **Apply MIG_2533** - Backfill web_intake requests from intakes
2. **Verify backfill** - Check that structured fields now populated
3. **Update new request form** - Add missing Beacon-critical fields

### Phase 2: Short-term (Next 2 Weeks)

1. **Create AI extraction job** for Airtable legacy notes
2. **Build enrichment panel** for request detail page
3. **Add data quality metrics** to admin dashboard

### Phase 3: Medium-term (Next Month)

1. **Build upgrade dashboard** (`/admin/request-upgrades`)
2. **Create intake deduplication** for unconverted submissions
3. **Run full upgrade** across all request types

---

## Backwards Compatibility

### Status System

MIG_2530 introduced simplified statuses, but legacy values still work:

| Legacy Status | Maps To | Notes |
|---------------|---------|-------|
| `triaged` | `new` | Display as "New" |
| `scheduled` | `working` | Display as "Working" |
| `in_progress` | `working` | Display as "Working" |
| `on_hold` | `paused` | Display as "Paused" |
| `cancelled` | `completed` | Display as "Completed" |
| `partial` | `completed` | Display as "Completed" |

### Field Preservation

The upgrade functions use COALESCE pattern:
- Only fill fields that are currently NULL
- Manual edits are never overwritten
- Source tracking via `source_type = 'upgraded'`

### API Compatibility

- All existing API endpoints continue to work
- New fields are optional in request creation
- UI progressively adopts new fields

---

## Success Metrics

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Requests with county | 0% | 80% | Backfill + new form |
| Requests with has_kittens | 0% | 50% | Backfill + AI extraction |
| Requests with peak_count | 0% | 30% | New form collection |
| Beacon population coverage | Low | High | peak_count enables Chapman |

---

## Related Documents

- `docs/INTAKE_REQUEST_DATA_FLOW_AUDIT.md` - Field gap analysis
- `sql/schema/v2/MIG_2530__simplified_request_status.sql` - Status migration
- `sql/schema/v2/MIG_2531__intake_request_field_unification.sql` - Field mapping
- `sql/schema/v2/MIG_2532__complete_request_field_coverage.sql` - New columns
- `sql/schema/v2/MIG_2533__backfill_requests_from_intakes.sql` - Backfill function
