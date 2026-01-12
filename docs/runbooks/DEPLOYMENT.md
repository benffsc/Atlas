# Deployment Guide

Deploy Atlas to Vercel with custom domain atlas.forgottenfelines.com.

## Prerequisites

- GitHub repository: `benffsc/Atlas`
- Vercel account (can sign up with GitHub)
- Domain access for forgottenfelines.com DNS

## Deploy to Vercel

### 1. Connect Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import `benffsc/Atlas` from GitHub
3. Configure project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### 2. Environment Variables

Add these in Vercel Dashboard > Project Settings > Environment Variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgres://...` (from Supabase) | Production |
| `GOOGLE_MAPS_API_KEY` | `AIza...` | Production |

**Get DATABASE_URL from Supabase:**
1. Supabase Dashboard > Project Settings > Database
2. Copy "Connection string" (URI format)
3. Replace `[YOUR-PASSWORD]` with actual password

### 3. Deploy

Click "Deploy" - Vercel will build and deploy automatically.

## Custom Domain Setup

### 1. Add Domain in Vercel

1. Vercel Dashboard > Project > Settings > Domains
2. Add `atlas.forgottenfelines.com`
3. Vercel will show required DNS records

### 2. Configure DNS

In your DNS provider (GoDaddy, Cloudflare, etc.), add:

**Option A: CNAME (recommended)**
```
Type: CNAME
Name: atlas
Value: cname.vercel-dns.com
```

**Option B: A Record**
```
Type: A
Name: atlas
Value: 76.76.21.21
```

### 3. SSL Certificate

Vercel automatically provisions SSL. Wait 5-10 minutes after DNS propagation.

## Verify Deployment

1. Visit https://atlas.forgottenfelines.com
2. Test search functionality
3. Verify cat/person/place pages load
4. Check API endpoints work (e.g., `/api/search?q=test`)

## Continuous Deployment

Vercel auto-deploys on every push to `main`:
- Push to GitHub triggers build
- Preview deployments for PRs
- Rollback available in Vercel dashboard

## Troubleshooting

### Build Fails
- Check Vercel build logs
- Ensure `DATABASE_URL` is set correctly
- Verify root directory is `apps/web`

### Database Connection Issues
- Supabase may block Vercel IPs - check connection pooling
- Use Supabase "Pooler" connection string if direct fails
- Check Supabase Dashboard > Database > Connection Pooling

### Domain Not Working
- Wait for DNS propagation (up to 48h, usually minutes)
- Check DNS with: `dig atlas.forgottenfelines.com`
- Verify CNAME points to `cname.vercel-dns.com`

## Environment Differences

| Environment | URL | Branch |
|-------------|-----|--------|
| Production | atlas.forgottenfelines.com | main |
| Preview | *.vercel.app | PR branches |
| Local | localhost:3000 | any |

---

*See [START_HERE.md](START_HERE.md) for local development setup.*
