# Jotform → Airtable → Atlas Mapping Guide

This document describes how to map Jotform fields to the Airtable "Standardized Intake" table in the Atlas Sync base.

## Overview

The data flow is:
1. **Jotform** collects intake submissions with spam filtering and audit trail
2. **Airtable** (Atlas Sync base) receives Jotform data via Zapier/integrations
3. **Atlas** syncs from Airtable every 30 minutes via Vercel cron

## Airtable Base Info

- **Base Name**: Atlas Sync
- **Base ID**: `appwFuRddph1krmcd`
- **Table Name**: Standardized Intake

## Field Mappings

### Contact Information (Required)

| Jotform Field | Airtable Field | Type | Required | Notes |
|---------------|----------------|------|----------|-------|
| First Name | `First Name` | Single Line Text | Yes | |
| Last Name | `Last Name` | Single Line Text | Yes | |
| Email | `Email` | Email | Yes* | *Need email OR phone |
| Phone | `Phone` | Phone Number | Yes* | Format: (xxx) xxx-xxxx |
| Your Address | `Requester Address` | Single Line Text | No | Requester's home address |
| Your City | `Requester City` | Single Line Text | No | |
| Your ZIP | `Requester ZIP` | Single Line Text | No | 5-digit ZIP |

### Third-Party Report

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Reporting for someone else? | `Is Third Party Report` | Checkbox | |
| Your relationship | `Third Party Relationship` | Single Select | Options: volunteer, neighbor, family_member, concerned_citizen, rescue_worker, other |
| Property Owner Name | `Property Owner Name` | Single Line Text | |
| Property Owner Phone | `Property Owner Phone` | Phone Number | |
| Property Owner Email | `Property Owner Email` | Email | |

### Cat Location (Required)

| Jotform Field | Airtable Field | Type | Required | Notes |
|---------------|----------------|------|----------|-------|
| Cat Address | `Cats Address` | Single Line Text | Yes | Where cats are located |
| Cat City | `Cats City` | Single Line Text | No | |
| Cat ZIP | `Cats ZIP` | Single Line Text | No | |
| County | `County` | Single Select | No | Options: Sonoma, Marin, Napa, Mendocino, Lake, other |
| Address Notes | `Address Notes` | Long Text | No | For weird addresses |

### Address Validation Tips

For addresses that don't fit standard formats:
- Use `Address Notes` for unit numbers, gate codes, landmarks
- Regex for US ZIP: `^\d{5}(-\d{4})?$`
- Accept partial addresses but flag for review
- Don't reject - capture in `Address Notes` and set `Needs Review`

### Cat Information

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Cat type | `Ownership Status` | Single Select | Options: unknown_stray, community_colony, my_cat, neighbors_cat, unsure |
| How many cats? | `Cat Count Estimate` | Number | Integer |
| If unsure | `Cat Count Text` | Single Line Text | "3-5", "several", etc. |
| Most seen at once | `Peak Count` | Number | |
| Eartipped cats observed | `Eartip Count Observed` | Number | Already fixed cats |
| Fixed status | `Fixed Status` | Single Select | Options: none_fixed, some_fixed, most_fixed, all_fixed, unknown |
| How long aware | `Awareness Duration` | Single Select | Options: just_started, few_weeks, few_months, over_a_year |

### Kitten Information

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Are there kittens? | `Has Kittens` | Checkbox | |
| How many kittens? | `Kitten Count` | Number | |
| Kitten age | `Kitten Age Estimate` | Single Select | Options: newborn, eyes_open, weaned, unknown |
| Age in weeks | `Kitten Age Weeks` | Number | If known |
| Mixed ages? | `Kitten Mixed Ages` | Checkbox | |
| Mixed ages desc | `Kitten Mixed Ages Description` | Long Text | |
| Kitten behavior | `Kitten Behavior` | Single Select | Options: friendly, shy, feral, unknown |
| Contained? | `Kitten Contained` | Single Select | Options: yes_indoors, yes_outdoors, no, unknown |
| Mom present? | `Mom Present` | Single Line Text | yes/no/unknown |
| Mom fixed? | `Mom Fixed` | Single Line Text | yes/no/unknown |
| Can bring kittens in? | `Can Bring In` | Single Line Text | yes/no/maybe |
| Kitten notes | `Kitten Notes` | Long Text | |

### Feeding Behavior

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Do you feed? | `Feeds Cat` | Checkbox | |
| How often? | `Feeding Frequency` | Single Select | Options: daily, few_times_week, occasionally, rarely |
| How long feeding? | `Feeding Duration` | Single Select | Options: just_started, few_weeks, few_months, over_a_year |
| Comes inside? | `Cat Comes Inside` | Single Select | Options: yes_regularly, sometimes, never |

