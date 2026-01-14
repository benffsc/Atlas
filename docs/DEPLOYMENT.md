# Atlas Deployment Guide

## Vercel Deployment

Atlas is designed to deploy to Vercel with a PostgreSQL database (Supabase or any PostgreSQL provider).

### Prerequisites

1. **Vercel Account** - Sign up at vercel.com
2. **PostgreSQL Database** - Supabase, Neon, Railway, or any PostgreSQL provider
3. **Google Places API Key** - For geocoding and maps

### Environment Variables

Set these in Vercel Project Settings > Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GOOGLE_PLACES_API_KEY` | Yes | Google API key with Places/Geocoding enabled |
| `NEXT_PUBLIC_APP_URL` | No | Production URL (for email links, etc.) |

**Example DATABASE_URL:**
```
postgresql://user:password@host:5432/database?sslmode=require
```

### Deployment Steps

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push origin main
   ```

2. **Connect to Vercel**
   - Go to vercel.com/new
   - Import your GitHub repository
   - Select the `apps/web` directory as the root directory

3. **Configure Build Settings**
   - Framework Preset: Next.js
   - Root Directory: `apps/web`
   - Build Command: `npm run build`
   - Output Directory: `.next`

4. **Add Environment Variables**
   - Add all required environment variables in Vercel dashboard
   - Make sure to add variables for all environments (Production, Preview, Development)

5. **Deploy**
   - Click Deploy
   - Vercel will automatically build and deploy

### Database Setup

Before first deployment, run migrations on your database:

```bash
# From project root
set -a && source .env && set +a

# Core intake migrations
psql "$DATABASE_URL" -f sql/schema/sot/MIG_196__web_intake_questionnaire.sql
psql "$DATABASE_URL" -f sql/schema/sot/MIG_198__legacy_intake_fields.sql
psql "$DATABASE_URL" -f sql/schema/sot/MIG_199__intake_source_and_geocoding.sql
psql "$DATABASE_URL" -f sql/schema/sot/MIG_200__third_party_reports.sql
```

**Migration Notes:**
- **MIG_196**: Creates intake form table and auto-triage system
- **MIG_198**: Adds legacy data fields for Airtable compatibility
- **MIG_199**: Adds source tracking and geocoding fields
- **MIG_200**: Adds third-party report fields for volunteer submissions

### Post-Deployment

After deployment, run these scripts to initialize data:

```bash
# Geocode addresses
node scripts/ingest/geocode_intake_addresses.mjs

# Link to existing People
node scripts/ingest/smart_match_intake.mjs --apply

# Normalize names
node scripts/ingest/normalize_intake_names.mjs
```

### Domain Configuration

1. Go to Vercel Project Settings > Domains
2. Add your custom domain
3. Configure DNS as instructed

### Monitoring

- **Logs**: Vercel Dashboard > Deployments > [deployment] > Functions
- **Analytics**: Enable Vercel Analytics in project settings
- **Errors**: Check function logs for server-side errors

## Local Development

```bash
# Install dependencies
cd apps/web
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# Run development server
npm run dev
```

## Troubleshooting

### Build Failures

1. Check that all environment variables are set
2. Verify DATABASE_URL is correct and database is accessible
3. Check Vercel build logs for specific errors

### Database Connection Issues

1. Verify SSL mode in connection string (`?sslmode=require`)
2. Check that database allows connections from Vercel IPs
3. For Supabase: Use the "Connection String" from Settings > Database

### API Errors

1. Check function logs in Vercel dashboard
2. Verify Google API key has correct permissions
3. Check database query errors in logs

## Architecture

```
atlas/
├── apps/
│   └── web/              # Next.js application (deployed to Vercel)
│       ├── src/
│       │   ├── app/      # App router pages and API routes
│       │   └── lib/      # Shared utilities
│       └── public/       # Static assets
├── scripts/
│   └── ingest/           # Data processing scripts (run locally)
├── sql/
│   └── schema/sot/       # Database migrations
└── docs/                 # Documentation
```

## Security Notes

- Never commit `.env` or `.env.local` files
- Use environment variables for all secrets
- Database should require SSL
- API routes are server-side only (no client-side database access)
