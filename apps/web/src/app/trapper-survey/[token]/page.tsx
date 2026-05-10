"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

// ── Types ──

interface SurveyQuestion {
  id: string;
  type: "checkbox" | "radio" | "text" | "textarea" | "select" | "toggle" | "day_picker";
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  maps_to?: string;
  options?: { value: string; label: string; description?: string }[];
  show_if?: { question_id: string; value: string | string[] };
}

interface SurveyTemplate {
  title: string;
  subtitle: string | null;
  thank_you_title: string;
  thank_you_message: string;
  questions: SurveyQuestion[];
}

interface TrapperData {
  first_name: string;
  last_name: string;
  survey_completed_at: string | null;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ── Generic Question Renderers ──

function CheckboxQuestion({ q, value, onChange }: { q: SurveyQuestion; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {(q.options || []).map((opt) => (
        <label
          key={opt.value}
          style={{
            ...styles.checkboxLabel,
            background: value.includes(opt.value) ? "var(--info-bg, #cce5ff)" : "var(--card-bg, #f8f9fa)",
            borderColor: value.includes(opt.value) ? "var(--info-border, #0d6efd)" : "var(--border, #e5e5e5)",
          }}
        >
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            style={{ marginRight: "0.75rem", width: 18, height: 18, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{opt.label}</div>
            {opt.description && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2 }}>{opt.description}</div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

function RadioQuestion({ q, value, onChange }: { q: SurveyQuestion; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {(q.options || []).map((opt) => (
        <label key={opt.value} style={styles.toggleLabel}>
          <input
            type="radio"
            name={q.id}
            value={opt.value}
            checked={value === opt.value}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 18, height: 18, marginRight: "0.75rem" }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function DayPickerQuestion({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (day: string) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {DAYS.map((day) => (
        <button
          key={day}
          type="button"
          onClick={() => toggle(day)}
          style={{
            padding: "6px 14px",
            borderRadius: 20,
            border: "1px solid var(--border)",
            background: value.includes(day) ? "var(--primary)" : "var(--card-bg, #f8f9fa)",
            color: value.includes(day) ? "#fff" : "var(--foreground)",
            fontSize: "0.85rem",
            fontWeight: value.includes(day) ? 600 : 400,
            cursor: "pointer",
          }}
        >
          {day.slice(0, 3)}
        </button>
      ))}
    </div>
  );
}

function ToggleQuestion({ q, value, onChange }: { q: SurveyQuestion; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.95rem", cursor: "pointer" }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
      {q.label}
    </label>
  );
}

// ── Main Page ──

export default function TrapperSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [trapper, setTrapper] = useState<TrapperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    Promise.all([
      fetch(`/api/trapper-survey/${token}`).then((r) => r.json()),
      fetch("/api/survey-templates/trapper_capabilities").then((r) => r.json()),
    ])
      .then(([trapperRaw, templateRaw]) => {
        const tData = trapperRaw?.data || trapperRaw;
        const tmplData = templateRaw?.data || templateRaw;

        if (!tData?.trapper) {
          setError("Survey link not found or expired.");
          return;
        }
        setTrapper(tData.trapper);

        if (tData.trapper.survey_completed_at) {
          setSubmitted(true);
        }

        if (tmplData?.template) {
          setTemplate(tmplData.template);
          // Pre-fill answers from trapper data
          const prefill: Record<string, unknown> = {};
          for (const q of tmplData.template.questions) {
            if (q.maps_to && tData.trapper[q.maps_to] !== undefined) {
              prefill[q.id] = tData.trapper[q.maps_to];
            }
          }
          setAnswers(prefill);
        } else {
          setError("Survey configuration not found.");
        }
      })
      .catch(() => setError("Unable to load survey. Please try again later."))
      .finally(() => setLoading(false));
  }, [token]);

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const shouldShow = (q: SurveyQuestion): boolean => {
    if (!q.show_if) return true;
    const depValue = answers[q.show_if.question_id];
    if (Array.isArray(q.show_if.value)) {
      return q.show_if.value.includes(depValue as string);
    }
    if (Array.isArray(depValue)) {
      return depValue.includes(q.show_if.value);
    }
    return depValue === q.show_if.value;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;

    // Validate required fields
    for (const q of template.questions) {
      if (q.required && shouldShow(q)) {
        const val = answers[q.id];
        if (!val || (Array.isArray(val) && val.length === 0)) {
          setError(`"${q.label}" is required.`);
          return;
        }
      }
    }

    setError(null);
    setSubmitting(true);

    // Build submission body by mapping answers to profile fields
    const body: Record<string, unknown> = {};
    for (const q of template.questions) {
      if (!q.maps_to || !shouldShow(q)) continue;
      const val = answers[q.id];

      if (q.maps_to === "_availability_days") {
        // Combine with existing availability_notes
        const days = val as string[];
        if (days?.length > 0) {
          const existingNotes = (answers["availability_notes"] as string) || "";
          body.availability_notes = `Days: ${days.join(", ")}${existingNotes ? `. ${existingNotes}` : ""}`;
        }
      } else if (q.maps_to === "_additional_notes") {
        body.additional_notes = val || null;
      } else if (q.maps_to === "languages_spoken") {
        const langStr = val as string;
        body.languages_spoken = langStr ? langStr.split(",").map((l: string) => l.trim()).filter(Boolean) : null;
      } else {
        body[q.maps_to] = val ?? null;
      }
    }

    // Don't override availability_notes if _availability_days already set it
    if (body.availability_notes === undefined && answers["availability_notes"]) {
      body.availability_notes = answers["availability_notes"];
    }

    try {
      const res = await fetch(`/api/trapper-survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json();
        setError(data?.error?.message || data?.error || "Submission failed");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render states ──

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={{ textAlign: "center", color: "var(--text-secondary)" }}>Loading survey...</p>
        </div>
      </div>
    );
  }

  if (error && !trapper) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Survey Not Found</h1>
          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted && template) {
    const thankTitle = template.thank_you_title.replace("{{first_name}}", trapper?.first_name || "");
    const thankMsg = template.thank_you_message.replace("{{first_name}}", trapper?.first_name || "");
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: "center" }}>
            <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, height: "auto", marginBottom: "1rem" }} />
            <h1 style={styles.title}>{thankTitle}</h1>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", lineHeight: 1.6 }}>{thankMsg}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!template) return null;

  const subtitle = template.subtitle?.replace("{{first_name}}", trapper?.first_name || "") || "";

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, height: "auto", marginBottom: "0.75rem" }} />
          <h1 style={styles.title}>{template.title}</h1>
          {subtitle && <p style={{ color: "var(--text-secondary)", margin: 0 }}>{subtitle}</p>}
        </div>

        <form onSubmit={handleSubmit}>
          {template.questions.filter(shouldShow).map((q) => {
            // Toggle renders inline (no fieldset wrapper)
            if (q.type === "toggle") {
              return (
                <div key={q.id} style={{ marginBottom: "1.25rem" }}>
                  <ToggleQuestion q={q} value={!!answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
                </div>
              );
            }

            return (
              <fieldset key={q.id} style={styles.fieldset}>
                <legend style={styles.legend}>
                  {q.label}{q.required ? " *" : ""}
                </legend>
                {q.description && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", margin: "0 0 0.5rem" }}>{q.description}</p>
                )}

                {q.type === "checkbox" && (
                  <CheckboxQuestion q={q} value={(answers[q.id] as string[]) || []} onChange={(v) => setAnswer(q.id, v)} />
                )}
                {q.type === "radio" && (
                  <RadioQuestion q={q} value={(answers[q.id] as string) || ""} onChange={(v) => setAnswer(q.id, v)} />
                )}
                {q.type === "day_picker" && (
                  <DayPickerQuestion value={(answers[q.id] as string[]) || []} onChange={(v) => setAnswer(q.id, v)} />
                )}
                {q.type === "text" && (
                  <input
                    type="text"
                    value={(answers[q.id] as string) || ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder={q.placeholder}
                    style={styles.input}
                  />
                )}
                {q.type === "textarea" && (
                  <textarea
                    value={(answers[q.id] as string) || ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder={q.placeholder}
                    rows={3}
                    style={{ ...styles.input, resize: "vertical" }}
                  />
                )}
                {q.type === "select" && (
                  <select
                    value={(answers[q.id] as string) || ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    style={styles.input}
                  >
                    <option value="">Select...</option>
                    {(q.options || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}
              </fieldset>
            );
          })}

          {error && (
            <div style={{ padding: "0.75rem 1rem", background: "var(--danger-bg)", color: "var(--danger-text)", borderRadius: 8, marginBottom: "1rem", fontSize: "0.9rem" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%", padding: "0.875rem",
              background: submitting ? "var(--text-secondary)" : "var(--primary)",
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: "1rem", fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit Survey"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "2rem 1rem",
    background: "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background, #fff) 55%)",
  },
  card: {
    width: "100%",
    maxWidth: 540,
    background: "var(--background, #fff)",
    border: "1px solid var(--border, #e5e5e5)",
    borderRadius: 12,
    padding: "2rem",
  },
  title: {
    fontSize: "1.35rem",
    fontWeight: 700,
    margin: 0,
    color: "var(--text-primary, #111)",
  },
  fieldset: {
    border: "none",
    padding: 0,
    margin: "0 0 1.5rem 0",
  },
  legend: {
    fontSize: "0.95rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
    color: "var(--text-primary, #111)",
  },
  input: {
    width: "100%",
    padding: "0.75rem 1rem",
    border: "1px solid var(--border, #e5e5e5)",
    borderRadius: 8,
    fontSize: "0.95rem",
    background: "var(--background, #fff)",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "flex-start",
    padding: "0.75rem 1rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
};
