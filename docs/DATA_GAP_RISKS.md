# Data Gap Risks & Edge Cases

**Purpose:** Track real-world edge cases that may interact unexpectedly with Atlas data models. Each entry describes a scenario, the risk, and how to handle it.

**For Claude:** When encountering data anomalies or unusual patterns, check this document first. When users report new edge cases, add them here.

---

## Quick Reference

| ID | Title | Key Pattern | Staff Action |
|----|-------|-------------|--------------|
| RISK_001 | Deceased Owner Property | Name has "(estate)" or "(2nd property)" | Don't merge, document in notes |
| RISK_002 | Trapper at Colony Site | Trapper email + non-home address | Use colony address, not trapper's |
| RISK_003 | Shared Household Phone | Same phone, different names | Use household feature, review queue |
| RISK_004 | Same Person, Multiple ClinicHQ Accounts | Same email/phone, different addresses | Keep separate, link via household |
| RISK_005 | Work Address Pollution | Home cats appearing at work address | Delete polluted links, keep appt-based |

---

## For Claude: How to Use This Document

**When to check this document:**
- User reports "weird" or "unusual" booking scenario
- Data pattern doesn't match typical person/place/cat models
- Identity matching produces unexpected results
- Staff asks "how do I handle X situation?"
- Seeing duplicate-looking records that might be intentional

**When to add a new risk:**
- User describes a real scenario that's not already documented
- Use next available RISK_XXX number
- Include all required fields (Scenario, Data Pattern, Risk, Handling)
- Add tags for searchability

**Related documents:**
- `DATA_GAPS.md` - Actual bugs/data quality issues (different from edge cases)
- `TIPPY_DATA_QUALITY_REFERENCE.md` - Explanations for Tippy AI assistant
- `ATLAS_NORTH_STAR.md` - Core system invariants

---

## Common Pattern Categories

### Proxy Contacts
Situations where the person booking is not the actual property owner/resident:
- **RISK_001:** Deceased owner estates
- **RISK_002:** Trappers for colony sites
- _Future:_ Property managers, landlords, HOA contacts

### Identity Challenges
Situations where identity matching is complex:
- **RISK_003:** Shared household identifiers
- **RISK_004:** Same person, multiple ClinicHQ accounts
- _Future:_ Business vs personal emails, name changes

### Multi-Location Scenarios
One person managing cats at multiple locations:
- **RISK_001:** Managing deceased relative's property
- **RISK_004:** Person with cats at home AND a colony site
- **RISK_005:** Work address pollution from household phone sharing

---

## Format for New Entries

```markdown
### RISK_XXX: Short Title

**Reported:** YYYY-MM-DD
**Status:** Active | Resolved | Monitoring
**Tags:** identity, booking, proxy-contact, multi-location, household

**Scenario:**
What's the real-world situation?

**Data Pattern:**
How does this appear in the system? What fields/values are affected?

**Risk:**
What could go wrong if not handled properly?

**Handling:**
How should staff and/or the system handle this?

**System Considerations:**
What should Claude/developers be aware of?

**Related:** MIG_XXX, other risks, etc.
```

---

## Active Risks

### RISK_001: Deceased Owner - Second Property Booking

**Reported:** 2026-02-10
**Status:** Active
**Tags:** proxy-contact, multi-location, identity, estate

**Scenario:**
Trapper Edy Hatcher needs to book TNR for cats at her deceased mother's condo. The property owner (mom) has passed away, but cats still need service at that address.

**Data Pattern:**
- Booking under condo address (correct - cats ARE at this location)
- Owner name entered as: `Edy Hatcher (2nd property)` or similar notation
- The actual requester (Edy) has a different primary address

**Risk:**
1. **Identity confusion:** System might try to match "Edy Hatcher (2nd property)" to existing Edy Hatcher record, creating weird merge scenarios
2. **Place attribution:** Cats get linked to Edy's primary address instead of the condo
3. **Future requests:** If someone else reports cats at that condo, they won't see the history
4. **Trapper stats:** May incorrectly inflate Edy's "personal cats" vs "trapper work"

