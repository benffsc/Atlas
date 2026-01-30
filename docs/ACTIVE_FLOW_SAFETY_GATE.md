# Active Flow Safety Gate

**Version:** 1.0
**Created:** 2026-01-28
**Purpose:** Concrete checklist to verify ACTIVE flows still work after any change.

Any pull request or migration that touches tables, views, functions, triggers, or endpoints listed here MUST pass this gate before merge.

---

## Call Graph: Active Flows

### Flow 1: Phone Intake Capture

```
Staff opens /admin/intake/call
  └─ 6-step form (client-side)
  └─ Submit → POST /api/intake
       └─ INSERT INTO trapper.web_intake_submissions (67 fields)
       └─ TRIGGER: trg_auto_triage_intake → compute_intake_triage()
       └─ TRIGGER: trg_intake_create_person → find_or_create_person()
       └─ TRIGGER: trg_intake_link_place → link_intake_submission_to_place()
       └─ TRIGGER: trg_check_intake_duplicate → check_intake_duplicate()
       └─ TRIGGER: trg_intake_colony_estimate → create_intake_colony_estimate()
       └─ TRIGGER: trg_queue_intake_extraction → extraction_queue INSERT
       └─ ASYNC: match_intake_to_person(), link_intake_submission_to_place()
       └─ Response: { submission_id, triage_category, triage_score }
```

**Required POST body:** `first_name`, `last_name`, (`email` OR `phone`), `cats_address`

**DB surfaces touched:**
| Object | Type | Operation |
|--------|------|-----------|
| `web_intake_submissions` | Table | INSERT |
| `sot_people` | Table | INSERT (via trigger) |
| `person_identifiers` | Table | INSERT (via trigger) |
| `places` | Table | SELECT/INSERT (via trigger) |
| `place_colony_estimates` | Table | INSERT (via trigger) |
| `extraction_queue` | Table | INSERT (via trigger) |
| `compute_intake_triage()` | Function | Called by trigger |
| `find_or_create_person()` | Function | Called by trigger |

---

### Flow 2: Intake Queue Display

```
Staff opens /intake/queue
  └─ GET /api/intake/queue?mode=attention&limit=50
       └─ SELECT FROM trapper.v_intake_triage_queue
       └─ Response: { submissions: [...41 fields each] }
```

**DB surfaces touched:**
| Object | Type | Operation |
|--------|------|-----------|
| `v_intake_triage_queue` | View | SELECT |
| `web_intake_submissions` | Table | Read (underlying) |

**Critical view columns:** `submission_id`, `submission_status`, `triage_category`, `triage_score`, `is_emergency`, `overdue`, `cats_address`, `cat_count_estimate`

---

### Flow 3: Request List + Dashboard

```
Staff opens / (dashboard)
  └─ GET /api/requests?limit=50
       └─ SELECT FROM trapper.v_request_list
  └─ GET /api/intake/queue?mode=attention&limit=50
       └─ SELECT FROM trapper.v_intake_triage_queue

Staff opens /requests
  └─ GET /api/requests?limit=50&offset=0
       └─ SELECT FROM trapper.v_request_list (23 fields)
```

**DB surfaces touched:**
| Object | Type | Operation |
|--------|------|-----------|
| `v_request_list` | View | SELECT |
| `sot_requests` | Table | Read (underlying) |
| `places` | Table | Read (underlying) |
| `sot_people` | Table | Read (underlying) |

**Critical view columns:** `request_id`, `status`, `priority`, `place_address`, `estimated_cat_count`, `has_kittens`, `created_at`, `updated_at`

---

### Flow 4: Request Detail + Update

