"use client";

import { useState, useEffect } from "react";
import { useGeoConfig } from "@/hooks/useGeoConfig";

interface VolunteerStats {
  assigned_requests: number;
  observations_this_month: number;
  cats_helped: number;
}

interface AssignedRequest {
  request_id: string;
  status: string;
  place_name: string | null;
  place_city: string | null;
  estimated_cat_count: number | null;
  scheduled_date: string | null;
}

export default function VolunteerDashboard() {
  const { serviceAreaName } = useGeoConfig();
  const [stats, setStats] = useState<VolunteerStats | null>(null);
  const [requests, setRequests] = useState<AssignedRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch volunteer-specific data
    // For now, we'll just show a welcome page
    setLoading(false);
  }, []);

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
          Volunteer Dashboard
        </h1>
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
          Welcome back! Here's what you need to know.
        </p>
      </div>

      {/* Welcome Card */}
      <div
        className="card"
        style={{
          padding: "2rem",
          marginBottom: "2rem",
          background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
          border: "1px solid #a7f3d0",
        }}
      >
        <h2
          style={{
            margin: "0 0 1rem 0",
            fontSize: "1.25rem",
            color: "#065f46",
          }}
        >
          Thank You for Volunteering!
        </h2>
        <p style={{ margin: 0, color: "#047857", lineHeight: 1.6 }}>
          Your work helps community cats across {serviceAreaName}. As a volunteer,
          you can view request locations, track colony status, and log field
          observations.
        </p>
      </div>

      {/* Quick Actions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <QuickAction
          icon="📍"
          label="View Requests"
          description="See active trapping requests in your area"
          href="/requests"
        />
        <QuickAction
          icon="📝"
          label="Log Observation"
          description="Report a field observation or sighting"
          href="/trappers/observations"
        />
        <QuickAction
          icon="🌿"
          label="Beacon Analytics"
          description="View colony status and TNR progress"
          href="/beacon"
        />
        <QuickAction
          icon="❓"
          label="Ask Tippy"
          description="Get help navigating Atlas"
          onClick={() => {
            // Tippy chat is available via the floating button
            const tippy = document.querySelector(
              'button[title="Ask Tippy"]'
            ) as HTMLButtonElement;
            if (tippy) tippy.click();
          }}
        />
      </div>

      {/* Important Notes */}
      <div className="card" style={{ padding: "1.5rem" }}>
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>
          Volunteer Guidelines
        </h3>
        <ul
          style={{
            margin: 0,
            paddingLeft: "1.25rem",
            color: "var(--text-muted)",
            lineHeight: 1.8,
          }}
        >
          <li>
            <strong style={{ color: "var(--text)" }}>Privacy:</strong> Contact
            details are masked to protect requester privacy
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Coordination:</strong>{" "}
            Always coordinate with your assigned head trapper
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Reporting:</strong> Log
            observations promptly so we can track colony health
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Safety:</strong> Never
            approach aggressive animals without proper training
          </li>
        </ul>
      </div>

      {/* Contact Info */}
      <div
        style={{
          marginTop: "2rem",
          padding: "1.5rem",
          background: "var(--card-border)",
          borderRadius: "12px",
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Questions? Contact your coordinator or email{" "}
          <a href="mailto:volunteers@forgottenfelinessoco.org">
            volunteers@forgottenfelinessoco.org
          </a>
        </p>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  description,
  href,
  onClick,
}: {
  icon: string;
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
}) {
  const sharedStyle: React.CSSProperties = {
    padding: "1.25rem",
    textDecoration: "none",
    color: "inherit",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    transition: "transform 0.15s, box-shadow 0.15s",
    cursor: "pointer",
    background: "none",
    border: "none",
    textAlign: "left",
    width: "100%",
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = "translateY(-2px)";
    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = "none";
    e.currentTarget.style.boxShadow = "none";
  };

  const inner = (
    <>
      <span style={{ fontSize: "1.5rem" }}>{icon}</span>
      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{label}</div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        {description}
      </div>
    </>
  );

  if (onClick && !href) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card"
        style={sharedStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={href}
      onClick={onClick}
      className="card"
      style={sharedStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {inner}
    </a>
  );
}
