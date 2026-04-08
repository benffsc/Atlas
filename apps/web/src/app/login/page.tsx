"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { SkeletonCard } from "@/components/feedback/Skeleton";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const { nameFull, supportEmail } = useOrgConfig();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check if already logged in
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          router.push(redirect);
        }
      })
      .catch(() => {
        // Ignore errors, user just needs to log in
      });
  }, [redirect, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (data.success) {
        // Check if password change is required
        if (data.password_change_required) {
          // Use window.location for full page reload to clear any cached state
          window.location.href = "/change-password";
        } else {
          // Use window.location for full page reload to ensure auth state is fresh
          // This fixes issues where cached/stale UI doesn't reflect logged-in state
          window.location.href = redirect;
        }
      } else {
        // data.error is {message, code} object, extract the message string
        const errorMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || "Login failed";
        setError(errorMsg);
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Subtle radial "beacon glow" backdrop — reinforces the guiding light
        // metaphor without being flashy. Peaks at top center, fades to base bg.
        background: "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background) 55%)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
        }}
      >
        {/* Logo/Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <img
            src="/beacon-logo.jpeg"
            alt="Beacon"
            style={{ width: "220px", height: "auto", marginBottom: "0.75rem" }}
          />
          <p className="text-muted" style={{ margin: "0 0 0.5rem" }}>Sign in to your account</p>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--text-tertiary, var(--text-muted))",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            A guiding light for humane cat population management
          </p>
        </div>

        {/* Login Form */}
        <div
          className="card"
          style={{
            padding: "2rem",
          }}
        >
          <form onSubmit={handleSubmit}>
            {/* Error Message */}
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

            {/* Email Field */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
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

            {/* Password Field */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="password"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
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

            {/* Submit Button */}
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
                transition: "opacity 200ms ease, box-shadow 200ms ease, transform 150ms ease",
                boxShadow: "0 2px 6px rgba(66, 145, 223, 0.25)",
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            fontSize: "0.875rem",
            color: "var(--text-muted)",
          }}
        >
          <p>{nameFull}</p>
          <p style={{ marginTop: "0.25rem" }}>
            Need help?{" "}
            <a
              href={`mailto:${supportEmail}`}
              style={{ color: "var(--primary, #4291df)" }}
            >
              Contact an administrator
            </a>
          </p>
          <p style={{ marginTop: "0.5rem" }}>
            <a
              href="/story"
              style={{ color: "var(--text-tertiary, var(--text-muted))", fontSize: "0.8rem" }}
            >
              Our story →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}><SkeletonCard /></div>}>
      <LoginForm />
    </Suspense>
  );
}
