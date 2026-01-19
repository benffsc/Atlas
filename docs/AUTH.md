# Atlas Authentication System

## Overview

Atlas uses session-based authentication with bcrypt password hashing and database-backed sessions. All routes except `/login` and public APIs require authentication.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        CLIENT                                   │
│   1. User submits email/password                                │
│   2. Receives HTTP-only session cookie                          │
│   3. Cookie automatically sent with all requests                │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                      MIDDLEWARE                                 │
│   /apps/web/src/middleware.ts                                   │
│                                                                 │
│   • Checks for atlas_session cookie                             │
│   • Public paths: /login, /api/auth/login, /api/version, etc.   │
│   • Unauthenticated → redirect to /login (or 401 for API)       │
│   • Authenticated → pass through                                │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                       AUTH LIBRARY                              │
│   /apps/web/src/lib/auth.ts                                     │
│                                                                 │
│   Functions:                                                    │
│   • login(email, password) → creates session                    │
│   • validateSession(token) → returns staff info                 │
│   • getSession(request) → full staff context                    │
│   • requireAuth(request) → throws if not authenticated          │
│   • requireRole(request, roles[]) → throws if not authorized    │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                       DATABASE                                  │
│   trapper schema                                                │
│                                                                 │
│   Tables:                                                       │
│   • staff - Auth columns: password_hash, auth_role, etc.        │
│   • staff_sessions - Token storage and session tracking         │
│   • staff_permissions - RBAC permission definitions             │
│                                                                 │
│   Functions:                                                    │
│   • create_staff_session(staff_id, token_hash, ...)             │
│   • validate_staff_session(token_hash) → staff info             │
│   • invalidate_staff_session(token_hash, reason)                │
│   • record_failed_login(email) → locks after 5 attempts         │
│   • staff_can_access(staff_id, resource, action)                │
└────────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/middleware.ts` | Route protection, auth enforcement |
| `apps/web/src/lib/auth.ts` | Auth functions, session management |
| `apps/web/src/hooks/useCurrentUser.ts` | Client-side auth hook |
| `apps/web/src/app/api/auth/login/route.ts` | Login endpoint |
| `apps/web/src/app/api/auth/logout/route.ts` | Logout endpoint |
| `apps/web/src/app/api/auth/me/route.ts` | Get current user |
| `apps/web/src/app/api/auth/change-password/route.ts` | Change password |
| `apps/web/src/app/login/page.tsx` | Login UI |
| `sql/schema/sot/MIG_400__staff_authentication.sql` | Auth schema |
| `sql/schema/sot/MIG_453__auth_enforcement.sql` | Password management |

## Database Schema

### staff table (auth columns)

```sql
-- Added by MIG_400 and MIG_453
password_hash TEXT              -- bcrypt hash
last_login_at TIMESTAMPTZ       -- Last successful login
login_attempts INT DEFAULT 0    -- Failed attempts (resets on success)
locked_until TIMESTAMPTZ        -- Account locked until this time
auth_role TEXT DEFAULT 'staff'  -- 'admin', 'staff', 'volunteer'
password_change_required BOOL   -- Force change on next login
password_set_at TIMESTAMPTZ     -- When password was last set
password_reset_token_hash TEXT  -- For email-based reset
password_reset_expires_at TIMESTAMPTZ
```

### staff_sessions table

```sql
session_id UUID PRIMARY KEY
staff_id UUID REFERENCES staff
token_hash TEXT NOT NULL        -- SHA-256 of token (we never store raw tokens)
created_at TIMESTAMPTZ
expires_at TIMESTAMPTZ NOT NULL
last_activity_at TIMESTAMPTZ
ip_address TEXT
user_agent TEXT
is_valid BOOLEAN DEFAULT TRUE
invalidated_at TIMESTAMPTZ
invalidated_reason TEXT
```

### staff_permissions table

```sql
permission_id UUID PRIMARY KEY
auth_role TEXT NOT NULL         -- 'admin', 'staff', 'volunteer'
resource TEXT NOT NULL          -- 'requests', 'cats', '*', etc.
action TEXT NOT NULL            -- 'read', 'write', 'delete'
```

## API Endpoints

### POST /api/auth/login

```typescript
// Request
{ email: string, password: string }

// Response (success)
{
  success: true,
  staff: { staff_id, display_name, email, auth_role },
  password_change_required: boolean
}

