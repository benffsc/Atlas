"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { Button } from "@/components/ui/Button";
import { TabBar } from "@/components/ui/TabBar";
import { EmptyList } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { Icon } from "@/components/ui/Icon";

interface Meeting {
  meeting_id: string;
  title: string;
  meeting_date: string | null;
  status: string;
  description: string | null;
  slide_count: number;
  created_at: string;
  updated_at: string;
}

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "ready", label: "Ready" },
  { id: "presented", label: "Presented" },
  { id: "archived", label: "Archived" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "var(--bg-secondary)", text: "var(--text-secondary)" },
  ready: { bg: "var(--success-bg)", text: "var(--success-text)" },
  presented: { bg: "var(--primary-light)", text: "var(--primary)" },
  archived: { bg: "var(--bg-secondary)", text: "var(--text-muted)" },
};

function MeetingsContent() {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const { filters, setFilter } = useUrlFilters({ status: "all" });
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = filters.status !== "all" ? `&status=${filters.status}` : "";
      const res = await fetchApi<{ meetings: Meeting[] }>(
        `/api/meetings?limit=50${statusParam}`
      );
      setMeetings(res.meetings);
    } catch {
      toastError("Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, [filters.status, toastError]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await postApi<{ meeting: Meeting }>("/api/meetings", {
        title: `Trapper Meeting - ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
      });
      toastSuccess("Meeting created");
      router.push(`/trappers/meetings/${res.meeting.meeting_id}`);
    } catch {
      toastError("Failed to create meeting");
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "No date set";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Trapper Meetings</h1>
        <Button icon="plus" loading={creating} onClick={handleCreate}>
          New Meeting
        </Button>
      </div>

      <TabBar
        tabs={STATUS_TABS}
        activeTab={filters.status}
        onTabChange={(tab) => setFilter("status", tab)}
      />

      {loading ? (
        <SkeletonList items={3} />
      ) : meetings.length === 0 ? (
        <EmptyList entityName="meetings" onAdd={handleCreate} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {meetings.map((m) => {
            const colors = STATUS_COLORS[m.status] || STATUS_COLORS.draft;
            return (
              <div
                key={m.meeting_id}
                onClick={() => router.push(`/trappers/meetings/${m.meeting_id}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "1rem 1.25rem",
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "box-shadow 150ms ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-sm)")}
                onMouseOut={(e) => (e.currentTarget.style.boxShadow = "none")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "8px",
                    background: "var(--primary-light)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="presentation" size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{m.title}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {formatDate(m.meeting_date)}
                      <span style={{ margin: "0 0.5rem" }}>·</span>
                      {m.slide_count} slide{m.slide_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <span style={{
                  padding: "0.2rem 0.6rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  background: colors.bg,
                  color: colors.text,
                }}>
                  {m.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={<SkeletonList items={4} />}>
      <MeetingsContent />
    </Suspense>
  );
}
