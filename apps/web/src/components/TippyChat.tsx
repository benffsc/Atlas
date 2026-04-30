"use client";

import { useState, useRef, useEffect, useCallback, FormEvent } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { TippyFeedbackModal } from "@/components/modals";
import { Icon } from "@/components/ui/Icon";
import { fetchApi, postApi } from "@/lib/api-client";
import { ActionCard, type ActionCardData } from "@/components/tippy/ActionCard";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface StreamPhase {
  phase: "thinking" | "tool_call" | "tool_result" | "responding";
  tool?: string;
  success?: boolean;
}

/** Human-readable labels for V2 tool names */
const TOOL_LABELS: Record<string, string> = {
  run_sql: "Querying database",
  full_place_briefing: "Analyzing location",
  place_search: "Looking up place",
  person_lookup: "Looking up person",
  cat_lookup: "Looking up cat",
  cat_search: "Searching cats by description",
  area_stats: "Getting area statistics",
  spatial_context: "Checking nearby activity",
  compare_places: "Comparing locations",
  find_priority_sites: "Finding priority sites",
  trapper_stats: "Looking up trappers",
  request_stats: "Getting request stats",
  create_reminder: "Creating reminder",
  send_message: "Sending message",
  log_event: "Logging event",
};

function getPhaseLabel(phase: StreamPhase, isBriefing?: boolean): string {
  switch (phase.phase) {
    case "thinking":
      return isBriefing ? "Preparing your daily briefing..." : "Thinking...";
    case "tool_call":
      return TOOL_LABELS[phase.tool || ""] || `Running ${phase.tool}...`;
    case "tool_result":
      return phase.success ? "Got results" : "No results found";
    case "responding":
      return isBriefing ? "Writing your briefing..." : "Writing response...";
    default:
      return "Working...";
  }
}

/** Parse SSE events from a text buffer. Returns parsed events and remaining buffer. */
function parseSSE(buffer: string): { events: { type: string; data: Record<string, unknown> }[]; remaining: string } {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const parts = buffer.split("\n\n");
  // Last part may be incomplete
  const remaining = parts.pop() || "";

  for (const part of parts) {
    if (!part.trim()) continue;
    let eventType = "message";
    let dataStr = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice(6);
      }
    }
    if (dataStr) {
      try {
        events.push({ type: eventType, data: JSON.parse(dataStr) });
      } catch {
        // Skip malformed events
      }
    }
  }

  return { events, remaining };
}

const DEFAULT_QUICK_ACTIONS = [
  { label: "How do I create a request?", icon: "📝" },
  { label: "Find cats near an address", icon: "🔍" },
  { label: "What is TNR?", icon: "❓" },
];

