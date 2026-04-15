"use client";

import { useState, FormEvent, Suspense } from "react";
import { SkeletonCard } from "@/components/feedback/Skeleton";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json();
        const msg = typeof data.error === "string" ? data.error : data.error?.message || "Something went wrong";
        setError(msg);
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background) 55%)",
          padding: "1rem",
        }}
      >
        <div style={{ width: "100%", maxWidth: "400px" }}>
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <img
              src="/beacon-logo.jpeg"
              alt="Beacon"
              style={{ width: "220px", height: "auto", marginBottom: "0.75rem" }}
            />
          </div>
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Check your email
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              If <strong>{email}</strong> is registered, we sent a link to reset your password.
              The link expires in 24 hours.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try a different email
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
            <a href="/login" style={{ fontSize: "0.875rem", color: "var(--primary, #4291df)" }}>
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background) 55%)",
        padding: "1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <img
            src="/beacon-logo.jpeg"
            alt="Beacon"
            style={{ width: "220px", height: "auto", marginBottom: "0.75rem" }}
          />
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Forgot your password?
          </h1>
          <p className="text-muted" style={{ margin: 0 }}>
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <div className="card" style={{ padding: "2rem" }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "6px",
                  color: "#dc2626",
                  marginBottom: "1.5rem",
                  fontSize: "0.875rem",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="email"
                style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.org"
                required
                autoComplete="email"
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  background: "var(--background)",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                background: "var(--primary, #4291df)",
                color: "var(--primary-foreground, #fff)",
                border: "none",
                borderRadius: "6px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <a href="/login" style={{ fontSize: "0.875rem", color: "var(--primary, #4291df)" }}>
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}><SkeletonCard /></div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
