"use client";

/**
 * /admin/walkthrough — Visual editor for the gala walkthrough deck.
 *
 * Reads/writes slides to ops.app_config via /api/walkthrough-config.
 * The Beacon team edits everything here — no repo access needed.
 * The static HTML at /walkthrough/ reads from the same API on load.
 */

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface DonationTier {
  amount: string;
  outcome: string;
}

interface Slide {
  id: string;
  type: "title" | "step" | "thankyou";
  step?: number;
  label?: string;
  color?: string;
  headline?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  iframe?: string;
  image?: string;
  org?: string;
  tiers?: DonationTier[];
}

export default function AdminWalkthroughPage() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { success: showSuccess, error: showError } = useToast();

  useEffect(() => {
    fetchApi<{ slides: Slide[] }>("/api/walkthrough-config").then((res) => {
      setSlides(res.slides);
      setLoading(false);
    });
  }, []);

  const updateSlide = useCallback((idx: number, patch: Partial<Slide>) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    setDirty(true);
  }, []);

  const updateTier = useCallback((slideIdx: number, tierIdx: number, patch: Partial<DonationTier>) => {
    setSlides((prev) =>
      prev.map((s, i) => {
        if (i !== slideIdx || !s.tiers) return s;
        const newTiers = s.tiers.map((t, j) => (j === tierIdx ? { ...t, ...patch } : t));
        return { ...s, tiers: newTiers };
      })
    );
    setDirty(true);
  }, []);

  const addTier = useCallback((slideIdx: number) => {
    setSlides((prev) =>
      prev.map((s, i) => {
        if (i !== slideIdx) return s;
        return { ...s, tiers: [...(s.tiers || []), { amount: "$0", outcome: "" }] };
      })
    );
    setDirty(true);
  }, []);

  const removeTier = useCallback((slideIdx: number, tierIdx: number) => {
    setSlides((prev) =>
      prev.map((s, i) => {
        if (i !== slideIdx || !s.tiers) return s;
        return { ...s, tiers: s.tiers.filter((_, j) => j !== tierIdx) };
      })
    );
    setDirty(true);
  }, []);

  const moveSlide = useCallback((idx: number, dir: -1 | 1) => {
    setSlides((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      // Renumber steps
      let stepNum = 1;
      return next.map((s) => {
        if (s.type === "step") return { ...s, step: stepNum++ };
        return s;
      });
    });
    setDirty(true);
  }, []);

  const addSlide = useCallback(() => {
    const stepCount = slides.filter((s) => s.type === "step").length;
    const newSlide: Slide = {
      id: `step-${Date.now()}`,
      type: "step",
      step: stepCount + 1,
      label: "New Step",
      color: "#6b7280",
      title: "New slide title",
      body: "Describe what happens in this step.",
      iframe: "",
    };
    // Insert before the last slide (thankyou)
    setSlides((prev) => {
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      copy.splice(lastIdx, 0, newSlide);
      // Renumber
      let stepNum = 1;
      return copy.map((s) => {
        if (s.type === "step") return { ...s, step: stepNum++ };
        return s;
      });
    });
    setDirty(true);
  }, [slides]);

  const removeSlide = useCallback((idx: number) => {
    setSlides((prev) => {
      const copy = prev.filter((_, i) => i !== idx);
      let stepNum = 1;
      return copy.map((s) => {
        if (s.type === "step") return { ...s, step: stepNum++ };
        return s;
      });
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await postApi("/api/walkthrough-config", { slides }, { method: "PUT" });
      setDirty(false);
      showSuccess("Walkthrough saved");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [slides, showSuccess, showError]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading walkthrough config...
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Gala Walkthrough
        </h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <a
            href="/walkthrough/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", color: "var(--primary)", textDecoration: "none" }}
          >
            <Icon name="external-link" size={14} /> Preview
          </a>
          <Button onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? "Save Changes" : "Saved"}
          </Button>
        </div>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1rem" }}>
        Edit slides for the gala walkthrough at <code>/walkthrough/</code>. Changes are live after saving.
      </p>
      <details style={{ marginBottom: "1.5rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
        <summary style={{ cursor: "pointer" }}>Advanced: editing transitions &amp; layout</summary>
        <p style={{ marginTop: "0.5rem", lineHeight: 1.6 }}>
          This editor controls slide <strong>content</strong> (text, images, colors, ordering).
          To change <strong>transitions, animations, or page layout</strong>, edit the files in{" "}
          <code>public/walkthrough/</code>: <code>styles.css</code> for visuals,{" "}
          <code>script.js</code> for behavior. Those files are the rendering engine &mdash;
          they read content from this editor via the API.
        </p>
      </details>

      {/* Slides */}
      {slides.map((slide, idx) => (
        <SlideEditor
          key={slide.id}
          slide={slide}
          idx={idx}
          total={slides.length}
          onChange={(patch) => updateSlide(idx, patch)}
          onMove={(dir) => moveSlide(idx, dir)}
          onRemove={() => removeSlide(idx)}
          onTierUpdate={(tierIdx, patch) => updateTier(idx, tierIdx, patch)}
          onTierAdd={() => addTier(idx)}
          onTierRemove={(tierIdx) => removeTier(idx, tierIdx)}
        />
      ))}

      {/* Add slide */}
      <button
        onClick={addSlide}
        style={{
          width: "100%",
          padding: "1rem",
          border: "2px dashed var(--card-border)",
          borderRadius: 10,
          background: "none",
          color: "var(--text-muted)",
          fontSize: "0.9rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          marginBottom: "2rem",
        }}
      >
        <Icon name="plus" size={16} /> Add Slide
      </button>

      {/* Sticky save bar when dirty */}
      {dirty && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "0.75rem 1.5rem",
          background: "var(--background)",
          borderTop: "1px solid var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          zIndex: 50,
          boxShadow: "0 -2px 8px rgba(0,0,0,0.08)",
        }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            You have unsaved changes
          </span>
          <Button onClick={save} loading={saving}>Save Changes</Button>
        </div>
      )}
    </div>
  );
}

