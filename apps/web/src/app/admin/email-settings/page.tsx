"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { SkeletonTable, SkeletonList } from "@/components/feedback/Skeleton";

interface OutlookAccount {
  account_id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  last_used_at: string | null;
  connection_error: string | null;
  needs_reconnection: boolean;
  token_expired: boolean; // For debugging only
  created_at: string;
  connected_by: string | null;
  emails_sent: number;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmailSettingsContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<OutlookAccount[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<{ accountId: string; email: string } | null>(null);

  // Handle URL params from OAuth callback
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");

    if (connected) {
      setMessage({ type: "success", text: `Successfully connected ${connected}` });
      // Clean up URL
      window.history.replaceState({}, "", "/admin/email-settings");
    } else if (error) {
      setMessage({ type: "error", text: error });
      // Clean up URL
      window.history.replaceState({}, "", "/admin/email-settings");
    }
  }, [searchParams]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ configured: boolean; accounts: OutlookAccount[] }>("/api/admin/email-settings/accounts");
      setConfigured(data.configured);
      setAccounts(data.accounts || []);
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
      setMessage({ type: "error", text: "Failed to load email accounts" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  function disconnectAccount(accountId: string, email: string) {
    setPendingDisconnect({ accountId, email });
  }

  async function confirmDisconnect() {
    if (!pendingDisconnect) return;
    const { accountId, email } = pendingDisconnect;
    setPendingDisconnect(null);
    setDisconnecting(accountId);
    try {
      await postApi(`/api/admin/email-settings/accounts?accountId=${accountId}`, {}, { method: "DELETE" });
      setMessage({ type: "success", text: `Disconnected ${email}` });
      fetchAccounts();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to disconnect account" });
    } finally {
      setDisconnecting(null);
    }
  }

  const handleConnectAccount = () => {
    // Redirect to the OAuth connect endpoint
    window.location.href = "/api/auth/outlook/connect";
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <Link
          href="/admin"
          style={{
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: "0.875rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            marginBottom: "0.5rem",
          }}
        >
          &larr; Admin
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Email Settings</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Connect Outlook accounts to send emails to clients with reply threading
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "1.5rem",
            background: message.type === "success" ? "#dcfce7" : "#fef2f2",
            border: `1px solid ${message.type === "success" ? "#86efac" : "#fecaca"}`,
            color: message.type === "success" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
              color: "inherit",
              opacity: 0.7,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Configuration Status */}
      {!loading && !configured && (
        <div
          className="card"
          style={{
            padding: "1.5rem",
            marginBottom: "1.5rem",
            background: "#fffbeb",
            border: "1px solid #fcd34d",
          }}
        >
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem", color: "#92400e" }}>
            Outlook Integration Not Configured
          </h3>
          <p style={{ color: "#78350f", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
            To enable Outlook email integration, set these environment variables:
          </p>
          <ul style={{ fontSize: "0.875rem", color: "#78350f", margin: 0, paddingLeft: "1.5rem" }}>
            <li><code>MICROSOFT_CLIENT_ID</code></li>
            <li><code>MICROSOFT_CLIENT_SECRET</code></li>
            <li><code>MICROSOFT_TENANT_ID</code></li>
          </ul>
        </div>
      )}

      {/* FFS-1188 — Email Pipeline Mode (dry-run / test override / live) */}
      <PipelineModeCard onAction={(text, type) => setMessage({ type, text })} />

      {/* FFS-1181 follow-up Phase 3 — Per-flow config from ops.email_flows */}
      <EmailFlowsSection onAction={(text, type) => setMessage({ type, text })} />

      {/* Connected Accounts */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Connected Outlook Accounts</h2>
          {configured && (
            <button
              onClick={handleConnectAccount}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d6efd",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: 500,
              }}
            >
              + Connect Account
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: "2rem" }}>
            <SkeletonList items={3} />
          </div>
        ) : accounts.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
            {configured
              ? "No accounts connected. Click \"Connect Account\" to add an Outlook account."
              : "Configure environment variables to connect Outlook accounts."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background-secondary)" }}>
                <th style={{ padding: "0.75rem 1.5rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>
                  Account
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>
                  Status
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>
                  Emails Sent
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>
                  Last Used
                </th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>
                  Connected By
                </th>
                <th style={{ padding: "0.75rem 1.5rem", textAlign: "right", fontWeight: 500, fontSize: "0.875rem" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.account_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.75rem 1.5rem" }}>
                    <div>
                      <span style={{ fontWeight: 500 }}>{account.email}</span>
                      {account.display_name && account.display_name !== account.email && (
                        <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                          ({account.display_name})
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    {account.needs_reconnection ? (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          background: "#fef2f2",
                          color: "#dc2626",
                        }}
                        title={account.connection_error || "Reconnection needed"}
                      >
                        Needs Reconnection
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          background: "#dcfce7",
                          color: "#166534",
                        }}
                      >
                        Connected
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)" }}>
                    {account.emails_sent.toLocaleString()}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {formatDate(account.last_used_at)}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {account.connected_by || "-"}
                  </td>
                  <td style={{ padding: "0.75rem 1.5rem", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      {account.needs_reconnection && (
                        <button
                          onClick={handleConnectAccount}
                          style={{
                            padding: "0.375rem 0.75rem",
                            background: "#0d6efd",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                          }}
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        onClick={() => disconnectAccount(account.account_id, account.email)}
                        disabled={disconnecting === account.account_id}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "transparent",
                          color: "#dc2626",
                          border: "1px solid #dc2626",
                          borderRadius: "4px",
                          cursor: disconnecting === account.account_id ? "not-allowed" : "pointer",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          opacity: disconnecting === account.account_id ? 0.5 : 1,
                        }}
                      >
                        {disconnecting === account.account_id ? "..." : "Disconnect"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* How It Works */}
      <div className="card" style={{ marginTop: "1.5rem", padding: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>How It Works</h3>
        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong>Connect an Outlook account</strong> using the button above. You&apos;ll be redirected to
              Microsoft to sign in and authorize Beacon.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong>Emails appear from that account</strong>. When Beacon sends an email, it uses the connected
              account so replies go to that inbox.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong>Multiple accounts supported</strong>. Connect info@, ben@, tippy@, etc. Then choose which
              account to use when sending.
            </li>
            <li>
              <strong>Tokens refresh automatically</strong>. Beacon will keep the connection alive. If something
              breaks, reconnect the account.
            </li>
          </ol>
        </div>
      </div>

      {/* Related Links */}
      <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
        <Link
          href="/admin/email-templates"
          style={{
            padding: "0.5rem 1rem",
            background: "var(--background-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "inherit",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Manage Email Templates &rarr;
        </Link>
      </div>

      <ConfirmDialog
        open={!!pendingDisconnect}
        title="Disconnect account"
        message={`Disconnect ${pendingDisconnect?.email}? This will stop emails from being sent from this account.`}
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={confirmDisconnect}
        onCancel={() => setPendingDisconnect(null)}
      />
    </div>
  );
}

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonTable rows={5} columns={3} /></div>}>
      <EmailSettingsContent />
    </Suspense>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FFS-1188 — Email Pipeline Mode card (dry-run / test override / Go Live)
// ────────────────────────────────────────────────────────────────────────────

interface PipelineState {
  mode: "dry_run" | "test_override" | "live" | "unknown";
  global_dry_run: boolean;
  test_recipient_override: string | null;
  out_of_area_live: boolean;
  env_dry_run: boolean | null;
  env_out_of_area_live: boolean;
  env_out_of_area_blocked: boolean;
  gate_env_live: boolean;
  gate_db_live: boolean;
  gate_combined_live: boolean;
  go_live_prerequisite: {
    required_recipient: string;
    test_sends: number;
    latest_test_send_at: string | null;
    ready_for_go_live: boolean;
  };
}

function PipelineModeCard({
  onAction,
}: {
  onAction: (text: string, type: "success" | "error") => void;
}) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<PipelineState>(
        "/api/admin/email-settings/state"
      );
      setState(data);
    } catch (err) {
      console.error("Failed to load pipeline state:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const toggleDryRun = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await postApi("/api/admin/email-settings/dry-run", {
        enabled: !state.global_dry_run,
      });
      onAction(
        `Dry-run ${!state.global_dry_run ? "enabled" : "disabled"}`,
        "success"
      );
      reload();
    } catch (err) {
      onAction(
        err instanceof Error ? err.message : "Failed to toggle dry-run",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleGoLive = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await postApi("/api/admin/email-settings/go-live", {
        enabled: !state.out_of_area_live,
      });
      onAction(
        `Out-of-area pipeline ${!state.out_of_area_live ? "enabled (DB)" : "disabled (DB)"}`,
        "success"
      );
      reload();
    } catch (err) {
      onAction(
        err instanceof Error ? err.message : "Failed to flip Go Live",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const result = await postApi<{ recipient: string }>(
        "/api/admin/email-settings/test-send",
        { template_key: "out_of_service_area" }
      );
      onAction(`Test email sent to ${result.recipient}`, "success");
      reload();
    } catch (err) {
      onAction(
        err instanceof Error ? err.message : "Failed to send test email",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
          Email Pipeline Mode
        </h2>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Loading…
        </p>
      </div>
    );
  }

  const modeColor: Record<PipelineState["mode"], string> = {
    dry_run: "#856404",
    test_override: "#856404",
    live: "#198754",
    unknown: "#6c757d",
  };
  const modeLabel: Record<PipelineState["mode"], string> = {
    dry_run: "DRY RUN",
    test_override: "TEST OVERRIDE",
    live: "LIVE",
    unknown: "UNKNOWN",
  };

  return (
    <div
      className="card"
      style={{
        padding: "1.5rem",
        marginBottom: "1.5rem",
        background:
          state.mode === "live" ? "rgba(25,135,84,0.05)" : "rgba(255,193,7,0.06)",
        border:
          "1px solid " +
          (state.mode === "live"
            ? "rgba(25,135,84,0.35)"
            : "rgba(255,193,7,0.5)"),
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
        Email Pipeline Mode
      </h2>

      {/* Current mode */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.25rem",
        }}
      >
        <span
          style={{
            background: modeColor[state.mode],
            color: "#fff",
            padding: "0.25rem 0.75rem",
            borderRadius: 999,
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
          }}
        >
          {modeLabel[state.mode]}
        </span>
        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {state.mode === "dry_run"
            ? "All template emails are rendered + logged but NOT sent."
            : state.mode === "test_override"
              ? `All sends route to ${state.test_recipient_override}.`
              : state.mode === "live"
                ? "Real sends are enabled."
                : "Pipeline state unknown."}
        </span>
      </div>

      {/* Dry-run toggle row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 0",
          borderTop: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div>
          <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
            Dry-run mode
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Currently: {state.global_dry_run ? "ON (safe)" : "OFF (real sends possible)"}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleDryRun}
          disabled={busy}
          style={{
            padding: "0.4rem 0.85rem",
            background: state.global_dry_run ? "#dc3545" : "#198754",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: "0.8rem",
            fontWeight: 600,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {state.global_dry_run ? "Turn OFF" : "Turn ON"}
        </button>
      </div>

      {/* Test recipient override */}
      <div
        style={{
          padding: "0.75rem 0",
          borderTop: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          Test recipient override
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {state.test_recipient_override ? (
            <>
              All real sends are rerouted to{" "}
              <code>{state.test_recipient_override}</code>.
            </>
          ) : (
            <>No override — sends go to actual recipients.</>
          )}
        </div>
      </div>

      {/* Out-of-area Go Live row */}
      <div
        style={{
          padding: "0.75rem 0",
          borderTop: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
          }}
        >
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              Out-of-Service-Area Pipeline
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                marginTop: "0.25rem",
              }}
            >
              Status:{" "}
              <strong>
                {state.env_out_of_area_blocked
                  ? "🔴 Blocked by developer"
                  : state.gate_combined_live
                    ? "🟢 Live"
                    : "🟡 Ready to enable"}
              </strong>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginTop: "0.25rem",
              }}
            >
              Test sends to {state.go_live_prerequisite.required_recipient}:{" "}
              <strong>{state.go_live_prerequisite.test_sends}</strong>
              {state.go_live_prerequisite.test_sends < 1 && (
                <span style={{ color: "#dc3545", marginLeft: "0.5rem" }}>
                  ⚠ Send a test first
                </span>
              )}
              {state.go_live_prerequisite.latest_test_send_at && (
                <span style={{ marginLeft: "0.5rem" }}>
                  (last:{" "}
                  {formatDate(state.go_live_prerequisite.latest_test_send_at)})
                </span>
              )}
            </div>
            {state.env_out_of_area_blocked && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#dc3545",
                  marginTop: "0.25rem",
                }}
              >
                A developer has blocked this pipeline at the hosting level. Contact your system administrator to unblock.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
            <button
              type="button"
              onClick={sendTest}
              disabled={busy}
              style={{
                padding: "0.4rem 0.85rem",
                background: "#0d6efd",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
                opacity: busy ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
            >
              Send Test Email
            </button>
            <button
              type="button"
              onClick={toggleGoLive}
              disabled={
                busy ||
                state.env_out_of_area_blocked ||
                (!state.out_of_area_live &&
                  !state.go_live_prerequisite.ready_for_go_live)
              }
              style={{
                padding: "0.4rem 0.85rem",
                background: state.out_of_area_live ? "#dc3545" : "#198754",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor:
                  busy ||
                  state.env_out_of_area_blocked ||
                  (!state.out_of_area_live &&
                    !state.go_live_prerequisite.ready_for_go_live)
                    ? "not-allowed"
                    : "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
                opacity:
                  busy ||
                  state.env_out_of_area_blocked ||
                  (!state.out_of_area_live &&
                    !state.go_live_prerequisite.ready_for_go_live)
                    ? 0.4
                    : 1,
                whiteSpace: "nowrap",
              }}
              title={
                state.env_out_of_area_blocked
                  ? "Pipeline is blocked by developer — contact your system administrator"
                  : !state.go_live_prerequisite.ready_for_go_live &&
                    !state.out_of_area_live
                    ? "Send at least one test email first"
                    : ""
              }
            >
              {state.out_of_area_live ? "Disable Go Live" : "Enable Go Live"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FFS-1181 follow-up Phase 3 — Email Flows section (ops.email_flows)
// ────────────────────────────────────────────────────────────────────────────

interface EmailFlowRow {
  flow_slug: string;
  display_name: string;
  description: string | null;
  template_key: string | null;
  enabled: boolean;
  dry_run: boolean;
  test_recipient_override: string | null;
  suppression_scope: "global" | "per_flow" | "per_flow_per_recipient";
  suppression_days: number;
  send_via: string | null;
  outlook_account_email: string | null;
}

function EmailFlowsSection({
  onAction,
}: {
  onAction: (text: string, type: "success" | "error") => void;
}) {
  const [flows, setFlows] = useState<EmailFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ flows: EmailFlowRow[] }>(
        "/api/admin/email-settings/flows"
      );
      setFlows(data.flows || []);
    } catch (err) {
      console.error("Failed to load email flows:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const patchFlow = async (
    flowSlug: string,
    patch: Partial<Pick<EmailFlowRow, "enabled" | "dry_run">>
  ) => {
    setBusy(flowSlug);
    try {
      await postApi(
        "/api/admin/email-settings/flows",
        { flow_slug: flowSlug, ...patch },
        { method: "PATCH" }
      );
      onAction(`Updated ${flowSlug}`, "success");
      reload();
    } catch (err) {
      onAction(
        err instanceof Error ? err.message : "Failed to update flow",
        "error"
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="card"
      style={{ padding: "1.5rem", marginBottom: "1.5rem" }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.25rem" }}>
        Email Flows
      </h2>
      <p
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          margin: "0 0 1rem",
        }}
      >
        Per-flow kill switches and dry-run knobs. New transactional flows
        are added by inserting a row into <code>ops.email_flows</code>{" "}
        (no code change required).
      </p>
      {loading ? (
        <div style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : flows.length === 0 ? (
        <div style={{ color: "var(--text-muted)" }}>
          No flows configured (MIG_3066 not applied?).
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--background-secondary)" }}>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Flow
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Template
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Sends From
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Enabled
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Dry-run
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Test Recipient
              </th>
              <th
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "right",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => (
              <tr
                key={f.flow_slug}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td style={{ padding: "0.75rem", fontSize: "0.85rem" }}>
                  <div style={{ fontWeight: 600 }}>{f.display_name}</div>
                  <div
                    style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}
                  >
                    <code>{f.flow_slug}</code>
                  </div>
                </td>
                <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
                  <code>{f.template_key ?? "—"}</code>
                </td>
                <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
                  {f.outlook_account_email ? (
                    <div>
                      <div style={{ fontSize: "0.8rem" }}>{f.outlook_account_email}</div>
                      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                        via {f.send_via === "outlook" ? "Outlook" : f.send_via || "default"}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                      {f.send_via === "outlook" ? "⚠ No account" : "Resend API"}
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
                  {f.enabled ? (
                    <span style={{ color: "#198754", fontWeight: 600 }}>
                      🟢 On
                    </span>
                  ) : (
                    <span style={{ color: "#dc3545", fontWeight: 600 }}>
                      🔴 Off
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
                  {f.dry_run ? (
                    <span style={{ color: "#856404", fontWeight: 600 }}>
                      🟡 Dry-run
                    </span>
                  ) : (
                    <span style={{ color: "#198754" }}>Real sends</span>
                  )}
                </td>
                <td
                  style={{
                    padding: "0.75rem",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {f.test_recipient_override ? (
                    <code>{f.test_recipient_override}</code>
                  ) : (
                    <em>none</em>
                  )}
                </td>
                <td style={{ padding: "0.75rem", textAlign: "right" }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.4rem",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      disabled={busy === f.flow_slug}
                      onClick={() =>
                        patchFlow(f.flow_slug, { dry_run: !f.dry_run })
                      }
                      style={{
                        padding: "0.3rem 0.6rem",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: "0.7rem",
                      }}
                    >
                      {f.dry_run ? "Exit dry-run" : "Dry-run"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === f.flow_slug}
                      onClick={() =>
                        patchFlow(f.flow_slug, { enabled: !f.enabled })
                      }
                      style={{
                        padding: "0.3rem 0.6rem",
                        background: f.enabled ? "#dc3545" : "#198754",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                      }}
                    >
                      {f.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
