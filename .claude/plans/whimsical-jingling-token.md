# Data Engine Clinic Ingest Readiness Assessment

## Summary

**Status: READY FOR CLINIC UPLOAD**

The UI-based clinic ingest pipeline is fully functional. The explore agents identified some minor monitoring gaps but no blocking issues for this week's clinic data upload.

---

## Upload Flow (Working)

```
/admin/ingest → Upload XLSX files
      ↓
POST /api/ingest/upload → Stage file, get upload_id
      ↓
POST /api/ingest/process/[id] → Parse, stage records, run post-processing
      ↓
runClinicHQPostProcessing() → Create cats, people, places, appointments
      ↓
Cron: /api/cron/entity-linking (every 15 min) → Final linking passes
```

**Upload Order (CRITICAL):**
1. `cat_info.xlsx` - Creates cats from microchips
2. `owner_info.xlsx` - Creates people, places, links to appointments
3. `appointment_info.xlsx` - Creates appointments, procedures, vitals

---

## What's Working

| Component | Status | Notes |
|-----------|--------|-------|
| File upload UI | **OK** | `/admin/ingest` page |
| XLSX parsing | **OK** | Service line aggregation for appointments |
| Cat creation | **OK** | Uses `find_or_create_cat_by_microchip()` |
| Person creation | **OK** | Uses `find_or_create_person()` → Data Engine |
| Place creation | **OK** | Uses `find_or_create_place_deduped()` |
| Appointment creation | **OK** | With spay/neuter detection |
| Contact info updates | **OK** | MIG_564 now handles Mirna→Myrna scenarios |
| Trapper linking | **OK** | `link_appointments_to_trappers()` |
| Cat-request attribution | **OK** | Uses rolling window logic (MIG_208) |
| Entity linking cron | **OK** | Runs every 15 minutes |

---

## Minor Issues (Non-Blocking)

### 1. Statistics Don't Track `contact_info_update` Decisions
**Impact:** Dashboard statistics won't show contact info updates separately
**Risk:** LOW - Processing works correctly, just monitoring gap
**Fix:** Add counter to `data_engine_process_batch()` (future enhancement)

### 2. `add_person_identifier()` Doesn't Check Merged People
**Impact:** If you add an identifier to a merged person record, it won't redirect to canonical
**Risk:** LOW - Rare edge case during active processing
**Fix:** Add `merged_into_person_id` check (future enhancement)

### 3. Job Queue Doesn't Run Source-Specific Processors
**Impact:** The periodic job processor only runs entity linking, not ClinicHQ processors
**Risk:** NONE for UI uploads - UI calls processors directly via `/api/ingest/process/[id]`
**Note:** This only affects CLI-based batch processing, not UI uploads

---

## Pre-Upload Checklist

Before uploading this week's clinic data, verify:

1. **Health Check** - `GET /api/health/processing`
   - No stuck jobs
   - No critical data integrity issues

2. **Queue Empty** - Check staged_records backlog is manageable

3. **File Format** - Ensure XLSX files are exported from ClinicHQ in expected format:
   - `cat_info.xlsx` - Must have "Microchip Number" column
   - `owner_info.xlsx` - Must have "Owner Email" or "Owner Phone"
   - `appointment_info.xlsx` - Must have "Number", "Date", "Microchip Number"

---

## Verification After Upload

After processing completes, verify:

```sql
-- Check processing results
SELECT * FROM trapper.file_uploads
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

-- Check for any pending identity reviews
SELECT COUNT(*) FROM trapper.data_engine_match_decisions
WHERE decision_type = 'review_pending'
AND review_status = 'pending';

-- Check contact_info_updates (new in MIG_564)
SELECT COUNT(*) FROM trapper.data_engine_match_decisions
WHERE decision_type = 'contact_info_update'
AND created_at > NOW() - INTERVAL '1 day';

-- Verify appointments were created
SELECT COUNT(*) FROM trapper.sot_appointments
WHERE created_at > NOW() - INTERVAL '1 day';
```

---

## Conclusion

The system is **ready for this week's clinic upload**. The new contact info update handling (MIG_564) is deployed and will correctly handle scenarios like Mirna → Myrna where someone has the same email but different phone/address.

**Recommended workflow:**
1. Run health check first
2. Upload files in order: cat_info → owner_info → appointment_info
3. Wait 15 minutes for entity linking cron
4. Run verification queries
5. Review any `review_pending` decisions in admin UI
