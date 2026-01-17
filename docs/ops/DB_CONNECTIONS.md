# Database Connections

Atlas uses Supabase PostgreSQL. This doc explains connection options and when to use each.

## TL;DR

- **Vercel/Serverless:** Use **Transaction Pooler** (port 6543)
- **Local scripts/ingests:** Use **Session Pooler** (port 5432)

```bash
# .env - Transaction Pooler for Vercel (RECOMMENDED)
DATABASE_URL='postgres://postgres:[pass]@db.[ref].supabase.co:6543/postgres'

# Session Pooler for local scripts that need prepared statements
DATABASE_SESSION_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:5432/postgres'
```

## Why Transaction Pooler for Vercel?

Vercel serverless functions each create their own connection pool. With Session Pooler:
- Each function instance holds connections until it dies
- Multiple concurrent users = connection pool exhaustion
- Error: `MaxClientsInSessionMode: max clients reached`

**Transaction Pooler fixes this** by returning connections to the pool after each query, not after each session.

## Connection Types

### 1. Transaction Pooler (Recommended for Vercel)

**Host:** `db.[project-ref].supabase.co`
**Port:** `6543`

- Connections returned to pool after each query
- Perfect for serverless (Vercel, Lambda, etc.)
- Higher concurrency (~400 concurrent)
- IPv4 add-on recommended for reliability

**Limitations:**
- No prepared statements across queries
- No LISTEN/NOTIFY
- No SET commands that persist
- Multi-statement transactions must use same connection

**When to use:** Vercel app, serverless functions, high-concurrency web requests.

### 2. Session Pooler

**Host:** `aws-0-[region].pooler.supabase.com`
**Port:** `5432`

- Connection held for entire session
- Full PostgreSQL feature support
- Supports: prepared statements, LISTEN/NOTIFY, advisory locks
- Connection limit: ~200 concurrent

**When to use:** Local scripts, data ingests, batch jobs, anything not serverless.

### 3. Direct Connection

**Host:** `db.[project-ref].supabase.co`
**Port:** `5432`

- Direct connection to database server
- Often IPv6-only (may fail on some networks)
- Full PostgreSQL feature support
- Connection limit: ~60 on free tier

**When to use:** Only for migrations that create extensions or require superuser access.

## Environment Variables

```bash
# Primary - Transaction Pooler for Vercel
DATABASE_URL='postgres://postgres:[pass]@db.[ref].supabase.co:6543/postgres'

# Session Pooler - for local scripts/ingests
DATABASE_SESSION_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-2.pooler.supabase.com:5432/postgres'

# Direct - only for migrations/admin
DATABASE_DIRECT_URL='postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres'
```

## Vercel Configuration

1. Go to Vercel Project → Settings → Environment Variables
2. Set `DATABASE_URL` to the Transaction Pooler URL (port 6543)
3. Redeploy for changes to take effect

## Code Compatibility

The `pg` library works identically with both poolers. No code changes needed when switching.

Things that work in both modes:
- Simple queries (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)
- Single-query transactions
- All standard SQL

Things that only work in Session mode:
- `SET search_path = ...` (resets each query in Transaction mode)
- Prepared statements across multiple queries
- `LISTEN/NOTIFY`
- Multi-query transactions using separate `query()` calls

## Troubleshooting

### "MaxClientsInSessionMode: max clients reached"

You're using Session Pooler (port 5432) with Vercel. Switch to Transaction Pooler (port 6543).

### Connection timeouts / "Connection refused"

1. Check if using direct host with IPv6 issues → use pooler host
2. Verify DATABASE_URL is set correctly
3. Check Supabase dashboard for service status

### "Direct host detected" error

Your `.env` uses the direct connection. Update to use the pooler:

```bash
# Change from direct (port 5432 on db.xxx.supabase.co)
# To transaction pooler (port 6543)
DATABASE_URL='postgres://postgres:[pass]@db.[ref].supabase.co:6543/postgres'
```

### Connection timeouts with large ingests

For batch jobs, use Session Pooler which handles long-running connections better:

```bash
DATABASE_URL=$DATABASE_SESSION_URL node scripts/ingest/my_script.mjs
```

## Quick Reference

| Use Case | Pooler | Port | Host |
|----------|--------|------|------|
| Vercel app | Transaction | 6543 | `db.[ref].supabase.co` |
| Local dev (Next.js) | Transaction | 6543 | `db.[ref].supabase.co` |
| Ingest scripts | Session | 5432 | `pooler.supabase.com` |
| Migrations | Direct | 5432 | `db.[ref].supabase.co` |

## References

- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)
- [Supavisor Architecture](https://supabase.com/docs/guides/database/connecting-to-postgres#supavisor)
- [IPv4 Add-on](https://supabase.com/docs/guides/platform/ipv4-address)
