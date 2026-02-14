#!/bin/bash
# Update code references from trapper.* to sot.* / ops.*
#
# Usage: ./update_trapper_to_v2.sh [--dry-run]
#
# This script updates all TypeScript/TSX files to use V2 schema directly

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "DRY RUN MODE - no files will be modified"
fi

cd "$(dirname "$0")/../.."

# Files to update (TypeScript only - SQL migrations are archived)
FILES=$(grep -rl "trapper\." --include="*.ts" --include="*.tsx" apps/ scripts/ 2>/dev/null || true)

if [[ -z "$FILES" ]]; then
    echo "No files found with trapper.* references"
    exit 0
fi

echo "Found $(echo "$FILES" | wc -l | tr -d ' ') files with trapper.* references"

# ============================================================================
# MAPPING: trapper.* -> sot.* or ops.*
# ============================================================================

# SOT Tables/Views (entity/source of truth data)
SOT_MAPPINGS=(
    "trapper.cat_identifiers:sot.cat_identifiers"
    "trapper.cat_place_relationships:sot.cat_place"
    "trapper.colonies:sot.colonies"
    "trapper.data_engine_match_decisions:sot.data_engine_match_decisions"
    "trapper.data_engine_soft_blacklist:sot.data_engine_soft_blacklist"
    "trapper.observation_zones:sot.observation_zones"
    "trapper.person_cat_relationships:sot.person_cat"
    "trapper.person_identifiers:sot.person_identifiers"
    "trapper.person_place_relationships:sot.person_place"
    "trapper.place_colony_estimates:sot.place_colony_estimates"
    "trapper.place_condition_history:sot.place_condition_history"
    "trapper.place_condition_types:sot.place_condition_types"
    "trapper.place_contexts:sot.place_contexts"
    "trapper.place_observation_zone:sot.place_observation_zone"
    "trapper.places:sot.places"
    "trapper.sot_addresses:sot.addresses"
    "trapper.sot_cats:sot.cats"
    "trapper.sot_people:sot.people"
    "trapper.v_cat_detail:sot.v_cat_detail"
    "trapper.v_google_map_entries_classified:sot.v_google_map_entries_classified"
    "trapper.v_intake_triage_queue:sot.v_intake_triage_queue"
    "trapper.v_map_atlas_pins:sot.v_map_atlas_pins"
    "trapper.v_observation_zone_summary:sot.v_observation_zone_summary"
    "trapper.v_place_alteration_history:sot.v_place_alteration_history"
    "trapper.zone_data_coverage:sot.zone_data_coverage"
    # MIG_2206 additions - sot tables
    "trapper.households:sot.households"
    "trapper.household_members:sot.household_members"
    "trapper.fellegi_sunter_parameters:sot.fellegi_sunter_parameters"
    "trapper.fellegi_sunter_thresholds:sot.fellegi_sunter_thresholds"
    "trapper.place_dedup_candidates:sot.place_dedup_candidates"
    "trapper.cat_duplicate_candidates:sot.cat_dedup_candidates"
    "trapper.potential_person_duplicates:sot.person_dedup_candidates"
    "trapper.place_place_edges:sot.place_place_edges"
    "trapper.relationship_types:sot.relationship_types"
    "trapper.cat_movement_events:sot.cat_movement_events"
    "trapper.cat_reunifications:sot.cat_reunifications"
    "trapper.known_organizations:sot.known_organizations"
)