/** FFS-866: Context-aware quick action suggestions based on current page */
function getContextualActions(pathname: string): { label: string; icon: string }[] {
  // Place detail page
  if (/^\/places\/[^/]+$/.test(pathname)) {
    return [
      { label: "What's the colony status at this place?", icon: "🏠" },
      { label: "Find nearby colonies", icon: "📍" },
      { label: "Who caretakes this place?", icon: "👤" },
    ];
  }
  // Cat detail page
  if (/^\/cats\/[^/]+$/.test(pathname)) {
    return [
      { label: "Trace this cat's full history", icon: "🐱" },
      { label: "Where has this cat been seen?", icon: "📍" },
      { label: "Is this cat linked to any requests?", icon: "📋" },
    ];
  }
  // Request detail page
  if (/^\/requests\/[^/]+$/.test(pathname)) {
    return [
      { label: "Summarize this request", icon: "📋" },
      { label: "What cats were trapped for this request?", icon: "🐱" },
      { label: "Find trappers near this location", icon: "👤" },
    ];
  }
  // Requests list
  if (pathname === "/requests") {
    return [
      { label: "Show stale requests needing attention", icon: "⚠️" },
      { label: "Summarize my assigned requests", icon: "📋" },
      { label: "Which areas have the most open requests?", icon: "📍" },
    ];
  }
  // Map page
  if (pathname === "/map") {
    return [
      { label: "What colonies are in this area?", icon: "📍" },
      { label: "Show me the highest priority locations nearby", icon: "⚠️" },
      { label: "Any disease-positive places in view?", icon: "🔬" },
    ];
  }
  // People list or detail
  if (pathname === "/people" || /^\/people\/[^/]+$/.test(pathname)) {
    return [
      { label: "Look up a person by phone or email", icon: "🔍" },
      { label: "Find caretakers in Santa Rosa", icon: "👤" },
      { label: "Who are the most active trappers?", icon: "📊" },
    ];
  }
  // Cats list
  if (pathname === "/cats") {
    return [
      { label: "Look up a cat by microchip", icon: "🔍" },
      { label: "How many cats were altered this month?", icon: "📊" },
      { label: "Find unaltered cats in Petaluma", icon: "🐱" },
    ];
  }
  // Places list
  if (pathname === "/places") {
    return [
      { label: "Which places have the lowest alteration rates?", icon: "📊" },
      { label: "Find colonies with active requests", icon: "📋" },
      { label: "Look up a place by address", icon: "🔍" },
    ];
  }
  // Intake
  if (pathname === "/intake" || pathname === "/intake/queue") {
    return [
      { label: "How many pending intakes are there?", icon: "📥" },
      { label: "Does this address have existing requests?", icon: "🔍" },
      { label: "What's the process for declining an intake?", icon: "❓" },
    ];
  }
  // Trappers
  if (pathname.startsWith("/trappers")) {
    return [
      { label: "Who are the most active trappers?", icon: "📊" },
      { label: "Find trappers available in Rohnert Park", icon: "📍" },
      { label: "Show trapper activity this month", icon: "📈" },
    ];
  }
  // Dashboard
  if (pathname === "/" || pathname === "/dashboard") {
    return [
      { label: "Give me today's briefing", icon: "☀️" },
      { label: "Any urgent issues I should know about?", icon: "⚠️" },
      { label: "How many cats were altered this week?", icon: "📊" },
    ];
  }
  return DEFAULT_QUICK_ACTIONS;
}

/** FFS-865: Custom link renderer for entity handoff links */
function TippyLink(props: React.JSX.IntrinsicElements["a"]) {
  const { href, children, ...rest } = props;
  const isInternal = href?.startsWith("/");
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (isInternal && href) {
          e.preventDefault();
          window.location.href = href;
        }
      }}
      style={{
        color: isInternal ? "#667eea" : undefined,
        textDecoration: "underline",
        cursor: "pointer",
        fontWeight: isInternal ? 500 : undefined,
      }}
      target={isInternal ? undefined : "_blank"}
      rel={isInternal ? undefined : "noopener noreferrer"}
    >
      {children}
    </a>
  );
}

const markdownComponents = { a: TippyLink };

interface ConversationSummary {
  conversation_id: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  summary: string | null;
  first_message: string | null;
}

function relativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Map context from AtlasMap events
interface MapContext {
  center?: { lat: number; lng: number };
  zoom?: number;
  bounds?: { north: number; south: number; east: number; west: number };
  selectedPlace?: { place_id: string; address: string };
  navigatedLocation?: { lat: number; lng: number; address: string };
  drawerOpen?: boolean;
  visiblePinCount?: number;
  lastSearchQuery?: string | null;
}