```
Staff opens /requests/[id]
  └─ GET /api/requests/{id}
       └─ SELECT FROM trapper.sot_requests (joined with places, sot_people, v_place_colony_status)
       └─ SELECT FROM trapper.request_status_history
       └─ SELECT FROM trapper.request_trapper_assignments
       └─ SELECT FROM trapper.request_cat_links
       └─ compute_request_readiness(), compute_request_urgency()

Staff updates request (status, notes, assignment, etc.)
  └─ PATCH /api/requests/{id}
       └─ UPDATE trapper.sot_requests SET ...
       └─ TRIGGERS: trg_log_request_status, trg_set_resolved_at, trg_request_activity,
                    trg_auto_suggest_classification, trg_assign_colony_context_on_request,
                    trg_request_colony_estimate, trg_queue_request_extraction
       └─ logFieldEdits() → entity_edits
       └─ Response: { ...updated request fields }
```

**DB surfaces touched (GET):**
| Object | Type | Operation |
|--------|------|-----------|
| `sot_requests` | Table | SELECT |
| `places` | Table | SELECT (join) |
| `sot_addresses` | Table | SELECT (join) |
| `sot_people` | Table | SELECT (join) |
| `v_place_colony_status` | View | SELECT (join) |
| `request_status_history` | Table | SELECT |
| `request_trapper_assignments` | Table | SELECT |
| `request_cat_links` | Table | SELECT |
| `compute_request_readiness()` | Function | Called |
| `compute_request_urgency()` | Function | Called |

**DB surfaces touched (PATCH):**
| Object | Type | Operation |
|--------|------|-----------|
| `sot_requests` | Table | UPDATE |
| `entity_edits` | Table | INSERT (audit) |
| `request_status_history` | Table | INSERT (via trigger) |
| `place_colony_estimates` | Table | INSERT (if completion observation) |

**Critical PATCH fields (must remain accepted):**
`status`, `priority`, `summary`, `notes`, `estimated_cat_count`, `has_kittens`, `hold_reason`, `scheduled_date`, `resolution_notes`, `kitten_assessment_status`, `ready_to_email`

---

### Flow 5: Journal Notes

```
Staff views journal on request detail
  └─ GET /api/journal?request_id={id}
       └─ SELECT FROM trapper.journal_entries (joined with staff, entities)

Staff adds a note
  └─ POST /api/journal
       └─ INSERT INTO trapper.journal_entries
       └─ TRIGGERS: trg_journal_entry_history_log
       └─ Optional: UPDATE web_intake_submissions (contact tracking)
```

**DB surfaces touched:**
| Object | Type | Operation |
|--------|------|-----------|
| `journal_entries` | Table | SELECT, INSERT |
| `journal_entry_history` | Table | INSERT (via trigger) |
| `web_intake_submissions` | Table | UPDATE (contact tracking) |
| `staff` | Table | SELECT (join for staff name) |

**Required POST body:** `body` (text), at least one entity link (`request_id`, `submission_id`, etc.)

---

### Flow 6: Authentication

```
Staff navigates anywhere
  └─ AppShell checks GET /api/auth/me
       └─ getSession(request) → staff_sessions + staff tables
       └─ Response: { authenticated, staff: { staff_id, display_name, email, auth_role } }

Staff logs in
  └─ POST /api/auth/login
       └─ SELECT FROM trapper.staff WHERE email = $1
       └─ create_staff_session()
```

**DB surfaces touched:**
| Object | Type | Operation |
|--------|------|-----------|
| `staff` | Table | SELECT |
| `staff_sessions` | Table | SELECT, INSERT |

---

## Validation Checklist

Run this after ANY change that touches active flow surfaces.

### V1: Intake Capture (Critical)

- [ ] **V1.1** Open `/admin/intake/call` — page loads with 6-step form
- [ ] **V1.2** Fill minimum fields: first_name, last_name, phone, cats_address
- [ ] **V1.3** Submit form — response includes `submission_id` and `triage_category`
- [ ] **V1.4** Query: `SELECT submission_id, triage_category, submission_status FROM trapper.web_intake_submissions ORDER BY submitted_at DESC LIMIT 1` — row exists with status `new`
- [ ] **V1.5** Check triggers fired: person created, place linked (query `person_identifiers` for the phone)

