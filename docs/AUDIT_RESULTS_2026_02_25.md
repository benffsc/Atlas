# Atlas Data Audit Results

**Date:** 2026-02-25
**Purpose:** Pre-ingest data quality audit
**Status:** Baseline documented for comparison

---

## Summary

| Category | Status | Count | Action Needed |
|----------|--------|-------|---------------|
| Cat-Place Coverage | GOOD | 86.6% ground truth | None |
| ShelterLuv-ClinicHQ Cross-Match | INVESTIGATE | 261 of 4,653 (5.6%) | Manual review |
| FK Integrity (appointments→person) | FIX | 16 rows | Update to merge target |
| FK Integrity (cat relationships→cat) | FIX | 9 rows | Delete stale relationships |
| Org Emails Not Blacklisted | FIX | 66 emails | Add to soft blacklist |
| Misclassified Organizations | FIX | 10 entities | Mark as organization |
| **Place Duplicates** | **CRITICAL** | **82 groups (120 max)** | **Merge duplicates** |
| Google Maps Unlinked | REVIEW | 2,503 (44.5%) | Place deduplication |
| Garbage Cats | REVIEW | 20 records | Review/delete |
| People as Addresses | FIX | 6 records | Convert to places |

---

## 1. ShelterLuv-ClinicHQ Cross-Matching Gap [INVESTIGATED ✅]

### Finding
Only 261 of 1,465 ShelterLuv cats (17.8%) have matching ClinicHQ records.

### Root Causes Identified

| Cause | Impact | Status |
|-------|--------|--------|
| V1→V2 migration didn't match by microchip | Created 1,204 duplicate cats | FIX NEEDED |
| 579 FFSC-chipped cats not in ClinicHQ | Genuine external data | ACCEPT |
| Current sync process works correctly | N/A | VERIFIED |

### Investigation Summary

| Metric | Value |
|--------|-------|
| Total ShelterLuv cats | 1,465 |
| ShelterLuv cats with microchips | 989 (67.5%) |
| ShelterLuv cats with ClinicHQ ID | 261 (17.8%) |
| FFSC-chipped SL cats NOT in any ClinicHQ data | 579 |
| SCAS cats with ClinicHQ match | 141/143 (98%) ✅ |
| ClinicHQ data range | 2013-08-21 to 2026-02-18 |

### Root Cause #1: V1→V2 Migration Script Bug

**File:** `scripts/ingest-v2/migrate_shelterluv_data.ts` (lines 224-235)

The migration only matched by `shelterluv_animal_id`, NOT by microchip:
```typescript
// BUG: Only checks shelterluv_animal_id, not microchip
const existing = await v2.query(`
  SELECT cat_id FROM sot.cats WHERE shelterluv_animal_id = $1
`, [slIdent.id_value]);
// NO MICROCHIP MATCHING - created duplicates!
```

**Fix:** Create `MIG_2510__merge_duplicate_cats_by_microchip.sql`

### Root Cause #2: 579 Cats Genuinely Not in ClinicHQ

Verified by querying `source.clinichq_raw` (430,667 records) - none of these microchips exist.

**Chip Distribution:**
| Chip Prefix | Count | Range |
|-------------|-------|-------|
| 900085001 | 196 | 641350-797410 |
| 981020043 | 78 | 172770-915206 |
| 981020053 | 54 | 103430-885590 |
| Others | 251 | Various |

**Likely Explanation:** Cats chipped by partner orgs using FFSC inventory, historical pre-2013 cats, or cats that went directly to adoption without clinic visit.

### SCAS Barn Cat Program: NOT AN ISSUE ✅

| Metric | Value |
|--------|-------|
| Total SCAS cats | 143 |
| With ClinicHQ ID | 141 (98%) |
| With ShelterLuv ID | 3 (2%) |

SCAS cats properly flow through ClinicHQ for TNR, then may or may not enter ShelterLuv. Working as expected.

### Ownership Type Diagnostic Pattern

| ownership_type | SL Cats | CHQ Match | Rate |
|---------------|---------|-----------|------|
| NULL | 1,204 | 0 | 0% |
| foster/feral/community | 261 | 261 | 100% |

Cats with ownership_type were properly linked during sync. NULL ownership_type indicates flawed V1→V2 migration.

### Current Sync Process: VERIFIED ✅

**File:** `sql/schema/v2/MIG_2402__fix_shelterluv_animal_processor.sql`

The current `process_shelterluv_animal` function correctly calls `find_or_create_cat_by_microchip`. Future syncs will match properly.

### Required Actions

| Priority | Task | Status |
|----------|------|--------|
| 1 | Create MIG_2510 to merge cats by microchip | TODO |
| 2 | Document 579 external cats | DONE (this doc) |
| 3 | No action needed for SCAS | N/A |

