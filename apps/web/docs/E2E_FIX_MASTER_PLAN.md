# E2E Test Fix Master Plan

**Generated:** 2026-03-02
**Status:** Investigation Complete, Ready for Implementation
**Total Tests:** 1132 | **Passed:** 592 (52%) | **Failed:** 333 | **Skipped:** 201

---

## EXECUTIVE SUMMARY

The test failures fall into **5 root cause categories**:

| Category | Failures | Root Cause | Fix Type |
|----------|----------|------------|----------|
| **Missing Database Views** | ~80 | `ops.v_beacon_*` views not deployed | Database Migration |
| **API Response Format** | ~30 | Tests expect `data.summary` but API returns `data.data.summary` | Test Update |
| **Auth/Login Timeout** | ~45 | Tippy tests failing during auth setup | Test Configuration |
| **Missing API Endpoints** | ~15 | Some endpoints return 500 | Code Bug |
| **UI Selector Changes** | ~50 | TabBar, Actions label, etc. changed | Test Update |

---

## CATEGORY 1: Missing Database Views (~80 failures)

### Problem
Tests query `/api/beacon/*` endpoints which require these database views:
- `ops.v_beacon_summary`
- `ops.v_beacon_cluster_summary`
- `ops.v_beacon_places`

When views don't exist, API returns 500 error with:
```json
{"success": false, "error": {"message": "Beacon views not deployed", "code": 500}}
```

Tests then fail trying to access `data.summary.total_cats` on an error response.

### Affected Tests
- `beacon-analytics.spec.ts` (23 failures)
- `ecological-data-sanity.spec.ts` (7 failures)
- `data-quality-unified.spec.ts` (partial)

### Fix
1. **Deploy beacon views to test database**
   ```bash
   # Run migration
   psql $TEST_DATABASE_URL < sql/schema/v2/MIG_2082__beacon_views_implementation.sql
   ```

2. **Or skip these tests when views don't exist** (add graceful handling)

### Verification
```sql
SELECT EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_beacon_summary');
```

---

## CATEGORY 2: API Response Format Mismatch (~30 failures)

### Problem
APIs use `apiSuccess()` which wraps responses:
```javascript
// API returns:
{ success: true, data: { summary: {...}, insights: {...} } }

// Tests expect:
data.summary.total_cats  // WRONG - should be data.data.summary.total_cats
```

### Affected Tests
- `api-schema-validation.spec.ts` (7 failures)
- `beacon-analytics.spec.ts` (partial)
- `v2-data-integrity.spec.ts` (partial)

### Fix Options

**Option A: Fix tests to match API format**
```typescript
// Before
const data = await response.json();
expect(data.summary.total_cats).toBeDefined();

// After
const data = await response.json();
expect(data.data.summary.total_cats).toBeDefined();
```

**Option B: Create test helper**
```typescript
// e2e/helpers/api-helpers.ts
export async function getApiData(response: Response) {
  const json = await response.json();
  return json.data; // Unwrap the apiSuccess wrapper
}
```

### Verification
- Check all API tests use consistent response parsing

---

## CATEGORY 3: Auth/Login Timeout (~45 failures)

### Problem
Tests timeout at `page.waitForURL('/', { timeout: 15000 })` during authentication.
This affects all Tippy tests and some data quality tests.

Error:
```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
> 58 |   await page.waitForURL('/', { timeout: 15000 });
```

### Root Cause Investigation Needed
1. Is the login actually failing?
2. Is there a redirect issue?
3. Is the home page not loading?

### Affected Tests
- `data-quality-tippy.spec.ts` (32 failures)
- `tippy-*.spec.ts` (all - ~45 total)

### Fix
1. **Increase timeout** (temporary)
2. **Debug login flow** - check if login completes
3. **Skip Tippy tests by default** (they require Claude API anyway)

```typescript
// playwright.config.ts
export default defineConfig({
  grepInvert: /@real-api|@tippy/,  // Skip Tippy tests by default
});
```

---

## CATEGORY 4: Missing/Broken API Endpoints (~15 failures)

### Problem
Some API endpoints return 500 errors:
- `/api/people/search` - returns 500
- `/api/requests` POST - "Failed to create request" (code 500)
- `/api/intake/decline` - validation issues

### Affected Tests
- `request-workflow-stress.spec.ts` (6 failures)
- `entity-lifecycle.spec.ts` (6 failures)
- `role-lifecycle.spec.ts` (3 failures)

### Fix
**These are real bugs that need investigation:**

1. **`/api/people/search` returning 500**
   - Check database connection
   - Check query syntax
   - Add error logging

2. **`POST /api/requests` failing**
   - Validate request body handling
   - Check required fields

3. **`/api/intake/decline` validation**
   - Missing validation for required fields
   - Need to add proper error handling

### Priority: HIGH - These are real application bugs

---

## CATEGORY 5: UI Selector Changes (~50 failures)

### Problem
UI was updated (TabBar component, label changes) but tests weren't updated.

### Specific Changes
1. **TabBar component** - replaced `TabNav` and `ProfileLayout` tabs
2. **"Quick:" → "Actions:"** - label changed in request detail
3. **Tab content detection** - inline styles changed

