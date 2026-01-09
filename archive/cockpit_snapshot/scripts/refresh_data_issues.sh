#!/bin/bash
# refresh_data_issues.sh
# Safely refreshes data_issues from v_ops_requests
#
# Usage:
#   set -a && source .env && set +a
#   bash scripts/refresh_data_issues.sh
#
# Prerequisites:
#   - MIG_100 applied (data_issues table, v_ops_requests view)
#   - MIG_101 applied (refresh_data_issues_from_ops function)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Data Issues Refresh"
echo "=========================================="
echo ""

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
    echo ""
    echo "Run: set -a && source .env && set +a"
    exit 1
fi

# Set psql path (macOS homebrew)
export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"

# Check function exists
echo -e "${YELLOW}Checking prerequisites...${NC}"
FUNC_EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'refresh_data_issues_from_ops' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper'));" 2>/dev/null)

if [ "$FUNC_EXISTS" != "t" ]; then
    echo -e "${RED}ERROR: refresh_data_issues_from_ops function not found${NC}"
    echo ""
    echo "Apply MIG_101 first:"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_101__data_issues_refresh.sql"
    exit 2
fi

echo -e "${GREEN}Prerequisites OK${NC}"
echo ""

# Show what we'll do
echo -e "${YELLOW}About to refresh data_issues from v_ops_requests...${NC}"
echo ""

# Pre-refresh counts
echo "Current data_issues counts:"
psql "$DATABASE_URL" -c "SELECT issue_type, COUNT(*) FILTER (WHERE NOT is_resolved) AS open, COUNT(*) FILTER (WHERE is_resolved) AS resolved FROM trapper.data_issues GROUP BY issue_type ORDER BY issue_type;" 2>/dev/null || echo "(table may be empty)"
echo ""

# Run the refresh
echo -e "${YELLOW}Running refresh_data_issues_from_ops()...${NC}"
echo ""
psql "$DATABASE_URL" -c "SELECT * FROM trapper.refresh_data_issues_from_ops();"
echo ""

# Post-refresh summary
echo -e "${GREEN}Refresh complete!${NC}"
echo ""
echo "Updated data_issues counts:"
psql "$DATABASE_URL" -c "SELECT issue_type, COUNT(*) FILTER (WHERE NOT is_resolved) AS open, COUNT(*) FILTER (WHERE is_resolved) AS resolved FROM trapper.data_issues GROUP BY issue_type ORDER BY issue_type;"
echo ""

# Sample of open issues
echo "Sample open issues (top 10):"
psql "$DATABASE_URL" -c "SELECT issue_type, details->>'case_number' AS case_number, details->>'display_name' AS display_name, ROUND(EXTRACT(EPOCH FROM (now() - first_seen_at)) / 86400.0, 1) AS days_open FROM trapper.data_issues WHERE NOT is_resolved ORDER BY severity DESC, last_seen_at DESC LIMIT 10;"
echo ""

echo "=========================================="
echo -e "${GREEN}Done${NC}"
echo "=========================================="
