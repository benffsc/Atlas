"use client";

/**
 * ShowcaseToolbar — presenter control panel for gala demos.
 *
 * Replaces the simple "Beacon · Live" indicator with an expandable
 * toolbar that lets the presenter trigger any demo feature in any
 * order, without dependencies between them:
 *
 *   [Quick Capture] — scrolls to card + triggers auto-type demo
 *   [Ask Tippy]     — opens pre-scripted conversation overlay
 *   [Walkthrough]   — existing guided product tour
 *
 * Collapsed state: small "Beacon · Live" pill (same as before)
 * Expanded state: full control panel with labeled buttons
 *
 * Communication with demo components via custom DOM events:
 *   - "showcase:quickcapture" → triggers/resets ShowcaseQuickCapture
 *   - Tippy demo is self-contained in this component (overlay)
 */

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";

// ── Pre-scripted Tippy conversation for the demo ──

interface DemoMessage {
  role: "user" | "assistant";
  content: string;
  /** Tool call labels shown as phase indicators */
  tools?: string[];
}

const TIPPY_DEMO_CONVERSATIONS: { label: string; messages: DemoMessage[] }[] = [
  {
    label: "What's happening at Montecito Ave?",
    messages: [
      { role: "user", content: "What's happening at Montecito Ave?" },
      {
        role: "assistant",
        content:
          "**Montecito Ave Corridor** is a 5-address colony cluster in Santa Rosa. Here's the current status:\n\n" +
          "- **12 cats** tracked across the corridor, **9 altered** (75% coverage)\n" +
          "- **Active request** (in progress) — trapping assistance requested 3 weeks ago\n" +
          "- **Recent activity:** Community member reported 5 new cats + possible kittens behind the apartments\n" +
          "- **Trapper assigned:** Diane F. has set traps, no catches yet\n" +
          "- **Disease status:** No FeLV/FIV positives detected\n\n" +
          "The corridor connects 5 adjacent properties where cats move freely between yards. Next follow-up is scheduled for June 15.",
        tools: ["Analyzing location", "Querying database", "Checking corridor links"],
      },
    ],
  },
  {
    label: "Give me today's briefing",
    messages: [
      { role: "user", content: "Give me today's briefing" },
      {
        role: "assistant",
        content:
          "**Daily Briefing — Beacon Operations**\n\n" +
          "**Clinic:** 8 cats scheduled for alteration today (3 from Todd Rd colony, 2 walk-ins, 3 from Stony Point)\n\n" +
          "**Urgent:**\n" +
          "- FIV+ alert at Todd Rd — gray tabby tested positive yesterday, colony contacts notified\n" +
          "- 2 overdue intake submissions (48+ hours, no contact attempt)\n\n" +
          "**Active Requests:** 14 open, 3 stale (no activity in 7+ days)\n" +
          "- Montecito corridor: trapping in progress\n" +
          "- Alexander Valley: 3 ferals scheduled for spay next Tuesday\n\n" +
          "**This Week:** 23 cats altered so far (on pace for ~35, above monthly average)\n\n" +
          "**Follow-ups Due:** Rick on Dutton Ave (kitten count), Katie Moore (clinic drop-off Tuesday)",
        tools: ["Running daily briefing", "Checking active requests", "Aggregating clinic stats"],
      },
    ],
  },
  {
    label: "Find trappers near Rohnert Park",
    messages: [
      { role: "user", content: "Find trappers available near Rohnert Park" },
      {
        role: "assistant",
        content:
          "**Available Trappers — Rohnert Park Area**\n\n" +
          "| Trapper | Tier | Status | Distance | Recent Activity |\n" +
          "|---------|------|--------|----------|----------------|\n" +
          "| D.F. | FFSC Volunteer | Available | 2.1 mi | 8 cats last month |\n" +
          "| K.M. | Community | Available | 4.3 mi | 3 cats last week |\n" +
          "| J.T. | Community | Busy until June 1 | 3.8 mi | 12 cats this quarter |\n\n" +
          "D.F. is your best option — closest, available, and has trapped in this area before (Stony Point corridor, 2 miles north).\n\n" +
          "Want me to create a trapping request for Rohnert Park?",
        tools: ["Searching trappers", "Checking availability", "Calculating distances"],
      },
    ],
  },
];

// ── ShowcaseToolbar Component ──

interface ShowcaseToolbarProps {
  onExit: () => void;
}

