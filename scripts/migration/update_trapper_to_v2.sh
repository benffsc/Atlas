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
