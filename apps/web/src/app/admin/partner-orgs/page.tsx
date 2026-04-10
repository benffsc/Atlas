"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { TabBar, TabPanel } from "@/components/ui/TabBar";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";

// --- Types ---

interface PartnerAnimal {
  id: string;
  partner_org_id: string;
  external_animal_id: string | null;
  name: string | null;
  sex: string | null;
  breed: string | null;
  colors: string | null;
  dob: string | null;
  microchip: string | null;
  altered: boolean;
  procedure_needed: string | null;
  priority: string | null;
  priority_meaning: string | null;
  status: string;
  foster_name: string | null;
  foster_phone: string | null;
  foster_email: string | null;
  foster_address: string | null;
  sub_location: string | null;
  intake_origin: string | null;
  intake_location: string | null;
  contact_notes: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  org_name: string;
  org_short_name: string;
}

interface Stats {
  total: number;
  needed: number;
  scheduled: number;
  completed: number;
  already_done: number;
  foster_handling: number;
  red: number;
  blue: number;
  yellow: number;
  pink: number;
}

interface PartnerOrg {
  id: string;
  name: string;
  short_name: string;
  animal_count: number;
}

// --- Priority & Status Styling ---

const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  Yellow: { bg: "rgba(234, 179, 8, 0.12)", color: "#a16207", border: "#eab308" },
  Blue: { bg: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", border: "#3b82f6" },
  Red: { bg: "rgba(239, 68, 68, 0.12)", color: "#b91c1c", border: "#ef4444" },
  Pink: { bg: "rgba(236, 72, 153, 0.12)", color: "#be185d", border: "#ec4899" },
};

const STATUS_OPTIONS = [
  { value: "needed", label: "Needed", color: "#dc2626" },
  { value: "scheduled", label: "Scheduled", color: "#2563eb" },
  { value: "foster_handling", label: "Foster Handling", color: "#7c3aed" },
  { value: "already_done", label: "Already Done", color: "#059669" },
  { value: "completed", label: "Completed", color: "#059669" },
  { value: "cancelled", label: "Cancelled", color: "#6b7280" },
];

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>-</span>;
  const s = PRIORITY_STYLES[priority] || PRIORITY_STYLES.Blue;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "9999px",
      fontSize: "0.7rem", fontWeight: 600, background: s.bg, color: s.color,
    }}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(o => o.value === status);
  const color = opt?.color || "#6b7280";
  const label = opt?.label || status;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "9999px",
      fontSize: "0.7rem", fontWeight: 600,
      background: `${color}15`, color,
    }}>
      {label}
    </span>
  );
}

// --- Expanded Row Detail ---

