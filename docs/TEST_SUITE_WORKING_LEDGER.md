# Test Suite Working Ledger

Tracks data quality investigations, findings, and resulting test coverage. Each entry represents an issue discovered, its root cause, and which tests guard against regression.

---

## DQ-001: Holiday Duncan — Incorrect Foster/Trapper Roles

**Date:** 2026-02-01
**Reporter:** Staff (via map inspection)
**Location:** 2411 Alexander Valley Rd, Healdsburg, CA 95448
**Affected Person:** Holiday Duncan
**Symptoms:**
- Map pin shows "Foster" and "Trapper" badges next to Holiday Duncan
- Holiday Duncan is a ClinicHQ clinic client, NOT an FFSC volunteer
- Map pin also has the volunteer icon (star)
- "Wildhaven Campgrounds" displayed as a person name (should be filtered as organization)

### Investigation Findings

**Data Flow:**
1. Map pin role badges come from `person_roles` table (NOT `person_place_relationships`)
2. The `v_map_atlas_pins` view (MIG_822) builds a `people` JSONB array for each place
3. For each person at a place, it runs: `SELECT ARRAY_AGG(DISTINCT pr.role) FROM trapper.person_roles pr WHERE pr.person_id = per.person_id AND pr.role_status = 'active'`
4. These roles render as colored badges in the map popup (`AtlasMap.tsx:1288-1323`)

**Root Cause — Three vulnerability pathways identified:**

| # | Pathway | Risk | Mechanism |
|---|---------|------|-----------|
| 1 | **ShelterLuv name matching** | HIGH | `process_shelterluv_animal()` (MIG_469) uses `display_name ILIKE '%name%'` — pure substring match, no email/phone verification. Any person with a similar name gets foster role. |
| 2 | **VolunteerHub Data Engine matching** | MODERATE | If a real VH volunteer shares phone/name with a ClinicHQ person, Data Engine can auto-match them (score ≥ 0.95) or flag for review (0.50-0.94). Merged record inherits VH group roles. |
| 3 | **Airtable trapper sync** | MODERATE | Phone number collision between a trapper and clinic client could merge records. Mitigated by name similarity check (≥ 0.5). |

**Business Rule Violated:**
- All fosters and trappers must be FFSC Approved Volunteers FIRST
- In VolunteerHub: Approved Volunteers → subgroups: Approved Trappers, Approved Foster Parent
- A person should not have `role='foster'` or `role='trapper'` without also having `role='volunteer'`

**Secondary Issue — "Wildhaven Campgrounds" as a person:**
- `is_organization_name()` function doesn't recognize "Wildhaven Campgrounds"
- The word "Campground" should be added to org name patterns

### Diagnostic SQL

Run these queries to confirm the root cause for Holiday Duncan:

```sql
-- 1. Find Holiday Duncan's person_id
SELECT person_id, display_name, data_source, source_system, created_at
FROM trapper.sot_people
WHERE display_name ILIKE '%Holiday%Duncan%'
  AND merged_into_person_id IS NULL;

-- 2. Check her roles and their source
SELECT pr.role, pr.trapper_type, pr.role_status, pr.source_system,
       pr.source_record_id, pr.started_at, pr.created_at, pr.notes
FROM trapper.person_roles pr
JOIN trapper.sot_people p ON p.person_id = pr.person_id
WHERE p.display_name ILIKE '%Holiday%Duncan%'
  AND p.merged_into_person_id IS NULL
ORDER BY pr.created_at;

-- 3. Check Data Engine matching decisions
SELECT decision_type, score, incoming_email, incoming_phone,
       incoming_name, source_system, created_at
FROM trapper.data_engine_match_decisions
WHERE incoming_name ILIKE '%Holiday%Duncan%'
   OR resulting_person_id IN (
     SELECT person_id FROM trapper.sot_people
     WHERE display_name ILIKE '%Holiday%Duncan%'
       AND merged_into_person_id IS NULL
   )
ORDER BY created_at;

-- 4. Check person_identifiers (what contact info exists)
SELECT pi.id_type, pi.id_value_norm, pi.source_system, pi.created_at
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
WHERE p.display_name ILIKE '%Holiday%Duncan%'
  AND p.merged_into_person_id IS NULL;

-- 5. Check Wildhaven Campgrounds in sot_people
SELECT person_id, display_name, data_source, source_system
FROM trapper.sot_people
WHERE display_name ILIKE '%Wildhaven%'
  AND merged_into_person_id IS NULL;

-- 6. Broader audit: people with foster/trapper roles but NO volunteer role
SELECT p.display_name, p.person_id,
       array_agg(pr.role ORDER BY pr.role) AS roles,
       array_agg(DISTINCT pr.source_system) AS sources
FROM trapper.person_roles pr
JOIN trapper.sot_people p ON p.person_id = pr.person_id
WHERE p.merged_into_person_id IS NULL
  AND pr.role_status = 'active'
  AND pr.role IN ('foster', 'trapper')
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_roles pr2
    WHERE pr2.person_id = pr.person_id
      AND pr2.role = 'volunteer'
      AND pr2.role_status = 'active'
  )
GROUP BY p.display_name, p.person_id
ORDER BY p.display_name;
```

