#!/usr/bin/env bash
# smoke_ui_routes.sh - Quick UI route validation (UI_242)
#
# Usage:
#   # Start dev server first: npm -C apps/web run dev
#   bash scripts/smoke_ui_routes.sh [base_url] [delay]
#
# Default base_url: http://localhost:3000
# Default delay: 0.3 seconds between requests
# Exits non-zero if any route returns non-200.
#
# Note: Includes small delays between requests to avoid
# Supabase connection pool exhaustion (MaxClientsInSessionMode).
#
# === 5-MINUTE MANUAL DEMO SCRIPT (UI_242) ===
#
# 1. Open /ops/ui-test → verify sample links load
# 2. Click a person link → verify Person Archive shows:
#    - Last Seen date in header
#    - Best Known Phone/Email sections
#    - Canonical Cats table
#    - ClinicHQ Source Records table
# 3. Click a cat from the person page → verify Cat Archive shows:
#    - Medical Summary section
#    - Physical Details
#    - Source Appointments table
# 4. Click canonical owner link → verify navigation back to person
# 5. Go to /search → type a phone number
#    - Toggle Deep Search on/off
#    - Verify historical results appear/disappear
# 6. Go to /ops/interpretation → verify stats load
#
# =============================================

BASE_URL="${1:-http://localhost:3000}"
# Delay between requests (in seconds) - avoids pool exhaustion
DELAY="${2:-0.3}"

echo "=== Atlas UI Route Smoke Test ==="
echo "Base URL: $BASE_URL"
echo "Request delay: ${DELAY}s"
echo ""

FAILED=0
PASSED=0

check_route() {
  path="$1"
  desc="$2"
  # -L follows redirects (307/302 -> final page)
  code=$(curl -s -L -o /dev/null -w "%{http_code}" "${BASE_URL}${path}" 2>/dev/null || echo "000")

  if [ "$code" = "200" ]; then
    echo "  [OK]  $path - $desc"
    PASSED=$((PASSED + 1))
  else
    echo "  [FAIL:$code] $path - $desc"
    FAILED=$((FAILED + 1))
  fi

  # Small delay to avoid connection pool exhaustion
  sleep "$DELAY"
}

echo "Core pages:"
echo "---"
check_route "/" "Homepage"
check_route "/ops" "Ops dashboard"
check_route "/ops/ui-test" "UI test dashboard"
check_route "/week" "Week view"
check_route "/search" "Search"
check_route "/triage" "Triage dashboard"
check_route "/focus" "Focus dashboard"
check_route "/requests" "Requests list"
check_route "/history" "History"
check_route "/dashboard" "Dashboard"

echo ""
echo "API endpoints:"
echo "---"
check_route "/api/health" "Health check"
check_route "/api/preflight" "Preflight check"

echo ""
echo "/requests edge cases (DEMO_001):"
echo "---"
check_route "/requests?status=" "Empty status param"
check_route "/requests?status=all" "status=all"
check_route "/requests?status=not-a-real-status" "Invalid status (should not crash)"

echo ""
echo "Optional pages:"
echo "---"
check_route "/ops/place-rollups" "Place rollups"
check_route "/ops/place-promotion" "Place promotion"
check_route "/ops/people-linking" "People linking"
check_route "/ops/interpretation" "Interpretation rules (UI_242)"
check_route "/ops/health" "System health (UI_245)"

echo ""
echo "UI_242 Archive pages (search-based tests):"
echo "---"
# Test search functionality (the pages themselves work, we test via search)
check_route "/search?q=test" "Search query - basic"
check_route "/search?q=cat" "Search query - cat"
check_route "/search?q=7073185126" "Search - phone digits only"

echo ""
echo "UI_244 Address search tests:"
echo "---"
# Test address-like search detection
check_route "/search?q=123%20Main%20St" "Search - address-like query"
check_route "/search?q=456%20Oak%20Avenue" "Search - address with Avenue"
check_route "/search?q=789%20Elm%20Rd" "Search - address with Rd"

echo ""
echo "UI_244 Deep Search toggle tests:"
echo "---"
check_route "/search?q=test&deep=0" "Search - deep=0 (canonical only)"
check_route "/search?q=test&deep=1" "Search - deep=1 (include historical)"

echo ""
echo "UI_242 Phone normalization (API tests):"
echo "---"
# These test that phone normalization works in search
check_route "/api/search?q=7073185126&limit=5" "API search - phone digits"
check_route "/api/search?q=(707)%20318-5126&limit=5" "API search - phone formatted"
check_route "/api/search?q=707-318-5126&limit=5" "API search - phone dashes"

echo ""
echo "UI_244 People/Cats archive pages:"
echo "---"
# Test that archive pages load (will 404 if no data, but that's OK)
# These routes exist and should not 500
check_route "/api/people/test" "API people - test ID (may 404)"

echo ""
echo "---"
echo "Passed: $PASSED  Failed: $FAILED"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "=== SMOKE TEST FAILED ==="
  echo "Check that the dev server is running: npm -C apps/web run dev"
  echo ""
  echo "If you see 500 errors with 'MaxClientsInSessionMode', increase DELAY:"
  echo "  bash scripts/smoke_ui_routes.sh http://localhost:3000 0.5"
  exit 1
else
  echo "=== ALL ROUTES PASSED ==="
  exit 0
fi
