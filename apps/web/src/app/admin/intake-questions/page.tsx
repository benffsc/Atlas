"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi, ApiError } from "@/lib/api-client";

interface QuestionOption {
  option_id?: string;
  value: string;
  label: string;
  description?: string;
  showWarning?: boolean;
  warningText?: string;
}

interface IntakeQuestion {
  question_id: string;
  question_key: string;
  question_type: string;
  question_text: string;
  help_text: string | null;
  is_required: boolean;
  is_active: boolean;
  is_custom: boolean;
  display_order: number;
  step_name: string;
  show_condition: Record<string, unknown> | null;
  options: QuestionOption[];
}

const STEP_LABELS: Record<string, string> = {
  contact: "Contact Information",
  location: "Cat Location",
  cats: "Cat Details",
  situation: "Situation",
  review: "Review",
};

export default function IntakeQuestionsAdmin() {
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingQuestion, setEditingQuestion] = useState<IntakeQuestion | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    question_key: "",
    question_text: "",
    help_text: "",
    question_type: "text",
    step_name: "situation",
    is_required: false,
  });
  const [saving, setSaving] = useState(false);

  const fetchQuestions = useCallback(async () => {
    try {
      const data = await fetchApi<{ questions: IntakeQuestion[] }>(
        "/api/admin/intake-questions?include_inactive=true"
      );
      setQuestions(data.questions || []);
    } catch (err) {
      console.error("Error fetching questions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleSaveQuestion = async () => {
    if (!editingQuestion) return;
    setSaving(true);

    try {
      await postApi("/api/admin/intake-questions", {
        question_id: editingQuestion.question_id,
        question_text: editingQuestion.question_text,
        help_text: editingQuestion.help_text,
        is_active: editingQuestion.is_active,
        options: editingQuestion.options,
      }, { method: "PUT" });

      setEditingQuestion(null);
      fetchQuestions();
    } catch (err) {
      console.error("Error saving question:", err);
      alert(err instanceof ApiError ? err.message : "Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomQuestion = async () => {
    if (!newQuestion.question_key || !newQuestion.question_text) {
      alert("Question key and text are required");
      return;
    }

    setSaving(true);
    try {
      await postApi("/api/admin/intake-questions", newQuestion);

      setShowAddCustom(false);
      setNewQuestion({
        question_key: "",
        question_text: "",
        help_text: "",
        question_type: "text",
        step_name: "situation",
        is_required: false,
      });
      fetchQuestions();
    } catch (err) {
      console.error("Error adding question:", err);
      alert(err instanceof ApiError ? err.message : "Failed to add question");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Are you sure you want to delete this custom question?")) return;

    try {
      await postApi(`/api/admin/intake-questions?id=${questionId}`, {}, { method: "DELETE" });
      fetchQuestions();
    } catch (err) {
      console.error("Error deleting question:", err);
      alert(err instanceof ApiError ? err.message : "Failed to delete question");
    }
  };

  const groupedQuestions = questions.reduce<Record<string, IntakeQuestion[]>>((acc, q) => {
    if (!acc[q.step_name]) acc[q.step_name] = [];
    acc[q.step_name].push(q);
    return acc;
  }, {});

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Intake Questions Configuration</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Intake Questions Configuration</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Edit question wording and add custom questions for the intake form
          </p>
        </div>
        <button
          onClick={() => setShowAddCustom(true)}
          style={{
            padding: "0.75rem 1.5rem",
            background: "#198754",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          + Add Custom Question
        </button>
      </div>

      {/* Add Custom Question Form */}
      {showAddCustom && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "#f8f9fa" }}>
          <h3 style={{ marginTop: 0 }}>Add Custom Question</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            Custom questions will appear on the intake form and responses will be saved for staff review.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label>Question Key (internal identifier)</label>
              <input
                type="text"
                value={newQuestion.question_key}
                onChange={(e) => setNewQuestion({ ...newQuestion, question_key: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                placeholder="custom_feeding_frequency"
              />
            </div>
            <div>
              <label>Step</label>
              <select
                value={newQuestion.step_name}
                onChange={(e) => setNewQuestion({ ...newQuestion, step_name: e.target.value })}
              >
                <option value="cats">Cat Details</option>
                <option value="situation">Situation</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Question Text</label>
            <input
              type="text"
              value={newQuestion.question_text}
              onChange={(e) => setNewQuestion({ ...newQuestion, question_text: e.target.value })}
              placeholder="What is the cat's feeding schedule?"
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Help Text (optional)</label>
            <input
              type="text"
              value={newQuestion.help_text}
              onChange={(e) => setNewQuestion({ ...newQuestion, help_text: e.target.value })}
              placeholder="Additional context shown below the question"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label>Question Type</label>
              <select
                value={newQuestion.question_type}
                onChange={(e) => setNewQuestion({ ...newQuestion, question_type: e.target.value })}
              >
                <option value="text">Text Input</option>
                <option value="textarea">Long Text</option>
                <option value="radio">Radio Buttons</option>
                <option value="select">Dropdown</option>
                <option value="checkbox">Checkbox</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "1.5rem" }}>
              <input
                type="checkbox"
                id="is_required"
                checked={newQuestion.is_required}
                onChange={(e) => setNewQuestion({ ...newQuestion, is_required: e.target.checked })}
              />
              <label htmlFor="is_required" style={{ margin: 0 }}>Required</label>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button onClick={() => setShowAddCustom(false)} style={{ padding: "0.5rem 1rem" }}>
              Cancel
            </button>
            <button
              onClick={handleAddCustomQuestion}
              disabled={saving}
              style={{
                padding: "0.5rem 1rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
              }}
            >
              {saving ? "Saving..." : "Add Question"}
            </button>
          </div>
        </div>
      )}

      {/* Questions by Step */}
      {Object.entries(STEP_LABELS).map(([stepKey, stepLabel]) => {
        const stepQuestions = groupedQuestions[stepKey] || [];
        if (stepQuestions.length === 0) return null;

        return (
          <div key={stepKey} style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.25rem", borderBottom: "2px solid var(--border)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
              {stepLabel}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {stepQuestions.map((q) => (
                <div
                  key={q.question_id}
                  className="card"
                  style={{
                    padding: "1rem",
                    opacity: q.is_active ? 1 : 0.5,
                    border: q.is_custom ? "2px solid #0d6efd" : undefined,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                        <code style={{ fontSize: "0.8rem", color: "var(--muted)", background: "#f8f9fa", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                          {q.question_key}
                        </code>
                        {q.is_custom && (
                          <span style={{ fontSize: "0.75rem", background: "#0d6efd", color: "#fff", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                            Custom
                          </span>
                        )}
                        {q.is_required && (
                          <span style={{ fontSize: "0.75rem", background: "#dc3545", color: "#fff", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                            Required
                          </span>
                        )}
                        {!q.is_active && (
                          <span style={{ fontSize: "0.75rem", background: "#6c757d", color: "#fff", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                            Inactive
                          </span>
                        )}
                      </div>
                      <p style={{ margin: "0.5rem 0", fontWeight: "bold" }}>{q.question_text}</p>
                      {q.help_text && <p style={{ margin: "0.25rem 0", fontSize: "0.9rem", color: "var(--muted)" }}>{q.help_text}</p>}

                      {/* Show options for select/radio types */}
                      {q.options.length > 0 && (
                        <div style={{ marginTop: "0.5rem", paddingLeft: "1rem", borderLeft: "2px solid var(--border)" }}>
                          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Options:</span>
                          <ul style={{ margin: "0.25rem 0", paddingLeft: "1rem", fontSize: "0.9rem" }}>
                            {q.options.map((opt, i) => (
                              <li key={i}>
                                <strong>{opt.label}</strong>
                                {opt.description && <span style={{ color: "var(--muted)" }}> - {opt.description}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => setEditingQuestion({ ...q })}
                        style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem" }}
                      >
                        Edit
                      </button>
                      {q.is_custom && (
                        <button
                          onClick={() => handleDeleteQuestion(q.question_id)}
                          style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem", background: "#dc3545", color: "#fff", border: "none", borderRadius: "4px" }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Edit Modal */}
      {editingQuestion && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => setEditingQuestion(null)}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: "12px",
              maxWidth: "600px",
              width: "100%",
              padding: "1.5rem",
              maxHeight: "90vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Edit Question</h2>
            <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
              <code>{editingQuestion.question_key}</code>
            </p>

            <div style={{ marginBottom: "1rem" }}>
              <label>Question Text</label>
              <textarea
                value={editingQuestion.question_text}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, question_text: e.target.value })}
                rows={2}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label>Help Text</label>
              <input
                type="text"
                value={editingQuestion.help_text || ""}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, help_text: e.target.value })}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={editingQuestion.is_active}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, is_active: e.target.checked })}
                />
                Active (visible on form)
              </label>
            </div>

            {/* Edit options */}
            {editingQuestion.options.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <label>Options (labels only - values cannot be changed)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {editingQuestion.options.map((opt, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: "0.5rem", alignItems: "center" }}>
                      <code style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{opt.value}</code>
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const newOptions = [...editingQuestion.options];
                          newOptions[i] = { ...opt, label: e.target.value };
                          setEditingQuestion({ ...editingQuestion, options: newOptions });
                        }}
                        placeholder="Label"
                      />
                      <input
                        type="text"
                        value={opt.description || ""}
                        onChange={(e) => {
                          const newOptions = [...editingQuestion.options];
                          newOptions[i] = { ...opt, description: e.target.value };
                          setEditingQuestion({ ...editingQuestion, options: newOptions });
                        }}
                        placeholder="Description (optional)"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => setEditingQuestion(null)} style={{ padding: "0.5rem 1rem" }}>
                Cancel
              </button>
              <button
                onClick={handleSaveQuestion}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
