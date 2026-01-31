import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface ContextRow {
  context_type: string;
}

const CONTEXT_TO_KIND: Record<string, { kind: string; confidence: number; reason: string }> = {
  colony_site: { kind: "outdoor_site", confidence: 0.8, reason: "Tagged as colony site" },
  foster_home: { kind: "residential_house", confidence: 0.85, reason: "Tagged as foster home" },
  adopter_residence: { kind: "residential_house", confidence: 0.85, reason: "Tagged as adopter residence" },
  volunteer_location: { kind: "residential_house", confidence: 0.7, reason: "Tagged as volunteer location" },
  trapper_base: { kind: "residential_house", confidence: 0.7, reason: "Tagged as trapper base" },
  clinic: { kind: "clinic", confidence: 0.95, reason: "Tagged as clinic" },
  shelter: { kind: "business", confidence: 0.9, reason: "Tagged as shelter" },
  partner_org: { kind: "business", confidence: 0.85, reason: "Tagged as partner organization" },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  try {
    const contexts = await queryRows<ContextRow>(
      `SELECT context_type FROM trapper.place_contexts
       WHERE place_id = $1 AND (ended_at IS NULL OR ended_at > NOW())
       ORDER BY created_at DESC`,
      [placeId]
    );

    // Find the highest-confidence match from contexts
    let best: { suggested_kind: string; confidence: number; reason: string } | null = null;

    for (const ctx of contexts) {
      const mapping = CONTEXT_TO_KIND[ctx.context_type];
      if (mapping && (!best || mapping.confidence > best.confidence)) {
        best = {
          suggested_kind: mapping.kind,
          confidence: mapping.confidence,
          reason: mapping.reason,
        };
      }
    }

    return NextResponse.json(best || { suggested_kind: null });
  } catch (error) {
    console.error("Error suggesting place type:", error);
    return NextResponse.json({ error: "Failed to suggest type" }, { status: 500 });
  }
}
