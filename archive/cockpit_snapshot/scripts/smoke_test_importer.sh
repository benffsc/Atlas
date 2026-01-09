#!/usr/bin/env bash
set -euo pipefail

# smoke_test_importer.sh
# Usage: bash scripts/smoke_test_importer.sh <csv_path> [schema]
# Runs importer twice (idempotency test) then runs all CHK checks.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# --- Argument parsing ---
CSV_PATH="${1:-}"
SCHEMA="${2:-trapper}"

if [[ -z "$CSV_PATH" ]]; then
    echo "ERROR: csv_path is required"
    echo "Usage: bash scripts/smoke_test_importer.sh <csv_path> [schema]"
    exit 1
fi

if [[ ! -f "$CSV_PATH" ]]; then
    echo "ERROR: CSV file not found: $CSV_PATH"
    exit 1
fi

# --- Load .env ---
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
else
    echo "ERROR: .env file not found at $REPO_ROOT/.env"
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL not set in .env"
    exit 1
fi

# --- Find Python: prefer .venv/bin/python, then python3, then python ---
PYTHON=""
if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    PYTHON="$REPO_ROOT/.venv/bin/python"
elif command -v python3 &> /dev/null; then
    PYTHON="python3"
elif command -v python &> /dev/null; then
    PYTHON="python"
else
    echo "ERROR: No python found. Install python3 or create .venv."
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo "ERROR: psql not found in PATH"
    echo "Hint: export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    exit 1
fi

# --- Run importer (first pass) ---
echo "=== PASS 1: Running importer (initial import) ==="
"$PYTHON" "$REPO_ROOT/ingest_airtable_trapping_requests.py" --csv "$CSV_PATH" --schema "$SCHEMA"

# --- Run importer (second pass - idempotency) ---
echo ""
echo "=== PASS 2: Running importer (idempotency test) ==="
"$PYTHON" "$REPO_ROOT/ingest_airtable_trapping_requests.py" --csv "$CSV_PATH" --schema "$SCHEMA"

# --- Run checks ---
echo ""
echo "=== PASS 3: Running SQL checks ==="
bash "$REPO_ROOT/scripts/run_checks.sh"

echo ""
echo "=== Smoke test complete ==="
