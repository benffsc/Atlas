# Atlas TNR Tracking Roadmap

## Current State (January 2026)

### Data Foundation
- **275 Trapping Requests** synced from Airtable (legacy, with internal notes preserved)
- **34,941 Cats** in sot_cats (22.9% verified altered via ClinicHQ)
- **8,656 ClinicHQ cat records** with surgery status
- **Places** with addresses, 98.9% requests linked to places

### Trust Model
- **Soft data**: `estimated_cat_count`, manual notes (useful context, not authoritative)
- **Hard data**: `verified_altered_count` computed from ClinicHQ linkage (trustworthy)
- Legacy data is labeled as such; new Atlas-native data earns trust through provenance

### Infrastructure Ready
- Journal system (MIG_140) with edit history and entity linking
- Verified counts views (MIG_141) from ClinicHQ
- Request detail API with verified counts
- Dark mode styling fixed

---

## Phase 1: Cat-Request Linkage (Next Priority)

**Goal**: Connect cats to requests so verified counts populate

### Tasks
1. **Link existing cats to requests via place matching**
   - Cats at place X + Request for place X = auto-suggest linkage
   - Use `cat_place_relationships` and `request.place_id`

2. **Build cat linkage UI on request detail page**
   - Show cats at this place
   - "Link cat to this request" action
   - Relationship types: `trapped`, `verified_already_altered`, `released`

3. **ClinicHQ appointment → request matching**
   - When a cat goes through ClinicHQ, attempt to match to open request by:
     - Same place/address
     - Similar timeframe
     - Owner/requester match

### Success Metric
- Requests show `verified_altered_count > 0` when cats are linked
- `verification_completeness` moves from `no_cats_linked` to `partially_verified`

---

## Phase 2: Colony Management

**Goal**: Track cat populations at places, not just per-request

### Schema Additions
```sql
-- Add to places or create colony_profiles
known_population INT,           -- Estimated total cats
known_altered_count INT,        -- Verified altered (computed from linked cats)
colony_status TEXT,             -- 'unknown', 'active_unmanaged', 'in_progress', 'managed'
first_activity_at TIMESTAMPTZ,  -- When we first worked here
last_activity_at TIMESTAMPTZ,   -- Most recent activity
```

### Features
1. **Place detail shows colony info**
   - Total cats at this place (from cat_place_relationships)
   - Altered vs unaltered breakdown
   - TNR progress over time

2. **"Start Colony" action**
   - Mark a place as a managed colony
   - Set initial population estimate
   - Creates a request if needed

3. **Colony dashboard**
   - Places ranked by unaltered cat count
   - Progress tracking (% managed)
   - Geographic clustering view

---

## Phase 3: Native Request Creation

**Goal**: Replace Airtable workflow with Atlas-native requests

### New Request Form
- More granular questions than legacy Airtable
- Required fields vs optional based on request type
- Direct place/person linking at creation time
- Photo upload for site context

### Request Types
- **Community TNR** - feral colony, need full trap
- **Owned Cat TNR** - pet owner, appointment-style
- **Already Altered Verification** - confirm ear tip, no surgery needed
- **Return to Field** - post-surgery return

### Workflow States
```
new → triaged → scheduled → in_progress → completed
                    ↓
                 on_hold
                    ↓
                cancelled
```

---

## Phase 4: Journal Integration

**Goal**: Replace Airtable internal notes with structured journal

### Migration Path
1. Legacy notes remain read-only in `legacy_notes` field
2. New notes go to journal system with:
   - Entity linking (cats, people, places)
   - Attachments (photos, documents)
   - Edit history with audit trail

### Journal Entry Types
- `note` - General observations
- `contact` - Called client, left message, etc.
- `field_visit` - Site visit, trap check
- `trap_event` - Trap set, cat caught
- `medical` - Vet observations
- `status_change` - Auto-logged workflow transitions

---

## Phase 5: Reporting & Analytics

**Goal**: Prove impact with trustworthy numbers

### Key Metrics (all computed from verified data)
- Cats altered this month/quarter/year
- Requests completed with verification
- Places with full colony management
- Time from request → completion

### Trust Indicators
- Show verification status on all counts
- "Verified via ClinicHQ" badge
- Confidence scores on estimates

---

## Technical Debt / Cleanup

### Short-term
- [ ] Fix any remaining dark mode styling issues
- [ ] Add loading states to request detail
- [ ] Error handling for failed API calls

### Medium-term
- [ ] Bidirectional Airtable sync (optional)
- [ ] ClinicHQ appointment auto-import
- [ ] Microchip lookup/validation

### Long-term
- [ ] Mobile-friendly field app
- [ ] Offline capability for trap checks
- [ ] Integration with shelter systems

---

## Guiding Principles

1. **Trust through provenance** - Only show verified counts when backed by verified data
2. **Legacy ≠ bad** - Label legacy data, don't hide it; it's useful context
3. **Build incrementally** - Each phase delivers value, don't wait for perfect
4. **Data hygiene first** - Better to have 10 accurate records than 100 messy ones
5. **Tool earns trust** - Staff adoption comes from reliability, not features
