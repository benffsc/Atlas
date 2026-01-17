import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    // Get password from env var - NO FALLBACK for security
    const correctPassword = process.env.ATLAS_ACCESS_CODE;

    if (!correctPassword) {
      console.error("ATLAS_ACCESS_CODE env var not set - authentication disabled");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    if (password === correctPassword) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
