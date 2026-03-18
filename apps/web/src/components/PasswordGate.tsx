"use client";

import { useState, useEffect } from "react";
import { useOrgConfig } from "@/hooks/useOrgConfig";

const STORAGE_KEY = "atlas_authenticated";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const { nameFull } = useOrgConfig();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const { expiry } = JSON.parse(stored);
        if (expiry && Date.now() < expiry) {
          setIsAuthenticated(true);
          return;
        }
      } catch {
        /* optional: corrupt localStorage JSON, treat as unauthenticated */
      }
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsAuthenticated(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ expiry: Date.now() + SESSION_DURATION })
        );
        setIsAuthenticated(true);
      } else {
        setError("Incorrect password");
        setPassword("");
      }
    } catch {
      setError("Unable to verify. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Still checking authentication
  if (isAuthenticated === null) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background)",
        color: "var(--foreground)",
      }}>
        Loading...
      </div>
    );
  }

  // Not authenticated - show password form
  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background)",
        padding: "1rem",
      }}>
        <div style={{
          width: "100%",
          maxWidth: "400px",
          padding: "2rem",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          background: "var(--card-bg)",
        }}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Atlas</h1>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Enter the access code to continue
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "1rem" }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Access code"
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  fontSize: "1rem",
                  textAlign: "center",
                  letterSpacing: "0.1em",
                }}
              />
            </div>

            {error && (
              <div style={{
                color: "var(--danger-text)",
                background: "var(--danger-bg)",
                padding: "0.75rem",
                borderRadius: "6px",
                marginBottom: "1rem",
                fontSize: "0.9rem",
                textAlign: "center",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "1rem",
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Verifying..." : "Enter"}
            </button>
          </form>

          <p style={{
            marginTop: "1.5rem",
            textAlign: "center",
            fontSize: "0.8rem",
            color: "var(--muted)",
          }}>
            {nameFull}
          </p>
        </div>
      </div>
    );
  }

  // Authenticated - show app
  return <>{children}</>;
}