### Fixes Required

| # | Fix | Status | Migration/File |
|---|-----|--------|----------------|
| 1 | Add "Campground" to `is_organization_name()` patterns | Pending | New MIG |
| 2 | Add validation: foster/trapper requires volunteer role | Pending | New MIG or code check |
| 3 | Fix ShelterLuv name matching to require email/phone | Pending | Fix MIG_469 logic |
| 4 | Run diagnostic SQL and remove incorrect roles | Pending | Data fix MIG |

### Test Coverage

| Test | File | What It Guards |
|------|------|----------------|
| Org names filtered from map people | `e2e/data-quality-guards.spec.ts` | "Wildhaven Campgrounds" type issues |
| Foster/trapper without volunteer flagged | `e2e/data-quality-guards.spec.ts` | Business rule: volunteer is prerequisite |
| Map pins show correct role badges | `e2e/data-quality-guards.spec.ts` | Role accuracy on map |
| ClinicHQ-only people have no volunteer roles | `e2e/data-quality-guards.spec.ts` | Pipeline isolation |

---

## DQ-002: Tippy "I'm not sure how to help" for Address Queries

**Date:** 2026-02-01
**Reporter:** Staff (via Tippy chat)
**Symptoms:** Asking "what do we know about 113 Gorel Ct?" returns fallback response despite data existing

### Investigation Findings

**Root Cause:** Tippy's tool loop (max 3 iterations) exits when `iterations >= maxIterations`, but Claude's response only contains `ToolUseBlock`s with no `TextBlock`. Falls through to "I'm not sure" fallback.

**Secondary:** No address pattern detection in `detectIntentAndForceToolChoice()` to route address queries to `comprehensive_place_lookup`.

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | Force text response after max iterations | Done | `api/tippy/chat/route.ts` |
| 2 | Address pattern detection for tool routing | Done | `api/tippy/chat/route.ts` |

### Test Coverage

| Test | File |
|------|------|
| "what do we know about [address]?" | `e2e/tippy-human-questions.spec.ts` |
| "cats at [address]?" | `e2e/tippy-human-questions.spec.ts` |
| "what's the situation at [address]?" | `e2e/tippy-human-questions.spec.ts` |
| "colony status at [address]" | `e2e/tippy-human-questions.spec.ts` |
| Non-existent address graceful handling | `e2e/tippy-human-questions.spec.ts` |
| Multi-turn conversation context | `e2e/tippy-human-questions.spec.ts` |

---

## DQ-003: Tippy Feedback Submission 500 Error

**Date:** 2026-02-01
**Reporter:** Staff (via feedback modal)
**Symptoms:** "Failed to submit feedback" when submitting correction

### Investigation Findings

**Root Causes:**
1. Category mapping: `missing_data` mapped to `"data_gap"` (not in CHECK constraint)
2. `entity_id` column is UUID but form accepts free-text (addresses, names)
3. `missing_data`/`missing_capability` feedback types rejected by CHECK (MIG_476 not applied)

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | Fix category mapping | Done | `api/tippy/feedback/route.ts` |
| 2 | UUID validation for entity_id | Done | `api/tippy/feedback/route.ts` |
| 3 | CHECK constraint fallback | Done | `api/tippy/feedback/route.ts` |