### Situation

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Emergency? | `Is Emergency` | Checkbox | Triggers emergency popup |
| Emergency acknowledged | `Emergency Acknowledged` | Checkbox | Must acknowledge not 24hr ER |
| Medical concerns? | `Has Medical Concerns` | Checkbox | |
| Medical description | `Medical Description` | Long Text | |
| Cats being fed? | `Cats Being Fed` | Checkbox | |
| Who feeds? | `Feeder Info` | Single Line Text | |
| Property access? | `Has Property Access` | Checkbox | |
| Access notes | `Access Notes` | Long Text | Gate codes, etc. |
| Property owner? | `Is Property Owner` | Checkbox | |
| Situation | `Situation Description` | Long Text | |
| How did you hear? | `Referral Source` | Single Select | Options: website, facebook, word_of_mouth, vet_referral, returning_client, other |

### Attachments

| Jotform Field | Airtable Field | Type | Notes |
|---------------|----------------|------|-------|
| Photos | `Photos` | Attachments | Multiple allowed |

### Source Metadata (Auto-populated)

| Field | Airtable Field | Type | Notes |
|-------|----------------|------|-------|
| Submission time | `Submitted At` | DateTime | ISO format |
| Form type | `Source` | Single Select | jotform_website, jotform_clinic_survey, jotform_trapping, manual_entry, legacy_import |
| Jotform ID | `Jotform Submission ID` | Single Line Text | Jotform's unique ID |
| Spam score | `Spam Score` | Number | From Jotform |
| IP Address | `IP Address` | Single Line Text | For audit |
| User Agent | `User Agent` | Single Line Text | For audit |

### Sync Status (Atlas-managed)

| Field | Type | Notes |
|-------|------|-------|
| `Sync Status` | Single Select | pending, synced, error, review_needed |
| `Atlas Submission ID` | Single Line Text | UUID from Atlas |
| `Atlas Person ID` | Single Line Text | Matched person |
| `Atlas Place ID` | Single Line Text | Matched place |
| `Last Synced At` | DateTime | |
| `Sync Error` | Long Text | Error message if failed |

### Validation Flags (Atlas-managed)

| Field | Type | Notes |
|-------|------|-------|
| `Phone Valid` | Checkbox | After normalization |
| `Email Valid` | Checkbox | Format check |
| `Address Geocoded` | Checkbox | Google geocode success |
| `Geocode Confidence` | Single Line Text | exact, approximate, city, failed |
| `Needs Review` | Checkbox | Flag for manual review |
| `Review Notes` | Long Text | Why needs review |

## Validation Rules

### Phone Numbers

Accept flexible input but normalize in Atlas:
- `(707) 555-1234` → `+17075551234`
- `707.555.1234` → `+17075551234`
- `7075551234` → `+17075551234`

Don't reject on format - Atlas normalizes via `trapper.norm_phone_us()`.

### Email

Standard email regex is fine:
```
^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
```

### ZIP Codes

Accept 5-digit or ZIP+4:
```
^\d{5}(-\d{4})?$
```

### Addresses

**DO NOT** over-regex addresses. Sonoma County has many weird addresses:
- Rural routes: "4521 Pepper Rd" (no city)
- Apartment complexes: "2001 Piner Rd #178"
- Businesses: "Whole Foods parking lot, Sebastopol"

If address doesn't validate:
1. Set `Address Notes` with the raw input
2. Set `Needs Review` = true
3. Let Atlas geocode - Google handles most cases

## Jotform Integration Setup

### Using Zapier

1. Create Zap: Jotform → Airtable
2. Trigger: New Submission in Jotform
3. Action: Create Record in Airtable
4. Map fields per table above
5. Set `Sync Status` = "pending"
6. Set `Source` = "jotform_website" (or appropriate)

### Direct Integration

Jotform has native Airtable integration:
1. In Jotform, Settings → Integrations → Airtable
2. Connect to Atlas Sync base
3. Select Standardized Intake table
4. Map fields per table above

## Troubleshooting

### Record Not Syncing

1. Check `Sync Status` - should be "pending"
2. Check `Sync Error` for details
3. Verify required fields: Email/Phone, Cats Address
4. Check Atlas cron logs: `/api/cron/airtable-sync`

### Duplicate Prevention

Atlas uses `source_record_id` for deduplication:
- Format: `airtable:{record_id}`
- Re-syncing updates existing record instead of creating duplicate

### Manual Sync Trigger

```bash
curl -X POST https://atlas.ffsc.org/api/cron/airtable-sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Environment Variables

For Vercel deployment:
- `AIRTABLE_PAT`: Airtable Personal Access Token
- `CRON_SECRET`: Optional secret for manual sync triggers
- `DATABASE_URL`: PostgreSQL connection string
