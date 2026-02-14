import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface OnboardingCandidate {
  onboarding_id: string;
  person_id: string;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  status: string;
  target_trapper_type: string;
  has_interest: boolean;
  has_contact: boolean;
  has_orientation: boolean;
  has_training: boolean;
  has_contract_sent: boolean;
  has_contract_signed: boolean;
  is_approved: boolean;
  interest_received_at: string | null;
  first_contact_at: string | null;
  orientation_completed_at: string | null;
  training_completed_at: string | null;
  contract_sent_at: string | null;
  contract_signed_at: string | null;
  approved_at: string | null;
  days_in_status: number;
  days_in_pipeline: number;
  coordinator_name: string | null;
  notes: string | null;
  referral_source: string | null;
}

interface OnboardingStats {
  status: string;
  count: number;
  avg_days_in_status: number;
}

// GET - Fetch onboarding pipeline
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  try {
    // Build query
    let whereClause = "";
    const params: string[] = [];

    if (status && status !== "all") {
      whereClause = "WHERE status = $1";
      params.push(status);
    }

    // Get candidates from pipeline view
    const candidates = await queryRows<OnboardingCandidate>(`
      SELECT * FROM ops.v_trapper_onboarding_pipeline
      ${whereClause}
      ORDER BY
        CASE status
          WHEN 'interested' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'orientation_scheduled' THEN 3
          WHEN 'orientation_complete' THEN 4
          WHEN 'training_scheduled' THEN 5
          WHEN 'training_complete' THEN 6
          WHEN 'contract_sent' THEN 7
          WHEN 'contract_signed' THEN 8
          WHEN 'approved' THEN 10
          ELSE 20
        END,
        days_in_status DESC
    `, params);

    // Get stats
    const stats = await queryRows<OnboardingStats>(`
      SELECT * FROM ops.v_trapper_onboarding_stats
    `);

    return NextResponse.json({
      candidates,
      stats,
      total: candidates.length,
    });
  } catch (err) {
    console.error("Error fetching onboarding data:", err);
    return NextResponse.json(
      { error: "Failed to fetch onboarding data" },
      { status: 500 }
    );
  }
}

// POST - Create new trapper interest
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      first_name,
      last_name,
      email,
      phone,
      referral_source,
      target_type,
      notes,
    } = body;

    if (!first_name || !last_name) {
      return NextResponse.json(
        { error: "first_name and last_name are required" },
        { status: 400 }
      );
    }

    // Create interest using centralized function
    const result = await queryOne<{
      person_id: string;
      onboarding_id: string;
      is_new_person: boolean;
    }>(`
      SELECT * FROM ops.create_trapper_interest(
        p_first_name := $1,
        p_last_name := $2,
        p_email := $3,
        p_phone := $4,
        p_referral_source := $5,
        p_target_type := $6,
        p_notes := $7,
        p_source_system := 'atlas_ui'
      )
    `, [
      first_name,
      last_name,
      email || null,
      phone || null,
      referral_source || null,
      target_type || "ffsc_trapper",
      notes || null,
    ]);

    return NextResponse.json({
      success: true,
      person_id: result?.person_id,
      onboarding_id: result?.onboarding_id,
      is_new_person: result?.is_new_person,
    });
  } catch (err) {
    console.error("Error creating trapper interest:", err);
    return NextResponse.json(
      { error: "Failed to create trapper interest" },
      { status: 500 }
    );
  }
}
