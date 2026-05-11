"use client";

import { useState, useEffect, useRef } from "react";
import { postApi } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";

/**
 * QuickCapture — freeform context capture card.
 *
 * Shows on dashboard (not blocking). Staff can dump text from phone calls,
 * emails, field notes, or any thought. Tippy parses it into structured data.
 *
 * Dismissable per session (localStorage) or permanently (setting).
 */

interface CaptureResult {
  summary: string;
  action_count: number;
  actions_created: string[];
}

// Contextual prompts — rotate based on time of day and capture history
function getContextualPrompt(): string {
  const hour = new Date().getHours();
  const captureCount = (() => {
    try {
      return JSON.parse(localStorage.getItem("quick-capture-recent") || "[]").length;
    } catch { return 0; }
  })();

  // First-time users get the value proposition
  if (captureCount === 0) {
    return "Got a phone call, email, or field note? Drop it here — Tippy turns it into records.";
  }

  // Time-of-day context
  if (hour < 10) {
    const prompts = [
      "Anything from yesterday you didn't get to log?",
      "Any voicemails or texts from overnight?",
      "Morning check-in — anything on your mind about a colony?",
    ];
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  if (hour >= 16) {
    const prompts = [
      "Before you head out — anything to capture from today?",
      "End of day — any calls or updates to log?",
      "Quick dump before tomorrow — anything you'll forget?",
    ];
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  // Midday — general prompts
  const prompts = [
    "Got a quick update? Drop it here.",
    "Phone call, text, or thought — capture it before it slips.",
    "Tippy's listening — what happened?",
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

export function QuickCapture() {
  const [text, setText] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "dismissed">("idle");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [recentCaptures, setRecentCaptures] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check if dismissed this session
    if (sessionStorage.getItem("quick-capture-dismissed")) {
      setState("dismissed");
    }
    // Load recent captures
    try {
      const stored = localStorage.getItem("quick-capture-recent");
      if (stored) setRecentCaptures(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const dismiss = () => {
    sessionStorage.setItem("quick-capture-dismissed", "1");
    setState("dismissed");
  };

  const submit = async () => {
    if (!text.trim() || state === "submitting") return;
    setState("submitting");

    try {
      const data = await postApi("/api/tippy/quick-capture", {
        text: source ? `[${source}] ${text.trim()}` : text.trim(),
        source: source || "quick_capture",
      }) as CaptureResult;
      setResult(data);
      setState("done");

      // Save to recent
      const preview = text.trim().substring(0, 40) + (text.length > 40 ? "..." : "");
      const updated = [preview, ...recentCaptures.slice(0, 4)];
      setRecentCaptures(updated);
      localStorage.setItem("quick-capture-recent", JSON.stringify(updated));
      setText("");
    } catch {
      setState("idle");
    }
  };

  if (state === "dismissed") return null;

  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {state === "done" && result ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ color: "var(--success-text, #16a34a)", flexShrink: 0 }}>
            <Icon name="CheckCircle" size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 500, fontSize: "0.85rem" }}>{result.summary}</p>
            {result.action_count > 0 && (
              <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                {result.action_count} record{result.action_count !== 1 ? "s" : ""} created — this will surface next time someone asks about these places/people.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={() => { setState("idle"); setResult(null); }}
              style={{ background: "none", border: "1px solid var(--card-border)", borderRadius: "6px", padding: "4px 10px", color: "var(--foreground)", cursor: "pointer", fontSize: "0.7rem" }}
            >
              + Another
            </button>
            <button
              onClick={dismiss}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "0.7rem" }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--foreground)" }}>
              {getContextualPrompt()}
            </span>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "4px" }}
            >
              <Icon name="X" size={16} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="Phone call, email, text from a trapper, field observation, thought about a colony..."
            rows={2}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              resize: "vertical",
              fontSize: "0.85rem",
              fontFamily: "inherit",
              background: "var(--background)",
              color: "var(--foreground)",
              minHeight: "52px",
            }}
          />

          {/* Source channel chips — optional, one-tap */}
          <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
            {["Phone call", "Email", "Text/SMS", "Field visit", "Voicemail"].map((s) => (
              <button
                key={s}
                onClick={() => setSource(source === s ? null : s)}
                style={{
                  padding: "2px 10px",
                  fontSize: "0.7rem",
                  borderRadius: "12px",
                  border: `1px solid ${source === s ? "var(--primary)" : "var(--card-border)"}`,
                  background: source === s ? "var(--primary)" : "transparent",
                  color: source === s ? "var(--primary-foreground)" : "var(--muted)",
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={submit}
                disabled={!text.trim() || state === "submitting"}
                style={{
                  padding: "6px 14px",
                  background: text.trim() ? "var(--primary)" : "var(--card-border)",
                  color: text.trim() ? "var(--primary-foreground)" : "var(--muted)",
                  border: "none",
                  borderRadius: "6px",
                  cursor: text.trim() ? "pointer" : "default",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                }}
              >
                {state === "submitting" ? "Capturing..." : "Capture"}
              </button>
              <span style={{ fontSize: "0.7rem", color: "var(--muted)", alignSelf: "center" }}>
                {"\u2318"}+Enter
              </span>
            </div>
            <button
              onClick={dismiss}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "0.75rem" }}
            >
              Skip
            </button>
          </div>

          {recentCaptures.length > 0 && (
            <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "var(--muted)" }}>
              Recent: {recentCaptures.slice(0, 3).map((c, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  &ldquo;{c}&rdquo;
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
