"use client";

/**
 * ShowcaseTippyChat — demo version of TippyChat for showcase/gala mode.
 *
 * Same FAB bubble. Opens a chat panel with pre-made question chips
 * AND a real input field for typing custom questions. Pre-made questions
 * get scripted responses; custom questions get a generic showcase response.
 *
 * Uses remark-gfm for proper markdown table rendering.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
      "- Diane F. has set traps, no catches yet\n" +
      "- Follow-up scheduled for June 15\n\n" +
      "The corridor connects 5 adjacent properties where cats move freely between yards. " +
      "Coverage is good at 75% but the new arrivals need attention.",
  },
  {
    question: "Who can trap in Rohnert Park right now?",
    tools: ["Searching trappers", "Checking availability", "Calculating service areas"],
    response:
      "**Available Trappers — Rohnert Park**\n\n" +
      "| Trapper | Type | Status | Cats (last 30d) |\n" +
      "|---------|------|--------|----------------|\n" +
      "| Crystal | FFSC Volunteer | Available | 6 |\n" +
      "| Christina Z. | Community Trapper | Available | 4 |\n\n" +
      "Both are experienced in the Rohnert Park area. Crystal covers the west side (near Stony Point), " +
      "Christina Z. covers east toward Cotati.\n\n" +
      "**Note:** Katie Moore (Cat Rescue of Cloverdale) sometimes traps in northern Sonoma but she's " +
      "45 min from RP — better suited for Alexander Valley and Cloverdale requests.\n\n" +
      "Want me to create a trapping request and notify Crystal?",
  },
  {
    question: "Give me a briefing on the Todd Rd colonies",
    tools: ["Running place briefing", "Checking disease status", "Loading corridor data"],
    response:
      "**Todd Rd Colony Cluster** — 5 colonies along Todd Road, Santa Rosa\n\n" +
      "| Colony | Cats | Altered | Coverage | Last TNR |\n" +
      "|--------|------|---------|----------|----------|\n" +
      "| Todd Rd West | 14 | 8 | 57% | 3 weeks ago |\n" +
      "| Todd Rd East | 9 | 7 | 78% | 2 months ago |\n" +
      "| Empire Industrial | 11 | 9 | 82% | 6 weeks ago |\n" +
      "| Chevron lot | 5 | 5 | 100% | 4 months ago |\n" +
      "| Behind storage units | 3 | 1 | 33% | 8 months ago |\n\n" +
      "**Alerts:**\n" +
      "- **FIV+ detected** at Todd Rd West — gray tabby tested positive last clinic day\n" +
      "- Todd Rd West has the lowest coverage (57%) and the most unaltered cats\n" +
      "- Storage units colony hasn't been serviced in 8 months\n\n" +
      "**Recommendation:** Prioritize Todd Rd West for next clinic allocation. The FIV+ case " +
      "makes alteration urgent to prevent spread through mating.",
  },
  {
    question: "How many cats have we altered this year?",
    tools: ["Aggregating clinic data", "Computing year-to-date stats"],
    response:
      "**2026 Year-to-Date Impact**\n\n" +
      "| Period | Cats Altered | Clinic Days |\n" +
      "|--------|-------------|-------------|\n" +
      "| January | 287 | 13 |\n" +
      "| February | 262 | 12 |\n" +
      "| March | 301 | 14 |\n" +
      "| April | 294 | 13 |\n" +
      "| May (so far) | 187 | 8 |\n" +
      "| **Total** | **1,331** | **60** |\n\n" +
      "Running at **~22 cats per clinic day**. At current pace, we'll reach **~3,500** by end of year — " +
      "which would be our highest annual total ever.\n\n" +
      "Since 2013, FFSC has altered over **37,000 community cats** in Sonoma County.",
  },
];

const GENERIC_RESPONSE: DemoConversation = {
  question: "",
  tools: ["Searching records", "Analyzing data"],
  response:
    "I found relevant information in our database. In a live session, I'd query across " +
    "**37,000+ cat records**, **14,000+ places**, and **8,000+ people** to give you a detailed answer.\n\n" +
    "Try one of the suggested questions to see a full demo, or ask me about:\n" +
    "- Colony status at any address\n" +
    "- Trapper availability by area\n" +
    "- Clinic day stats and impact numbers\n" +
    "- Disease alerts and watch lists",
};

function TippyLink(props: React.JSX.IntrinsicElements["a"]) {
  const { href, children, ...rest } = props;
  return (
    <a href={href} {...rest} style={{ color: "#667eea", textDecoration: "underline", cursor: "pointer", fontWeight: 500 }}>
      {children}
    </a>
  );
}

const mdComponents = { a: TippyLink };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ShowcaseTippyChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "tools" | "typing-response" | "done">("idle");
  const [currentTools, setCurrentTools] = useState<string[]>([]);
  const [toolIndex, setToolIndex] = useState(0);
  const [responseText, setResponseText] = useState("");
  const [showBubble, setShowBubble] = useState(true);
  const [usedQuestions, setUsedQuestions] = useState<Set<number>>(new Set());
  const timerRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, responseText, toolIndex, phase]);

  const availableQuestions = DEMO_CONVERSATIONS.filter((_, i) => !usedQuestions.has(i));

  const runConversation = useCallback((convo: DemoConversation, questionText: string, demoIndex?: number) => {
    if (demoIndex !== undefined) {
      setUsedQuestions((prev) => new Set(prev).add(demoIndex));
    }

    // Add user message
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: questionText }]);
    setInput("");

    // Phase 1: Tool calls
    setPhase("tools");
    setCurrentTools(convo.tools);
    setToolIndex(0);

    let ti = 0;
    const toolInterval = setInterval(() => {
      ti++;
      if (ti < convo.tools.length) {
        setToolIndex(ti);
      } else {
        clearInterval(toolInterval);
        // Phase 2: Type response
        timerRef.current = window.setTimeout(() => {
          setPhase("typing-response");
          setResponseText("");
          let ri = 0;
          const typeResponse = () => {
            if (ri < convo.response.length) {
              const chunk = Math.min(Math.floor(Math.random() * 14) + 10, convo.response.length - ri);
              setResponseText(convo.response.substring(0, ri + chunk));
              ri += chunk;
              timerRef.current = window.setTimeout(typeResponse, 6 + Math.random() * 10);
            } else {
              setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: convo.response }]);
              setResponseText("");
              setPhase("done");
            }
          };
          typeResponse();
        }, 300);
      }
    }, 700);
  }, []);

  const handleChipClick = useCallback((index: number) => {
    const convo = DEMO_CONVERSATIONS[index];
    runConversation(convo, convo.question, index);
  }, [runConversation]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || phase !== "idle" && phase !== "done") return;

    // Check if it matches a demo question (fuzzy)
    const matchIndex = DEMO_CONVERSATIONS.findIndex((c) =>
      !usedQuestions.has(DEMO_CONVERSATIONS.indexOf(c)) &&
      text.toLowerCase().includes(c.question.split(" ").slice(0, 3).join(" ").toLowerCase())
    );

    if (matchIndex >= 0) {
      runConversation(DEMO_CONVERSATIONS[matchIndex], text, matchIndex);
    } else {
      // Generic response for custom questions
      runConversation(GENERIC_RESPONSE, text);
    }
  }, [input, phase, usedQuestions, runConversation]);

  const resetAll = () => {
    clearTimeout(timerRef.current);
    setMessages([]);
    setInput("");
    setPhase("idle");
    setResponseText("");
    setUsedQuestions(new Set());
  };

  // ── Closed: FAB bubble ──
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
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1)"; setShowBubble(true); }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          title="Ask Tippy"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tippy-mascot.png" alt="Tippy" className="tippy-mascot-img"
            style={{ width: 42, height: 42, objectFit: "contain", animation: "tippy-idle 3s ease-in-out infinite" }} />
        </button>
      </div>
    );
  }

  // ── Open: Chat panel ──
  const isBusy = phase === "tools" || phase === "typing-response";

  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 1001,
      width: 420, maxWidth: "calc(100vw - 32px)",
      height: 580, maxHeight: "calc(100vh - 100px)",
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
        padding: "10px 16px", borderBottom: "1px solid var(--border, #e5e7eb)",
        background: "linear-gradient(135deg, #f0f4ff 0%, #f0fdf4 100%)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tippy-mascot.png" alt="Tippy" style={{ width: 28, height: 28, objectFit: "contain" }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", lineHeight: 1.2 }}>Tippy</div>
            <div style={{ fontSize: "0.6rem", color: "var(--muted, #6b7280)" }}>AI Operations Assistant</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {messages.length > 0 && (
            <button onClick={resetAll} style={{
              background: "none", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer",
              fontSize: "0.65rem", padding: "3px 8px", borderRadius: 4,
            }}>Reset</button>
          )}
          <button onClick={() => setIsOpen(false)} style={{
            background: "none", border: "none", color: "var(--muted)",
            cursor: "pointer", padding: "2px 6px", fontSize: "1.1rem", lineHeight: 1,
          }}>&times;</button>
        </div>
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Welcome */}
        {messages.length === 0 && !isBusy && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "var(--muted)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tippy-mascot.png" alt="" style={{ width: 44, height: 44, objectFit: "contain", margin: "0 auto 6px", display: "block", opacity: 0.8 }} />
            <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: 2 }}>Hi! I&apos;m Tippy.</div>
            <div style={{ fontSize: "0.75rem" }}>Click a question below or type your own.</div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div key={msg.id} style={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: msg.role === "user" ? "85%" : "92%",
            padding: msg.role === "user" ? "8px 12px" : "10px 14px",
            borderRadius: 12,
            background: msg.role === "user" ? "var(--primary, #3b82f6)" : "var(--section-bg, #f3f4f6)",
            color: msg.role === "user" ? "#fff" : "var(--foreground)",
            fontSize: "0.82rem", lineHeight: 1.5,
            borderBottomRightRadius: msg.role === "user" ? 4 : 12,
            borderBottomLeftRadius: msg.role === "assistant" ? 4 : 12,
          }}>
            {msg.role === "assistant" ? (
              <div className="tippy-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
              </div>
            ) : msg.content}
          </div>
        ))}

        {/* Tool phases */}
        {phase === "tools" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "4px 0" }}>
            {currentTools.map((tool, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: "0.7rem", color: "var(--muted)",
                opacity: i > toolIndex ? 0.3 : 1, transition: "opacity 300ms",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: i === toolIndex ? "var(--primary)" : "var(--success-text, #16a34a)",
                  animation: i === toolIndex ? "live-counter-pulse 1.5s ease-out infinite" : "none",
                }} />
                {tool}{i < toolIndex ? " \u2713" : i === toolIndex ? "..." : ""}
              </div>
            ))}
          </div>
        )}

        {/* Streaming response */}
        {phase === "typing-response" && responseText && (
          <div style={{
            alignSelf: "flex-start", maxWidth: "92%", padding: "10px 14px",
            borderRadius: "12px 12px 12px 4px",
            background: "var(--section-bg, #f3f4f6)", color: "var(--foreground)",
            fontSize: "0.82rem", lineHeight: 1.5,
          }}>
            <div className="tippy-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{responseText}</ReactMarkdown>
            </div>
            <span style={{
              display: "inline-block", width: 2, height: "1em",
              background: "var(--primary)", marginLeft: 1,
              animation: "showcase-cursor-blink 0.8s steps(2) infinite",
              verticalAlign: "text-bottom",
            }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Question chips */}
      {(phase === "idle" || phase === "done") && availableQuestions.length > 0 && (
        <div style={{
          padding: "6px 14px 2px", borderTop: "1px solid var(--border)",
          display: "flex", flexWrap: "wrap", gap: 4, flexShrink: 0,
        }}>
          {availableQuestions.map((convo) => {
            const idx = DEMO_CONVERSATIONS.indexOf(convo);
            return (
              <button key={idx} onClick={() => handleChipClick(idx)} style={{
                padding: "5px 10px", borderRadius: 16,
                background: "var(--section-bg, #f3f4f6)", border: "1px solid transparent",
                color: "var(--foreground)", fontSize: "0.72rem", cursor: "pointer",
                transition: "border-color 150ms, background 150ms", lineHeight: 1.3,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
              >
                {convo.question}
              </button>
            );
          })}
        </div>
      )}

      {/* All used — reset */}
      {phase === "done" && availableQuestions.length === 0 && (
        <div style={{ padding: "6px 14px 2px", borderTop: "1px solid var(--border)", textAlign: "center", flexShrink: 0 }}>
          <button onClick={resetAll} style={{
            padding: "5px 12px", background: "var(--section-bg)", border: "1px solid var(--border)",
            borderRadius: 16, fontSize: "0.72rem", color: "var(--muted)", cursor: "pointer",
          }}>Start over</button>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} style={{ padding: "8px 14px 10px", flexShrink: 0 }}>
        <div style={{
          display: "flex", gap: 6, alignItems: "center",
          background: "var(--section-bg, #f3f4f6)", borderRadius: 24,
          padding: "5px 5px 5px 14px",
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a question..."
            disabled={isBusy}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: "0.82rem", color: "var(--foreground)",
            }}
          />
          <button type="submit" disabled={!input.trim() || isBusy} style={{
            padding: "5px 12px", borderRadius: 20,
            background: input.trim() && !isBusy ? "var(--primary)" : "var(--card-border)",
            color: input.trim() && !isBusy ? "#fff" : "var(--muted)",
            border: "none", fontSize: "0.78rem", fontWeight: 500,
            cursor: input.trim() && !isBusy ? "pointer" : "default",
          }}>Send</button>
        </div>
      </form>
    </div>
  );
}
