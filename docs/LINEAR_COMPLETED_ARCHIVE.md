# Atlas Project — Completed Issues Archive

**Exported:** 2026-03-13
**Total completed (not yet archived):** 145
**Already archived in Linear:** 105

This file is the internal reference for all completed Linear issues.
Safe to archive these from Linear once stored here.

## Not Yet Archived (archive these to free space)

| # | ID | Title | Labels | Priority | Created |
|---|-----|-------|--------|----------|---------|
| 1 | FFS-290 | DATA_GAP_040: Harden entity linking functions — fix silent NULL updates and COALESCE fallbacks | Mar 2026, Entity Linking, Critical, Data Quality | Urgent | 2026-03-07 |
| 2 | FFS-323 | Fix ShelterLuv animal processor microchip extraction + merge duplicates | Mar 2026, Ingest, Data Quality, Bug | Urgent | 2026-03-08 |
| 3 | FFS-325 | Polish search results — hide technical field names from staff |  | High | 2026-03-08 |
| 4 | FFS-326 | Centralized display label registry for all enums |  | High | 2026-03-08 |
| 5 | FFS-327 | PlaceResolver: show Atlas matches inline with Google suggestions |  | High | 2026-03-08 |
| 6 | FFS-328 | Apply centralized labels to all place views and preview modals |  | Medium | 2026-03-08 |
| 7 | FFS-329 | Fix ambiguous foster name matching using SL foster event data | Mar 2026, Entity Linking, Ingest, Data Quality | High | 2026-03-08 |
| 8 | FFS-330 | Pipeline: process_shelterluv_animal should check all microchip positions | Mar 2026, Entity Linking, Ingest, Bug | High | 2026-03-08 |
| 9 | FFS-335 | fix: merge_place_into() silently skipped intake_submissions and clinic_accounts during merges | Mar 2026, Data Quality, Bug | High | 2026-03-08 |
| 10 | FFS-336 | Place data quality audit fixes (MIG_2875) | Mar 2026, Infrastructure, Data Quality | High | 2026-03-08 |
| 11 | FFS-338 | Place dedup staff review UI for Tier 1/2 candidates | Frontend, Data Quality | Medium | 2026-03-08 |
| 12 | FFS-339 | ShelterLuv ingestion: extend should_be_person() gate to catch address-as-name | Mar 2026, Entity Linking, Ingest, Data Quality | Medium | 2026-03-08 |
| 13 | FFS-340 | Search & entity rendering: activity signals at a glance | Mar 2026, Search, Frontend, API, Feature | High | 2026-03-08 |
| 14 | FFS-341 | Restore intake triage computation — 1,257 submissions with no triage scores | Requests, Regression, Critical | Urgent | 2026-03-08 |
| 15 | FFS-342 | Restore household membership building — 237 households with 0 members | Entity Linking, Data Quality | Medium | 2026-03-08 |
| 16 | FFS-343 | Activity signals: list pages, map drawers, and search request cards | Mar 2026, Search, Frontend, API, Map, Improvement | Medium | 2026-03-08 |
| 17 | FFS-344 | V1→V2 migration audit — comprehensive post-migration gap analysis | Mar 2026, Infrastructure, Data Quality | High | 2026-03-08 |
| 18 | FFS-345 | Dashboard county filter + place data quality fixes (MIG_2875) | Mar 2026, Frontend, API, Map, Data Quality, Improvement | Medium | 2026-03-08 |
| 19 | FFS-346 | Improve place dedup: base_address column + unit stripping in normalize | Mar 2026, Infrastructure, Data Quality | High | 2026-03-08 |
| 20 | FFS-347 | Show last_appointment_date on cat detail page and CatDetailDrawer | Mar 2026, Frontend, Improvement | High | 2026-03-08 |
| 21 | FFS-348 | Surface last activity date on request list cards | Mar 2026, Requests, Frontend, API, Improvement | High | 2026-03-08 |
| 22 | FFS-349 | Activity signal gaps: place detail, request detail place, admin orgs, map popup | Mar 2026, Frontend, Improvement | Low | 2026-03-08 |
| 23 | FFS-350 | Fix process_shelterluv_events() — lifecycle writes, phone fallback, unhandled outcomes | Mar 2026, Ingest, Infrastructure, Data Quality | High | 2026-03-08 |
| 24 | FFS-351 | Fix process_shelterluv_intake_events() — lifecycle writes, foster_end tracking | Mar 2026, Ingest, Infrastructure, Data Quality | High | 2026-03-08 |
| 25 | FFS-352 | ShelterLuv lifecycle: Fix event processing + backfill cat_lifecycle_events (MIG_2878) | Mar 2026, Ingest, Infrastructure, Data Quality | High | 2026-03-08 |
| 26 | FFS-356 | Import scraped ClinicHQ data as internal reference mirror | Mar 2026, Ingest, Infrastructure, Data Quality | High | 2026-03-09 |
| 27 | FFS-357 | Extract hidden microchips from ClinicHQ scraped notes fields | Mar 2026, Data Quality | High | 2026-03-09 |
| 28 | FFS-358 | Surface cat lifecycle status badges and ShelterLuv bio in UI | Mar 2026, Infrastructure | Medium | 2026-03-09 |
| 29 | FFS-359 | Surface ClinicHQ medical notes and cause-of-death on cat profiles | Mar 2026, Data Quality | Medium | 2026-03-09 |
| 30 | FFS-360 | Create source.clinichq_scrape staging table migration | Mar 2026, Clinic, Infrastructure | High | 2026-03-09 |
| 31 | FFS-361 | Build clinichq_scrape_import.mjs idempotent import script | Mar 2026, Clinic, Ingest | High | 2026-03-09 |
| 32 | FFS-362 | Create clinichq_scrape enrichment views joining to Atlas entities | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 33 | FFS-363 | Build microchip extraction migration from scrape notes fields | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 34 | FFS-364 | Add current_status and description to cat detail API | Mar 2026, Frontend, API | Medium | 2026-03-09 |
| 35 | FFS-365 | Add lifecycle status badge to CatCard component | Mar 2026, Frontend | Medium | 2026-03-09 |
| 36 | FFS-366 | Add outcome timeline and bio section to cat detail page | Mar 2026, Frontend | Medium | 2026-03-09 |
| 37 | FFS-367 | Add cat notes API endpoint sourcing from clinichq_scrape | Mar 2026, Clinic, API | Medium | 2026-03-09 |
| 38 | FFS-368 | Enrich cat_mortality_events with detailed cause-of-death from scrape labels | Mar 2026, Clinic, Data Quality | Medium | 2026-03-09 |
| 39 | FFS-369 | Display clinical notes and caution badges on cat detail page | Mar 2026, Frontend | Low | 2026-03-09 |
| 40 | FFS-370 | fix: ops.clinic_days missing columns causing 500 errors | Mar 2026, Infrastructure, Bug | Urgent | 2026-03-09 |
| 41 | FFS-371 | fix: ops.clinic_day_entries missing columns and status constraint mismatch | Mar 2026, Infrastructure, Bug | High | 2026-03-09 |
| 42 | FFS-372 | Investigate 12,900 unmatched scrape records — missing from API appointment pipeline | Mar 2026, Clinic, Data Quality | Low | 2026-03-09 |
| 43 | FFS-373 | ClinicHQ scrape enrichment pipeline — backfill sot.cats from 41K scraped records | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 44 | FFS-374 | Fix MaxClientsInSessionMode pool exhaustion on photo upload | Mar 2026, Clinic, Critical, Infrastructure, Bug | Urgent | 2026-03-09 |
| 45 | FFS-375 | Extract ClinicHQ animal IDs from heading and improve enrichment matching | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 46 | FFS-376 | Register extracted clinichq_animal_ids for microchip-matched cats | Mar 2026, Clinic, Entity Linking, Data Quality | High | 2026-03-09 |
| 47 | FFS-377 | Backfill ownership_type from scrape animal_type (feral/friendly/owned classification) | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 48 | FFS-378 | Backfill altered_status from scrape heading_labels_json (27K sterilization records) | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 49 | FFS-379 | Parse sex/breed/coat_length from scrape animal_species_sex_breed field | Mar 2026, Clinic, Data Quality | Medium | 2026-03-09 |
| 50 | FFS-380 | Add weight tracking — schema + backfill from scrape (27K weight records) | Mar 2026, Clinic, Data Quality, Feature | Medium | 2026-03-09 |
| 51 | FFS-382 | Backfill primary_color and secondary_color from scrape animal_colors field | Mar 2026, Clinic, Data Quality | Low | 2026-03-09 |
| 52 | FFS-383 | Data gap: Person-place over-linking from shared email/phone on ClinicHQ bookings | Mar 2026, Infrastructure, Data Quality | Medium | 2026-03-09 |
| 53 | FFS-384 | Data gap: Cathy/Cassie Thomson duplicate person — phone matching blocked by address check | Mar 2026, Data Quality | High | 2026-03-09 |
| 54 | FFS-385 | BUG: First-visit cats with microchip in Animal Name fall through ingest pipeline — no cat created | Mar 2026, Clinic, Ingest, Data Quality, Bug | Urgent | 2026-03-09 |
| 55 | FFS-386 | Data gap: Euthanasia-only cats not ingested from ClinicHQ + entity linking errors in March 2 batch | Mar 2026, Infrastructure, Data Quality | Medium | 2026-03-09 |
| 56 | FFS-387 | Fix entity linking + owner change detection errors blocking ingest | Mar 2026, Infrastructure, Data Quality | Urgent | 2026-03-09 |
| 57 | FFS-388 | Display altered status and altered_by on cat detail page and CatDetailDrawer | Mar 2026, Frontend | Medium | 2026-03-09 |
| 58 | FFS-389 | Display ownership type on cat detail page and CatDetailDrawer | Mar 2026, Frontend | Medium | 2026-03-09 |
| 59 | FFS-390 | Display cat colors (primary/secondary) on cat detail page and CatDetailDrawer | Mar 2026, Frontend | Medium | 2026-03-09 |
| 60 | FFS-391 | Display breed and coat length on cat detail page | Mar 2026, Frontend | Low | 2026-03-09 |
| 61 | FFS-392 | Fix scrape microchip extraction — extracted_microchip column + re-apply enrichments | Mar 2026, Clinic, Data Quality | High | 2026-03-09 |
| 62 | FFS-393 | fix: Restore Kimberly Kiner request dropped during V1→V2 migration | Mar 2026, Data Quality, Bug | Urgent | 2026-03-09 |
| 63 | FFS-394 | Unify print documents: shared CSS, editable fields, recon mode | Mar 2026, Requests, Frontend, Improvement | Medium | 2026-03-09 |
| 64 | FFS-395 | Create shared print CSS and helper modules | Mar 2026, Frontend | Medium | 2026-03-09 |
| 65 | FFS-396 | Create shared print components (Bubble, EditableField, etc.) | Mar 2026, Frontend | Medium | 2026-03-09 |
| 66 | FFS-397 | Refactor trapper sheet: shared CSS, editable fields, recon mode | Mar 2026, Requests, Frontend | Medium | 2026-03-09 |
| 67 | FFS-398 | Refactor intake print form: green theme, shared CSS, editable fields | Mar 2026, Requests, Frontend | Medium | 2026-03-09 |
| 68 | FFS-399 | Refactor request print page: shared CSS and helpers | Mar 2026, Requests, Frontend | Low | 2026-03-09 |
| 69 | FFS-400 | Unify print documents: trapper sheet, intake form, request print | Print Documents, Frontend, Improvement | Medium | 2026-03-09 |
| 70 | FFS-401 | Ingest pipeline ignores ClinicHQ Death Type field — deceased cats not marked | Mar 2026, Infrastructure, Data Quality | Urgent | 2026-03-09 |
| 71 | FFS-403 | Migrate TNR Call Sheet to shared print infrastructure | Print Documents, Frontend, Feature | High | 2026-03-09 |
| 72 | FFS-404 | Audit and standardize shared fields across intake/call sheet/request schemas | Form System, Print Documents, Data Quality | High | 2026-03-09 |
| 73 | FFS-405 | Extract FIV/FeLV test results from scrape free-text notes | Mar 2026, Clinic, Beacon, Data Quality | Urgent | 2026-03-09 |
| 74 | FFS-406 | Extract reproductive data from scrape — fetus counts, lactation, pregnancy | Mar 2026, Clinic, Beacon, Data Quality | High | 2026-03-09 |
| 75 | FFS-407 | Backfill cat age from scrape animal_age — 1,897 cats only in scrape | Mar 2026, Clinic, Beacon, Data Quality | Medium | 2026-03-09 |
| 76 | FFS-408 | Parse clinical conditions from scrape vet notes into structured observations | Mar 2026, Clinic, Beacon, Data Quality | Medium | 2026-03-09 |
| 77 | FFS-409 | Extract transport method from scrape appointment notes (trap vs carrier) | Mar 2026, Clinic, Beacon, Data Quality | Low | 2026-03-09 |
| 78 | FFS-410 | Create field registry table (ops.form_field_definitions) | Form System, Infrastructure | High | 2026-03-10 |
| 79 | FFS-411 | Create form submissions table (ops.form_submissions) | Form System, Infrastructure | Medium | 2026-03-10 |
| 80 | FFS-412 | Create form template tables (ops.form_templates + form_template_fields) | Form System, Infrastructure | Medium | 2026-03-10 |
| 81 | FFS-414 | Paper scan upload and attachment flow for form submissions | Form System, Feature | Medium | 2026-03-10 |
| 82 | FFS-415 | Form builder admin UI for managing templates | Form System, Frontend, Feature | Low | 2026-03-10 |
| 83 | FFS-417 | Consolidate API export structured data → sot.cats + observation tables | Mar 2026, Clinic, Beacon, Data Quality | High | 2026-03-10 |
| 84 | FFS-418 | Backfill appointments from raw structured fields (temperature, lactating, dental disease) | Mar 2026, Clinic, Beacon, Data Quality | Medium | 2026-03-10 |
| 85 | FFS-419 | Flow appointment boolean flags → observation tables during ingest |  | High | 2026-03-10 |
| 86 | FFS-420 | Sync sot.cats (weight/age/coat) from appointments during ingest |  | High | 2026-03-10 |
| 87 | FFS-421 | Add secondary_color param to find_or_create_cat_by_microchip |  | Medium | 2026-03-10 |
| 88 | FFS-422 | Swap intake print page to refactored v2 with shared field options |  | Low | 2026-03-10 |
| 89 | FFS-423 | Create CatHealthBadges component |  | High | 2026-03-10 |
| 90 | FFS-424 | Extend cat list API + view with health summary |  | High | 2026-03-10 |
| 91 | FFS-425 | Add CatHealthBadges to cat list page |  | High | 2026-03-10 |
| 92 | FFS-426 | Add CatHealthBadges to CatDetailDrawer (map) |  | High | 2026-03-10 |
| 93 | FFS-427 | Enrich EntityPreviewContent CatPreview with health data |  | Medium | 2026-03-10 |
| 94 | FFS-428 | Add CatHealthBadges to LinkedCatsSection |  | Medium | 2026-03-10 |
| 95 | FFS-429 | Create PlaceRiskBadges component |  | High | 2026-03-10 |
| 96 | FFS-430 | Extend place list API with disease risk summary |  | High | 2026-03-10 |
| 97 | FFS-431 | Add PlaceRiskBadges to place list page |  | Medium | 2026-03-10 |
| 98 | FFS-432 | Enrich PlacePreview with disease risk |  | Medium | 2026-03-10 |
| 99 | FFS-433 | Add PlaceRiskBadges to LinkedPlacesSection |  | Low | 2026-03-10 |
| 100 | FFS-434 | Create PersonStatusBadges component |  | Medium | 2026-03-10 |
| 101 | FFS-435 | Add PersonStatusBadges to people list + PersonDetailDrawer |  | Medium | 2026-03-10 |
| 102 | FFS-436 | Enrich PersonPreview with status data |  | Low | 2026-03-10 |
| 103 | FFS-437 | Wire EntityPreview into all list tables |  | Medium | 2026-03-10 |
| 104 | FFS-438 | Wire EntityPreview into LinkedCats/Places/People sections |  | Low | 2026-03-10 |
| 105 | FFS-439 | Fix EntityPreview positioning for drawers/scrollable containers | Bug | Low | 2026-03-10 |
| 106 | FFS-440 | Add clinical condition + disease filter to cat list |  | Low | 2026-03-10 |
| 107 | FFS-441 | Add disease risk filter to place list |  | Low | 2026-03-10 |
| 108 | FFS-442 | Wire up site_contact_person_id: UI, PATCH handler, and view update | Mar 2026, Infrastructure | High | 2026-03-10 |
| 109 | FFS-445 | Sync DB form field options to match field-options.ts (MIG_2905) | Form System, Data Quality | High | 2026-03-11 |
| 110 | FFS-446 | Add auth to form submissions API | Form System, API | Medium | 2026-03-11 |
| 111 | FFS-447 | Wire requestToFormData into admin form preview | Form System, Frontend | Medium | 2026-03-11 |
| 112 | FFS-449 | Cat-place pollution: link_cats_to_places() staff exclusion misses trapper_profiles | Mar 2026, Infrastructure, Data Quality | Urgent | 2026-03-11 |
| 113 | FFS-451 | Cassie Thomson (FFSC trapper) misclassified as resident at trapping locations | Mar 2026, Data Quality | Medium | 2026-03-11 |
| 114 | FFS-452 | Duplicate place records: ~4 unmerged entries for Stony Point Rd | Mar 2026, Data Quality | Medium | 2026-03-11 |
| 115 | FFS-453 | Bulk fix: All known trappers still marked as 'resident' at trapping sites | Mar 2026, Entity Linking, Data Quality | High | 2026-03-11 |
| 116 | FFS-454 | Bulk cleanup: Delete false cat-place links from ALL known trappers (not just Marie) | Mar 2026, Entity Linking, Data Quality | High | 2026-03-11 |
| 117 | FFS-455 | Optimize request creation form — contact roles, property type sync, animated disclosure | Mar 2026, Requests, Frontend | High | 2026-03-11 |
| 118 | FFS-458 | Add expandable-section animations to modal toggle sections | Frontend | Low | 2026-03-11 |
| 119 | FFS-459 | Fix Step 4 partial_failure in run_all_entity_linking |  | High | 2026-03-11 |
| 120 | FFS-460 | Full person creation parity for Property Owner & Site Contact |  | Medium | 2026-03-12 |
| 121 | FFS-461 | has_medical_concerns defaults to false — misrepresents "not asked" as "no concerns" | Requests, Frontend, API, Bug | High | 2026-03-12 |
| 122 | FFS-462 | has_property_access has no form UI — always NULL | Requests, Frontend, Improvement | Medium | 2026-03-12 |
| 123 | FFS-463 | total_cats_reported has no form UI — colony size never captured | Requests, Frontend, Improvement | Medium | 2026-03-12 |
| 124 | FFS-464 | cat_name has no form UI — single-cat requests can't record name | Requests, Frontend, Improvement | Medium | 2026-03-12 |
| 125 | FFS-465 | property_owner_phone nulled when owner linked via search | Requests, Frontend, Bug | High | 2026-03-12 |
| 126 | FFS-466 | is_emergency always false — derive from urgency_reasons in API | Requests, API, Improvement | Medium | 2026-03-12 |
| 127 | FFS-467 | fix: Apply missing MIG_2901/2902/2903 SQL migrations blocking uploads |  | Urgent | 2026-03-12 |
| 128 | FFS-468 | Missing trappers in trapper list — VH role sync gap |  | High | 2026-03-12 |
| 129 | FFS-469 | Trapper Management System — Foundation | Mar 2026, Volunteers, Feature | High | 2026-03-12 |
| 130 | FFS-470 | Fix misidentified trappers (Susan Rose, Ernie Lockner, etc.) | Mar 2026, Volunteers, Data Quality | High | 2026-03-12 |
| 131 | FFS-471 | Reclassify trapper tiers from Airtable approval statuses | Mar 2026, Volunteers, Data Quality | High | 2026-03-12 |
| 132 | FFS-472 | Sync missing Airtable trappers into Atlas | Volunteers, Ingest, Data Quality | Medium | 2026-03-12 |
| 133 | FFS-473 | Trapper management page — profile, status, assignments | Volunteers, Frontend, Feature | High | 2026-03-12 |
| 134 | FFS-474 | Community trapper onboarding pipeline (JotForm → Atlas) | Volunteers, Ingest, Feature | Medium | 2026-03-12 |
| 135 | FFS-475 | Fix merge_person_into to handle trapper tables | Volunteers, Infrastructure, Data Quality | Medium | 2026-03-12 |
| 136 | FFS-476 | Fix VH sync role processing gap for approved trappers | Volunteers, Ingest, Bug | Low | 2026-03-12 |
| 137 | FFS-477 | bug: Weight/age enrichment uses wrong file_upload_id — cross-file join broken | Regression, Ingest, Data Quality, Bug | Urgent | 2026-03-12 |
| 138 | FFS-478 | bug: is_positive_value() missing 'Unilateral' — 3 cryptorchid cases dropped | Ingest, Data Quality, Bug | Medium | 2026-03-12 |
| 139 | FFS-480 | Bug: Handoff fails — missing kitten_assessment_status column on ops.requests | Mar 2026, Requests, Critical, Bug | Urgent | 2026-03-12 |
| 140 | FFS-481 | Feat: Integrate direct person creation into handoff modal | Mar 2026, Requests, Frontend, Feature | Medium | 2026-03-12 |
| 141 | FFS-482 | Bug: Handoff drops all place/trapping logistics data from original request | Mar 2026, Requests, Critical, Bug | High | 2026-03-12 |
| 142 | FFS-483 | Bug: 7,294 duplicate clinic_accounts (39%) polluting search + future Beacon data | Mar 2026, Beacon, Search, Infrastructure, Data Quality, Bug | Urgent | 2026-03-12 |
| 143 | FFS-484 | Fix place creation flow: slow modal, failure, option mismatch | Form System, Requests, Frontend, Bug | High | 2026-03-12 |
| 144 | FFS-501 | Cleanup: Archive deprecated ingest scripts + remove stale V1 references | Ingest, Infrastructure | Low | 2026-03-13 |
| 145 | FFS-502 | Fix feeding_duration value mismatch between form-options.ts and DB CHECK constraint | Bug | Medium | 2026-03-13 |

