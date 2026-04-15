"use client";

import { useState, useEffect, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SkeletonCard } from "@/components/feedback/Skeleton";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Validate token on load
  useEffect(() => {
    if (!token) {
      setValidating(false);
      return;
    }

    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.valid) {
          setTokenValid(true);
          setStaffName(data.data.display_name || "");
          setStaffEmail(data.data.email || "");
        }
      })
      .catch(() => {})
      .finally(() => setValidating(false));
  }, [token]);

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
          token,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Auto-login with the new password
        if (staffEmail) {
          try {
            const loginRes = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: staffEmail, password: newPassword }),
            });
            const loginData = await loginRes.json();
            if (loginData.success) {
              setSuccess(true);
              setTimeout(() => { window.location.href = "/"; }, 1500);
              return;
            }
          } catch {
            // Auto-login failed — fall through to manual login redirect
          }
        }
        setSuccess(true);
        setTimeout(() => { window.location.href = "/login"; }, 2000);
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

  // Success state
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
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>Password Updated!</div>
          <p style={{ color: "var(--text-muted)" }}>Signing you in...</p>
        </div>
      </div>
    );
  }

  // Loading / validating
  if (validating) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <SkeletonCard />
      </div>
    );
  }

  // No token or invalid token
  if (!token || !tokenValid) {
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
              Link expired or invalid
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              This password reset link is no longer valid. Links expire after 1 hour.
            </p>
            <a
              href="/forgot-password"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                background: "var(--primary, #4291df)",
                color: "#fff",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Request a new link
            </a>
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

  // Valid token — show password form
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
            Set your password
          </h1>
          {staffName && (
            <p className="text-muted" style={{ margin: 0 }}>
              Welcome, {staffName}
            </p>
          )}
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

            {/* Hidden email field — lets the browser's password manager
                know which account this password belongs to, triggering
                the "Save password?" prompt on submit */}
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={staffEmail}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, overflow: "hidden" }}
            />

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
              {loading ? "Setting password..." : "Set password"}
            </button>
          </form>
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
