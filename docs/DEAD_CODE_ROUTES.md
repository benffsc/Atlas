# Dead Code Routes - Tables Don't Exist

**Date:** 2026-02-14
**Status:** Need Cleanup or Table Creation

These API routes reference tables that don't exist in the database. They will fail when called.

## High Priority - Actively Used Features

### Intake System
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/intake-questions/route.ts` | `intake_questions`, `intake_question_options` | Create tables or remove route |
| `/api/admin/intake-fields/route.ts` | `intake_custom_fields` | Create table or remove route |

### Clinic Operations
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/clinic-days/[date]/import/route.ts` | `clinic_days`, `clinic_day_entries` | Create tables or remove route |
| `/api/admin/clinic-days/[date]/entries/[id]/route.ts` | `clinic_day_entries` | Create table or remove route |

### Beacon/Ecology
| Route | Missing Table | Action Needed |
|-------|---------------|---------------|
| `/api/admin/beacon/forecasts/route.ts` | `ecology_config` | Create table or remove route |
| `/api/admin/ecology-config/route.ts` | `ecology_config` | Create table or remove route |
| `/api/admin/ecology-config/audit/route.ts` | `ecology_config_audit` | Create table or remove route |
| `/api/admin/colony-estimation/route.ts` | `count_precision_factors` | Create table or remove route |
| `/api/beacon/clusters/route.ts` | `mv_beacon_clusters` | Create materialized view or fix query |
| `/api/beacon/summary/route.ts` | `mv_beacon_clusters` | Create materialized view or fix query |
| `/api/beacon/demographics/route.ts` | `sonoma_zip_demographics` | Create table with census data |

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
