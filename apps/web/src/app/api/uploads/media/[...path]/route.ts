import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

// Serve uploaded media files
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { path: pathParts } = await params;
  const relativePath = pathParts.join("/");

  // Security: prevent directory traversal
  if (relativePath.includes("..") || relativePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "uploads", "media", relativePath);

  try {
    // Check file exists
    await stat(filePath);

    // Read file
    const buffer = await readFile(filePath);

    // Determine content type from extension
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const contentTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      pdf: "application/pdf",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
