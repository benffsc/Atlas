"use client";

interface TrapperBadgeProps {
  trapperType: string;
  size?: "sm" | "md";
  inactive?: boolean;
}

const trapperInfo: Record<
  string,
  { label: string; bg: string; title: string }
> = {
  coordinator: {
    label: "Trapping Coordinator",
    bg: "#6f42c1",
    title: "FFSC Staff Coordinator",
  },
  head_trapper: {
    label: "Head Trapper",
    bg: "#0d6efd",
    title: "FFSC Head Trapper",
  },
  ffsc_trapper: {
    label: "FFSC Trapper",
    bg: "#198754",
    title: "FFSC Trained Volunteer (completed orientation)",
  },
  community_trapper: {
    label: "Community Trapper",
    bg: "#fd7e14",
    title: "Contract signer - limited scope, does not represent FFSC",
  },
};

export function TrapperBadge({ trapperType, size = "md", inactive = false }: TrapperBadgeProps) {
  const info = trapperInfo[trapperType] || {
    label: "Trapper",
    bg: "#6c757d",
    title: "Trapper",
  };

  const fontSize = size === "sm" ? "0.65rem" : "0.75rem";
  const padding = size === "sm" ? "0.15rem 0.4rem" : "0.25rem 0.5rem";

  // Grey out for inactive trappers
  const bgColor = inactive ? "#9ca3af" : info.bg;
  const statusText = inactive ? " (Inactive)" : "";

  return (
    <span
      className="badge"
      style={{
        background: bgColor,
        color: "#fff",
        fontSize,
        padding,
        fontWeight: 500,
        opacity: inactive ? 0.7 : 1,
      }}
      title={info.title + statusText}
    >
      {info.label}
    </span>
  );
}

// Small inline version for lists
export function TrapperTypePill({ trapperType }: { trapperType: string }) {
  const isFFSC = ["coordinator", "head_trapper", "ffsc_trapper"].includes(
    trapperType
  );

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.7rem",
        color: isFFSC ? "#198754" : "#fd7e14",
      }}
      title={isFFSC ? "FFSC Trapper" : "Community Trapper"}
    >
      <span style={{ fontSize: "0.8rem" }}>{isFFSC ? "FFSC" : "Community"}</span>
    </span>
  );
}
