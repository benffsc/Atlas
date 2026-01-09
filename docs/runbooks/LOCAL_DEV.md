# Local Development Guide (UI_246 + DEV_012 + DEV_013)

Quick-start guide for running the Atlas web UI locally.

---

## ⚠️ IMPORTANT: Password with Special Characters

**If your DATABASE_URL password contains `#`, `:`, `@`, or other special characters:**

The `#` character is especially problematic because bash treats it as a comment start.

```bash
# BAD - password gets truncated at #
DATABASE_URL=postgres://user:abc#123@host:5432/db

# GOOD - wrap in single quotes
DATABASE_URL='postgres://user:abc#123@host:5432/db'
```

**Recommended approach:** Put DATABASE_URL in `apps/web/.env.local` instead of root `.env`.
Next.js reads this file directly without shell interpretation.

---

## Quickstart

```bash
# Option 1: Auto-select port (recommended)
make web-dev

# Option 2: Use port 3000 specifically (fails if busy)
make web-dev-3000

# Legacy (no preflight checks)
make web
```

---

## What `make web-dev` Does

The `scripts/dev_web.sh` script runs preflight checks before starting the dev server:

1. **Safe env loading** — Uses `print_env_exports.mjs` to read `.env` without shell truncation
2. **Validates DATABASE_URL** — Checks format, fails fast if malformed/truncated
3. **Tests DB connectivity** — Uses psql or db_diag.mjs to verify connection
4. **Auto-selects port** — Finds first free port in 3000-3010 range
5. **Sets test mode** — Defaults `NEXT_PUBLIC_TEST_MODE=1` for local dev
6. **Starts Next.js** — Runs `npm run dev` with the selected port

---

## Environment Variables

### Required

| Variable | Description | Where to set |
|----------|-------------|--------------|
| `DATABASE_URL` | Postgres connection string | `apps/web/.env.local` or root `.env` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | auto (3000-3010) | Force a specific port |
| `NEXT_PUBLIC_TEST_MODE` | `1` (local) | Show TEST MODE banner when `1` |
| `ALLOW_WRITES` | `<not set>` | Enable write operations (future) |

---

## Where to Set DATABASE_URL

Three options, in order of precedence:

### Option A: `apps/web/.env.local` (recommended for web-only work)

```bash
echo 'DATABASE_URL=postgres://...' >> apps/web/.env.local
```

Next.js automatically loads `.env.local` files.

### Option B: Root `.env` (for all scripts)

```bash
echo 'DATABASE_URL=postgres://...' >> .env
```

The `dev_web.sh` script sources this before starting.

### Option C: Shell export (temporary)

```bash
export DATABASE_URL='postgres://...'
make web-dev
```

---

## Test Mode

**By default, local dev runs with `NEXT_PUBLIC_TEST_MODE=1`.**

This shows a yellow "TEST MODE" banner at the top of every page, making it clear you're not looking at production data.

To disable the banner locally:

```bash
NEXT_PUBLIC_TEST_MODE=0 make web-dev
```

Production builds should have this unset or set to `0`.

---

## Troubleshooting

### Quick Diagnostic

Run the standalone diagnostic script for detailed connection info:

```bash
source .env && node scripts/db_diag.mjs
```

Or check the debug endpoint (when dev server is running):

```
http://localhost:3000/api/_debug/db-env
```

### Port 3000 is busy

```
[ERROR] Port 3000 is already in use!
```

**Fix options:**

1. Kill the process using the port:
   ```bash
   lsof -i :3000
   kill -9 <PID>
   ```

2. Use a different port:
   ```bash
   PORT=3001 make web-dev
   ```

3. Let the script auto-select (default):
   ```bash
   make web-dev  # Will try 3001, 3002, etc.
   ```

### DATABASE_URL not set

```
[ERROR] DATABASE_URL is not set!
```

**Fix:** Set it in one of the locations described above.

---

## DB Connection Troubleshooting (DEV_012)

### Supabase Connection Strings

Supabase provides two connection options:

| Type | Port | URL Pattern | When to use |
|------|------|-------------|-------------|
| **Pooler** | 6543 | `postgres://postgres.[ref]:[pass]@...pooler.supabase.com:6543/postgres` | Recommended for most use |
| **Direct** | 5432 | `postgres://postgres:[pass]@db.[ref].supabase.co:5432/postgres` | When pooler fails |

**Find your connection strings:** Supabase Dashboard → Settings → Database → Connection String

