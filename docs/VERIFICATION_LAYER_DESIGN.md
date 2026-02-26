# Atlas Verification Layer Design

**Created:** 2026-02-25
**Status:** Design Ready for Review

---

## Problem Statement

Atlas has two types of data:
1. **Source Data** - What we KNOW is true (ClinicHQ appointments, ShelterLuv outcomes, etc.)
2. **Inferred Data** - Automated labels that may be wrong (e.g., "resident" from booking address)

Currently, all person-place relationships are labeled "resident" but this is **automated inference**, not verified truth. The person who booked an appointment may be:
- The actual resident
- A neighbor calling on behalf of someone
- A trapper working a site
- A family member (referrer ≠ resident)
- Staff booking for a client

We need a clean architecture that separates truth from inference and allows staff to verify/enrich data over time.

---

## Layer 1: Source Data (GROUND TRUTH)

These are the **only** sources we trust without verification:

| Source System | What It Proves | What It Does NOT Prove |
|---------------|----------------|------------------------|
| **ClinicHQ** | Cat was at this address on this date | Person lives at address |
| **ClinicHQ** | Person X is a contact for this cat | Person X is the caretaker |
| **ShelterLuv** | Cat adopted/fostered to person Y | Person still has cat |
| **ShelterLuv** | Foster/adopter address at time of event | Current address |
| **VolunteerHub** | Person is approved volunteer | Where they volunteer |
| **PetLink** | Microchip registered to person | Person still has cat |
| **Airtable** | Request submitted from this address | Requester lives there |

### Ground Truth Entity Relationships

```
appointment.inferred_place_id → place
  = WHERE THE CAT WAS SEEN (trapping site, ground truth)

appointment.cat_id → cat
  = WHICH CAT WAS SEEN (ground truth)

appointment.owner_info → person (via Data Engine)
  = WHO BOOKED THE APPOINTMENT (contact, not necessarily resident)
```

### Key Principle
**Cat-Place is ground truth. Person-Place is contact info only (until verified).**

---

## Layer 2: TNR Role Taxonomy