---

## 2. FK Integrity Issues

### 2a. Appointments Pointing to Merged Person

**Count:** 16 appointments
**Issue:** `person_id` points to SCAS person record that was merged

```sql
-- Example problematic records
SELECT appointment_id, person_id, owner_first_name, owner_last_name
FROM ops.appointments
WHERE person_id IN (SELECT person_id FROM sot.people WHERE merged_into_person_id IS NOT NULL);
```

**Fix:** Update `person_id` to follow merge chain:
```sql
UPDATE ops.appointments a
SET person_id = p.merged_into_person_id
FROM sot.people p
WHERE a.person_id = p.person_id
  AND p.merged_into_person_id IS NOT NULL;
```

### 2b. Cat Relationships Pointing to Merged Cats

**Count:** 9 relationships
**Issue:** `cat_id` points to merged cats

**Fix:** Delete stale relationships (merged cat relationships should be on winner):
```sql
DELETE FROM sot.person_cat_relationships pcr
USING sot.cats c
WHERE pcr.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NOT NULL;
```

---

## 3. Organization Emails Not Blacklisted

**Count:** 66 emails
**Issue:** Organizational emails creating phantom person records

### Sample Org Emails Found

| Email | Description | Action |
|-------|-------------|--------|
| marinferals@yahoo.com | Marin Ferals org | Blacklist |
| sonomacountyferalcats@gmail.com | Partner org | Blacklist |
| catnetwork@sonoma.net | Partner org | Blacklist |

**Fix:** Add to soft blacklist:
```sql
INSERT INTO sot.data_engine_soft_blacklist (identifier_type, identifier_value, reason)
VALUES
  ('email', 'marinferals@yahoo.com', 'Organization email - creates phantom people'),
  -- ... (66 total)
ON CONFLICT DO NOTHING;
```

---

## 4. Misclassified Organizations

**Count:** 21 entities
**Issue:** Business names classified as people instead of organizations

### Examples

| Name | Current Type | Correct Type |
|------|-------------|--------------|
| World Of Carpets | person | organization |
| Atlas Tree Surgery | person | organization |
| Lawn Generation | person | organization |

**Fix:** Mark as organizations:
```sql
UPDATE sot.people
SET is_organization = TRUE
WHERE person_id IN (
  -- List of 21 misclassified person_ids
);
```

---

## 5. Place Deduplication Status

### CRITICAL: Massive Place Duplication

**82 duplicate place groups** with the worst cases having **120 duplicate records** for the same address.

| Address | Duplicate Count |
|---------|-----------------|
| 3301 Tomales Petaluma Rd, Tomales, CA 94971 | 120 |
| San Antonio Rd & Silveira Ranch Rd, CA 94952 | 119 |
| 777 Aston Ave Apt 74, Santa Rosa, CA 95404 | 119 |
| 2384 Stony Point Rd, Santa Rosa, CA 95407 | 119 |
| 18266 CA-128, Calistoga, CA 94515 | 119 |
| 345 Yolanda Ave #6302, Santa Rosa, CA 95404 | 119 |

**Root Cause:** Places created one-per-appointment instead of using `find_or_create_place_deduped()`.

**Fix:** Create migration to merge duplicate places using `merge_place_into()`.

### Google Maps Linking

| Metric | Value |
|--------|-------|
| Total Google Maps entries | 5,620 |
| Linked to places | 3,117 (55.5%) |
| Unlinked | 2,503 (44.5%) |

### Known Issues

1. **Abbreviation mismatches**: "St" vs "Street", "Rd" vs "Road"
2. **Unit handling**: Some GM entries are for units, parent places may exist
3. **Coordinate-only places**: Some places lack addresses for matching
4. **Duplicate places**: 82 groups need merging before GM linking will be accurate

---

## 6. Data Health Metrics

### Coverage Summary

| Entity | Total | Linked | Coverage |
|--------|-------|--------|----------|
| Cats with places | 42,487 | 34,346 | 80.8% |
| Appointments with cats | 38,755 | 38,739 | 99.9% |
| Appointments with places | 38,755 | 38,701 | 99.9% |
| People with identifiers | ~16,000 | ~14,500 | ~90% |

### Verification Status

| Metric | Value |
|--------|-------|
| Cat-place links (ground truth) | 34,584 (86.6%) |
| Cat-place links (needs verification) | 2,355 (5.9%) |
| Staff-verified person-place | 0 |
| Automated person-place | 10,907 |

---

## 7. Fixes Required Before Ingest

### Priority 0: CRITICAL - Place Duplication
- [ ] Create MIG_2506__merge_duplicate_places.sql
- [ ] Merge 77 duplicate place groups (939 extra duplicates)
- [ ] Verify `find_or_create_place_deduped()` is used in all ingests