### Common Errors and Fixes

#### "Connection timed out" / "ETIMEDOUT"

**Symptoms:**
- Connection hangs then fails after 10+ seconds
- Error mentions timeout

**Likely causes:**
1. Network/firewall blocking the connection
2. Using direct connection (5432) when pooler is needed

**Fixes:**
- Try switching from Direct (5432) to Pooler (6543)
- Disable VPN if using one
- Check if your IP is allowed in Supabase Network Restrictions

#### "Authentication failed" / "password authentication failed"

**Symptoms:**
- Error code 28P01 or 28000
- Error mentions "auth" or "password"

**Likely causes:**
1. Wrong password
2. Wrong username format for pooler
3. Special characters not URL-encoded

**Fixes:**
- For Pooler, username must be: `postgres.[project-ref]` (not just `postgres`)
- URL-encode special characters in password:
  - `@` → `%40`
  - `:` → `%3A`
  - `/` → `%2F`
  - `#` → `%23`
  - `?` → `%3F`

#### "Handshake failed" / "SSL error"

**Symptoms:**
- Error mentions "handshake" or "SSL"
- Happens immediately on connect

**Likely causes:**
1. SSL configuration mismatch
2. Pooler connection string format issue

**Fixes:**
- Supabase requires SSL for pooler connections
- Add `?sslmode=require` to connection string if needed
- Ensure the full connection string was copied correctly

#### "DNS lookup failed" / "ENOTFOUND"

**Symptoms:**
- Error code ENOTFOUND or EAI_AGAIN
- Error mentions hostname

**Likely causes:**
1. Typo in hostname
2. Network DNS issues

**Fixes:**
- Verify the hostname is correct
- Try using a different DNS server (8.8.8.8)
- Check your internet connection

#### "Circuit breaker open"

**Symptoms:**
- Error says "Database connection temporarily unavailable"
- Mentions "Will retry in Xs"

**What it means:**
After 3 consecutive connection failures, the app stops trying for 10 seconds to prevent hammering a broken connection.

**Fixes:**
- Wait 10 seconds and refresh
- Fix the underlying connection issue (see errors above)
- The circuit breaker will reset automatically on successful connection

### DB Suddenly Stopped Working (DEV_014)

**Symptoms:**
- Yesterday it worked, today it times out
- TCP port is reachable (`nc -z host port` works) but psql hangs
- "Connection terminated due to connection timeout" error

**Most likely cause: Supabase Network Restrictions**

Supabase may have IP allowlisting enabled, and your IP changed (VPN, network switch, ISP).

**Fix:**
1. Go to **Supabase Dashboard → Settings → Database**
2. Scroll to **"Network Restrictions"**
3. Either:
   - **Disable restrictions** (easiest for local dev)
   - **Add your IP** to the allowlist

**Get your current IP:**
```bash
curl -s ifconfig.me
```

**Other causes to check:**
- VPN active (try disabling)
- Supabase project is paused (check Dashboard)
- Network changed (coffee shop, different office, etc.)

---

### Demo Mode (DB_SOFT_FAIL)

If DB is unreachable but you need to demo the UI:

```bash
# Add to apps/web/.env.local
DB_SOFT_FAIL=1
```

This makes pages render with a friendly "Database Connection Error" card instead of crashing.
Remove when DB is fixed.

---

### Verifying Your Connection

1. **Using psql (if installed):**
   ```bash
   source .env && psql "$DATABASE_URL" -c "SELECT 1"
   ```

2. **Using db_diag.mjs:**
   ```bash
   cd apps/web && node ../../scripts/db_diag.mjs
   ```

3. **Using the debug endpoint:**
   ```bash
   curl http://localhost:3000/api/_debug/db-env
   ```

### Connection Type Detection

The app automatically detects your connection type and adjusts settings:

| Detection | Behavior |
|-----------|----------|
| **Supabase Pooler** | Uses max 2 connections, SSL enabled |
| **Supabase Direct** | Uses max 5 connections, SSL enabled |
| **Localhost** | No SSL, max 5 connections |
| **Other remote** | SSL enabled, max 5 connections |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (dev server started) |
| 1 | Port in use (with instructions) |
| 2 | DATABASE_URL missing (with instructions) |
| 3 | DATABASE_URL unreachable (with checklist) |

---

*Last updated: 2026-01-08 | UI_246 + DEV_012 + DEV_014*
