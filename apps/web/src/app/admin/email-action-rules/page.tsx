"use client";

/**
 * Admin: Email Action Rules
 *
 * CRUD page for ops.email_action_rules — config-driven rules that suggest
 * email actions on intake submissions. Each rule says "when [field] [operator]
 * [value], suggest sending [template]."
 *
 * @see MIG_3078
 */

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { EmptyState } from "@/components/feedback/EmptyState";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";
import type { EmailActionRule } from "@/hooks/useEmailSuggestions";

const CONDITION_FIELDS = [
  { value: "service_area_status", label: "Service Area Status" },
  { value: "triage_category", label: "Triage Category" },
  { value: "submission_status", label: "Submission Status" },
  { value: "trapping_assistance_requested", label: "Trapping Assistance Requested" },
  { value: "is_emergency", label: "Is Emergency" },
  { value: "ownership_status", label: "Ownership Status" },
  { value: "county", label: "County" },
];

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "in", label: "in (comma-separated)" },
  { value: "is_null", label: "is empty" },
  { value: "is_not_null", label: "is not empty" },
];

interface FlowOption {
  flow_slug: string;
  display_name: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  fontSize: "0.85rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  marginBottom: "0.25rem",
  color: "var(--text-secondary, #4b5563)",
};

export default function EmailActionRulesPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [rules, setRules] = useState<EmailActionRule[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EmailActionRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<EmailActionRule | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    flow_slug: "",
    display_name: "",
    description: "",
    condition_field: "service_area_status",
    condition_operator: "eq",
    condition_value: "",
    guard_email_not_sent: true,
    guard_not_suppressed: true,
    guard_has_email: true,
    suggestion_text: "",
    action_label: "Send Email",
    priority: 0,
    enabled: true,
  });

  const fetchRules = useCallback(async () => {
    try {
      const data = await fetchApi("/api/admin/email-action-rules?all=1");
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load rules:", err);
    }
  }, []);

  const fetchFlows = useCallback(async () => {
    try {
      const data = await fetchApi<{ flows?: FlowOption[] }>("/api/admin/email-settings/flows");
      const flowList = data?.flows ?? [];
      setFlows(Array.isArray(flowList) ? flowList.map((f) => ({
        flow_slug: f.flow_slug,
        display_name: f.display_name,
      })) : []);
    } catch {
      // flows table may not exist yet — use empty
      setFlows([]);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchRules(), fetchFlows()]).finally(() => setLoading(false));
  }, [fetchRules, fetchFlows]);

  const openCreate = () => {
    setEditingRule(null);
    setForm({
      flow_slug: flows[0]?.flow_slug ?? "",
      display_name: "",
      description: "",
      condition_field: "service_area_status",
      condition_operator: "eq",
      condition_value: "",
      guard_email_not_sent: true,
      guard_not_suppressed: true,
      guard_has_email: true,
      suggestion_text: "",
      action_label: "Send Email",
      priority: 0,
      enabled: true,
    });
    setDrawerOpen(true);
  };

  const openEdit = (rule: EmailActionRule) => {
    setEditingRule(rule);
    setForm({
      flow_slug: rule.flow_slug,
      display_name: rule.display_name,
      description: rule.description ?? "",
      condition_field: rule.condition_field,
      condition_operator: rule.condition_operator,
      condition_value: rule.condition_value ?? "",
      guard_email_not_sent: rule.guard_email_not_sent,
      guard_not_suppressed: rule.guard_not_suppressed,
      guard_has_email: rule.guard_has_email,
      suggestion_text: rule.suggestion_text,
      action_label: rule.action_label,
      priority: rule.priority,
      enabled: rule.enabled,
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!form.flow_slug || !form.display_name || !form.suggestion_text) {
      toastError("Fill in all required fields");
      return;
    }
    setSaving(true);
    try {
      if (editingRule) {
        await postApi("/api/admin/email-action-rules", {
          rule_id: editingRule.rule_id,
          ...form,
        }, { method: "PATCH" });
        toastSuccess("Rule updated");
      } else {
        await postApi("/api/admin/email-action-rules", form);
        toastSuccess("Rule created");
      }
      setDrawerOpen(false);
      await fetchRules();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: EmailActionRule) => {
    try {
      await fetchApi(`/api/admin/email-action-rules?rule_id=${rule.rule_id}`, {
        method: "DELETE",
      });
      toastSuccess("Rule deleted");
      setDeleteConfirm(null);
      await fetchRules();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const handleToggle = async (rule: EmailActionRule) => {
    try {
      await postApi("/api/admin/email-action-rules", {
        rule_id: rule.rule_id,
        enabled: !rule.enabled,
      }, { method: "PATCH" });
      await fetchRules();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to toggle rule");
    }
  };

  const needsValue = form.condition_operator !== "is_null" && form.condition_operator !== "is_not_null";

  return (
    <div style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Email Action Rules</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
            Configure when the intake queue suggests sending an email to a submitter.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={openCreate}>
          Add Rule
        </Button>
      </div>

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No email action rules"
          description="Create a rule to suggest email actions on intake submissions."
          action={{ label: "Add Rule", onClick: openCreate }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {rules.map((rule) => (
            <div
              key={rule.rule_id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "1rem",
                background: rule.enabled ? "var(--background)" : "var(--bg-secondary, #f9fafb)",
                opacity: rule.enabled ? 1 : 0.7,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{rule.display_name}</span>
                    <span style={{
                      fontSize: "0.7rem",
                      padding: "1px 6px",
                      borderRadius: "3px",
                      background: rule.enabled ? COLORS.success : COLORS.gray400,
                      color: rule.enabled ? COLORS.white : COLORS.black,
                    }}>
                      {rule.enabled ? "ACTIVE" : "DISABLED"}
                    </span>
                    <span style={{
                      fontSize: "0.7rem",
                      padding: "1px 6px",
                      borderRadius: "3px",
                      background: COLORS.primaryLight,
                      color: COLORS.primary,
                    }}>
                      {rule.flow_slug}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                    {rule.description}
                  </p>
                  <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: "var(--text-secondary, #4b5563)" }}>
                    When <strong>{rule.condition_field}</strong>{" "}
                    <em>{OPERATORS.find(o => o.value === rule.condition_operator)?.label ?? rule.condition_operator}</em>
                    {rule.condition_value && <> <code>{rule.condition_value}</code></>}
                    {" → "}{rule.action_label}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem", fontSize: "0.7rem", color: "var(--muted)" }}>
                    {rule.guard_has_email && <span>needs email</span>}
                    {rule.guard_email_not_sent && <span>· not yet sent</span>}
                    {rule.guard_not_suppressed && <span>· not suppressed</span>}
                    <span>· priority: {rule.priority}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(rule)}>
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(rule)} style={{ color: COLORS.error }}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Drawer */}
      <ActionDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingRule ? "Edit Rule" : "New Rule"}
        width="md"
        footer={
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Flow */}
          <div>
            <label style={labelStyle}>Email Flow *</label>
            <select
              value={form.flow_slug}
              onChange={(e) => setForm({ ...form, flow_slug: e.target.value })}
              style={inputStyle}
            >
              <option value="">Select a flow...</option>
              {flows.map((f) => (
                <option key={f.flow_slug} value={f.flow_slug}>{f.display_name}</option>
              ))}
            </select>
          </div>

          {/* Display Name */}
          <div>
            <label style={labelStyle}>Display Name *</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              style={inputStyle}
              placeholder="e.g. Out-of-Service-Area Resources"
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={inputStyle}
              placeholder="What triggers this rule and why"
            />
          </div>

          {/* Condition */}
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem" }}>
            <legend style={{ fontSize: "0.8rem", fontWeight: 600, padding: "0 0.25rem", color: "var(--text-secondary)" }}>
              Condition
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label style={labelStyle}>Field *</label>
                <select
                  value={form.condition_field}
                  onChange={(e) => setForm({ ...form, condition_field: e.target.value })}
                  style={inputStyle}
                >
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Operator *</label>
                <select
                  value={form.condition_operator}
                  onChange={(e) => setForm({ ...form, condition_operator: e.target.value })}
                  style={inputStyle}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {needsValue && (
              <div style={{ marginTop: "0.5rem" }}>
                <label style={labelStyle}>Value</label>
                <input
                  type="text"
                  value={form.condition_value}
                  onChange={(e) => setForm({ ...form, condition_value: e.target.value })}
                  style={inputStyle}
                  placeholder={form.condition_operator === "in" ? "value1, value2, value3" : "value"}
                />
              </div>
            )}
          </fieldset>

          {/* Guard conditions */}
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem" }}>
            <legend style={{ fontSize: "0.8rem", fontWeight: 600, padding: "0 0.25rem", color: "var(--text-secondary)" }}>
              Guard Conditions
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={form.guard_has_email} onChange={(e) => setForm({ ...form, guard_has_email: e.target.checked })} />
                Submission must have an email address
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={form.guard_email_not_sent} onChange={(e) => setForm({ ...form, guard_email_not_sent: e.target.checked })} />
                Email must not have been sent already
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={form.guard_not_suppressed} onChange={(e) => setForm({ ...form, guard_not_suppressed: e.target.checked })} />
                Recipient must not be in suppression window
              </label>
            </div>
          </fieldset>

          {/* Suggestion */}
          <div>
            <label style={labelStyle}>Suggestion Text *</label>
            <textarea
              value={form.suggestion_text}
              onChange={(e) => setForm({ ...form, suggestion_text: e.target.value })}
              style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              placeholder="The message staff sees in the intake detail panel"
            />
          </div>

          {/* Action label + Priority */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div>
              <label style={labelStyle}>Button Label</label>
              <input
                type="text"
                value={form.action_label}
                onChange={(e) => setForm({ ...form, action_label: e.target.value })}
                style={inputStyle}
                placeholder="Send Email"
              />
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Enabled */}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled
          </label>
        </div>
      </ActionDrawer>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete Rule"
        message={`Are you sure you want to delete "${deleteConfirm?.display_name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
