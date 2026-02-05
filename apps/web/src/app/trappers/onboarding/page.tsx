"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPhone } from "@/lib/formatters";

interface OnboardingCandidate {
  onboarding_id: string;
  person_id: string;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  status: string;
  target_trapper_type: string;
  has_interest: boolean;
  has_contact: boolean;
  has_orientation: boolean;
  has_training: boolean;
  has_contract_sent: boolean;
  has_contract_signed: boolean;
  is_approved: boolean;
  days_in_status: number;
  days_in_pipeline: number;
  coordinator_name: string | null;
  notes: string | null;
  referral_source: string | null;
}

interface OnboardingStats {
  status: string;
  count: number;
  avg_days_in_status: number;
}

const STATUS_LABELS: Record<string, string> = {
  interested: "Interested",
  contacted: "Contacted",
  orientation_scheduled: "Orientation Scheduled",
  orientation_complete: "Orientation Complete",
  training_scheduled: "Training Scheduled",
  training_complete: "Training Complete",
  contract_sent: "Contract Sent",
  contract_signed: "Contract Signed",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
  on_hold: "On Hold",
};

const STATUS_COLORS: Record<string, string> = {
  interested: "#6c757d",
  contacted: "#0dcaf0",
  orientation_scheduled: "#ffc107",
  orientation_complete: "#20c997",
  training_scheduled: "#fd7e14",
  training_complete: "#198754",
  contract_sent: "#6f42c1",
  contract_signed: "#0d6efd",
  approved: "#198754",
  declined: "#dc3545",
  withdrawn: "#6c757d",
  on_hold: "#ffc107",
};

const NEXT_STATUS: Record<string, string> = {
  interested: "contacted",
  contacted: "orientation_complete",
  orientation_scheduled: "orientation_complete",
  orientation_complete: "training_complete",
  training_scheduled: "training_complete",
  training_complete: "contract_sent",
  contract_sent: "contract_signed",
  contract_signed: "approved",
};

