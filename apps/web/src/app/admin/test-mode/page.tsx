"use client";

import { useState, useEffect, useCallback } from "react";

interface TestModeStatus {
  test_mode_active: boolean;
  started_at?: string;
  started_by?: string;
  tables_backed_up?: string[];
  message?: string;
}

export default function TestModePage() {
  const [status, setStatus] = useState<TestModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/test-mode");
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError("Failed to fetch test mode status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const enableTestMode = async () => {
    if (!confirm(
      "Enable Test Mode?\n\n" +
      "This will create a snapshot of key database tables. " +
      "You can then make test changes and revert them when done.\n\n" +
      "Tables backed up:\n" +
      "• Intake submissions\n" +
      "• Requests\n" +
      "• Journal entries\n" +
      "• Colony estimates\n" +
      "• Cat movements & reunifications\n\n" +
      "Continue?"
    )) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ started_by: "admin" }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to enable test mode");
      }

      setLastAction(data.message);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable test mode");
    } finally {
      setActionLoading(false);
    }
  };

  const disableTestMode = async (keepChanges: boolean) => {
    const confirmMessage = keepChanges
      ? "Disable Test Mode and KEEP all changes?\n\n" +
        "The changes you made during test mode will become permanent."
      : "Disable Test Mode and REVERT all changes?\n\n" +
        "All changes made during test mode will be discarded and the database will be restored to its original state.";

    if (!confirm(confirmMessage)) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/test-mode", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_changes: keepChanges }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to disable test mode");
      }

      setLastAction(data.message);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable test mode");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Test Mode</h1>
        <p>Loading...</p>
      </div>
    );
  }

  const isActive = status?.test_mode_active;

  return (
    <div style={{ maxWidth: "800px" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Test Mode</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Enable test mode to make temporary changes to the database.
        When you're done, you can revert all changes back to the original state.
      </p>

      {error && (
        <div
          style={{
            padding: "1rem",
            background: "#f8d7da",
            border: "1px solid #f5c2c7",
            borderRadius: "8px",
            marginBottom: "1rem",
            color: "#842029",
          }}
        >
          {error}
        </div>
      )}

      {lastAction && (
        <div
          style={{
            padding: "1rem",
            background: "#d1e7dd",
            border: "1px solid #badbcc",
            borderRadius: "8px",
            marginBottom: "1rem",
            color: "#0f5132",
          }}
        >
          {lastAction}
        </div>
      )}

      {/* Status Card */}
      <div
        style={{
          padding: "1.5rem",
          background: isActive ? "#fff3cd" : "#f8f9fa",
          border: `2px solid ${isActive ? "#ffc107" : "var(--border)"}`,
          borderRadius: "12px",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              background: isActive ? "#ffc107" : "#6c757d",
              boxShadow: isActive ? "0 0 8px #ffc107" : "none",
            }}
          />
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>
            {isActive ? "Test Mode ACTIVE" : "Test Mode Inactive"}
          </h2>
        </div>

        {isActive && status?.started_at && (
          <div style={{ marginBottom: "1rem", fontSize: "0.9rem" }}>
            <p style={{ margin: "0.25rem 0" }}>
              <strong>Started:</strong> {new Date(status.started_at).toLocaleString()}
            </p>
            {status.started_by && (
              <p style={{ margin: "0.25rem 0" }}>
                <strong>By:</strong> {status.started_by}
              </p>
            )}
          </div>
        )}

        {isActive && status?.tables_backed_up && status.tables_backed_up.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <strong style={{ fontSize: "0.9rem" }}>Tables backed up:</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              {status.tables_backed_up.map((table) => (
                <span
                  key={table}
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: "#e9ecef",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontFamily: "monospace",
                  }}
                >
                  {table}
                </span>
              ))}
            </div>
          </div>
        )}

        {isActive && (
          <div
            style={{
              padding: "0.75rem",
              background: "#fff",
              borderRadius: "6px",
              border: "1px solid #ffc107",
              fontSize: "0.85rem",
            }}
          >
            <strong>Warning:</strong> While test mode is active, any changes you make to the backed-up
            tables can be reverted. Make your test changes, then disable test mode when done.
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {!isActive ? (
          <button
            onClick={enableTestMode}
            disabled={actionLoading}
            style={{
              padding: "0.75rem 1.5rem",
              background: "#ffc107",
              color: "#000",
              border: "none",
              borderRadius: "8px",
              cursor: actionLoading ? "wait" : "pointer",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            {actionLoading ? "Enabling..." : "Enable Test Mode"}
          </button>
        ) : (
          <>
            <button
              onClick={() => disableTestMode(false)}
              disabled={actionLoading}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: actionLoading ? "wait" : "pointer",
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              {actionLoading ? "Processing..." : "Revert All Changes"}
            </button>
            <button
              onClick={() => disableTestMode(true)}
              disabled={actionLoading}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#dc3545",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: actionLoading ? "wait" : "pointer",
                fontSize: "1rem",
              }}
            >
              {actionLoading ? "Processing..." : "Keep Changes (Make Permanent)"}
            </button>
          </>
        )}
      </div>

      {/* Instructions */}
      <div style={{ marginTop: "2rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>How Test Mode Works</h3>
        <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.8 }}>
          <li>Click <strong>Enable Test Mode</strong> to create a snapshot of key database tables</li>
          <li>Make your test changes in the application (create requests, update records, etc.)</li>
          <li>When done testing:
            <ul style={{ marginTop: "0.5rem" }}>
              <li><strong>Revert All Changes</strong> - Restores database to the state before test mode</li>
              <li><strong>Keep Changes</strong> - Makes your test changes permanent</li>
            </ul>
          </li>
        </ol>
      </div>

      {/* Tables Info */}
      <div style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Tables Covered by Test Mode</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>web_intake_submissions</code></td>
                <td>Intake form submissions from web and Airtable</td>
              </tr>
              <tr>
                <td><code>sot_requests</code></td>
                <td>Trapping requests</td>
              </tr>
              <tr>
                <td><code>journal_entries</code></td>
                <td>Notes and journal entries</td>
              </tr>
              <tr>
                <td><code>place_colony_estimates</code></td>
                <td>Colony size estimates</td>
              </tr>
              <tr>
                <td><code>places</code></td>
                <td>Place records (for colony overrides)</td>
              </tr>
              <tr>
                <td><code>cat_movement_events</code></td>
                <td>Cat location history</td>
              </tr>
              <tr>
                <td><code>cat_reunifications</code></td>
                <td>Cat reunification records</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
          Note: Core entity tables (cats, people) are NOT backed up to prevent data corruption.
          Test mode is designed for testing workflows, not bulk data changes.
        </p>
      </div>
    </div>
  );
}