### Test Coverage

| Test | File |
|------|------|
| Valid feedback submission | `e2e/tippy-human-questions.spec.ts` |
| Missing required fields → 400 | `e2e/tippy-human-questions.spec.ts` |
| Non-UUID entity_id handled | `e2e/tippy-human-questions.spec.ts` |
| missing_data type works | `e2e/tippy-human-questions.spec.ts` |
| missing_capability type works | `e2e/tippy-human-questions.spec.ts` |

---

## DQ-004: Stale VolunteerHub Roles — No Automated Deactivation

**Date:** 2026-02-01
**Reporter:** System investigation (DQ-001 follow-up)
**Symptoms:** People who left VolunteerHub groups still show active roles and map badges

### Investigation Findings

**Root Cause:** When a VH volunteer leaves all approved groups, `volunteerhub_group_memberships.left_at` is set by `sync_volunteer_group_memberships()`, but `person_roles.role_status` stays `'active'` forever. The `process_volunteerhub_group_roles()` function only UPGRADES to active — it never DOWNGRADES to inactive.

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | `deactivate_orphaned_vh_roles()` function | Done | MIG_829 |
| 2 | `v_stale_volunteer_roles` view | Done | MIG_829 |
| 3 | `role_reconciliation_log` table | Done | MIG_829 |
| 4 | Retroactive cleanup | Done | MIG_831 |

### Test Coverage

| Test | File |
|------|------|
| Map pin foster/trapper requires volunteer | `e2e/role-lifecycle.spec.ts` |
| Active roles on pins match person_roles | `e2e/role-lifecycle.spec.ts` |

---

## DQ-005: ShelterLuv Name-Only Foster Matching

**Date:** 2026-02-01
**Reporter:** System investigation (DQ-001 follow-up)
**Symptoms:** ClinicHQ clinic clients incorrectly assigned foster roles because name substring-matches ShelterLuv "Hold For" field

### Investigation Findings

**Root Cause:** `process_shelterluv_animal()` (MIG_469, updated MIG_621) uses `display_name ILIKE '%' || v_hold_for || '%'` — pure substring match violating "never match by name alone" rule. ShelterLuv provides `Foster Person Email` field but it was not being used.

**Secondary processor:** MIG_511 (`process_shelterluv_foster_relationships()`) already uses email-first matching correctly, but only creates person_cat_relationships — does NOT assign person_roles.

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | Replace name-only matching with email-first | Done | MIG_828 |
| 2 | `shelterluv_unmatched_fosters` queue table | Done | MIG_828 |
| 3 | Flag legacy name-only matches | Done | MIG_828 |
| 4 | Deactivate suspect foster roles | Done | MIG_831 |

### Test Coverage

| Test | File |
|------|------|
| No org names in map pin people | `e2e/role-lifecycle.spec.ts` |
| Role audit API returns valid structure | `e2e/role-lifecycle.spec.ts` |
| Person roles API returns valid data | `e2e/role-lifecycle.spec.ts` |

---

## DQ-006: Foster/Trapper Without Volunteer Role (Business Rule)

**Date:** 2026-02-01
**Reporter:** Staff (via DQ-001 investigation)
**Symptoms:** People have foster or trapper badges but no volunteer role — violates business rule

### Investigation Findings

**Root Cause:** Three pathways can assign foster/trapper roles without first checking for volunteer:
1. ShelterLuv `process_shelterluv_animal()` assigns foster role with no volunteer check
2. Airtable trapper sync can create trapper role without volunteer role
3. No enforcement of "volunteer is prerequisite for foster/trapper" at the role assignment level

**Business Rule:** All fosters and trappers are FFSC Volunteers first. In VolunteerHub: Approved Volunteers → subgroups (Approved Trappers, Approved Foster Parent).

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | `v_role_without_volunteer` view | Done | MIG_829 |
| 2 | Admin visibility via role-audit page | Done | `/admin/role-audit` |
| 3 | PATCH /api/people/[id]/roles for manual fix | Done | route.ts |

### Test Coverage

