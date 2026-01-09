#!/usr/bin/env bash
# smoke_refresh_contract.sh
# MEGA_008: Verify ingest refresh contract invariants
#
# Usage:
#   bash scripts/smoke_refresh_contract.sh
#
# Requirements:
#   - DATABASE_URL set in .env
#   - psql available (PATH includes libpq bin)

set -e

# Load environment
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not set. Check your .env file."
    exit 2
fi

# Add libpq to PATH if on macOS with Homebrew
if [ -d "/opt/homebrew/Cellar/libpq/18.1/bin" ]; then
    export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
fi

echo "============================================"
echo "MEGA_008: Ingest Refresh Contract Smoke Test"
echo "============================================"
echo ""

# Run invariants query and capture output
echo "Running invariant checks..."
echo ""

# Use a temporary file to capture results
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

psql "$DATABASE_URL" -f sql/queries/QRY_262__ingest_refresh_invariants.sql 2>&1 | tee "$TMPFILE"

echo ""

# Check for FAIL in output
if grep -q "FAIL" "$TMPFILE"; then
    echo "============================================"
    echo "SMOKE TEST FAILED: One or more invariants violated!"
    echo "============================================"
    echo ""
    echo "Failed checks:"
    grep "FAIL" "$TMPFILE"
    exit 1
fi

echo ""
echo "============================================"
echo "SMOKE TEST PASSED: All invariants satisfied"
echo "============================================"
echo ""
echo "Refresh contract is working correctly:"
echo "  - No NULL source_pk values"
echo "  - No duplicate (source_system, source_pk) in mutable tables"
echo "  - Unique constraints exist"
echo "  - Source PK uniqueness rate is 100%"
echo ""
echo "You can safely re-ingest the same export without duplicates."
