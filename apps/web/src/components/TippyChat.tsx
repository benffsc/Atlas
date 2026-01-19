"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { TippyFeedbackModal } from "./TippyFeedbackModal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface TippyResponse {
  message: string;
  suggestions?: string[];
  links?: { label: string; href: string }[];
}

const QUICK_ACTIONS = [
  { label: "How do I create a request?", icon: "📝" },
  { label: "Find cats near an address", icon: "🔍" },
  { label: "What is TNR?", icon: "❓" },
];

export function TippyChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFeedback = (message: Message) => {
    setSelectedMessage(message);
    setFeedbackModalOpen(true);
  };

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/tippy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data: TippyResponse = await res.json();

      // Add assistant response
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      // Add error message
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content:
          "Sorry, I'm having trouble connecting right now. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (action: string) => {
    setInput(action);
    inputRef.current?.focus();
  };

  if (!isOpen) {
    return (
      <button
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
      </button>
    );
  }

  return (
    <div
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
              Atlas Assistant
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            borderRadius: "8px",
            padding: "8px",
            cursor: "pointer",
            color: "#fff",
            fontSize: "1rem",
          }}
        >
          ×
        </button>
      </div>

      {/* Messages */}
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
        {messages.length === 0 ? (
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
              I can help you navigate Atlas and answer questions about TNR
              operations.
            </div>

            {/* Quick actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {QUICK_ACTIONS.map((action) => (
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
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
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
                {msg.content}
              </div>
              {/* Feedback button for assistant messages */}
              {msg.role === "assistant" && (
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
          ))
        )}

        {isLoading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "16px 16px 16px 4px",
                background: "var(--card-border, #f3f4f6)",
                fontSize: "0.9rem",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  animation: "typing 1s infinite",
                }}
              >
                Tippy is thinking...
              </span>
            </div>
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

      <style jsx>{`
        @keyframes typing {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
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
        conversationContext={messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }))}
      />
    </div>
  );
}