export default function TrapperOnboardingPage() {
  const [candidates, setCandidates] = useState<OnboardingCandidate[]>([]);
  const [stats, setStats] = useState<OnboardingStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCandidate, setSelectedCandidate] = useState<OnboardingCandidate | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // New candidate form
  const [newCandidate, setNewCandidate] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    referral_source: "",
    notes: "",
  });

  const fetchData = useCallback(async () => {
    try {
      const url = statusFilter === "all"
        ? "/api/trappers/onboarding"
        : `/api/trappers/onboarding?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      setCandidates(data.candidates || []);
      setStats(data.stats || []);
    } catch (err) {
      console.error("Failed to fetch onboarding data:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdvance = async (personId: string, newStatus: string, notes?: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/trappers/onboarding/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_status: newStatus,
          notes,
          advanced_by: "staff",
        }),
      });

      if (res.ok) {
        fetchData();
        setSelectedCandidate(null);
      }
    } catch (err) {
      console.error("Failed to advance:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNew = async () => {
    if (!newCandidate.first_name || !newCandidate.last_name) return;

    setSaving(true);
    try {
      const res = await fetch("/api/trappers/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCandidate),
      });

      if (res.ok) {
        setShowNewForm(false);
        setNewCandidate({
          first_name: "",
          last_name: "",
          email: "",
          phone: "",
          referral_source: "",
          notes: "",
        });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to create:", err);
    } finally {
      setSaving(false);
    }
  };

  // Group candidates by status for pipeline view
  const activeStatuses = ["interested", "contacted", "orientation_complete", "training_complete", "contract_sent", "contract_signed"];
  const pipelineGroups = activeStatuses.map(status => ({
    status,
    label: STATUS_LABELS[status],
    color: STATUS_COLORS[status],
    candidates: candidates.filter(c => c.status === status),
  }));

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        Loading trapper onboarding data...
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Trapper Onboarding</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            {candidates.length} candidates in pipeline
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          style={{
            padding: "0.5rem 1rem",
            background: "#198754",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + Add New Interest
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}>
        <button
          onClick={() => setStatusFilter("all")}
          style={{
            padding: "0.375rem 0.75rem",
            background: statusFilter === "all" ? "#0d6efd" : "var(--bg-secondary)",
            color: statusFilter === "all" ? "#fff" : "inherit",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          All ({candidates.length})
        </button>
        {stats.map(s => (
          <button
            key={s.status}
            onClick={() => setStatusFilter(s.status)}
            style={{
              padding: "0.375rem 0.75rem",
              background: statusFilter === s.status ? STATUS_COLORS[s.status] : "var(--bg-secondary)",
              color: statusFilter === s.status ? "#fff" : "inherit",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {STATUS_LABELS[s.status]} ({s.count})
          </button>
        ))}
      </div>

      {/* Pipeline View */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${pipelineGroups.length}, 1fr)`,
        gap: "1rem",
        marginBottom: "2rem",
      }}>
        {pipelineGroups.map(group => (
          <div
            key={group.status}
            style={{
              background: "var(--bg-secondary)",
              borderRadius: "8px",
              padding: "0.75rem",
              minHeight: "200px",
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              paddingBottom: "0.5rem",
              borderBottom: `2px solid ${group.color}`,
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: group.color,
              }} />
              <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{group.label}</span>
              <span style={{
                background: "var(--bg-tertiary)",
                padding: "0.125rem 0.375rem",
                borderRadius: "10px",
                fontSize: "0.75rem",
                marginLeft: "auto",
              }}>
                {group.candidates.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {group.candidates.map(c => (
                <div
                  key={c.person_id}
                  onClick={() => setSelectedCandidate(c)}
                  style={{
                    background: "var(--bg-primary)",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    cursor: "pointer",
                    border: "1px solid var(--border)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{c.display_name}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    {c.days_in_status}d in stage • {c.days_in_pipeline}d total
                  </div>
                </div>
              ))}
              {group.candidates.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic", padding: "0.5rem" }}>
                  No candidates
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Approved Trappers Section */}
      {candidates.filter(c => c.status === "approved").length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
            Recently Approved ({candidates.filter(c => c.status === "approved").length})
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {candidates.filter(c => c.status === "approved").map(c => (
              <span
                key={c.person_id}
                style={{
                  padding: "0.25rem 0.5rem",
                  background: "#d1e7dd",
                  color: "#0f5132",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                }}
              >
                {c.display_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedCandidate && (
        <div
          onClick={() => setSelectedCandidate(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg-primary)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <h2 style={{ margin: "0 0 0.5rem" }}>{selectedCandidate.display_name}</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 1rem", fontSize: "0.9rem" }}>
              {selectedCandidate.primary_email || "No email"}
              {selectedCandidate.primary_phone && ` • ${formatPhone(selectedCandidate.primary_phone)}`}
            </p>

            <div style={{
              display: "inline-block",
              padding: "0.25rem 0.75rem",
              background: STATUS_COLORS[selectedCandidate.status],
              color: "#fff",
              borderRadius: "4px",
              marginBottom: "1rem",
              fontSize: "0.85rem",
            }}>
              {STATUS_LABELS[selectedCandidate.status]}
            </div>

            {/* Progress Checklist */}
            <div style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Progress</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
                <div>{selectedCandidate.has_interest ? "✅" : "⬜"} Interest Received</div>
                <div>{selectedCandidate.has_contact ? "✅" : "⬜"} First Contact Made</div>
                <div>{selectedCandidate.has_orientation ? "✅" : "⬜"} Orientation Complete</div>
                <div>{selectedCandidate.has_training ? "✅" : "⬜"} Training Complete</div>
                <div>{selectedCandidate.has_contract_sent ? "✅" : "⬜"} Contract Sent</div>
                <div>{selectedCandidate.has_contract_signed ? "✅" : "⬜"} Contract Signed</div>
                <div>{selectedCandidate.is_approved ? "✅" : "⬜"} Approved</div>
              </div>
            </div>

            {/* Notes */}
            {selectedCandidate.notes && (
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Notes</h3>
                <div style={{
                  background: "var(--bg-secondary)",
                  padding: "0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  whiteSpace: "pre-wrap",
                }}>
                  {selectedCandidate.notes}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {NEXT_STATUS[selectedCandidate.status] && (
                <button
                  onClick={() => handleAdvance(selectedCandidate.person_id, NEXT_STATUS[selectedCandidate.status])}
                  disabled={saving}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {saving ? "..." : `Advance to ${STATUS_LABELS[NEXT_STATUS[selectedCandidate.status]]}`}
                </button>
              )}
              {!["declined", "withdrawn", "on_hold"].includes(selectedCandidate.status) && (
                <>
                  <button
                    onClick={() => handleAdvance(selectedCandidate.person_id, "on_hold")}
                    disabled={saving}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "#ffc107",
                      color: "#000",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Put On Hold
                  </button>
                  <button
                    onClick={() => handleAdvance(selectedCandidate.person_id, "declined")}
                    disabled={saving}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "#dc3545",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Decline
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedCandidate(null)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Candidate Modal */}
      {showNewForm && (
        <div
          onClick={() => setShowNewForm(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg-primary)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "450px",
              width: "90%",
            }}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Add New Trapper Interest</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>First Name *</label>
                  <input
                    type="text"
                    value={newCandidate.first_name}
                    onChange={e => setNewCandidate({ ...newCandidate, first_name: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>Last Name *</label>
                  <input
                    type="text"
                    value={newCandidate.last_name}
                    onChange={e => setNewCandidate({ ...newCandidate, last_name: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>Email</label>
                <input
                  type="email"
                  value={newCandidate.email}
                  onChange={e => setNewCandidate({ ...newCandidate, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>Phone</label>
                <input
                  type="tel"
                  value={newCandidate.phone}
                  onChange={e => setNewCandidate({ ...newCandidate, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>How did they hear about us?</label>
                <select
                  value={newCandidate.referral_source}
                  onChange={e => setNewCandidate({ ...newCandidate, referral_source: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                >
                  <option value="">Select...</option>
                  <option value="volunteerhub">VolunteerHub</option>
                  <option value="website">Website</option>
                  <option value="friend">Friend/Referral</option>
                  <option value="event">Event</option>
                  <option value="social_media">Social Media</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem" }}>Notes</label>
                <textarea
                  value={newCandidate.notes}
                  onChange={e => setNewCandidate({ ...newCandidate, notes: e.target.value })}
                  rows={3}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)", resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  onClick={handleCreateNew}
                  disabled={saving || !newCandidate.first_name || !newCandidate.last_name}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {saving ? "Creating..." : "Create Interest"}
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
