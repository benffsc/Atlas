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

// All demo responses use initials + roles for people (showcase mode = no PII).
// Relationships are based on real data model connections:
//   - Corridor = sot.shared_colony edges (GIS-verified adjacency)
//   - People = person_place links with relationship_type
//   - Trappers = trapper_service_places + request assignments
// No fabricated connections.

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    question: "Tell me everything about the Montecito Ave corridor",
    tools: ["Analyzing location", "Querying database", "Checking corridor links", "Loading field notes"],
    response:
      "**Montecito Ave Corridor** — 5 linked addresses in Santa Rosa\n\n" +
      "Beacon detected these 5 properties share a colony — cats move freely between them. " +
      "This was identified through geographic proximity (all within 200m) and confirmed by " +
      "field observations.\n\n" +
      "| Address | Cats | Altered | Status |\n|---------|------|---------|--------|\n" +
      "| 5055 Montecito | 6 | 6 | Completed |\n" +
      "| 5100 Montecito | 3 | 0 | New — kittens suspected |\n" +
      "| 5123 Montecito | 33 | 22 (67%) | In progress |\n" +
      "| 5209 Montecito | 2 | 0 | New — kittens reported |\n" +
      "| **Corridor total** | **44** | **28 (64%)** | |\n\n" +
      "**Why this matters:** Without corridor detection, these look like 5 separate small " +
      "problems. Together, they're one colony with 64% coverage and active kitten breeding " +
      "at 2 addresses. The system links them automatically using GIS data.\n\n" +
      "**Active field notes:**\n" +
      "- Property owner at 5123 has a trapper assigned and working the site\n" +
      "- High-priority note: unauthorized trap lending — liability flagged and resolved\n" +
      "- Kitten assessment needed at 5100 + 5209, follow-up June 15\n\n" +
      "Want me to show the corridor on the map?",
  },
  {
    question: "What's the situation at the Todd Rd gas station?",
    tools: ["Looking up place", "Tracing cat journeys", "Checking ShelterLuv outcomes"],
    response:
      "**Chevron Todd Rd** — 28 cats trapped, neutered, and returned\n\n" +
      "A community member called about one cat behind a gas station. We've now " +
      "TNR'd 28 at this site — trapped, fixed at our clinic, and returned to " +
      "the colony. That's the mission: **stabilize the population in place.**\n\n" +
      "**But the work isn't done.** Unaltered cats remain on site, and they " +
      "keep producing kittens:\n\n" +
      "**Current situation (May 2026):**\n" +
      "- 4 new kittens found — currently in foster, too young to alter yet\n" +
      "- 1 kitten with an abscess transferred to Marin Humane for medical care\n" +
      "- Community contact continues to monitor the colony\n" +
      "- 2 trappers assigned to the site\n\n" +
      "Since these kittens are young enough to socialize, they're on a placement " +
      "track — they'll be spayed/neutered and adopted or placed as barn cats. " +
      "A previous litter from this same site (Burt, Po, Maxwell, Taffie) all " +
      "found homes the same way.\n\n" +
      "**This is the cycle we're trying to break.** 28 cats fixed, but unaltered " +
      "cats remain and kittens keep coming. Every clinic day gets us closer to " +
      "stabilizing this colony for good.",
  },
  {
    question: "Where should we focus limited resources?",
    tools: ["Finding priority sites", "Checking active requests", "Analyzing coverage gaps"],
    response:
      "**Strategic Resource Allocation**\n\n" +
      "I ranked active requests by confirmed unaltered cats — places where we KNOW " +
      "cats are waiting AND someone is ready to help trap:\n\n" +
      "| Priority | Area | Gap | Why Now |\n" +
      "|----------|------|-----|--------|\n" +
      "| 1 | Annapolis Rd colony | ~23 unaltered | Caretaker reported 45, only 22 verified |\n" +
      "| 2 | Armstrong Woods area | ~25 unaltered | Large colony, cooperative caretaker |\n" +
      "| 3 | Montecito corridor | ~16 across 5 sites | Active kitten breeding at 2 addresses |\n" +
      "| 4 | Todd Rd West | ~6 unaltered | FIV+ case — alteration prevents disease spread |\n\n" +
      "**Important — what I'm NOT recommending:**\n\n" +
      "You might see places showing 5-10% alteration rates and think those are urgent. " +
      "But Beacon knows the difference between *confirmed intact* and *unknown status*. " +
      "Most low-rate places are legacy data with missing records — we don't know their " +
      "status, they're not necessarily unfixed.\n\n" +
      "**The system prioritizes real signal over noisy data.** That's what makes this " +
      "different from a spreadsheet.",
  },
  {
    question: "How do you track 37,000 cats?",
    tools: ["Computing impact statistics", "Loading system architecture"],
    response:
      "**How Beacon Works — The Data Pipeline**\n\n" +
      "Every cat that comes through FFSC's clinic gets a verified record:\n\n" +
      "**1. Intake** — community member calls, walks in, or submits online. The system " +
      "captures location, cat count, and contact info. AI triages by urgency.\n\n" +
      "**2. Clinic** — each cat gets microchipped, spayed/neutered, vaccinated, ear-tipped. " +
      "All procedures are recorded with the veterinary system and automatically synced.\n\n" +
      "**3. Identity** — the system cross-references across 4 source systems (clinic records, " +
      "shelter database, volunteer database, intake forms) to build a unified identity for " +
      "each cat, person, and place.\n\n" +
      "**4. Intelligence** — Beacon connects the dots:\n" +
      "- Cats linked to places they live (not where they were booked from)\n" +
      "- Nearby addresses grouped into corridors when cats move between them\n" +
      "- Population estimates using statistical models, not raw counts\n" +
      "- Disease tracking by location (FeLV, FIV, panleukopenia)\n\n" +
      "**5. Outcomes** — for cats that enter foster/adoption, we trace the full journey: " +
      "where they came from → foster home → permanent placement.\n\n" +
      "| System Total | Count |\n|-------------|-------|\n" +
      "| Cats with records | 37,000+ |\n| Places tracked | 14,000+ |\n" +
      "| Community members | 8,000+ |\n| Source systems integrated | 4 |\n" +
      "| Clinic days recorded | 1,600+ |\n\n" +
      "FFSC is the **only dedicated spay/neuter clinic for community cats in Sonoma County**. " +
      "Every number in this system is verified at our clinic — ground truth, not estimates.",
  },
  {
    question: "Show me a mass trapping success story",
    tools: ["Searching clinic records", "Finding mass trapping events", "Calculating impact"],
    response:
      "**Pozzan Rd, Healdsburg — January 29, 2026**\n\n" +
      "**24 cats altered in a single day.**\n\n" +
      "That's not a typo. One cooperative caretaker, one experienced trapper, and our " +
      "clinic team — aligned for one coordinated push. The result:\n\n" +
      "| Metric | Value |\n|--------|-------|\n" +
      "| Cats altered | 24 |\n| Duration | 1 clinic day |\n" +
      "| Colony coverage after | 100% |\n" +
      "| Estimated kittens prevented (year 1) | ~120 |\n" +
      "| Estimated shelter costs avoided | ~$48,000 |\n\n" +
      "**Why this worked:** The system identified the colony size beforehand. The " +
      "caretaker had built trust with the cats over months. Instead of trapping 2-3 " +
      "at a time over weeks (during which unaltered cats keep breeding), we got " +
      "everyone in one sweep.\n\n" +
      "**The colony stabilized immediately.** No more kittens born between visits. " +
      "No more cats slipping through the cracks. One day of coordinated work that " +
      "prevents years of suffering.\n\n" +
      "This is what **targeted, data-driven TNR** looks like — and why having a " +
      "system like Beacon matters. We knew the colony size, we had the trapper " +
      "availability, and we timed it right.",
  },
];

const GENERIC_RESPONSE: DemoConversation = {
  question: "",
  tools: ["Searching records", "Analyzing data"],
  response:
    "Great question. In a live session, Tippy queries across the full database — " +
    "**37,000+ cats**, **14,000+ places**, **8,000+ community members** — and returns " +
    "a specific answer with dates, stats, and context.\n\n" +
    "Tippy can help with:\n" +
    "- **Colony briefings** — full status on any address, with corridor detection\n" +
    "- **Cat tracing** — where a cat came from and where it ended up\n" +
    "- **Trapper coordination** — who's available near a location\n" +
    "- **Strategic planning** — where to focus limited resources\n" +
    "- **Impact reporting** — your donation dollars at work\n\n" +
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
