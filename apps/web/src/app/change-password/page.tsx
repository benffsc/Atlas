"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRequired, setIsRequired] = useState(false);
  const [staffName, setStaffName] = useState("");

  // Check if password change is required
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.staff) {
          setStaffName(data.staff.display_name);
          setIsRequired(data.staff.password_change_required || false);
        } else {
          // Not logged in, redirect to login
          router.push("/login");
        }
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    if (newPassword === currentPassword) {
      setError("New password must be different from current password");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to change password");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            maxWidth: "400px",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>
            Password Updated!
          </div>
          <p style={{ color: "var(--muted)" }}>
            Redirecting to dashboard...
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
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "400px",
          width: "100%",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ marginBottom: "12px" }}>
            <img
              src="/logo.png"
              alt="Atlas"
              className="nav-logo"
              style={{ width: "60px", height: "auto" }}
            />
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
            {isRequired ? "Password Change Required" : "Change Password"}
          </h1>
          {staffName && (
            <p style={{ color: "var(--muted)", marginBottom: "8px" }}>
              Welcome, {staffName}
            </p>
          )}
          {isRequired && (
            <p style={{ color: "var(--warning-text)", fontSize: "0.9rem" }}>
              You must change your password before continuing.
            </p>
          )}
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          {/* Current Password */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={isRequired ? "Enter default password" : "Enter current password"}
              style={{
                width: "100%",
                padding: "12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "1rem",
              }}
            />
            {isRequired && (
              <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "4px" }}>
                Your default password was provided by your administrator.
              </p>
            )}
          </div>

          {/* New Password */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (8+ characters)"
              style={{
                width: "100%",
                padding: "12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "1rem",
              }}
            />
          </div>

          {/* Confirm Password */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              style={{
                width: "100%",
                padding: "12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "1rem",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "12px",
                background: "var(--danger-bg)",
                color: "var(--danger-text)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                marginBottom: "16px",
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              background: loading ? "#9ca3af" : "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: "8px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Updating..." : "Update Password"}
          </button>

          {/* Cancel (only if not required) */}
          {!isRequired && (
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                width: "100%",
                padding: "12px",
                background: "transparent",
                color: "var(--muted)",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.9rem",
                cursor: "pointer",
                marginTop: "12px",
              }}
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
