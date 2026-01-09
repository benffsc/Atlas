#!/usr/bin/env bash
#
# preflight_web_contracts.sh
# Check that required DB objects exist for web app data contracts.
# Run before dev server / build to catch missing migrations early.
#
# Usage: bash scripts/preflight_web_contracts.sh
#
# Exit 0 = all required objects present
# Exit 1 = missing objects (prints which ones + likely MIG files)
#

set -euo pipefail

# ============================================================
# Load environment
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set. Source .env or set env var."
  exit 2
fi

# ============================================================
# Configuration: Required objects
# ============================================================

# Format: "schema.table_or_view:column1,column2,column3"
REQUIRED_TABLES=(
  "trapper.requests:id,case_number,status,priority_label,notes,created_at,updated_at,archived_at"
  "trapper.data_issues:entity_type,entity_id,issue_type,severity,details,last_seen_at,is_resolved"
)

# Views are checked for existence only (columns vary by migration version)
REQUIRED_VIEWS=(
  "trapper.v_requests_canonical"
)

# Optional views - warn if missing but don't fail
OPTIONAL_VIEWS=(
  "trapper.v_ops_summary"
  "trapper.v_ops_data_issues_counts"
  "trapper.v_ops_data_issues_by_request"
  "trapper.v_triage_counts"
  "trapper.v_triage_items"
  "trapper.v_dashboard_upcoming_clinics"
  "trapper.v_dashboard_open_requests"
)

# ============================================================
# Helper functions
# ============================================================

check_table_exists() {
  local schema_table="$1"
  local schema="${schema_table%%.*}"
  local table="${schema_table#*.}"

  psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '$schema' AND table_name = '$table'
    LIMIT 1
  " 2>/dev/null | grep -q "1"
}

check_view_exists() {
  local schema_view="$1"
  local schema="${schema_view%%.*}"
  local view="${schema_view#*.}"

  psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM information_schema.views
    WHERE table_schema = '$schema' AND table_name = '$view'
    LIMIT 1
  " 2>/dev/null | grep -q "1"
}

check_column_exists() {
  local schema_table="$1"
  local column="$2"
  local schema="${schema_table%%.*}"
  local table="${schema_table#*.}"

  psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '$schema' AND table_name = '$table' AND column_name = '$column'
    LIMIT 1
  " 2>/dev/null | grep -q "1"
}

# ============================================================
# Main checks
# ============================================================

echo "=== FFSC Web App Data Contract Preflight ==="
echo ""

MISSING_TABLES=()
MISSING_COLUMNS=()
MISSING_VIEWS=()
MISSING_OPTIONAL=()

# Check required tables and their columns
for spec in "${REQUIRED_TABLES[@]}"; do
  table="${spec%%:*}"
  columns="${spec#*:}"

  if ! check_table_exists "$table"; then
    MISSING_TABLES+=("$table")
  else
    IFS=',' read -ra cols <<< "$columns"
    for col in "${cols[@]}"; do
      if ! check_column_exists "$table" "$col"; then
        MISSING_COLUMNS+=("$table.$col")
      fi
    done
  fi
done

# Check required views
for view in "${REQUIRED_VIEWS[@]}"; do
  if ! check_view_exists "$view"; then
    MISSING_VIEWS+=("$view")
  fi
done

# Check optional views (warn only)
for view in "${OPTIONAL_VIEWS[@]}"; do
  if ! check_view_exists "$view"; then
    MISSING_OPTIONAL+=("$view")
  fi
done

# ============================================================
# Report results
# ============================================================

HAS_ERRORS=0

if [ ${#MISSING_TABLES[@]} -gt 0 ]; then
  echo "MISSING TABLES:"
  for t in "${MISSING_TABLES[@]}"; do
    echo "  - $t"
  done
  echo ""
  echo "  Likely needs: MIG_060 (requests table) or earlier schema migrations"
  echo ""
  HAS_ERRORS=1
fi

if [ ${#MISSING_COLUMNS[@]} -gt 0 ]; then
  echo "MISSING COLUMNS:"
  for c in "${MISSING_COLUMNS[@]}"; do
    echo "  - $c"
  done
  echo ""
  echo "  Likely needs: Check recent MIG_07x-08x for column additions"
  echo ""
  HAS_ERRORS=1
fi

if [ ${#MISSING_VIEWS[@]} -gt 0 ]; then
  echo "MISSING REQUIRED VIEWS:"
  for v in "${MISSING_VIEWS[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "  Likely needs:"
  echo "    - v_requests_canonical: MIG_078__v_requests_canonical.sql"
  echo ""
  HAS_ERRORS=1
fi

if [ ${#MISSING_OPTIONAL[@]} -gt 0 ]; then
  echo "OPTIONAL VIEWS (warning only - pages will use fallbacks):"
  for v in "${MISSING_OPTIONAL[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "  These enhance the UI but pages will degrade gracefully."
  echo "  To enable, apply:"
  echo "    - v_ops_summary: MIG_100__v_ops_summary.sql"
  echo "    - v_ops_data_issues_*: MIG_101__v_ops_data_issues_views.sql"
  echo "    - v_triage_*: Check MIG_09x series"
  echo "    - v_dashboard_*: Check MIG_09x series"
  echo ""
fi

# Summary
echo "=== Summary ==="
if [ $HAS_ERRORS -eq 1 ]; then
  echo "FAILED: Required objects missing. Apply migrations before starting dev server."
  echo ""
  echo "To apply migrations manually:"
  echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_XXX__name.sql"
  echo ""
  exit 1
else
  echo "OK: All required tables, columns, and views present."
  if [ ${#MISSING_OPTIONAL[@]} -gt 0 ]; then
    echo "    (${#MISSING_OPTIONAL[@]} optional views missing - pages will use fallbacks)"
  fi
  echo ""
  exit 0
fi
