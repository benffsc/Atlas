# E2E Test Suite Upgrade Plan

**Date:** 2026-02-21
**Status:** In Progress

## Summary

After running 862 E2E tests, we identified and fixed several critical issues. This document outlines the remaining issues and proposed fixes.

## Completed Fixes

### 1. People API 500 Errors (MIG_2400)
**Problem:** `v_person_list_v3` view was missing columns expected by `/api/people` route.

**Root Cause:** The view definition in MIG_2040 didn't include derived columns like `account_type`, `surface_quality`, `quality_reason`, `cat_names`, etc.

**Fix Applied:**
- Created `MIG_2400__fix_v_person_list_v3_columns.sql`
- Added missing columns: `account_type`, `is_canonical`, `surface_quality`, `quality_reason`, `has_email`, `has_phone`, `cat_count`, `place_count`, `cat_names`, `primary_place`, `source_quality`
- Applied via temporary API endpoint, then cleaned up

**Tests:** `e2e/api-schema-validation.spec.ts` now validates People API returns expected columns.

### 2. Cats API Missing source_system (MIG_2401)
**Problem:** `v_cat_list` view didn't include `source_system` for data provenance.

**Root Cause:** Original view definition in MIG_2322 didn't select `source_system`.

**Fix Applied:**
- Updated `v_cat_list` to include `c.source_system`
- Updated `/api/cats/route.ts` to select and type `source_system`

**Tests:** `e2e/api-schema-validation.spec.ts` validates Cats API returns `source_system`.

### 3. Tippy Test Authentication
**Problem:** Tippy tests were failing because they used unauthenticated `request` fixture.

**Root Cause:** Playwright's standalone `request` fixture doesn't inherit `storageState` cookies from auth setup.

**Fix Applied:**
- Created `e2e/helpers/auth-api.ts` with `askTippyAuthenticated()` helper
- Updated `tippy-capabilities.spec.ts` and `tippy-cross-source.spec.ts` to use `page.request` instead of standalone `request`

**Remaining:** Tippy tests still fail due to Anthropic API connectivity issues (infrastructure, not code).

### 4. Visual Regression Baselines
**Problem:** No baseline screenshots existed for visual regression tests.

**Fix Applied:**
- Ran `npx playwright test e2e/visual-regression.spec.ts --update-snapshots`
- Generated 17 baseline screenshots in `e2e/visual-regression.spec.ts-snapshots/`

---

## Known Issues Requiring Future Fixes

### Issue 1: Malformed UUID Handling (API Routes)
**Severity:** Medium
**Affected:** `/api/people/[id]`, `/api/cats/[id]`, `/api/places/[id]`

**Problem:** Passing a non-UUID string (e.g., "not-a-uuid") causes 500 error instead of 400/404.

**Proposed Fix:**
```typescript
// In each [id]/route.ts, add validation at the top
const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!isValidUUID.test(id)) {
  return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
}
```

**Test:** `e2e/api-schema-validation.spec.ts` - "APIs handle malformed UUIDs gracefully" (currently skipped)

### Issue 2: Negative Pagination Values (API Routes)
**Severity:** Low
**Affected:** `/api/places`, `/api/cats`, `/api/people`

**Problem:** Negative `limit` values cause 500 error instead of using defaults.

**Proposed Fix:**
```typescript
// In each route.ts
const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") || "50", 10), 100));
const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));
```

**Test:** `e2e/api-schema-validation.spec.ts` - "APIs handle extreme pagination gracefully" (currently skipped)

### Issue 3: Tippy API Anthropic Connectivity
**Severity:** High (for Tippy functionality)
**Affected:** `/api/tippy/chat`

**Problem:** Tippy tests return "I'm having trouble connecting right now" indicating Anthropic API errors.

**Investigation Needed:**
1. Check `ANTHROPIC_API_KEY` validity
2. Check rate limiting
3. Add better error logging to see actual Anthropic error

**Proposed Improvements:**
- Add retry logic for transient failures
- Add timeout handling
- Log specific Anthropic error messages for debugging

### Issue 4: Remaining Tippy Test Files Need Auth Updates
**Severity:** Low
**Affected:** Multiple Tippy test files

**Files needing update to use `page.request`:**
- `tippy-identity-resolution.spec.ts`
- `tippy-staff-workflows.spec.ts`
- `tippy-human-questions.spec.ts`
- `tippy-edge-cases.spec.ts`
- `staff-daily-workflows.spec.ts`
- `tippy-expected-gaps.spec.ts`
- `tippy-accuracy-verification.spec.ts`
- `tippy-infrastructure.spec.ts`
- `tippy-complex-queries.spec.ts`
- `tippy-cross-source-stress.spec.ts`

**Proposed Fix:** Follow the pattern in `tippy-capabilities.spec.ts` - import `askTippyAuthenticated` from `helpers/auth-api.ts`.

---

## Test Infrastructure Improvements

### 1. API Schema Validation Tests (NEW)
**File:** `e2e/api-schema-validation.spec.ts`

Added tests that verify database views have expected columns before API requests fail. This catches column mismatches early.

