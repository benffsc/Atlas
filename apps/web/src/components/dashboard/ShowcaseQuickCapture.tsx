"use client";

/**
 * ShowcaseQuickCapture — demo version of QuickCapture for showcase/gala mode.
 *
 * Shows the full QuickCapture UX with pre-scripted content and fake AI
 * processing. No real API calls. Cycles through curated demo scenarios
 * that show off Tippy's capabilities:
 *
 *   - Freeform brain dump → structured records
 *   - Phone call capture → field notes + reminders
 *   - Colony observation → population update
 *   - Trapper coordination → contact records
 *
 * Always shows the value-prop prompt (no time-of-day gating).
 * "Recent" row is pre-populated with realistic examples.
 */

import { useState, useRef, useEffect } from "react";
import { Icon } from "@/components/ui/Icon";

interface DemoScenario {
  /** Pre-filled text that "types itself" into the textarea */
  input: string;
  /** Fake AI summary shown after processing */
  summary: string;
  /** Number of "records created" */
  actionCount: number;
  /** Action labels for the result card */
  actions: string[];
}

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    input:
      "Got a call from a neighbor on Montecito Ave — says there are at least 5 new cats behind the apartment complex, some look like kittens. She's been leaving food out. Wants to know if we can help trap. Her number is 707-555-0199.",
    summary:
      "Logged field report: 5+ cats (possible kittens) at Montecito Ave apartments. Created contact for caller, flagged for trapping assistance. Linked to existing Montecito corridor.",
    actionCount: 3,
    actions: ["Field event logged", "Contact created", "Trapping request flagged"],
  },
  {
    input:
      "Rick from Dutton Ave left a voicemail — the mama cat from last month had another litter, he counted 4 kittens under the porch. He says Diane already set a trap but hasn't caught any yet.",
    summary:
      "Updated Dutton Ave colony: mama cat + 4 new kittens. Noted active trapping by Diane. Set follow-up reminder for 2 weeks.",
    actionCount: 3,
    actions: ["Colony update logged", "Trapping note added", "Follow-up reminder set"],
  },
  {
    input:
      "Just finished clinic day — we altered 12 cats today, 3 from the Todd Rd colony, 2 from Stony Point, rest were walk-ins. The gray tabby from Todd Rd tested positive for FIV.",
    summary:
      "Clinic day summary captured: 12 cats altered across 3 locations. FIV+ alert flagged for Todd Rd colony gray tabby. Disease status will update automatically.",
    actionCount: 4,
    actions: ["Clinic summary logged", "Todd Rd colony updated", "FIV alert created", "Stony Point updated"],
  },
  {
    input:
      "Spoke with Katie Moore (Cat Rescue of Cloverdale) — she has 3 ferals from the Alexander Valley colony that she trapped last week. All 3 are scheduled for spay next Tuesday. She'll bring them to clinic.",
    summary:
      "Trapper coordination logged: Katie Moore (Cat Rescue of Cloverdale) has 3 Alexander Valley ferals. Spay scheduled for next Tuesday at clinic.",
    actionCount: 2,
    actions: ["Trapper activity logged", "Appointment pre-registered"],
  },
];

const DEMO_RECENT = [
  '"5 cats behind Montecito apartments..."',
  '"Rick voicemail — Dutton Ave kittens..."',
  '"Clinic day: 12 cats altered, FIV+ at..."',
];

const SHOWCASE_PROMPT =
  "Got a phone call, email, or field note? Drop it here — Tippy turns it into records.";

export function ShowcaseQuickCapture() {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "typing" | "processing" | "done">("idle");
  const [result, setResult] = useState<DemoScenario | null>(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingRef = useRef<number>(0);

  // Auto-type the demo text character by character
  function startDemo() {
    const scenario = DEMO_SCENARIOS[scenarioIndex % DEMO_SCENARIOS.length];
    setState("typing");
    setText("");
    let i = 0;

    const type = () => {
      if (i < scenario.input.length) {
        // Type 2-4 chars at a time for speed
        const chunk = Math.min(Math.floor(Math.random() * 3) + 2, scenario.input.length - i);
        setText(scenario.input.substring(0, i + chunk));
        i += chunk;
        typingRef.current = window.setTimeout(type, 15 + Math.random() * 25);
      } else {
        // Pause, then "submit"
        typingRef.current = window.setTimeout(() => {
          setState("processing");
          // Simulate AI processing time
          typingRef.current = window.setTimeout(() => {
            setResult(scenario);
            setState("done");
            setScenarioIndex((prev) => prev + 1);
          }, 1800);
        }, 600);
      }
    };

    typingRef.current = window.setTimeout(type, 400);
  }

  useEffect(() => {
    return () => clearTimeout(typingRef.current);
  }, []);

  // Listen for toolbar trigger event
  useEffect(() => {
    const handler = () => {
      clearTimeout(typingRef.current);
      setState("idle");
      setText("");
      setResult(null);
      // Small delay then auto-start
      typingRef.current = window.setTimeout(() => startDemo(), 300);
    };
    window.addEventListener("showcase:quickcapture", handler);
    return () => window.removeEventListener("showcase:quickcapture", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioIndex]);

  const reset = () => {
    clearTimeout(typingRef.current);
    setState("idle");
    setText("");
    setResult(null);
  };

  return (
    <div
      data-showcase-quickcapture
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
        boxShadow: "var(--shadow-sm)",
        position: "relative",
      }}
    >
      {/* Subtle "demo" indicator */}
      <span
        style={{
          position: "absolute",
          top: "8px",
          right: "12px",
          fontSize: "0.6rem",
          color: "var(--muted)",
          opacity: 0.5,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        Live Demo
      </span>

      {state === "done" && result ? (
        /* ── Success state ── */
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ color: "var(--success-text, #16a34a)", flexShrink: 0, marginTop: 2 }}>
            <Icon name="CheckCircle" size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 500, fontSize: "0.85rem" }}>
              {result.summary}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
              {result.actionCount} record{result.actionCount !== 1 ? "s" : ""} created
              — this will surface next time someone asks about these places/people.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
              {result.actions.map((a, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: "0.65rem",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: "var(--success-bg)",
                    color: "var(--success-text)",
                    fontWeight: 500,
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={reset}
              style={{
                background: "none",
                border: "1px solid var(--card-border)",
                borderRadius: "6px",
                padding: "4px 10px",
                color: "var(--foreground)",
                cursor: "pointer",
                fontSize: "0.7rem",
              }}
            >
              + Another
            </button>
          </div>
        </div>
      ) : (
        /* ── Input state ── */
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--foreground)" }}>
              {SHOWCASE_PROMPT}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            readOnly
            placeholder="Phone call, email, text from a trapper, field observation, thought about a colony..."
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              resize: "none",
              fontSize: "0.85rem",
              fontFamily: "inherit",
              background: "var(--background)",
              color: "var(--foreground)",
              minHeight: "72px",
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {state === "idle" ? (
                <button
                  onClick={startDemo}
                  style={{
                    padding: "6px 14px",
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                  }}
                >
                  Try It
                </button>
              ) : state === "typing" ? (
                <span style={{ fontSize: "0.8rem", color: "var(--primary)", fontWeight: 500 }}>
                  Capturing...
                </span>
              ) : (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "0.8rem",
                    color: "var(--primary)",
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--primary)",
                      animation: "live-counter-pulse 1.5s ease-out infinite",
                    }}
                  />
                  Tippy is processing...
                </span>
              )}
            </div>
          </div>

          {/* Fake "recent captures" row for social proof */}
          <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "var(--muted)" }}>
            Recent: {DEMO_RECENT.map((c, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {c}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
