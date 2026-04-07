"use client";

/**
 * Send Out-of-Service-Area Confirm Modal (FFS-1187 / Phase 4)
 *
 * Shown when staff clicks "Approve & Send" on the out-of-service-area
 * banner. Always displays the current pipeline mode prominently:
 *   - DRY RUN     → email is rendered + logged but not sent
 *   - TEST OVERRIDE → real send goes to override recipient
 *   - LIVE        → real send goes to actual recipient
 *
 * The mode is fetched from /api/admin/email-settings/state at open
 * time so it reflects the current state of the Phase 5 toggles.
 *
 * Does NOT do the send itself — calls onConfirm() and lets the
 * parent panel POST to /api/emails/send-out-of-service-area.
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export type PipelineMode = "dry_run" | "test_override" | "live" | "unknown";

export interface PipelineModeState {
  mode: PipelineMode;
  test_recipient_override: string | null;
  out_of_area_live: boolean;
  global_dry_run: boolean;
}

export interface SendOutOfServiceConfirmModalProps {
  open: boolean;
  recipientEmail: string;
  recipientName: string | null;
  detectedCounty: string | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

async function fetchPipelineState(): Promise<PipelineModeState> {
  try {
    return await fetchApi<PipelineModeState>("/api/admin/email-settings/state");
  } catch {
    return {
      mode: "unknown",
      test_recipient_override: null,
      out_of_area_live: false,
      global_dry_run: true,
    };
  }
}

function ModeBadge({
  state,
  recipientEmail,
}: {
  state: PipelineModeState;
  recipientEmail: string;
}) {
  if (state.mode === "dry_run") {
    return (
      <div
        style={{
          background: "rgba(255, 193, 7, 0.15)",
          border: "1px solid rgba(255, 193, 7, 0.45)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          gap: "0.625rem",
          alignItems: "flex-start",
        }}
      >
        <Icon name="alert-triangle" size={20} color="#856404" />
        <div>
          <div style={{ fontWeight: 700, color: "#856404", fontSize: "0.9rem" }}>
            DRY RUN MODE
          </div>
          <div style={{ fontSize: "0.8rem", color: "#856404" }}>
            This email will be rendered and logged in <code>ops.sent_emails</code>{" "}
            but <strong>NOT</strong> sent. Toggle off in{" "}
            <code>/admin/email-settings</code>.
          </div>
        </div>
      </div>
    );
  }

  if (state.mode === "test_override" && state.test_recipient_override) {
    return (
      <div
        style={{
          background: "rgba(255, 193, 7, 0.15)",
          border: "1px solid rgba(255, 193, 7, 0.45)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          gap: "0.625rem",
          alignItems: "flex-start",
        }}
      >
        <Icon name="alert-triangle" size={20} color="#856404" />
        <div>
          <div style={{ fontWeight: 700, color: "#856404", fontSize: "0.9rem" }}>
            TEST OVERRIDE
          </div>
          <div style={{ fontSize: "0.8rem", color: "#856404" }}>
            This will send to{" "}
            <strong>{state.test_recipient_override}</strong> instead of{" "}
            <strong>{recipientEmail}</strong>.
          </div>
        </div>
      </div>
    );
  }

  if (state.mode === "live") {
    return (
      <div
        style={{
          background: "rgba(25, 135, 84, 0.12)",
          border: "1px solid rgba(25, 135, 84, 0.35)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          display: "flex",
          gap: "0.625rem",
          alignItems: "flex-start",
        }}
      >
        <Icon name="check-circle" size={20} color="#198754" />
        <div>
          <div style={{ fontWeight: 700, color: "#198754", fontSize: "0.9rem" }}>
            LIVE
          </div>
          <div style={{ fontSize: "0.8rem", color: "#198754" }}>
            This will send a real email to{" "}
            <strong>{recipientEmail}</strong>.
          </div>
        </div>
      </div>
    );
  }

  // unknown — default safe message
  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        marginBottom: "1rem",
        fontSize: "0.85rem",
      }}
    >
      Pipeline mode unknown — assuming safest default (dry-run). Check{" "}
      <code>/admin/email-settings</code>.
    </div>
  );
}

export function SendOutOfServiceConfirmModal({
  open,
  recipientEmail,
  recipientName,
  detectedCounty,
  loading,
  onConfirm,
  onCancel,
}: SendOutOfServiceConfirmModalProps) {
  const [state, setState] = useState<PipelineModeState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStateLoading(true);
    fetchPipelineState()
      .then(setState)
      .finally(() => setStateLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--background)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          maxWidth: 540,
          width: "100%",
          padding: "1.5rem",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: 700 }}>
          Send out-of-service-area email?
        </h2>
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
          }}
        >
          Recipient: <strong>{recipientName || "(no name)"}</strong>{" "}
          &lt;{recipientEmail}&gt;
          {detectedCounty && (
            <>
              <br />
              Detected county: <strong>{detectedCounty}</strong>
            </>
          )}
        </p>

        {stateLoading || !state ? (
          <div
            style={{
              padding: "0.75rem",
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
            }}
          >
            Loading pipeline state…
          </div>
        ) : (
          <ModeBadge state={state} recipientEmail={recipientEmail} />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1rem",
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            loading={loading}
            icon="send"
          >
            {state?.mode === "dry_run"
              ? "Run dry-run"
              : state?.mode === "test_override"
                ? "Send test override"
                : "Send email"}
          </Button>
        </div>
      </div>
    </div>
  );
}
