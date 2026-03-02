"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

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
      const response = await fetch("/api/admin/email-settings/accounts");
      const result = await response.json();
      const data = result.data || result;
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

  const disconnectAccount = async (accountId: string, email: string) => {
    if (!confirm(`Are you sure you want to disconnect ${email}? This will stop emails from being sent from this account.`)) {
      return;
    }

    setDisconnecting(accountId);
    try {
      const response = await fetch(`/api/admin/email-settings/accounts?accountId=${accountId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setMessage({ type: "success", text: `Disconnected ${email}` });
        fetchAccounts();
      } else {
        const data = await response.json();
        setMessage({ type: "error", text: data.error || "Failed to disconnect" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to disconnect account" });
    } finally {
      setDisconnecting(null);
    }
  };

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
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
            Loading...
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
              Microsoft to sign in and authorize Atlas.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong>Emails appear from that account</strong>. When Atlas sends an email, it uses the connected
              account so replies go to that inbox.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong>Multiple accounts supported</strong>. Connect info@, ben@, tippy@, etc. Then choose which
              account to use when sending.
            </li>
            <li>
              <strong>Tokens refresh automatically</strong>. Atlas will keep the connection alive. If something
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
    </div>
  );
}

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Loading...</div>}>
      <EmailSettingsContent />
    </Suspense>
  );
}
