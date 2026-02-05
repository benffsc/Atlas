"use client";

import { useState } from "react";
import { SnoozePicker } from "./SnoozePicker";
import { formatPhone } from "@/lib/formatters";

interface ContactInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

interface Reminder {
  reminder_id: string;
  title: string;
  notes?: string | null;
  entity_type?: string | null;
  entity_display?: string | null;
  entity_id?: string | null;
  contact_info?: ContactInfo | null;
  due_at: string;
  remind_at: string;
  status: string;
  snooze_count: number;
}

interface ReminderCardProps {
  reminder: Reminder;
  compact?: boolean;
  onComplete: (id: string) => Promise<void>;
  onSnooze: (id: string, until: string) => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
}

export function ReminderCard({
  reminder,
  compact = false,
  onComplete,
  onSnooze,
  onArchive,
}: ReminderCardProps) {
  const [loading, setLoading] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isOverdue = new Date(reminder.due_at) < new Date();
  const isDueToday = new Date(reminder.due_at).toDateString() === new Date().toDateString();
  const hasContactInfo = reminder.contact_info && (
    reminder.contact_info.name ||
    reminder.contact_info.phone ||
    reminder.contact_info.email ||
    reminder.contact_info.address
  );

  const handleComplete = async () => {
    setLoading(true);
    try {
      await onComplete(reminder.reminder_id);
    } finally {
      setLoading(false);
    }
  };

  const handleSnooze = async (until: string) => {
    setLoading(true);
    try {
      await onSnooze(reminder.reminder_id, until);
      setShowSnooze(false);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!onArchive) return;
    setLoading(true);
    try {
      await onArchive(reminder.reminder_id);
    } finally {
      setLoading(false);
    }
  };

  const formatDueDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getEntityLink = () => {
    if (!reminder.entity_type || !reminder.entity_id) return null;
    const typeToPath: Record<string, string> = {
      place: "/places",
      cat: "/cats",
      person: "/people",
      request: "/requests",
      intake: "/intake",
    };
    const basePath = typeToPath[reminder.entity_type];
    if (!basePath) return null;
    return `${basePath}/${reminder.entity_id}`;
  };

  const entityLink = getEntityLink();

  if (compact) {
    return (
      <div
        style={{
          padding: "0.5rem 0",
          borderBottom: "1px solid var(--border)",
          opacity: loading ? 0.6 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: hasContactInfo ? "pointer" : "default",
          }}
          onClick={() => hasContactInfo && setExpanded(!expanded)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: isOverdue ? "#dc3545" : isDueToday ? "#f59e0b" : "#6c757d",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.9rem",
              }}
            >
              {reminder.title}
              {hasContactInfo && (
                <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.75rem" }}>
                  {expanded ? "▼" : "▶"}
                </span>
              )}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <span style={{ fontSize: "0.75rem", color: isOverdue ? "#dc3545" : "var(--muted)" }}>
              {formatDueDate(reminder.due_at)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleComplete(); }}
              disabled={loading}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              Done
            </button>
          </div>
        </div>
        {/* Expanded contact info */}
        {expanded && hasContactInfo && reminder.contact_info && (
          <div
            style={{
              marginTop: "0.5rem",
              marginLeft: "1rem",
              padding: "0.75rem",
              background: "var(--section-bg)",
              borderRadius: "6px",
              fontSize: "0.85rem",
            }}
          >
            {reminder.contact_info.name && (
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                {reminder.contact_info.name}
              </div>
            )}
            {reminder.contact_info.phone && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>Phone:</span>
                <a href={`tel:${reminder.contact_info.phone}`} style={{ color: "#0d6efd" }}>
                  {formatPhone(reminder.contact_info.phone)}
                </a>
              </div>
            )}
            {reminder.contact_info.email && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>Email:</span>
                <a href={`mailto:${reminder.contact_info.email}`} style={{ color: "#0d6efd" }}>
                  {reminder.contact_info.email}
                </a>
              </div>
            )}
            {reminder.contact_info.address && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>Address:</span>
                <span>{reminder.contact_info.address}</span>
              </div>
            )}
            {reminder.contact_info.notes && (
              <div style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                {reminder.contact_info.notes}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "1rem",
        background: "var(--card-bg, rgba(0,0,0,0.05))",
        borderRadius: "8px",
        borderLeft: `4px solid ${isOverdue ? "#dc3545" : isDueToday ? "#f59e0b" : "#6c757d"}`,
        opacity: loading ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{reminder.title}</div>
          {reminder.notes && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              {reminder.notes}
            </div>
          )}
          {entityLink && (
            <a
              href={entityLink}
              style={{
                fontSize: "0.8rem",
                color: "#0d6efd",
                textDecoration: "none",
              }}
            >
              {reminder.entity_display || `View ${reminder.entity_type}`}
            </a>
          )}
          {/* Contact info section */}
          {hasContactInfo && reminder.contact_info && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "var(--section-bg)",
                borderRadius: "6px",
                fontSize: "0.85rem",
              }}
            >
              {reminder.contact_info.name && (
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {reminder.contact_info.name}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
                {reminder.contact_info.phone && (
                  <div>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>Phone: </span>
                    <a href={`tel:${reminder.contact_info.phone}`} style={{ color: "#0d6efd" }}>
                      {formatPhone(reminder.contact_info.phone)}
                    </a>
                  </div>
                )}
                {reminder.contact_info.email && (
                  <div>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>Email: </span>
                    <a href={`mailto:${reminder.contact_info.email}`} style={{ color: "#0d6efd" }}>
                      {reminder.contact_info.email}
                    </a>
                  </div>
                )}
              </div>
              {reminder.contact_info.address && (
                <div style={{ marginTop: "0.25rem" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>Address: </span>
                  <span>{reminder.contact_info.address}</span>
                </div>
              )}
              {reminder.contact_info.notes && (
                <div style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontStyle: "italic", fontSize: "0.8rem" }}>
                  {reminder.contact_info.notes}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: isOverdue ? "#dc3545" : isDueToday ? "#f59e0b" : "var(--foreground)",
            }}
          >
            {formatDueDate(reminder.due_at)}
          </div>
          {reminder.snooze_count > 0 && (
            <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
              Snoozed {reminder.snooze_count}x
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button
          onClick={handleComplete}
          disabled={loading}
          style={{
            padding: "0.4rem 0.75rem",
            fontSize: "0.8rem",
            background: "#198754",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Done
        </button>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowSnooze(!showSnooze)}
            disabled={loading}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.8rem",
              background: "var(--background)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            Snooze
          </button>
          {showSnooze && (
            <SnoozePicker
              onSelect={handleSnooze}
              onClose={() => setShowSnooze(false)}
            />
          )}
        </div>
        {onArchive && (
          <button
            onClick={handleArchive}
            disabled={loading}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.8rem",
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: loading ? "not-allowed" : "pointer",
              marginLeft: "auto",
            }}
          >
            Archive
          </button>
        )}
      </div>
    </div>
  );
}
