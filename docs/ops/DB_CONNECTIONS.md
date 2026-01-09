# Database Connections

Atlas uses Supabase PostgreSQL. This doc explains connection options and when to use each.

## TL;DR

Use the **Session Pooler** (port 5432 on `pooler.supabase.com`) for everything.

```bash
# .env
DATABASE_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'
```

## Connection Types

### 1. Session Pooler (Recommended)

**Host:** `aws-0-[region].pooler.supabase.com`
**Port:** `5432`

- IPv4-compatible (works from any network)
- One connection per session (full PostgreSQL feature support)
- Supports: prepared statements, LISTEN/NOTIFY, advisory locks
- Connection limit: managed by pooler (~200 concurrent)

**When to use:** Default for all Atlas scripts, ingests, and queries.

### 2. Transaction Pooler

**Host:** `aws-0-[region].pooler.supabase.com`
**Port:** `6543`

- IPv4-compatible
- Connections shared between transactions (higher concurrency)
- Does NOT support: prepared statements, LISTEN/NOTIFY, SET commands
- Connection limit: ~400 concurrent

**When to use:** High-concurrency read workloads where you don't need session-level features.

### 3. Direct Connection

**Host:** `db.[project-ref].supabase.co`
**Port:** `5432`

- Often IPv6-only (fails on many networks)
- Direct connection to the database server
- Full PostgreSQL feature support
- Connection limit: ~60 on free tier

**When to use:** Only for:
- Running migrations that create extensions
- Administrative tasks requiring superuser-like access
- When explicitly needed for a specific feature

## IPv4 vs IPv6

The direct host (`db.[ref].supabase.co`) often resolves to IPv6-only addresses. Many networks (coffee shops, older ISPs, some corporate networks) don't support IPv6.

Symptoms of IPv6 issues:
- Connection timeouts (Exit 137)
- "Connection refused" errors
- Scripts that work at home but fail elsewhere

**Solution:** Always use the pooler host, which has IPv4 A records.

## Environment Variables

```bash
# Primary (required) - use session pooler
DATABASE_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'

# Transaction pooler (optional) - for high-concurrency
DATABASE_TRANSACTION_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require'

# Direct (optional) - only for migrations/admin
DATABASE_DIRECT_URL='postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres?sslmode=require'
```

## Preflight Checks

Atlas scripts include automatic preflight checks that:

1. Verify `DATABASE_URL` is set
2. Reject direct hosts (`db.[ref].supabase.co`) with guidance
3. Verify DNS A records exist (IPv4 reachability)

To run preflight manually:

```bash
set -a && source .env && set +a
source scripts/_lib/db_preflight.sh
```

## Troubleshooting

### "Direct host detected" error

Your `.env` uses the direct connection. Update to use the pooler:

```bash
# Find this line in Supabase Dashboard > Settings > Database > Connection String
# Select "Session Pooler" mode
DATABASE_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'
```

### "No IPv4 (A) records found" error

The host can't be reached over IPv4. This usually means:
- You're using the direct host (see above)
- DNS is temporarily failing (wait and retry)
- The host is misconfigured (check Supabase dashboard)

### Connection timeouts with large ingests

If ingests fail with Exit 137 or connection errors on large files:

1. Use `batch_ingest.mjs` with connection pooling (already default for ClinicHQ)
2. Ensure you're using the session pooler (port 5432)
3. Consider breaking very large files into chunks

## References

- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)
- [Supavisor Architecture](https://supabase.com/docs/guides/database/connecting-to-postgres#supavisor)
