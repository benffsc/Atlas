#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

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

CHECKS_DIR="$REPO_ROOT/sql/checks"

for check_file in "$CHECKS_DIR"/CHK_*.sql; do
    if [[ -f "$check_file" ]]; then
        check_name="$(basename "$check_file" .sql)"
        echo "=== $check_name ==="
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -t -A -P pager=off -f "$check_file"
        echo ""
    fi
done