## Already Archived

| # | ID | Title | Labels | Archived |
|---|-----|-------|--------|----------|
| 1 | FFS-188 | Import Airtable Trapper Cases Table | Mar 2026, Data Quality | 2026-03-08 |
| 2 | FFS-189 | Import Airtable Trapper Reports Table | Mar 2026, Data Quality | 2026-03-08 |
| 3 | FFS-190 | Import Airtable Trapper Cats Table | Mar 2026, Data Quality | 2026-03-08 |
| 4 | FFS-192 | Enrich Trapper Profiles from Airtable Trappers Table | Mar 2026, Volunteers, Data Quality | 2026-03-08 |
| 5 | FFS-193 | Import Airtable Client "Do Not Contact" Flags | Mar 2026, Data Quality | 2026-03-08 |
| 6 | FFS-194 | Import Airtable Common Trapping Locations | Mar 2026, Data Quality | 2026-03-08 |
| 7 | FFS-195 | Import Airtable Place Contacts Junction Table | Mar 2026, Data Quality | 2026-03-08 |
| 8 | FFS-196 | Import Airtable FFSC Calendar Events | Mar 2026, Data Quality | 2026-03-08 |
| 9 | FFS-197 | Import Airtable Call Sheets Table | Mar 2026, Requests, Data Quality | 2026-03-08 |
| 10 | FFS-198 | Import Airtable Kitten Intake Assessment Table | Mar 2026, Data Quality | 2026-03-08 |
| 11 | FFS-199 | Import Missing Airtable Appointment Request Fields | Mar 2026, Clinic, Data Quality | 2026-03-08 |
| 12 | FFS-201 | Import Airtable Master Contacts Consent and Aliases | Mar 2026, Data Quality | 2026-03-08 |
| 13 | FFS-202 | Import Airtable Events Timeline Table | Mar 2026, Data Quality | 2026-03-08 |
| 14 | FFS-203 | Import Airtable Surrender Forms Table | Mar 2026, Data Quality | 2026-03-08 |
| 15 | FFS-205 | Import Airtable Equipment and Trapper Skills Data | Mar 2026, Volunteers, Data Quality | 2026-03-08 |
| 16 | FFS-208 | BUG: Contact section shows 'No address set' despite linked places — relink_person_primary_address writes place_id to wrong column | Mar 2026, API, Data Quality, Bug | 2026-03-08 |
| 17 | FFS-209 | BUG: Website Submissions shows 'failed to fetch' — apiSuccess wrapper not unwrapped | Mar 2026, Frontend, API, Bug | 2026-03-08 |
| 18 | FFS-210 | Add 'earliest date seen' to person/place/cat detail pages | Mar 2026, Frontend, API, Feature | 2026-03-08 |
| 19 | FFS-212 | Improve linked entity display density on detail pages | Frontend, Feature | 2026-03-08 |
| 20 | FFS-225 | Intake Kanban: Add keyboard accessibility for drag-and-drop | Frontend, Improvement | 2026-03-08 |
| 21 | FFS-226 | Intake Kanban: Add drag-and-drop to mobile accordion view | Frontend, Improvement | 2026-03-08 |
| 22 | FFS-236 | Fix 5 self-merged person records (circular merge chains) | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 23 | FFS-237 | Flatten multi-hop merge chains (2 place chains, person_cat dangling FK) | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 24 | FFS-238 | Backfill sot_address_id for 526 places missing address links | Mar 2026, Infrastructure, Data Quality | 2026-03-08 |
| 25 | FFS-239 | Optimize dedup candidate refresh functions (address + request timeout) | Mar 2026, Performance, Infrastructure, Data Quality | 2026-03-08 |
| 26 | FFS-240 | 2,924 ClinicHQ cats with appointments but no place link | Mar 2026, Clinic, Entity Linking, Data Quality | 2026-03-08 |
| 27 | FFS-241 | 595 groups of co-located places at identical coordinates need dedup review | Mar 2026, Data Quality | 2026-03-08 |
| 28 | FFS-242 | Person dedup candidate table is empty — no refresh function exists | Mar 2026, Infrastructure, Data Quality | 2026-03-08 |
| 29 | FFS-243 | 9 requests linked to test place "999 Test Street" — clean up test data | Mar 2026, Data Quality | 2026-03-08 |
| 30 | FFS-244 | 3,190 places with 3+ cats but no colony size estimate | Mar 2026, Beacon, Data Quality | 2026-03-08 |
| 31 | FFS-247 | Bug: Salvage script Phase A equipment import crashes — ops.equipment missing airtable_fields column | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 32 | FFS-248 | Harden airtable_salvage.mjs for idempotent re-runs across all phases | Mar 2026, Data Quality, Improvement | 2026-03-08 |
| 33 | FFS-249 | Dashboard Redesign: Map-Centric Command Center | Mar 2026, Frontend, Feature | 2026-03-08 |
| 34 | FFS-250 | Dashboard map: Add marker clustering for dense pin areas | Frontend, Improvement | 2026-03-08 |
| 35 | FFS-251 | Dashboard: Add intake pins as separate map layer | Frontend, Feature | 2026-03-08 |
| 36 | FFS-252 | Dashboard KPI: Cats metric shows partial month vs full month comparison | Frontend, Improvement | 2026-03-08 |
| 37 | FFS-253 | Dashboard: Light mode map tiles look wrong against dark popup styling | Frontend, Bug | 2026-03-08 |
| 38 | FFS-254 | Bug: Request edit silently drops feeding_schedule edits (field name mismatch with PATCH route) | Mar 2026, Requests, API, Bug | 2026-03-08 |
| 39 | FFS-255 | Data quality: Clean 9 invalid feeding_frequency values from atlas_ui | Mar 2026, Data Quality | 2026-03-08 |
| 40 | FFS-256 | Remove feeding_schedule alias, standardize on feeding_frequency across request system | Mar 2026, Requests, Frontend, API, Improvement | 2026-03-08 |
| 41 | FFS-257 | Bug: PATCH route silently drops feeding_schedule edits + UI uses wrong input type | Mar 2026, Requests, Bug | 2026-03-08 |
| 42 | FFS-258 | Data cleanup: 9 invalid feeding_frequency values from atlas_ui | Mar 2026, Data Quality | 2026-03-08 |
| 43 | FFS-259 | Standardize on feeding_frequency, remove feeding_schedule alias | Mar 2026, Requests, Improvement | 2026-03-08 |
| 44 | FFS-260 | Classify FFSC program cats from ClinicHQ booking patterns | Mar 2026, Clinic, Entity Linking, Data Quality | 2026-03-08 |
| 45 | FFS-261 | Dashboard map: Fix cat count 0 + intake pins empty | Mar 2026, Frontend, Bug | 2026-03-08 |
| 46 | FFS-262 | Dashboard: Grouped layer controls + Atlas pins integration | Mar 2026, Frontend, Map, Feature | 2026-03-08 |
| 47 | FFS-263 | Match FFSC trapping site bookings to existing places | Mar 2026, Entity Linking, Data Quality, Improvement | 2026-03-08 |
| 48 | FFS-264 | Add ffsc_program filter to entity linking skip logging | Mar 2026, Entity Linking, Data Quality, Improvement | 2026-03-08 |
| 49 | FFS-265 | Cross-match FFSC foster cats with ShelterLuv foster records | Mar 2026, Clinic, Entity Linking, Improvement | 2026-03-08 |
| 50 | FFS-266 | Add shelter_transfer classification for non-SCAS/RPAS shelters | Mar 2026, Clinic, Data Quality, Improvement | 2026-03-08 |
| 51 | FFS-267 | Full AtlasMap: Adopt GroupedLayerControl component | Frontend, Map, Improvement | 2026-03-08 |
| 52 | FFS-268 | Backfill: Populate is_alteration column and re-geocode intake submissions |  | 2026-03-08 |
| 53 | FFS-269 | Dashboard map: Persist layer state in URL params | Frontend, Improvement | 2026-03-08 |
| 54 | FFS-270 | Dashboard map: Mobile-responsive grouped layer control | Frontend, Improvement | 2026-03-08 |
| 55 | FFS-271 | Fix `ops.find_or_create_request` signature mismatch breaking handoff | Bug | 2026-03-08 |
| 56 | FFS-272 | Add person role & property context to handoff modal | Improvement | 2026-03-08 |
| 57 | FFS-273 | Wire V2 handoff fields through API → SQL | Improvement | 2026-03-08 |
| 58 | FFS-274 | Reconcile PERSON_PLACE_ROLE enum with DB constraint values | Improvement | 2026-03-08 |
| 59 | FFS-275 | Add E2E tests for request handoff flow | Improvement | 2026-03-08 |
| 60 | FFS-276 | AtlasMap: Persist layer state in URL params | Frontend, Map, Improvement | 2026-03-08 |
| 61 | FFS-277 | AtlasMap: Auto-clear disease filters when switching away from Disease Risk | Frontend, Map, Bug | 2026-03-08 |
| 62 | FFS-278 | AtlasMap: Memoize per-sub-layer counts in GroupedLayerControl | Performance, Frontend, Map | 2026-03-08 |
| 63 | FFS-279 | Do Not Contact warning banner on person detail page | Mar 2026 | 2026-03-08 |
| 64 | FFS-280 | Trip Reports tab on request detail page | Mar 2026 | 2026-03-08 |
| 65 | FFS-281 | Equipment inventory and checkout admin page | Mar 2026 | 2026-03-08 |
| 66 | FFS-282 | Person suggestion system — proactive duplicate prevention via email/phone | Mar 2026, Frontend, API, Feature | 2026-03-08 |
| 67 | FFS-283 | Equipment ongoing sync from Airtable | Mar 2026, Data Quality | 2026-03-08 |
| 68 | FFS-284 | Potential trappers pipeline — schema + sync from Airtable | Mar 2026, Volunteers, Data Quality | 2026-03-08 |
| 69 | FFS-285 | Fix trappers sync — migrate from trapper.* to sot.*/ops.* schema | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 70 | FFS-286 | Add PersonSuggestionBanner to RedirectRequestModal | Mar 2026, Frontend, Improvement | 2026-03-08 |
| 71 | FFS-287 | Replace inline email dupe check with PersonSuggestionBanner on New Request page | Mar 2026, Frontend, Improvement | 2026-03-08 |
| 72 | FFS-288 | Add PersonSuggestionBanner to staff New Intake Entry page | Mar 2026, Frontend, Improvement | 2026-03-08 |
| 73 | FFS-289 | Link shelter_transfer and rescue_transfer cats to receiving org places | Mar 2026, Entity Linking, Data Quality, Improvement | 2026-03-08 |
| 74 | FFS-291 | Requestors not linked to places — enrich_person_from_request() defined but never called | Mar 2026, Entity Linking, Data Quality, Bug | 2026-03-08 |
| 75 | FFS-292 | DATA_GAP_059: Fix alteration rate display — distinguish known-altered from unknown | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 76 | FFS-293 | Run place dedup candidate generation (MIG_2836) | Mar 2026, Data Quality, Improvement | 2026-03-08 |
| 77 | FFS-294 | DATA_GAP_027: Health check endpoints for automated monitoring | Mar 2026, API, Improvement | 2026-03-08 |
| 78 | FFS-295 | Fix enrich_person_from_request() — add base case for non-third-party requestors | Mar 2026, Entity Linking, Data Quality, Bug | 2026-03-08 |
| 79 | FFS-296 | Wire enrich_person_from_request() into both request creation paths | Mar 2026, Entity Linking, Data Quality, Bug | 2026-03-08 |
| 80 | FFS-297 | Backfill person_place relationships for all existing requests | Mar 2026, Entity Linking, Data Quality | 2026-03-08 |
| 81 | FFS-298 | Add requestor relationship selector to New Request and Intake forms | Mar 2026, Frontend, Data Quality, Feature | 2026-03-08 |
| 82 | FFS-299 | fix: Migrate all trapper.* schema references to v2 (sot/ops/source) |  | 2026-03-08 |
| 83 | FFS-300 | ShelterLuv initial data sync (API key + full fetch) | Mar 2026, Data Quality | 2026-03-08 |
| 84 | FFS-301 | Process ShelterLuv staged records into sot entities | Mar 2026, Entity Linking, Data Quality | 2026-03-08 |
| 85 | FFS-302 | Enrich cats with ShelterLuv photos, descriptions, and status tracking | Mar 2026, Data Quality, Improvement | 2026-03-08 |
| 86 | FFS-303 | Set up recurring ShelterLuv sync cron | Mar 2026, Improvement | 2026-03-08 |
| 87 | FFS-304 | enrich_place_from_request() not called from POST /api/requests | Mar 2026, Data Quality, Bug | 2026-03-08 |
| 88 | FFS-305 | link_appointments_to_requests() lost in V1→V2 migration — never called | Mar 2026, Entity Linking, Data Quality, Bug | 2026-03-08 |
| 89 | FFS-306 | link_appointments_to_owners() missing from run_all_entity_linking() |  | 2026-03-08 |
| 90 | FFS-307 | check_entity_linking_health() never automated |  | 2026-03-08 |
| 91 | FFS-308 | POST /api/intake bypasses centralized find_or_create functions |  | 2026-03-08 |
| 92 | FFS-309 | convert_intake_to_request() drops 8+ intake fields silently |  | 2026-03-08 |
| 93 | FFS-310 | Fix ShelterLuv event processing + cat origin tracking | Mar 2026, Entity Linking, Data Quality | 2026-03-08 |
| 94 | FFS-311 | Display intake_extended_data on request detail page |  | 2026-03-08 |
| 95 | FFS-312 | Review queue UI for appointment-request fuzzy matches |  | 2026-03-08 |
| 96 | FFS-313 | Re-link entities with corrected confidence ranking |  | 2026-03-08 |
| 97 | FFS-314 | Phone-based appointment linking with address verification (INV-15) |  | 2026-03-08 |
| 98 | FFS-315 | Fix V1→V2 link function overloads and constraints |  | 2026-03-08 |
| 99 | FFS-316 | Fix review queue deduplication — cron creates 26 duplicate rows every 15 min |  | 2026-03-08 |
| 100 | FFS-317 | Review queue bulk actions — Approve All / Dismiss All |  | 2026-03-08 |
| 101 | FFS-318 | Investigate 21% cat_place coverage gap — 9K cats without place links |  | 2026-03-08 |
| 102 | FFS-319 | Complete intake form relationship selector (FFS-298 Step 3) |  | 2026-03-08 |
| 103 | FFS-320 | Wire cat photo_url into API routes |  | 2026-03-08 |
| 104 | FFS-321 | Place dedup batch auto-merge for high-confidence Tier 1 pairs |  | 2026-03-08 |
| 105 | FFS-322 | Place dedup batch auto-merge for high-confidence Tier 1 pairs | Mar 2026, Frontend, Data Quality | 2026-03-08 |
## Canceled / Duplicate (11 issues, already archived)

