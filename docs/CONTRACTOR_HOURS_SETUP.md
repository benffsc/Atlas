# FFSC Contractor Hours — Complete Setup Guide

**Base:** `appB2fWvvNfAPpTeu` (FFSC Contractor Hours)

Tables and fields already created via MCP. This doc covers everything you need to set up in the Airtable UI to make the system work end-to-end.

---

## The Flow (read this first)

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. YOU create a Pay Period                                         │
│     "Apr 1–15, 2026" — Status: Open                                │
│     Automation emails all active contractors: "Period is open"      │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. CONTRACTORS submit entries via their form link                  │
│                                                                     │
│     Vet opens bookmark → picks date → submits                      │
│     (Rate, Quantity=1, Category all auto-filled)                    │
│     They do this each clinic day — takes 30 seconds                │
│                                                                     │
│     Engineer opens bookmark → date, hours, description → submits   │
│     They do this daily or weekly                                    │
│                                                                     │
│     Automation: fills Rate Snapshot, sets Submitted On              │
│     Automation: emails boss "New entry from Dr. Garcia"             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. BOSS opens "Approve Timesheets" view (shared link or Interface)│
│                                                                     │
│     Sees entries GROUPED by contractor:                             │
│                                                                     │
│     ▼ Dr. Garcia  (6 entries, $3,000)                              │
│       Clinic 4/1  ·  1 day  ·  $500                                │
│       Clinic 4/3  ·  1 day  ·  $500                                │
│       Clinic 4/8  ·  1 day  ·  $500                                │
│       ...                                                           │
│     ▼ Ben Diaz  (5 entries, $X,XXX)                                │
│       CDS pipeline  ·  8 hrs  ·  $XXX                              │
│       Entity linking ·  6.5 hrs ·  $XXX                            │
│       ...                                                           │
│                                                                     │
│     Boss reviews each group → select all → Status = "Approved"     │
│     ONE action approves all of a contractor's entries at once       │
│                                                                     │
│     Automation: sets Approved On, emails contractor "approved"      │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. YOU open "Ready to Pay" view                                    │
│                                                                     │
│     Grouped by contractor with subtotals:                           │
│       Dr. Garcia:  $3,000                                           │
│       Ben Diaz:    $X,XXX                                           │
│       ─────────────────────                                         │
│       Period total: $XX,XXX                                         │
│                                                                     │
│     Cut checks / Venmo / Zelle                                      │
│     Select all → Status = "Paid"                                    │
│     Fill Payment Date/Method/Reference on the Pay Period record     │
│     Pay Period Status → "Paid"                                      │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. DONE — full audit trail in "Payment History" view               │
│     Every entry has: who, when, how much, when approved,            │
│     when paid, payment method, reference number                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Housekeeping (do first)

- [ ] Delete "Table 1" (the default Airtable created)
- [ ] Delete test records: "Test Contractor" in Contractors, "Test Contractor — Clinic Day 4/14" in Time Entries

---

## Tables (already created)

| Table | What It Is |
|-------|-----------|
| **Contractors** | Who gets paid. Name, role, rate, schedule, contact. |
| **Time Entries** | Individual work rows. One per clinic day (vets) or per task/day (engineers). The thing contractors submit. |
| **Pay Periods** | Date ranges for grouping + payment tracking. You create these. |

All three are linked: Time Entry → Contractor, Time Entry → Pay Period.

---

## Field Changes (must do manually — MCP can't)

### 1. Time Entries → Status: add "Paid"
Click the Status field → Customize field → Add option:
- **Paid** — color: `blueBright`

Final flow: `Draft` (gray) → `Submitted` (yellow) → `Approved` (green) → `Paid` (blue)

### 2. Time Entries → Total Pay: convert to Formula
Click Total Pay field → Customize field → Change type to **Formula**:
```
IF(Quantity > 0, Quantity * {Rate Snapshot}, {Rate Snapshot})
```
Fallback: if Quantity is blank/0, Total Pay = Rate Snapshot (handles vets who forget to enter "1").

### 3. Pay Periods → add Rollup fields

**Total Payroll** (rollup):
- Linked record field: Time Entries (the auto-created reverse link)
- Field to roll up: Total Pay
- Aggregation: SUM
- Format: currency

**Entry Count** (rollup):
- Same linked field
- Aggregation: COUNTA (count non-empty)