**Handling:**
1. **Book under the condo address** - this is correct, cats ARE there
2. **For owner name:** Use format `[Contact Name] (managing for estate)` or `[Contact Name] (2nd property)`
3. **In notes:** Document the situation: "Property belongs to deceased relative. Contact: Edy Hatcher [phone]"
4. **Don't merge** this "person" into Edy's real record - it represents a different context
5. **Consider:** Creating a separate person record for "Estate of [Mom's Name]" if this becomes common

**System Considerations:**
- The `(2nd property)` or `(managing for estate)` suffix should be preserved, not stripped
- Data Engine should NOT auto-match based on first/last name alone when these suffixes present
- Consider adding a `is_proxy_contact` flag or `contact_context` field in future

**Related:** Identity matching rules, person-place relationships

---

### RISK_002: Trapper Booking Under Own Name for Colony Site

**Reported:** 2026-02-10
**Status:** Active
**Tags:** proxy-contact, colony, trapper, attribution

**Scenario:**
Trapper books cats under their own name/email for a colony site that isn't their home address.

**Data Pattern:**
- Appointment has trapper's email/phone
- Address is a colony site (park, business, etc.)
- System links cats to trapper as "owner"

**Risk:**
1. **Inflated personal cat counts:** Trapper appears to "own" dozens of cats
2. **Colony site attribution:** Cats don't get linked to the actual colony location
3. **Stats pollution:** Beacon shows colony cats at trapper's home address

**Handling:**
1. **Always use the colony address** for the appointment location
2. **Trapper relationship:** Should be via `trapper_person_id` on appointment, not owner
3. **If already booked wrong:** Staff should update the appointment's place linkage
4. **Notes:** Include actual colony location if different from booking address

**System Considerations:**
- Consider detecting when a known trapper books multiple cats at varying addresses
- Flag for review if trapper books >5 cats under their own contact info in a month

**Related:** Trapper stats, person-cat relationships, colony attribution

---

### RISK_003: Shared Phone/Email Across Household Members

**Reported:** 2026-02-10
**Status:** Active
**Tags:** identity, household, shared-identifiers

**Scenario:**
Multiple family members share a phone number or email. When different people book appointments, they all get merged into one person.

**Data Pattern:**
- Same phone/email appears with different names
- Data Engine may auto-merge or flag for review
- Household may have legitimate multiple requesters

**Risk:**
1. **Over-merging:** Distinct people collapsed into one record
2. **Under-attribution:** One person gets credit for another's requests
3. **Communication confusion:** Contact info reaches wrong household member

**Handling:**
1. **Household modeling:** Use household feature to group people at same address with shared identifiers
2. **Don't auto-merge** when names are significantly different but identifiers match
3. **Review queue:** These should go to `data_engine_match_decisions` for human review
4. **Notes:** Staff should note "Books for multiple household members" if known

**System Considerations:**
- `data_engine_soft_blacklist` can flag commonly-shared identifiers
- Household members table tracks distinct people sharing identifiers

**Related:** MIG_314-317 (Data Engine), households table

---

### RISK_004: Same Person, Multiple ClinicHQ Accounts

**Reported:** 2026-02-10
**Status:** Active
**Tags:** identity, clinichq, multi-location, duplicate-accounts

