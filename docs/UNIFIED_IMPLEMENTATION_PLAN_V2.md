# Atlas Unified Implementation Plan v2

**Created:** 2026-03-03
**Purpose:** Consolidated roadmap merging completed work status, E2E test findings, and remaining enhancements
**Last E2E Run:** 2026-03-02 (592 passed, 333 failed, 201 skipped of 1132 tests)

---

## EXECUTIVE SUMMARY

The Atlas V2 data overhaul is **functionally complete** (Chunks 1-9 of the Master Plan all done). However, the comprehensive E2E test run revealed:

- **~95 real application bugs** (API endpoints returning 500, missing database views)
- **~238 test maintenance issues** (UI selectors outdated, API response format changes)

This plan consolidates all remaining work into prioritized chunks.

---

## COMPLETION STATUS

### Previously Completed (Master Plan Chunks 1-9) ✅

| Chunk | Description | Status |
|-------|-------------|--------|
| 1 | Data Quality Fixes | ✅ COMPLETE |
| 2 | Appointment Entity Unification | ✅ COMPLETE |
| 3 | Cat Deduplication System | ✅ COMPLETE |
| 4 | Clinic History Unification | ✅ COMPLETE |
| 5 | Colony Estimate Reconciliation | ✅ COMPLETE |
| 6 | ClinicHQ Notes Ingestion | ✅ COMPLETE |
| 7 | Clinic Days Improvements | ✅ COMPLETE |
| 8 | Ingest UI Improvements | ✅ COMPLETE |
| 9 | Request System Polish | ✅ COMPLETE |

### UI Restructure (Phase 8) ✅

| Task | Status |
|------|--------|
| TabBar component created | ✅ |
| Request, Place, Person pages standardized | ✅ |
| Duplicate TabNav implementations removed | ✅ |

---

## NEW CHUNKS (E2E Test Findings + Remaining Work)

### Priority Legend

| Priority | Meaning |
|----------|---------|
| P0 | Critical - App bugs, 500 errors, blocking issues |
| P1 | High - Test suite health, CI/CD enablement |
| P2 | Medium - Data quality, Entity linking fortification |
| P3 | Low - Test maintenance, visual regression |

---

## CHUNK 10: Critical API Bug Fixes (P0)

**Source:** E2E test failures (CATEGORY 4 - ~15 failures)
**Estimated Scope:** 3-4 hours
**Cost:** $0 (no Claude API)

Real application bugs that return 500 errors.

### 10.1 Fix `/api/people/search` 500 Error
- **Evidence:** Tests fail with "Cannot read properties of undefined"
- **File:** `src/app/api/people/search/route.ts`
- **Investigation:** Check query syntax, null handling, DB connection
- **Verification:** `curl /api/people/search?q=test` returns 200

### 10.2 Fix `POST /api/requests` 500 Error
- **Evidence:** "Failed to create request" (code 500)
- **File:** `src/app/api/requests/route.ts`
- **Investigation:** Validate request body handling, check required fields
- **Verification:** Create test request via API returns 201

### 10.3 Fix `/api/intake/decline` Validation
- **Evidence:** Validation issues on decline endpoint
- **File:** `src/app/api/intake/decline/route.ts`
- **Investigation:** Check required fields, add proper error handling
- **Verification:** Decline request with valid body returns 200

### 10.4 Add UUID Validation to Entity Routes
- **Evidence:** Non-UUID strings cause 500 instead of 400
- **Files:** `/api/people/[id]`, `/api/cats/[id]`, `/api/places/[id]`
- **Fix:** Add UUID validation at route top:
```typescript
import { isValidUUID } from '@/lib/uuid';
if (!isValidUUID(id)) {
  return apiError({ message: "Invalid ID format" }, 400);
}
```

---

## CHUNK 11: Deploy Missing Database Views (P0)

**Source:** E2E test failures (CATEGORY 1 - ~80 failures)
**Estimated Scope:** 1-2 hours
**Cost:** $0 (database work only)

Beacon analytics tests fail because views don't exist in test database.

### 11.1 Verify Beacon Views Exist
```sql
SELECT EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_summary');
SELECT EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_cluster_summary');
SELECT EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_places');
```

