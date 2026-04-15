"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SkeletonCard } from "@/components/feedback/Skeleton";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(prefilledEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      } else {
        const msg = typeof data.error === "string" ? data.error : data.error?.message || "Failed to reset password";
        setError(msg);
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
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
        <div style={{ width: "100%", maxWidth: "400px", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
            Password Updated!
          </div>
          <p style={{ color: "var(--text-muted)" }}>
            Redirecting to sign in...
          </p>
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
            Reset your password
          </h1>
          <p className="text-muted" style={{ margin: 0 }}>
            Enter the 6-digit code from your email.
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
                {(error.includes("expired") || error.includes("Invalid")) && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <a
                      href={`/forgot-password`}
                      style={{ color: "#dc2626", fontWeight: 600, textDecoration: "underline" }}
                    >
                      Request a new code
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Email */}
            <div style={{ marginBottom: "1.25rem" }}>
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

            {/* Reset Code */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="code"
                style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}
              >
                Reset Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => {
                  // Allow only digits, max 6
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                }}
                placeholder="123456"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: "1.5rem",
                  letterSpacing: "0.3em",
                  textAlign: "center",
                  background: "var(--background)",
                  fontFamily: "monospace",
                }}
              />
            </div>

            {/* New Password */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="new-password"
                style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}
              >
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="8+ characters"
                required
                autoComplete="new-password"
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

            {/* Confirm Password */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="confirm-password"
                style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                autoComplete="new-password"
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
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem" }}>
          <a
            href="/forgot-password"
            style={{ color: "var(--text-muted)" }}
          >
            Didn&apos;t get a code? Request again
          </a>
          <span style={{ margin: "0 0.5rem", color: "var(--text-muted)" }}>|</span>
          <a
            href="/login"
            style={{ color: "var(--primary, #4291df)" }}
          >
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}><SkeletonCard /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