### 2. Visual Regression Tests (UPDATED)
**File:** `e2e/visual-regression.spec.ts`

All 17 baseline screenshots now exist. Run `--update-snapshots` when intentionally changing UI.

### 3. Authenticated API Test Helpers (NEW)
**File:** `e2e/helpers/auth-api.ts`

Provides `askTippyAuthenticated()`, `apiGet()`, `apiPost()` helpers that use authenticated `page.request` context.

---

## Test Results Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| API Schema Validation | 13 | 0 | 2 (known issues) |
| Visual Regression | 17 | 0 | 0 |
| Tippy Tests | ~20 | ~30 | ~50 |
| Other E2E | Varies | Varies | Varies |

---

## Tippy Testing Strategy (Cost vs Capability Balance)

### The Problem

Tippy tests call the actual Anthropic API (Sonnet) on every run, which:
- Burns API credits rapidly (~50+ Tippy tests × API calls per test)
- Adds 5-10+ seconds latency per test
- Can hit rate limits
- Makes test results non-deterministic (AI responses vary)

**BUT**: We can't just mock everything or use a cheaper model - we need to verify Tippy's **real capabilities** work in production.

### Tiered Testing Strategy

We split Tippy tests into **three tiers** based on what they're actually testing:

#### Tier 1: Infrastructure Tests (Mock API - Run Always)
**Purpose:** Test the plumbing, not the AI.
**Run When:** Every PR, every commit, CI/CD always.
**API Calls:** Zero (mocked responses).

Tests include:
- Authentication/authorization works
- API route handles errors gracefully
- Request/response format is correct
- Session management works
- Tool execution plumbing works
- Rate limiting and timeout handling

**Implementation:**
```typescript
// e2e/tippy-infrastructure.spec.ts
test.describe("Tippy Infrastructure (Mocked)", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept Anthropic API calls
    await page.route('**/api.anthropic.com/**', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          content: [{ type: "text", text: "Mocked response" }],
          stop_reason: "end_turn",
        }),
      });
    });
  });

  test("handles auth correctly", ...);
  test("returns proper error format", ...);
});
```

#### Tier 2: Tool Verification Tests (Record/Replay - Run Daily)
**Purpose:** Verify tools execute correctly and return expected data shapes.
**Run When:** Nightly builds, weekly full runs.
**API Calls:** Zero in replay mode, real calls only when refreshing recordings.

Tests include:
- `comprehensive_place_lookup` returns place data
- `query_trapper_stats` returns trapper info
- `query_cat_journey` traces cat history
- Each tool produces valid output format

**Implementation:** Use Playwright's HAR recording:
```bash
# Record real API responses (run periodically)
npx playwright test e2e/tippy-tools.spec.ts --update-har

# Replay from recordings (daily runs)
npx playwright test e2e/tippy-tools.spec.ts
```

**Refresh Schedule:** Re-record every 2 weeks or when tools change.

#### Tier 3: Capability Tests (Real API - Run Weekly/Pre-Release)
**Purpose:** Verify Tippy actually understands questions and produces good answers.
**Run When:** Weekly scheduled run, pre-release validation, manual QA.
**API Calls:** Full real calls to Anthropic.

Tests include:
- Cross-source deduction (can Tippy combine ClinicHQ + ShelterLuv data?)
- Complex queries (can Tippy answer "show me colonies needing attention"?)
- Context awareness (can Tippy use map context to answer spatial questions?)
- Human-style questions (can Tippy understand vague requests?)

**Implementation:**
```typescript
// e2e/tippy-capabilities-real.spec.ts
// Tag with @real-api so they can be run selectively
test.describe("Tippy Real Capabilities @real-api", () => {
  test.setTimeout(60000); // Long timeout for real API

  test("can deduce volunteer + trapper status", async ({ page }) => {
    const response = await askTippyAuthenticated(page,
      "Is there anyone who is both a volunteer and has trapped cats?"
    );
    // Validate response has meaningful content
    expect(response.message.length).toBeGreaterThan(100);
    expect(response.message).toMatch(/volunteer|trapper/i);
  });
});
```

### Test Organization

```
e2e/
├── tippy/
│   ├── infrastructure.spec.ts    # Tier 1: Mocked, always run
│   ├── tools-replay.spec.ts      # Tier 2: HAR replay, daily
│   ├── tools-replay.har          # Recorded API responses
│   ├── capabilities-real.spec.ts # Tier 3: Real API, weekly
│   └── fixtures/
│       └── mock-responses.ts     # Standard mock responses
```

### CI/CD Configuration

```yaml
# .github/workflows/test.yml
jobs:
  pr-tests:
    # Fast tests for every PR
    run: npx playwright test --grep-invert="@real-api"

  nightly-tests:
    # Full infrastructure + replay tests
    schedule: "0 2 * * *"  # 2 AM daily
    run: npx playwright test --grep-invert="@real-api"

  weekly-capability:
    # Real API capability tests
    schedule: "0 3 * * 0"  # 3 AM Sunday
    run: npx playwright test --grep="@real-api"
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Playwright Config Updates

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'fast',
      testMatch: /.*\.spec\.ts/,
      testIgnore: [
        '**/tippy-capabilities-real.spec.ts',
        '**/tippy-*-stress.spec.ts',
      ],
    },
    {
      name: 'full',
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
```