export function ShowcaseToolbar({ onExit }: ShowcaseToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [tippyDemo, setTippyDemo] = useState<number | null>(null);
  const [tippyPhase, setTippyPhase] = useState<"idle" | "tools" | "typing" | "done">("idle");
  const [tippyText, setTippyText] = useState("");
  const [tippyToolIndex, setTippyToolIndex] = useState(0);

  // ESC exits showcase mode (but closes tippy demo first if open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tippyDemo !== null) {
          closeTippyDemo();
        } else {
          onExit();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onExit, tippyDemo]);

  const triggerQuickCapture = useCallback(() => {
    // Dispatch event to ShowcaseQuickCapture
    window.dispatchEvent(new CustomEvent("showcase:quickcapture"));
    // Scroll to the card
    const card = document.querySelector("[data-showcase-quickcapture]");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    setExpanded(false);
  }, []);

  const openTippyDemo = useCallback((index: number) => {
    setTippyDemo(index);
    setTippyPhase("idle");
    setTippyText("");
    setTippyToolIndex(0);
    setExpanded(false);

    // Auto-start the demo sequence after a beat
    setTimeout(() => startTippySequence(index), 500);
  }, []);

  const closeTippyDemo = useCallback(() => {
    setTippyDemo(null);
    setTippyPhase("idle");
    setTippyText("");
  }, []);

  function startTippySequence(index: number) {
    const convo = TIPPY_DEMO_CONVERSATIONS[index];
    if (!convo) return;
    const assistantMsg = convo.messages.find((m) => m.role === "assistant");
    if (!assistantMsg) return;

    const tools = assistantMsg.tools || [];

    // Phase 1: Show tool calls one by one
    setTippyPhase("tools");
    setTippyToolIndex(0);

    let toolStep = 0;
    const toolInterval = setInterval(() => {
      toolStep++;
      if (toolStep < tools.length) {
        setTippyToolIndex(toolStep);
      } else {
        clearInterval(toolInterval);
        // Phase 2: Type the response
        setTimeout(() => {
          setTippyPhase("typing");
          typeResponse(assistantMsg.content);
        }, 400);
      }
    }, 700);
  }

  function typeResponse(fullText: string) {
    let i = 0;
    const type = () => {
      if (i < fullText.length) {
        // Type fast — 8-15 chars at a time
        const chunk = Math.min(Math.floor(Math.random() * 8) + 8, fullText.length - i);
        setTippyText(fullText.substring(0, i + chunk));
        i += chunk;
        setTimeout(type, 10 + Math.random() * 15);
      } else {
        setTippyPhase("done");
      }
    };
    setTimeout(type, 200);
  }

  return (
    <>
      {/* ── Floating toolbar ── */}
      <div className="showcase-toolbar" role="toolbar" aria-label="Showcase controls">
        {/* Collapsed pill */}
        <button
          type="button"
          className="showcase-toolbar-pill"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="presentation-indicator-dot" aria-hidden="true" />
          <span>Beacon &middot; Live</span>
          <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{expanded ? "\u25BC" : "\u25B2"}</span>
        </button>

        {/* Expanded panel */}
        {expanded && (
          <div className="showcase-toolbar-panel">
            <div className="showcase-toolbar-section">
              <span className="showcase-toolbar-label">Demos</span>
              <button
                className="showcase-toolbar-btn"
                onClick={triggerQuickCapture}
              >
                <Icon name="Zap" size={14} />
                Quick Capture
              </button>
              {TIPPY_DEMO_CONVERSATIONS.map((convo, i) => (
                <button
                  key={i}
                  className="showcase-toolbar-btn"
                  onClick={() => openTippyDemo(i)}
                >
                  <Icon name="MessageCircle" size={14} />
                  {convo.label}
                </button>
              ))}
            </div>
            <div className="showcase-toolbar-section">
              <a href="/walkthrough/" className="showcase-toolbar-btn">
                <Icon name="Play" size={14} />
                Product Walkthrough
              </a>
            </div>
            <div className="showcase-toolbar-divider" />
            <button
              className="showcase-toolbar-btn showcase-toolbar-exit"
              onClick={onExit}
            >
              Exit Showcase
            </button>
          </div>
        )}
      </div>

      {/* ── Tippy Demo Overlay ── */}
      {tippyDemo !== null && (
        <div
          className="showcase-tippy-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTippyDemo();
          }}
        >
          <div className="showcase-tippy-chat">
            {/* Header */}
            <div className="showcase-tippy-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.2rem" }}>🐱</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Tippy</div>
                  <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>AI Operations Assistant</div>
                </div>
              </div>
              <button onClick={closeTippyDemo} className="showcase-tippy-close">
                <Icon name="X" size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="showcase-tippy-messages">
              {/* User message */}
              <div className="showcase-tippy-msg showcase-tippy-msg-user">
                {TIPPY_DEMO_CONVERSATIONS[tippyDemo].messages[0].content}
              </div>

              {/* Tool calls (phase indicator) */}
              {(tippyPhase === "tools" || tippyPhase === "typing" || tippyPhase === "done") && (
                <div className="showcase-tippy-tools">
                  {(TIPPY_DEMO_CONVERSATIONS[tippyDemo].messages[1]?.tools || []).map((tool, i) => (
                    <div
                      key={i}
                      className="showcase-tippy-tool"
                      style={{ opacity: tippyPhase === "tools" && i > tippyToolIndex ? 0.3 : 1 }}
                    >
                      <span className={tippyPhase === "tools" && i === tippyToolIndex ? "showcase-tippy-tool-dot-active" : "showcase-tippy-tool-dot"} />
                      {tool}
                    </div>
                  ))}
                </div>
              )}

              {/* Assistant response (typing) */}
              {(tippyPhase === "typing" || tippyPhase === "done") && (
                <div className="showcase-tippy-msg showcase-tippy-msg-assistant">
                  <div className="showcase-tippy-md">{tippyText}</div>
                  {tippyPhase === "typing" && (
                    <span className="showcase-tippy-cursor" />
                  )}
                </div>
              )}

              {/* Processing spinner */}
              {tippyPhase === "tools" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 0", color: "var(--muted)", fontSize: "0.8rem" }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", background: "var(--primary)",
                    animation: "live-counter-pulse 1.5s ease-out infinite",
                  }} />
                  Thinking...
                </div>
              )}
            </div>

            {/* Footer */}
            {tippyPhase === "done" && (
              <div className="showcase-tippy-footer">
                <button
                  onClick={() => {
                    // Cycle to next conversation
                    const next = (tippyDemo + 1) % TIPPY_DEMO_CONVERSATIONS.length;
                    openTippyDemo(next);
                  }}
                  className="showcase-tippy-next"
                >
                  Try another question
                </button>
                <button onClick={closeTippyDemo} className="showcase-tippy-done">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
