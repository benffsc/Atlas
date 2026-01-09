# Airtable Workflows Catalog

> **Purpose**: Single source of truth for all operational workflows currently running in Airtable.
> Any AI (Claude, ChatGPT) reading this repo can understand how FFSC staff actually works day-to-day.
>
> **Last Updated**: 2026-01-04
> **Maintained By**: Ben (Trapping Coordinator)

---

## Table of Contents

1. [Email Batch Staging (Trapper Assignments)](#1-email-batch-staging-trapper-assignments)
2. [Out-of-County Auto Email](#2-out-of-county-auto-email)
3. [Receptionist Dashboard (Appointment Requests)](#3-receptionist-dashboard-appointment-requests)
4. [Appointment Request → Trapping Request Conversion](#4-appointment-request--trapping-request-conversion)
5. [Media Management (Trapper Cats vs Reports)](#5-media-management-trapper-cats-vs-reports)
6. [Email Jobs (Appointment Reminders)](#6-email-jobs-appointment-reminders)
7. [Trapper Pipeline (VolunteerHub → Active Trapper)](#7-trapper-pipeline-volunteerhub--active-trapper)
8. [Foster Pipeline (Contracts → Foster Table)](#8-foster-pipeline-contracts--foster-table)
9. [Trapping Priorities View](#9-trapping-priorities-view)
10. [Kitten Intake Assessment Scoring](#10-kitten-intake-assessment-scoring)

---

## 1. Email Batch Staging (Trapper Assignments)

### Workflow Name
Trapper Assignment Email Batch

### Where staff uses it (table + view names)
- **Trapping Requests** table → Card View (primary working view)
- **Trapper Emails** table → for creating email batches

### Trigger (button/checkbox/record create)
1. **Checkbox**: "Ready to Email" on each Trapping Request
2. **Record Create**: New record in Trapper Emails table
3. **Automation runs** when batch email record is created

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| Generate Email HTML | Airtable Automation | Watches "Ready to Email" checkbox; generates HTML snippet from request fields |
| Collect Batch HTML | Airtable Automation | When Trapper Email record created with type="assignments", collects all HTML snippets from selected requests |
| Send Batch Email | Airtable Automation | Sends compiled HTML to all approved trappers |
| Clear Staging Fields | Airtable Automation | After send: unchecks "Ready to Email", clears "Email HTML", clears "Blurb/Summary" field |

### Inputs (fields read)
- Request: case info, address, cats count, contact info, notes
- Blurb/Summary field (Ben's quick note about the request)
- Trapper Emails: type (message vs assignments), body text

### Outputs (fields written / cleared)
| Field | Action |
|-------|--------|
| Email HTML | Written (generated HTML) → Cleared after send |
| Ready to Email | Checked (selection) → Cleared after send |
| Blurb/Summary | Written (Ben's note) → Cleared after send |

### Emails sent (to whom, from which list)
- **To**: All emails in Trappers table where `Status = "Approved"`
- **From**: Ben's trapping coordinator email
- **Template**:
  - If type="message": "Message from Trapping Coordinator" + body text
  - If type="assignments": Compiled HTML of all selected requests

### Edge cases / failure modes
- If automation fails mid-batch, some requests may have cleared fields but email not sent
- Orphaned HTML snippets if "Ready to Email" unchecked manually before batch
- No retry mechanism for failed email sends
- Large batches (>20 requests) may hit email size limits

### "Must not break" invariants
- Trappers MUST receive the assignments email
- Fields MUST be cleared after successful send (prevent re-send)
- Blurb field allows Ben to customize messaging without editing permanent case info

### Candidate future home
- **Short term**: Keep in Airtable (critical path, well-understood)
- **Medium term**: Cockpit UI could stage selections, but Airtable sends
- **Long term**: Cockpit + DB job for email generation; external email service (SendGrid/Postmark)

---

## 2. Out-of-County Auto Email

### Workflow Name
Out-of-County Rejection Email

### Where staff uses it (table + view names)
- **Appointment Requests** table

### Trigger (button/checkbox/record create)
- **Checkbox**: "Out of County Email" on Appointment Request record

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| Send Out-of-County Email | Airtable Automation | Watches checkbox; sends template email to submitter |

### Inputs (fields read)
- Email (from appointment request submission)
- (Template is static, no dynamic fields beyond recipient)

### Outputs (fields written / cleared)
- None (checkbox remains checked as a record of action taken)

### Emails sent (to whom, from which list)
- **To**: Email address in the Appointment Request record
- **From**: FFSC email
- **Template**: "We cannot help outside Sonoma County at this time" + resource links

### Edge cases / failure modes
- If email field is empty/invalid, automation may fail silently
- No confirmation that email was delivered
- Checkbox can be clicked multiple times (no guard against duplicate sends)

### "Must not break" invariants
- Submitter must receive the rejection email with resources
- Receptionist must be able to quickly identify and process out-of-county requests

### Candidate future home
- **Keep in Airtable**: Simple, working, low volume
- **Optional**: Cockpit could surface "likely out-of-county" flag based on address/zip

---

## 3. Receptionist Dashboard (Appointment Requests)

### Workflow Name
Receptionist Appointment Request Workflow

### Where staff uses it (table + view names)
- **Appointment Requests** table → Card Gallery View
- Sorted by: Status, then Date
- Shows: All incoming requests

### Trigger (button/checkbox/record create)
- **Manual status changes** by receptionist:
  - New → Contacted
  - Contacted → Booked
  - Booked/Contacted → Closed

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| (None currently) | - | Status changes are manual; no automations triggered |

### Inputs (fields read)
- All submission fields (name, email, phone, address, cats count, etc.)
- Status field
- Date submitted

### Outputs (fields written / cleared)
- Status field (updated manually by receptionist)
- Notes (optional, added by receptionist)

### Emails sent (to whom, from which list)
- None from this workflow (see Email Jobs for appointment reminders)

### Edge cases / failure modes
- Requests can get "lost" if not processed promptly
- No aging/staleness indicator
- No automatic escalation for old uncontacted requests

### "Must not break" invariants
- **Receptionist MUST see all incoming appointment requests**
- Card gallery view is her primary interface
- Status progression must remain intuitive (New → Contacted → Booked → Closed)

### Candidate future home
- **Airtable stays primary** for receptionist
- **Cockpit /ops page**: Mirror view for coordinator visibility
- **Enhancement**: Add staleness warnings, auto-assign based on zip code

---

## 4. Appointment Request → Trapping Request Conversion

### Workflow Name
Appointment Request to Trapping Request Conversion

### Where staff uses it (table + view names)
- **Appointment Requests** table (source)
- **Trapping Requests** table (destination, SoT)

### Trigger (button/checkbox/record create)
- **Manual**: Ben reviews appointment request, decides if it needs trapping follow-up
- Creates new Trapping Request record manually, linking/copying relevant info

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| (None currently) | - | Conversion is fully manual |

### Inputs (fields read)
From Appointment Request:
- Contact info (name, email, phone)
- Address
- Cats count estimate
- Notes from receptionist

### Outputs (fields written / cleared)
New Trapping Request record with:
- Linked or copied contact info
- Address/location
- Initial status (New)
- Source reference (optional link to original Appt Request)

### Emails sent (to whom, from which list)
- None

### Edge cases / failure modes
- Data may be copied inconsistently (no validation)
- Original Appt Request status may not reflect conversion happened
- No automatic linking between records

### "Must not break" invariants
- **Trapping Requests is the SoT** for all trapping work
- Appointment Requests that become Trapping Requests should be traceable

### Candidate future home
- **Short term**: Keep manual (low volume, needs human judgment)
- **Medium term**: Cockpit wizard with "Convert to Trapping Request" action
- **Long term**: Single unified request intake with type flag

---

## 5. Media Management (Trapper Cats vs Reports)

### Workflow Name
Media Upload and Linking

### Where staff uses it (table + view names)
- **Trapper Cats** table (specific cat photos)
- **Trapper Reports** table (general area/location photos)
- Linked from: **Trapping Requests**, **Places**

### Trigger (button/checkbox/record create)
- **Manual upload**: Ben receives photos from trappers, uploads to appropriate table
- Decision point: Is this a specific cat → Trapper Cats, or general area → Trapper Reports

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| (None currently) | - | All linking is manual |

### Inputs (fields read)
- Photo file
- Trapper who sent it (optional)
- Request/Place context (from message)

### Outputs (fields written / cleared)
- New media record with photo attachment
- Link to Request (if identifiable)
- Link to Place (if location-focused)
- Optional: Microchip number (if known, rare)

### Emails sent (to whom, from which list)
- None

### Edge cases / failure modes
- **~80% of cat photos are NOT linkable** to specific microchip
- Only ~2% of cats have confirmed microchip link
- Photos from long-term stays more likely to be linked
- General "area photos" may not have clear request association
- No OCR or auto-tagging

### "Must not break" invariants
- Photos must be preserved and accessible
- Trapper Cats vs Trapper Reports distinction is meaningful
- Linking after-the-fact must remain possible

### Candidate future home
- **Short term**: Keep in Airtable (attachment handling works)
- **Medium term**: Cockpit upload with auto-suggest (person/place/request)
- **Long term**: DB media table with S3/Cloudflare R2 storage, AI-assisted tagging

---

## 6. Email Jobs (Appointment Reminders)

### Workflow Name
Appointment Reminder Email Jobs

### Where staff uses it (table + view names)
- **Email Jobs** table

### Trigger (button/checkbox/record create)
- **Record create**: Ben creates new Email Job with parameters
- Automation sends email based on template selection

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| Send Reminder Email | Airtable Automation | Reads job parameters, selects template, sends email |

### Inputs (fields read)
| Field | Description |
|-------|-------------|
| Email | Recipient email address |
| Price | Appointment cost |
| Cats Count | Number of cats |
| Appointment Date | Scheduled date |
| Language | English or Spanish |
| Type | Single or Multiple cats |

### Outputs (fields written / cleared)
- Sent timestamp (optional)
- Status (Sent/Failed)

### Emails sent (to whom, from which list)
- **To**: Email specified in job record
- **Templates** (4 total):
  - English + Single Cat
  - English + Multiple Cats
  - Spanish + Single Cat
  - Spanish + Multiple Cats

### Edge cases / failure modes
- No validation of email format
- No link to Appointment Request record (standalone job)
- Template selection is manual (could mismatch language/type)

### "Must not break" invariants
- Correct template must be selected based on Language + Type
- Email must include: price, cats count, appointment date

### Candidate future home
- **Short term**: Keep in Airtable
- **Medium term**: Link to Appointment Requests, auto-suggest template
- **Long term**: Integrated scheduling with automatic reminders (24h before, etc.)

---

## 7. Trapper Pipeline (VolunteerHub → Active Trapper)

### Workflow Name
Volunteer → Potential Trapper → Active Trapper Pipeline

### Where staff uses it (table + view names)
- **VolunteerHub** (external system)
- **Potential Trappers** table (staging)
- **Trappers** table (active volunteers)

### Trigger (button/checkbox/record create)
| Step | Trigger |
|------|---------|
| VolunteerHub signup | Zapier watches for "Trapper" interest selection |
| Orientation complete | Checkbox in Potential Trappers |
| Contract sent | Checkbox in Potential Trappers |
| Contract submitted | JotForm submission creates Trapper record |

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| Import Potential Trapper | Zapier | VolunteerHub → Potential Trappers table (filters by "Trapper" interest) |
| Send Interest Follow-up | Airtable Automation | On "Orientation Completed" checkbox → "Still interested?" email |
| Send Contract Link | Airtable Automation | On "Send Contract" checkbox → Trapper contract email |
| Create Trapper from Contract | JotForm/Airtable | Contract submission → new Trapper record |

### Inputs (fields read)
- VolunteerHub: Name, email, phone, interests
- Potential Trappers: orientation status, contract sent status
- JotForm contract: all trapper details

### Outputs (fields written / cleared)
- Potential Trappers record created (from VolunteerHub)
- Trappers record created (from contract submission)
- Email sent flags

### Emails sent (to whom, from which list)
| Email | Trigger | To |
|-------|---------|-----|
| "Still interested in trapping?" | Orientation Completed checkbox | Potential trapper's email |
| Trapper Contract Link | Send Contract checkbox | Potential trapper's email |

### Edge cases / failure modes
- **Trappers table NOT linked to Clients/People table** (Airtable 1-table-per-link limitation)
- No deduplication if same person submits multiple times
- Gap between "contract sent" and "contract submitted" is manual tracking
- Orientation completion is self-reported

### "Must not break" invariants
- All VolunteerHub signups with "Trapper" interest must appear in Potential Trappers
- Contract email must be sent when checkbox is clicked
- Approved trappers must appear in Trappers table for email batch

### Candidate future home
- **Short term**: Keep current flow (works, understood)
- **Medium term**: Cockpit pipeline view for visibility
- **Long term**: Unified People table with trapper role; streamlined onboarding

---

## 8. Foster Pipeline (Contracts → Foster Table)

### Workflow Name
Foster Contract to Foster Record Pipeline

### Where staff uses it (table + view names)
- **Foster Contracts** table (regular foster intake)
- **Forever Foster Contracts** table (long-term foster intake)
- **Fosters** table (active/inactive fosters)
- **Surrender Forms** (also visible in Foster tab)

### Trigger (button/checkbox/record create)
- **JotForm submission**: Creates record in Foster Contracts or Forever Foster Contracts
- **Automation**: Processes both tables, dedupes, creates/updates Foster record

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| Process Foster Contract | Airtable Automation | Watches Foster Contracts, dedupes against Fosters, creates/updates |
| Process Forever Foster Contract | Airtable Automation | Watches Forever Foster Contracts, dedupes against Fosters, creates/updates |
| (Dedupe logic) | Airtable Automation | Matches by email/phone, prevents duplicate Foster records |

### Inputs (fields read)
From contracts:
- Name, email, phone
- Address
- Foster preferences
- Contract type (regular vs forever)

### Outputs (fields written / cleared)
- Foster record created (if new) or updated (if existing)
- Status: Active (default), manually changed to Inactive by foster coordinator

### Emails sent (to whom, from which list)
- None from this workflow (contract confirmation handled by JotForm)

### Edge cases / failure modes
- Dedupe may fail on slight name/email variations
- Foster coordinator manually manages Active/Inactive status (no automation)
- No Foster is ever created except through contract submission
- Surrender forms appear in same tab but are separate workflow

### "Must not break" invariants
- Every contract submission must result in a Foster record
- Deduplication must prevent duplicate Fosters for same person
- Foster coordinator must be able to change status manually

### Candidate future home
- **Short term**: Keep in Airtable (Foster team's workflow)
- **Medium term**: Cockpit visibility into foster pipeline for coordination
- **Long term**: Unified People table with foster role

---

## 9. Trapping Priorities View

### Workflow Name
Trapping Priorities Triage View

### Where staff uses it (table + view names)
- **Trapping Requests** table → "Trapping Priorities" filtered view
- Filter: Status = "Considering" AND has Kitten Assessment

### Trigger (button/checkbox/record create)
- **Manual**: Ben marks request as "Considering"
- **Manual**: Ben creates Kitten Assessment for the request
- Both conditions must be true to appear in view

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| (None) | - | View is filter-based, no automations |

### Inputs (fields read)
- Status (must be "Considering")
- Linked Kitten Assessment (must exist)
- Auto-priority (from assessment scoring)
- Manual priority (Ben's override)
- Internal notes
- Foster notes
- Consideration reason
- Consideration status

### Outputs (fields written / cleared)
- Priority (manual selection by Ben)
- Consideration status changes

### Emails sent (to whom, from which list)
- None

### Edge cases / failure modes
- **FRAGILE**: View depends on Ben manually:
  1. Setting status to "Considering"
  2. Creating a Kitten Assessment
  3. Manually setting priority
- **Staleness risk**: Old cases stay visible if not manually removed
- **Missing cases**: New urgent cases don't appear until assessment is made
- Google Maps image in card view helps visualization but may go stale

### "Must not break" invariants
- View must show requests marked "Considering" with assessments
- Ben must be able to manually prioritize
- Internal notes and foster notes must be visible

### Candidate future home
- **This view is a prime candidate for Cockpit /focus improvement**
- Deterministic staleness warnings
- Auto-suggest priority based on data signals
- Map pins showing all priority cases

---

## 10. Kitten Intake Assessment Scoring

### Workflow Name
Kitten Intake Assessment Auto-Priority

### Where staff uses it (table + view names)
- **Kitten Intake Assessments** table
- Linked from Trapping Requests

### Trigger (button/checkbox/record create)
- **Record create**: New assessment created for a request
- **Formula field**: Calculates recommendation based on scores

### Automations/Zaps involved
| Name | Platform | Brief Description |
|------|----------|-------------------|
| (Formula only) | Airtable Formula | Calculates recommendation string |

### Inputs (fields read)
| Field | Description |
|-------|-------------|
| Intake Score | 0-10, assesses urgency/need |
| Capacity Score | 0-10, assesses foster/space availability |

### Outputs (fields written / cleared)
| Field | Value |
|-------|-------|
| Recommendation | Calculated string (see formula below) |

### Current Formula
```
IF(
  OR({Intake Score}&""="", {Capacity Score}&""=""),
  "Insufficient info",
  IF(
    {Intake Score}>=8,
    IF({Capacity Score}>=5, "Intake immediately",
      IF({Capacity Score}>=3, "Intake if space is secured",
        "Emergency only; escalate case")),
    IF(
      {Intake Score}>=6,
      IF({Capacity Score}>=3, "Prioritize, intake as soon as possible",
        "Redirect if friendly, TNR if not (after medical if necessary for sick cat)"),
      IF(
        {Intake Score}>=3,
        IF({Capacity Score}>=5, "Intake if other options fail or space is confirmed",
          "Redirect if friendly, TNR if not (after medical if necessary for sick cat)"),
        "Redirect if friendly, TNR if not (after medical if necessary for sick cat)"
      )
    )
  )
)
```

### Emails sent (to whom, from which list)
- None

### Edge cases / failure modes
- **Known limitation**: Formula is too simplistic for TNR reality
- Does not account for:
  - Kitten age (nursing vs weaned)
  - Mother present (splitting litter risks)
  - Season/weather urgency
  - Geographic clustering (nearby requests)
  - Reporter reliability/history
  - Access constraints
- Manual priority override is always needed

### "Must not break" invariants
- Formula must not error on missing inputs
- Manual priority must always be available as override

### Candidate future home
- **Needs redesign** in Cockpit:
  - Multi-factor scoring with weights
  - Integration with Reality Check panel
  - Historical data for calibration
  - Visual score breakdown (not just recommendation string)

---

## Summary: Workflow Complexity Map

| Workflow | Automations | Zaps | Critical? | Cockpit Candidate? |
|----------|-------------|------|-----------|-------------------|
| Email Batch Staging | 4 | 0 | HIGH | Long-term |
| Out-of-County Email | 1 | 0 | Medium | Keep Airtable |
| Receptionist Dashboard | 0 | 0 | HIGH | Mirror only |
| Appt → Trapping Conversion | 0 | 0 | Medium | Wizard |
| Media Management | 0 | 0 | Medium | Upload wizard |
| Email Jobs | 1 | 0 | Medium | Keep Airtable |
| Trapper Pipeline | 2 | 1 | HIGH | Pipeline view |
| Foster Pipeline | 2 | 0 | HIGH | Pipeline view |
| Trapping Priorities | 0 | 0 | HIGH | /focus enhancement |
| Kitten Assessment | 0 | 0 | Medium | Redesign needed |

---

## Appendix: Field Dependencies for Automations

### Email Batch Staging - Field Touch Points
```
Trapping Requests:
  - Ready to Email (checkbox) → triggers HTML generation
  - Email HTML (long text) → written by automation, cleared after send
  - Blurb/Summary (text) → user-written, cleared after send
  - [Case info fields] → read for HTML generation

Trapper Emails:
  - Type (single select: message/assignments) → determines email format
  - Body (long text) → for message type
  - [Compiled HTML] → written for assignments type

Trappers:
  - Status = "Approved" → determines recipient list
  - Email → recipient address
```

### Trapper Pipeline - Field Touch Points
```
Potential Trappers:
  - Orientation Completed (checkbox) → triggers follow-up email
  - Send Contract (checkbox) → triggers contract email
  - Email → recipient for both emails
  - Source: VolunteerHub interest flag

Trappers:
  - Created from: JotForm contract submission
  - Status → for email batch recipient filtering
```

---

*This document should be updated whenever workflows change. It is the authoritative source for any AI-assisted development or migration planning.*