function AnimalDetail({
  animal,
  onUpdate,
}: {
  animal: PartnerAnimal;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  return (
    <tr>
      <td colSpan={8} style={{ padding: "1rem", background: "var(--section-bg)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
          {/* Col 1: Animal Info */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Animal</div>
            <div style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              <div><strong>ID:</strong> {animal.external_animal_id || "-"}</div>
              <div><strong>Breed:</strong> {animal.breed || "-"}</div>
              <div><strong>DOB:</strong> {animal.dob ? new Date(animal.dob).toLocaleDateString() : "Unknown"}</div>
              <div><strong>Microchip:</strong> {animal.microchip || "None"}</div>
              <div><strong>Placement:</strong> {animal.sub_location || "-"}</div>
            </div>
          </div>
          {/* Col 2: Foster Contact */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Foster Contact</div>
            <div style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              <div><strong>Name:</strong> {animal.foster_name || "Unknown"}</div>
              <div><strong>Phone:</strong> {animal.foster_phone ? (
                <a href={`tel:${animal.foster_phone}`} style={{ color: "var(--primary)" }}>{animal.foster_phone}</a>
              ) : "None"}</div>
              <div><strong>Email:</strong> {animal.foster_email ? (
                <a href={`mailto:${animal.foster_email}`} style={{ color: "var(--primary)" }}>{animal.foster_email}</a>
              ) : "None"}</div>
              <div><strong>Address:</strong> {animal.foster_address || "-"}</div>
            </div>
          </div>
          {/* Col 3: Status Update */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase" }}>Update Status</div>
            <select
              value={animal.status}
              onChange={(e) => onUpdate(animal.id, "status", e.target.value)}
              style={{
                width: "100%", padding: "0.4rem", borderRadius: "6px",
                border: "1px solid var(--border)", background: "var(--card-bg)",
                fontSize: "0.85rem", marginBottom: "0.5rem",
              }}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {animal.priority_meaning && (
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic", marginTop: "0.25rem" }}>
                {animal.priority_meaning}
              </div>
            )}
          </div>
        </div>
        {/* Contact Notes */}
        {animal.contact_notes && (
          <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--card-bg)", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.25rem" }}>Notes</div>
            <div style={{ fontSize: "0.8rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{animal.contact_notes}</div>
          </div>
        )}
      </td>
    </tr>
  );
}

// --- Main Content ---

function PartnerOrgsContent() {
  const { addToast } = useToast();
  const [animals, setAnimals] = useState<PartnerAnimal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [orgs, setOrgs] = useState<PartnerOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("tracker");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterPriority !== "all") params.set("priority", filterPriority);
      if (filterStatus !== "all") params.set("status", filterStatus);
      const data = await fetchApi<{ animals: PartnerAnimal[]; stats: Stats; orgs: PartnerOrg[] }>(
        `/api/admin/partner-animals?${params.toString()}`
      );
      setAnimals(data.animals || []);
      setStats(data.stats || null);
      setOrgs(data.orgs || []);
    } catch {
      addToast({ type: "error", message: "Failed to load partner animals" });
    }
    setLoading(false);
  }, [filterPriority, filterStatus, addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpdate = async (id: string, field: string, value: string) => {
    try {
      await postApi(`/api/admin/partner-animals/${id}`, { [field]: value }, { method: "PATCH" });
      addToast({ type: "success", message: `Updated ${field}` });
      fetchData();
    } catch {
      addToast({ type: "error", message: "Update failed" });
    }
  };

  const tabs = [
    { id: "tracker", label: "Animal Tracker", count: stats?.needed },
    { id: "overview", label: "Overview" },
  ];

  const activeAnimals = animals.filter(a => a.status === "needed" || a.status === "scheduled" || a.status === "foster_handling");
  const doneAnimals = animals.filter(a => a.status === "completed" || a.status === "already_done");

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Partner Org Tracking</h1>
        <p className="text-muted" style={{ margin: "4px 0 0" }}>
          Track animals from partner organizations needing FFSC spay/neuter services
        </p>
      </div>

      {/* Stats */}
      {loading ? (
        <SkeletonStats count={6} />
      ) : stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <StatCard label="Total Animals" value={stats.total} accentColor="#6b7280" />
          <StatCard label="Need Surgery" value={stats.needed} accentColor="#dc2626" valueColor="#dc2626" />
          <StatCard label="Scheduled" value={stats.scheduled} accentColor="#2563eb" />
          <StatCard label="Done" value={stats.completed + stats.already_done} accentColor="#059669" valueColor="#059669" />
          <StatCard label="Foster Handling" value={stats.foster_handling} accentColor="#7c3aed" />
        </div>
      ) : null}

      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel tabId="tracker" activeTab={activeTab}>
        {/* Filters */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card-bg)", fontSize: "0.85rem" }}
          >
            <option value="all">All Priorities</option>
            <option value="Yellow">Yellow — Needs Medical</option>
            <option value="Blue">Blue — Foster Providing</option>
            <option value="Red">Red — No Contact</option>
            <option value="Pink">Pink — Finalize Adoption</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card-bg)", fontSize: "0.85rem" }}
          >
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <SkeletonTable rows={8} columns={7} />
        ) : animals.length === 0 ? (
          <EmptyState title="No animals found" description="Adjust filters or add animals from a partner org." />
        ) : (
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  {["Name", "Sex", "Colors", "Procedure", "Priority", "Status", "Foster", "Contact"].map(h => (
                    <th key={h} style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {animals.map((a) => {
                  const isExpanded = expandedId === a.id;
                  const rowBg = a.priority ? PRIORITY_STYLES[a.priority]?.bg : undefined;
                  return (
                    <>
                      <tr
                        key={a.id}
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                        style={{
                          cursor: "pointer",
                          background: isExpanded ? "var(--section-bg)" : rowBg,
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--section-bg)"; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = rowBg || ""; }}
                      >
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem", fontWeight: 600 }}>
                          {a.name || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>(unnamed)</span>}
                          {a.external_animal_id && (
                            <div style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 400 }}>{a.external_animal_id}</div>
                          )}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>{a.sex || "-"}</td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>{a.colors || "-"}</td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>{a.procedure_needed || "-"}</td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)" }}><PriorityBadge priority={a.priority} /></td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)" }}><StatusBadge status={a.status} /></td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                          {a.foster_name || <span style={{ color: "var(--muted)" }}>-</span>}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                          {a.foster_phone ? (
                            <a href={`tel:${a.foster_phone}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--primary)" }}>
                              {a.foster_phone}
                            </a>
                          ) : <span style={{ color: "var(--muted)" }}>-</span>}
                        </td>
                      </tr>
                      {isExpanded && <AnimalDetail animal={a} onUpdate={handleUpdate} />}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TabPanel>

      <TabPanel tabId="overview" activeTab={activeTab}>
        {stats && (
          <div>
            <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase" }}>
              Priority Breakdown
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <StatCard label="Yellow — Needs Medical" value={stats.yellow} accentColor="#eab308" />
              <StatCard label="Blue — Foster Providing" value={stats.blue} accentColor="#3b82f6" />
              <StatCard label="Red — No Contact" value={stats.red} accentColor="#ef4444" />
              <StatCard label="Pink — Finalize Adoption" value={stats.pink} accentColor="#ec4899" />
            </div>

            <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase" }}>
              Partner Organizations
            </h3>
            {orgs.length === 0 ? (
              <EmptyState title="No partner orgs" description="No partner organizations configured yet." />
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {orgs.map(org => (
                  <div key={org.id} className="card-elevated" style={{
                    padding: "1rem", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "8px",
                  }}>
                    <div style={{ fontWeight: 600 }}>{org.name}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{org.animal_count} animals tracked</div>
                  </div>
                ))}
              </div>
            )}

            {activeAnimals.length > 0 && (
              <>
                <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase" }}>
                  Active ({activeAnimals.length})
                </h3>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  {activeAnimals.length} animals still need spay/neuter
                </div>
              </>
            )}

            {doneAnimals.length > 0 && (
              <>
                <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase" }}>
                  Completed ({doneAnimals.length})
                </h3>
                <div style={{ fontSize: "0.85rem" }}>
                  {doneAnimals.map(a => (
                    <div key={a.id} style={{ padding: "0.25rem 0" }}>
                      {a.name || a.external_animal_id} — {a.status === "already_done" ? "Done at own vet" : "Completed"}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </TabPanel>
    </div>
  );
}

export default function PartnerOrgsPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonStats count={5} /><SkeletonTable rows={8} columns={7} /></div>}>
      <PartnerOrgsContent />
    </Suspense>
  );
}
