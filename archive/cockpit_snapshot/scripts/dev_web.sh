#!/usr/bin/env bash
# dev_web.sh - Start the Atlas web dev server with preflight checks
#
# DEV_013: Safe env loading + validation + reliable DB diagnostics
#
# Features:
# - SAFE env loading (no truncation on # in passwords)
# - Validates DATABASE_URL format before starting
# - Auto-selects free port (3000-3010) unless PORT is set
# - Uses db_diag.mjs for comprehensive connection testing
# - Clear error messages with fix instructions
#
# Usage:
#   ./scripts/dev_web.sh           # Auto-select port
#   PORT=3000 ./scripts/dev_web.sh # Use specific port
#
# Exit codes:
#   0 - Success (dev server started)
#   1 - Port in use (with instructions)
#   2 - DATABASE_URL missing or malformed (with instructions)
#   3 - DATABASE_URL unreachable (with checklist)

set -e

# ============================================================
# Colors for output
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================
# Helpers
# ============================================================

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_hint() {
  echo -e "${CYAN}[HINT]${NC} $1"
}

# Check if a port is in use
is_port_in_use() {
  local port=$1
  if command -v lsof &> /dev/null; then
    lsof -i ":$port" -sTCP:LISTEN &> /dev/null
    return $?
  else
    (echo >/dev/tcp/localhost/$port) 2>/dev/null
    return $?
  fi
}

# Get process using a port
get_port_user() {
  local port=$1
  if command -v lsof &> /dev/null; then
    lsof -i ":$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1
  else
    echo "(lsof not available)"
  fi
}

# Find first free port in range
find_free_port() {
  local start=$1
  local end=$2
  for port in $(seq $start $end); do
    if ! is_port_in_use $port; then
      echo $port
      return 0
    fi
  done
  return 1
}

# Parse DATABASE_URL to extract host and port using Node.js
# Returns: host:port or empty string on failure
parse_db_url() {
  if [ -z "$DATABASE_URL" ]; then
    echo ""
    return 1
  fi

  node -e "
    try {
      const url = new URL(process.env.DATABASE_URL);
      console.log(url.hostname + ':' + (url.port || '5432'));
    } catch (e) {
      // Try regex fallback
      const match = process.env.DATABASE_URL.match(/@([^:/@]+):?(\d+)?/);
      if (match) {
        console.log(match[1] + ':' + (match[2] || '5432'));
      } else {
        console.log('');
      }
    }
  " 2>/dev/null || echo ""
}

# Validate DATABASE_URL format
# Returns: 0 if valid, 1 if invalid (with error messages)
validate_db_url() {
  if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL is not set!"
    return 1
  fi

  # Use Node.js for reliable URL validation
  local validation_result
  validation_result=$(node -e "
    const url = process.env.DATABASE_URL;

    // Check protocol
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
      console.log('ERROR:Must start with postgres:// or postgresql://');
      process.exit(1);
    }

    // Try to parse as URL
    try {
      const parsed = new URL(url);

      if (!parsed.hostname) {
        console.log('ERROR:No hostname found (URL may be truncated)');
        process.exit(1);
      }

      if (!parsed.username) {
        console.log('ERROR:No username found');
        process.exit(1);
      }

      // Check for common truncation signs
      if (parsed.hostname.includes('#') || parsed.password?.endsWith('#')) {
        console.log('WARN:Password may be truncated (contains #)');
      }

      // All good
      console.log('OK:' + parsed.hostname + ':' + (parsed.port || '5432'));
      process.exit(0);
    } catch (e) {
      console.log('ERROR:Failed to parse URL - ' + e.message);
      process.exit(1);
    }
  " 2>&1) || true

  local status="${validation_result%%:*}"
  local message="${validation_result#*:}"

  case "$status" in
    OK)
      return 0
      ;;
    WARN)
      log_warn "$message"
      return 0
      ;;
    ERROR)
      log_error "DATABASE_URL validation failed: $message"
      echo ""
      echo "Common causes:"
      echo "  1. Password contains # (shell treats it as comment)"
      echo "  2. URL was truncated when copied"
      echo "  3. Special characters not URL-encoded"
      echo ""
      echo "Fix options:"
      echo "  A) Move DATABASE_URL to apps/web/.env.local (Next.js reads this directly)"
      echo "  B) In root .env, wrap the value in single quotes:"
      echo "     DATABASE_URL='postgres://user:pa#ss@host:5432/db'"
      echo ""
      return 1
      ;;
    *)
      log_error "Unexpected validation result: $validation_result"
      return 1
      ;;
  esac
}

