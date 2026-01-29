# Atlas Operator Guide

**Audience:** FFSC Staff (coordinators, intake specialists, trappers)
**Version:** 1.0
**Created:** 2026-01-29

---

## Quick Reference

| Task | Where | How |
|------|-------|-----|
| Take a phone intake | `/admin/intake/call` | 6-step form → Submit |
| View intake queue | `/intake/queue` | Filter by attention/all |
| Open a request | `/requests/[id]` | Click from queue or search |
| Add a journal note | Request detail page | Journal section → Add note |
| Assign a trapper | Request detail page | Trapper section → Search + Assign |
| Search anything | Top search bar | Type address, person name, or cat name |
| View dashboard | `/` (home) | Shows recent requests + intake queue |

---

## 1. Phone Intake

### Taking a Call

1. Navigate to **`/admin/intake/call`**
2. Fill the 6-step form:
   - **Step 1:** Caller info (first name, last name, phone or email)
   - **Step 2:** Cat address (the location where cats are)
   - **Step 3:** Cat details (estimated count, has kittens, description)
   - **Step 4:** Feeding behavior (feeds cat? frequency? duration?)
   - **Step 5:** Ownership status (stray, community colony, my cat, neighbor's cat)
   - **Step 6:** Additional notes, emergency flag, custom fields
3. Click **Submit**

### What Happens Automatically

When you submit an intake:

- A **triage score** is computed (based on cat count, kittens, emergency flag, feeding behavior)
- The caller is matched to an existing person (by email/phone) or a new person is created
- The address is matched to an existing place or a new place is created
- A colony size estimate is created from the cat count
- The submission enters the **intake queue**

### Required Fields

At minimum you need: **first name**, **last name**, and either **email** or **phone**, plus **cat address**.

### Emergency Intakes

Check the "Is Emergency" box for urgent situations. The caller must acknowledge that FFSC is not a 24-hour animal hospital. Emergency submissions get a higher triage score and show an **URGENT** badge in the queue.

---

## 2. Intake Queue

### Viewing the Queue

Navigate to **`/intake/queue`**. You'll see submissions sorted by triage priority.

### Submission Statuses

| Status | Meaning |
|--------|---------|
| `new` | Just submitted, not yet reviewed |
| `in_progress` | Being actively worked on |
| `scheduled` | Appointment or trapping scheduled |
| `complete` | Fully resolved |
| `archived` | No longer active |

### Triage Categories

The auto-triage system categorizes intakes:

- **urgent** — Emergency flagged, high cat count with kittens
- **high** — Kittens present, active feeder, large colony
- **normal** — Standard TNR request
- **low** — Small count, no kittens, infrequent feeding

You can override the priority manually on any submission.

---

## 3. Request Lifecycle

### Status Flow

```
new → triaged → scheduled → in_progress → completed
                    ↓
                on_hold (with hold_reason)
                    ↓
                cancelled
```

When a request is **completed** or **cancelled**, the system automatically sets `resolved_at` to the current time.

### Request Detail Page

Navigate to **`/requests/[id]`** to see:

- **Header:** Address, status, priority, requester info
- **Colony info:** Estimated cat count, colony size, alteration history
- **Trappers:** Assigned trappers (can have multiple)
- **Journal:** Notes, call logs, status change history
- **Status history:** Complete audit trail of all status changes

### Updating a Request

On the request detail page you can:

- Change **status** (triggers are logged automatically)
- Update **priority**, **summary**, **notes**
- Set **estimated cat count**, **has kittens** flag
- Set **scheduled date**
- Add **hold reason** when putting on hold
- Add **resolution notes** when completing
- Mark **kitten assessment status**

### Assigning Trappers

1. On request detail, go to the **Trappers** section
2. Search for a trapper by name
3. Click **Assign**

A request can have multiple trappers assigned. Unassign by clicking the remove button.

### Completing a Request

When completing or partially completing a request:

1. Change status to **completed**
2. Add **resolution notes** describing the outcome
3. Optionally log **observation data**: total cats seen, ear-tipped cats seen
   - This feeds the Chapman population estimator for the place

---

## 4. Journal / Notes

### Adding a Note

On any request detail page:

1. Scroll to the **Journal** section
2. Type your note in the text area
3. Click **Add Note**

Notes are timestamped and attributed to the logged-in staff member.

### Editing a Note

Click the edit icon on an existing note. The edit is tracked — an `edit_count` increments each time.

### Journal Types

Journal entries can be:

- **General notes** — Free-text observations
- **Call logs** — Record of phone conversations (used for communication tracking)
- **Status changes** — Automatically logged when status changes

---

## 5. Search

### Global Search

Use the search bar at the top of any page. Search works across:

- **Addresses** — Find places by street address
- **People** — Find by name (results show email/phone for disambiguation)
- **Cats** — Find by name or microchip number
- **Requests** — Find by address or ID

### Tips

- Search by **address** for the most accurate place-level results
- Remember that Atlas shows **only data at that specific address** — data from other locations does not mix in
- If a place was merged, Atlas automatically redirects to the canonical (current) place

---

## 6. Trapper Types

| Type | FFSC? | Who |
|------|-------|-----|
| **Coordinator** | Yes | FFSC staff coordinator |
| **Head Trapper** | Yes | FFSC head trapper |
| **FFSC Trapper** | Yes | Completed FFSC orientation + training |
| **Community Trapper** | No | Signed contract only, limited scope |

"Legacy Trapper" from old Airtable records = **FFSC Trapper** (grandfathered).

---

## 7. Common Fixes

### "I can't find a person"

- Search by **email** or **phone** first — name search can miss due to spelling variations
- The person may have been created under a different name spelling
- Check if the person was **merged** — Atlas tracks merged records

### "The cat count looks wrong on a place"

- Cat counts come from multiple sources with different confidence levels
- Clinic-verified alterations (ground truth) take precedence
- You can add observations when completing a request to improve accuracy
- Colony size estimates are separate from cats caught — they represent total estimated cats

### "A request shows the wrong address"

- The address was set when the intake was submitted
- If the address needs correction, update it on the request detail page
- Each address is a distinct place — do not reuse addresses across unrelated locations

### "Duplicate people keep appearing"

- Atlas matches people by **email and phone only**, not by name
- If someone calls with a new phone number and different email, they may appear as a new person
- Report potential duplicates to an admin — they can review and merge via the Data Engine

### "I need to see what happened at an address historically"

- Go to the place detail page (`/places/[id]`)
- The page shows all requests, cats, and activity at that specific address
- Alteration history shows TNR progress over time

---

## 8. Data Concepts

### Places vs Addresses

Every physical location in Atlas is a **place**. Multi-unit complexes have a parent place (the building) with child places (individual units). Data at one unit does not mix with data at another unit.

### Cat Ownership Types

| Type | What It Means |
|------|---------------|
| `unknown_stray` | Stray cat — no apparent owner |
| `community_colony` | Outdoor cat someone feeds |
| `newcomer` | Just showed up recently |
| `neighbors_cat` | Belongs to a neighbor |
| `my_cat` | Caller's own pet |

### Colony Size vs Cats Caught

- **Colony size** = Estimated total cats at a location (from surveys, observations, intake forms)
- **Cats caught** = Cats actually processed through clinic (verified ground truth)
- These numbers are different and that's expected

### Attribution Windows

When cats are linked to a request for TNR counting:

- **Active requests** count cats altered up to 6 months in the future
- **Completed requests** count cats altered up to 3 months after completion
- **Legacy requests** (before May 2025) use a fixed 6-month window

---

## 9. Authentication

### Logging In

Navigate to any Atlas page. If not logged in, you'll be redirected to the login page. Enter your FFSC staff email.

### Sessions

Your session stays active while you're using Atlas. If your session expires, you'll be prompted to log in again.

### Role-Based Access

Navigation menu items are shown based on your staff role. Admin pages are only visible to users with admin privileges.