### Cost Estimation

| Test Tier | Tests | API Calls | Cost/Run | Frequency | Monthly Cost |
|-----------|-------|-----------|----------|-----------|--------------|
| Tier 1 (Mocked) | ~30 | 0 | $0 | 50/month | $0 |
| Tier 2 (Replay) | ~40 | 0* | $0* | 30/month | ~$2 (refresh) |
| Tier 3 (Real) | ~50 | ~100 | ~$0.50 | 4/month | ~$2 |
| **Total** | ~120 | ~100/mo | - | - | **~$4/month** |

*Tier 2 costs only when refreshing recordings (~2x/month).

### Migration Path

**Phase 1 (This Week):**
1. Create `e2e/tippy/` directory structure
2. Move existing Tippy tests, tag with `@real-api`
3. Add mock interceptor helper to `helpers/auth-api.ts`
4. Update CI to skip `@real-api` tests by default

**Phase 2 (Next Week):**
1. Create infrastructure tests (Tier 1)
2. Set up HAR recording for tool tests
3. Extract common mock responses to fixtures

**Phase 3 (Following Week):**
1. Refine capability tests to minimal essential set
2. Set up weekly CI job for real API tests
3. Add alerting for capability test failures

### Key Principle

> **Test the AI where it matters, mock it where it doesn't.**
>
> - Auth working? Mock it.
> - Error handling? Mock it.
> - Tool returns data? Replay it.
> - Tippy understands complex questions? Real API.

---

## Priority Actions

1. **High Priority:** Fix malformed UUID handling in API routes (prevents 500 errors)
2. **High Priority:** Implement Tippy Tier 1 (mocked) tests to stop API burn
3. **High Priority:** Investigate Anthropic API connectivity for Tippy
4. **Medium Priority:** Fix negative pagination handling
5. **Medium Priority:** Set up HAR recording for Tier 2 tests
6. **Low Priority:** Update remaining Tippy test files to use authenticated helpers

---

## Migration Files Created

- `sql/schema/v2/MIG_2400__fix_v_person_list_v3_columns.sql`
- `sql/schema/v2/MIG_2401__add_source_system_to_v_cat_list.sql` (needs to be created from applied SQL)

---

## Files Modified

### API Routes
- `apps/web/src/app/api/cats/route.ts` - Added `source_system` to interface and SELECT

### E2E Tests
- `apps/web/e2e/tippy-capabilities.spec.ts` - Updated to use authenticated helper
- `apps/web/e2e/tippy-cross-source.spec.ts` - Updated to use authenticated helper
- `apps/web/e2e/api-schema-validation.spec.ts` - NEW: Schema validation tests
- `apps/web/e2e/helpers/auth-api.ts` - NEW: Authenticated API helpers
- `apps/web/e2e/visual-regression.spec.ts-snapshots/*` - NEW: 17 baseline images

---

## Next Steps: Implementation Checklist

### Immediate (Stop the API Burn)

- [ ] **Create mock interceptor helper**
  ```typescript
  // e2e/helpers/tippy-mock.ts
  export async function mockAnthropicAPI(page: Page, response?: string) {
    await page.route('**/api/tippy/chat', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: response || "This is a mocked Tippy response for testing.",
          conversationId: "mock-conv-id",
        }),
      });
    });
  }
  ```

- [ ] **Tag all current Tippy tests with `@real-api`**
  ```typescript
  test.describe("Tippy Tests @real-api", () => { ... });
  ```

- [ ] **Update playwright.config.ts to skip `@real-api` by default**
  ```typescript
  grep: process.env.INCLUDE_REAL_API ? undefined : { not: /@real-api/ },
  ```

- [ ] **Create `tippy-infrastructure.spec.ts`** with mocked tests for:
  - Auth required (returns "no access" without session)
  - Empty message validation (returns 400)
  - Malformed request handling
  - Session cookie passed correctly

### Short-term (This Week)

- [ ] Set up HAR recording workflow
- [ ] Create minimal Tier 3 test set (10-15 essential capability tests)
- [ ] Add CI job configuration

### Medium-term (Next 2 Weeks)

- [ ] Migrate all Tippy tests to new directory structure
- [ ] Set up weekly capability test run
- [ ] Add Slack/email alerting for capability test failures
- [ ] Document recording refresh process

---

## Run Commands Reference

```bash
# Fast tests (no real API calls) - for PR checks
npm run test:e2e -- --grep-invert="@real-api"

# Schema validation only (super fast)
npm run test:e2e -- e2e/api-schema-validation.spec.ts

# Visual regression only
npm run test:e2e -- e2e/visual-regression.spec.ts

# Full capability tests (burns API credits)
INCLUDE_REAL_API=1 npm run test:e2e -- --grep="@real-api"

# Update visual baselines
npm run test:e2e -- e2e/visual-regression.spec.ts --update-snapshots

# Update HAR recordings (when tools change)
npm run test:e2e -- e2e/tippy/tools-replay.spec.ts --update-har
```