# OPS Tables/Views (operational/workflow data)
OPS_MAPPINGS=(
    "trapper.google_map_entries:ops.google_map_entries"
    "trapper.journal_entries:ops.journal_entries"
    "trapper.map_annotations:ops.map_annotations"
    "trapper.person_roles:ops.person_roles"
    "trapper.request_trapper_assignments:ops.request_trapper_assignments"
    "trapper.sot_appointments:ops.appointments"
    "trapper.sot_requests:ops.requests"
    "trapper.staff:ops.staff"
    "trapper.staff_sessions:ops.staff_sessions"
    "trapper.v_connected_outlook_accounts_v2:ops.v_connected_outlook_accounts_v2"
    "trapper.v_place_disease_summary:ops.v_place_disease_summary"
    "trapper.v_request_alteration_stats:ops.v_request_alteration_stats"
    "trapper.v_request_detail:ops.v_request_detail"
    "trapper.web_intake_submissions:ops.web_intake_submissions"
    # Email system
    "trapper.email_templates:ops.email_templates"
    "trapper.email_jobs:ops.email_jobs"
    "trapper.email_batches:ops.email_batches"
    "trapper.sent_emails:ops.sent_emails"
    "trapper.email_template_suggestions:ops.email_template_suggestions"
    "trapper.email_categories:ops.email_categories"
    "trapper.outlook_email_accounts:ops.outlook_email_accounts"
    # Tippy
    "trapper.tippy_conversations:ops.tippy_conversations"
    "trapper.tippy_messages:ops.tippy_messages"
    "trapper.tippy_feedback:ops.tippy_feedback"
    "trapper.tippy_draft_requests:ops.tippy_draft_requests"
    "trapper.tippy_proposed_corrections:ops.tippy_proposed_corrections"
    "trapper.tippy_capability_gaps:ops.tippy_capability_gaps"
    # Partner orgs
    "trapper.partner_organizations:ops.partner_organizations"
    "trapper.organization_match_log:ops.organization_match_log"
    "trapper.known_organizations:ops.known_organizations"
    # Other ops
    "trapper.data_improvements:ops.data_improvements"
    "trapper.intake_custom_fields:ops.intake_custom_fields"
    "trapper.intake_questions:ops.intake_questions"
    "trapper.education_materials:ops.education_materials"
    "trapper.data_freshness_tracking:ops.data_freshness_tracking"
    "trapper.test_mode_state:ops.test_mode_state"
    "trapper.relationship_types:ops.relationship_types"
    "trapper.atlas_cat_id_registry:ops.atlas_cat_id_registry"
    # Beacon views (ops since they're operational metrics)
    "trapper.v_beacon_summary:ops.v_beacon_summary"
    "trapper.v_beacon_place_metrics:ops.v_beacon_place_metrics"
    # MIG_2206 additions - ops tables
    "trapper.clinic_days:ops.clinic_days"
    "trapper.clinic_day_entries:ops.clinic_day_entries"
    "trapper.intake_questions:ops.intake_questions"
    "trapper.intake_question_options:ops.intake_question_options"
    "trapper.ecology_config:ops.ecology_config"
    "trapper.ecology_config_audit:ops.ecology_config_audit"
    "trapper.count_precision_factors:ops.count_precision_factors"
    "trapper.processing_jobs:ops.processing_jobs"
    "trapper.orchestrator_run_logs:ops.orchestrator_run_logs"
    "trapper.extraction_queue:ops.extraction_queue"
    "trapper.automation_rules:ops.automation_rules"
    "trapper.source_confidence:ops.source_confidence"
    "trapper.request_resolution_reasons:ops.request_resolution_reasons"
    "trapper.sonoma_zip_demographics:ops.sonoma_zip_demographics"
    "trapper.disease_types:ops.disease_types"
    "trapper.place_disease_status:ops.place_disease_status"
    "trapper.cat_test_results:ops.cat_test_results"
    "trapper.orgs:ops.partner_organizations"
    "trapper.request_cat_links:ops.request_cats"
    "trapper.tippy_unanswerable_questions:ops.tippy_capability_gaps"
    "trapper.person_organization_link:ops.partner_organizations"
    "trapper.cat_organization_relationships:ops.partner_organizations"
    "trapper.mv_place_context_summary:sot.v_place_context_summary"
    "trapper.mv_beacon_clusters:ops.v_beacon_cluster_summary"
    "trapper.classification_clusters:ops.v_beacon_cluster_summary"
    "trapper.cat_conditions:ops.cat_conditions"
    "trapper.volunteerhub_volunteers:source.volunteerhub_volunteers"
    "trapper.volunteerhub_user_groups:source.volunteerhub_user_groups"
    "trapper.volunteerhub_group_memberships:source.volunteerhub_group_memberships"
    "trapper.schema_migrations:ops.schema_migrations"
)

# Function mappings
SOT_FUNCTIONS=(
    "trapper.classify_owner_name:sot.classify_owner_name"
    "trapper.data_engine_resolve_identity:sot.data_engine_resolve_identity"
    "trapper.find_or_create_cat_by_microchip:sot.find_or_create_cat_by_microchip"
    "trapper.find_or_create_person:sot.find_or_create_person"
    "trapper.find_or_create_place_deduped:sot.find_or_create_place_deduped"
    "trapper.get_place_family:sot.get_place_family"
    "trapper.is_organization_name:sot.is_organization_name"
    "trapper.is_valid_person_name:sot.is_valid_person_name"
    "trapper.link_cat_to_place:sot.link_cat_to_place"
    "trapper.link_person_to_cat:sot.link_person_to_cat"
    "trapper.link_person_to_place:sot.link_person_to_place"
    "trapper.norm_email:sot.norm_email"
    "trapper.norm_phone_us:sot.norm_phone_us"
    "trapper.normalize_address:sot.normalize_address"
    "trapper.record_place_condition:sot.record_place_condition"
    "trapper.should_be_person:sot.should_be_person"
    "trapper.refresh_zone_data_coverage:sot.refresh_zone_data_coverage"
)

