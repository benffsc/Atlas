import { NextRequest } from "next/server";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    // Get password from env var - NO FALLBACK for security
    const correctPassword = process.env.ATLAS_ACCESS_CODE;

    if (!correctPassword) {
      console.error("ATLAS_ACCESS_CODE env var not set - authentication disabled");
      return apiServerError("Server configuration error");
    }

    if (password === correctPassword) {
      return apiSuccess({ verified: true });
    }

    return apiUnauthorized("Incorrect password");
  } catch {
    return apiBadRequest("Invalid request");
  }
}
