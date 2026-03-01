"use client";

import { useState, useCallback, ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface EditableSectionProps {
  title: string;
  entityType: "person" | "cat" | "place" | "request";
  entityId: string;
  children: ReactNode;
  editContent?: ReactNode;
  onSave?: (edits: EditPayload[]) => Promise<void>;
  onCancel?: () => void;
  isEditing?: boolean;
  setIsEditing?: (editing: boolean) => void;
  canEdit?: boolean;
  requiresWizard?: boolean;
  wizardComponent?: ReactNode;
}

interface EditPayload {
  field: string;
  value: unknown;
  reason?: string;
}

export function EditableSection({
  title,
  entityType,
  entityId,
  children,
  editContent,
  onSave,
  onCancel,
  isEditing: externalIsEditing,
  setIsEditing: externalSetIsEditing,
  canEdit = true,
  requiresWizard = false,
  wizardComponent,
}: EditableSectionProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const { user } = useCurrentUser();

  const isEditing = externalIsEditing ?? internalIsEditing;
  const setIsEditing = externalSetIsEditing ?? setInternalIsEditing;

  // Use authenticated user ID or fallback for audit trail
  const userId = user?.staff_id || "anonymous";
  const userName = user?.display_name || "Anonymous User";

  const handleEditClick = useCallback(async () => {
    if (requiresWizard) {
      setShowWizard(true);
      return;
    }

    // Try to acquire lock
    try {
      const response = await fetch(`/api/entities/${entityType}/${entityId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          user_name: userName,
          reason: `Editing ${title}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setIsEditing(true);
        setError(null);
      } else {
        setError(data.error || "Could not acquire edit lock");
      }
    } catch (err) {
      setError("Failed to start editing");
    }
  }, [entityType, entityId, title, requiresWizard, setIsEditing, userId, userName]);

  const handleCancelClick = useCallback(async () => {
    // Release lock
    try {
      await fetch(`/api/entities/${entityType}/${entityId}/edit?user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
    } catch {
      // Ignore errors on lock release
    }

    setIsEditing(false);
    setError(null);
    onCancel?.();
  }, [entityType, entityId, setIsEditing, onCancel, userId]);

  const handleSaveClick = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    setError(null);

    try {
      // onSave should handle the actual API call
      await onSave([]);

      // Release lock after save
      await fetch(`/api/entities/${entityType}/${entityId}/edit?user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });

      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [entityType, entityId, onSave, setIsEditing, userId]);

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1rem",
      }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {canEdit && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {isEditing ? (
              <>
                <button
                  onClick={handleCancelClick}
                  style={{
                    padding: "0.4rem 0.8rem",
                    fontSize: "0.85rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveClick}
                  disabled={isSaving}
                  style={{
                    padding: "0.4rem 0.8rem",
                    fontSize: "0.85rem",
                    background: "var(--primary)",
                    color: "white",
                    border: "none",
                    opacity: isSaving ? 0.7 : 1,
                  }}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={handleEditClick}
                style={{
                  padding: "0.4rem 0.8rem",
                  fontSize: "0.85rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{
          padding: "0.75rem",
          marginBottom: "1rem",
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: "4px",
          color: "var(--danger-text)",
          fontSize: "0.9rem",
        }}>
          {error}
        </div>
      )}

      {isEditing && editContent ? editContent : children}

      {showWizard && wizardComponent && (
        <div style={{
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
        }}>
          <div style={{
            background: "var(--card-bg)",
            borderRadius: "8px",
            maxWidth: "600px",
            width: "90%",
            maxHeight: "90vh",
            overflow: "auto",
          }}>
            {wizardComponent}
            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setShowWizard(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// EditableField - Inline editable field
interface EditableFieldProps {
  label: string;
  value: string | number | null | undefined;
  field: string;
  type?: "text" | "number" | "email" | "tel" | "textarea" | "select";
  options?: Array<{ value: string; label: string }>;
  isEditing: boolean;
  onChange: (field: string, value: string | number) => void;
  required?: boolean;
  placeholder?: string;
}

export function EditableField({
  label,
  value,
  field,
  type = "text",
  options,
  isEditing,
  onChange,
  required = false,
  placeholder,
}: EditableFieldProps) {
  if (!isEditing) {
    return (
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{
          display: "block",
          fontSize: "0.8rem",
          color: "var(--muted)",
          marginBottom: "0.25rem",
        }}>
          {label}
        </label>
        <span style={{ fontWeight: 500 }}>
          {value || <span style={{ color: "var(--muted)" }}>Not set</span>}
        </span>
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{
          display: "block",
          fontSize: "0.8rem",
          marginBottom: "0.25rem",
        }}>
          {label} {required && <span style={{ color: "var(--danger-text)" }}>*</span>}
        </label>
        <textarea
          value={value || ""}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ width: "100%" }}
        />
      </div>
    );
  }

  if (type === "select" && options) {
    return (
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{
          display: "block",
          fontSize: "0.8rem",
          marginBottom: "0.25rem",
        }}>
          {label} {required && <span style={{ color: "var(--danger-text)" }}>*</span>}
        </label>
        <select
          value={value || ""}
          onChange={(e) => onChange(field, e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{
        display: "block",
        fontSize: "0.8rem",
        marginBottom: "0.25rem",
      }}>
        {label} {required && <span style={{ color: "var(--danger-text)" }}>*</span>}
      </label>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(field, type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%" }}
      />
    </div>
  );
}

export default EditableSection;
