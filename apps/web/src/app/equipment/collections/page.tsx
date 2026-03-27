"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { getLabel, EQUIPMENT_COLLECTION_STATUS_OPTIONS } from "@/lib/form-options";
import { SkeletonList } from "@/components/feedback/Skeleton";
import type { EquipmentCollectionTaskRow } from "@/lib/types/view-contracts";

const STATUS_COLORS: Record<string, string> = {
  pending: "#b45309",
  contacted: "#1e40af",
  will_return: "#166534",
  do_not_collect: "#6b7280",
  no_traps: "#6b7280",
  collected: "#166534",
};

export default function CollectionsPage() {
  const { success, error: showError } = useToast();
  const [tasks, setTasks] = useState<EquipmentCollectionTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "100");
      const data = await fetchApi<{ tasks: EquipmentCollectionTaskRow[] }>(
        `/api/equipment/collections?${params}`
      );
      setTasks(data.tasks || []);
      const raw = await fetch(`/api/equipment/collections?${params}`).then(r => r.json());
      setTotal(raw.meta?.total || data.tasks?.length || 0);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load collections");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showError]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateStatus = useCallback(async (taskId: string, newStatus: string) => {
    try {
      await fetch("/api/equipment/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, collection_status: newStatus }),
      });
      success(`Status updated to ${getLabel(EQUIPMENT_COLLECTION_STATUS_OPTIONS, newStatus)}`);
      fetchTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Update failed");
    }
  }, [fetchTasks, success, showError]);

  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.collection_status] = (acc[t.collection_status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Equipment Collections</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
          Follow-up tasks for collecting FFSC equipment from community members ({total} tasks)
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
        <StatCard label="Pending" value={statusCounts.pending || 0} valueColor="#b45309" />
        <StatCard label="Contacted" value={statusCounts.contacted || 0} valueColor="#1e40af" />
        <StatCard label="Will Return" value={statusCounts.will_return || 0} valueColor="#166534" />
        <StatCard label="Collected" value={statusCounts.collected || 0} valueColor="#166534" />
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Status</option>
          {EQUIPMENT_COLLECTION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Task List */}
      {loading ? (
        <div style={{ padding: "0.5rem 0" }}><SkeletonList items={5} /></div>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No collection tasks found.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {tasks.map((task) => (
            <div
              key={task.task_id}
              className="card"
              style={{
                padding: "0.75rem 1rem",
                borderLeft: `3px solid ${STATUS_COLORS[task.collection_status] || "#d1d5db"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{task.person_name}</div>
                  {task.phone && (
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.125rem" }}>
                      <a href={`tel:${task.phone}`} style={{ color: "var(--link)", textDecoration: "none" }}>
                        {task.phone}
                      </a>
                    </div>
                  )}
                  {task.equipment_description && (
                    <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                      {task.equipment_description}
                      {task.trap_count != null && (
                        <span style={{ color: "var(--muted)" }}> ({task.trap_count} trap{task.trap_count !== 1 ? "s" : ""})</span>
                      )}
                    </div>
                  )}
                  {task.notes && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem", fontStyle: "italic" }}>
                      {task.notes}
                    </div>
                  )}
                  {task.last_contacted_at && (
                    <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      Last contacted: {new Date(task.last_contacted_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                  <span style={{
                    padding: "0.125rem 0.5rem",
                    borderRadius: "12px",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    background: (STATUS_COLORS[task.collection_status] || "#6b7280") + "18",
                    color: STATUS_COLORS[task.collection_status] || "#6b7280",
                    whiteSpace: "nowrap",
                  }}>
                    {getLabel(EQUIPMENT_COLLECTION_STATUS_OPTIONS, task.collection_status)}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              {task.collection_status !== "collected" && task.collection_status !== "no_traps" && (
                <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                  {task.collection_status === "pending" && (
                    <ActionButton label="Mark Contacted" onClick={() => updateStatus(task.task_id, "contacted")} />
                  )}
                  {(task.collection_status === "contacted" || task.collection_status === "pending") && (
                    <ActionButton label="Will Return" onClick={() => updateStatus(task.task_id, "will_return")} />
                  )}
                  <ActionButton label="Collected" onClick={() => updateStatus(task.task_id, "collected")} variant="success" />
                  <ActionButton label="No Traps" onClick={() => updateStatus(task.task_id, "no_traps")} variant="muted" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, onClick, variant }: { label: string; onClick: () => void; variant?: "success" | "muted" }) {
  const colors = {
    success: { bg: "#16653418", color: "#166534", border: "#16653440" },
    muted: { bg: "#6b728018", color: "#6b7280", border: "#6b728040" },
    default: { bg: "transparent", color: "var(--text)", border: "var(--border)" },
  };
  const c = colors[variant || "default"];

  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.25rem 0.5rem",
        fontSize: "0.75rem",
        borderRadius: "4px",
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.color,
        cursor: "pointer",
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
