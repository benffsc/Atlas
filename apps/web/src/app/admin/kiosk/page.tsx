"use client";

import { useState, useMemo, useCallback } from "react";
import { useAppConfig, useAllConfigs } from "@/hooks/useAppConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import {
  DEFAULT_QUESTIONS,
  scoreAnswers,
  SITUATION_LABELS,
  SITUATION_TO_CALL_TYPE,
  type IndirectQuestion,
  type QuestionOption,
  type SituationType,
} from "@/lib/kiosk-questions";

const SITUATION_TYPES: SituationType[] = [
  "community_cat",
  "pet_cat",
  "colony",
  "kitten",
  "medical",
];

export default function AdminKioskPage() {
  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
        Kiosk Configuration
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 2rem" }}>
        Configure modules, session timeouts, and the help form question set.
      </p>
      <ModuleConfig />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <QuestionEditor />
    </div>
  );
}

// ── Module Config ─────────────────────────────────────────────────────────────

const MODULE_OPTIONS = [
  { id: "equipment", label: "Equipment Check Out", icon: "box" },
  { id: "help", label: "Help Request Form", icon: "heart-handshake" },
  { id: "cats", label: "Adoptable Cats (Coming Soon)", icon: "cat" },
  { id: "trapper", label: "Trapper Request (Coming Soon)", icon: "map-pin" },
];