### V2: Intake Queue (Critical)

- [ ] **V2.1** Open `/intake/queue` — page loads with submission list
- [ ] **V2.2** Newly created submission appears in queue
- [ ] **V2.3** Emergency submissions show "URGENT" badge
- [ ] **V2.4** Query: `SELECT COUNT(*) FROM trapper.v_intake_triage_queue WHERE submission_status = 'new'` — returns > 0

### V3: Request Lifecycle (Critical)

- [ ] **V3.1** Open `/requests` — page loads with request list
- [ ] **V3.2** Open any `/requests/{id}` — page loads with full detail
- [ ] **V3.3** Change status (e.g., `new` → `triaged`) via UI — saves successfully
- [ ] **V3.4** Query: `SELECT * FROM trapper.request_status_history WHERE request_id = '{id}' ORDER BY changed_at DESC LIMIT 1` — status change logged
- [ ] **V3.5** Add a journal note on the request — note appears in journal section

### V4: Journal (Critical)

- [ ] **V4.1** POST `/api/journal` with `{ body: "test note", request_id: "{id}" }` — returns 201 with entry ID
- [ ] **V4.2** GET `/api/journal?request_id={id}` — returns entries including the test note
- [ ] **V4.3** PATCH journal entry (edit body) — saves, `edit_count` increments

### V5: Auth (Critical)

- [ ] **V5.1** GET `/api/auth/me` — returns `{ authenticated: true, staff: {...} }` with valid session
- [ ] **V5.2** Without session cookie — returns 401
- [ ] **V5.3** Navigation shows correct role-based menu items

### V6: Search (Important)

- [ ] **V6.1** GET `/api/search?q=test` — returns results with timing
- [ ] **V6.2** Search by address returns matching places
- [ ] **V6.3** Search by person name returns matching people

---

## SQL Smoke Queries

Run these after any migration or schema change:

```sql
-- Active flow views still resolve
SELECT COUNT(*) FROM trapper.v_intake_triage_queue;
SELECT COUNT(*) FROM trapper.v_request_list;
SELECT COUNT(*) FROM trapper.v_request_journal LIMIT 1;

-- Key functions still exist and accept correct signatures
SELECT trapper.compute_intake_triage(NULL::trapper.web_intake_submissions);
-- (will return NULL, but proves function exists with correct signature)

-- Triggers still enabled on critical tables
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'trapper.web_intake_submissions'::regclass
  AND tgname IN ('trg_auto_triage_intake', 'trg_intake_create_person', 'trg_intake_link_place');

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'trapper.sot_requests'::regclass
  AND tgname IN ('trg_log_request_status', 'trg_set_resolved_at', 'trg_request_activity');

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'trapper.journal_entries'::regclass
  AND tgname = 'trg_journal_entry_history_log';

-- Core tables have data
SELECT 'web_intake_submissions' as t, COUNT(*) FROM trapper.web_intake_submissions
UNION ALL SELECT 'sot_requests', COUNT(*) FROM trapper.sot_requests
UNION ALL SELECT 'journal_entries', COUNT(*) FROM trapper.journal_entries
UNION ALL SELECT 'staff', COUNT(*) FROM trapper.staff
UNION ALL SELECT 'staff_sessions', COUNT(*) FROM trapper.staff_sessions WHERE expires_at > NOW();
```

---

## Rules for Changes Touching Active Flows

1. **Must be additive** — new columns OK, removing columns NOT OK without migration path.
2. **Must not rename** — table, view, column, or function renames require a deprecation period with aliases.
3. **Must not change trigger behavior** — if a trigger's effect changes, document and test explicitly.
4. **Must not change response shapes** — API endpoints may add fields but never remove or rename existing ones.
5. **Must run Safety Gate** — all V1-V6 checks must pass before merge.
6. **Must have rollback** — every migration that touches active surfaces must have a documented rollback SQL.
