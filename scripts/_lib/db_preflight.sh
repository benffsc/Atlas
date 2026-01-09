#!/usr/bin/env bash
# db_preflight.sh
#
# Database connection preflight checks for Atlas scripts.
# Source this at the top of any script that needs DATABASE_URL.
#
# Usage:
#   source scripts/_lib/db_preflight.sh
#
# Checks:
#   1. DATABASE_URL is set
#   2. Host is not the direct db.<ref>.supabase.co (often IPv6-only)
#   3. DNS resolves to at least one A record (IPv4)
#
# On failure: prints guidance and exits non-zero.

set -e

# Colors (safe to re-declare if already defined)
_PF_RED='\033[0;31m'
_PF_GREEN='\033[0;32m'
_PF_YELLOW='\033[0;33m'
_PF_CYAN='\033[0;36m'
_PF_BOLD='\033[1m'
_PF_RESET='\033[0m'

# Extract components from DATABASE_URL
_db_preflight_parse_url() {
  local url="$1"

  # Remove protocol prefix
  local no_proto="${url#*://}"

  # Extract host:port/db from user:pass@host:port/db
  local host_part="${no_proto#*@}"
  host_part="${host_part%%\?*}"  # Remove query string

  # Extract host (before port)
  DB_HOST="${host_part%%:*}"

  # Extract port (between : and /)
  local port_db="${host_part#*:}"
  DB_PORT="${port_db%%/*}"

  # Extract database name
  DB_NAME="${port_db#*/}"
}

# Check DNS A records for host
_db_preflight_check_dns() {
  local host="$1"
  local a_records=""

  # Try dig first (most reliable)
  if command -v dig &>/dev/null; then
    a_records=$(dig +short "$host" A 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
  fi

  # Fallback to python if dig didn't work
  if [[ -z "$a_records" ]] && command -v python3 &>/dev/null; then
    a_records=$(python3 -c "
import socket
try:
    infos = socket.getaddrinfo('$host', None, socket.AF_INET)
    for info in infos:
        print(info[4][0])
except:
    pass
" 2>/dev/null || true)
  fi

  echo "$a_records"
}

# Main preflight check
db_preflight() {
  echo ""
  echo -e "${_PF_BOLD}Database Preflight Check${_PF_RESET}"
  echo "────────────────────────────────────"

  # 1. Check DATABASE_URL is set
  if [[ -z "$DATABASE_URL" ]]; then
    echo -e "${_PF_RED}FAIL:${_PF_RESET} DATABASE_URL is not set"
    echo ""
    echo "To fix, run:"
    echo "  set -a && source .env && set +a"
    echo ""
    exit 1
  fi

  # 2. Parse URL
  _db_preflight_parse_url "$DATABASE_URL"

  echo -e "${_PF_CYAN}Host:${_PF_RESET}     $DB_HOST"
  echo -e "${_PF_CYAN}Port:${_PF_RESET}     $DB_PORT"
  echo -e "${_PF_CYAN}Database:${_PF_RESET} $DB_NAME"

  # 3. Check for direct host (db.<ref>.supabase.co)
  if [[ "$DB_HOST" =~ ^db\..+\.supabase\.co$ ]]; then
    echo ""
    echo -e "${_PF_RED}FAIL:${_PF_RESET} Direct host detected: $DB_HOST"
    echo ""
    echo "The direct host (db.<ref>.supabase.co) is often IPv6-only and will"
    echo "fail on networks without IPv6 support."
    echo ""
    echo "To fix, update your .env to use the session pooler:"
    echo ""
    echo "  DATABASE_URL='postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require'"
    echo ""
    echo "Get this URL from: Supabase Dashboard > Settings > Database > Connection String > Session Pooler"
    echo ""
    exit 1
  fi

  # 4. Check DNS A records
  local a_records
  a_records=$(_db_preflight_check_dns "$DB_HOST")

  if [[ -z "$a_records" ]]; then
    echo ""
    echo -e "${_PF_RED}FAIL:${_PF_RESET} No IPv4 (A) records found for: $DB_HOST"
    echo ""
    echo "This host cannot be reached over IPv4. Possible fixes:"
    echo ""
    echo "1. Use the session pooler (recommended):"
    echo "   DATABASE_URL='postgresql://...@aws-0-[region].pooler.supabase.com:5432/postgres'"
    echo ""
    echo "2. If using transaction pooler, ensure port is 6543:"
    echo "   DATABASE_URL='postgresql://...@aws-0-[region].pooler.supabase.com:6543/postgres'"
    echo ""
    echo "3. Ensure sslmode=require is in the connection string"
    echo ""
    exit 1
  fi

  # Count A records for display
  local record_count
  record_count=$(echo "$a_records" | wc -l | tr -d ' ')
  echo -e "${_PF_CYAN}IPv4:${_PF_RESET}     $record_count A record(s) found"

  echo ""
  echo -e "${_PF_GREEN}Preflight passed${_PF_RESET}"
  echo "────────────────────────────────────"
  echo ""
}

# Run preflight when sourced (unless DB_PREFLIGHT_SKIP is set)
if [[ -z "$DB_PREFLIGHT_SKIP" ]]; then
  db_preflight
fi