| Test | File |
|------|------|
| Map pin foster/trapper requires volunteer | `e2e/role-lifecycle.spec.ts` |
| Role audit endpoint returns valid structure | `e2e/role-lifecycle.spec.ts` |

---

## DQ-007: Role-Source Conflicts (Atlas vs Source System)

**Date:** 2026-02-01
**Reporter:** System investigation (DQ-001 follow-up)
**Symptoms:** Roles show as active in Atlas but the source system (VH/ShelterLuv) shows departed/inactive

### Investigation Findings

**Root Cause:** No automated reconciliation between Atlas `person_roles` and source systems. When VH volunteers depart or ShelterLuv foster assignments end, Atlas retains the active status indefinitely.

### Fixes Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | `v_role_source_conflicts` view | Done | MIG_829 |
| 2 | `deactivate_orphaned_vh_roles()` automation | Done | MIG_829 |
| 3 | Admin role-audit dashboard | Done | `/admin/role-audit` |
| 4 | Data cleanup | Done | MIG_831 |

### Test Coverage

| Test | File |
|------|------|
| Role audit counts match arrays | `e2e/role-lifecycle.spec.ts` |
| Stale roles count accurate | `e2e/role-lifecycle.spec.ts` |

---

## Template for New Entries

```markdown
## DQ-NNN: Title

**Date:** YYYY-MM-DD
**Reporter:** Who found it
**Location/Entity:** Specific entity if applicable
**Symptoms:** What the user observed

### Investigation Findings

**Root Cause:**
...

### Diagnostic SQL

\`\`\`sql
-- Queries to investigate
\`\`\`

### Fixes Required/Applied

| # | Fix | Status | File |
|---|-----|--------|------|
| 1 | Description | Pending/Done | file |

### Test Coverage

| Test | File |
|------|------|
| Description | spec file |
```

---

## DQ-008: Identity Resolution Overhaul Verification (Phase 2-4)

**Date:** 2026-02-08
**Reporter:** Engineering (Phase 3-4 completion audit)
**Symptoms:** Verification that identity resolution overhaul preserved all data

### Investigation Findings

**Phase 3 (Fellegi-Sunter):**
- Implemented probabilistic log-odds scoring (MIG_947/948/949)
- 11 field parameters with M/U probabilities
- Decision thresholds configurable via `fellegi_sunter_thresholds`
- Match decisions now include `fs_composite_score`, `fs_match_probability`, `fs_field_scores`

**Phase 4 (Identity Graph):**
- Created `identity_edges` table with 4,680 edges (MIG_951)
- Backfilled: 92 person merges, 1,918 place merges, 2,670 household relationships
- Transitive closure functions for graph traversal (MIG_952)
- Automatic edge recording via triggers on future merges

**Data Quality Audit Results:**
- NO DATA LOSS confirmed
- All FK constraints intact (0 orphan records)
- All stale references fixed (9,528 records updated in MIG_950)
- 99.1% Google Map entries linked to active places
- 87.6% ClinicHQ appointments linked to people
- 100% requests have valid places
- 88% identifier coverage on people

### Diagnostic SQL

```sql
-- Verify no stale references remain
SELECT 'cat_place → merged' AS check, COUNT(*) FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id WHERE p.merged_into_place_id IS NOT NULL
UNION ALL
SELECT 'person_place → merged', COUNT(*) FROM trapper.person_place_relationships ppr
JOIN trapper.places p ON p.place_id = ppr.place_id WHERE p.merged_into_place_id IS NOT NULL
UNION ALL
SELECT 'appointments → merged', COUNT(*) FROM trapper.sot_appointments a
JOIN trapper.sot_people sp ON sp.person_id = a.person_id WHERE sp.merged_into_person_id IS NOT NULL;

-- Verify identity graph stats
SELECT * FROM trapper.v_identity_graph_stats;

-- Verify F-S configuration
SELECT field_name, m_probability, u_probability, agreement_weight, disagreement_weight
FROM trapper.fellegi_sunter_parameters WHERE is_active ORDER BY ABS(agreement_weight) DESC;
```

### Fixes Applied