| ID | Title | Status | Labels |
|-----|-------|--------|--------|
| FFS-479 | bug: sync_cats_from_appointments runs globally — cats_coat_synced inflated to 4327 | Canceled | Ingest, Improvement |
| FFS-450 | Place dedup: 2384 Stony Point Rd has 2 active records (ZIP mismatch 95407 vs 94952) | Duplicate | Mar 2026, Data Quality |
| FFS-355 | Backfill cat_lifecycle_events and fix v_cat_current_status | Duplicate | Mar 2026, Infrastructure, Data Quality |
| FFS-354 | process_shelterluv_intake_events: lifecycle writes, foster_end tracking | Duplicate | Mar 2026, Ingest, Infrastructure |
| FFS-353 | process_shelterluv_events: lifecycle writes, phone fallback, unhandled outcome types | Duplicate | Mar 2026, Ingest, Infrastructure |
| FFS-413 | Template-driven form rendering from registry | Canceled | Form System, Frontend |
| FFS-457 | Intake queue new page: adopt PersonReferencePicker for submitter | Canceled | Frontend |
| FFS-456 | HandoffRequestModal: adopt PersonReferencePicker + PlaceResolver onPlaceKindResolved | Canceled | Requests, Frontend |
| FFS-448 | Converge intake-options.ts into field-options.ts | Canceled | Form System, Infrastructure |
| FFS-222 | Import remaining Airtable request fields not extractable from notes | Canceled | Mar 2026, Data Quality |
| FFS-120 | TECH DEBT: resolved_person_id on ops.appointments is dead code | Canceled | Mar 2026, Ingest, Infrastructure, Improvement |