### 11.2 Deploy if Missing
```bash
psql $DATABASE_URL < sql/schema/v2/MIG_2082__beacon_views_implementation.sql
```

### 11.3 Update API Graceful Degradation
- **File:** `src/app/api/beacon/summary/route.ts`
- Already has view existence check - verify it works correctly

---

## CHUNK 12: Test Suite Infrastructure (P1)

**Source:** E2E_TEST_UPGRADE_PLAN.md + new test run findings
**Estimated Scope:** 4-5 hours
**Cost:** $0 (configuration only)

Make tests CI-ready and properly categorized.

### 12.1 Add Test Tags
Update test files with proper tags:
- `@fast` - Unit-style tests, no external dependencies
- `@real-api` - Requires Claude API (Tippy tests)
- `@real-data` - Requires production-like data
- `@beacon` - Requires beacon views
- `@visual` - Visual regression tests

### 12.2 Update playwright.config.ts
```typescript
export default defineConfig({
  // Skip expensive tests by default
  grepInvert: process.env.INCLUDE_ALL_TESTS
    ? undefined
    : /@real-api|@real-data/,

  projects: [
    { name: 'fast', testMatch: /.*\.spec\.ts/, testIgnore: ['**/tippy-*'] },
    { name: 'full', testMatch: /.*\.spec\.ts/ },
  ],
});
```

### 12.3 Update package.json Scripts
```json
{
  "test:e2e": "playwright test --grep-invert @real-api",
  "test:e2e:fast": "playwright test --grep @fast",
  "test:e2e:visual": "playwright test --grep @visual",
  "test:e2e:ci": "playwright test --grep-invert \"@real-api|@real-data\"",
  "test:e2e:full": "INCLUDE_ALL_TESTS=1 playwright test"
}
```

### 12.4 Create Mock Interceptor for Tippy
```typescript
// e2e/helpers/tippy-mock.ts
export async function mockTippyAPI(page: Page, response?: string) {
  await page.route('**/api/tippy/chat', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: response || "Mocked Tippy response for testing.",
        conversationId: "mock-conv-id",
      }),
    });
  });
}
```

---

## CHUNK 13: API Response Format Fixes (P1)

**Source:** E2E test failures (CATEGORY 2 - ~30 failures)
**Estimated Scope:** 2-3 hours
**Cost:** $0 (test updates only)

Tests expect `data.summary` but API uses `apiSuccess()` which wraps as `{ success: true, data: { summary } }`.

### 13.1 Create API Helper
```typescript
// e2e/helpers/api-helpers.ts
export async function getApiData<T>(response: Response): Promise<T> {
  const json = await response.json();
  if (!json.success) throw new Error(json.error?.message || 'API error');
  return json.data as T;
}
```

### 13.2 Update Beacon Tests
- **File:** `e2e/beacon-analytics.spec.ts`
- Update all response parsing to use `data.data.summary` pattern
- Or use the helper: `const data = await getApiData(response)`

### 13.3 Update API Schema Validation Tests
- **File:** `e2e/api-schema-validation.spec.ts`
- Verify all tests use consistent response parsing

### 13.4 Update V2 Data Integrity Tests
- **File:** `e2e/v2-data-integrity.spec.ts`
- Fix response format expectations

---

## CHUNK 14: UI Selector Updates (P2)

**Source:** E2E test failures (CATEGORY 5 - ~50 failures)
**Estimated Scope:** 3-4 hours
**Cost:** $0 (test updates only)

UI was updated (TabBar component migration) but tests weren't.

### 14.1 Update TabBar Selectors
Common pattern changes:
```typescript
// OLD (TabNav)
await page.locator('[role="tab"]:has-text("Activity")').click();

// NEW (TabBar)
await page.locator('button:has-text("Activity")').click();
// OR
await page.locator('[role="tablist"] button:has-text("Activity")').click();
```

### 14.2 Update "Quick:" to "Actions:" Label
```typescript
// OLD
await page.locator('text=Quick:').click();

// NEW
await page.locator('text=Actions:').click();
```

### 14.3 Files to Update
- `e2e/ui-workflows.spec.ts` (29 failures)
- `e2e/ui-comprehensive.spec.ts` (17 failures)
- `e2e/personal-dashboard.spec.ts` (17 failures)