# Detect if URL looks like Supabase pooler
is_supabase_pooler() {
  if [ -z "$DATABASE_URL" ]; then
    return 1
  fi
  if echo "$DATABASE_URL" | grep -qi "pooler\.supabase"; then
    return 0
  fi
  if echo "$DATABASE_URL" | grep -qE ":654[34]/"; then
    return 0
  fi
  return 1
}

# Detect if URL looks like Supabase direct
is_supabase_direct() {
  if [ -z "$DATABASE_URL" ]; then
    return 1
  fi
  if is_supabase_pooler; then
    return 1
  fi
  if echo "$DATABASE_URL" | grep -qi "supabase"; then
    return 0
  fi
  return 1
}

# ============================================================
# Main Script
# ============================================================

echo ""
echo "========================================"
echo "  Atlas Web Dev Server (DEV_013)"
echo "========================================"
echo ""

# Step 1: Find repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web"

log_info "Repo root: $REPO_ROOT"

# Step 2: Load environment variables SAFELY
# Priority: apps/web/.env.local > root .env > shell env
echo ""
log_info "Loading environment..."

ENV_SOURCE="(none)"

# Check apps/web/.env.local first (Next.js native, highest priority)
if [ -f "$WEB_DIR/.env.local" ]; then
  log_success "Found apps/web/.env.local"
  # Use safe loader for .env.local too
  if [ -f "$SCRIPT_DIR/print_env_exports.mjs" ]; then
    eval "$(node "$SCRIPT_DIR/print_env_exports.mjs" "$WEB_DIR/.env.local")"
  fi
  ENV_SOURCE="apps/web/.env.local"
fi

# Check root .env (use SAFE loader to avoid # truncation)
if [ -f "$REPO_ROOT/.env" ]; then
  log_info "Found root .env"

  if [ -f "$SCRIPT_DIR/print_env_exports.mjs" ]; then
    # SAFE: Use Node.js to parse .env without shell interpretation
    log_info "Using safe env loader (preserves # in passwords)"
    eval "$(node "$SCRIPT_DIR/print_env_exports.mjs" "$REPO_ROOT/.env")"
    if [ "$ENV_SOURCE" = "(none)" ]; then
      ENV_SOURCE="root .env (safe loader)"
    else
      ENV_SOURCE="$ENV_SOURCE + root .env"
    fi
  else
    # Fallback: warn about potential issues
    log_warn "Safe loader not found - using source (# in passwords will break!)"
    set -a
    source "$REPO_ROOT/.env"
    set +a
    if [ "$ENV_SOURCE" = "(none)" ]; then
      ENV_SOURCE="root .env (source)"
    fi
  fi
else
  log_warn "No root .env found"
fi

log_info "Env source: $ENV_SOURCE"

# Step 3: Validate DATABASE_URL
echo ""
log_info "Validating DATABASE_URL..."

if ! validate_db_url; then
  exit 2
fi

log_success "DATABASE_URL format is valid"

# Parse host:port for display
DB_HOST_PORT=$(parse_db_url)
if [ -n "$DB_HOST_PORT" ]; then
  DB_HOST=$(echo "$DB_HOST_PORT" | cut -d: -f1)
  DB_PORT=$(echo "$DB_HOST_PORT" | cut -d: -f2)
  log_info "Host: $DB_HOST"
  log_info "Port: $DB_PORT"

  # Detect connection type
  if is_supabase_pooler; then
    log_info "Type: Supabase Pooler (transaction mode)"
  elif is_supabase_direct; then
    log_info "Type: Supabase Direct"
  else
    log_info "Type: Standard Postgres"
  fi
else
  log_error "Failed to parse host:port from DATABASE_URL"
  log_hint "This usually means the URL is malformed or truncated"
  exit 2
fi

# Step 4: Test database connectivity
echo ""
log_info "Testing database connectivity..."

DB_REACHABLE=false
DB_ERROR=""

# Method 1: Use psql if available (most reliable)
if command -v psql &> /dev/null; then
  log_info "Testing with psql..."
  if PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -c "SELECT 1" &> /dev/null; then
    DB_REACHABLE=true
    log_success "Database is reachable (via psql)"
  else
    DB_ERROR=$(PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -c "SELECT 1" 2>&1 | head -3)
    log_warn "psql connection failed"
  fi
fi

# Method 2: Use db_diag.mjs if psql failed or unavailable
if [ "$DB_REACHABLE" = false ] && [ -f "$SCRIPT_DIR/db_diag.mjs" ]; then
  log_info "Running detailed diagnostics..."
  echo ""
  if node "$SCRIPT_DIR/db_diag.mjs" 2>&1; then
    DB_REACHABLE=true
  fi
  echo ""
