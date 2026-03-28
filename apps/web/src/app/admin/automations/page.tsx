"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { EmptyState } from "@/components/feedback/EmptyState";

interface AutomationRule {
  rule_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
}

interface EmailTemplate {
  template_key: string;
  name: string;
}

const TRIGGER_TYPES = [
  {
    value: "intake_status_change",
    label: "Intake Status Change",
    description: "Fires when an intake submission status changes",
    configFields: [
      { key: "from_status", label: "From Status", type: "select", options: ["any", "new", "in_progress", "scheduled", "complete"] },
      { key: "to_status", label: "To Status", type: "select", options: ["any", "new", "in_progress", "scheduled", "complete", "out_of_county"] },
    ],
  },
  {
    value: "onboarding_status_change",
    label: "Onboarding Status Change",
    description: "Fires when a trapper's onboarding status changes",
    configFields: [
      { key: "to_status", label: "New Status", type: "select", options: ["contacted", "orientation_scheduled", "orientation_complete", "training_scheduled", "training_complete", "contract_sent", "contract_signed", "approved"] },
    ],
  },
  {
    value: "request_status_change",
    label: "Request Status Change",
    description: "Fires when a request status changes",
    configFields: [
      { key: "to_status", label: "New Status", type: "select", options: ["triaged", "scheduled", "in_progress", "completed", "cancelled"] },
    ],
  },
  {
    value: "county_detected",
    label: "Out-of-County Detected",
    description: "Fires when an address is detected as outside service area",
    configFields: [],
  },
];