| # | Fix | Status | Migration |
|---|-----|--------|-----------|
| 1 | Fellegi-Sunter parameters table | Done | MIG_947 |
| 2 | F-S scoring functions | Done | MIG_948 |
| 3 | Integrate F-S into resolve_identity | Done | MIG_949 |
| 4 | Fix stale merged references | Done | MIG_950 |
| 5 | Identity edges table + backfill | Done | MIG_951 |
| 6 | Transitive closure functions | Done | MIG_952 |
| 7 | Legacy cleanup + documentation | Done | MIG_953 |

### Test Coverage

| Test | File |
|------|------|
| Data quality verification | `scripts/testing/verify_data_quality_fixes.mjs` |
| Edge case integrity | `scripts/testing/data_integrity_edge_cases.mjs` |
| Identity validation utilities | `scripts/lib/identity-validation.mjs` |
| Staff identity review guide | `docs/STAFF_IDENTITY_REVIEW_GUIDE.md` |

### Invariants Added

| Invariant | Description |
|-----------|-------------|
| INV-19 | Fellegi-Sunter Probabilistic Scoring |
| INV-20 | Identity Graph Tracking |
| INV-21 | Stale Reference Prevention |

### Key Verification Queries (Run Post-Deployment)

```sql
-- 1. All stale references should be 0
SELECT 'Stale refs' AS metric, SUM(count) FROM (
  SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
  JOIN trapper.places p ON p.place_id = cpr.place_id WHERE p.merged_into_place_id IS NOT NULL
  UNION ALL SELECT COUNT(*) FROM trapper.person_place_relationships ppr
  JOIN trapper.places p ON p.place_id = ppr.place_id WHERE p.merged_into_place_id IS NOT NULL
) x;

-- 2. Identity graph should have edges
SELECT COUNT(*) AS identity_edges FROM trapper.identity_edges;

-- 3. F-S parameters should be active
SELECT COUNT(*) AS fs_params FROM trapper.fellegi_sunter_parameters WHERE is_active;

-- 4. F-S thresholds should exist
SELECT COUNT(*) AS fs_thresholds FROM trapper.fellegi_sunter_thresholds WHERE is_active;
```

### Final Verification Results (2026-02-08)

**Ingest Routing Verification (`verify_ingest_routing.mjs`):**
| Category | Result |
|----------|--------|
| Centralized function usage | 2/2 PASS |
| F-S configuration active | 3/3 PASS |
| Identity graph active | 3/3 PASS |
| Data engine processing | 1/2 PASS (1 warning - no recent F-S decisions yet) |
| No stale references | 3/3 PASS |
| Source system processing | 3/3 PASS |
| Retroactive change handling | 2/2 PASS |
| **TOTAL** | **17 passed, 0 failed, 1 warning** |

**Data Integrity Edge Cases (`data_integrity_edge_cases.mjs`):**
- **21 passed, 0 failed, 4 warnings**
- FK integrity: All constraints intact
- Entity coverage: All core entities have valid relationships

**Data Quality Fixes (`verify_data_quality_fixes.mjs`):**
- **5 passed, 2 expected failures**
- Expected failures are identifier conflicts (not bugs):
  - 1,252 people with primary_email but no identifier: ALL due to email conflict (same email linked to different person)
  - 266 people with primary_phone but no identifier: 211 conflicts + 55 blacklisted FFSC org phone (707-576-7999)
- Processing rates: 100% ClinicHQ appointment_info, 100% cat_info, 100% PetLink
- Identifier coverage: 88% of people have identifiers

### E2E Tests Added (2026-02-08)

| Test File | Purpose |
|-----------|---------|
| `e2e/identity-review-workflow.spec.ts` | Power user workflow for identity review UI |
| `e2e/tippy-identity-resolution.spec.ts` | Tippy's F-S explanation capabilities |
| `e2e/fixtures/identity-resolution-questions.ts` | Question fixtures for Tippy tests |

**E2E Test Coverage:**
- Review dashboard navigation
- Identity review page (F-S probability display, filters, field breakdowns)
- Review actions (merge, keep separate, batch)
- Legacy URL redirects
- Data engine admin pages
- Tippy explanations: F-S scoring, identity graph, review workflow
- Multi-turn Tippy conversations
- Phase 3-4 specific verifications