Based on industry research ([Alley Cat Allies](https://www.alleycat.org/), [Cat Stats](https://www.catstats.org/), [Barn Cat Lady](https://barncatlady.com/what-is-a-cat-caretaker/)), people involved with community cats have varying roles and commitment levels:

### Person-Place Roles (relationship to a LOCATION)

| Role | Definition | Financial Responsibility | Commitment Level |
|------|------------|-------------------------|------------------|
| `property_owner` | Owns the property | Varies | Property-based |
| `resident` | Lives at this address | Varies | Personal |
| `colony_caretaker` | Full responsibility for colony at this site | High (feeding + vet) | Daily |
| `feeder` | Provides food regularly | Low (food only) | Daily/Weekly |
| `colony_supervisor` | Coordinates feeders, manages vet care | Medium-High | Oversight |
| `transporter` | Helps with trapping logistics | None | As needed |
| `referrer` | Called about cats at this location | None | One-time |
| `neighbor` | Lives nearby, knows about cats | None | Awareness |

### Person-Cat Roles (relationship to a CAT)

| Role | Definition | Financial Responsibility |
|------|------------|-------------------------|
| `owner` | Legal owner of cat | Full |
| `adopter` | Adopted cat from shelter | Full |
| `foster` | Temporary care provider | Varies (shelter may cover) |
| `caretaker` | Primary caregiver (community cat) | Varies (willing to pay) |
| `brought_in_by` | Trapped/delivered cat to clinic | None |
| `requested_tnr_for` | Requested TNR for this cat | None |
| `emergency_contact` | Contact if cat found | None |

### Financial Commitment Levels

The user correctly noted: "a caretaker might not want to take care of the bills of a cat but one caretaker will be willing to pay $10,000 to save a cat"

| Level | Description | Examples |
|-------|-------------|----------|
| `full` | Pays all costs | Owners, dedicated caretakers |
| `limited` | Pays some costs (food, basic vet) | Feeders, casual caretakers |
| `emergency_only` | Only pays for emergencies | Some community members |
| `none` | No financial responsibility | Referrers, trappers, staff |

---

## Layer 3: Verification Workflow

### Verification States

```sql
-- On sot.person_place table
is_staff_verified BOOLEAN DEFAULT FALSE
verified_at TIMESTAMPTZ
verified_by UUID (staff_id)
verification_method TEXT ('ui_button', 'phone_call', 'site_visit', 'imported')
```

### Verification Actions

Staff can verify relationships through these actions:

1. **Verify as Resident** - Confirms person lives at address
2. **Verify as Caretaker** - Confirms person cares for cats at location
3. **Verify as Feeder** - Confirms person feeds cats (lower commitment)
4. **Mark as Referrer Only** - Person called but doesn't live there
5. **Remove Relationship** - Relationship was incorrect

### Verification Sources

| Method | Confidence | Use Case |
|--------|------------|----------|
| `phone_call` | High | Staff called and confirmed |
| `site_visit` | Highest | Staff visited location |
| `ui_button` | Medium | Staff clicked based on conversation |
| `staff_note` | Medium | Based on staff knowledge |
| `imported_verified` | High | Pre-verified from external system |

---

## Layer 4: UI Design

### A. Person Profile - Verification Panel

```
┌─────────────────────────────────────────────────────┐
│ Jane Smith                                          │
│ 📞 (707) 555-1234  ✉️ jane@email.com               │
├─────────────────────────────────────────────────────┤
│ Locations                                           │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📍 123 Main St, Petaluma                        │ │
│ │    Role: [Contact Address ▼]  ← dropdown        │ │
│ │    ○ Contact Address (unverified)               │ │
│ │    ○ Resident ✓                                 │ │
│ │    ○ Colony Caretaker                           │ │
│ │    ○ Feeder                                     │ │
│ │    ○ Property Owner                             │ │
│ │    ○ Referrer Only                              │ │
│ │                                                 │ │
│ │    [Verify ✓] [Remove]                          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [+ Add Location]                                    │
└─────────────────────────────────────────────────────┘
```

### B. Place Profile - Associated People

```
┌─────────────────────────────────────────────────────┐
│ 📍 123 Main St, Petaluma                            │
│ 🐱 12 cats seen here                                │
├─────────────────────────────────────────────────────┤
│ People                                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Jane Smith - Resident ✓ (verified 2026-02-20)   │ │
│ │ Bob Jones - Feeder (unverified)                 │ │
│ │ Mary Lee - Contact Address ⚠️                    │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Quick Actions:                                      │
│ [Mark Primary Caretaker] [Add Person]               │
└─────────────────────────────────────────────────────┘
```

### C. Inline Verification (During Call)

When staff is on a call and updating a record:

```
┌─────────────────────────────────────────────────────┐
│ 📞 Incoming Context                                 │
│                                                     │
│ Jane Smith called about 123 Main St.                │
│                                                     │
│ Quick verification:                                 │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Does Jane live at 123 Main St?                  │ │
│ │                                                 │ │
│ │ [Yes, Resident] [No, Just Referrer] [Unsure]    │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ What is Jane's role?                                │
│ [Colony Caretaker] [Feeder] [Property Owner] [Other]│
└─────────────────────────────────────────────────────┘
```

### D. Map Quick Actions

When clicking a pin on the map:

```
┌─────────────────────────────────────────────────────┐
│ 📍 123 Main St                                      │
│ 🐱 12 cats | 👤 3 contacts                          │
│                                                     │
│ [View Details] [Log Visit] [Update Contacts]        │
│                                                     │
│ Primary Contact: Jane Smith (Resident ✓)            │
│ Last activity: 2 weeks ago                          │
└─────────────────────────────────────────────────────┘
```

---

## Layer 5: Database Schema Changes

### A. Extend person_place relationship types

```sql
-- Add new allowed relationship types
ALTER TABLE sot.person_place
DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place
ADD CONSTRAINT person_place_relationship_type_check
CHECK (relationship_type IN (
  -- Verified residence
  'resident', 'property_owner',
  -- Colony involvement
  'colony_caretaker', 'colony_supervisor', 'feeder',
  -- Logistics
  'transporter', 'referrer', 'neighbor',
  -- Work-related
  'works_at', 'volunteers_at',
  -- Unverified (default for imports)
  'contact_address'
));
```

### B. Add verification metadata

```sql
-- Already added in MIG_2505
ALTER TABLE sot.person_place
ADD COLUMN IF NOT EXISTS is_staff_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS verified_by UUID,
ADD COLUMN IF NOT EXISTS verification_method TEXT;
```

### C. Add financial commitment tracking

```sql
-- Track willingness to pay for cat care
CREATE TABLE IF NOT EXISTS sot.person_place_details (
  person_place_id UUID PRIMARY KEY REFERENCES sot.person_place(id),
  financial_commitment TEXT CHECK (financial_commitment IN ('full', 'limited', 'emergency_only', 'none')),
  is_primary_contact BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Layer 6: API Endpoints

### A. Verify Relationship

```
POST /api/admin/person-place/[id]/verify
{
  "relationship_type": "resident" | "colony_caretaker" | ...,
  "verification_method": "phone_call" | "site_visit" | "ui_button",
  "notes": "Confirmed during call on 2026-02-25"
}
```

### B. Update Role

```
PATCH /api/admin/person-place/[id]
{
  "relationship_type": "feeder",
  "financial_commitment": "limited"
}
```

### C. Remove Relationship

```
DELETE /api/admin/person-place/[id]
{
  "reason": "Person moved away"
}
```

---

## Layer 7: Implementation Phases

### Phase 1: Foundation (Ready Now)
- [x] is_staff_verified column exists
- [x] link_cats_to_places requires verification
- [ ] Extend relationship_type constraint
- [ ] Add verification metadata columns

### Phase 2: API Layer
- [ ] Create verification API endpoint
- [ ] Create role update API endpoint
- [ ] Audit logging for changes

### Phase 3: UI Components
- [ ] Verification panel on person profile
- [ ] Associated people list on place profile
- [ ] Inline verification during calls
- [ ] Map quick actions

### Phase 4: Workflow Integration
- [ ] "Needs Verification" review queue
- [ ] Bulk verification tools
- [ ] Verification metrics dashboard

---

## Key Design Principles

1. **Source data is truth** - Never modify source data interpretations
2. **Staff enriches, not corrects** - Staff adds context, doesn't change source
3. **Roles reflect reality** - TNR roles are nuanced (caretaker ≠ owner ≠ feeder)
4. **Financial commitment varies** - Some pay $10k, some just feed
5. **Referrer ≠ Resident** - The caller may not live at the location
6. **Verification is progressive** - Start unverified, upgrade to verified
7. **Cat-Place is primary** - People are contacts for locations, not the reverse

---

## References

- [Alley Cat Allies Colony Care Guide](https://www.alleycat.org/resources/best-practices-community-cat-colony-care/)
- [Cat Stats TNR Database](https://www.catstats.org/)
- [ShelterLuv Field & Community Services](https://help.shelterluv.com/hc/en-us/articles/360037280591)
- [ASM ShelterManager Database](https://sheltermanager.com/repo/asm3_help/databasetables.html)
- [Barn Cat Lady - What is a Cat Caretaker?](https://barncatlady.com/what-is-a-cat-caretaker/)
