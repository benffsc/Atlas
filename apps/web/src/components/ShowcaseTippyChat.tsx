"use client";

/**
 * ShowcaseTippyChat — demo version of TippyChat for showcase/gala mode.
 *
 * Same FAB bubble in the bottom-right corner. When opened, shows a chat
 * panel with pre-made question chips. Click a question → it appears in
 * the input, "sends", tool phases animate, scripted response types out.
 *
 * No API calls. No real data. Pure showcase.
 *
 * The presenter flow:
 *   1. Click the Tippy mascot bubble (or it auto-opens)
 *   2. See 3-4 curated question chips
 *   3. Click one → text types into input → auto-sends
 *   4. Tool call phases animate ("Analyzing location...", "Querying database...")
 *   5. Response types out with markdown formatting
 *   6. New question chips appear for next demo
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

interface DemoConversation {
  question: string;
  tools: string[];
  response: string;
}

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    question: "What's happening at the Montecito Ave corridor?",
    tools: ["Looking up place", "Querying database", "Checking corridor links"],
    response:
      "**Montecito Ave Corridor** — 5-address colony cluster in Santa Rosa\n\n" +
      "| Metric | Value |\n|--------|-------|\n" +
      "| Tracked cats | 12 |\n| Altered | 9 (75%) |\n| Active requests | 1 (in progress) |\n| Disease alerts | None |\n\n" +
      "**Recent activity:**\n" +
      "- Community member reported 5 new cats + possible kittens behind the apartments\n" +
      "- Trapper D.F. has set traps, no catches yet\n" +
      "- Follow-up scheduled for June 15\n\n" +
      "The corridor connects 5 adjacent properties where cats move freely between yards. " +
      "Coverage is good at 75% but the new arrivals need attention.",
  },
  {
    question: "Give me today's briefing",
    tools: ["Running daily briefing", "Checking active requests", "Aggregating clinic stats"],
    response:
      "**Daily Briefing**\n\n" +
      "**Clinic today:** 8 cats scheduled (3 from Todd Rd, 2 walk-ins, 3 from Stony Point)\n\n" +
      "**Urgent items:**\n" +
      "- FIV+ alert at Todd Rd — gray tabby tested positive yesterday\n" +
      "- 2 overdue intake submissions (48+ hrs, no contact attempt)\n\n" +
      "**By the numbers:**\n" +
      "| | Count |\n|--|-------|\n" +
      "| Active requests | 14 |\n| Stale (7+ days) | 3 |\n| Cats altered this week | 23 |\n| Projected monthly pace | ~3,554 |\n\n" +
      "**Follow-ups due:** Rick on Dutton Ave (kitten count), Katie Moore (clinic drop-off Tuesday)",
  },
  {
    question: "Find trappers available near Rohnert Park",
    tools: ["Searching trappers", "Checking availability", "Calculating service areas"],
    response:
      "**Available Trappers — Rohnert Park Area**\n\n" +
      "| Trapper | Tier | Status | Distance | Recent |\n" +
      "|---------|------|--------|----------|--------|\n" +
      "| D.F. | FFSC Volunteer | Available | 2.1 mi | 8 cats last month |\n" +
      "| K.M. | Community | Available | 4.3 mi | 3 cats last week |\n" +
      "| J.T. | Community | Busy until June 1 | 3.8 mi | 12 cats this quarter |\n\n" +
      "**Recommendation:** D.F. is closest, available, and has trapped in this area before " +
      "(Stony Point corridor, 2 miles north).\n\n" +
      "I can create a trapping request for Rohnert Park if you'd like.",
  },
  {
    question: "How is our spay/neuter coverage in West Santa Rosa?",
    tools: ["Querying database", "Analyzing population estimates", "Mapping colony data"],
    response:
      "**West Santa Rosa — TNR Coverage Analysis**\n\n" +
      "| Zone | Colonies | Cats Known | Altered | Coverage |\n" +
      "|------|----------|-----------|---------|----------|\n" +
      "| Dutton Meadow | 4 | 31 | 24 | 77% |\n" +
      "| Stony Point | 3 | 18 | 15 | 83% |\n" +
      "| Todd Road | 5 | 42 | 29 | 69% |\n" +
      "| West College | 2 | 8 | 8 | 100% |\n\n" +
      "**Overall:** 99 cats tracked, 76 altered (**76.8% coverage**)\n\n" +
      "Todd Road is the weakest area — 3 colonies under 70%. The FIV+ case from yesterday " +
      "adds urgency. Recommend prioritizing Todd Rd for next clinic day allocation.",
  },
];

/** Custom link renderer matching real TippyChat */
function TippyLink(props: React.JSX.IntrinsicElements["a"]) {
  const { href, children, ...rest } = props;
  return (
    <a href={href} {...rest} style={{ color: "#667eea", textDecoration: "underline", cursor: "pointer", fontWeight: 500 }}>
      {children}
    </a>
  );
}

