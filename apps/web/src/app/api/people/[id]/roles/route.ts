import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/people/[id]/roles
 *
 * Returns multi-dimensional volunteer/role data for a person:
 * - All person_roles (trapper, foster, volunteer, staff, etc.)
 * - VolunteerHub group memberships (active + history)
 * - VolunteerHub profile data (hours, skills, availability, etc.)
 * - Operational summary (trapper stats, foster stats, linked places)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    // 1. All person_roles
    const roles = await queryRows<{
      role: string;
      trapper_type: string | null;
      role_status: string;
      source_system: string | null;
      started_at: string | null;
      ended_at: string | null;
      notes: string | null;
    }>(
      `SELECT role, trapper_type, role_status, source_system,
              started_at::text, ended_at::text, notes
       FROM trapper.person_roles
       WHERE person_id = $1
       ORDER BY
         CASE role_status WHEN 'active' THEN 0 ELSE 1 END,
         CASE role
           WHEN 'trapper' THEN 1
           WHEN 'staff' THEN 2
           WHEN 'foster' THEN 3
           WHEN 'caretaker' THEN 4
           WHEN 'volunteer' THEN 5
           ELSE 6
         END`,
      [id]
    );

    // 2. VolunteerHub group memberships (active + history)
    // Find the matched VH volunteer via matched_person_id
    const vhVolunteer = await queryOne<{
      volunteerhub_id: string;
      display_name: string;
      email: string | null;
      hours_logged: number | null;
      event_count: number | null;
      last_activity_at: string | null;
      last_login_at: string | null;
      joined_at: string | null;
      is_active: boolean | null;
      volunteer_notes: string | null;
      volunteer_motivation: string | null;
      volunteer_experience: string | null;
      skills: Record<string, string> | null;
      volunteer_availability: string | null;
      languages: string | null;
      pronouns: string | null;
      occupation: string | null;
      how_heard: string | null;
      emergency_contact_raw: string | null;
      can_drive: boolean | null;
    }>(
      `SELECT
         vv.volunteerhub_id,
         vv.display_name,
         vv.email,
         vv.hours_logged,
         vv.event_count,
         vv.last_activity_at::text,
         vv.last_login_at::text,
         vv.joined_at::text,
         vv.is_active,
         vv.volunteer_notes,
         vv.volunteer_motivation,
         vv.volunteer_experience,
         vv.skills,
         vv.volunteer_availability,
         vv.languages,
         vv.pronouns,
         vv.occupation,
         vv.how_heard,
         vv.emergency_contact_raw,
         vv.can_drive
       FROM trapper.volunteerhub_volunteers vv
       WHERE vv.matched_person_id = $1
       LIMIT 1`,
      [id]
    );

    // 3. Group memberships (if VH volunteer found)
    let activeGroups: Array<{ name: string; joined_at: string | null }> = [];
    let groupHistory: Array<{ name: string; joined_at: string | null; left_at: string | null }> = [];

    if (vhVolunteer) {
      activeGroups = await queryRows<{ name: string; joined_at: string | null }>(
        `SELECT vug.name, vgm.joined_at::text
         FROM trapper.volunteerhub_group_memberships vgm
         JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
         WHERE vgm.volunteerhub_id = $1
           AND vgm.left_at IS NULL
         ORDER BY vug.name`,
        [vhVolunteer.volunteerhub_id]
      );

      groupHistory = await queryRows<{ name: string; joined_at: string | null; left_at: string | null }>(
        `SELECT vug.name, vgm.joined_at::text, vgm.left_at::text
         FROM trapper.volunteerhub_group_memberships vgm
         JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
         WHERE vgm.volunteerhub_id = $1
           AND vgm.left_at IS NOT NULL
         ORDER BY vgm.left_at DESC`,
        [vhVolunteer.volunteerhub_id]
      );
    }

    // 4. Operational summary
    const trapperStats = await queryOne<{
      total_caught: number;
      active_assignments: number;
      last_catch: string | null;
    }>(
      `SELECT
         COALESCE(total_cats_caught, 0) as total_caught,
         COALESCE(active_assignments, 0) as active_assignments,
         last_activity_date as last_catch
       FROM trapper.v_trapper_full_stats
       WHERE person_id = $1`,
      [id]
    );

    const fosterStats = await queryOne<{
      cats_fostered: number;
      current_fosters: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE relationship_type = 'foster')::int as cats_fostered,
         COUNT(*) FILTER (WHERE relationship_type = 'foster' AND ended_at IS NULL)::int as current_fosters
       FROM trapper.person_cat_relationships
       WHERE person_id = $1`,
      [id]
    );

    const placesLinked = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT place_id)::int as count
       FROM trapper.person_place_relationships
       WHERE person_id = $1`,
      [id]
    );

    return NextResponse.json({
      roles,
      volunteer_groups: {
        active: activeGroups,
        history: groupHistory,
      },
      volunteer_profile: vhVolunteer
        ? {
            hours_logged: vhVolunteer.hours_logged,
            event_count: vhVolunteer.event_count,
            last_activity: vhVolunteer.last_activity_at,
            last_login: vhVolunteer.last_login_at,
            joined: vhVolunteer.joined_at,
            is_active: vhVolunteer.is_active,
            notes: vhVolunteer.volunteer_notes,
            motivation: vhVolunteer.volunteer_motivation,
            experience: vhVolunteer.volunteer_experience,
            skills: vhVolunteer.skills,
            availability: vhVolunteer.volunteer_availability,
            languages: vhVolunteer.languages,
            pronouns: vhVolunteer.pronouns,
            occupation: vhVolunteer.occupation,
            how_heard: vhVolunteer.how_heard,
            emergency_contact: vhVolunteer.emergency_contact_raw,
            can_drive: vhVolunteer.can_drive,
          }
        : null,
      operational_summary: {
        trapper_stats: trapperStats || null,
        foster_stats: fosterStats || { cats_fostered: 0, current_fosters: 0 },
        places_linked: placesLinked?.count || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching person roles:", error);
    return NextResponse.json(
      { error: "Failed to fetch person roles" },
      { status: 500 }
    );
  }
}
