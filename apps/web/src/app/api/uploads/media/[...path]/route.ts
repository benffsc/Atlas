import { NextRequest, NextResponse } from "next/server";
import { getPublicUrl, isStorageAvailable } from "@/lib/supabase";

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

/**
 * Serve uploaded media files
 *
 * This route handles legacy /uploads/media/* URLs by redirecting to Supabase Storage.
 * New uploads go directly to Supabase and use public URLs, but this route
 * maintains backwards compatibility for any existing references.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { path: pathParts } = await params;
  const relativePath = pathParts.join("/");

  // Security: prevent directory traversal
  if (relativePath.includes("..") || relativePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Redirect to Supabase Storage
  if (isStorageAvailable()) {
    // Convert legacy path format to Supabase path
    // Legacy: /uploads/media/{request_id}/{filename}
    // Supabase: requests/{request_id}/{filename}
    const supabasePath = `requests/${relativePath}`;
    const publicUrl = getPublicUrl(supabasePath);

    return NextResponse.redirect(publicUrl, {
      status: 302, // Temporary redirect in case paths change
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Supabase not available - return error
  return NextResponse.json(
    { error: "Storage not configured" },
    { status: 500 }
  );
}