/* ── Slide Editor Card ─────────────────────────────────────────────────── */

function SlideEditor({
  slide,
  idx,
  total,
  onChange,
  onMove,
  onRemove,
  onTierUpdate,
  onTierAdd,
  onTierRemove,
}: {
  slide: Slide;
  idx: number;
  total: number;
  onChange: (patch: Partial<Slide>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onTierUpdate: (tierIdx: number, patch: Partial<DonationTier>) => void;
  onTierAdd: () => void;
  onTierRemove: (tierIdx: number) => void;
}) {
  const isTitle = slide.type === "title";
  const isThankyou = slide.type === "thankyou";
  const isStep = slide.type === "step";
  const canRemove = isStep; // Only step slides can be removed

  const typeLabel = isTitle ? "Title Slide" : isThankyou ? "Thank You Slide" : `Step ${slide.step}: ${slide.label}`;

  return (
    <div style={{
      border: "1px solid var(--card-border)",
      borderRadius: 10,
      marginBottom: "1rem",
      overflow: "hidden",
    }}>
      {/* Card header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.6rem 1rem",
        background: "var(--surface, #f9fafb)",
        borderBottom: "1px solid var(--card-border)",
      }}>
        {/* Color indicator for steps */}
        {isStep && slide.color && (
          <span style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: slide.color,
            flexShrink: 0,
          }} />
        )}

        <span style={{ fontWeight: 600, fontSize: "0.85rem", flex: 1 }}>
          {typeLabel}
        </span>

        {/* Reorder buttons */}
        <button
          onClick={() => onMove(-1)}
          disabled={idx === 0}
          style={reorderBtnStyle}
          title="Move up"
        >
          <Icon name="chevron-up" size={14} />
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={idx === total - 1}
          style={reorderBtnStyle}
          title="Move down"
        >
          <Icon name="chevron-down" size={14} />
        </button>

        {canRemove && (
          <button
            onClick={onRemove}
            style={{ ...reorderBtnStyle, color: "var(--danger, #ef4444)" }}
            title="Remove slide"
          >
            <Icon name="trash-2" size={14} />
          </button>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: "1rem" }}>
        {isTitle && (
          <>
            <Field label="Headline" value={slide.headline || ""} onChange={(v) => onChange({ headline: v })} />
            <Field label="Subtitle" value={slide.subtitle || ""} onChange={(v) => onChange({ subtitle: v })} multiline />
            <Field label="Organization Name" value={slide.org || ""} onChange={(v) => onChange({ org: v })} />
          </>
        )}

        {isStep && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "0.75rem" }}>
              <Field label="Step Label" value={slide.label || ""} onChange={(v) => onChange({ label: v })} hint='e.g. "Find", "Fix", "Return"' />
              <Field label="Color" value={slide.color || "#6b7280"} onChange={(v) => onChange({ color: v })} type="color" />
            </div>
            <Field label="Title" value={slide.title || ""} onChange={(v) => onChange({ title: v })} />
            <Field label="Body" value={slide.body || ""} onChange={(v) => onChange({ body: v })} multiline />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <Field label="Iframe URL" value={slide.iframe || ""} onChange={(v) => onChange({ iframe: v })} hint="e.g. /map or /beacon" />
              <Field label="Image URL (instead of iframe)" value={slide.image || ""} onChange={(v) => onChange({ image: v })} hint="e.g. /walkthrough/assets/photo.jpg" />
            </div>
          </>
        )}

        {isThankyou && (
          <>
            <Field label="Heading" value={slide.title || ""} onChange={(v) => onChange({ title: v })} />
            <Field label="Body" value={slide.body || ""} onChange={(v) => onChange({ body: v })} multiline />

            <div style={{
              background: "var(--surface, #f9fafb)",
              borderRadius: 8,
              padding: "0.75rem",
              marginTop: "0.5rem",
            }}>
              <div style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
              }}>
                Donation Tiers
              </div>

              {(slide.tiers || []).map((tier, ti) => (
                <div key={ti} style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr auto",
                  gap: "0.5rem",
                  alignItems: "end",
                  marginBottom: "0.5rem",
                }}>
                  <Field label="Amount" value={tier.amount} onChange={(v) => onTierUpdate(ti, { amount: v })} />
                  <Field label="Outcome" value={tier.outcome} onChange={(v) => onTierUpdate(ti, { outcome: v })} />
                  <button
                    onClick={() => onTierRemove(ti)}
                    style={{ ...reorderBtnStyle, color: "var(--danger, #ef4444)", marginBottom: "0.35rem" }}
                    title="Remove tier"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}

              <button
                onClick={onTierAdd}
                style={{
                  background: "none",
                  border: "1px dashed var(--card-border)",
                  borderRadius: 6,
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                <Icon name="plus" size={12} /> Add Tier
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Simple Field ──────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: "text" | "color";
  hint?: string;
}) {
  const inputBase: React.CSSProperties = {
    width: "100%",
    padding: "0.4rem 0.6rem",
    fontSize: "0.85rem",
    border: "1px solid var(--card-border)",
    borderRadius: 6,
    background: "var(--background)",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.2rem" }}>
        {label}
      </label>
      {type === "color" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 32, height: 32, border: "none", padding: 0, cursor: "pointer", borderRadius: 4 }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputBase, flex: 1, fontFamily: "monospace", fontSize: "0.8rem" }}
          />
        </div>
      ) : multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputBase, resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={inputBase}
        />
      )}
      {hint && <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>{hint}</div>}
    </div>
  );
}

const reorderBtnStyle: React.CSSProperties = {
  appearance: "none",
  background: "none",
  border: "none",
  padding: "0.2rem",
  cursor: "pointer",
  color: "var(--text-muted)",
  display: "flex",
  alignItems: "center",
};