function ModuleConfig() {
  const { mutate } = useAllConfigs();
  const { value: enabledModules } = useAppConfig<string[]>("kiosk.modules_enabled");
  const { value: splashTitle } = useAppConfig<string>("kiosk.splash_title");
  const { value: splashSubtitle } = useAppConfig<string>("kiosk.splash_subtitle");
  const { value: publicTimeout } = useAppConfig<number>("kiosk.session_timeout_public");
  const { value: equipmentTimeout } = useAppConfig<number>("kiosk.session_timeout_equipment");
  const { value: successMsg } = useAppConfig<string>("kiosk.success_message");
  const { success: showSuccess, error: showError } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      setSaving(key);
      try {
        await postApi("/api/admin/config", { key, value }, { method: "PUT" });
        await mutate();
        showSuccess(`Updated ${key}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [mutate, showSuccess, showError],
  );

  const toggleModule = useCallback(
    (moduleId: string) => {
      const current = enabledModules || [];
      const next = current.includes(moduleId)
        ? current.filter((m) => m !== moduleId)
        : [...current, moduleId];
      saveKey("kiosk.modules_enabled", next);
    },
    [enabledModules, saveKey],
  );

  return (
    <div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 1rem" }}>Modules</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {MODULE_OPTIONS.map((mod) => {
          const isEnabled = enabledModules?.includes(mod.id);
          return (
            <label
              key={mod.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={isEnabled || false}
                onChange={() => toggleModule(mod.id)}
                disabled={saving === "kiosk.modules_enabled"}
                style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
              />
              <Icon name={mod.icon} size={18} color={isEnabled ? "var(--primary)" : "var(--muted)"} />
              <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{mod.label}</span>
            </label>
          );
        })}
      </div>

      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 1rem" }}>Settings</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <InlineEditField
          label="Public Timeout (seconds)"
          value={String(publicTimeout)}
          onSave={(v) => saveKey("kiosk.session_timeout_public", Number(v))}
          saving={saving === "kiosk.session_timeout_public"}
          type="number"
        />
        <InlineEditField
          label="Equipment Timeout (seconds)"
          value={String(equipmentTimeout)}
          onSave={(v) => saveKey("kiosk.session_timeout_equipment", Number(v))}
          saving={saving === "kiosk.session_timeout_equipment"}
          type="number"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <InlineEditField
          label="Splash Title"
          value={splashTitle}
          onSave={(v) => saveKey("kiosk.splash_title", v)}
          saving={saving === "kiosk.splash_title"}
        />
        <InlineEditField
          label="Splash Subtitle"
          value={splashSubtitle}
          onSave={(v) => saveKey("kiosk.splash_subtitle", v)}
          saving={saving === "kiosk.splash_subtitle"}
        />
        <InlineEditField
          label="Success Message"
          value={successMsg}
          onSave={(v) => saveKey("kiosk.success_message", v)}
          saving={saving === "kiosk.success_message"}
        />
      </div>
    </div>
  );
}

// ── Inline Edit Field ─────────────────────────────────────────────────────────

function InlineEditField({
  label,
  value,
  onSave,
  saving,
  type = "text",
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  saving: boolean;
  type?: "text" | "number";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </label>
      {editing ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onSave(draft); setEditing(false); }
              if (e.key === "Escape") { setDraft(value); setEditing(false); }
            }}
            autoFocus
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--primary)",
              borderRadius: 8,
              fontSize: "0.9rem",
              outline: "none",
              background: "var(--card-bg)",
            }}
          />
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={() => { onSave(draft); setEditing(false); }}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }}>
            Cancel
          </Button>
        </div>
      ) : (
        <div
          onClick={() => { setDraft(value); setEditing(true); }}
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 8,
            fontSize: "0.9rem",
            cursor: "pointer",
            minHeight: 38,
            display: "flex",
            alignItems: "center",
          }}
        >
          {value || <span style={{ color: "var(--muted)" }}>Click to edit</span>}
        </div>
      )}
    </div>
  );
}

// ── Question Editor ───────────────────────────────────────────────────────────

function QuestionEditor() {
  const { value: savedQuestions } = useAppConfig<IndirectQuestion[] | null>("kiosk.help_questions");
  const { mutate } = useAllConfigs();
  const { success: showSuccess, error: showError } = useToast();

  const [questions, setQuestions] = useState<IndirectQuestion[]>(
    () => (savedQuestions && Array.isArray(savedQuestions) ? savedQuestions : DEFAULT_QUESTIONS),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Live scoring preview state
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({});

  const previewScoring = useMemo(() => scoreAnswers(previewAnswers, questions), [previewAnswers, questions]);

  const updateQuestion = useCallback(
    (id: string, updates: Partial<IndirectQuestion>) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, ...updates } : q)),
      );
      setHasChanges(true);
    },
    [],
  );

  const moveQuestion = useCallback((index: number, direction: -1 | 1) => {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((q, i) => ({ ...q, display_order: i + 1 }));
    });
    setHasChanges(true);
  }, []);

  const addQuestion = useCallback(() => {
    const newQ: IndirectQuestion = {
      id: `q_custom_${Date.now()}`,
      text: "New question",
      help_text: "",
      options: [
        {
          value: "option_1",
          label: "Option 1",
          scores: { community_cat: 0, pet_cat: 0, colony: 0, kitten: 0, medical: 0 },
        },
      ],
      display_order: questions.length + 1,
      is_required: true,
    };
    setQuestions((prev) => [...prev, newQ]);
    setExpandedId(newQ.id);
    setHasChanges(true);
  }, [questions.length]);

  const removeQuestion = useCallback(
    (id: string) => {
      setQuestions((prev) => prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, display_order: i + 1 })));
      setHasChanges(true);
    },
    [],
  );

  const saveQuestions = useCallback(async () => {
    setSaving(true);
    try {
      await postApi("/api/admin/config", { key: "kiosk.help_questions", value: questions }, { method: "PUT" });
      await mutate();
      setHasChanges(false);
      showSuccess("Questions saved");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [questions, mutate, showSuccess, showError]);

  const resetToDefaults = useCallback(() => {
    setQuestions(DEFAULT_QUESTIONS);
    setHasChanges(true);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
          Help Form Questions ({questions.length})
        </h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button variant="ghost" size="sm" onClick={resetToDefaults}>
            Reset to Defaults
          </Button>
          <Button variant="ghost" size="sm" onClick={addQuestion} icon="plus">
            Add Question
          </Button>
          {hasChanges && (
            <Button variant="primary" size="sm" loading={saving} onClick={saveQuestions}>
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {/* Question list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
        {questions.map((q, idx) => (
          <QuestionItem
            key={q.id}
            question={q}
            index={idx}
            total={questions.length}
            expanded={expandedId === q.id}
            onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
            onUpdate={(updates) => updateQuestion(q.id, updates)}
            onMove={(dir) => moveQuestion(idx, dir)}
            onRemove={() => removeQuestion(q.id)}
          />
        ))}
      </div>

      {/* Live scoring preview */}
      <ScoringPreview
        questions={questions}
        answers={previewAnswers}
        onAnswer={(qId, value) =>
          setPreviewAnswers((prev) => ({ ...prev, [qId]: value }))
        }
        onClear={() => setPreviewAnswers({})}
        scoring={previewScoring}
      />
    </div>
  );
}

// ── Question Item ─────────────────────────────────────────────────────────────

function QuestionItem({
  question,
  index,
  total,
  expanded,
  onToggle,
  onUpdate,
  onMove,
  onRemove,
}: {
  question: IndirectQuestion;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<IndirectQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: expanded ? "2px solid var(--primary)" : "1px solid var(--card-border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "var(--primary)",
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.95rem" }}>{question.text}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {question.options.length} options
        </span>
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={16} color="var(--muted)" />
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: "0 1rem 1rem", borderTop: "1px solid var(--card-border)" }}>
          {/* Controls */}
          <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 0", flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0}>
              ↑ Move Up
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMove(1)} disabled={index === total - 1}>
              ↓ Move Down
            </Button>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={question.is_required}
                onChange={(e) => onUpdate({ is_required: e.target.checked })}
                style={{ accentColor: "var(--primary)" }}
              />
              Required
            </label>
            <div style={{ flex: 1 }} />
            <Button variant="danger" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </div>

          {/* Question text */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={smallLabelStyle}>Question Text</label>
            <input
              value={question.text}
              onChange={(e) => onUpdate({ text: e.target.value })}
              style={editorInputStyle}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={smallLabelStyle}>Help Text (optional)</label>
            <input
              value={question.help_text || ""}
              onChange={(e) => onUpdate({ help_text: e.target.value })}
              placeholder="Shown below the question as a hint"
              style={editorInputStyle}
            />
          </div>

          {/* Options */}
          <div style={{ marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <label style={smallLabelStyle}>Options</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newOpt: QuestionOption = {
                    value: `opt_${Date.now()}`,
                    label: "New option",
                    scores: { community_cat: 0, pet_cat: 0, colony: 0, kitten: 0, medical: 0 },
                  };
                  onUpdate({ options: [...question.options, newOpt] });
                }}
              >
                + Add Option
              </Button>
            </div>

            {question.options.map((opt, optIdx) => (
              <OptionEditor
                key={opt.value}
                option={opt}
                onUpdate={(updates) => {
                  const newOptions = [...question.options];
                  newOptions[optIdx] = { ...opt, ...updates };
                  onUpdate({ options: newOptions });
                }}
                onRemove={() => {
                  onUpdate({ options: question.options.filter((_, i) => i !== optIdx) });
                }}
                canRemove={question.options.length > 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Option Editor ─────────────────────────────────────────────────────────────

function OptionEditor({
  option,
  onUpdate,
  onRemove,
  canRemove,
}: {
  option: QuestionOption;
  onUpdate: (updates: Partial<QuestionOption>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--muted-bg, #f9fafb)",
        border: "1px solid var(--card-border)",
        borderRadius: 8,
        padding: "0.75rem",
        marginBottom: "0.5rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" }}>
        <input
          value={option.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Option label"
          style={{ ...editorInputStyle, flex: 1 }}
        />
        <input
          value={option.icon || ""}
          onChange={(e) => onUpdate({ icon: e.target.value })}
          placeholder="Icon"
          style={{ ...editorInputStyle, width: 90 }}
        />
        {canRemove && (
          <button
            onClick={onRemove}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.25rem",
              color: "var(--danger-text)",
            }}
          >
            <Icon name="x" size={16} color="var(--danger-text)" />
          </button>
        )}
      </div>

      {/* Score weights */}
      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        {SITUATION_TYPES.map((type) => (
          <div
            key={type}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.7rem",
            }}
          >
            <span
              style={{
                color: "var(--text-secondary)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
              }}
            >
              {SITUATION_LABELS[type].slice(0, 6)}
            </span>
            <input
              type="number"
              value={option.scores[type] ?? 0}
              onChange={(e) =>
                onUpdate({
                  scores: { ...option.scores, [type]: Number(e.target.value) || 0 },
                })
              }
              style={{
                width: 42,
                padding: "0.2rem 0.3rem",
                border: "1px solid var(--card-border)",
                borderRadius: 4,
                fontSize: "0.75rem",
                textAlign: "center",
                background: "var(--card-bg)",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scoring Preview ───────────────────────────────────────────────────────────

function ScoringPreview({
  questions,
  answers,
  onAnswer,
  onClear,
  scoring,
}: {
  questions: IndirectQuestion[];
  answers: Record<string, string>;
  onAnswer: (questionId: string, value: string) => void;
  onClear: () => void;
  scoring: ReturnType<typeof scoreAnswers>;
}) {
  const hasAnswers = Object.keys(answers).length > 0;

  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--card-border)",
          background: "var(--muted-bg, #f9fafb)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
          <Icon name="sparkles" size={16} color="var(--primary)" /> Scoring Preview
        </div>
        {hasAnswers && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      <div style={{ padding: "1rem" }}>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
          Select answers below to see how the scoring engine classifies them.
        </p>

        {/* Compact question selectors */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
          {questions.map((q) => (
            <div key={q.id}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                {q.text}
              </div>
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                {q.options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onAnswer(q.id, opt.value)}
                    style={{
                      padding: "0.35rem 0.625rem",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      fontFamily: "inherit",
                      border: answers[q.id] === opt.value
                        ? "2px solid var(--primary)"
                        : "1px solid var(--card-border)",
                      borderRadius: 6,
                      background: answers[q.id] === opt.value
                        ? "var(--primary-bg, rgba(59,130,246,0.08))"
                        : "var(--card-bg)",
                      color: answers[q.id] === opt.value ? "var(--primary)" : "var(--text-primary)",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Result */}
        {hasAnswers && (
          <div
            style={{
              background: "var(--primary-bg, rgba(59,130,246,0.08))",
              border: "1px solid var(--primary)",
              borderRadius: 10,
              padding: "1rem",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--primary)", marginBottom: "0.5rem" }}>
              Classification: {SITUATION_LABELS[scoring.classification]}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
              Call type: <code>{SITUATION_TO_CALL_TYPE[scoring.classification]}</code> &middot;
              Confidence: {(scoring.confidence * 100).toFixed(0)}% &middot;
              Handleability: {scoring.handleability}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {SITUATION_TYPES.map((type) => (
                <div key={type} style={{ fontSize: "0.75rem" }}>
                  <span style={{ fontWeight: 600, color: type === scoring.classification ? "var(--primary)" : "var(--text-secondary)" }}>
                    {SITUATION_LABELS[type]}:
                  </span>{" "}
                  <span style={{ fontWeight: type === scoring.classification ? 700 : 400 }}>
                    {scoring.scores[type]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const smallLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.25rem",
};

const editorInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--card-border)",
  borderRadius: 8,
  fontSize: "0.85rem",
  background: "var(--card-bg)",
  outline: "none",
  boxSizing: "border-box" as const,
};
