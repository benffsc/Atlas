import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

interface ManualCatch {
  catch_id: string;
  cat_id: string | null;
  microchip: string | null;
  catch_date: string;
  catch_location: string | null;
  notes: string | null;
  cat_name: string | null;
  created_at: string;
}

// GET: List manual catches for this trapper
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const catches = await queryRows<ManualCatch>(
      `SELECT
        mc.catch_id,
        mc.cat_id,
        mc.microchip,
        mc.catch_date,
        mc.catch_location,
        mc.notes,
        c.display_name AS cat_name,
        mc.created_at
      FROM ops.trapper_manual_catches mc
      LEFT JOIN sot.cats c ON c.cat_id = mc.cat_id
      WHERE mc.trapper_person_id = $1
      ORDER BY mc.catch_date DESC`,
      [id]
    );

    return apiSuccess({ catches });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching manual catches:", error);
    return apiServerError("Failed to fetch manual catches");
  }
}

// POST: Add a new manual catch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const body = await request.json();
    const { microchip, cat_id, catch_date, catch_location, notes } = body;

    if (!microchip && !cat_id) {
      return apiBadRequest("Either microchip or cat_id is required");
    }

    // Use the add_trapper_catch function
    const result = await queryOne<{ add_trapper_catch: string }>(
      `SELECT ops.add_trapper_catch(
        $1::uuid,
        $2::text,
        $3::uuid,
        $4::date,
        $5::text,
        $6::text,
        'web_user'
      ) AS add_trapper_catch`,
      [
        id,
        microchip || null,
        cat_id || null,
        catch_date || new Date().toISOString().split("T")[0],
        catch_location || null,
        notes || null,
      ]
    );

    if (!result) {
      return apiServerError("Failed to add catch");
    }

    return apiSuccess({ catch_id: result.add_trapper_catch });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error adding manual catch:", error);

    // Handle specific error messages from the function
    const errorMessage = error instanceof Error ? error.message : "";

    if (errorMessage.includes("not an active trapper")) {
      return apiBadRequest("Person is not an active trapper");
    }

    return apiServerError("Failed to add catch");
  }
}