### 14.4 Update Visual Regression Baselines
```bash
npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```

---

## CHUNK 15: Auth/Login Timeout Fixes (P2)

**Source:** E2E test failures (CATEGORY 3 - ~45 failures)
**Estimated Scope:** 2-3 hours
**Cost:** $0 (test configuration)

Tippy tests timeout at login: `page.waitForURL('/', { timeout: 15000 })`

### 15.1 Investigate Login Flow
- Check if login actually completes in test environment
- Check for redirect issues
- Check home page load time

### 15.2 Increase Timeout (Temporary Fix)
```typescript
// e2e/fixtures/auth.ts
await page.waitForURL('/', { timeout: 30000 });
```

### 15.3 Skip Tippy Tests by Default
Already handled in Chunk 12 with `@real-api` tag.

### 15.4 Update Auth Test Helpers
```typescript
// e2e/helpers/auth-api.ts
export async function waitForAuthComplete(page: Page) {
  // Wait for auth indicator instead of URL
  await page.waitForSelector('[data-testid="user-menu"]', { timeout: 30000 });
}
```

---

## CHUNK 16: Entity Linking Fortification (P2)

**Source:** ENTITY_LINKING_FORTIFICATION_PLAN.md (DATA_GAP_040, DATA_GAP_041)
**Estimated Scope:** 4-6 hours
**Cost:** $0 (database work)

Fragile patterns in entity linking that can cause silent data loss.

### 16.1 MIG_2430: Remove Clinic Fallback
- Remove COALESCE that falls back to clinic address
- Add logging for skipped cats

### 16.2 MIG_2431: Prevent Silent NULL Updates
- Use explicit JOIN instead of subquery UPDATE
- Add monitoring for unmatched appointments

### 16.3 MIG_2432: Add Orchestrator Validation
- Validate between steps
- Log run results to audit table
- Create `ops.entity_linking_runs` table

### 16.4 MIG_2433: Fix LATERAL Join NULLs
- Log cats skipped due to person having no place
- Create `ops.entity_linking_skipped` table

### 16.5 MIG_2434: Convert Confidence to Enum
- Add `sot.confidence_level` enum type
- Migrate existing data

### 16.6 MIG_2435: Add Monitoring Views
- `ops.v_cats_without_places`
- `ops.v_clinic_leakage`
- `ops.v_entity_linking_history`
- `ops.v_entity_linking_skipped_summary`

---

## CHUNK 17: Volunteer Temporal Tracking (P3)

**Source:** CURRENT_STATE_AND_PLAN.md (Phase 11)
**Estimated Scope:** 2 hours
**Cost:** $0 (migrations ready)

Optional enhancement - migrations already created.

### 17.1 Apply MIG_2366
- Create `ops.volunteer_roles` table with temporal validity

### 17.2 Apply MIG_2367
- Populate roles from VolunteerHub data

### 17.3 Verify Views Work
- `v_active_volunteers`
- `v_volunteer_role_history`
- `v_volunteer_role_counts`

---

## CHUNK 18: Test Data Cleanup (P3)

**Source:** Test junk data in database
**Estimated Scope:** 1-2 hours
**Cost:** $0

### 18.1 Create Cleanup Script
```sql
-- scripts/cleanup-test-data.sql
DELETE FROM web_intake_submissions WHERE is_test = true;
DELETE FROM sot_requests WHERE source_system = 'e2e_test';
DELETE FROM sot_people WHERE email LIKE 'e2e-%@test.example.com';
DELETE FROM sot_places WHERE display_name LIKE 'e2e-test-%';
DELETE FROM sot_cats WHERE cat_name LIKE 'e2e-test-%';
```

### 18.2 Add afterAll Hooks to Tests
Ensure test cleanup runs after test completion.

### 18.3 Verify Cleanup
```sql
SELECT COUNT(*) FROM sot_people WHERE email LIKE 'e2e-%';
-- Should be 0
```

---

## IMPLEMENTATION ORDER

### Phase 1: Critical Bug Fixes (P0) - Do First

| Order | Chunk | Description | Effort |
|-------|-------|-------------|--------|
| 1 | 10 | Critical API Bug Fixes | 3-4 hours |
| 2 | 11 | Deploy Missing Database Views | 1-2 hours |

