"use client";

import { useState, useEffect } from "react";
import { ReminderCard } from "@/components/cards";
import { fetchApi, postApi } from "@/lib/api-client";
import { SkeletonList } from "@/components/feedback/Skeleton";

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
      const data = await fetchApi<{ reminders: Reminder[] }>("/api/me/reminders?status=pending");
      setReminders(data.reminders || []);
    } catch (err) {
      // 401 means not logged in — just show empty
      if (err instanceof Error && "code" in err && (err as { code: number }).code === 401) {
        setReminders([]);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const handleComplete = async (id: string) => {
    try {
      await postApi(`/api/me/reminders/${id}`, { status: "completed" }, { method: "PATCH" });
      setReminders((prev) => prev.filter((r) => r.reminder_id !== id));
    } catch (err) {
      console.error("Error completing reminder:", err);
    }
  };

  const handleSnooze = async (id: string, until: string) => {
    try {
      await postApi(`/api/me/reminders/${id}`, { snooze_until: until }, { method: "PATCH" });
      fetchReminders();
    } catch (err) {
      console.error("Error snoozing reminder:", err);
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
        <SkeletonList items={3} />
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
