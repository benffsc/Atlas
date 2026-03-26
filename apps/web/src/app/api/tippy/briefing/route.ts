import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * FFS-755: Check if staff member needs a shift briefing today.
 * Returns { needsBriefing: true } if no briefing conversation exists for today.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session?.staff_id) {
    return NextResponse.json({ needsBriefing: false });
  }

  try {
    const result = await queryOne<{ has_briefed: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM ops.tippy_conversations
        WHERE staff_id = $1
        AND created_at >= CURRENT_DATE
        AND session_context->>'is_briefing' = 'true'
      ) as has_briefed`,
      [session.staff_id]
    );

    return NextResponse.json({ needsBriefing: !result?.has_briefed });
  } catch {
    return NextResponse.json({ needsBriefing: false });
  }
}
