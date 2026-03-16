# Atlas Documentation Index

**Last Updated:** 2026-02-28

This index categorizes all Atlas documentation by status and purpose.

---

## Active Reference (Keep Current)

These documents are actively used and should be kept up-to-date:

| Document | Purpose | Notes |
|----------|---------|-------|
| `CLAUDE.md` (root) | Development rules & invariants | Primary Claude context |
| `DATA_GAPS.md` | Active data quality issues | Update as issues are found/fixed |
| `DATA_GAP_RISKS.md` | Edge cases & unusual scenarios | Check when seeing anomalies |
| `CENTRALIZED_FUNCTIONS.md` | SQL function signatures | Update with new functions |
| `CURRENT_STATE_AND_PLAN.md` | V2 overhaul status | 95%+ complete |
| `INGEST_GUIDELINES.md` | Data ingestion rules | Core reference |
| `CLINIC_DATA_STRUCTURE.md` | ClinicHQ data flow | Core reference |
| `DATA_FLOW_ARCHITECTURE.md` | Pipeline overview | Core reference |

---

## Completed Work (Archive Candidates)

These documents describe completed work. Consider moving to `docs/archive/`:

| Document | Status | Notes |
|----------|--------|-------|
| `ARCHITECTURE_OVERHAUL_PLAN.md` | COMPLETED | V2 overhaul done |
| `ATLAS_DATA_REMEDIATION_PLAN.md` | COMPLETED | Remediation done |
| `FINAL_DATA_REMEDIATION_PLAN.md` | COMPLETED | Duplicate of above |
| `V1_V2_DATA_GAP_ANALYSIS.md` | COMPLETED | Gap analysis done |
| `V2_CLEANUP_CHECKLIST.md` | COMPLETED | Cleanup done |
| `DATA_CLEANING_REGISTRY.md` | COMPLETED | Initial cleaning done |
| `ENTITY_LINKING_FORTIFICATION_PLAN.md` | COMPLETED | MIG_2430-2435 applied |
| `INTEGRATION_PLAN.md` | COMPLETED | Initial integrations done |
| `LAUNCH_RUNBOOK.md` | COMPLETED | V2 launched |

---

## In-Progress Work

| Document | Status | Next Steps |
|----------|--------|------------|
| `UI_RESTRUCTURE_PLAN.md` | Phase 1 complete | Continue Phase 2 |
| `REQUESTS_REDESIGN_PLAN.md` | Mostly done | Archive, ContactCard, SmartField done |
| `REQUEST_OVERHAUL_FINAL_PLAN.md` | Redundant | Merge with REQUESTS_REDESIGN |
| `REQUEST_UPGRADE_STRATEGY.md` | Redundant | Merge with REQUESTS_REDESIGN |
| `E2E_TEST_UPGRADE_PLAN.md` | In progress | Continue testing work |

---

## Historical/One-Time (Archive)

These were useful at a point in time but are now stale:

| Document | Created | Notes |
|----------|---------|-------|
| `TODO.md` (88KB) | Jan 2026 | Historical task log, archive |
| `TASK_LEDGER.md` (272KB) | Feb 2026 | Historical task log, archive |
| `COMPREHENSIVE_DATA_AUDIT_2026_01_17.md` | Jan 17 | Snapshot audit |
| `DATA_ENGINE_AUDIT_REPORT.md` | Jan 18 | Snapshot audit |
| `DATA_QUALITY_ANALYSIS.md` | Jan 19 | Snapshot audit |
| `AUDIT_RESULTS_2026_02_25.md` | Feb 25 | Snapshot audit |
| `TEST_SUITE_WORKING_LEDGER.md` | Feb 8 | Working notes |
| `CLINICHQ_PIPELINE_GAPS.md` | Feb 16 | Gaps addressed |
| `ATLAS_ORCHESTRATOR_PROPOSAL.md` | Jan 28 | Proposal (not implemented) |

---

## Tippy-Specific

These are for Tippy AI assistant context:

| Document | Purpose |
|----------|---------|
| `TIPPY_DATA_QUALITY_REFERENCE.md` | Data quality context |
| `TIPPY_ARCHITECTURE.md` | Architecture context |
| `TIPPY_VIEWS_AND_SCHEMA.md` | Schema navigation |
| `TIPPY_KNOWLEDGE_GAPS.md` | Known limitations |
| `TIPPY_SHOWCASE_QUESTIONS.md` | Demo questions |
| `TIPPY_USE_CASES.md` | Use case examples |

---

## Technical Reference (Keep)