**Phase 1 Total:** ~5-6 hours

### Phase 2: Test Suite Health (P1) - Do Second

| Order | Chunk | Description | Effort |
|-------|-------|-------------|--------|
| 3 | 12 | Test Suite Infrastructure | 4-5 hours |
| 4 | 13 | API Response Format Fixes | 2-3 hours |

**Phase 2 Total:** ~6-8 hours

### Phase 3: Data Quality (P2) - Do Third

| Order | Chunk | Description | Effort |
|-------|-------|-------------|--------|
| 5 | 14 | UI Selector Updates | 3-4 hours |
| 6 | 15 | Auth/Login Timeout Fixes | 2-3 hours |
| 7 | 16 | Entity Linking Fortification | 4-6 hours |

**Phase 3 Total:** ~9-13 hours

### Phase 4: Polish (P3) - Do Last

| Order | Chunk | Description | Effort |
|-------|-------|-------------|--------|
| 8 | 17 | Volunteer Temporal Tracking | 2 hours |
| 9 | 18 | Test Data Cleanup | 1-2 hours |

**Phase 4 Total:** ~3-4 hours

---

## TOTAL EFFORT ESTIMATE

| Phase | Priority | Hours |
|-------|----------|-------|
| Phase 1 | P0 | 5-6 |
| Phase 2 | P1 | 6-8 |
| Phase 3 | P2 | 9-13 |
| Phase 4 | P3 | 3-4 |
| **Total** | - | **23-31 hours** |

---

## DEPENDENCIES GRAPH

```
Chunk 10 (API Bugs) ─────────────────────────────┐
                                                 │
Chunk 11 (Database Views) ──────────────────────>├── Chunk 12 (Test Infrastructure)
                                                 │          │
                                                 │          v
                                                 └──> Chunk 13 (API Response Fixes)
                                                             │
                                                             v
Chunk 14 (UI Selectors) ──────────────────────────────────> Tests Pass

Chunk 15 (Auth Timeout) ──────────────────────────────────> Tippy Tests Viable

Chunk 16 (Entity Linking) ─────────────────────────────────> Data Quality Improved

Chunk 17 (Volunteer Temporal) ─────────────────────────────> (Standalone)

Chunk 18 (Test Cleanup) ───────────────────────────────────> (Standalone)
```

---

## SUCCESS CRITERIA

After all chunks complete:

- [ ] All API endpoints return proper status codes (no 500s for valid requests)
- [ ] Beacon views deployed and API gracefully handles missing views
- [ ] E2E tests run with `npm run test:e2e:ci` (fast, no Claude API)
- [ ] Test pass rate > 85% (excluding @real-api tests)
- [ ] Entity linking has validation and monitoring
- [ ] No test junk data in database
- [ ] Visual regression baselines updated

---

## COST MANAGEMENT

### Zero-Cost Operations (All Chunks)
- Database migrations
- Test file updates
- Configuration changes
- Code bug fixes

### Potential Cost (Avoid Unless Needed)
- Running full Tippy tests with `@real-api` tag (burns Claude credits)
- Only run weekly or for pre-release validation

### Recommended Commands
```bash
# Fast CI tests (no API cost)
npm run test:e2e:ci

# Single file debugging (no API cost)
npx playwright test e2e/ui-workflows.spec.ts --debug

# Update visual snapshots (no API cost)
npx playwright test --grep @visual --update-snapshots
```

---

## RELATED DOCUMENTATION

| Document | Purpose |
|----------|---------|
| `docs/E2E_FIX_MASTER_PLAN.md` | Detailed E2E failure analysis |
| `docs/E2E_TEST_RESULTS_2026_03_02.md` | Test run summary |
| `docs/E2E_TEST_UPGRADE_PLAN.md` | Tippy testing strategy |
| `docs/ENTITY_LINKING_FORTIFICATION_PLAN.md` | Entity linking fixes |
| `docs/MASTER_IMPLEMENTATION_PLAN.md` | Previous plan (Chunks 1-9 complete) |
| `docs/CURRENT_STATE_AND_PLAN.md` | Overall system status |
