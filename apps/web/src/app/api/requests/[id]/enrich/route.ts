import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

/**
 * POST /api/requests/[id]/enrich
 *
 * Enriches a request with data from its linked intake submission.
 * Uses ops.upgrade_request_from_intake() function from MIG_2533.
 *
 * This is useful for:
 * - Upgrading legacy requests that were converted before MIG_2531/2532
 * - Pulling in additional intake data that wasn't transferred during initial conversion
 *
 * Returns the list of fields that were updated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    // Check if request exists and has a linked intake
    const requestCheck = await queryOne<{
      request_id: string;
      source_system: string | null;
      source_record_id: string | null;
    }>(
      `SELECT request_id, source_system, source_record_id
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    if (!requestCheck) {
      return apiNotFound("Request", id);
    }

    // Only web_intake requests can be enriched from intake submissions
    if (requestCheck.source_system !== "web_intake") {
      return apiBadRequest(
        `Request source_system is '${requestCheck.source_system}', not 'web_intake'. Only web_intake requests can be enriched from intake submissions.`
      );
    }

    if (!requestCheck.source_record_id) {
      return apiBadRequest(
        "Request has no linked intake submission (source_record_id is null)"
      );
    }

    // Call the SQL function to enrich the request
    const result = await queryOne<{ fields_updated: number }>(
      `SELECT ops.upgrade_request_from_intake($1) as fields_updated`,
      [id]
    );

    if (result === null) {
      return apiServerError("Failed to enrich request - function returned null");
    }

    // Get the list of fields that were updated by comparing before/after
    // For now, just return the count
    const fieldsUpdated = result.fields_updated || 0;

    // Fetch the updated request to show what changed
    const updatedRequest = await queryOne<{
      peak_count: number | null;
      awareness_duration: string | null;
      county: string | null;
      has_kittens: boolean;
      kitten_count: number | null;
      is_emergency: boolean | null;
      has_medical_concerns: boolean | null;
      feeding_location: string | null;
      feeding_time: string | null;
    }>(
      `SELECT peak_count, awareness_duration, county, has_kittens,
              kitten_count, is_emergency, has_medical_concerns,
              feeding_location, feeding_time
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    return apiSuccess({
      request_id: id,
      source_intake_id: requestCheck.source_record_id,
      fields_updated: fieldsUpdated,
      message:
        fieldsUpdated > 0
          ? `Successfully enriched request with ${fieldsUpdated} fields from intake submission`
          : "Request already had all available intake data",
      current_values: updatedRequest,
    });
  } catch (err) {
    console.error("Enrich error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to enrich request"
    );
  }
}

/**
 * GET /api/requests/[id]/enrich
 *
 * Preview what fields would be enriched without making changes.
 * Useful for showing users what data is available in the linked intake.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    // Check if request exists and has a linked intake
    const requestCheck = await queryOne<{
      request_id: string;
      source_system: string | null;
      source_record_id: string | null;
    }>(
      `SELECT request_id, source_system, source_record_id
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    if (!requestCheck) {
      return apiNotFound("Request", id);
    }

    if (requestCheck.source_system !== "web_intake" || !requestCheck.source_record_id) {
      return apiSuccess({
        can_enrich: false,
        reason: "Request is not linked to a web intake submission",
        source_system: requestCheck.source_system,
      });
    }

    // Get the intake submission data
    const intake = await queryOne<{
      submission_id: string;
      county: string | null;
      peak_count: number | null;
      awareness_duration: string | null;
      cat_count_estimate: number | null;
      has_kittens: boolean | null;
      kitten_count: number | null;
      has_medical_concerns: boolean | null;
      is_emergency: boolean | null;
      feeding_location: string | null;
      feeding_time: string | null;
      is_third_party_report: boolean | null;
      third_party_relationship: string | null;
      dogs_on_site: boolean | null;
      trap_savvy: boolean | null;
      previous_tnr: boolean | null;
    }>(
      `SELECT submission_id, county, peak_count, awareness_duration,
              cat_count_estimate, has_kittens, kitten_count,
              has_medical_concerns, is_emergency, feeding_location,
              feeding_time, is_third_party_report, third_party_relationship,
              dogs_on_site, trap_savvy, previous_tnr
       FROM ops.intake_submissions
       WHERE submission_id = $1`,
      [requestCheck.source_record_id]
    );

    if (!intake) {
      return apiSuccess({
        can_enrich: false,
        reason: "Linked intake submission not found",
        source_record_id: requestCheck.source_record_id,
      });
    }

    // Get current request values to compare
    const currentRequest = await queryOne<{
      county: string | null;
      peak_count: number | null;
      awareness_duration: string | null;
      estimated_cat_count: number | null;
      has_kittens: boolean;
      kitten_count: number | null;
      has_medical_concerns: boolean | null;
      is_emergency: boolean | null;
      feeding_location: string | null;
      feeding_time: string | null;
      is_third_party_report: boolean | null;
      third_party_relationship: string | null;
      dogs_on_site: string | null;
      trap_savvy: string | null;
      previous_tnr: string | null;
    }>(
      `SELECT county, peak_count, awareness_duration, estimated_cat_count,
              has_kittens, kitten_count, has_medical_concerns, is_emergency,
              feeding_location, feeding_time, is_third_party_report,
              third_party_relationship, dogs_on_site, trap_savvy, previous_tnr
       FROM ops.requests
       WHERE request_id = $1`,
      [id]
    );

    // Build list of fields that would be updated
    const fieldsToUpdate: Array<{
      field: string;
      current_value: unknown;
      intake_value: unknown;
    }> = [];

    const checkField = (
      field: string,
      currentValue: unknown,
      intakeValue: unknown
    ) => {
      // Only include if intake has a value and request doesn't
      if (
        intakeValue !== null &&
        intakeValue !== undefined &&
        (currentValue === null || currentValue === undefined)
      ) {
        fieldsToUpdate.push({
          field,
          current_value: currentValue,
          intake_value: intakeValue,
        });
      }
    };

    if (currentRequest) {
      checkField("county", currentRequest.county, intake.county);
      checkField("peak_count", currentRequest.peak_count, intake.peak_count);
      checkField("awareness_duration", currentRequest.awareness_duration, intake.awareness_duration);
      checkField("estimated_cat_count", currentRequest.estimated_cat_count, intake.cat_count_estimate);
      checkField("kitten_count", currentRequest.kitten_count, intake.kitten_count);
      checkField("has_medical_concerns", currentRequest.has_medical_concerns, intake.has_medical_concerns);
      checkField("is_emergency", currentRequest.is_emergency, intake.is_emergency);
      checkField("feeding_location", currentRequest.feeding_location, intake.feeding_location);
      checkField("feeding_time", currentRequest.feeding_time, intake.feeding_time);
      checkField("is_third_party_report", currentRequest.is_third_party_report, intake.is_third_party_report);
      checkField("third_party_relationship", currentRequest.third_party_relationship, intake.third_party_relationship);
      // Note: dogs_on_site/trap_savvy/previous_tnr might be stored as different types (bool vs string)
    }

    return apiSuccess({
      can_enrich: fieldsToUpdate.length > 0,
      source_intake_id: intake.submission_id,
      fields_available: fieldsToUpdate.length,
      fields: fieldsToUpdate,
      intake_data: intake,
      current_request_data: currentRequest,
    });
  } catch (err) {
    console.error("Enrich preview error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to preview enrichment"
    );
  }
}