fi

# Method 3: Fallback to TCP check
if [ "$DB_REACHABLE" = false ] && [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
  log_info "Checking TCP connectivity..."
  if nc -z -w5 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    log_warn "TCP port is open but DB query failed"
    log_hint "This suggests an auth/SSL issue, not a network issue"
  else
    log_warn "TCP port $DB_PORT is not reachable on $DB_HOST"
    if is_supabase_direct; then
      log_hint "Direct connections (5432) may be blocked. Try Supabase Pooler (6543)"
    fi
  fi
fi

# Print troubleshooting if connection failed
if [ "$DB_REACHABLE" = false ]; then
  echo ""
  log_warn "Could not verify database connectivity"
  echo ""
  echo "The dev server will start, but pages may show DB errors."
  echo ""
  echo "Troubleshooting:"

  if [ -n "$DB_ERROR" ]; then
    echo ""
    echo "  Last error:"
    echo "    $DB_ERROR" | head -2 | sed 's/^/    /'
  fi

  echo ""
  if is_supabase_pooler; then
    echo "  For Supabase Pooler (port 6543):"
    echo "    - Username must be: postgres.[project-ref]"
    echo "    - Password must be URL-encoded if it has special chars"
    echo "    - SSL is required (should be auto-enabled)"
  elif is_supabase_direct; then
    echo "  For Supabase Direct (port 5432):"
    echo "    - May be blocked by network/firewall"
    echo "    - Try switching to Pooler URL from Supabase Dashboard"
  fi

  echo ""
  echo "  General:"
  echo "    - Check Supabase Dashboard > Settings > Database for correct URL"
  echo "    - Verify project is not paused"
  echo "    - Check Network Restrictions if enabled"
  echo "    - Run: node scripts/db_diag.mjs (for detailed diagnostics)"
  echo ""
fi

# Step 5: Determine port
echo ""
log_info "Checking port availability..."

if [ -n "$PORT" ]; then
  if is_port_in_use "$PORT"; then
    log_error "Port $PORT is already in use!"
    echo ""
    PROCESS_INFO=$(get_port_user "$PORT")
    if [ -n "$PROCESS_INFO" ]; then
      echo "Process using port $PORT:"
      echo "  $PROCESS_INFO"
    fi
    echo ""
    echo "Options:"
    echo "  1. Kill the process: lsof -i :$PORT && kill -9 <PID>"
    echo "  2. Use different port: PORT=3001 ./scripts/dev_web.sh"
    echo "  3. Auto-select: ./scripts/dev_web.sh (no PORT)"
    echo ""
    exit 1
  fi
  SELECTED_PORT=$PORT
  log_success "Port $SELECTED_PORT is available"
else
  SELECTED_PORT=$(find_free_port 3000 3010)
  if [ -z "$SELECTED_PORT" ]; then
    log_error "No free ports in range 3000-3010!"
    exit 1
  fi
  if [ "$SELECTED_PORT" != "3000" ]; then
    log_warn "Port 3000 was busy, using $SELECTED_PORT"
  else
    log_success "Port $SELECTED_PORT is available"
  fi
fi

# Step 6: Set test mode defaults
if [ -z "$NEXT_PUBLIC_TEST_MODE" ]; then
  export NEXT_PUBLIC_TEST_MODE=1
  log_info "NEXT_PUBLIC_TEST_MODE=1 (default for local dev)"
fi

# Step 7: Print summary and start
echo ""
echo "========================================"
echo "  Starting Atlas Web Dev Server"
echo "========================================"
echo ""
echo "  URL:           http://localhost:$SELECTED_PORT"
echo "  Health:        http://localhost:$SELECTED_PORT/ops/health"
echo "  DB Debug:      http://localhost:$SELECTED_PORT/api/_debug/db-env"
echo ""
echo "  Configuration:"
echo "    Env source:  $ENV_SOURCE"
echo "    DB Host:     ${DB_HOST:-unknown}:${DB_PORT:-unknown}"
echo "    DB Reachable: $([ "$DB_REACHABLE" = true ] && echo 'yes' || echo 'no')"
echo "    Test Mode:   $NEXT_PUBLIC_TEST_MODE"
echo ""
echo "  Press Ctrl+C to stop"
echo ""
echo "========================================"
echo ""

# Start the dev server
cd "$WEB_DIR"
npm run dev -- --port "$SELECTED_PORT"
