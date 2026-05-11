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
    question: "Tell me everything about 5123 Montecito Ave",
    tools: ["Analyzing location", "Querying database", "Checking corridor links", "Loading field notes"],
    response:
      "**5123 Montecito Ave, Santa Rosa** — Part of a 5-address corridor\n\n" +
      "| Metric | Value |\n|--------|-------|\n" +
      "| Cats tracked | 33 |\n| Altered | 22 (67%) |\n| Active request | In progress |\n| Observed on-site | 10-12 |\n\n" +
      "**Key people:**\n" +
      "- **Patrick Geary** — property owner (account renamed from Leslie Delong)\n" +
      "- **Robin Stovall** — assigned trapper, actively working the site\n" +
      "- **April Lofgren** — scheduled for clinic coordination\n\n" +
      "**Corridor context:** This address is linked to 4 neighbors (5055, 5100, 5209, and nearby) " +
      "where cats move freely between yards. Tippy detected kittens at both 5100 (Ian Alexander's " +
      "property — female under shed) and 5209 (reported by community member). " +
      "Follow-up assessment scheduled for June 15.\n\n" +
      "**Field note (high priority):** Gesine lent personal traps to Patrick without FFSC " +
      "approval — liability concern flagged. Crystal recovered the traps. " +
      "Clinic planned for 04/28-04/29.\n\n" +
      "This is a complex site. Want me to pull up the full corridor with all 5 addresses?",
  },
  {
    question: "What happened to the kittens from the Chevron on Todd Rd?",
    tools: ["Looking up place", "Tracing cat journeys", "Checking ShelterLuv outcomes"],
    response:
      "**Chevron Todd Rd (3825 Santa Rosa Ave)** — Lawrence's site\n\n" +
      "28 cats TNR'd total. In May 2026, new kittens were found and taken into foster care.\n\n" +
      "**Tracked outcomes for cats from this location:**\n\n" +
      "| Cat | Status | Destination |\n|-----|--------|------------|\n" +
      "| Burt | Adopted | New family in Santa Rosa |\n" +
      "| Po | Adopted | New family in Petaluma |\n" +
      "| Maxwell | Adopted | Rohnert Park family |\n" +
      "| Taffie | Adopted | Santa Rosa family |\n" +
      "| Abscess kitten | Transferred | Partner rescue |\n\n" +
      "**That's 5 cats who started as ferals behind a gas station and ended up in loving homes.** " +
      "This is what your donations make possible — Lawrence called us about one cat, and we ended " +
      "up helping 28.\n\n" +
      "The new kittens from May are still in foster. Josie Tellez (community contact, 707-450-5950) " +
      "continues to monitor the site. Crystal and Claire are the assigned trappers.",
  },
  {
    question: "Where should we focus our resources next month?",
    tools: ["Finding priority sites", "Checking active requests", "Analyzing coverage gaps"],
    response:
      "**Strategic Priorities — Resource Allocation**\n\n" +
      "I looked at active requests with confirmed unaltered cats and ranked by impact:\n\n" +
      "| Location | Unaltered | Active Request | Why Urgent |\n" +
      "|----------|-----------|----------------|------------|\n" +
      "| Annapolis Rd (36855) | ~23 confirmed | Yes | Caretaker reported 45 cats, only 22 verified |\n" +
      "| Armstrong Woods Rd | ~25 confirmed | Yes | Large colony, cooperative caretaker |\n" +
      "| Montecito corridor | ~11 across 5 sites | Yes | Kittens detected at 2 addresses |\n" +
      "| Todd Rd West | ~6 confirmed | Yes | FIV+ case — alteration prevents spread |\n\n" +
      "**Important caveat:** You might see places with very low alteration rates (like 5-10%) " +
      "and think those are urgent. But often that's just missing data from legacy imports — " +
      "we don't know their status, they're not necessarily intact. **Focus on places where we " +
      "KNOW there are unfixed cats and someone is ready to help trap.**\n\n" +
      "Want me to draft trapping requests for the top 2 priorities?",
  },
  {
    question: "What's FFSC's total impact since we started?",
    tools: ["Computing impact statistics", "Loading historical data"],
    response:
      "**FFSC Impact — 2013 to Present**\n\n" +
      "| Metric | Value |\n|--------|-------|\n" +
      "| Cats altered | 37,000+ |\n| Kittens prevented (estimated) | ~370,000 |\n" +
      "| Shelter costs avoided | ~$74M |\n| Places tracked | 14,000+ |\n" +
      "| Community members served | 8,000+ |\n| Active colony sites | 2,800+ |\n\n" +
      "**2026 pace:** ~22 cats per clinic day, on track for ~3,500 this year — our highest ever.\n\n" +
      "Here's what makes those numbers real: **every single one of those 37,000 cats has a record.** " +
      "We know where they came from, when they were fixed, what procedures they received, and for " +
      "many of them — where they ended up. Kittens that came in feral and left in a foster " +
      "family's arms.\n\n" +
      "FFSC is the only dedicated spay/neuter clinic for community cats in Sonoma County. " +
      "Every cat in our system was verified at our clinic — this isn't estimated data, it's " +
      "ground truth.",
  },
  {
    question: "Tell me about the Pozzan Road success story",
    tools: ["Analyzing location", "Loading clinic records", "Checking outcomes"],
    response:
      "**15760 Pozzan Road, Healdsburg** — Emily West's property\n\n" +
      "This is one of our best success stories.\n\n" +
      "On **January 29, 2026**, we did a mass trapping event and processed **24 cats in a single day**. " +
      "That's remarkable coordination — it means the caretaker (Emily), the trapper, and our clinic " +
      "team all aligned perfectly.\n\n" +
      "When you can get 24 cats done at once instead of chasing them one by one over months, it " +
      "means the colony stabilizes *immediately*. No more kittens born between visits. No more " +
      "cats slipping through the cracks.\n\n" +
      "**By the numbers:**\n" +
      "- 24 cats altered in 1 day\n" +
      "- Estimated 120+ kittens prevented in the first year alone\n" +
      "- Colony is now at 100% alteration\n" +
      "- ~$48,000 in shelter costs avoided\n\n" +
      "**This is what targeted, data-driven TNR looks like.** We knew the colony size, we had a " +
      "cooperative caretaker, and we deployed the right resources at the right time. One day of " +
      "work that prevents years of suffering.",
  },
];

const GENERIC_RESPONSE: DemoConversation = {
  question: "",
  tools: ["Searching records", "Analyzing data"],
  response:
    "Great question. In a live session, I'd query across our full database — " +
    "**37,000+ cats**, **14,000+ places**, **8,000+ community members** — and give you " +
    "a specific answer with real names, dates, and numbers.\n\n" +
    "I can help with:\n" +
    "- **Colony briefings** — full status on any address\n" +
    "- **Cat tracing** — where a cat came from and where it ended up\n" +
    "- **Trapper coordination** — who's available near a location\n" +
    "- **Strategic planning** — where to focus limited resources\n" +
    "- **Impact stats** — your donation dollars at work\n\n" +
    "Try one of the questions above to see a full demo.",
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