### Affected Tests
- `ui-workflows.spec.ts` (29 failures)
- `ui-comprehensive.spec.ts` (17 failures)
- `visual-regression.spec.ts` (11 failures)
- `request-detail-interactions.spec.ts` (already partially fixed)

### Fixes Already Applied This Session
- `cat-detail-interactions.spec.ts` - Fixed tab count (3 not 4)
- `request-detail-interactions.spec.ts` - Updated for TabBar
- `ui-test-helpers.ts` - Fixed TabBar detection
- `src/app/login/page.tsx` - Fixed error object rendering (REAL BUG)

### Remaining Fixes
```typescript
// Common patterns to update:

// OLD
await page.locator('text=Quick:').click();
// NEW
await page.locator('text=Actions:').click();

// OLD
await page.locator('[role="tab"]:has-text("Activity")').click();
// NEW
await page.locator('button:has-text("Activity")').click();
```

### Visual Regression
```bash
npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```

---

## IMPLEMENTATION PLAN

### Phase 1: Database Setup (30 min)
**No credits needed - local database work**

1. Check if beacon views exist
2. Deploy missing views if needed
3. Verify with SQL query

### Phase 2: Test Configuration (1 hour)
**No credits needed - config changes**

1. Add proper test tags:
   - `@real-api` for Claude API tests
   - `@real-data` for production data tests
   - `@beacon` for beacon view tests
   - `@fast` for quick unit-style tests

2. Update `playwright.config.ts`:
   ```typescript
   grepInvert: process.env.INCLUDE_SLOW_TESTS ? undefined : /@real-api|@real-data/
   ```

3. Update `package.json`:
   ```json
   "test:e2e:fast": "playwright test --grep @fast",
   "test:e2e:full": "INCLUDE_SLOW_TESTS=1 playwright test"
   ```

### Phase 3: Fix Real Bugs (2-3 hours)
**These are APP bugs, not test bugs**

1. `/api/people/search` - investigate 500 error
2. `/api/requests` POST - fix validation/creation
3. `/api/intake/decline` - add validation
4. Any other 500 errors found

### Phase 4: Update Tests (2-3 hours)
**Test maintenance**

1. Update API response parsing (data.data.X pattern)
2. Update UI selectors (TabBar, Actions label)
3. Regenerate visual snapshots
4. Fix auth timeout issues

### Phase 5: Validation (1 hour)
**Run targeted tests to verify fixes**

```bash
# Test each category
npx playwright test e2e/beacon-analytics.spec.ts
npx playwright test e2e/api-schema-validation.spec.ts
npx playwright test e2e/ui-workflows.spec.ts
```

---

## REAL BUGS FOUND (APP ISSUES, NOT TEST ISSUES)

### BUG-1: Login Page Error Handling (FIXED)
- **File:** `src/app/login/page.tsx`
- **Issue:** API returns error as `{message, code}` object, not string
- **Fix:** Extract `.message` before setting state
- **Status:** FIXED this session

### BUG-2: `/api/people/search` Returns 500
- **File:** TBD
- **Issue:** Endpoint returns 500 error
- **Fix:** Investigate and fix
- **Status:** NEEDS INVESTIGATION

### BUG-3: Request Creation Fails
- **File:** `/api/requests/route.ts`
- **Issue:** POST returns "Failed to create request" (500)
- **Fix:** Investigate validation/DB issues
- **Status:** NEEDS INVESTIGATION

### BUG-4: Beacon Views Not Deployed
- **Issue:** `ops.v_beacon_*` views missing from database
- **Fix:** Run migration MIG_2082
- **Status:** NEEDS VERIFICATION

---

## COST MANAGEMENT

### High-Cost Operations (REQUIRE PERMISSION)
- Running full test suite with Tippy tests (uses Claude API)
- Any AI-powered test verification

### Low-Cost Operations (OK TO RUN)
- Running subset of tests (`--grep @fast`)
- Database migrations
- Code changes and builds
- Single test file runs

### Recommended Test Commands
```bash
# Fast - no API calls, under 5 minutes
npx playwright test --grep-invert "@real-api|@beacon" --workers=4

# Single file debugging
npx playwright test e2e/ui-workflows.spec.ts --debug

# Update snapshots only
npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```

---

## NEXT STEPS (IN ORDER)

1. **Verify beacon views exist** - simple SQL check
2. **Fix API response parsing in tests** - bulk find/replace
3. **Update UI selectors** - TabBar, Actions label
4. **Investigate `/api/people/search` 500 error** - real bug
5. **Add test tags for categorization**
6. **Run targeted tests to verify fixes**

---

## FILES TO MODIFY

| File | Change Type | Priority |
|------|-------------|----------|
| `playwright.config.ts` | Add grep patterns | HIGH |
| `e2e/beacon-analytics.spec.ts` | Fix API parsing | HIGH |
| `e2e/api-schema-validation.spec.ts` | Fix API parsing | HIGH |
| `e2e/ui-workflows.spec.ts` | Update selectors | MEDIUM |
| `e2e/ui-comprehensive.spec.ts` | Update selectors | MEDIUM |
| `e2e/helpers/api-helpers.ts` | Add helper | MEDIUM |
| `src/app/api/people/search/route.ts` | Fix 500 error | HIGH |
| `src/app/api/requests/route.ts` | Fix creation | HIGH |
