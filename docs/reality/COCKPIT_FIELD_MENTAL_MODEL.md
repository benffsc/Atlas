# Atlas Field Mental Model

*For field coordinators and staff using Project Atlas.*

---

## Overview: The Four Core Entities

### 1. Places
- Physical locations where TNR work happens
- Examples: apartment complexes, parks, business lots, trail segments
- May have fuzzy boundaries ("behind the barn", "Joe Rodota Trail")
- One place can have multiple addresses; one address can host multiple places

### 2. People
- Anyone involved in a request: reporters, feeders, property owners, trappers
- One person may appear in multiple systems (Airtable contact, ClinicHQ owner)
- Phone and email are the primary matching keys
- **ClinicHQ owners** are historical records from clinic visits, not Airtable contacts

### 3. Requests
- The work order: "Help us with cats at this location"
- Status lifecycle: new -> in_progress -> active -> paused/closed
- One request typically has 2-5 appointments
- Can be Person-based (someone called) or Place-based (known location)

### 4. Appointments
- ClinicHQ scheduled slots for spay/neuter
- Linked to requests by address + contact (fuzzy match)
- Clinic days: Monday + Wednesday (TNR), Thursday (tame cats)

---

## Data Architecture: Source-of-Truth (SoT) Layer

Atlas uses a **SoT layer** to present unified entities from multiple source systems without destructive merges.

### Principle: Sources Stay Siloed
- **Airtable**: Primary for requests, contacts, and operational state
- **ClinicHQ**: Primary for appointments and historical clinic data
- **JotForm**: Appointment request submissions
- **Atlas DB**: Canonical entities (people, places, addresses) with links to sources

### How Unification Works

Instead of merging records, the SoT layer:
1. **Links** source records to canonical entities (person_source_link, cat_source_link)
2. **Rolls up** data via views (v_people_sot, v_places_sot, v_search_sot_unified)
3. **Groups by canonical keys** (location_key, person_id) instead of string matching

### Naming: request_parties vs request_people

The database table is `request_parties` because one request can have multiple people in different roles:
- **reporter**: The person who reported the cats
- **feeder**: The person feeding the colony
- **ffsc_trapper**: FFSC staff trapper assigned
- **community_trapper**: Volunteer trapper
- **client_contact**: Primary contact for the request
- **transport**: Person handling transport

The view `v_request_people_sot` rolls this up into a simple "who's on this request" answer with flags like `has_trapper`, `has_contact`, etc.

This means:
- "123 Main St" and "123 Main Street" link to the same canonical address
- Multiple people at one address appear grouped, not as duplicates
- ClinicHQ history is visible alongside Airtable requests

### Labels in the UI

| Badge | Meaning |
|-------|---------|
| `SOURCE: ClinicHQ` | Data from clinic system, not Airtable |
| `Previously seen at ClinicHQ` | Historical record from past visits |
| `ClinicHQ Record` | Owner profile from clinic data |
| `Not Assigned` | No trapper assigned (action: assign in Airtable) |

---

## Data Sources: Where It Comes From

### Airtable (Primary Operations)
- Trapping requests (the main work queue)
- Contact information
- Notes, tags, status updates
- **Sync frequency**: Daily CSV export or API

### ClinicHQ (Clinic System)
- Scheduled appointments
- Historical appointments (272K+ records)
- Owner/cat information from clinic visits
- **Sync frequency**: Manual XLSX upload

### Atlas Labels

When viewing data in Atlas, look for source indicators:

| Badge | Meaning |
|-------|---------|
| `SOURCE: ClinicHQ` | Data from clinic system, not Airtable |
| `Previously seen at ClinicHQ` | Historical record from past visits |
| `ClinicHQ Record` | Owner profile from clinic data |

---

## Key Pages

### /requests
- Main work queue (Airtable requests)
- Toggle: Cards view (visual) or Table view (dense)
- Filter by status, include/exclude archived
- Click any card to see full details

### /history
- Search ClinicHQ historical records
- Find by microchip, owner name, animal name, appointment number
- Owner profiles show all past visits

### /week
- Weekly operations dashboard
- Clinic capacity by bucket (Coordinator, Foster, Relo, Other)
- Reserved holds vs actual appointments

### /new-request
- Create new trapping request
- Step 1: Person or Place?
- Step 2: Search for existing entities (avoid duplicates)
- Step 3: Fill Reality Contract form
- Step 4: Review and copy template for Airtable

### /focus
- Priority triage view
- Requests needing immediate attention
- Reality Check panel with next steps

---

## Workflow: Opening a New Request

### Step 1: Choose Type
- **PERSON**: Someone contacted us about cats (phone, email, form)
- **PLACE**: Known location needing TNR (park, business, etc.)

### Step 2: Search for Duplicates
Search results are **grouped by location** to help spot duplicates:
- "123 Main St - 2 requests, 1 person" means there's existing activity
- Expand groups to see individual entities
- Select an existing entity to link, or skip to create new

### Step 3: Fill the Reality Contract
Required fields:
- Address (where are the cats?)
- Contact info (who can grant access?)

Important fields:
- Colony condition (healthy, concerned, emergency)
- Cat counts (adults, kittens)
- Kittens present? (urgent indicator)
- Cats at risk? (safety flag)
- Access notes (gate codes, best times)

### Step 4: Review & Submit
- Check the preview
- **Copy Template** to paste into Airtable
- Or **Create in Airtable** if write pilot is enabled

---

## Understanding Data Issues

When you see data issues on a request, they mean:

| Issue | What It Means | What To Do |
|-------|---------------|------------|
| No coordinates | Can't show on map | Verify address in Google Maps |
| Unverified address | Address format may be incomplete | Check for missing city/zip |
| No contact info | No phone or email on file | Collect during next contact |
| No trapper assigned | Active request, nobody working it | Find available trapper |

---

## Reading the Capacity Table (/week)

| Column | Meaning |
|--------|---------|
| Reserved holds | Placeholder appointments for budgeting |
| ClinicHQ appts | Actual scheduled appointments |
| Holds remaining | How much capacity is left |
| Over holds by | Overbooked beyond placeholder count |

Buckets:
- **Coordinator**: Requests assigned to trapping coordinator
- **Foster**: Foster program appointments
- **Relo**: Relocation cases
- **Other**: Everything else

---

## Tips for Field Staff

1. **Search before creating** - Always check if request/person exists
2. **Note the source** - ClinicHQ data shows past clinic visits, not current Airtable status
3. **Copy templates** - Until write pilot is stable, copy and paste into Airtable
4. **Check coordinates** - If map links don't work, the address needs geocoding
5. **Reality Check** - Use the checklist on request detail pages

---

*Last updated: 2026-01-04*
