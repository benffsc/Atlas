# Dead Code Routes - Tables Don't Exist or Schema Mismatch

**Date:** 2026-02-14
**Updated:** 2026-03-01
**Status:** Need Cleanup or Schema Fixes

These API routes reference tables that don't exist OR have schema mismatches with actual tables.

---

## UPDATED (2026-03-01): Tables Created in MIG_2206

**MIG_2206** created many of these tables, but some routes have **schema mismatches** with what was implemented.

| Table | Status | Notes |
|-------|--------|-------|
| `ops.intake_questions` | ✅ EXISTS | Route expects `step_name`, table has `category` |
| `ops.intake_question_options` | ✅ EXISTS | Route expects `option_description`, `show_warning`, `warning_text` - not in table |
| `ops.intake_custom_fields` | ✅ EXISTS | May work |
| `ops.clinic_days` | ✅ EXISTS | Needs route verification |
| `ops.clinic_day_entries` | ✅ EXISTS | Needs route verification |
| `ops.ecology_config` | ✅ EXISTS | Needs route verification |
| `ops.ecology_config_audit` | ✅ EXISTS | Needs route verification |
| `ops.count_precision_factors` | ✅ EXISTS | Needs route verification |
| `ops.sonoma_zip_demographics` | ✅ EXISTS | Needs route verification |

---

## Schema Mismatch Issues

### Intake System - SCHEMA MISMATCH
| Route | Issue |
|-------|-------|
| `/api/admin/intake-questions/route.ts` | Expects `step_name`, `show_condition`, `is_custom` - table has `category` instead |
| `/app/admin/intake-questions/page.tsx` | Same schema mismatch - full UI but won't work with current schema |

**Action Needed:** Either update route/page to use `category` instead of `step_name`, or add missing columns to table.

---

## High Priority - Actively Used Features

### Clinic Operations
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/clinic-days/[date]/import/route.ts` | Tables exist, verify schema | Test route |
| `/api/admin/clinic-days/[date]/entries/[id]/route.ts` | Tables exist, verify schema | Test route |

### Beacon/Ecology
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/beacon/forecasts/route.ts` | Table exists | Test route |
| `/api/admin/ecology-config/route.ts` | Table exists | Test route |
| `/api/admin/ecology-config/audit/route.ts` | Table exists | Test route |
| `/api/admin/colony-estimation/route.ts` | Table exists | Test route |
| `/api/beacon/clusters/route.ts` | `mv_beacon_clusters` | Create materialized view or fix query |
| `/api/beacon/summary/route.ts` | `mv_beacon_clusters` | Create materialized view or fix query |
| `/api/beacon/demographics/route.ts` | Table exists | Test route |

### Data Engine
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/data-engine/parameters/route.ts` | `fellegi_sunter_parameters` | Create table or remove route |
| `/api/admin/data-engine/thresholds/route.ts` | `fellegi_sunter_thresholds` | Create table or remove route |
| `/api/admin/data-engine/households/route.ts` | `households` | Create table or remove route |

---

## Medium Priority - Admin Features

### Automation
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/automations/route.ts` | `automation_rules` | Create table or remove route |

### Organizations
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/orgs/route.ts` | `orgs`, `org_types` | Create tables or use `partner_organizations` |
| `/api/admin/orgs/[id]/route.ts` | `orgs` | Create table or use `partner_organizations` |
| `/api/organizations/route.ts` | `person_organization_link`, `cat_organization_relationships` | Create tables or remove route |

### Processing
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/health/processing/route.ts` | `processing_jobs` | Create table or remove route |
| `/api/admin/data/processing/route.ts` | `processing_jobs` | Create table or remove route |
| `/api/cron/orchestrator-run/route.ts` | `orchestrator_run_logs` | Create table or remove route |

### AI Extraction
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/cron/ai-extract/route.ts` | `extraction_queue`, `extraction_status` | Create tables or remove route |
| `/api/admin/ai-extraction/route.ts` | `extraction_queue` | Create table or remove route |

### Deduplication
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/person-dedup/route.ts` | `potential_person_duplicates` | Use `sot.v_person_dedup_candidates` instead |
| `/api/admin/place-dedup/route.ts` | `place_dedup_candidates` | Create table or use view |
| `/api/health/cat-dedup/route.ts` | `cat_duplicate_candidates` | Create table or remove route |

---

## Lower Priority - Less Used

### Trapper Materials
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/trappers/materials/route.ts` | `education_materials` | Create table or remove route |

### Misc Admin
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/test-mode/route.ts` | `test_mode_state` | Create table or remove route |
| `/api/admin/source-confidence/route.ts` | `source_confidence` | Create table or remove route |
| `/api/admin/role-audit/route.ts` | Uses existing `sot.role_reconciliation_log` | ✅ Should work |
| `/api/resolution-reasons/route.ts` | `request_resolution_reasons` | Create table or remove route |

### Place/Cat Features
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/places/[id]/edges/route.ts` | `place_place_edges`, `relationship_types` | Create tables or remove route |
| `/api/cats/[id]/movements/route.ts` | `cat_movement_events` | Create table or remove route |
| `/api/cats/[id]/reunification/route.ts` | `cat_reunifications` | Create table or remove route |

### Cron Jobs
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/cron/guardian/route.ts` | `mv_place_context_summary`, `data_freshness_tracking` | Create or fix query |

---

## Tables That Need Creation

### Critical (Features actively used)
1. `ops.clinic_days` - Clinic scheduling
2. `ops.clinic_day_entries` - Clinic attendance
3. `ops.ecology_config` - Beacon configuration
4. `ops.intake_questions` - Intake form builder

### Important (Admin features)
5. `ops.automation_rules` - Email automation
6. `ops.processing_jobs` - Job tracking
7. `ops.extraction_queue` - AI extraction
8. `sot.households` - Data engine grouping

### Nice to Have
9. `sot.place_place_edges` - Place relationships
10. `sot.cat_movement_events` - Cat tracking
11. `ops.education_materials` - Trapper training

---

## Recommended Actions

### Option 1: Create Missing Tables
Create a `MIG_2206__create_remaining_tables.sql` with all critical tables.

### Option 2: Clean Up Dead Code
Remove routes that reference non-existent tables if the features aren't needed.

### Option 3: Hybrid Approach
1. Create tables for actively used features (clinic, intake, ecology)
2. Remove routes for deprecated features
3. Add TODO comments for future features

---

## Quick Fix: Update Broken Queries

Some routes can be fixed by updating queries to use existing views:

| Current Query | Fix |
|---------------|-----|
| `trapper.potential_person_duplicates` | Use `sot.v_person_dedup_candidates` |
| `trapper.mv_beacon_clusters` | Use `ops.v_beacon_cluster_summary` |
| `trapper.mv_place_context_summary` | Use `sot.v_place_context_summary` |