**Scenario:**
Staff member (e.g., Edy Hatcher) has two ClinicHQ client accounts with the same email/phone but different addresses - one for her home, one for managing cats at another location (mother's estate).

**Data Pattern:**
- Two ClinicHQ records with identical contact info
- Different `Physical Address` fields
- Quick Notes may explain the situation
- Example: "Edy's mothers home who passed BM" vs "Likes to work with Tom Donahue BM"

**Risk:**
1. **Wrong merge:** System might merge both accounts into one person, losing address distinction
2. **Cat attribution:** Cats from estate property end up linked to Edy's home address
3. **Historical confusion:** Can't tell which appointments were for which location

**Handling:**
1. **Keep accounts separate** in Atlas - create two person-place relationships
2. **Use household model** if both addresses are in Atlas
3. **Quick Notes are key** - preserve the context explaining the situation
4. **On ingest:** Data Engine should create separate person-place links, not merge

**System Considerations:**
- When same email/phone appears with DIFFERENT addresses, don't auto-merge
- Create person-place relationships for BOTH addresses
- The place is the source of truth - cats link to place, not just person

**Related:** RISK_001, person-place relationships, ClinicHQ ingest

---

### RISK_005: Work Address Pollution from Household Phone Sharing

**Reported:** 2026-02-10
**Status:** Active
**Tags:** household, multi-location, pollution, entity-linking, work-address

**Scenario:**
Hector Sorrano and Esbeida Campos are a couple living at 1311 Corby Ave. Hector works at 3276 Dutton Ave (a commercial park). Some ClinicHQ bookings for cats at Corby Ave used Esbeida's email + Hector's phone (household shared booking). The Data Engine matched those cats to Hector via phone, then `link_cats_to_places()` propagated the cats to Dutton Ave through Hector's work address relationship.

**Data Pattern:**
- **1311 Corby Ave (home):** 22 appointments with Esbeida's phone, 2 appointments with Hector's phone (same email)
- **3276 Dutton Ave (work):** 2 appointments with no contact info (separate colony)
- **Person-place links:** Hector has `owner` role at BOTH addresses
- **Result:** 13 cats from Corby incorrectly have `home` relationship at Dutton
- **Evidence:** `cat_place_relationships` with `source_system = 'atlas'` and `relationship_type = 'home'` at Dutton

**Risk:**
1. **Location pollution:** Beacon shows 13+ cats at a commercial address that only has ~1 actual cat
2. **Wrong TNR stats:** Dutton Ave appears to have a large cat population
3. **Trapper confusion:** Staff might try to trap at Dutton based on inflated numbers
4. **Data trust:** Undermines confidence in Atlas cat counts per location

**Handling:**
1. **Fix the pollution:** Delete `cat_place_relationships` at Dutton that came from person-based linking (not appointment-based)
2. **Preserve legit records:** Keep the 1 appointment-based cat relationship at Dutton (source_system = 'clinichq')
3. **Person-place review:** Consider changing Hector's role at Dutton from `owner` to `works_at` or similar
4. **Future prevention:** `link_cats_to_places()` should not propagate `home` relationships to places typed as `commercial`

**System Considerations:**
- This is a **predictable pattern** when: (a) household shares phone, (b) one member has work/other address relationship
- The `link_cats_to_places()` function lacks place-type awareness - it propagates to ALL person_place_relationships
- Commercial/work addresses should NOT receive `home` relationship propagation
- Consider adding `relationship_context` (home, work, colony_site) to person_place_relationships
- The `inferred_place_id` from appointments is GROUND TRUTH - person-based propagation is supplementary

**Related:** RISK_003 (shared identifiers), RISK_004 (multi-location), MIG_889 (cat-place linking), INV-26 (LIMIT 1 fix)

**Prevention:**
- MIG_972: One-time fix (deleted 14 polluted links at Dutton Ave)
- MIG_975: Place-type filter in `link_cats_to_places()` (excludes business, clinic, outdoor_site, neighborhood)
- Pipeline architecture: `link_cats_to_appointment_places()` runs FIRST (uses booking address = ground truth), person-based linking is fallback only

---

## Template for Quick Entry

Copy this when adding a new risk:

```markdown
### RISK_XXX: Title

**Reported:** YYYY-MM-DD
**Status:** Active
**Tags:** [comma-separated tags]

**Scenario:**
[What's happening in the real world?]

**Data Pattern:**
[How does it look in the database?]

**Risk:**
[What could go wrong?]

**Handling:**
[How should we deal with it?]

**System Considerations:**
[What should Claude/developers know?]

**Related:** [Links to migrations, other risks]
```

---

## Resolved Risks

_Move risks here once they have been addressed with code/migration changes._

### RISK_RESOLVED_001: ShelterLuv ID + Microchip Concatenation

**Reported:** 2026-02-09
**Resolved:** 2026-02-10
**Resolution:** MIG_910, MIG_911
**Tags:** microchip, shelterluv, data-quality

**Scenario:**
Animal Names like "Macy - A439019 - 981020039875779" were being processed incorrectly, concatenating the ShelterLuv ID (439019) with the microchip (981020039875779) to create invalid 21-digit identifiers.

**Solution:**
- MIG_910: Fixed `detect_microchip_format()` to extract valid chips from concatenated values
- MIG_911: Updated all extraction paths to use safe extraction
- Entity linking cron now processes embedded microchips automatically

**Related:** DATA_GAP_006 in TASK_LEDGER.md
