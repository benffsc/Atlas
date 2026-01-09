#!/usr/bin/env bash
# smoke_cockpit.sh - Preflight check for Cockpit required schema + views
#
# Usage:
#   set -a && source .env && set +a
#   bash scripts/smoke_cockpit.sh
#
# Exits non-zero if any required component is missing, with fix commands.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PSQL="${PSQL:-psql}"
DB_URL="${DATABASE_URL:-}"

if [ -z "$DB_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
  echo "Run: set -a && source .env && set +a"
  exit 1
fi

echo "=== FFSC Cockpit Preflight Check ==="
echo ""

MISSING_MIGRATIONS=()
MISSING_TABLES=()
MISSING_VIEWS=()
MISSING_COLUMNS=()

# Helper: check if table exists
table_exists() {
  local schema="$1"
  local table="$2"
  result=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='$schema' AND table_name='$table')")
  [ "$result" = "t" ]
}

# Helper: check if view exists
view_exists() {
  local schema="$1"
  local view="$2"
  result=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='$schema' AND table_name='$view')")
  [ "$result" = "t" ]
}

# Helper: check if column exists
column_exists() {
  local schema="$1"
  local table="$2"
  local column="$3"
  result=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='$schema' AND table_name='$table' AND column_name='$column')")
  [ "$result" = "t" ]
}

# Helper: check if extension exists
extension_exists() {
  local ext="$1"
  result=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='$ext')")
  [ "$result" = "t" ]
}

MISSING_EXTENSIONS=()

echo "Checking required extensions..."
echo "---"

# pg_trgm is required for owner name trigram index in MIG_078
if extension_exists "pg_trgm"; then
  echo -e "  ${GREEN}[OK]${NC} pg_trgm"
else
  echo -e "  ${RED}[MISSING]${NC} pg_trgm (required for owner name search)"
  MISSING_EXTENSIONS+=("pg_trgm")
fi

echo ""
echo "Checking required tables..."
echo "---"

# Core tables
for tbl in requests people places addresses request_notes; do
  if table_exists "trapper" "$tbl"; then
    echo -e "  ${GREEN}[OK]${NC} trapper.$tbl"
  else
    echo -e "  ${RED}[MISSING]${NC} trapper.$tbl"
    MISSING_TABLES+=("$tbl")
  fi
done

# ClinicHQ Historical tables (MIG_078)
for tbl in clinichq_hist_appts clinichq_hist_cats clinichq_hist_owners; do
  if table_exists "trapper" "$tbl"; then
    echo -e "  ${GREEN}[OK]${NC} trapper.$tbl"
  else
    echo -e "  ${RED}[MISSING]${NC} trapper.$tbl"
    MISSING_TABLES+=("$tbl")
    if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_078 " ]]; then
      MISSING_MIGRATIONS+=("MIG_078")
    fi
  fi
done

echo ""
echo "Checking required columns (merge/canonical support)..."
echo "---"

# Requests merge columns (MIG_082)
for col in merged_into_source_record_id merged_into_case_number archive_reason archived_at; do
  if column_exists "trapper" "requests" "$col"; then
    echo -e "  ${GREEN}[OK]${NC} requests.$col"
  else
    echo -e "  ${RED}[MISSING]${NC} requests.$col"
    MISSING_COLUMNS+=("requests.$col")
    if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_082 " ]]; then
      MISSING_MIGRATIONS+=("MIG_082")
    fi
  fi
done

echo ""
echo "Checking required views..."
echo "---"

# Canonical views (MIG_083)
for vw in v_requests_canonical v_search_unified_canonical; do
  if view_exists "trapper" "$vw"; then
    echo -e "  ${GREEN}[OK]${NC} trapper.$vw"
  else
    echo -e "  ${RED}[MISSING]${NC} trapper.$vw"
    MISSING_VIEWS+=("$vw")
    if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_083 " ]]; then
      MISSING_MIGRATIONS+=("MIG_083")
    fi
  fi
done

# Core views
for vw in v_search_unified v_intake_unified_feed v_this_week_focus; do
  if view_exists "trapper" "$vw"; then
    echo -e "  ${GREEN}[OK]${NC} trapper.$vw"
  else
    echo -e "  ${RED}[MISSING]${NC} trapper.$vw"
    MISSING_VIEWS+=("$vw")
  fi
done

# DB_087 views (request-history linking)
echo ""
echo "Checking DB_087 views (request-history linking)..."
echo "---"

for vw in v_request_hist_link_candidates v_request_hist_candidates_top; do
  if view_exists "trapper" "$vw"; then
    echo -e "  ${GREEN}[OK]${NC} trapper.$vw"
  else
    echo -e "  ${RED}[MISSING]${NC} trapper.$vw"
    MISSING_VIEWS+=("$vw")
    if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_085 " ]]; then
      MISSING_MIGRATIONS+=("MIG_085")
    fi
  fi
