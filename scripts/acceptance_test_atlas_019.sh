#!/usr/bin/env bash
# acceptance_test_atlas_019.sh
# ATLAS_019 Acceptance Test: Google-like Search
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_019.sh
#
# Debug mode (prints redacted connection info):
#   DEBUG=1 ./scripts/acceptance_test_atlas_019.sh
#
# SECURITY WARNING:
#   Do NOT run with `bash -x` or `set -x` — this will print DATABASE_URL
#   including credentials to stdout/logs. Use DEBUG=1 instead.

set -euo pipefail

# ============================================
# Colors
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ============================================
# Counters (initialize to avoid unbound errors)
# ============================================
PASS_COUNT=0
FAIL_COUNT=0

# ============================================
# Helper Functions
# ============================================

# Increment pass count safely (avoids set -e exit on ((0++)))
pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

# Increment fail count safely
fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
    echo -e "${YELLOW}⚠ WARN:${NC} $1"
}

# Redact password from DATABASE_URL for safe logging
# Input: postgresql://user:password@host:port/db or postgres://...
# Output: postgresql://user:****@host:port/db
redact_db_url() {
    local url="${1:-}"
    # Replace password between : and @ with ****
    echo "$url" | sed -E 's|(://[^:]+:)[^@]+(@)|\1****\2|'
}

# Print debug info (only when DEBUG=1)
debug_info() {
    if [[ "${DEBUG:-}" == "1" ]]; then
        echo ""
        echo "--- DEBUG INFO ---"
        echo "DATABASE_URL (redacted): $(redact_db_url "${DATABASE_URL:-}")"
        # Extract host/db for visibility without secrets
        if [[ "${DATABASE_URL:-}" =~ @([^:/]+) ]]; then
            echo "Host: ${BASH_REMATCH[1]}"
        fi
        if [[ "${DATABASE_URL:-}" =~ /([^?]+)(\?|$) ]]; then
            echo "Database: ${BASH_REMATCH[1]}"
        fi
        echo "------------------"
        echo ""
    fi
}

# Check required environment variable
require_env() {
    local k="$1"
    if [[ -z "${!k:-}" ]]; then
        echo -e "${RED}✗ FAIL:${NC} Missing required env var: $k"
        exit 2
    fi
}

# Run psql query quietly, return tuples only
psqlq() {
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -t -A -c "$1"
}

# ============================================
# Main Test Script
# ============================================

echo "============================================"
echo "ATLAS_019 Acceptance Test: Google-like Search"
echo "============================================"
echo ""

require_env DATABASE_URL
debug_info

# -------- Test 1: pg_trgm extension
echo "Test 1: Checking pg_trgm extension..."
ext="$(psqlq "SELECT extname FROM pg_extension WHERE extname='pg_trgm';" || true)"
if [[ "$ext" == "pg_trgm" ]]; then
    pass "pg_trgm extension is installed"
else
    fail "pg_trgm extension is NOT installed"
fi
echo ""

# -------- Test 2: required functions exist
echo "Test 2: Checking required functions exist..."
for fn in search_unified search_suggestions search_unified_counts search_deep; do
    ok="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='${fn}' LIMIT 1;" || true)"
    if [[ "$ok" == "1" ]]; then
        pass "Function trapper.${fn} exists"
    else
        fail "Function trapper.${fn} is missing"
    fi
done
echo ""

# -------- Test 3: required views exist
echo "Test 3: Checking required views exist..."
for vw in v_person_detail v_place_detail v_person_list v_place_list; do
    ok="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='${vw}' LIMIT 1;" || true)"
    if [[ "$ok" == "1" ]]; then
        pass "View trapper.${vw} exists"
    else
        fail "View trapper.${vw} is missing"
    fi
done
echo ""

# -------- Test 4: suggestions returns something for a "real" prefix
echo "Test 4: Suggestions should return results for a data-derived prefix..."
prefix="$(psqlq "SELECT lower(substr(display_name,1,3))
                FROM trapper.sot_cats
                WHERE display_name ~ '^[A-Za-z]'
                ORDER BY display_name
                LIMIT 1;" || true)"

if [[ -z "${prefix:-}" ]]; then
    prefix="$(psqlq "SELECT lower(substr(display_name,1,3))
                    FROM trapper.sot_people
                    WHERE display_name ~ '^[A-Za-z]'
                    ORDER BY display_name
                    LIMIT 1;" || true)"
fi

if [[ -z "${prefix:-}" ]]; then
    # last-resort fallback (won't assert >0)
    prefix="cat"
    warn "Could not derive prefix from data; using fallback '${prefix}'"
fi

cnt="$(psqlq "SELECT COUNT(*) FROM trapper.search_suggestions('${prefix}', 8);" || echo "0")"
if [[ "${cnt}" =~ ^[0-9]+$ ]] && [[ "${cnt}" -ge 1 ]]; then
    pass "search_suggestions('${prefix}') returned ${cnt} rows"
else
    fail "search_suggestions('${prefix}') returned ${cnt} rows (expected >= 1)"
fi
echo ""

# -------- Test 5: unified search returns something for same prefix
echo "Test 5: Unified search should return results for the same prefix..."
cnt2="$(psqlq "SELECT COUNT(*) FROM trapper.search_unified('${prefix}', NULL, 25, 0);" || echo "0")"
if [[ "${cnt2}" =~ ^[0-9]+$ ]] && [[ "${cnt2}" -ge 1 ]]; then
    pass "search_unified('${prefix}') returned ${cnt2} rows"
else
    fail "search_unified('${prefix}') returned ${cnt2} rows (expected >= 1)"
fi
echo ""

# -------- Test 6: counts function runs and returns rows
echo "Test 6: Counts function should execute..."
cnt3="$(psqlq "SELECT COUNT(*) FROM trapper.search_unified_counts('${prefix}');" || echo "0")"
if [[ "${cnt3}" =~ ^[0-9]+$ ]] && [[ "${cnt3}" -ge 1 ]]; then
    pass "search_unified_counts('${prefix}') returned ${cnt3} rows"
else
    fail "search_unified_counts('${prefix}') returned ${cnt3} rows (expected >= 1)"
fi
echo ""

# -------- Test 7: deep search executes (may return 0; just must not error)
echo "Test 7: Deep search should execute (no error)..."
deep_err_file=$(mktemp)
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "SELECT * FROM trapper.search_deep('${prefix}', 5);" >/dev/null 2>"$deep_err_file"; then
    pass "search_deep('${prefix}') executed successfully"
else
    # Show error details without exposing DATABASE_URL
    deep_err=$(cat "$deep_err_file" | head -10)
    fail "search_deep('${prefix}') failed to execute"
    if [[ -n "$deep_err" ]]; then
        echo -e "  ${YELLOW}Error details:${NC}"
        echo "$deep_err" | sed 's/^/    /'
    fi
fi
rm -f "$deep_err_file"
echo ""

# -------- Test 8: trigram indexes exist
echo "Test 8: Checking trigram indexes exist..."
idx_count="$(psqlq "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='trapper' AND indexname LIKE '%trgm%';" || echo "0")"
if [[ "${idx_count}" =~ ^[0-9]+$ ]] && [[ "${idx_count}" -ge 4 ]]; then
    pass "Found ${idx_count} trigram indexes (expected >= 4)"
else
    fail "Found only ${idx_count} trigram indexes (expected >= 4)"
fi
echo ""

# ============================================
# Summary
# ============================================
echo "============================================"
echo -e "SUMMARY: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"
echo "============================================"
echo ""

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
