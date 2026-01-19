"use client";

import { useState, useRef, useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function ClaudeCodeAdminPage() {
  const { user, isLoading: userLoading } = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check if user is admin
  if (userLoading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
        Loading...
      </div>
    );
  }

  if (!user || user.auth_role !== "admin") {
    return (
      <div style={{ padding: "24px" }}>
        <div
          style={{
            padding: "16px",
            background: "var(--danger-bg)",
            color: "var(--danger-text)",
            borderRadius: "8px",
          }}
        >
          This page is restricted to administrators only.
        </div>
      </div>
    );
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/claude-code/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div style={{ padding: "24px 0", height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "4px" }}>
            Claude Code Assistant
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Admin-only development assistant for Atlas codebase questions and debugging
          </p>
        </div>
        <button
          onClick={clearChat}
          style={{
            padding: "8px 16px",
            background: "var(--section-bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          Clear Chat
        </button>
      </div>

      {/* Info Banner */}
      <div
        style={{
          padding: "12px 16px",
          background: "var(--info-bg)",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "0.9rem",
          color: "var(--info-text)",
        }}
      >
        <strong>What Claude knows:</strong> Atlas codebase structure, database schema, API endpoints,
        components, and development patterns. Ask about bugs, how things work, or get help with code changes.
      </div>

      {/* Messages Container */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          padding: "16px",
          marginBottom: "16px",
        }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "16px" }}>{"</>"}</div>
            <p style={{ marginBottom: "12px" }}>No messages yet. Start a conversation!</p>
            <p style={{ fontSize: "0.85rem" }}>
              Try asking: &quot;How does the authentication system work?&quot; or
              &quot;Where is the Tippy chat API implemented?&quot;
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                display: "flex",
                justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  background: message.role === "user" ? "var(--primary)" : "var(--section-bg)",
                  color: message.role === "user" ? "white" : "inherit",
                }}
              >
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    fontFamily: message.role === "assistant" ? "inherit" : "inherit",
                    fontSize: "0.95rem",
                    lineHeight: "1.5",
                  }}
                >
                  {message.content}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    marginTop: "8px",
                    opacity: 0.7,
                  }}
                >
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "12px" }}>
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                background: "var(--section-bg)",
                color: "var(--muted)",
              }}
            >
              Claude is thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--danger-bg)",
            color: "var(--danger-text)",
            borderRadius: "8px",
            marginBottom: "12px",
          }}
        >
          {error}
        </div>
      )}

      {/* Input */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          padding: "12px",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Ask about the codebase, debugging help, or development questions..."
          rows={2}
          style={{
            flex: 1,
            padding: "12px",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            resize: "none",
            fontFamily: "inherit",
            fontSize: "0.95rem",
          }}
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            padding: "12px 24px",
            background: isLoading || !input.trim() ? "var(--muted)" : "var(--primary)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            fontWeight: 500,
            alignSelf: "flex-end",
          }}
        >
          {isLoading ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
