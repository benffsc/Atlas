"use client";

/**
 * /admin/demo — Focused editor for the gala presentation deck.
 *
 * All fields write to ops.app_config via PUT /api/admin/config.
 * Pattern follows /admin/kiosk — sectioned layout, inline editing, useToast feedback.
 *
 * MIG_3078 seeds the demo.* config keys.
 * Epic: FFS-1193 (Beacon Polish) / FFS-1196 (Tier 3: Gala Mode)
 */

import { useState, useCallback, useEffect } from "react";
import { useAllConfigs, useAppConfig } from "@/hooks/useAppConfig";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function AdminDemoPage() {
  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Demo Deck
        </h1>
        <a
          href="/demo"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", color: "var(--primary)", textDecoration: "none" }}
        >
          <Icon name="external-link" size={14} /> Preview
        </a>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 2rem" }}>
        Edit the content shown in the /demo gala presentation. Changes are live immediately.
      </p>

      <GeneralSection />
      <SectionDivider />
      <UnitEconomicsSection />
      <SectionDivider />
      <SlideContentSection />
      <SectionDivider />
      <VisionCtaSection />
    </div>
  );
}

function SectionDivider() {
  return <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />;
}

// ── Shared save helper ──────────────────────────────────────────────────────

function useSaveConfig() {
  const { mutate } = useAllConfigs();
  const { success: showSuccess, error: showError } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      setSaving(key);
      try {
        await postApi("/api/admin/config", { key, value }, { method: "PUT" });
        await mutate();
        showSuccess(`Updated ${key.replace("demo.", "")}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [mutate, showSuccess, showError],
  );

  return { saveKey, saving };
}

// ── Inline edit field ───────────────────────────────────────────────────────

function InlineField({
  label,
  configKey,
  value,
  saving,
  onSave,
  multiline = false,
  type = "text",
  prefix,
  readOnly = false,
  hint,
}: {
  label: string;
  configKey: string;
  value: string | number;
  saving: string | null;
  onSave: (key: string, value: unknown) => void;
  multiline?: boolean;
  type?: "text" | "number";
  prefix?: string;
  readOnly?: boolean;
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleSave = () => {
    const finalValue = type === "number" ? Number(draft) : draft;
    if (type === "number" && isNaN(finalValue as number)) return;
    onSave(configKey, finalValue);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(String(value));
    setEditing(false);
  };

  const isSaving = saving === configKey;

  if (readOnly) {
    return (
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>{label}</label>
        <div style={{ ...displayStyle, opacity: 0.6 }}>{value}</div>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>{label}</label>
        <div
          onClick={() => setEditing(true)}
          style={{ ...displayStyle, cursor: "pointer" }}
          title="Click to edit"
        >
          {prefix && <span style={{ color: "var(--text-muted)", marginRight: "0.25rem" }}>{prefix}</span>}
          {String(value) || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Empty — click to set</span>}
          <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.75rem", flexShrink: 0 }}>
            <Icon name="pencil" size={12} />
          </span>
        </div>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  const inputProps = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !multiline) handleSave();
      if (e.key === "Escape") handleCancel();
    },
    style: inputStyle,
    autoFocus: true,
  };

  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "0.5rem" }}>
        {multiline ? (
          <textarea {...inputProps} rows={3} style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }} />
        ) : (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {prefix && <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{prefix}</span>}
            <input {...inputProps} type={type} style={{ ...inputStyle, flex: 1 }} />
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button size="sm" onClick={handleSave} loading={isSaving}>Save</Button>
          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Section: General ────────────────────────────────────────────────────────

function GeneralSection() {
  const { saveKey, saving } = useSaveConfig();
  const { mutate } = useAllConfigs();
  const { success: showSuccess, error: showError } = useToast();
  const { value: enabled } = useAppConfig<boolean>("demo.enabled");
  const { value: tagline } = useAppConfig<string>("demo.tagline");
  const orgConfig = useOrgConfig();

  const toggleEnabled = useCallback(async () => {
    try {
      await postApi("/api/admin/config", { key: "demo.enabled", value: !enabled }, { method: "PUT" });
      await mutate();
      showSuccess(enabled ? "Demo deck disabled" : "Demo deck enabled");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to toggle");
    }
  }, [enabled, mutate, showSuccess, showError]);

  return (
    <div>
      <h2 style={sectionTitleStyle}>General</h2>

      {/* Enabled toggle */}
      <div style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>Demo Deck Enabled</label>
        <button
          onClick={toggleEnabled}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            background: enabled ? "var(--success-text, #22c55e)" : "var(--border, #d1d5db)",
            position: "relative",
            transition: "background 150ms ease",
          }}
          title={enabled ? "Click to disable — /demo will redirect to /" : "Click to enable"}
        >
          <span style={{
            position: "absolute",
            top: 2,
            left: enabled ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 150ms ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </button>
        <span style={{ fontSize: "0.8rem", color: enabled ? "var(--success-text)" : "var(--text-muted)" }}>
          {enabled ? "Active — /demo is accessible" : "Disabled — /demo redirects to /"}
        </span>
      </div>

      <InlineField
        label="Tagline"
        configKey="demo.tagline"
        value={tagline}
        saving={saving}
        onSave={saveKey}
        hint="Shown on the title slide beneath the Beacon logo"
      />

      <InlineField
        label="Organization Name"
        configKey="org.name_full"
        value={orgConfig.nameFull}
        saving={null}
        onSave={() => {}}
        readOnly
        hint="Edit in Settings > All Settings > org.name_full"
      />
    </div>
  );
}

// ── Section: Unit Economics ──────────────────────────────────────────────────

function UnitEconomicsSection() {
  const { saveKey, saving } = useSaveConfig();
  const { value: eyebrow } = useAppConfig<string>("demo.ask_eyebrow");
  const { value: title } = useAppConfig<string>("demo.ask_title");
  const { value: t1Amount } = useAppConfig<number>("demo.unit_tier1_amount");
  const { value: t1Outcome } = useAppConfig<string>("demo.unit_tier1_outcome");
  const { value: t2Amount } = useAppConfig<number>("demo.unit_tier2_amount");
  const { value: t2Outcome } = useAppConfig<string>("demo.unit_tier2_outcome");
  const { value: t3Amount } = useAppConfig<number>("demo.unit_tier3_amount");
  const { value: t3Outcome } = useAppConfig<string>("demo.unit_tier3_outcome");
  const { value: body } = useAppConfig<string>("demo.ask_body");

  return (
    <div>
      <h2 style={sectionTitleStyle}>
        Unit Economics
        <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.5rem" }}>
          Slide 7 — The Ask
        </span>
      </h2>

      <InlineField label="Eyebrow" configKey="demo.ask_eyebrow" value={eyebrow} saving={saving} onSave={saveKey} />
      <InlineField label="Heading" configKey="demo.ask_title" value={title} saving={saving} onSave={saveKey} />

      <div style={{ background: "var(--surface, #f9fafb)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Donation Tiers
        </div>

        {[
          { label: "Tier 1", amountKey: "demo.unit_tier1_amount", amount: t1Amount, outcomeKey: "demo.unit_tier1_outcome", outcome: t1Outcome },
          { label: "Tier 2", amountKey: "demo.unit_tier2_amount", amount: t2Amount, outcomeKey: "demo.unit_tier2_outcome", outcome: t2Outcome },
          { label: "Tier 3", amountKey: "demo.unit_tier3_amount", amount: t3Amount, outcomeKey: "demo.unit_tier3_outcome", outcome: t3Outcome },
        ].map((tier) => (
          <div key={tier.label} style={{ marginBottom: "0.75rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--card-border)" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>{tier.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.5rem" }}>
              <InlineField
                label="Amount"
                configKey={tier.amountKey}
                value={tier.amount}
                saving={saving}
                onSave={saveKey}
                type="number"
                prefix="$"
              />
              <InlineField
                label="Outcome"
                configKey={tier.outcomeKey}
                value={tier.outcome}
                saving={saving}
                onSave={saveKey}
              />
            </div>
          </div>
        ))}
      </div>

      <InlineField label="Body Text" configKey="demo.ask_body" value={body} saving={saving} onSave={saveKey} multiline />
    </div>
  );
}

// ── Section: Slide Content ──────────────────────────────────────────────────

function SlideContentSection() {
  const { saveKey, saving } = useSaveConfig();
  const { value: clinicDistinction } = useAppConfig<string>("demo.clinic_distinction");
  const { value: impactFootnote } = useAppConfig<string>("demo.impact_footnote");
  const { value: zonesTitle } = useAppConfig<string>("demo.zones_title");
  const { value: zonesFootnote } = useAppConfig<string>("demo.zones_footnote");

  return (
    <div>
      <h2 style={sectionTitleStyle}>Slide Content</h2>

      <InlineField
        label="Clinic Distinction"
        configKey="demo.clinic_distinction"
        value={clinicDistinction}
        saving={saving}
        onSave={saveKey}
        hint="Slide 2 (Problem) — explains the org's unique position"
      />
      <InlineField
        label="Impact Footnote"
        configKey="demo.impact_footnote"
        value={impactFootnote}
        saving={saving}
        onSave={saveKey}
        hint="Slide 3 (Impact) — data credibility note"
      />
      <InlineField
        label="Zones Heading"
        configKey="demo.zones_title"
        value={zonesTitle}
        saving={saving}
        onSave={saveKey}
        hint="Slide 6 (Strategic Insight) — main heading"
      />
      <InlineField
        label="Zones Footnote"
        configKey="demo.zones_footnote"
        value={zonesFootnote}
        saving={saving}
        onSave={saveKey}
        hint="Slide 6 (Strategic Insight) — predictive modeling note"
      />
    </div>
  );
}

// ── Section: Vision & CTAs ──────────────────────────────────────────────────

function VisionCtaSection() {
  const { saveKey, saving } = useSaveConfig();
  const { value: visionBody1 } = useAppConfig<string>("demo.vision_body1");
  const { value: visionBody2 } = useAppConfig<string>("demo.vision_body2");
  const { value: cta1Label } = useAppConfig<string>("demo.cta1_label");
  const { value: cta1Href } = useAppConfig<string>("demo.cta1_href");
  const { value: cta2Label } = useAppConfig<string>("demo.cta2_label");
  const { value: cta2Href } = useAppConfig<string>("demo.cta2_href");

  return (
    <div>
      <h2 style={sectionTitleStyle}>
        Vision & CTAs
        <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.5rem" }}>
          Slide 8
        </span>
      </h2>

      <InlineField
        label="Vision Paragraph 1"
        configKey="demo.vision_body1"
        value={visionBody1}
        saving={saving}
        onSave={saveKey}
        multiline
      />
      <InlineField
        label="Vision Paragraph 2"
        configKey="demo.vision_body2"
        value={visionBody2}
        saving={saving}
        onSave={saveKey}
        multiline
      />

      <div style={{ background: "var(--surface, #f9fafb)", borderRadius: 8, padding: "1rem", marginTop: "1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Call-to-Action Buttons
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <InlineField label="Primary Label" configKey="demo.cta1_label" value={cta1Label} saving={saving} onSave={saveKey} />
          <InlineField label="Primary URL" configKey="demo.cta1_href" value={cta1Href} saving={saving} onSave={saveKey} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <InlineField label="Secondary Label" configKey="demo.cta2_label" value={cta2Label} saving={saving} onSave={saveKey} />
          <InlineField label="Secondary URL" configKey="demo.cta2_href" value={cta2Href} saving={saving} onSave={saveKey} />
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "1.15rem",
  fontWeight: 700,
  margin: "0 0 1rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.78rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "0.25rem",
};

const displayStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0.45rem 0.6rem",
  fontSize: "0.875rem",
  border: "1px solid var(--card-border)",
  borderRadius: 6,
  background: "var(--background)",
  minHeight: 36,
  lineHeight: 1.4,
};

const inputStyle: React.CSSProperties = {
  padding: "0.45rem 0.6rem",
  fontSize: "0.875rem",
  border: "1px solid var(--primary, #4291df)",
  borderRadius: 6,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const hintStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "var(--text-muted)",
  marginTop: "0.2rem",
};
