#!/usr/bin/env bash
set -euo pipefail

# run_sanity.sh
# Execute QRY_*.sql sanity queries via psql

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
QUERIES_DIR="$REPO_ROOT/sql/queries"

# Load .env for DATABASE_URL
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL not set"
    exit 1
fi

# Find psql
PSQL="${PSQL:-$(command -v psql 2>/dev/null || echo "/opt/homebrew/Cellar/libpq/18.1/bin/psql")}"

if [[ ! -x "$PSQL" ]]; then
    echo "ERROR: psql not found at $PSQL"
    exit 1
fi

echo "========================================"
echo "  FFSCTrapperApp Sanity Queries"
echo "========================================"
echo ""

# Run each QRY_*.sql file
shopt -s nullglob
qry_files=("$QUERIES_DIR"/QRY_*.sql)
shopt -u nullglob

if [[ ${#qry_files[@]} -eq 0 ]]; then
    echo "No QRY_*.sql files found in $QUERIES_DIR"
    exit 0
fi

for qry_file in "${qry_files[@]}"; do
    echo "--- $(basename "$qry_file") ---"
    "$PSQL" "$DATABASE_URL" -P pager=off -f "$qry_file" --quiet
    echo ""
done

echo "========================================"
echo "  Done"
echo "========================================"