export function TippyChat() {
  const pathname = usePathname();
  const hiddenRoutes = ["/welcome", "/login", "/kiosk"];
  const isHidden = hiddenRoutes.some((r) => pathname === r || pathname?.startsWith(r + "/"));

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [mapContext, setMapContext] = useState<MapContext | null>(null);
  const [hasBriefed, setHasBriefed] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [historyList, setHistoryList] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [anomalyCount, setAnomalyCount] = useState(0);
  const [actionCards, setActionCards] = useState<Map<string, ActionCardData>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  const handleFeedback = (message: Message) => {
    setSelectedMessage(message);
    setFeedbackModalOpen(true);
  };

  const handleConfirmAction = useCallback(async (cardId: string) => {
    const card = actionCards.get(cardId);
    if (!card) return;

    setActionCards(prev => {
      const next = new Map(prev);
      next.set(cardId, { ...card, status: "confirmed" });
      return next;
    });

    try {
      await postApi("/api/tippy/execute-action", {
        card_id: card.card_id,
        action_type: card.action_type,
        entity_type: card.entity_type,
        entity_id: card.entity_id,
        entity_name: card.entity_name,
        proposed_changes: card.proposed_changes,
      });
    } catch {
      // Revert on failure
      setActionCards(prev => {
        const next = new Map(prev);
        next.set(cardId, { ...card, status: "pending" });
        return next;
      });
    }
  }, [actionCards]);

  const handleRejectAction = useCallback((cardId: string) => {
    setActionCards(prev => {
      const next = new Map(prev);
      const card = next.get(cardId);
      if (card) next.set(cardId, { ...card, status: "rejected" });
      return next;
    });
  }, []);

  // Listen for map context events from AtlasMap
  useEffect(() => {
    const handleMapContext = (event: CustomEvent<MapContext>) => {
      setMapContext(event.detail);
    };

    window.addEventListener('tippy-map-context', handleMapContext as EventListener);
    return () => {
      window.removeEventListener('tippy-map-context', handleMapContext as EventListener);
    };
  }, []);

  // FFS-867: Fetch anomaly count for notification badge
  useEffect(() => {
    fetchApi<{ count: number }>("/api/tippy/anomalies/count")
      .then((data) => setAnomalyCount(data.count || 0))
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Core message sending logic — used by both form submit and auto-briefing
  const sendMessage = useCallback(async (userMessage: string) => {
    if (isLoading) return;

    // FFS-863: 30-minute inactivity auto-close
    let activeConversationId = conversationId;
    if (conversationId && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (Date.now() - lastMsg.timestamp.getTime() > 30 * 60 * 1000) {
        activeConversationId = undefined;
        setConversationId(undefined);
      }
    }

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreamPhase({ phase: "thinking" });

    // Create placeholder assistant message for streaming
    const msgId = `assistant-${Date.now()}`;
    streamingMsgIdRef.current = msgId;
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    try {
      const res = await fetch("/api/tippy/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          conversationId: activeConversationId,
          stream: true,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          pageContext: {
            path: window.location.pathname,
            params: Object.fromEntries(new URLSearchParams(window.location.search)),
            mapState: mapContext,
          },
        }),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSE(buffer);
        buffer = remaining;

        for (const event of events) {
          if (event.type === "status") {
            setStreamPhase(event.data as unknown as StreamPhase);
          } else if (event.type === "delta") {
            assistantContent += (event.data as { text: string }).text;
            const content = assistantContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, content } : m
              )
            );
          } else if (event.type === "done") {
            const doneData = event.data as { conversationId?: string };
            if (doneData.conversationId) {
              setConversationId(doneData.conversationId);
            }
          } else if (event.type === "action_card") {
            const cardData = event.data as unknown as ActionCardData;
            if (cardData.card_id) {
              setActionCards(prev => {
                const next = new Map(prev);
                next.set(cardData.card_id, { ...cardData, status: "pending" });
                return next;
              });
            }
          } else if (event.type === "error") {
            const errData = event.data as { message?: string };
            assistantContent = errData.message || "Sorry, something went wrong. Please try again.";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, content: assistantContent } : m
              )
            );
          }
        }
      }

      // If we got no content at all, show a fallback
      if (!assistantContent) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, content: "I'm not sure how to help with that." }
              : m
          )
        );
      }
    } catch {
      // Update the placeholder message with error
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                content:
                  "Sorry, I'm having trouble connecting right now. Please try again.",
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setStreamPhase(null);
      streamingMsgIdRef.current = null;
    }
  }, [isLoading, conversationId, messages, mapContext]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const userMessage = input.trim();
    setInput("");
    await sendMessage(userMessage);
  }, [input, isLoading, sendMessage]);

  // FFS-755: Auto-briefing on first open of the day
  useEffect(() => {
    if (!isOpen || messages.length > 0 || hasBriefed || isLoading) return;

    // Check localStorage first (avoid API call if already briefed today)
    const lastBriefing = localStorage.getItem('tippy-last-briefing');
    const today = new Date().toISOString().split('T')[0];
    if (lastBriefing === today) {
      setHasBriefed(true);
      return;
    }

    // Check API
    fetch('/api/tippy/briefing')
      .then(res => res.json())
      .then(data => {
        // Handle apiSuccess wrapper: { success: true, data: { needsBriefing } }
        const payload = data?.success === true && "data" in data ? data.data : data;
        if (payload.needsBriefing) {
          sendMessage('__shift_briefing__');
          localStorage.setItem('tippy-last-briefing', today);
        }
        setHasBriefed(true);
      })
      .catch(() => setHasBriefed(true));
  }, [isOpen, messages.length, hasBriefed, isLoading, sendMessage]);

  const handleQuickAction = (action: string) => {
    setInput(action);
    inputRef.current?.focus();
  };

  // FFS-863: Fetch conversation history
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await fetchApi<{ conversations: ConversationSummary[] }>("/api/tippy/conversations?limit=20");
      setHistoryList(data.conversations || []);
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // FFS-863: Toggle history view
  const toggleHistory = useCallback(() => {
    if (view === "history") {
      setView("chat");
    } else {
      setView("history");
      fetchHistory();
    }
  }, [view, fetchHistory]);

  // FFS-863: Load a past conversation
  const loadConversation = useCallback(async (id: string) => {
    try {
      const data = await fetchApi<{ conversation_id: string; started_at: string; messages: { message_id: string; role: string; content: string; created_at: string }[] }>(`/api/tippy/conversations/${id}`);
      const restored: Message[] = (data.messages || []).map((m) => ({
        id: m.message_id,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.created_at),
      }));
      setMessages(restored);
      setConversationId(id);
      setView("chat");
      setHasBriefed(true);
    } catch {
      // If load fails, stay in history view
    }
  }, []);

  // FFS-863: Start new conversation
  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setView("chat");
    setHasBriefed(false);
  }, []);

  if (isHidden) return null;

  if (!isOpen) {
    return (
      <button
        className="tippy-fab"
        onClick={() => setIsOpen(true)}
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.2s, box-shadow 0.2s",
          zIndex: 1000,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow =
            "0 6px 16px rgba(102, 126, 234, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow =
            "0 4px 12px rgba(102, 126, 234, 0.4)";
        }}
        title="Ask Tippy"
      >
        <span style={{ fontSize: "1.75rem" }}>🐱</span>
        {anomalyCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#ef4444",
              color: "#fff",
              fontSize: "0.65rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--background, #fff)",
            }}
          >
            {anomalyCount > 9 ? "9+" : anomalyCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="tippy-chat-panel"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        width: "380px",
        height: "500px",
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "16px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "1.5rem" }}>🐱</span>
          <div>
            <div style={{ fontWeight: 600 }}>Tippy</div>
            <div style={{ fontSize: "0.75rem", opacity: 0.9 }}>
              Beacon Assistant
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={startNewConversation}
            title="New conversation"
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "8px",
              padding: "6px",
              cursor: "pointer",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            onClick={toggleHistory}
            title="Conversation history"
            style={{
              background: view === "history" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "8px",
              padding: "6px",
              cursor: "pointer",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="clock" size={16} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "8px",
              padding: "6px",
              cursor: "pointer",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {/* Content area — chat or history view */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {view === "history" ? (
          /* FFS-863: Conversation history view */
          historyLoading ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "0.85rem" }}>Loading conversations...</div>
            </div>
          ) : historyList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "0.85rem" }}>No past conversations yet</div>
            </div>
          ) : (
            historyList.map((conv) => (
              <button
                key={conv.conversation_id}
                onClick={() => loadConversation(conv.conversation_id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  padding: "10px 14px",
                  background: "var(--card-border, #f3f4f6)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#e5e7eb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--card-border, #f3f4f6)")}
              >
                <div style={{ fontSize: "0.85rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(conv.first_message || conv.summary || "Conversation")?.slice(0, 60)}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted, #9ca3af)", display: "flex", gap: "8px" }}>
                  <span>{relativeDate(conv.started_at)}</span>
                  <span>{conv.message_count} message{conv.message_count !== 1 ? "s" : ""}</span>
                </div>
              </button>
            ))
          )
        ) : messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div
              style={{
                fontSize: "2.5rem",
                marginBottom: "12px",
              }}
            >
              🐱
            </div>
            <div style={{ fontWeight: 600, marginBottom: "8px" }}>
              Hi! I'm Tippy
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "16px",
              }}
            >
              I can help you navigate Beacon and answer questions about TNR
              operations.
            </div>

            {/* FFS-866: Context-aware quick actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {getContextualActions(window.location.pathname).map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.label)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    background: "var(--card-border, #f3f4f6)",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.85rem",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#e5e7eb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "var(--card-border, #f3f4f6)")
                  }
                >
                  <span>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.filter(m => m.content !== '__shift_briefing__').map((msg) => {
            const isStreaming = msg.id === streamingMsgIdRef.current;
            // Hide empty placeholder during streaming (before first delta arrives)
            if (isStreaming && !msg.content) return null;

            return (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  className={msg.role === "assistant" ? "tippy-markdown" : ""}
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius:
                      msg.role === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                    background:
                      msg.role === "user"
                        ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                        : "var(--card-border, #f3f4f6)",
                    color: msg.role === "user" ? "#fff" : "inherit",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                  }}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                {/* Feedback button for assistant messages (hide while streaming) */}
                {msg.role === "assistant" && !isStreaming && (
                  <button
                    onClick={() => handleFeedback(msg)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "4px 8px",
                      fontSize: "0.7rem",
                      color: "var(--text-muted, #9ca3af)",
                      cursor: "pointer",
                      marginTop: "2px",
                      opacity: 0.7,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                    title="Report incorrect information"
                  >
                    Report incorrect info
                  </button>
                )}
              </div>
            );
          })
        )}

        {isLoading && streamPhase && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                padding: "6px 12px",
                borderRadius: "12px",
                background: "var(--card-border, #f3f4f6)",
                fontSize: "0.75rem",
                color: "var(--text-muted, #6b7280)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                animation: "typing 1.5s infinite",
              }}
            >
              <span>
                {streamPhase.phase === "thinking" && "💭"}
                {streamPhase.phase === "tool_call" && "🔍"}
                {streamPhase.phase === "tool_result" && (streamPhase.success ? "✓" : "○")}
                {streamPhase.phase === "responding" && "✍️"}
              </span>
              {getPhaseLabel(streamPhase, messages.some(m => m.content === '__shift_briefing__'))}
            </div>
          </div>
        )}

        {/* Action cards from tool results */}
        {actionCards.size > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 4px" }}>
            {Array.from(actionCards.values()).map((card) => (
              <ActionCard
                key={card.card_id}
                card={card}
                onConfirm={handleConfirmAction}
                onReject={handleRejectAction}
              />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--card-border, #e5e7eb)",
          display: "flex",
          gap: "8px",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Tippy a question..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid var(--card-border, #e5e7eb)",
            borderRadius: "8px",
            fontSize: "0.9rem",
            outline: "none",
            background: "var(--background, #fff)",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "10px 16px",
            background:
              isLoading || !input.trim()
                ? "#9ca3af"
                : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          Send
        </button>
      </form>

      <style jsx global>{`
        @keyframes typing {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .tippy-markdown p {
          margin: 0 0 0.5em 0;
        }
        .tippy-markdown p:last-child {
          margin-bottom: 0;
        }
        .tippy-markdown h1, .tippy-markdown h2, .tippy-markdown h3 {
          font-size: 1em;
          font-weight: 600;
          margin: 0.75em 0 0.25em 0;
        }
        .tippy-markdown h1:first-child, .tippy-markdown h2:first-child, .tippy-markdown h3:first-child {
          margin-top: 0;
        }
        .tippy-markdown ul, .tippy-markdown ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
        }
        .tippy-markdown li {
          margin: 0.25em 0;
        }
        .tippy-markdown strong {
          font-weight: 600;
        }
        .tippy-markdown code {
          background: rgba(0,0,0,0.1);
          padding: 0.1em 0.3em;
          border-radius: 3px;
          font-size: 0.9em;
        }
      `}</style>

      {/* Feedback Modal */}
      <TippyFeedbackModal
        isOpen={feedbackModalOpen}
        onClose={() => {
          setFeedbackModalOpen(false);
          setSelectedMessage(null);
        }}
        tippyMessage={selectedMessage?.content || ""}
        conversationId={conversationId}
        conversationContext={messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }))}
      />
    </div>
  );
}