// Response (error)
{ success: false, error: string }
```

### POST /api/auth/logout

```typescript
// No body required, uses session cookie
// Response
{ success: true }
```

### GET /api/auth/me

```typescript
// Returns current authenticated user
{
  authenticated: true,
  staff: { staff_id, display_name, email, auth_role, password_change_required }
}

// Or if not authenticated
{ authenticated: false }
```

### POST /api/auth/change-password

```typescript
// Request
{ current_password: string, new_password: string }

// Response
{ success: true } | { success: false, error: string }
```

## Using Auth in API Routes

```typescript
import { getSession, requireAuth, requireRole } from "@/lib/auth";

// Check if authenticated
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // session.staff_id, session.display_name, session.auth_role available
}

// Require authentication (throws if not authenticated)
export async function POST(request: NextRequest) {
  const staff = await requireAuth(request);
  // staff is guaranteed to be valid
}

// Require specific role(s)
export async function DELETE(request: NextRequest) {
  const staff = await requireRole(request, ["admin"]);
  // Only admins reach here
}
```

## Using Auth in Client Components

```typescript
import { useCurrentUser } from "@/hooks/useCurrentUser";

function MyComponent() {
  const { user, isLoading, isAuthenticated, error, refetch } = useCurrentUser();

  if (isLoading) return <div>Loading...</div>;
  if (!isAuthenticated) return <div>Not logged in</div>;

  return <div>Hello, {user.display_name}</div>;
}
```

## Role-Based Access Control

### Admin
- Full access to all resources
- Can manage staff passwords via `/admin/auth`
- Access to Claude Code assistant at `/admin/claude-code`
- Can enable test mode (with appropriate env var)

### Staff
- Workflow access: requests, cats, people, places, journal, intake, trappers
- Read access to Beacon analytics
- Can use Tippy AI assistant

### Volunteer
- Read-only access to: requests, cats, places
- Can create field observations
- Read access to Beacon analytics

## Security Features

### Password Hashing
- bcrypt with 12 rounds (configurable)
- Passwords never stored in plain text
- Password hash verified server-side only

### Session Security
- Tokens are 32-byte random hex strings
- Only SHA-256 hash stored in database
- HTTP-only cookies prevent XSS access
- Secure flag in production
- SameSite=lax for CSRF protection
- 24-hour expiration (configurable via SESSION_EXPIRY_HOURS)

### Account Lockout
- After 5 failed login attempts, account locked for 15 minutes
- Lockout tracked in database, survives server restarts
- Successful login resets attempt counter

### Password Reset Flow
1. Admin triggers reset via `/admin/auth`
2. Password set to default (from STAFF_DEFAULT_PASSWORD env)
3. password_change_required = TRUE
4. User must change on next login

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STAFF_DEFAULT_PASSWORD` | Yes | - | Default password for new/reset accounts |
| `SESSION_EXPIRY_HOURS` | No | 24 | Session duration in hours |

## Admin Tasks

### View Auth Status
- URL: `/admin/auth`
- Shows: staff list, password status, last login, roles

### Set Default Passwords
- Click "Set Default Passwords" button
- Sets password for all staff without passwords
- All users must change on first login

### Reset Individual Password
- Click "Reset" button next to staff member
- Sets their password to default
- They must change on next login

### Change Auth Roles
- Direct database update (no UI yet):
```sql
UPDATE trapper.staff
SET auth_role = 'admin'
WHERE email = 'someone@forgottenfelines.com';
```

## Migrations Required

Apply these in order:
1. `MIG_400__staff_authentication.sql` - Core auth schema
2. `MIG_453__auth_enforcement.sql` - Password management functions

```bash
psql $DATABASE_URL -f sql/schema/sot/MIG_400__staff_authentication.sql
psql $DATABASE_URL -f sql/schema/sot/MIG_453__auth_enforcement.sql
```

## Troubleshooting

### "Authentication required" on all pages
- Check that `atlas_session` cookie exists
- Verify session hasn't expired
- Check staff account is active

### "Account is locked"
- Wait 15 minutes, or
- Admin can clear: `UPDATE staff SET locked_until = NULL WHERE email = '...'`

### "Password not set"
- Admin needs to set default passwords via `/admin/auth`
- Or direct SQL: `SELECT * FROM trapper.set_default_passwords('password')`

### Sessions not working
- Ensure `staff_sessions` table exists (run MIG_400)
- Check DATABASE_URL is correct
- Verify cookies aren't being blocked
