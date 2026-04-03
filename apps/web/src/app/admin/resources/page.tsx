"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminResource {
  name: string;
  slug: string;
  description: string;
  phone?: string;
  address?: string;
  hours?: string;
  icon: string;
  urgency: string;
  website_url?: string;
  scrape_status?: string;
  last_verified_at?: string;
  verify_by?: string;
}

const CATEGORIES = [
  { key: "ffsc", label: "FFSC" },
  { key: "pet_spay", label: "Pet Spay/Neuter" },
  { key: "emergency_vet", label: "Emergency Vets" },
  { key: "general", label: "General" },
];

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AdminResourcesPage() {
  const { success: showSuccess, error: showError } = useToast();
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: number;
    changed: number;
    errors: number;
  } | null>(null);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await fetchApi<{ ok: number; changed: number; errors: number }>(
        "/api/cron/verify-resources",
      );
      setVerifyResult(result);
      showSuccess(`Verified: ${result.ok} ok, ${result.changed} changed, ${result.errors} errors`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [showSuccess, showError]);

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Community Resources
        </h1>
        <Button
          variant="outline"
          size="sm"
          loading={verifying}
          onClick={handleVerify}
          icon="refresh-cw"
        >
          Run Verification
        </Button>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
        Manage community resources shown in the kiosk and on the website.
        {verifyResult && (
          <span style={{ marginLeft: "0.5rem", fontWeight: 600 }}>
            Last run: {verifyResult.ok} ok, {verifyResult.changed} changed, {verifyResult.errors} errors
          </span>
        )}
      </p>

      {CATEGORIES.map((cat) => (
        <CategorySection key={cat.key} categoryKey={cat.key} label={cat.label} />
      ))}
    </div>
  );
}

// ── Category Section ──────────────────────────────────────────────────────────

function CategorySection({ categoryKey, label }: { categoryKey: string; label: string }) {
  const { data, mutate, isLoading } = useSWR<AdminResource[]>(
    `/api/resources?category=${categoryKey}&include_verification=true`,
    (url: string) => fetchApi<AdminResource[]>(url),
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.75rem" }}>{label}</h2>
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.75rem" }}>{label}</h2>
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.5rem 0" }}>
          No resources in this category.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.75rem" }}>
        {label}
        <span style={{ fontWeight: 400, fontSize: "0.85rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
          ({data.length})
        </span>
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {data.map((resource) => (
          <ResourceRow key={resource.slug} resource={resource} onUpdate={() => mutate()} />
        ))}
      </div>
    </div>
  );
}

// ── Resource Row ──────────────────────────────────────────────────────────────

function ResourceRow({
  resource,
  onUpdate,
}: {
  resource: AdminResource;
  onUpdate: () => void;
}) {
  const { success: showSuccess, error: showError } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState({
    phone: resource.phone || "",
    address: resource.address || "",
    hours: resource.hours || "",
    description: resource.description || "",
  });

  const saveField = useCallback(
    async (field: string, value: string) => {
      setSaving(true);
      try {
        await postApi(
          "/api/admin/resources",
          { slug: resource.slug, [field]: value || null },
          { method: "PUT" },
        );
        showSuccess(`Updated ${field}`);
        onUpdate();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [resource.slug, onUpdate, showSuccess, showError],
  );

  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          cursor: "pointer",
        }}
      >
        <Icon name={resource.icon} size={18} color="var(--primary)" />
        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.9rem" }}>
          {resource.name}
        </span>
        {resource.phone && (
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            {resource.phone}
          </span>
        )}
        <ScrapeStatusBadge status={resource.scrape_status} />
        {resource.last_verified_at && (
          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
            Verified {formatRelativeDate(resource.last_verified_at)}
          </span>
        )}
        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color="var(--muted)"
        />
      </div>

      {/* Expanded edit fields */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--card-border)",
            padding: "0.75rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.625rem",
          }}
        >
          <InlineField
            label="Phone"
            value={editFields.phone}
            onChange={(v) => setEditFields((f) => ({ ...f, phone: v }))}
            onSave={() => saveField("phone", editFields.phone)}
            saving={saving}
          />
          <InlineField
            label="Address"
            value={editFields.address}
            onChange={(v) => setEditFields((f) => ({ ...f, address: v }))}
            onSave={() => saveField("address", editFields.address)}
            saving={saving}
          />
          <InlineField
            label="Hours"
            value={editFields.hours}
            onChange={(v) => setEditFields((f) => ({ ...f, hours: v }))}
            onSave={() => saveField("hours", editFields.hours)}
            saving={saving}
          />
          <InlineField
            label="Description"
            value={editFields.description}
            onChange={(v) => setEditFields((f) => ({ ...f, description: v }))}
            onSave={() => saveField("description", editFields.description)}
            saving={saving}
          />

          {/* Scrape diff display */}
          {resource.scrape_status === "changed" && (
            <div
              style={{
                background: "var(--warning-bg)",
                border: "1px solid var(--warning-border)",
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                fontSize: "0.8rem",
                color: "var(--warning-text)",
              }}
            >
              <strong>Changes detected</strong> — review scrape results and update fields above if needed.
            </div>
          )}

          {resource.scrape_status === "error" || resource.scrape_status === "unreachable" ? (
            <div
              style={{
                background: "var(--danger-bg)",
                border: "1px solid var(--danger-border)",
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                fontSize: "0.8rem",
                color: "var(--danger-text)",
              }}
            >
              <strong>Scrape {resource.scrape_status}</strong> — the website could not be reached or returned an error.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Inline Field ──────────────────────────────────────────────────────────────

function InlineField({
  label,
  value,
  onChange,
  onSave,
  saving,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <label
        style={{
          width: 80,
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
        }}
        style={{
          flex: 1,
          padding: "0.375rem 0.625rem",
          border: `1px solid ${focused ? "var(--primary)" : "var(--card-border)"}`,
          borderRadius: 6,
          fontSize: "0.85rem",
          outline: "none",
          background: "var(--card-bg)",
        }}
      />
      {focused && (
        <Button variant="primary" size="sm" loading={saving} onClick={onSave}>
          Save
        </Button>
      )}
    </div>
  );
}

// ── Scrape Status Badge ───────────────────────────────────────────────────────

function ScrapeStatusBadge({ status }: { status?: string }) {
  const color = getStatusColor(status);
  const label = status || "pending";

  return (
    <span
      style={{
        fontSize: "0.65rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "0.125rem 0.375rem",
        borderRadius: 4,
        background: color.bg,
        color: color.text,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusColor(status?: string | null): { bg: string; text: string } {
  switch (status) {
    case "ok":
      return { bg: "var(--success-bg)", text: "var(--success-text)" };
    case "changed":
      return { bg: "var(--warning-bg)", text: "var(--warning-text)" };
    case "error":
    case "unreachable":
      return { bg: "var(--danger-bg)", text: "var(--danger-text)" };
    default:
      return { bg: "var(--muted-bg, #f3f4f6)", text: "var(--muted)" };
  }
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