const markdownComponents = { a: TippyLink };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ShowcaseTippyChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "typing-question" | "tools" | "typing-response" | "done">("idle");
  const [currentTools, setCurrentTools] = useState<string[]>([]);
  const [toolIndex, setToolIndex] = useState(0);
  const [responseText, setResponseText] = useState("");
  const [showBubble, setShowBubble] = useState(true);
  const [usedQuestions, setUsedQuestions] = useState<Set<number>>(new Set());
  const timerRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, responseText, toolIndex]);

  const availableQuestions = DEMO_CONVERSATIONS.filter((_, i) => !usedQuestions.has(i));

  const runDemo = useCallback((index: number) => {
    const convo = DEMO_CONVERSATIONS[index];
    if (!convo) return;

    // Mark as used
    setUsedQuestions((prev) => new Set(prev).add(index));

    // Phase 1: Type the question into the input
    setPhase("typing-question");
    setInput("");
    let qi = 0;
    const typeQuestion = () => {
      if (qi < convo.question.length) {
        const chunk = Math.min(Math.floor(Math.random() * 4) + 3, convo.question.length - qi);
        setInput(convo.question.substring(0, qi + chunk));
        qi += chunk;
        timerRef.current = window.setTimeout(typeQuestion, 20 + Math.random() * 20);
      } else {
        // "Send" the question
        timerRef.current = window.setTimeout(() => {
          setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: convo.question }]);
          setInput("");

          // Phase 2: Tool calls
          setPhase("tools");
          setCurrentTools(convo.tools);
          setToolIndex(0);

          let ti = 0;
          const toolStep = setInterval(() => {
            ti++;
            if (ti < convo.tools.length) {
              setToolIndex(ti);
            } else {
              clearInterval(toolStep);
              // Phase 3: Type response
              timerRef.current = window.setTimeout(() => {
                setPhase("typing-response");
                setResponseText("");
                let ri = 0;
                const typeResponse = () => {
                  if (ri < convo.response.length) {
                    const chunk = Math.min(Math.floor(Math.random() * 12) + 8, convo.response.length - ri);
                    setResponseText(convo.response.substring(0, ri + chunk));
                    ri += chunk;
                    timerRef.current = window.setTimeout(typeResponse, 8 + Math.random() * 12);
                  } else {
                    // Done — add to messages
                    setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: convo.response }]);
                    setResponseText("");
                    setPhase("done");
                  }
                };
                typeResponse();
              }, 300);
            }
          }, 800);
        }, 400);
      }
    };
    timerRef.current = window.setTimeout(typeQuestion, 200);
  }, []);

  const resetAll = () => {
    clearTimeout(timerRef.current);
    setMessages([]);
    setInput("");
    setPhase("idle");
    setResponseText("");
    setCurrentTools([]);
    setUsedQuestions(new Set());
  };

  // ── Closed state: FAB bubble ──
  if (!isOpen) {
    return (
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 1000, display: "flex", alignItems: "flex-end", gap: 8 }}>
        {showBubble && (
          <div
            onClick={() => { setShowBubble(false); setIsOpen(true); }}
            style={{
              background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "16px 16px 4px 16px", padding: "8px 14px",
              boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))",
              cursor: "pointer", fontSize: "0.85rem", color: "var(--foreground)",
              fontWeight: 500, animation: "tippy-bubble-in 0.4s ease-out", maxWidth: 180,
            }}
          >
            Ask me anything!
          </div>
        )}
        <button
          className="tippy-fab"
          onClick={() => setIsOpen(true)}
          style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "linear-gradient(145deg, #f8f8ff 0%, #e8f5e9 100%)",
            border: "none", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(102, 126, 234, 0.25), 0 2px 8px rgba(0,0,0,0.08)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform 0.2s, box-shadow 0.2s", padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.1)";
            setShowBubble(true);
          }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          title="Ask Tippy"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tippy-mascot.png" alt="Tippy"
            className="tippy-mascot-img"
            style={{ width: 42, height: 42, objectFit: "contain", animation: "tippy-idle 3s ease-in-out infinite" }}
          />
        </button>
      </div>
    );
  }

  // ── Open state: Chat panel ──
  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 1001,
      width: 420, maxWidth: "calc(100vw - 32px)",
      height: 560, maxHeight: "calc(100vh - 100px)",
      background: "var(--card-bg, #fff)",
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: 16,
      boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      animation: "tippy-bubble-in 0.3s ease-out",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--border, #e5e7eb)",
        background: "linear-gradient(135deg, #f0f4ff 0%, #f0fdf4 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tippy-mascot.png" alt="Tippy" style={{ width: 32, height: 32, objectFit: "contain" }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Tippy</div>
            <div style={{ fontSize: "0.65rem", color: "var(--muted, #6b7280)" }}>AI Operations Assistant</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {messages.length > 0 && (
            <button onClick={resetAll} style={{
              background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
              fontSize: "0.7rem", padding: "4px 8px", borderRadius: 4,
            }}>
              Reset
            </button>
          )}
          <button onClick={() => setIsOpen(false)} style={{
            background: "none", border: "none", color: "var(--muted)",
            cursor: "pointer", padding: "4px", borderRadius: 4, fontSize: "1.1rem",
          }}>
            &times;
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Welcome message if no messages */}
        {messages.length === 0 && phase === "idle" && (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tippy-mascot.png" alt="" style={{ width: 48, height: 48, objectFit: "contain", margin: "0 auto 8px", display: "block", opacity: 0.8 }} />
            <div style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: 4 }}>Hi! I&apos;m Tippy.</div>
            <div style={{ fontSize: "0.78rem" }}>I can answer questions about colonies, requests, trappers, and clinic data. Try one:</div>
          </div>
        )}

        {/* Rendered messages */}
        {messages.map((msg) => (
          <div key={msg.id} style={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%", padding: "10px 14px", borderRadius: 12,
            background: msg.role === "user" ? "var(--primary, #3b82f6)" : "var(--section-bg, #f3f4f6)",
            color: msg.role === "user" ? "#fff" : "var(--foreground)",
            fontSize: "0.85rem", lineHeight: 1.5,
            borderBottomRightRadius: msg.role === "user" ? 4 : 12,
            borderBottomLeftRadius: msg.role === "assistant" ? 4 : 12,
          }}>
            {msg.role === "assistant" ? (
              <div className="tippy-markdown">
                <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
              </div>
            ) : msg.content}
          </div>
        ))}

        {/* Tool call phase */}
        {phase === "tools" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
            {currentTools.map((tool, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: "0.72rem", color: "var(--muted, #6b7280)",
                opacity: i > toolIndex ? 0.3 : 1, transition: "opacity 300ms ease",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: i === toolIndex ? "var(--primary, #3b82f6)" : "var(--success-text, #16a34a)",
                  animation: i === toolIndex ? "live-counter-pulse 1.5s ease-out infinite" : "none",
                }} />
                {tool}{i <= toolIndex && i < toolIndex ? " done" : i === toolIndex ? "..." : ""}
              </div>
            ))}
          </div>
        )}

        {/* Streaming response */}
        {phase === "typing-response" && responseText && (
          <div style={{
            alignSelf: "flex-start", maxWidth: "88%", padding: "10px 14px",
            borderRadius: "12px 12px 12px 4px",
            background: "var(--section-bg, #f3f4f6)", color: "var(--foreground)",
            fontSize: "0.85rem", lineHeight: 1.5,
          }}>
            <div className="tippy-markdown">
              <ReactMarkdown components={markdownComponents}>{responseText}</ReactMarkdown>
            </div>
            <span style={{
              display: "inline-block", width: 2, height: "1em",
              background: "var(--primary, #3b82f6)", marginLeft: 2,
              animation: "showcase-cursor-blink 0.8s steps(2) infinite",
              verticalAlign: "text-bottom",
            }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Question chips — always visible when idle or done */}
      {(phase === "idle" || phase === "done") && availableQuestions.length > 0 && (
        <div style={{
          padding: "8px 16px 4px", borderTop: "1px solid var(--border, #e5e7eb)",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ fontSize: "0.6rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Try asking
          </div>
          {availableQuestions.map((convo, _i) => {
            const realIndex = DEMO_CONVERSATIONS.indexOf(convo);
            return (
              <button
                key={realIndex}
                onClick={() => runDemo(realIndex)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: 8,
                  background: "var(--section-bg, #f3f4f6)",
                  border: "1px solid transparent",
                  color: "var(--foreground)", fontSize: "0.8rem",
                  cursor: "pointer", transition: "border-color 150ms ease, background 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--primary, #3b82f6)";
                  e.currentTarget.style.background = "var(--card-bg, #fff)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "transparent";
                  e.currentTarget.style.background = "var(--section-bg, #f3f4f6)";
                }}
              >
                {convo.question}
              </button>
            );
          })}
          {availableQuestions.length === 0 && (
            <button onClick={resetAll} style={{
              padding: "6px 10px", background: "none", border: "1px solid var(--border)",
              borderRadius: 6, fontSize: "0.75rem", color: "var(--muted)", cursor: "pointer",
            }}>
              Start over
            </button>
          )}
        </div>
      )}

      {/* "All demos seen" reset */}
      {phase === "done" && availableQuestions.length === 0 && (
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border, #e5e7eb)", textAlign: "center" }}>
          <button onClick={resetAll} style={{
            padding: "6px 14px", background: "var(--primary)", color: "var(--primary-foreground)",
            border: "none", borderRadius: 6, fontSize: "0.8rem", fontWeight: 500, cursor: "pointer",
          }}>
            Start Over
          </button>
        </div>
      )}

      {/* Input bar (visual only — shows typing animation) */}
      <div style={{
        padding: "8px 16px 12px",
        borderTop: phase === "idle" || phase === "done" ? "none" : "1px solid var(--border, #e5e7eb)",
      }}>
        <div style={{
          display: "flex", gap: 8, alignItems: "center",
          background: "var(--section-bg, #f3f4f6)",
          borderRadius: 24, padding: "6px 6px 6px 16px",
        }}>
          <input
            value={input}
            readOnly
            placeholder="Ask Tippy..."
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: "0.85rem", color: "var(--foreground)",
            }}
          />
          <button style={{
            padding: "6px 14px", borderRadius: 20,
            background: input.trim() ? "var(--primary)" : "var(--card-border)",
            color: input.trim() ? "#fff" : "var(--muted)",
            border: "none", fontSize: "0.8rem", fontWeight: 500,
            cursor: "default",
          }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