OPS_FUNCTIONS=(
    "trapper.create_staff_session:ops.create_staff_session"
    "trapper.invalidate_staff_session:ops.invalidate_staff_session"
    "trapper.mark_email_sent:ops.mark_email_sent"
    "trapper.record_failed_login:ops.record_failed_login"
    "trapper.run_all_entity_linking:ops.run_all_entity_linking"
    "trapper.send_email:ops.send_email"
    "trapper.staff_can_access:ops.staff_can_access"
    "trapper.validate_staff_session:ops.validate_staff_session"
    "trapper.find_or_create_request:ops.find_or_create_request"
    # Additional function mappings
    "trapper.record_geocoding_result:ops.record_geocoding_result"
    "trapper.record_reverse_geocoding_result:ops.record_reverse_geocoding_result"
    "trapper.get_geocoding_queue:ops.get_geocoding_queue"
    "trapper.get_reverse_geocoding_queue:ops.get_reverse_geocoding_queue"
    "trapper.get_seasonal_alerts:ops.get_seasonal_alerts"
    "trapper.send_staff_message:ops.send_staff_message"
    "trapper.query_merge_history:ops.query_merge_history"
    "trapper.query_data_lineage:ops.query_data_lineage"
    "trapper.detect_stuck_jobs:ops.detect_stuck_jobs"
    "trapper.register_mortality_event:ops.register_mortality_event"
    "trapper.toggle_place_watchlist:ops.toggle_place_watchlist"
    "trapper.get_site_stats_for_place:ops.get_site_stats_for_place"
    "trapper.advance_trapper_onboarding:ops.advance_trapper_onboarding"
    "trapper.create_trapper_interest:ops.create_trapper_interest"
    "trapper.manual_link_google_entry:ops.manual_link_google_entry"
    "trapper.unlink_google_entry:ops.unlink_google_entry"
    "trapper.query_person_cat_history:ops.query_person_cat_history"
    "trapper.find_potential_duplicates:ops.find_potential_duplicates"
    "trapper.tippy_discover_schema:ops.tippy_discover_schema"
    "trapper.tippy_query_view:ops.tippy_query_view"
    "trapper.tippy_apply_correction:ops.tippy_apply_correction"
    "trapper.calculate_chapman_estimate:ops.calculate_chapman_estimate"
    "trapper.cross_reference_vh_trappers_with_airtable:ops.cross_reference_vh_trappers_with_airtable"
    "trapper.retry_unmatched_master_list_entries:ops.retry_unmatched_master_list_entries"
    "trapper.person_safe_to_merge:sot.person_safe_to_merge"
    "trapper.norm_name_key:sot.norm_name_key"
    "trapper.match_place_from_report:ops.match_place_from_report"
    "trapper.log_field_edit:ops.log_field_edit"
    "trapper.create_photo_group:ops.create_photo_group"
    "trapper.upsert_address_from_google_place:sot.upsert_address_from_google_place"
    "trapper.update_trapper_status:ops.update_trapper_status"
    "trapper.update_google_map_ai_summary:ops.update_google_map_ai_summary"
    "trapper.update_ecology_config:ops.update_ecology_config"
    "trapper.update_cat_presence:ops.update_cat_presence"
    "trapper.unlink_person_primary_address:sot.unlink_person_primary_address"
    "trapper.tippy_propose_correction:ops.tippy_propose_correction"
    "trapper.tippy_log_unanswerable:ops.tippy_log_unanswerable"
    "trapper.create_place_from_coordinates:sot.create_place_from_coordinates"
)

# ============================================================================
# Apply replacements
# ============================================================================

apply_replacement() {
    local old="$1"
    local new="$2"

    for file in $FILES; do
        if grep -q "$old" "$file" 2>/dev/null; then
            if [[ "$DRY_RUN" == "true" ]]; then
                echo "Would replace '$old' -> '$new' in $file"
            else
                # Use perl for reliable replacement (handles dots in pattern)
                perl -pi -e "s/\Q$old\E/$new/g" "$file"
            fi
        fi
    done
}

echo ""
echo "Applying SOT table mappings..."
for mapping in "${SOT_MAPPINGS[@]}"; do
    old="${mapping%%:*}"
    new="${mapping##*:}"
    apply_replacement "$old" "$new"
done

echo ""
echo "Applying OPS table mappings..."
for mapping in "${OPS_MAPPINGS[@]}"; do
    old="${mapping%%:*}"
    new="${mapping##*:}"
    apply_replacement "$old" "$new"
done

echo ""
echo "Applying SOT function mappings..."
for mapping in "${SOT_FUNCTIONS[@]}"; do
    old="${mapping%%:*}"
    new="${mapping##*:}"
    apply_replacement "$old" "$new"
done

echo ""
echo "Applying OPS function mappings..."
for mapping in "${OPS_FUNCTIONS[@]}"; do
    old="${mapping%%:*}"
    new="${mapping##*:}"
    apply_replacement "$old" "$new"
done

# ============================================================================
# Verification
# ============================================================================

echo ""
echo "=============================================="
echo "Post-update verification"
echo "=============================================="

REMAINING=$(grep -rl "trapper\." --include="*.ts" --include="*.tsx" apps/ scripts/ 2>/dev/null | wc -l | tr -d ' ')

if [[ "$REMAINING" -gt 0 ]]; then
    echo "WARNING: $REMAINING files still have trapper.* references"
    echo "Review these files manually:"
    grep -rl "trapper\." --include="*.ts" --include="*.tsx" apps/ scripts/ 2>/dev/null | head -20
else
    echo "SUCCESS: No trapper.* references remaining in TypeScript files!"
fi

echo ""
echo "Done!"
