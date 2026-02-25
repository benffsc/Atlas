# Atlas Data Reliability Analysis

**Date:** 2026-02-24
**Purpose:** Validate the "30% unreliable" claim and establish data-driven understanding of ClinicHQ person-cat-place relationships.

---

## Executive Summary

**The original "30% unreliable" estimate was too optimistic.**

Actual analysis of 38,739 appointments with cats shows:

| Category | Appointments | % | Assessment |
|----------|-------------|---|------------|
| Reliable (person = cat location) | 11,025 | **28.5%** | Person linked IS where cat lives |
| Uncertain (moderate volume) | 9,690 | **25.0%** | Could be either |
| Unreliable (person ≠ cat location) | 18,024 | **46.5%** | Person brought cat from elsewhere |

**Conclusion:** Only ~28% of ClinicHQ person links reliably indicate where a cat lives. The remaining 72% are either unreliable (46.5%) or uncertain (25%).

---

## Methodology

### Data Sources
- `ops.appointments` - 38,739 appointments with `cat_id IS NOT NULL`
- `ops.clinic_accounts` - Owner account types (resident, address, site_name, organization)
- `sot.person_roles` - Known trapper/volunteer roles
- `sot.person_cat` - Person-cat relationship counts

### Classification Logic

| Category | Definition | Rationale |
|----------|------------|-----------|
| **Clearly not resident** | account_type IN (address, site_name, organization) | Address/location used as owner name |
| **FFSC staff** | Email contains @forgottenfelines.com OR phone is FFSC office | Staff info used as placeholder |
| **Known trapper** | Person has trapper role in person_roles | Trapper brought cat from colony site |
| **High volume caretaker** | Person linked to >15 cats | Colony caretaker, not single-cat owner |
| **Moderate volume** | Person linked to 5-15 cats | Could be multi-cat owner or caretaker |
| **Likely resident owner** | Person linked to <5 cats | Low volume suggests actual ownership |

---

## Detailed Findings

### Finding 1: Account Type Distribution

```
account_type   | appointments | %
---------------+--------------+------
resident       | 32,014       | 82.6%
organization   | 4,345        | 11.2%
site_name      | 1,709        | 4.4%
address        | 1,503        | 3.9%
unknown        | 348          | 0.9%
```

17.4% of appointments use pseudo-profiles (org/site/address) as the "owner" - these clearly don't represent where the cat lives.

### Finding 2: "Resident" Accounts Aren't All Residents

Among the 82.6% marked as "resident" type:

```
person_category         | appointments | %
------------------------+--------------+------
likely_actual_resident  | 17,544       | 55.0%
high_volume_10plus      | 13,888       | 43.5%
known_trapper           | 463          | 1.5%
```

Only 55% of "resident" accounts appear to be actual residents. 43.5% are high-volume (>10 cats), suggesting colony caretakers or trappers rather than pet owners.

### Finding 3: High-Volume Users Dominate

Users with >10 cats linked represent 43.5% of "resident" appointments. These are likely:
- Colony caretakers managing multiple sites
- Trappers bringing cats from various locations
- Foster volunteers processing through many cats

Their contact info does NOT indicate where cats live.

---

## Industry Research Findings

### Animal Shelter Manager (ASM) Data Model

