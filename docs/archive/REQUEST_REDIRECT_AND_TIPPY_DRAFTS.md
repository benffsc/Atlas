# Request Redirect & Tippy Draft Requests

This document describes two related systems added to Atlas for handling request workflow scenarios.

## Overview

Two real-world scenarios drove the development of these features:

1. **Request Redirect**: When field conditions change and a request needs to be closed in favor of a new request at a different address or for a different contact.

2. **Tippy Draft Requests**: Allow Tippy to help create requests from conversation, but require coordinator approval before they become official requests.

Both systems are designed to be **Beacon-safe**, meaning they prevent double-counting of cats in attribution statistics.

---

## Part 1: Request Redirect System

### Problem
When staff discovers that cats are actually at a different location than originally reported (e.g., Nancy Degenkolb's request should actually be for Kris Anderson at a different address), they need to:
- Close the original request
- Create a new request with correct information
- Maintain audit trail linking the two
- Ensure Beacon stats don't double-count

### Database Changes (MIG_520)

**New columns on `sot_requests`:**
```sql
redirected_to_request_id UUID     -- Points to the new request (if this was redirected)
redirected_from_request_id UUID   -- Points to the original request (if this came from redirect)
redirect_reason TEXT              -- Why the redirect occurred
redirect_at TIMESTAMPTZ           -- When the redirect happened
```

**New status value:**
- `'redirected'` - Added to request_status enum

**Beacon-Safe Attribution Windows:**

The key insight is that redirected requests need **non-overlapping** attribution windows to prevent double-counting:

1. **Redirected requests**: Attribution window ends at `redirect_at` (no 3-month buffer)
2. **Child requests**: Attribution window starts at parent's `redirect_at` (no 6-month lookback)

This is implemented in `v_request_alteration_stats`:
```sql
-- Window end for redirected requests
WHEN r.status = 'redirected' AND r.redirect_at IS NOT NULL
  THEN r.redirect_at  -- No buffer!

-- Window start for child of redirect
WHEN r.redirected_from_request_id IS NOT NULL THEN (
  SELECT COALESCE(parent.redirect_at, parent.resolved_at, NOW())
  FROM trapper.sot_requests parent
  WHERE parent.request_id = r.redirected_from_request_id
)
```

**Function:**
- `trapper.redirect_request(...)` - Handles the redirect workflow atomically

### API Endpoints

**POST /api/requests/[id]/redirect**
```typescript
// Request body
{
  redirect_reason: string;       // Why redirecting
  new_address: string;           // Address for new request
  new_requester_name?: string;   // Contact name
  new_requester_phone?: string;  // Contact phone
  new_requester_email?: string;  // Contact email
  summary?: string;              // New request summary
  notes?: string;                // Additional notes
  estimated_cat_count?: number;  // Cat estimate
}

// Response
{
  success: boolean;
  original_request_id: string;
  new_request_id: string;
}
```

**GET /api/requests/[id]/redirect**
```typescript
// Response - returns redirect info if this request has been redirected
{
  redirected_to: {
    request_id: string;
    short_address: string;
    created_at: string;
  } | null;
  redirected_from: {
    request_id: string;
    short_address: string;
    redirect_reason: string;
    redirect_at: string;
  } | null;
}
```

### UI Components

**RedirectRequestModal.tsx**
- Modal component for initiating a redirect
- Form fields for new request details
- Redirect reason selection

**Request Detail Page Updates**
- "Redirect Request" button in header actions (for non-completed/cancelled/redirected requests)
- Blue banner if request was redirected FROM another request
- Yellow banner if request has been redirected TO another request
- 'redirected' status displays as gray badge

### Usage Flow

1. Staff views a request that needs redirecting
2. Clicks "Redirect Request" button
3. Fills in redirect reason and new request details
4. Submits - original request closes as 'redirected', new request created
5. Both requests link to each other via banners

---

## Part 2: Tippy Draft Requests System

### Problem
Staff want Tippy to help create requests from conversation, but:
- Requests need coordinator review before becoming official
- Places may have existing TNR history that should be considered
- Beacon stats shouldn't be affected until approved

### Database Changes (MIG_521)

**New table: `tippy_draft_requests`**
```sql
CREATE TABLE trapper.tippy_draft_requests (
  draft_id UUID PRIMARY KEY,

  -- Conversation context
  conversation_id UUID,
  created_by_staff_id UUID,

  -- Request data
  raw_address TEXT NOT NULL,
  place_id UUID,                    -- Resolved during creation
  requester_name TEXT,
  requester_phone TEXT,
  requester_email TEXT,
  estimated_cat_count INT,
  summary TEXT,
  notes TEXT,
  has_kittens BOOLEAN,
  priority TEXT,                    -- urgent, high, normal, low

  -- Tippy context
  tippy_reasoning TEXT,             -- Why Tippy thinks this should be created
  place_context JSONB,              -- Existing TNR history

  -- Review workflow
  status TEXT,                      -- pending, approved, rejected, expired
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- If approved
  promoted_request_id UUID,         -- Links to created request

  -- Timestamps
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ            -- 7 days from creation
);
```

**Functions:**
- `trapper.approve_tippy_draft(...)` - Approves draft and creates request via `find_or_create_request()`
- `trapper.reject_tippy_draft(...)` - Rejects draft with optional notes
- `trapper.expire_old_drafts()` - Called by cron to expire unreviewed drafts

**Views:**
- `v_tippy_draft_review_queue` - Pending drafts with place context
- `v_tippy_draft_stats` - Statistics on drafts

### Tippy Tool

**Tool Definition (in tools.ts):**
```typescript
{
  name: "create_draft_request",
  description: "Create a DRAFT FFR request from conversation...",
  input_schema: {
    properties: {
      address: { type: "string" },
      requester_name: { type: "string" },
      requester_phone: { type: "string" },
      requester_email: { type: "string" },
      estimated_cat_count: { type: "number" },
      summary: { type: "string" },
      notes: { type: "string" },
      has_kittens: { type: "boolean" },
      priority: { type: "string" },
      reasoning: { type: "string" },
      place_lookup_summary: { type: "string" }
    },
    required: ["address", "summary", "reasoning"]
  }
}
```

**Access Level:** Requires `read_write` or `full` AI access level.

**Workflow:**
1. Tippy uses `comprehensive_place_lookup` to check existing TNR history
2. Includes context in `reasoning` and `place_lookup_summary`
3. Creates draft via `create_draft_request` tool
4. Draft appears in coordinator review queue

### API Endpoints

**GET /api/admin/tippy-drafts**
```typescript
// Query params: status (pending|approved|rejected|expired|all), limit, offset
// Response
{
  drafts: TippyDraft[];
  stats: {
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    expired_count: number;
    approved_this_week: number;
    rejected_this_week: number;
    approval_rate_pct: number | null;
    avg_review_hours: number | null;
  };
  pagination: { limit, offset, hasMore };
}
```

**GET /api/admin/tippy-drafts/[id]**
```typescript
// Response
{
  draft: TippyDraft;
}
```

**POST /api/admin/tippy-drafts/[id]**
```typescript
// Request body
{
  action: "approve" | "reject";
  review_notes?: string;
  overrides?: {                    // Only for approve
    address?: string;
    cat_count?: number;
    priority?: string;
  };
}

// Response (approve)
{
  success: true;
  message: "Draft approved and request created";
  request_id: string;
}

// Response (reject)
{
  success: true;
  message: "Draft rejected";
}
```

### Admin UI

**Location:** `/admin/tippy-drafts`

**Features:**
- Stats summary (pending, approved this week, approval rate, avg review time)
- Status tabs (Pending, Approved, Rejected, Expired, All)
- Draft cards showing:
  - Priority badge
  - Expiration countdown
  - Address and contact info
  - Summary
  - Warning if location has active requests
- Detail modal for reviewing:
  - Full draft details
  - Tippy's reasoning
  - Existing TNR history at location
  - Override fields (address, cat count, priority)
  - Review notes
  - Approve/Reject buttons

### Admin Navigation

Card added to Admin Dashboard under "Developer Tools":
- Title: "Tippy Drafts"
- Description: "Review AI-created requests"
- Link: `/admin/tippy-drafts`

---

## Files Changed

### Migrations
- `sql/schema/sot/MIG_520__request_redirect_linking.sql`
- `sql/schema/sot/MIG_521__tippy_draft_requests.sql`

### API Routes
- `apps/web/src/app/api/requests/[id]/redirect/route.ts` (new)
- `apps/web/src/app/api/requests/[id]/route.ts` (modified - added redirect fields)
- `apps/web/src/app/api/admin/tippy-drafts/route.ts` (new)
- `apps/web/src/app/api/admin/tippy-drafts/[id]/route.ts` (new)

### Tippy
- `apps/web/src/app/api/tippy/tools.ts` (added create_draft_request tool)
- `apps/web/src/app/api/tippy/chat/route.ts` (added to WRITE_TOOLS)

### UI Components
- `apps/web/src/components/RedirectRequestModal.tsx` (new)
- `apps/web/src/app/requests/[id]/page.tsx` (modified - redirect UI)
- `apps/web/src/app/admin/tippy-drafts/page.tsx` (new)
- `apps/web/src/app/admin/page.tsx` (modified - navigation link)

---

## Testing

### Redirect System Testing
```sql
-- Verify no stat changes after migration
SELECT
  b.place_id,
  b.total_cats_altered AS before_altered,
  a.total_cats_altered AS after_altered
FROM _test_stats_before b
JOIN trapper.v_place_alteration_history a ON a.place_id = b.place_id
WHERE b.total_cats_altered != a.total_cats_altered;
-- Should return 0 rows

-- Test redirect window boundaries
-- Create redirect, verify parent window ends at redirect_at
-- Verify child window starts at parent redirect_at
```

### Draft System Testing
1. Use Tippy to create a draft request via conversation
2. Verify draft appears in `/admin/tippy-drafts`
3. Verify place context shows existing TNR history
4. Approve draft, verify request created with correct data
5. Verify Beacon stats updated only after approval

---

## Related Documentation
- `docs/ATLAS_MISSION_CONTRACT.md` - Core data principles
- `CLAUDE.md` - Development rules and centralized functions
