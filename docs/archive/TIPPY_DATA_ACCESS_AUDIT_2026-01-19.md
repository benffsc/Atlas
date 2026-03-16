# Tippy Data Access Audit - 2026-01-19

## Executive Summary

Analysis of staff feedback and Tippy test results reveals several systemic issues preventing accurate data access. This audit identifies root causes and proposes solutions for both the data layer and Atlas UI.

---

## Part 1: What Tippy Can't Answer (And Why)

### 1.1 Trapper Statistics - CRITICAL GAP

**Staff Question:** "How many active trappers do we have?"

**Tippy Response:** "I don't have a direct way to get the count of active trappers"

**Root Cause:** No `query_trappers` tool exists. Tippy has tools for:
- `query_cats_at_place` - Cat counts
- `query_place_colony_status` - Colony info
- `query_request_stats` - Request statistics
- `query_person_history` - Individual person lookup

**Missing:** Aggregate trapper statistics tool

**Data Available:**
```sql
-- This data EXISTS but Tippy can't access it
SELECT * FROM trapper.v_trapper_full_stats;        -- Comprehensive stats
SELECT * FROM trapper.v_trapper_appointment_stats; -- Clinic stats by trapper
SELECT COUNT(*) FROM trapper.person_roles WHERE role_name IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper');
```

**Fix Required:**
1. Add `query_trapper_stats` tool to Tippy
2. Expose in Atlas UI: `/admin/trappers` dashboard

---

### 1.2 Reminder Creation Not Working - CRITICAL

**Staff Request:** "Remind me to follow up on 115 Magnolia Avenue next week"

**Tippy Behavior:** Queried place data instead of creating reminder

**Root Cause:** Tool selection issue - Claude chose `query_cats_at_place` instead of `create_reminder`

**Possible Issues:**
1. System prompt doesn't emphasize reminder tool for "remind me" phrases
2. `create_reminder` tool might not be in available tools for user's access level
3. Tool description might not be clear enough

**Fix Required:**
1. Review system prompt for reminder instructions
2. Verify tool availability by access level
3. Add explicit trigger words in tool descriptions

---

### 1.3 Multi-Part Queries Only Partially Answered

**Staff Query:** "How many cats fixed in Santa Rosa last month AND active requests near Cloverdale?"

**Tippy Behavior:** Only answered Cloverdale requests, ignored Santa Rosa cats

**Root Cause:** Claude limitation with compound queries - tends to answer one part

**Fix Required:**
1. Improve system prompt to instruct breaking down compound queries
2. Consider query decomposition in the API layer

---

### 1.4 "Last Month" Time Filtering Not Working

**Staff Query:** "Cats fixed last month?"

**Tippy Behavior:** Returned historical totals instead of monthly data

**Root Cause:** Time-based filtering not implemented in query tools

**Current Tool:** `query_ffr_impact` returns aggregate stats, not time-filtered

**Fix Required:**
1. Add date range parameters to query tools
2. Or add dedicated `query_recent_activity` tool

---

## Part 2: Data Quality Issues Affecting Accuracy

### 2.1 Mega-Persons Problem - HIGH PRIORITY

**Issue:** Some people are linked to 300+ places incorrectly

**Affected Records:**
| Person | Places Linked | Cause |
|--------|---------------|-------|
| John Davenport | 328 | Has FFSC phone `7075767999` as identifier |
| Tippy Cat | 47 | Has FFSC email `info@forgottenfelines.com` |

**Impact on Tippy:**
- When querying "Who is at this address?", wrong people returned
- Place statistics include incorrect person associations
- Identity resolution fails for common queries

**Root Cause:** `reingest-clinichq-week.mjs` matches ClinicHQ owner records to people via email/phone. Organizational identifiers (FFSC office contact info) incorrectly assigned to individual person records.

**Problematic Identifiers in DB:**
| Identifier | Type | Matches |
|------------|------|---------|
| `7075767999` | phone | 4,053 ClinicHQ records |
| `info@forgottenfelines.com` | email | 2,830 records |
| `none` | email | 95 records |

**Fix Required:**
1. Delete invalid/organizational identifiers from person_identifiers
2. Delete incorrect person_place_relationships
3. Add blocklist to prevent future matches
4. Review 14,684 pending duplicates

---

### 2.2 Duplicate People - 14,684 Pending

**Issue:** Identity resolution creates duplicate person records

**Breakdown:**
| Category | Count | Description |
|----------|-------|-------------|
| High-similarity duplicates | 2,340 | Same name, same email - TRUE DUPLICATES |
| Medium similarity | 74 | Similar names - likely duplicates |
| Different names | 438 | Households sharing email |

**Impact on Tippy:**
- Querying person history may return incomplete data
- Cat/place links may be split across duplicate records
- Statistics undercounted or double-counted

**Fix Required:**
1. Auto-merge high-confidence duplicates (similarity >= 0.9)
2. Staff review of medium/low similarity in admin UI
3. Add to Atlas UI: `/admin/duplicates` review queue

---

### 2.3 Appointments Without Cats - 4,940 Records

**Issue:** ClinicHQ appointments exist without linked cats

**Service Breakdown:**
| Service Type | Count |
|--------------|-------|
| Examination, Brief | 1,109 |
| Cat Neuter | 971 |
| Cat Spay | 885 |
| Rabies 3 year vaccine | 201 |

**Root Cause:** Microchip field empty in ClinicHQ source data. Some microchips embedded in animal name (e.g., "Fozzie (Guenther) 981020053752169") but not in dedicated field.

**Impact on Tippy:**
- Cat counts underreported
- Clinic statistics incomplete
- Cat journey tracking has gaps

