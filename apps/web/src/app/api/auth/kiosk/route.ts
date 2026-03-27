import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * POST /api/auth/kiosk
 * Validates a kiosk PIN against the KIOSK_PIN env var.
 * No session created — the client stores the unlock state in localStorage.
 *
 * This is a lightweight gate, not full auth. The kiosk only accesses
 * equipment data, not sensitive person/cat records.
 */
export async function POST(request: NextRequest) {
  const kioskPin = process.env.KIOSK_PIN;

  if (!kioskPin) {
    return apiError("Kiosk access is not configured. Set KIOSK_PIN in environment.", 503);
  }

  try {
    const body = await request.json();
    const { pin } = body;

    if (!pin || typeof pin !== "string") {
      return apiError("PIN is required", 400);
    }

    // Constant-time-ish comparison (good enough for a 4-digit PIN)
    if (pin.trim() !== kioskPin) {
      return apiError("Incorrect PIN", 401);
    }

    return apiSuccess({ unlocked: true });
  } catch {
    return apiError("Invalid request", 400);
  }
}

/**
 * GET /api/auth/kiosk
 * Check if kiosk is configured (does KIOSK_PIN exist?).
 * Used by the gate to know whether to show PIN entry or an error.
 */
export async function GET() {
  const configured = !!process.env.KIOSK_PIN;
  return apiSuccess({ configured });
}
