"use client";

import { useState, useEffect } from "react";
import { ReminderCard } from "@/components/cards";

interface Reminder {
  reminder_id: string;
  title: string;
  notes?: string | null;
  entity_type?: string | null;
  entity_display?: string | null;
  entity_id?: string | null;
  due_at: string;
  remind_at: string;
  status: string;
  snooze_count: number;
}

interface MyItemsWidgetProps {
  maxItems?: number;
}

export function MyItemsWidget({ maxItems = 3 }: MyItemsWidgetProps) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReminders = async () => {
    try {
      const res = await fetch("/api/me/reminders?status=pending");
      if (!res.ok) {
        if (res.status === 401) {
          setReminders([]);
          return;
        }
        throw new Error("Failed to fetch reminders");
      }
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const handleComplete = async (id: string) => {
    const res = await fetch(`/api/me/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (res.ok) {
      setReminders((prev) => prev.filter((r) => r.reminder_id !== id));
    }
  };

  const handleSnooze = async (id: string, until: string) => {
    const res = await fetch(`/api/me/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snooze_until: until }),
    });
    if (res.ok) {
      fetchReminders();
    }
  };

  if (loading) {
    return (
      <div
        style={{
          background: "var(--card-bg, rgba(0,0,0,0.03))",
          borderRadius: "8px",
          padding: "1rem",
        }}
      >
        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return null;
  }

  const displayReminders = reminders.slice(0, maxItems);
  const hasMore = reminders.length > maxItems;

  return (
    <div
      style={{
        background: "var(--card-bg, rgba(0,0,0,0.03))",
        borderRadius: "8px",
        padding: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          My Items {reminders.length > 0 && `(${reminders.length})`}
        </h3>
        <a
          href="/me"
          style={{
            fontSize: "0.8rem",
            color: "#0d6efd",
            textDecoration: "none",
          }}
        >
          View all →
        </a>
      </div>

      {displayReminders.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
          No pending reminders. Ask Tippy to create one!
        </div>
      ) : (
        <div>
          {displayReminders.map((reminder) => (
            <ReminderCard
              key={reminder.reminder_id}
              reminder={reminder}
              compact
              onComplete={handleComplete}
              onSnooze={handleSnooze}
            />
          ))}
          {hasMore && (
            <div style={{ textAlign: "center", paddingTop: "0.5rem" }}>
              <a
                href="/me"
                style={{
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                +{reminders.length - maxItems} more
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
