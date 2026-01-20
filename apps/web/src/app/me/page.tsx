"use client";

import { useState, useEffect } from "react";
import { ReminderCard } from "@/components/ReminderCard";
import { LookupViewerModal } from "@/components/LookupViewerModal";

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

interface Lookup {
  lookup_id: string;
  title: string;
  query_text: string;
  summary: string | null;
  result_data: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  tool_calls?: unknown[] | null;
  created_at: string;
}

interface StaffMessage {
  message_id: string;
  sender_staff_id: string | null;
  sender_name: string;
  subject: string;
  content: string;
  priority: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  status: string;
  read_at: string | null;
  source: string;
  created_at: string;
  age_display: string;
}

type ReminderFilter = "pending" | "completed" | "archived" | "all";
type MessageFilter = "unread" | "read" | "archived" | "all";

export default function MyDashboardPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [lookups, setLookups] = useState<Lookup[]>([]);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>("pending");
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("unread");
  const [selectedLookup, setSelectedLookup] = useState<Lookup | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<StaffMessage | null>(null);
  const [loadingLookupDetail, setLoadingLookupDetail] = useState(false);

  const fetchReminders = async (status: ReminderFilter) => {
    setLoadingReminders(true);
    try {
      const res = await fetch(`/api/me/reminders?status=${status}`);
      if (!res.ok) {
        if (res.status === 401) {
          setReminders([]);
          return;
        }
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch (err) {
      console.error("Error fetching reminders:", err);
    } finally {
      setLoadingReminders(false);
    }
  };

  const fetchLookups = async () => {
    try {
      const res = await fetch("/api/me/lookups");
      if (!res.ok) {
        if (res.status === 401) {
          setLookups([]);
          return;
        }
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setLookups(data.lookups || []);
    } catch (err) {
      console.error("Error fetching lookups:", err);
    } finally {
      setLoadingLookups(false);
    }
  };

  const fetchMessages = async (status: MessageFilter) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/me/messages?status=${status}`);
      if (!res.ok) {
        if (res.status === 401) {
          setMessages([]);
          return;
        }
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setMessages(data.messages || []);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    fetchReminders(reminderFilter);
    fetchLookups();
    fetchMessages(messageFilter);
  }, []);

  useEffect(() => {
    fetchReminders(reminderFilter);
  }, [reminderFilter]);

  useEffect(() => {
    fetchMessages(messageFilter);
  }, [messageFilter]);

  const handleComplete = async (id: string) => {
    const res = await fetch(`/api/me/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (res.ok) {
      fetchReminders(reminderFilter);
    }
  };

  const handleSnooze = async (id: string, until: string) => {
    const res = await fetch(`/api/me/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snooze_until: until }),
    });
    if (res.ok) {
      fetchReminders(reminderFilter);
    }
  };

  const handleArchiveReminder = async (id: string) => {
    const res = await fetch(`/api/me/reminders/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      fetchReminders(reminderFilter);
    }
  };

  const handleMarkMessageRead = async (id: string) => {
    const res = await fetch(`/api/me/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "read" }),
    });
    if (res.ok) {
      fetchMessages(messageFilter);
    }
  };

  const handleArchiveMessage = async (id: string) => {
    const res = await fetch(`/api/me/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (res.ok) {
      fetchMessages(messageFilter);
      setSelectedMessage(null);
    }
  };

  const handleViewMessage = (msg: StaffMessage) => {
    setSelectedMessage(msg);
    // Auto-mark as read when viewing
    if (msg.status === "unread") {
      handleMarkMessageRead(msg.message_id);
    }
  };

  const getEntityLink = (entityType: string | null, entityId: string | null) => {
    if (!entityType || !entityId) return null;
    const paths: Record<string, string> = {
      place: `/places/${entityId}`,
      cat: `/cats/${entityId}`,
      person: `/people/${entityId}`,
      request: `/requests/${entityId}`,
    };
    return paths[entityType] || null;
  };

  const handleViewLookup = async (lookup: Lookup) => {
    setLoadingLookupDetail(true);
    try {
      const res = await fetch(`/api/me/lookups/${lookup.lookup_id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLookup(data.lookup);
      }
    } catch (err) {
      console.error("Error fetching lookup detail:", err);
    } finally {
      setLoadingLookupDetail(false);
    }
  };

  const handleArchiveLookup = async (id: string) => {
    const res = await fetch(`/api/me/lookups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (res.ok) {
      fetchLookups();
    }
  };

  const handleDeleteLookup = async (id: string) => {
    const res = await fetch(`/api/me/lookups/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      fetchLookups();
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const filterButtons: { key: ReminderFilter; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "archived", label: "Archived" },
    { key: "all", label: "All" },
  ];

  const messageFilterButtons: { key: MessageFilter; label: string }[] = [
    { key: "unread", label: "Unread" },
    { key: "read", label: "Read" },
    { key: "archived", label: "Archived" },
    { key: "all", label: "All" },
  ];

  const priorityColors: Record<string, { bg: string; text: string }> = {
    urgent: { bg: "#fee2e2", text: "#b91c1c" },
    high: { bg: "#fef3c7", text: "#b45309" },
    normal: { bg: "#e5e7eb", text: "#374151" },
    low: { bg: "#f3f4f6", text: "#6b7280" },
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>My Dashboard</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
          Your messages, reminders, and saved lookups
        </p>
      </div>

      {/* Reminders Section */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
            Reminders {!loadingReminders && `(${reminders.length})`}
          </h2>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {filterButtons.map((btn) => (
              <button
                key={btn.key}
                onClick={() => setReminderFilter(btn.key)}
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.8rem",
                  background: reminderFilter === btn.key ? "#0d6efd" : "transparent",
                  color: reminderFilter === btn.key ? "#fff" : "var(--foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {loadingReminders ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            Loading reminders...
          </div>
        ) : reminders.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--card-bg, rgba(0,0,0,0.03))",
              borderRadius: "8px",
            }}
          >
            <div style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>
              {reminderFilter === "pending"
                ? "No pending reminders"
                : reminderFilter === "completed"
                  ? "No completed reminders"
                  : reminderFilter === "archived"
                    ? "No archived reminders"
                    : "No reminders"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Ask Tippy: "Remind me to check on Oak St colony tomorrow"
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {reminders.map((reminder) => (
              <ReminderCard
                key={reminder.reminder_id}
                reminder={reminder}
                onComplete={handleComplete}
                onSnooze={handleSnooze}
                onArchive={handleArchiveReminder}
              />
            ))}
          </div>
        )}
      </section>

      {/* Messages Section */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
            Messages{" "}
            {!loadingMessages && (
              <>
                ({messages.length})
                {unreadCount > 0 && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      padding: "0.15rem 0.5rem",
                      background: "#ef4444",
                      color: "#fff",
                      borderRadius: "9999px",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                    }}
                  >
                    {unreadCount} new
                  </span>
                )}
              </>
            )}
          </h2>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {messageFilterButtons.map((btn) => (
              <button
                key={btn.key}
                onClick={() => setMessageFilter(btn.key)}
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.8rem",
                  background: messageFilter === btn.key ? "#0d6efd" : "transparent",
                  color: messageFilter === btn.key ? "#fff" : "var(--foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {loadingMessages ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--card-bg, rgba(0,0,0,0.03))",
              borderRadius: "8px",
            }}
          >
            <div style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>
              {messageFilter === "unread"
                ? "No unread messages"
                : messageFilter === "read"
                  ? "No read messages"
                  : messageFilter === "archived"
                    ? "No archived messages"
                    : "No messages"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Staff can send you messages via Tippy: "Tell [your name] that..."
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {messages.map((msg) => (
              <div
                key={msg.message_id}
                onClick={() => handleViewMessage(msg)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  padding: "1rem",
                  background: msg.status === "unread" ? "var(--card-bg, rgba(0,0,0,0.05))" : "var(--card-bg, rgba(0,0,0,0.02))",
                  borderRadius: "8px",
                  cursor: "pointer",
                  borderLeft: msg.status === "unread" ? "3px solid #0d6efd" : "3px solid transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span style={{ fontWeight: msg.status === "unread" ? 600 : 500 }}>
                      {msg.sender_name}
                    </span>
                    {msg.priority !== "normal" && (
                      <span
                        style={{
                          padding: "0.1rem 0.4rem",
                          fontSize: "0.65rem",
                          fontWeight: 500,
                          borderRadius: "4px",
                          background: priorityColors[msg.priority]?.bg || "#e5e7eb",
                          color: priorityColors[msg.priority]?.text || "#374151",
                          textTransform: "uppercase",
                        }}
                      >
                        {msg.priority}
                      </span>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "auto" }}>
                      {msg.age_display}
                    </span>
                  </div>
                  <div style={{ fontWeight: msg.status === "unread" ? 500 : 400, marginBottom: "0.25rem" }}>
                    {msg.subject}
                  </div>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.content.substring(0, 100)}
                    {msg.content.length > 100 && "..."}
                  </div>
                  {msg.entity_label && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      Re: {msg.entity_label}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Lookups Section */}
      <section>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>
          Saved Lookups {!loadingLookups && `(${lookups.length})`}
        </h2>

        {loadingLookups ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            Loading lookups...
          </div>
        ) : lookups.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--card-bg, rgba(0,0,0,0.03))",
              borderRadius: "8px",
            }}
          >
            <div style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>No saved lookups</div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Ask Tippy: "Find info on 123 Oak St and save to my lookups"
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {lookups.map((lookup) => (
              <div
                key={lookup.lookup_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "1rem",
                  background: "var(--card-bg, rgba(0,0,0,0.03))",
                  borderRadius: "8px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>{lookup.title}</div>
                  {lookup.summary && (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lookup.summary}
                    </div>
                  )}
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    {formatDate(lookup.created_at)}
                    {lookup.entity_display && ` · ${lookup.entity_display}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, marginLeft: "1rem" }}>
                  <button
                    onClick={() => handleViewLookup(lookup)}
                    disabled={loadingLookupDetail}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.8rem",
                      background: "#0d6efd",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDeleteLookup(lookup.lookup_id)}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.8rem",
                      background: "transparent",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Lookup Detail Modal */}
      {selectedLookup && (
        <LookupViewerModal
          lookup={selectedLookup}
          onClose={() => setSelectedLookup(null)}
          onArchive={handleArchiveLookup}
        />
      )}

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setSelectedMessage(null)}
        >
          <div
            style={{
              background: "var(--card-bg, #fff)",
              borderRadius: "12px",
              width: "500px",
              maxHeight: "80vh",
              overflow: "auto",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "16px",
              }}
            >
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
                  {selectedMessage.subject}
                </h3>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
                  From: {selectedMessage.sender_name} · {selectedMessage.age_display}
                </div>
              </div>
              <button
                onClick={() => setSelectedMessage(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "var(--muted)",
                }}
              >
                x
              </button>
            </div>

            {selectedMessage.priority !== "normal" && (
              <div
                style={{
                  display: "inline-block",
                  padding: "0.2rem 0.6rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  borderRadius: "4px",
                  background: priorityColors[selectedMessage.priority]?.bg || "#e5e7eb",
                  color: priorityColors[selectedMessage.priority]?.text || "#374151",
                  textTransform: "uppercase",
                  marginBottom: "16px",
                }}
              >
                {selectedMessage.priority} priority
              </div>
            )}

            <div
              style={{
                background: "var(--section-bg, #f9fafb)",
                padding: "16px",
                borderRadius: "8px",
                marginBottom: "16px",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
              }}
            >
              {selectedMessage.content}
            </div>

            {selectedMessage.entity_label && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "4px" }}>
                  Related to:
                </div>
                {getEntityLink(selectedMessage.entity_type, selectedMessage.entity_id) ? (
                  <a
                    href={getEntityLink(selectedMessage.entity_type, selectedMessage.entity_id)!}
                    style={{
                      color: "#0d6efd",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {selectedMessage.entity_label}
                  </a>
                ) : (
                  <span>{selectedMessage.entity_label}</span>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              {selectedMessage.status !== "archived" && (
                <button
                  onClick={() => handleArchiveMessage(selectedMessage.message_id)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.85rem",
                    background: "transparent",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Archive
                </button>
              )}
              <button
                onClick={() => setSelectedMessage(null)}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.85rem",
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