The [ASM database schema](https://sheltermanager.com/repo/asm3_help/databasetables.html) explicitly separates:

| Field | Purpose |
|-------|---------|
| `OriginalOwnerID` | Who surrendered/owned the animal originally |
| `BroughtInByOwnerID` | Who physically delivered the animal |
| `OwnerID` (in movements) | Current owner/adopter |
| `ReturnedByOwnerID` | Who returned the animal (may differ from adopter) |

**Key insight:** Industry best practice separates "who brought the animal" from "who owns/cares for the animal" and "where the animal lives."

### Cat Stats (Neighborhood Cats)

[Cat Stats](https://www.catstats.org/) takes a different approach:

- Tracks **colonies** (locations), not individual cats
- **Caretaker** = person who manages a colony (not owner)
- **Trapper** = person who traps cats at colonies
- No individual cat records - only colony-level data

This colony-centric model sidesteps the person-cat ownership ambiguity by focusing on location.

### Shelter Animals Count Standards

The [Shelter Animals Count](https://www.shelteranimalscount.org/) framework distinguishes:

- **Intake types:** Stray, Owner Surrender, Transfer, RTF (Return to Field)
- **Community Cats:** Cats with caretakers who are NOT legal owners
- **TNR service:** Clinical service, not shelter intake

---

## FFSC Data Model Implications

### Current Problem

FFSC's ClinicHQ data conflates multiple concepts:

| What ClinicHQ Records | What It Actually Means |
|-----------------------|------------------------|
| Owner Name | Could be: resident, trapper, caretaker, site name, org |
| Owner Email/Phone | Contact for the booking, not necessarily where cat lives |
| Owner Address | Sometimes trapping site, not owner's home |

### Proposed Entity Model

Based on industry research, Atlas should separate:

```
┌─────────────────────────────────────────────────────────────────┐
│ APPOINTMENT (Source Record)                                     │
│ - booked_by_account_id → ops.clinic_accounts (WHO BOOKED)      │
│ - trapping_location_id → sot.places (WHERE CAT WAS TRAPPED)    │
│ - cat_id → sot.cats                                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLINIC_ACCOUNT (Booking Entity)                                 │
│ - Original name/email/phone from ClinicHQ                       │
│ - account_type: resident | colony_caretaker | trapper | org    │
│ - resolved_person_id → sot.people (IF identifiable)            │
│ - resolved_place_id → sot.places (IF address-type)             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ PLACES (Ground Truth Locations)                                 │
│ - The MAP shows cats at PLACES                                  │
│ - Derived from Owner Address field (when valid)                 │
│ - Or extracted from address-type account names                  │
│ - cat_place relationships link cats to locations                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ PEOPLE (Identity Layer - ~28% Reliable for Location)           │
│ - Resolved via email/phone (Data Engine)                        │
│ - For communication, NOT for determining cat location           │
│ - person_cat relationships for known owners/adopters            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principle (Revised INV-11)

**ClinicHQ provides CATS + PLACES as ground truth. Person links indicate WHO BOOKED, not WHERE CAT LIVES.**

| Data Type | Source | Ground Truth? | Use Case |
|-----------|--------|---------------|----------|
| Cats | ClinicHQ microchips, procedures | ✅ Yes | Cat identity, TNR tracking |
| Places | ClinicHQ Owner Address field | ✅ Yes | Map visualization, colony tracking |
| Who Booked | ClinicHQ Owner Name/Email | ⚠️ No | Communication, account tracking |
| Who Lives There | Inferred | ❌ ~28% reliable | Should NOT be primary location signal |

---

## Recommendations

### 1. Place-Centric Map Visualization

The map should show cats at **PLACES**, derived from:
- `appointment.inferred_place_id` (from Owner Address field)
- `clinic_account.resolved_place_id` (for address-type accounts)

NOT from `person_id → person_place → place` chain (only 28% reliable).

### 2. Separate "Booked By" from "Lives At"

UI should clearly distinguish:
- **Booked by:** "Elisha Togneri" (who made the appointment)
- **Trapping location:** "2384 Stony Point Rd" (where cat was found)
- **Contact:** michaeltogneri@yahoo.com (for communication)

### 3. Role-Based Account Classification

Extend `clinic_account.account_type` to include:
- `resident` - Low-volume, likely actual pet owner
- `colony_caretaker` - High-volume, manages colony sites
- `trapper` - Known trapper bringing cats from sites
- `organization` - Rescue, shelter, business
- `site_name` - Named trapping location (ranch, winery, etc.)
- `address` - Address used as name

### 4. Confidence Scoring for Location

Add `location_confidence` to cat_place relationships:
- `high` - Direct from appointment.inferred_place_id
- `medium` - From address-type clinic_account
- `low` - Inferred from person_place chain

---

## Sources

- [ASM Database Tables](https://sheltermanager.com/repo/asm3_help/databasetables.html) - Animal Shelter Manager schema
- [Cat Stats](https://www.catstats.org/) - Neighborhood Cats colony tracking
- [Shelter Animals Count](https://www.shelteranimalscount.org/) - Industry data standards
- [ASPCA Community Cats](https://www.aspca.org/helping-people-pets/shelter-intake-and-surrender/closer-look-community-cats) - Caretaker vs owner definitions
- [HumanePro Cat Stats Article](https://humanepro.org/magazine/articles/herding-cat-stats) - TNR database best practices