**Submitted Count** (rollup — optional but useful for "is everyone done?"):
- Rollup of Status field
- Aggregation: COUNTA
- (Airtable rollups can't filter by status, but you can see the count vs. expected)

### 4. Contractors → add Rollup field

**Total Earned** (rollup):
- Linked record field: Time Entries
- Field to roll up: Total Pay
- Aggregation: SUM
- Format: currency

---

## Forms (what contractors see)

Create these as **Form views** on the Time Entries table. Each form hides fields the contractor doesn't need and pre-fills what it can.

### Form 1: "Vet — Clinic Day" 🩺

**Who uses it:** Vets. They bookmark the form URL and open it after each clinic day.

| Field | Visible? | Config |
|-------|----------|--------|
| Summary | ✅ | Required. Label: "Entry name (e.g., Dr. Garcia — Clinic 4/14)" |
| Contractor | ✅ | Required. They pick themselves from dropdown. |
| Pay Period | ✅ | Required. Pick current open period. |
| Work Date | ✅ | Required. The clinic day they worked. |
| Quantity | ❌ Hidden | Auto-set to 1 by automation. |
| Category | ❌ Hidden | Auto-set to "Clinic Day Coverage" by automation. |
| Description | ✅ | Optional. Label: "Notes (anything unusual?)" |
| Attachments | ✅ | Optional. |
| Notes | ❌ Hidden | |
| Days Worked | ❌ Hidden | |
| Rate Snapshot | ❌ Hidden | Auto-filled by automation. |
| Total Pay | ❌ Hidden | Formula. |
| Status | ❌ Hidden | Pre-fill: "Submitted" |
| Submitted On | ❌ Hidden | Auto-set by automation. |
| Approved On | ❌ Hidden | |
| Approved By | ❌ Hidden | |

**What the vet sees:** 4 fields. Takes 30 seconds.

**Form confirmation message:** "Submitted! Your clinic day has been logged. You'll get an email when it's approved."

### Form 2: "Engineer — Hours" 💻

**Who uses it:** Engineers. Submit daily or weekly.

| Field | Visible? | Config |
|-------|----------|--------|
| Summary | ✅ | Required. Label: "What you worked on (e.g., Atlas — CDS pipeline)" |
| Contractor | ✅ | Required. |
| Pay Period | ✅ | Required. |
| Work Date | ✅ | Required. |
| Quantity | ✅ | Required. Label: "Hours worked" |
| Category | ✅ | Required. |
| Description | ✅ | Required. Label: "What did you do?" |
| Attachments | ✅ | Optional. |
| Notes | ❌ Hidden | |
| Days Worked | ❌ Hidden | |
| Rate Snapshot | ❌ Hidden | |
| Total Pay | ❌ Hidden | |
| Status | ❌ Hidden | Pre-fill: "Submitted" |
| Submitted On | ❌ Hidden | |
| Approved On | ❌ Hidden | |
| Approved By | ❌ Hidden | |

**What the engineer sees:** 7 fields.

### Form 3: "General — Time Entry" (optional)

For any new role. Shows all relevant fields. No category pre-fill. Status pre-fill: "Submitted".

### Adding a new role's form

1. Add the role to Contractors → Role field (e.g., "Bookkeeper")
2. Add a Category option if needed (e.g., "Bookkeeping")
3. Duplicate the closest existing form
4. Adjust which fields are visible and pre-filled
5. Share the form URL with the new contractor

---

## Views

### Time Entries — the important ones

#### "Approve Timesheets" ⭐ (this is what the boss uses)

**Share this view's link with your boss.**

| Setting | Value |
|---------|-------|
| Filter | Status = "Submitted" |
| Group | By **Contractor** (with subtotals ON) |
| Sort | Work Date ascending (within each group) |
| Fields shown | Summary, Work Date, Quantity, Category, Total Pay, Status |
| Row height | Short |

**How the boss uses it:**
1. Opens the shared link
2. Sees entries grouped by contractor with $ subtotals per group
3. Expands a record if they want details
4. If the group looks right → select all rows in the group → bulk change Status to "Approved"
5. If something looks wrong → click into the record → edit → then approve

#### "Ready to Pay" ⭐ (this is what you use for payroll)

| Setting | Value |
|---------|-------|
| Filter | Status = "Approved" |
| Group | By **Contractor** (subtotals ON) |
| Sort | Work Date ascending |
| Fields shown | Summary, Contractor, Work Date, Quantity, Rate Snapshot, Total Pay, Status |

**How you use it:**
1. Open before running payroll
2. See per-contractor totals
3. Pay each contractor
4. Select all their entries → Status = "Paid"

#### "Payroll Export"

| Setting | Value |
|---------|-------|
| Filter | Status = "Approved" AND Pay Period = [current period] |
| Sort | Contractor asc, Work Date asc |
| Fields | Contractor, Work Date, Quantity, Rate Snapshot, Total Pay, Category |

Download as CSV → hand to bookkeeper.

#### "This Period"

| Setting | Value |
|---------|-------|
| Filter | Pay Period = [current open period] |
| Group | By Contractor |
| Sort | Work Date desc |

See everything submitted for the current period, all statuses.

#### "Payment History"

| Setting | Value |
|---------|-------|
| Filter | Status = "Paid" |
| Group | By Pay Period, then by Contractor |
| Sort | Work Date desc |

Full audit trail. "What did we pay in March?"

#### "All Entries"

Default grid, no filters. Sort by Work Date desc.

### Contractors

| View | Filter |
|------|--------|
| **Active Contractors** | Status = "Active" |
| **All Contractors** | (none) |

### Pay Periods

| View | Filter |
|------|--------|
| **Open Periods** | Status = "Open" |
| **All Periods** | Sort: Period Start desc |

---

## Automations (7 total)

Build these in the **Automations** tab. Each one listed with exact trigger → condition → action.

---

### Automation 1: "Fill Rate + Quantity on Submit"

**What it does:** When a contractor submits via form, auto-fills their rate and sets quantity to 1 for clinic days. This is the most important automation — it makes the forms work.

```
TRIGGER:  When a record is created in "Time Entries"
          (matches on: Status = "Submitted")

ACTION 1: Find records
          Table: Contractors
          Condition: Record ID is in {Contractor} field of trigger record
          (this gets the linked contractor record)

ACTION 2: Update record (the trigger record)
          Rate Snapshot  =  {Rate} from the Contractor found in Action 1
          Submitted On   =  TODAY()

ACTION 3: Conditional group
          IF {Category} = "Clinic Day Coverage"
          THEN: Update record → Quantity = 1
```

**Why:** Rate Snapshot locks in the rate at submission time. If you change a contractor's rate later, old entries keep their original rate. Quantity=1 saves vets from entering it every time.

---

### Automation 2: "Notify Boss on New Submission"

**What it does:** Sends the boss an email when someone submits a time entry.

```
TRIGGER:  When a record is created in "Time Entries"
          (matches on: Status = "Submitted")

ACTION:   Send email
          To:       [boss's email address]
          Subject:  "⏱ New time entry from {Contractor}"
          Body:
            {Contractor} submitted a time entry:

            Summary: {Summary}
            Date: {Work Date}
            Category: {Category}
            Quantity: {Quantity}

            → Review and approve: [link to "Approve Timesheets" view]
```

**Tip:** If the boss gets too many individual emails, replace this with Automation 3 (daily digest) and disable this one.

---

### Automation 3: "Daily Approval Digest" (alternative to #2)

**What it does:** Once a day, sends the boss a summary of everything waiting for approval. Less noisy than per-entry emails.

```
TRIGGER:  At a scheduled time
          Every day at 8:00 AM (or whatever time boss checks email)
          Monday through Friday only

CONDITION: Find records in "Time Entries"
           WHERE Status = "Submitted"
           IF count > 0, continue. Otherwise skip.

ACTION:   Send email
          To:       [boss's email address]
          Subject:  "⏱ {count} time entries need your approval"
          Body:
            You have {count} time entries waiting for approval.

            → Review now: [link to "Approve Timesheets" view]
```

---

### Automation 4: "Set Approved Date + Notify Contractor"

**What it does:** When the boss changes Status to Approved, timestamps it and emails the contractor.

```
TRIGGER:  When a record is updated in "Time Entries"
          Watch field: Status
          Condition: Status = "Approved"

ACTION 1: Update record (the trigger record)
          Approved On  =  TODAY()
          Approved By  =  "Ben Diaz"  (or hardcode boss's name)

ACTION 2: Find records
          Table: Contractors
          Get the linked contractor to find their email

ACTION 3: Send email
          To:       {Email} from Contractor record
          Subject:  "✅ Time entry approved: {Summary}"
          Body:
            Your time entry has been approved:

            {Summary}
            Date: {Work Date}
            Amount: {Total Pay}

            Payment will be processed with the next payroll run.
```

---

### Automation 5: "Submission Reminder (Weekly)"

**What it does:** Reminds contractors to submit their time every week.

```
TRIGGER:  At a scheduled time
          Every Friday at 9:00 AM

ACTION:   Send email
          To:       [list all active contractor emails, or use a group]
          Subject:  "📋 Reminder: Submit your time entries"
          Body:
            This is your weekly reminder to submit time entries
            for any work completed this week.

            Vet clinic day form: [form URL]
            Engineer hours form: [form URL]

            Current pay period: [period name]
```

**Note:** Airtable can't dynamically find "who hasn't submitted." Easiest approach: email everyone, include "if you've already submitted, ignore this." For a smarter version, you'd need a script automation that queries for missing entries.

---

### Automation 6: "New Pay Period — Notify All Contractors"

**What it does:** When you create a new Pay Period, notifies all contractors that it's open.

```
TRIGGER:  When a record is created in "Pay Periods"

ACTION:   Send email
          To:       [all active contractor emails]
          Subject:  "📅 New pay period open: {Period Name}"
          Body:
            A new pay period is open: {Period Name}
            ({Period Start} – {Period End})

            Please submit your time entries:
            Vet form: [form URL]
            Engineer form: [form URL]
```

---

### Automation 7: "Period Closing — Final Reminder"

**What it does:** When you close a pay period, sends a last-call reminder.

```
TRIGGER:  When a record is updated in "Pay Periods"
          Watch field: Status
          Condition: Status = "Closed"

ACTION:   Send email
          To:       [all active contractor emails]
          Subject:  "⚠️ Pay period closing: {Period Name}"
          Body:
            The pay period {Period Name} is closing.

            If you have any outstanding time entries, please
            submit them ASAP. Late submissions may be pushed
            to the next pay period.
```

---

## Interface (optional but recommended for the boss)

If you want a cleaner experience than a shared grid view for your boss, create an **Airtable Interface**.

### Page: "Approve & Pay"

**Element 1: Number — Pending Count**
- Source: Time Entries, filter Status = "Submitted"
- Shows: record count
- Label: "Entries Pending Approval"

**Element 2: Number — Pending Total**
- Source: Time Entries, filter Status = "Submitted"
- Shows: SUM of Total Pay
- Label: "Total Pending"

**Element 3: Record List — Approval Queue**
- Source: Time Entries table
- Filter: Status = "Submitted"
- Group by: Contractor
- Fields: Summary, Work Date, Quantity, Category, Total Pay, Status
- Allow editing Status field (so boss can change to "Approved" inline)

**Element 4: Record List — Ready to Pay**
- Source: Time Entries table
- Filter: Status = "Approved"
- Group by: Contractor
- Shows subtotals per group

**Element 5: Record List — Current Pay Period**
- Source: Pay Periods, filter Status = "Open"
- Shows: Period Name, Total Payroll (rollup), Entry Count (rollup)

---

## Adding New Roles (future-proofing)

The system handles any contractor type — not just vets and engineers.

**To add a new role (e.g., "Bookkeeper", "Trapping Coordinator", "Facility Manager"):**

1. **Contractors table:** Add the new role to the Role select field
2. **Contractors table:** Set their Pay Type (Hourly or Per Clinic Day)
3. **Time Entries table:** Add a Category option if needed (e.g., "Bookkeeping")
4. **Forms:** Duplicate the closest existing form, adjust visible fields and pre-fills
5. **Automations:** No changes needed — they work on any role
6. **Share** the new form URL with the contractor

**To add a new pay type (e.g., "Per Project", "Monthly Retainer"):**

1. Add to Contractors → Pay Type select
2. Adjust the Total Pay formula if the calc is different
3. The form/view structure stays the same

---

## Your Setup Checklist (in order)

### Phase 1: Clean Up (5 min)
- [ ] Delete "Table 1"
- [ ] Delete test records ("Test Contractor", "Test Contractor — Clinic Day 4/14")

### Phase 2: Field Fixes (10 min)
- [ ] Time Entries → Status: add "Paid" option (blue)
- [ ] Time Entries → Total Pay: convert to formula `IF(Quantity > 0, Quantity * {Rate Snapshot}, {Rate Snapshot})`
- [ ] Pay Periods → add "Total Payroll" rollup (SUM of Total Pay from Time Entries)
- [ ] Pay Periods → add "Entry Count" rollup (COUNTA from Time Entries)
- [ ] Contractors → add "Total Earned" rollup (SUM of Total Pay from Time Entries)

### Phase 3: Add Contractors (5 min)
- [ ] Add each contractor: name, role, pay type, rate, email, schedule
- [ ] Set all to Status = "Active"

### Phase 4: Create Forms (15 min)
- [ ] Create "Vet — Clinic Day" form (see spec above)
- [ ] Create "Engineer — Hours" form (see spec above)
- [ ] Test each form: submit a test entry, verify Rate Snapshot gets filled (after automation is set up)
- [ ] Copy form URLs — these are what you send to contractors

### Phase 5: Create Views (15 min)
- [ ] "Approve Timesheets" — the boss view (grouped by Contractor, filter Submitted)
- [ ] "Ready to Pay" — your payroll view (grouped by Contractor, filter Approved)
- [ ] "Payroll Export" — CSV export view (filter Approved + current period)
- [ ] "This Period" — current period overview
- [ ] "Payment History" — audit trail (filter Paid, group by Pay Period)
- [ ] Share "Approve Timesheets" view link with your boss

### Phase 6: Build Automations (30 min)
- [ ] **#1** Fill Rate + Quantity on Submit (CRITICAL — forms don't work without this)
- [ ] **#2** Notify Boss on New Submission (or use #3 digest instead)
- [ ] **#4** Set Approved Date + Notify Contractor
- [ ] **#5** Weekly Submission Reminder
- [ ] **#6** New Pay Period Notification
- [ ] **#7** Period Closing Reminder
- [ ] Test the full flow: submit via form → boss approves → you pay

### Phase 7: Create First Pay Period
- [ ] Create pay period record: "Apr 14–30, 2026" (or your cadence)
- [ ] Send form links to contractors
- [ ] You're live

### Phase 8: Interface Dashboard (optional, 20 min)
- [ ] Create "Approve & Pay" interface page
- [ ] Share interface link with boss (cleaner than grid view)

---

## Examples

### Vet submits a clinic day (30 seconds)

Dr. Garcia opens her bookmarked form link → fills in:
- Summary: "Dr. Garcia — Clinic 4/14"
- Contractor: Dr. Garcia
- Pay Period: Apr 14–30
- Work Date: 4/14/2026
- → Submits

**Automation fills:** Rate Snapshot = $500, Quantity = 1, Category = "Clinic Day Coverage", Submitted On = 4/14

**Boss sees in "Approve Timesheets":**
```
▼ Dr. Garcia  (1 entry, $500)
  Dr. Garcia — Clinic 4/14  ·  4/14  ·  1 day  ·  $500  ·  Submitted
```

### Engineer submits hours

Ben opens his form link → fills in:
- Summary: "Atlas — CDS photo pipeline"
- Contractor: Ben Diaz
- Pay Period: Apr 14–30
- Work Date: 4/14/2026
- Hours: 7.5
- Category: Atlas Development
- Description: "Built evidence_stream_segments table, wrote ingest script"
- → Submits

**Automation fills:** Rate Snapshot = $X/hr, Submitted On = 4/14

### Boss approves a contractor's entries

End of pay period. Boss opens "Approve Timesheets" link:

```
▼ Dr. Garcia  (6 entries, $3,000)
  Clinic 4/14  ·  1  ·  $500
  Clinic 4/16  ·  1  ·  $500
  Clinic 4/21  ·  1  ·  $500
  Clinic 4/23  ·  1  ·  $500
  Clinic 4/28  ·  1  ·  $500
  Clinic 4/30  ·  1  ·  $500

▼ Ben Diaz  (8 entries, $X,XXX)
  Atlas — CDS pipeline    ·  7.5 hrs  ·  $XXX
  Atlas — entity linking   ·  6 hrs    ·  $XXX
  ...
```

Boss clicks the checkbox on Dr. Garcia's group header → selects all 6 → changes Status to "Approved" → done. Same for Ben's group.

### You run payroll

Open "Ready to Pay" view. See grouped totals. Cut checks. Mark all as "Paid". Fill payment details on Pay Period. Close the period.
