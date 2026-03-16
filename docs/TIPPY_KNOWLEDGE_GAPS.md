# Tippy Knowledge Gaps Analysis

**Date:** 2026-01-20
**Updated:** 2026-01-20 (fixes implemented)
**Analyzed:** 69 user questions from tippy_messages table

## Executive Summary

Two major issues were identified and **fixed**:

1. **Tool Invocation Failure**: Tippy had 28+ tools but wasn't invoking them reliably.
   - **FIX**: Upgraded to Claude 3.5 Haiku + added intent detection with forced tool choice

2. **Data Architecture Gaps**: Several query patterns weren't supported.
   - **FIX**: Added `query_partner_org_stats` and `query_colony_estimate_history` tools

---

## Fixes Implemented

### Fix 1: Model Upgrade + Intent Detection

**Changes to `apps/web/src/app/api/tippy/chat/route.ts`:**

1. **Model upgrade**: Changed from `claude-3-haiku-20240307` to `claude-3-5-haiku-20241022`
   - Better tool invocation reliability
   - Same latency, ~3x cost (but still cheap)

2. **Intent detection with forced tool choice**: Added `detectIntentAndForceToolChoice()` function
   - Forces `create_reminder` for "remind me...", "follow up on...later"
   - Forces `send_staff_message` for "tell [name] that..."
   - Forces `query_trapper_stats` for "how many trappers"
   - Forces `query_partner_org_stats` for "SCAS cats"

3. **Enhanced system prompt**: Added 8+ few-shot examples showing tool usage patterns

### Fix 2: Partner Organization Stats Tool

**New tool: `query_partner_org_stats`**

Answers: "How many SCAS cats have we done?"

```typescript
// Usage
query_partner_org_stats(organization: "SCAS", time_period: "all_time")

// Returns
{
  total_appointments: 285,
  unique_cats: 280,
  with_microchip: 45,
  date_range: { earliest: "2023-01-15", latest: "2026-01-08" },
  by_year: { "2025": 87, "2024": 120, "2023": 78 }
}
```

### Fix 3: Colony Estimate History Tool

**New tool: `query_colony_estimate_history`**

Answers: "Why does Airtable show 21 cats but Atlas shows 15?"

```typescript
// Usage
query_colony_estimate_history(address_search: "123 Oak St")

// Returns history of all estimates with sources and confidence levels
// Explains why numbers might differ between systems
```

### Fix 4: Enhanced Cat Name Search

**Modified `queryCatJourney()` in tools.ts:**

When cat not found in Atlas by name, now also searches ClinicHQ staged_records Patient Name field and returns matches with microchip numbers if available.

---

## Remaining Gaps (Lower Priority)

### Gap: Airtable Colony Size Sync

Colony sizes entered directly in Airtable may not be synced to `place_colony_estimates` table.

**Status**: Not yet addressed. Would require:
1. Adding colony size to Airtable sync pipeline
2. Creating source_type = 'airtable' entries in colony_source_confidence

---

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/src/app/api/tippy/chat/route.ts` | Model upgrade, intent detection, system prompt enhancements |
| `apps/web/src/app/api/tippy/tools.ts` | Added `query_partner_org_stats`, `query_colony_estimate_history`, enhanced `queryCatJourney` |

---

## Testing

Verify fixes with these queries:

1. **Partner org stats**: "How many SCAS cats have we done?"
2. **Reminder creation**: "Remind me to check on Oak St tomorrow"
3. **Staff messaging**: "Tell Ben the colony needs attention"
4. **Trapper stats**: "How many active trappers do we have?"
5. **Colony history**: "Why does the colony size differ from Airtable?"
6. **Cat name search**: "What's the journey of a cat named Whiskers?"

---

## Original Analysis (for reference)

### Question Categories

| Category | Count | Tool Available | Status |
|----------|-------|----------------|--------|
| Other | 34 | Various | N/A |
| Count Query | 14 | `query_cats_altered_in_area` | **FIXED** (model upgrade) |
| Regional Query | 9 | `query_region_stats` | **FIXED** (model upgrade) |
| Address Query | 4 | `comprehensive_place_lookup` | **FIXED** (model upgrade) |
| Data Quality Query | 3 | `check_data_quality` | **FIXED** (model upgrade) |
| Partner Org Query | 2 | `query_partner_org_stats` | **FIXED** (new tool) |
| Person Query | 2 | `comprehensive_person_lookup` | **FIXED** (model upgrade) |
| Trapper Query | 1 | `query_trapper_stats` | **FIXED** (intent detection) |

### SCAS Data Reference

```sql
-- Sample SCAS appointments
SELECT
    payload->>'Number' as appointment_number,
    payload->>'Owner First Name' as animal_id,
    payload->>'Owner Last Name' as org,
    LEFT(payload->>'Appointment Date', 10) as date
FROM ops.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'owner_info'
  AND payload->>'Owner Last Name' = 'SCAS'
LIMIT 5;

-- Total: 285+ SCAS appointments
```