**Updated counts (2026-02-26):**
| Address | Duplicates |
|---------|------------|
| 3301 Tomales Petaluma Rd | 142 |
| 2384 Stony Point Rd | 141 |
| 777 Aston Ave Apt 74 | 141 |
| San Antonio Rd & Silveira Ranch Rd | 141 |
| 18266 CA-128, Calistoga | 141 |
| 345 Yolanda Ave #6302 | 141 |

### Priority 0.5: CRITICAL - shelterluv_animal_id Bug
- [ ] Create MIG_2509__fix_shelterluv_animal_id.sql
- [ ] Fix process_shelterluv_animal() to set column
- [ ] Backfill 3,188 cats missing shelterluv_animal_id

**Bug discovered (2026-02-26):**
- 5,332 ShelterLuv IDs in `cat_identifiers` table
- Only 1,465 have `shelterluv_animal_id` column set
- 3,188 cats missing the denormalized column value

### Priority 1: FK Integrity
- [ ] Update 16 appointments with merged person_id
- [ ] Delete 9 stale cat relationships

### Priority 2: Data Quality
- [ ] Add 9 org emails to soft blacklist (updated count)
- [ ] Mark 5 misclassified orgs as `is_organization = TRUE`
- [ ] Convert 9 address-as-people records to places
- [ ] Review 13 garbage cats + 7 needs_review cats

### Priority 3: Investigation
- [ ] Manual review of 579 FFSC-chipped ShelterLuv cats
- [ ] Place deduplication via Google Maps (2,503 unlinked)

---

## 8. Garbage Data Summary (Updated 2026-02-26)

### Cats by Data Quality

| Quality | Count | Examples | Action |
|---------|-------|----------|--------|
| normal | 42,467 | - | None |
| garbage | 13 | "Test Cat", "Unknown" | Delete |
| needs_review | 7 | "A428221 'Pietro'" | Review |

### Address-as-People Records

| display_name | cat_count | Action |
|--------------|-----------|--------|
| Coast Guard Station Tomales Rd. (duplicated) | 43 | Convert to place |
| 111 Sebastopol Road (duplicated) | 32 | Convert to place |
| 757 Acacia Lane (duplicated) | 9 | Convert to place |
| 1162 Dutton Ave (duplicated) | 3 | Convert to place |
| 833 Russell Ave. | 0 | Convert to place |
| U-Haul Southpoint Blvd | 0 | Mark as organization |
| 1320 Commerce St. Petaluma | 0 | Convert to place |
| 500 Kawana Springs Rd | 0 | Convert to place |
| 4828 Lagner Avenue (duplicated) | 0 | Convert to place |

### Misclassified Organizations

| display_name | cat_count | Action |
|--------------|-----------|--------|
| Atlas Tree Surgery | 3 | Mark is_organization=TRUE |
| McBride Apartments Santa Rosa | 4 | Mark is_organization=TRUE |
| Balletto Winery | 2 | Mark is_organization=TRUE |
| Woodcreek Village Apartments | 1 | Mark is_organization=TRUE |
| Amanda Vineyard | 0 | Mark is_organization=TRUE |

### Org Emails Needing Soft Blacklist

| Email | Organization | cat_count |
|-------|--------------|-----------|
| kfennell@marinhumanesociety.org | Marin Humane | 26 |
| rescuedcritters@sbcglobal.net | - | 12 |
| hasanimals@yahoo.com | - | 5 |
| littlebigpawspetrescue@gmail.com | - | 4 |
| kate@dogwoodanimalrescue.org | Dogwood Animal Rescue | 3 |
| stylesrescue@gmail.com | - | 3 |
| becominganimals@gmail.com | - | 3 |
| countrysiderescuesr@gmail.com | - | 0 |
| aharrison@humanesocietysoco.org | Humane Society SoCo | 0 |

### People Misclassified

| Pattern | Count | Examples |
|---------|-------|----------|
| Addresses | 6 | "833 Russell Ave.", "1162 Dutton Ave" |
| Locations | 2 | "Amanda Vineyard", "Balletto Winery" |
| Organizations | 2 | "Golden State Lumber Company", "Pace Supply Company" |

**Total:** 10 people records that should be organizations or places

---

## Comparison Baseline

Run these queries post-ingest to compare:

```sql
-- Cat-place coverage
SELECT COUNT(DISTINCT cat_id)::float / (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) as coverage
FROM sot.cat_place;

-- Cross-system linking
SELECT COUNT(*) FILTER (WHERE shelterluv_animal_id IS NOT NULL AND clinichq_animal_id IS NOT NULL) as cross_linked
FROM sot.cats WHERE merged_into_cat_id IS NULL;

-- Verification progress
SELECT is_staff_verified, COUNT(*) FROM sot.person_place GROUP BY 1;
```