**Fix Required:**
1. Extract microchips from animal names via regex
2. Training for clinic staff on microchip field entry
3. Enhanced cat lookup by owner + name combination

---

### 2.4 Cats Without Appointments - NOT AN ISSUE

**Count:** 3,407 cats

**Actually Expected:**
- PetLink (1,691): Microchip registrations only
- ShelterLuv (1,586): Historical outcomes/fosters
- ClinicHQ (130): Edge cases

This reflects reality - not all cats were TNR'd through FFSC clinic.

---

## Part 3: Why Atlas UI Needs These Answers

Atlas is designed to be the **unified location for Beacon** - the organizational intelligence layer. Staff should be able to find answers in the UI, not just through Tippy.

### Current UI Gaps

| Question | Tippy Can Answer? | UI Available? |
|----------|-------------------|---------------|
| How many active trappers? | NO | NO |
| Trapper performance stats? | NO | NO |
| Data quality overview? | NO | NO |
| Duplicate people queue? | NO | Partial (`/admin/duplicates` exists?) |
| Pending data improvements? | YES (tool exists) | `/admin/data-improvements` |
| Colony status at address? | YES | `/places/[id]` |
| Cat appointment history? | YES | `/cats/[id]` |
| Request status? | YES | `/requests/[id]` |

### Recommended New UI Pages

#### 1. `/admin/trappers` - Trapper Dashboard
- Active trappers by type (coordinator, head_trapper, ffsc_trapper, community_trapper)
- Trapper performance metrics (cats trapped, requests completed)
- Recent activity timeline
- Certification status tracking

#### 2. `/admin/data-quality` - Data Quality Dashboard
- Mega-persons flagged for review
- Invalid identifiers detected
- Appointments without cats
- Unprocessed staged records
- Link to duplicate review queue

#### 3. `/admin/duplicates` - Duplicate Review Queue
- 14,684 pending duplicates
- Auto-merge suggestions for high confidence
- Side-by-side comparison for manual review
- Bulk merge actions

#### 4. `/admin/identity-resolution` - Identity Audit
- People without identifiers
- Shared identifiers (multiple people, same email)
- Organizational identifiers flagged
- Blocklist management

---

## Part 4: Tippy Tool Improvements Needed

### 4.1 Add `query_trapper_stats` Tool

```typescript
{
  name: "query_trapper_stats",
  description: "Get statistics about FFSC trappers including counts by type, performance metrics, and recent activity",
  parameters: {
    trapper_type: { type: "string", enum: ["all", "coordinator", "head_trapper", "ffsc_trapper", "community_trapper"] },
    time_period: { type: "string", description: "e.g., 'last_month', 'this_year', 'all_time'" },
    include_inactive: { type: "boolean", default: false }
  }
}
```

### 4.2 Add Date Range to Existing Tools

Modify `query_ffr_impact`, `query_request_stats`, etc. to accept:
```typescript
parameters: {
  // ... existing params
  start_date: { type: "string", format: "date", description: "Start of date range" },
  end_date: { type: "string", format: "date", description: "End of date range" }
}
```

### 4.3 Improve System Prompt

Add explicit instructions:
```
When the user says "remind me" or "create a reminder" or "follow up", use the create_reminder tool.
When given a multi-part question, address EACH part separately using multiple tool calls if needed.
```

---

## Part 5: Implementation Priority

### Immediate (This Week)
1. **Add `query_trapper_stats` tool** - Staff need this frequently
2. **Fix reminder creation** - Review system prompt and tool availability
3. **Delete invalid identifiers** - One-time SQL fix

### Short Term (This Month)
4. **Build `/admin/trappers` dashboard** - UI for trapper stats
5. **Build `/admin/data-quality` dashboard** - Visibility into data issues
6. **Add date range filtering** - Time-based queries

### Medium Term
7. **Duplicate merge automation** - Auto-merge high confidence
8. **Extract microchips from names** - Regex pattern matching
9. **Identity resolution improvements** - Better matching algorithms

---

## Verification Queries

### Check mega-persons (should return 0 after fix)
```sql
SELECT p.person_id, p.display_name, COUNT(*) as place_count
FROM trapper.sot_people p
JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
GROUP BY p.person_id, p.display_name
HAVING COUNT(*) > 20;
```

### Check invalid identifiers (should return 0 after fix)
```sql
SELECT * FROM trapper.person_identifiers
WHERE id_value_norm IN ('none', 'n/a', 'na', 'null', '7075767999', 'info@forgottenfelines.com');
```

### Check pending duplicates
```sql
SELECT COUNT(*) as pending_duplicates
FROM trapper.potential_person_duplicates
WHERE resolved_at IS NULL;
```

### Check trapper counts
```sql
SELECT role_name, COUNT(*) as count
FROM trapper.person_roles
WHERE role_name IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
GROUP BY role_name;
```

---

## Summary

| Issue | Severity | Tippy Impact | UI Needed |
|-------|----------|--------------|-----------|
| No trapper stats tool | HIGH | Can't answer trapper questions | `/admin/trappers` |
| Reminder not triggering | HIGH | Staff workflow broken | - |
| Mega-persons | HIGH | Wrong data returned | `/admin/data-quality` |
| 14,684 duplicates | MEDIUM | Incomplete data | `/admin/duplicates` |
| Time filtering missing | MEDIUM | Can't answer "last month" | Tool update |
| Multi-part queries | LOW | Partial answers | System prompt |
| Appointments without cats | MEDIUM | Underreported stats | Data fix |

The Atlas app should be the unified source of truth where staff can find these answers both via Tippy chat AND through direct UI navigation.
