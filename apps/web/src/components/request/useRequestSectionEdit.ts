"use client";

import { useState, useCallback, useMemo } from "react";
import { postApi } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import type { RequestDetail } from "@/app/requests/[id]/types";
import type { RequestFieldConfig, SectionCompletion } from "./types";

interface UseRequestSectionEditOptions {
  sectionId: string;
  request: RequestDetail;
  fields: RequestFieldConfig[];
  onSaved: () => Promise<void>;
}

interface UseRequestSectionEditReturn {
  isEditing: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => Promise<void>;
  fieldValues: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  completion: SectionCompletion;
}

/**
 * Extracts the current value of a request field.
 */
function getFieldValue(request: RequestDetail, key: string): unknown {
  return (request as unknown as Record<string, unknown>)[key] ?? null;
}

/**
 * Determines if a field value counts as "filled" for completion tracking.
 */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Custom hook for per-section inline editing on the request detail page.
 *
 * Each section maintains its own edit state. On save, only changed fields
 * are PATCHed to the API — not all 31+ fields.
 */
export function useRequestSectionEdit({
  sectionId,
  request,
  fields,
  onSaved,
}: UseRequestSectionEditOptions): UseRequestSectionEditReturn {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});

  // Initialize edit values from current request data
  const startEdit = useCallback(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      const val = getFieldValue(request, field.key);
      // Convert nulls to appropriate empty values for form inputs
      if (field.type === "number") {
        initial[field.key] = val ?? "";
      } else if (field.type === "boolean") {
        initial[field.key] = val ?? null;
      } else if (field.type === "checkbox-group") {
        initial[field.key] = val ?? [];
      } else {
        initial[field.key] = val ?? "";
      }
    }
    setEditValues(initial);
    setError(null);
    setIsEditing(true);
  }, [fields, request]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setError(null);
  }, []);

  const updateField = useCallback((key: string, value: unknown) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Compute whether any fields have changed
  const isDirty = useMemo(() => {
    if (!isEditing) return false;
    for (const field of fields) {
      const original = getFieldValue(request, field.key);
      const edited = editValues[field.key];
      // Normalize for comparison
      const origNorm = original ?? (field.type === "number" ? "" : field.type === "checkbox-group" ? [] : "");
      if (JSON.stringify(origNorm) !== JSON.stringify(edited)) {
        return true;
      }
    }
    return false;
  }, [isEditing, fields, request, editValues]);

  // Save only changed fields
  const saveEdit = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const original = getFieldValue(request, field.key);
        const edited = editValues[field.key];
        const origNorm = original ?? (field.type === "number" ? "" : field.type === "checkbox-group" ? [] : "");
        if (JSON.stringify(origNorm) !== JSON.stringify(edited)) {
          // Convert form values to API values
          if (field.type === "number") {
            payload[field.key] = edited === "" || edited === null ? null : Number(edited);
          } else if (field.type === "boolean") {
            payload[field.key] = edited;
          } else if (field.type === "select") {
            payload[field.key] = edited === "" ? null : edited;
          } else {
            payload[field.key] = edited === "" ? null : edited;
          }
        }
      }

      if (Object.keys(payload).length === 0) {
        setIsEditing(false);
        return;
      }

      await postApi(`/api/requests/${request.request_id}`, payload, { method: "PATCH" });
      await onSaved();
      setIsEditing(false);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [fields, request, editValues, onSaved]);

  // Current field values for rendering (edit mode uses editValues, view mode uses request)
  const fieldValues = useMemo(() => {
    if (isEditing) return editValues;
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      values[field.key] = getFieldValue(request, field.key);
    }
    return values;
  }, [isEditing, editValues, fields, request]);

  // Completion: count filled vs total visible fields
  const completion = useMemo((): SectionCompletion => {
    let filled = 0;
    let total = 0;
    for (const field of fields) {
      // Skip conditional fields whose condition isn't met
      if (field.conditional) {
        const condValue = getFieldValue(request, field.conditional.field);
        if (condValue !== field.conditional.value) continue;
      }
      total++;
      if (isFilled(getFieldValue(request, field.key))) {
        filled++;
      }
    }
    return { filled, total };
  }, [fields, request]);

  return {
    isEditing,
    startEdit,
    cancelEdit,
    saveEdit,
    fieldValues,
    updateField,
    isDirty,
    isSaving,
    error,
    completion,
  };
}
