# Staff Action Items

**Last Updated:** 2026-02-21

## Priority 1: Review Suspicious People (20 Records)

These records in `sot.people` need manual review. They may be organizations, locations, or data entry errors that should not be person records.

### How to Review

Query: `SELECT * FROM ops.v_suspicious_people ORDER BY cat_count DESC;`

### Records to Review

| Name | Cat Count | Suspicion Reason | Recommended Action |
|------|-----------|------------------|-------------------|
| **SCAS** | High | Organization (Sonoma County Animal Services) | Mark as `is_organization = true` |
| **Coast Guard Station** | Variable | Location name, not a person | Convert to place or archive |
| **Altera Apartments** | Variable | Property/complex name | Convert to place or archive |
| **Marin Humane Society** | Variable | Organization (partner rescue) | Mark as `is_organization = true` |
| **Silveira Ranch** | Variable | Site name (trapping location) | Already handled via `clinic_owner_accounts` |
| **Balletto Winery** | Variable | Business/site name | Mark as `is_organization = true` or archive |

### Actions Available

1. **Mark as Organization**:
   ```sql
   UPDATE sot.people SET is_organization = true WHERE person_id = 'UUID';
   ```

2. **Archive (soft delete)**:
   ```sql
   UPDATE sot.people SET merged_into_person_id = NULL, data_quality = 'garbage' WHERE person_id = 'UUID';
   ```

3. **Merge into actual person** (if data entry error):
   Use `/admin/person-dedup` interface

---

## Priority 2: Identify Billing Data Source (DATA_GAP_038)

**Status:** WAITING ON FFSC

ClinicHQ `Total Invoiced` has been 0/NULL for ALL 400k+ records since 2013. We cannot report:
- Revenue per appointment
- Subsidy utilization rates
- Cost per cat fixed
- Revenue by program

**Questions:**
1. Where is billing actually tracked? (QuickBooks? Square? Spreadsheet?)
2. Can we get an export or API access?
3. What time range of billing data is available?

**Contact:** [FFSC Operations/Finance]

---

## Priority 3: Monitor Ear Tip Rate (DATA_GAP_036)

**Status:** Monitoring Added

Historical ear tip rates show decline:
- 2019: 80.6%
- 2023: 55.2%
- 2025: 53.2%

**Possible Causes:**
1. More cats returning already ear-tipped (previous TNR)
2. Staff not consistently adding "Ear Tip" service to appointments
3. Different data entry practices

**Views to Monitor:**
- `ops.v_ear_tip_rate_by_year`
- `ops.v_ear_tip_rate_recent`

No immediate action required - just awareness.

---

## Completed Actions

| Date | Action | Result |
|------|--------|--------|
| 2026-02-20 | ClinicHQ service lines restored | 11,738 rows ingested |
| 2026-02-21 | Staged ShelterLuv processed | 43 cats created |
| 2026-02-21 | Volunteer temporal tracking created | MIG_2366-2367 ready |
