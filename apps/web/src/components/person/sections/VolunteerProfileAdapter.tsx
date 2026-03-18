"use client";

import { VolunteerBadge } from "@/components/badges";
import { formatDateLocal } from "@/lib/formatters";
import type { SectionProps } from "@/lib/person-roles/types";

export function VolunteerProfileAdapter({ data }: SectionProps) {
  const volunteerRoles = data.volunteerRoles;
  if (!volunteerRoles) return null;

  return (
    <>
      {/* Role badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        {volunteerRoles.roles
          .filter(r => r.role_status === "active")
          .map(r => {
            if (r.role === "trapper") return null;
            return (
              <VolunteerBadge
                key={r.role}
                role={r.role as "volunteer" | "foster" | "caretaker" | "staff"}
                size="md"
                groupNames={volunteerRoles.volunteer_groups.active.map(g => g.name)}
              />
            );
          })
        }
        {volunteerRoles.volunteer_profile?.is_active === false && (
          <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 500 }}>Inactive</span>
        )}
      </div>

      {/* Active Groups */}
      {volunteerRoles.volunteer_groups.active.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Active Groups</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            {volunteerRoles.volunteer_groups.active.map(g => (
              <span key={g.name} style={{
                display: "inline-block", padding: "0.2rem 0.5rem", fontSize: "0.75rem",
                background: "var(--bg-secondary)", borderRadius: "9999px", color: "var(--text-primary)"
              }}>
                {g.name}
                {g.joined_at && <span style={{ color: "var(--text-muted)", marginLeft: "0.25rem" }}>({new Date(g.joined_at).toLocaleDateString()})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Activity stats */}
      {volunteerRoles.volunteer_profile && (
        <div className="detail-grid" style={{ marginBottom: "1rem" }}>
          {volunteerRoles.volunteer_profile.event_count != null && (
            <div className="detail-item">
              <span className="detail-label">Events</span>
              <span className="detail-value">{volunteerRoles.volunteer_profile.event_count}</span>
            </div>
          )}
          {volunteerRoles.volunteer_profile.joined && (
            <div className="detail-item">
              <span className="detail-label">Member Since</span>
              <span className="detail-value">{formatDateLocal(volunteerRoles.volunteer_profile.joined)}</span>
            </div>
          )}
          {volunteerRoles.volunteer_profile.last_activity && (
            <div className="detail-item">
              <span className="detail-label">Last Activity</span>
              <span className="detail-value">{formatDateLocal(volunteerRoles.volunteer_profile.last_activity)}</span>
            </div>
          )}
        </div>
      )}

      {/* Skills */}
      {volunteerRoles.volunteer_profile?.skills && Object.keys(volunteerRoles.volunteer_profile.skills).length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Skills &amp; Interests</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            {Object.entries(volunteerRoles.volunteer_profile.skills)
              .filter(([, v]) => v && v !== "false" && v !== "No")
              .map(([key, value]) => (
                <span key={key} style={{
                  display: "inline-block", padding: "0.2rem 0.5rem", fontSize: "0.7rem",
                  background: "var(--success-bg)", color: "#166534", borderRadius: "9999px", border: "1px solid var(--success-border)",
                }} title={String(value)}>
                  {key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              ))
            }
          </div>
        </div>
      )}

      {/* Notes */}
      {volunteerRoles.volunteer_profile?.notes && (
        <div style={{ padding: "0.75rem", background: "var(--bg-secondary)", borderRadius: "6px", fontSize: "0.85rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Volunteer Notes</div>
          {volunteerRoles.volunteer_profile.notes}
        </div>
      )}
    </>
  );
}
