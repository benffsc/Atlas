# Atlas Security Review Checklist

**For Beacon Engineers - Pre-Launch Security Assessment**

This document outlines security considerations for the Atlas application ahead of the Thursday launch.

---

## Executive Summary

Atlas is an internal TNR (Trap-Neuter-Return) management system for FFSC. It handles:
- **Person data**: Names, emails, phones, addresses
- **Cat data**: Names, microchips, medical records
- **Request data**: Service requests with location information
- **Media**: Photos uploaded by staff

**Risk Level**: Medium - Contains PII but is internal-facing only.

---

## 1. Authentication & Authorization

### Current State
| Area | Status | Notes |
|------|--------|-------|
| User Authentication | ❌ Not Implemented | Intended for internal use |
| Role-Based Access | ❌ Not Implemented | All users have full access |
| API Authentication | ❌ Not Implemented | No auth tokens |

### Recommendations for Launch
- [ ] Add basic authentication (username/password or SSO)
- [ ] Or restrict access via network/VPN
- [ ] Consider Clerk or NextAuth for quick auth implementation

### Mitigating Factor
Atlas is designed for internal FFSC staff use only. It should be deployed behind:
- VPN access, OR
- IP allowlist, OR
- Basic auth (Vercel password protection)

---

## 2. API Security

### SQL Injection Prevention ✅

All database queries use parameterized statements:

```typescript
// Good - parameterized query
const result = await client.query(
  'SELECT * FROM sot.people WHERE person_id = $1',
  [personId]
);

// We do NOT do this (string concatenation):
// const result = await client.query(`SELECT * FROM ... WHERE id = '${id}'`);
```

### Input Validation

| Endpoint | Validation | Status |
|----------|------------|--------|
| `/api/intake/public` | Required fields, honeypot, timing | ✅ |
| `/api/people/[id]` | UUID format | ✅ |
| `/api/places` | Address format | ⚠️ Basic |
| `/api/requests` | Status enum | ✅ |

### CORS Configuration

Public intake API has CORS restrictions:
```typescript
// apps/web/src/app/api/intake/public/route.ts
const ALLOWED_ORIGINS = [
  'https://www.ffsc.org',
  'https://ffsc.org',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
].filter(Boolean);
```

### Rate Limiting

- Public intake has basic spam protection (honeypot + timing)
- No explicit rate limiting on internal APIs
- **Recommendation**: Add rate limiting if exposed to internet

---

## 3. Data Security

### Sensitive Data Inventory

| Data Type | Classification | Storage | Encrypted |
|-----------|---------------|---------|-----------|
| Email addresses | PII | Plaintext | No |
| Phone numbers | PII | Normalized | No |
| Street addresses | PII | Geocoded | No |
| Names | PII | Plaintext | No |
| Microchip numbers | Non-sensitive | Plaintext | No |
| Cat medical records | Non-sensitive | Plaintext | No |

### Database Security

- Connection uses SSL (via `DATABASE_URL`)
- Connection pooling via `pg` library
- No stored procedures with SECURITY DEFINER

### File Uploads

Media files stored in Supabase Storage:
- Public bucket for request photos
- No file type validation beyond extension
- **Recommendation**: Add MIME type validation

---

## 4. Environment Variables

### Required Secrets

| Variable | Purpose | Rotation |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection | Per deployment |
| `AIRTABLE_PAT` | Airtable API access | ~1 year |
| `GOOGLE_MAPS_API_KEY` | Frontend maps | Per project |
| `GOOGLE_PLACES_API_KEY` | Geocoding | Per project |

### Secret Management

- [ ] Secrets stored in Vercel environment variables
- [ ] Not committed to git (verified `.gitignore`)
- [ ] No secrets exposed to client-side code

---

## 5. Third-Party Integrations

### APIs Used

| Service | Purpose | Data Sent | Auth Method |
|---------|---------|-----------|-------------|
| Google Maps | Map display | None (client) | API Key |
| Google Places | Geocoding | Addresses | API Key |
| Airtable | Data sync | Read only | PAT |
| Supabase | File storage | Photos | Project key |

### API Key Restrictions

- [ ] Google API keys should be restricted by HTTP referrer
- [ ] Airtable PAT has read-only scope (verify)

---

## 6. Audit & Logging

### Audit Trail ✅

All data changes are logged:

```sql
-- Entity edits logged to:
ops.entity_edits (
  edit_id, entity_type, entity_id,
  edit_type, field_name, old_value, new_value,
  reason, edited_by, edited_by_name,
  edit_source, created_at
);

-- Raw records preserved in:
ops.staged_records (immutable)
```

### Application Logging

- Server-side errors logged to console
- No centralized logging service (consider Vercel Logs)
- No client-side error tracking (consider Sentry)

---

## 7. Deployment Security

### Vercel Configuration

Recommended settings:
- [ ] Enable Vercel Authentication (password protection) for initial launch
- [ ] Configure allowed domains
- [ ] Enable HTTPS only (automatic)
- [ ] Set environment variables via Vercel dashboard

### Database Access

- [ ] Database only accessible from Vercel IP ranges
- [ ] Connection string uses SSL
- [ ] No public database access

---

## 8. Code Review Checklist

### High-Priority Files to Review

| File | Concern | Priority |
|------|---------|----------|
| `apps/web/src/app/api/intake/public/route.ts` | Public endpoint | High |
| `apps/web/src/app/api/entities/[type]/[id]/edit/route.ts` | Data modification | High |
| `apps/web/src/app/api/requests/route.ts` | Data creation | Medium |
| `apps/web/src/app/api/people/[id]/identifiers/route.ts` | PII handling | Medium |

### Things to Check

- [ ] No hardcoded secrets in code
- [ ] No console.log with sensitive data in production
- [ ] Error messages don't leak internal details
- [ ] File uploads validated
- [ ] User input sanitized

---

## 9. Recommendations Summary

### Must-Have for Launch

1. **Basic Authentication** - Add Vercel password protection or similar
2. **API Key Restrictions** - Restrict Google API keys by referrer
3. **Database Access** - Verify database is not publicly accessible

### Nice-to-Have

1. Rate limiting on public endpoints
2. Centralized error logging (Sentry)
3. MIME type validation for uploads
4. CSP headers

### Post-Launch

1. Full user authentication system
2. Role-based access control
3. Security audit logging
4. Penetration testing

---

## 10. Quick Security Fixes

### Add Basic Auth (Vercel)

In Vercel dashboard:
1. Go to Project Settings → Deployment Protection
2. Enable "Password Protection"
3. Set a strong password

### Restrict Google API Keys

In Google Cloud Console:
1. Go to APIs & Services → Credentials
2. Edit each API key
3. Add HTTP referrer restrictions:
   - `https://your-domain.vercel.app/*`
   - `https://www.ffsc.org/*`

### Add CSP Headers

In `next.config.ts`:
```typescript
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  }
];
```

---

## Contact

For security questions:
- **Ben Mis** - ben@ffsc.org
- **Beacon Team** - [contact info]