done

# Check that hist_owner and hist_cat are in v_search_unified (MIG_086)
echo ""
echo "Checking search includes historical entities..."
echo "---"

HIST_OWNER_IN_SEARCH=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM trapper.v_search_unified WHERE entity_type='hist_owner' LIMIT 1)" 2>/dev/null || echo "f")
HIST_CAT_IN_SEARCH=$($PSQL "$DB_URL" -tAc "SELECT EXISTS(SELECT 1 FROM trapper.v_search_unified WHERE entity_type='hist_cat' LIMIT 1)" 2>/dev/null || echo "f")

if [ "$HIST_OWNER_IN_SEARCH" = "t" ]; then
  echo -e "  ${GREEN}[OK]${NC} hist_owner in v_search_unified"
else
  echo -e "  ${RED}[MISSING]${NC} hist_owner not in v_search_unified"
  MISSING_VIEWS+=("hist_owner_in_search")
  if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_086 " ]]; then
    MISSING_MIGRATIONS+=("MIG_086")
  fi
fi

if [ "$HIST_CAT_IN_SEARCH" = "t" ]; then
  echo -e "  ${GREEN}[OK]${NC} hist_cat in v_search_unified"
else
  echo -e "  ${RED}[MISSING]${NC} hist_cat not in v_search_unified"
  MISSING_VIEWS+=("hist_cat_in_search")
  if [[ ! " ${MISSING_MIGRATIONS[*]} " =~ " MIG_086 " ]]; then
    MISSING_MIGRATIONS+=("MIG_086")
  fi
fi

echo ""

# Summary
if [ ${#MISSING_TABLES[@]} -eq 0 ] && [ ${#MISSING_VIEWS[@]} -eq 0 ] && [ ${#MISSING_COLUMNS[@]} -eq 0 ] && [ ${#MISSING_EXTENSIONS[@]} -eq 0 ]; then
  echo -e "${GREEN}=== ALL PREFLIGHT CHECKS PASSED ===${NC}"
  echo ""

  # Show quick stats
  echo "Quick stats:"
  $PSQL "$DB_URL" -P pager=off -c "
    SELECT 'requests' AS table_name, COUNT(*) AS rows FROM trapper.requests
    UNION ALL SELECT 'people', COUNT(*) FROM trapper.people
    UNION ALL SELECT 'places', COUNT(*) FROM trapper.places
    UNION ALL SELECT 'addresses', COUNT(*) FROM trapper.addresses
    UNION ALL SELECT 'clinichq_hist_appts', COUNT(*) FROM trapper.clinichq_hist_appts
    UNION ALL SELECT 'clinichq_hist_cats', COUNT(*) FROM trapper.clinichq_hist_cats
    UNION ALL SELECT 'clinichq_hist_owners', COUNT(*) FROM trapper.clinichq_hist_owners
    ORDER BY table_name;
  " 2>/dev/null || echo "(Historical tables may be empty - run ingest)"

  exit 0
fi

# Show fix commands
echo -e "${RED}=== PREFLIGHT FAILED ===${NC}"
echo ""
echo -e "${YELLOW}Run the following commands to fix:${NC}"
echo ""
echo "export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
echo "set -a && source .env && set +a"
echo ""

# Extensions
if [[ " ${MISSING_EXTENSIONS[*]} " =~ " pg_trgm " ]]; then
  echo "# Enable pg_trgm extension (required for fuzzy name search)"
  echo "psql \"\$DATABASE_URL\" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'"
  echo ""
fi

# Map migrations
if [[ " ${MISSING_MIGRATIONS[*]} " =~ " MIG_078 " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_078__clinichq_hist_tables.sql"
fi
if [[ " ${MISSING_MIGRATIONS[*]} " =~ " MIG_082 " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_082__request_merge_target_source_record_id.sql"
fi
if [[ " ${MISSING_MIGRATIONS[*]} " =~ " MIG_083 " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_083__v_requests_canonical.sql"
fi

# DB_087 migrations
if [[ " ${MISSING_MIGRATIONS[*]} " =~ " MIG_085 " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_085__request_hist_link_candidates.sql"
fi
if [[ " ${MISSING_MIGRATIONS[*]} " =~ " MIG_086 " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_086__extend_search_with_hist.sql"
fi

# Check for v_search_unified
if [[ " ${MISSING_VIEWS[*]} " =~ " v_search_unified " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_077__update_v_search_unified.sql"
fi

# Check for intake views
if [[ " ${MISSING_VIEWS[*]} " =~ " v_intake_unified_feed " ]] || [[ " ${MISSING_VIEWS[*]} " =~ " v_this_week_focus " ]]; then
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_052__create_intake_feed_views.sql"
  echo "psql \"\$DATABASE_URL\" -f sql/migrations/MIG_054__create_weekly_ops_views.sql"
fi

echo ""
exit 1