Deep technical docs that remain relevant:

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE_ENTITY_RESOLUTION.md` | Data Engine design |
| `ARCHITECTURE_DIAGRAMS.md` | System diagrams |
| `TECHNICAL_DEDUPLICATION.md` | Dedup methodology |
| `TECHNICAL_METHODOLOGY.md` | Technical approach |
| `ECOLOGY_METHODOLOGY.md` | Beacon science |
| `ACTIVE_FLOW_SAFETY_GATE.md` | Safety checklist |
| `DEVELOPER_GUIDE.md` | Dev setup |
| `SECURITY_REVIEW.md` | Security notes |
| `PLACE_CONTEXTS.md` | Place tagging |
| `VERIFICATION_LAYER_DESIGN.md` | Verification design |
| `DATA_RELIABILITY_ANALYSIS.md` | ClinicHQ reliability |

---

## Duplicate/Redundant (Consolidate or Remove)

| Document | Recommendation |
|----------|----------------|
| `ATLAS_NORTH_STAR.md` + `ATLAS_NORTH_STAR_V2.md` | Keep V2, archive V1 |
| `REQUESTS_REDESIGN_PLAN.md` + `REQUEST_OVERHAUL_FINAL_PLAN.md` + `REQUEST_UPGRADE_STRATEGY.md` | Consolidate into one |
| `ATLAS_DATA_REMEDIATION_PLAN.md` + `FINAL_DATA_REMEDIATION_PLAN.md` | Keep final, archive other |
| `DATA_INGESTION_RULES.md` + `INGEST_GUIDELINES.md` | Keep guidelines, archive rules |
| `UI_AUDIT_AND_RECOMMENDATIONS.md` + `UI_AUDIT_GROUNDED.md` | Keep grounded, archive other |

---

## Recommended Archive Actions

1. **Move to `docs/archive/`:**
   - `TODO.md` (88KB historical log)
   - `TASK_LEDGER.md` (272KB historical log)
   - `ATLAS_NORTH_STAR.md` (keep V2)
   - `ARCHITECTURE_OVERHAUL_PLAN.md` (completed)
   - `V1_V2_DATA_GAP_ANALYSIS.md` (completed)
   - `INTEGRATION_PLAN.md` (completed)
   - All snapshot audits older than 30 days

2. **Consolidate:**
   - Request plans → single `REQUESTS_DESIGN.md`
   - Data remediation plans → keep `CURRENT_STATE_AND_PLAN.md`

3. **Keep actively maintained:**
   - `CLAUDE.md` (root)
   - `DATA_GAPS.md`
   - `CENTRALIZED_FUNCTIONS.md`
   - Tippy docs
   - Technical reference docs

---

## ~/.claude/plans/ Status (12 Plans)

| Plan File | Status | Description |
|-----------|--------|-------------|
| `spicy-conjuring-sifakis.md` | **90% COMPLETE** | Request improvements - archive, ContactCard, SmartField done |
| `federated-launching-pascal.md` | **COMPLETE** | Phone formatting UI upgrade |
| `abstract-napping-stardust-agent-a9ac2ab.md` | **ANALYSIS DONE** | Cat-place pollution analysis (research only) |
| `reflective-stargazing-muffin.md` | **DESIGN COMPLETE** | Cat deduplication system - ready for implementation |
| `reflective-stargazing-muffin-agent-af0b18f.md` | **ANALYSIS DONE** | Cat duplicate analysis (research only) |
| `idempotent-popping-zebra.md` | **DESIGN COMPLETE** | Fix cat search duplicates, appointment detail |
| `sorted-soaring-liskov.md` | **DESIGN ONLY** | Unified clinic history on people/places pages |
| `moonlit-zooming-cocoa.md` | **IN PROGRESS** | Clinic days improvements |
| `kind-soaring-quill.md` | **DESIGN ONLY** | Colony estimate reconciliation system |
| `quiet-cooking-bubble.md` | **DESIGN ONLY** | ClinicHQ notes ingestion |
| `abstract-napping-stardust.md` | **DESIGN ONLY** | Ingest UI improvements |
| `whimsical-jingling-token.md` | **DESIGN ONLY** | Unify appointment entity + fix click bug |

---

## Lessons Learned (Pitfalls to Avoid)

These patterns caused bugs. Preserved in CLAUDE.md "Don't Do" section:

1. **Identity by name alone** - NEVER match people by name, always email/phone
2. **Cell Phone before Owner Phone** - Cell phones are shared in households
3. **PetLink emails without confidence filter** - Staff fabricates emails
4. **Direct INSERTs to entity tables** - Always use `find_or_create_*`
5. **Linking cats to ALL sot.person_place rows** - Use LIMIT 1
6. **TS/SQL parity drift** - Upload route must mirror SQL processor
7. **Org emails as personal identifiers** - Soft-blacklist shared emails
8. **Disease computed at clinics** - Filter by `should_compute_disease_for_place()`
9. **Business names as people** - Use `classify_owner_name()` with ref tables
10. **Arbitrary distance radius for aggregation** - Use `get_place_family()`