const ACTION_TYPES = [
  {
    value: "send_email",
    label: "Send Email",
    description: "Send an email using a template",
    configFields: [
      { key: "template_key", label: "Email Template", type: "template_select" },
      { key: "delay_minutes", label: "Delay (minutes)", type: "number", default: 0 },
    ],
  },
  {
    value: "create_task",
    label: "Create Task",
    description: "Create a follow-up task for staff",
    configFields: [
      { key: "task_title", label: "Task Title", type: "text" },
      { key: "assign_to", label: "Assign To", type: "text" },
      { key: "due_in_days", label: "Due in (days)", type: "number", default: 1 },
    ],
  },
  {
    value: "update_field",
    label: "Update Field",
    description: "Automatically update a field value",
    configFields: [
      { key: "field_name", label: "Field Name", type: "text" },
      { key: "new_value", label: "New Value", type: "text" },
    ],
  },
  {
    value: "webhook",
    label: "Call Webhook",
    description: "Send data to an external URL (Zapier, etc)",
    configFields: [
      { key: "url", label: "Webhook URL", type: "text" },
      { key: "method", label: "HTTP Method", type: "select", options: ["POST", "PUT"] },
    ],
  },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AutomationsAdminPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger_type: "intake_status_change",
    trigger_config: {} as Record<string, unknown>,
    action_type: "send_email",
    action_config: {} as Record<string, unknown>,
  });

  const fetchRules = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ rules: AutomationRule[]; templates: EmailTemplate[] }>("/api/admin/automations");
      setRules(data.rules || []);
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to fetch automations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const resetForm = () => {
    setForm({
      name: "",
      description: "",
      trigger_type: "intake_status_change",
      trigger_config: {},
      action_type: "send_email",
      action_config: {},
    });
  };

  const openAddModal = () => {
    setEditingRule(null);
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (rule: AutomationRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      description: rule.description || "",
      trigger_type: rule.trigger_type,
      trigger_config: rule.trigger_config,
      action_type: rule.action_type,
      action_config: rule.action_config,
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingRule(null);
    resetForm();
    setMessage(null);
  };

  const saveRule = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const method = editingRule ? "PATCH" : "POST";
      const body = editingRule
        ? { rule_id: editingRule.rule_id, ...form }
        : form;

      await postApi("/api/admin/automations", body, { method });

      setMessage({ type: "success", text: editingRule ? "Rule updated!" : "Rule created!" });
      fetchRules();
      setTimeout(() => {
        closeModal();
      }, 1000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save automation" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: AutomationRule) => {
    try {
      await postApi("/api/admin/automations", {
        rule_id: rule.rule_id,
        is_active: !rule.is_active,
      }, { method: "PATCH" });
      fetchRules();
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  function deleteRule(ruleId: string) {
    setPendingDeleteId(ruleId);
  }

  async function confirmDeleteRule() {
    if (!pendingDeleteId) return;
    const ruleId = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await postApi(`/api/admin/automations?rule_id=${ruleId}`, {}, { method: "DELETE" });
      fetchRules();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  const getTriggerInfo = (type: string) => TRIGGER_TYPES.find((t) => t.value === type);
  const getActionInfo = (type: string) => ACTION_TYPES.find((a) => a.value === type);

  const renderConfigField = (
    field: { key: string; label: string; type: string; options?: string[]; default?: unknown },
    config: Record<string, unknown>,
    setConfig: (config: Record<string, unknown>) => void,
    prefix: string
  ) => {
    const value = config[field.key] ?? field.default ?? "";

    if (field.type === "select") {
      return (
        <select
          key={`${prefix}-${field.key}`}
          value={String(value)}
          onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
          }}
        >
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "template_select") {
      return (
        <select
          key={`${prefix}-${field.key}`}
          value={String(value)}
          onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
          }}
        >
          <option value="">Select a template...</option>
          {templates.map((t) => (
            <option key={t.template_key} value={t.template_key}>
              {t.name} ({t.template_key})
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "number") {
      return (
        <input
          key={`${prefix}-${field.key}`}
          type="number"
          value={Number(value)}
          onChange={(e) => setConfig({ ...config, [field.key]: parseInt(e.target.value, 10) })}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
          }}
        />
      );
    }

    return (
      <input
        key={`${prefix}-${field.key}`}
        type="text"
        value={String(value)}
        onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
        style={{
          width: "100%",
          padding: "0.5rem",
          border: "1px solid var(--border)",
          borderRadius: "4px",
        }}
      />
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Automations</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Configure triggers and actions like Zapier, without code
          </p>
        </div>
        <button
          onClick={openAddModal}
          style={{
            padding: "0.5rem 1rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + New Automation
        </button>
      </div>

      {/* How it works */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1.5rem",
          background: "var(--section-bg)",
        }}
      >
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>How Automations Work</h3>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
          Each automation has a <strong>trigger</strong> (when something happens) and an <strong>action</strong> (what to do).
          For example: &ldquo;When intake status changes to out_of_county, send the out_of_county email template.&rdquo;
        </p>
      </div>

      {/* Rules List */}
      {loading ? (
        <div className="loading">Loading automations...</div>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No automations configured"
          description="Create your first automation to automate repetitive tasks."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {rules.map((rule) => {
            const triggerInfo = getTriggerInfo(rule.trigger_type);
            const actionInfo = getActionInfo(rule.action_type);

            return (
              <div
                key={rule.rule_id}
                className="card"
                style={{
                  padding: "1rem",
                  opacity: rule.is_active ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>⚡</span>
                      <h3 style={{ margin: 0, fontSize: "1rem" }}>{rule.name}</h3>
                      {!rule.is_active && (
                        <span
                          style={{
                            background: "#6c757d",
                            color: "#fff",
                            padding: "0.1rem 0.4rem",
                            borderRadius: "4px",
                            fontSize: "0.65rem",
                          }}
                        >
                          PAUSED
                        </span>
                      )}
                    </div>

                    {rule.description && (
                      <p style={{ color: "var(--muted)", margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                        {rule.description}
                      </p>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        marginTop: "0.75rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          background: "#e0f2fe",
                          color: "#0369a1",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                        }}
                      >
                        When: {triggerInfo?.label || rule.trigger_type}
                      </span>
                      <span style={{ color: "var(--muted)" }}>→</span>
                      <span
                        style={{
                          background: "#dcfce7",
                          color: "#166534",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                        }}
                      >
                        Then: {actionInfo?.label || rule.action_type}
                      </span>
                    </div>

                    <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                      Runs: {rule.execution_count} times • Last run: {formatDate(rule.last_executed_at)}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => openEditModal(rule)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: "var(--section-bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(rule)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: rule.is_active ? "#fff3cd" : "#d1fae5",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      {rule.is_active ? "Pause" : "Enable"}
                    </button>
                    <button
                      onClick={() => deleteRule(rule.rule_id)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: "#fee2e2",
                        color: "#dc2626",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
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
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "600px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ margin: 0 }}>
                {editingRule ? "Edit Automation" : "New Automation"}
              </h2>
            </div>

            <div style={{ padding: "1.5rem", display: "grid", gap: "1.25rem" }}>
              {message && (
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "6px",
                    background: message.type === "success" ? "#d1fae5" : "#fee2e2",
                    color: message.type === "success" ? "#065f46" : "#dc2626",
                  }}
                >
                  {message.text}
                </div>
              )}

              {/* Name */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Name <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Out of County Email"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Sends notification when address is outside service area"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              {/* Trigger */}
              <div
                style={{
                  padding: "1rem",
                  background: "#e0f2fe",
                  borderRadius: "8px",
                }}
              >
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "#0369a1" }}>
                  When this happens (Trigger)
                </h3>

                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Trigger Type
                  </label>
                  <select
                    value={form.trigger_type}
                    onChange={(e) => setForm({ ...form, trigger_type: e.target.value, trigger_config: {} })}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                    }}
                  >
                    {TRIGGER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {getTriggerInfo(form.trigger_type)?.description && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {getTriggerInfo(form.trigger_type)?.description}
                    </div>
                  )}
                </div>

                {/* Trigger Config */}
                {getTriggerInfo(form.trigger_type)?.configFields?.map((field) => (
                  <div key={field.key} style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                      {field.label}
                    </label>
                    {renderConfigField(
                      field,
                      form.trigger_config,
                      (config) => setForm({ ...form, trigger_config: config }),
                      "trigger"
                    )}
                  </div>
                ))}
              </div>

              {/* Action */}
              <div
                style={{
                  padding: "1rem",
                  background: "#dcfce7",
                  borderRadius: "8px",
                }}
              >
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "#166534" }}>
                  Do this (Action)
                </h3>

                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Action Type
                  </label>
                  <select
                    value={form.action_type}
                    onChange={(e) => setForm({ ...form, action_type: e.target.value, action_config: {} })}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                    }}
                  >
                    {ACTION_TYPES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  {getActionInfo(form.action_type)?.description && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {getActionInfo(form.action_type)?.description}
                    </div>
                  )}
                </div>

                {/* Action Config */}
                {getActionInfo(form.action_type)?.configFields?.map((field) => (
                  <div key={field.key} style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>
                      {field.label}
                    </label>
                    {renderConfigField(
                      field,
                      form.action_config,
                      (config) => setForm({ ...form, action_config: config }),
                      "action"
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
              }}
            >
              <button
                onClick={closeModal}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--section-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={saving || !form.name}
                style={{
                  padding: "0.5rem 1rem",
                  background: saving ? "#6c757d" : "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save Automation"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeleteId}
        title="Delete automation"
        message="Are you sure you want to delete this automation?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDeleteRule}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
