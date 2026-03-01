# Atlas Developer Quick Start

Get up and running with Atlas development in under 30 minutes.

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **PostgreSQL 14+** (or Supabase account)
- **Git**
- **A code editor** (VS Code recommended)

## Quick Setup (10 minutes)

### 1. Clone and Install

```bash
git clone <repo-url>
cd Atlas
npm install
cd apps/web && npm install
```

### 2. Configure Environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` with your credentials:

**Required:**
- `DATABASE_URL` - PostgreSQL connection string (from Supabase or local)
- `STAFF_DEFAULT_PASSWORD` - Temporary password for new staff accounts

**For full functionality:**
- `GOOGLE_PLACES_API_KEY` - For address autocomplete
- `ANTHROPIC_API_KEY` - For Tippy AI assistant

### 3. Database Setup

**Option A: Supabase (Recommended)**
1. Create a project at [supabase.com](https://supabase.com)
2. Get connection string from Project Settings > Database
3. Run migrations in Supabase SQL Editor

**Option B: Local PostgreSQL**
```bash
createdb atlas
export DATABASE_URL="postgres://localhost:5432/atlas"
```

### 4. Run Migrations

Apply V2 schema migrations in order:

```bash
cd sql/schema/v2

# Core schema (required)
psql $DATABASE_URL -f MIG_2000__v2_truncate_for_fresh_start.sql
psql $DATABASE_URL -f MIG_2001__v2_raw_storage_tables.sql
psql $DATABASE_URL -f MIG_2002__v2_ops_enhancements.sql

# Continue with remaining MIG_2XXX files in order...
```

For Supabase: Copy each migration into the SQL Editor and run.

### 5. Start Development Server

```bash
cd apps/web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
Atlas/
├── apps/
│   └── web/                    # Next.js application
│       ├── src/
│       │   ├── app/            # Pages & API routes (App Router)
│       │   ├── components/     # React components
│       │   ├── lib/            # Utilities & helpers
│       │   └── types/          # TypeScript types
│       └── public/             # Static assets
├── sql/
│   └── schema/
│       └── v2/                 # Database migrations (MIG_XXXX)
├── scripts/
│   ├── ingest/                 # Data sync scripts
│   └── pipeline/               # Data processing pipeline
└── docs/                       # Documentation
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `apps/web/src/app/` | Next.js App Router pages and API routes |
| `apps/web/src/app/api/` | API endpoints (`route.ts` files) |
| `apps/web/src/components/` | Reusable React components |
| `apps/web/src/lib/` | Utilities, DB client, formatters |
| `sql/schema/v2/` | Database migrations |
| `docs/` | Project documentation |

## Common Development Tasks

### Add an API Endpoint

Create `apps/web/src/app/api/[your-path]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const data = await queryRows("SELECT * FROM your_table LIMIT 10");
    return apiSuccess({ items: data });
  } catch (error) {
    console.error("Error:", error);
    return apiServerError("Failed to fetch data");
  }
}
```

### Add a Database Migration

1. Find the next available MIG number:
   ```bash
   ls sql/schema/v2/MIG_*.sql | sort | tail -5
   ```

2. Create `sql/schema/v2/MIG_XXXX__your_description.sql`:
   ```sql
   -- MIG_XXXX: Your Description
   -- Date: YYYY-MM-DD
   -- Purpose: What this migration does

   \echo 'MIG_XXXX: Your Description'

   -- Your SQL here
   ALTER TABLE ...
   CREATE INDEX ...

   \echo 'MIG_XXXX complete'
   ```

3. Apply to database:
   ```bash
   psql $DATABASE_URL -f sql/schema/v2/MIG_XXXX__your_description.sql
   ```

### Use Design Tokens for Styling

```typescript
import { COLORS, SPACING, TYPOGRAPHY } from "@/lib/design-tokens";

<div style={{
  color: COLORS.textPrimary,
  padding: SPACING.lg,
  fontSize: TYPOGRAPHY.size.base
}}>
  Content here
</div>
```

### Query the Database

```typescript
import { queryOne, queryRows, query } from "@/lib/db";

// Single row
const cat = await queryOne<Cat>("SELECT * FROM sot.cats WHERE cat_id = $1", [id]);

// Multiple rows
const cats = await queryRows<Cat>("SELECT * FROM sot.cats LIMIT 10");

// No return value (INSERT, UPDATE)
await query("UPDATE sot.cats SET name = $1 WHERE cat_id = $2", [name, id]);
```

## Key Files to Read First

| File | What You'll Learn |
|------|-------------------|
| `/CLAUDE.md` | Development rules, invariants, system constraints |
| `/docs/DATA_FLOW_ARCHITECTURE.md` | How data flows through the system |
| `/docs/CENTRALIZED_FUNCTIONS.md` | SQL functions for entity creation |
| `/apps/web/src/lib/api-response.ts` | Standard API response format |
| `/apps/web/src/lib/design-tokens.ts` | Design system tokens |

## Database Schemas

Atlas uses a 3-layer schema architecture:

| Schema | Purpose | Example Tables |
|--------|---------|----------------|
| `source` | Raw immutable data from external systems | `clinichq_raw`, `shelterluv_raw` |
| `ops` | Processed operational data | `appointments`, `staff`, `requests` |
| `sot` | Source of Truth - canonical entities | `cats`, `people`, `places` |

**Important:** Always use `sot.*` tables for entity queries. Use centralized functions for entity creation (never raw INSERT).

## Testing

```bash
# Run type checking
npm run typecheck

# Run linter
npm run lint

# Run tests (if configured)
npm test
```

## Debugging

### Check API Response

```bash
curl http://localhost:3000/api/cats/[cat-id] | jq
```

### View Database State

```bash
# Connect to database
psql $DATABASE_URL

# Example queries
SELECT COUNT(*) FROM sot.cats;
SELECT * FROM ops.requests LIMIT 5;
```

### Enable Verbose Logging

Add to `.env.local`:
```
DEBUG=atlas:*
```

## Need Help?

1. Check `/CLAUDE.md` for development rules
2. Search `/docs/` for relevant documentation
3. Check existing code patterns in similar files
4. Review recent migrations in `sql/schema/v2/`

## Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `cd apps/web && npm run dev` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Apply migration | `psql $DATABASE_URL -f [migration.sql]` |
| List migrations | `ls sql/schema/v2/MIG_*.sql \| sort` |
