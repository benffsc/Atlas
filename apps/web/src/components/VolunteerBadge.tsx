"use client";

interface VolunteerBadgeProps {
  role: "volunteer" | "foster" | "caretaker" | "staff";
  groupNames?: string[];
  size?: "sm" | "md";
  inactive?: boolean;
}

const roleInfo: Record<string, { label: string; bg: string; title: string }> = {
  foster: { label: "Foster", bg: "#ec4899", title: "FFSC Approved Foster Parent" },
  caretaker: { label: "Colony Caretaker", bg: "#06b6d4", title: "Colony Caretaker" },
  volunteer: { label: "Volunteer", bg: "#8b5cf6", title: "FFSC Approved Volunteer" },
  staff: { label: "Staff", bg: "#6366f1", title: "FFSC Staff Member" },
};

export function VolunteerBadge({ role, groupNames, size = "md", inactive = false }: VolunteerBadgeProps) {
  const info = roleInfo[role] || { label: "Volunteer", bg: "#6c757d", title: "Volunteer" };
  const fontSize = size === "sm" ? "0.65rem" : "0.75rem";
  const padding = size === "sm" ? "0.15rem 0.4rem" : "0.25rem 0.5rem";
  const bgColor = inactive ? "#9ca3af" : info.bg;
  const statusText = inactive ? " (Inactive)" : "";
  const groupText = groupNames && groupNames.length > 0 ? ` — ${groupNames.join(", ")}` : "";
  return (
    <span className="badge" style={{ background: bgColor, color: "#fff", fontSize, padding, fontWeight: 500, opacity: inactive ? 0.7 : 1 }} title={info.title + groupText + statusText}>
      {info.label}
    </span>
  );
}
