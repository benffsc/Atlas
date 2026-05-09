"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  link_url: string | null;
  source: string;
  is_read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await fetchApi("/api/notifications") as {
        notifications?: Notification[];
        unread_count?: number;
      };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // Silent — non-blocking
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const markRead = async (id: string) => {
    try {
      await fetchApi(`/api/notifications/${id}`, {
        method: "PATCH",
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Silent
    }
  };

  const markAllRead = async () => {
    try {
      await postApi("/api/notifications", { action: "mark_all_read" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Silent
    }
  };

  const handleClick = (n: Notification) => {
    if (!n.is_read) markRead(n.id);
    if (n.link_url) {
      router.push(n.link_url);
      setOpen(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px",
          color: "var(--foreground)",
          opacity: 0.7,
        }}
      >
        <Icon name="Bell" size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: "16px",
              height: "16px",
              borderRadius: "8px",
              background: "var(--danger)",
              color: "#fff",
              fontSize: "0.6rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: "4px",
            width: "340px",
            maxHeight: "400px",
            overflowY: "auto",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: "8px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid var(--card-border)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--primary)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--muted)", fontSize: "0.8rem" }}>
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  background: n.is_read ? "transparent" : "var(--primary-bg, rgba(59,130,246,0.05))",
                  border: "none",
                  borderBottom: "1px solid var(--card-border)",
                  cursor: n.link_url ? "pointer" : "default",
                  color: "var(--foreground)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: n.is_read ? 400 : 600, lineHeight: 1.3 }}>
                    {n.title}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {timeAgo(n.created_at)}
                  </span>
                </div>
                {n.body && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>
                    {n.body}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
