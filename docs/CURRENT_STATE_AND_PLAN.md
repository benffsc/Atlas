# Atlas V2 Current State & Plan

**Last Updated:** 2026-02-18

---

## V2 Migration Status

### ClinicHQ Bulk Import - COMPLETE (99.93%)

| Metric | Count | Notes |
|--------|-------|-------|
| Appointments imported | 38,708 / 38,736 | 28 gap = duplicate keys in export |
| Service items captured | 279,773 | All child service rows now included |
| Appointments with services | 32,460 | Updated via update-services-only.cjs |

### Data Cleanup - COMPLETE

| Issue | Status | Migration |
|-------|--------|-----------|
| Pseudo-profile pollution | FIXED | MIG_2337 |
| Rebooking placeholder (2,381 cats) | Archived | MIG_2337 |
| Org names as people (5 records) | Archived to clinic_accounts | MIG_2337 |
| Cat search in clinic days | FIXED | Column name fix (death_cause → cause) |
| Clinic day number display | FIXED | Only show when explicitly assigned |

### Gates & Protections - ACTIVE

| Gate | Purpose | Status |
|------|---------|--------|
| `should_be_person()` | Rejects fake emails, placeholders, org names | ✅ Enhanced |
| `soft_blacklist` | Blocks @noemail.com, FFSC phone | ✅ Updated |
| `ops.v_suspicious_people` | Monitoring view for ongoing detection | ✅ Created (39 flagged) |
| `ops.clinic_accounts` | Quarantine for pseudo-profiles | ✅ 5 records |
| `ops.archived_people` | Audit trail for cleaned records | ✅ 5 records |

---

## Known Data Quality Issues

| Issue | Count | Priority | Action |
|-------|-------|----------|--------|
| Suspicious people (monitoring view) | 39 | Low | Review when time permits |
| Address-as-names in sot.people | ~20 | Low | Staff review needed |
| SCAS org records | ~10 | Low | Mark as organization |

---

## Immediate Tasks

### 1. Verify Current State (DB audit when connections free)
- [ ] Run entity count audit
- [ ] Verify geocoding coverage
- [ ] Check appointment linking rates
- [ ] Confirm no new pollution

### 2. Run Entity Linking (if needed)
```sql
SELECT sot.run_all_entity_linking();
```

---

## UI Overhaul Plan (Future)

Based on audit, the UI has V1-style sprawl that should be cleaned up:

### High Priority (Quick Wins)
| Task | Effort | Impact |
|------|--------|--------|
| Create `/src/lib/uuid.ts` | 10 min | Removes 6 duplicates |
| Create `/src/lib/guards.ts` | 30 min | Client-side validation |
| Replace 20 formatDate() duplicates | 1 hour | Consistency |
| Fix 3 routes using direct Pool | 30 min | Connection safety |

### Medium Priority (Organization)
| Task | Effort | Impact |
|------|--------|--------|
| Create `/src/types/` directory | 2 hours | Type centralization |
| Group modals → `/components/modals/` | 1 hour | Discoverability |
| Group cards, badges, wizards | 1 hour | Discoverability |
| Split AtlasMap.tsx (3,377 lines) | 4 hours | Maintainability |

### Component Directory Structure (Target)
```
/src/components/
├── modals/          (19 modal components)
├── wizards/         (3 wizard components)
├── sections/        (8 section components)
├── cards/           (6 card components)
├── badges/          (5 badge components)
├── colony/          (6 colony components)
├── tippy/           (4 tippy components)
├── map/             (AtlasMap split into modules)
├── reviews/         (existing ✓)
└── shared/          (remaining shared components)
```

---

## Files Created This Session

| File | Purpose |
|------|---------|
| `sql/schema/v2/MIG_2332__file_uploads_tracking.sql` | File upload tracking |
| `sql/schema/v2/MIG_2333__find_or_create_cat_by_clinichq_id.sql` | Cat creation by ClinicHQ ID |
| `sql/schema/v2/MIG_2334__fix_identifier_conflict.sql` | Fix identifier conflicts |
| `sql/schema/v2/MIG_2337__clean_pseudo_people.sql` | Clean pseudo-profile pollution |

---

## Utility Scripts (Not Committed)

These scripts in the project root were used for bulk import:
- `direct-import.cjs` - V2 bulk import from ClinicHQ exports
- `update-services-only.cjs` - Fast service item update
- `analyze-gap.cjs` - Gap analysis between exports
- `check-missing.cjs` - Find rows without identifiers

---

## What's Working

1. **Clinic Day Photo Upload** - Search by microchip works
2. **Clinic Day Numbers** - Only shows when explicitly assigned
3. **Data Protection** - `should_be_person()` blocks fake profiles
4. **Monitoring** - `v_suspicious_people` flags issues

## What Needs Attention

1. **DB Connection Pool** - NextJS dev server exhausts pool
2. **39 Suspicious People** - Need staff review
3. **UI Sprawl** - 88 flat components should be organized

---

## Quick Reference

### Check Suspicious People
```sql
SELECT * FROM ops.v_suspicious_people ORDER BY cat_count DESC;
```

### Run Entity Linking
```sql
SELECT sot.run_all_entity_linking();
```

### Test should_be_person()
```sql
SELECT sot.should_be_person('Test', 'Name', 'test@noemail.com', '7075767999');
-- Should return FALSE
```
