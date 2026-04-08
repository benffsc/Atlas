"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";

interface AvailableTrapCardProps {
  equipmentId: string;
  equipmentName: string;
  onComplete: () => void;
  onCheckOut: () => void;
}

/**
 * Shown when scanning an available trap. Offers return attribution
 * instead of a dead-end "already available" error.
 */
export function AvailableTrapCard({
  equipmentId,
  equipmentName,
  onComplete,
  onCheckOut,
}: AvailableTrapCardProps) {
  const toast = useToast();
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [person, setPerson] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });

  const handleAttributeReturn = async () => {
    if (!person.display_name.trim()) return;
    setLoading(true);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "note",
        custodian_person_id: person.person_id || undefined,
        notes: `Return attributed to ${person.display_name}`,
      });
      toast.success("Return attributed");
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to attribute return");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: "12px",
        border: "2px solid var(--info-border)",
        background: "var(--info-bg)",
        padding: "1.25rem",
        animation: "fadeIn 0.2s ease-in",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <Icon name="check-circle" size={32} color="var(--success-text)" />
        <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.1rem", fontWeight: 700 }}>
          This trap is on the shelf
        </h3>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {equipmentName} is available
        </p>
      </div>

      {/* Attribution prompt */}
      {!showPicker ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: "0 0 0.75rem" }}>
            Know who brought it back?
          </p>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <Button
              variant="primary"
              size="md"
              icon="user"
              onClick={() => setShowPicker(true)}
            >
              Yes
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onComplete}
            >
              Skip
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "0.75rem",
            background: "var(--card-bg, #fff)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
          }}
        >
          <KioskPersonAutosuggest
            value={person}
            onChange={setPerson}
            placeholder="Who returned it?"
            label="Returned by"
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onClick={() => {
                setShowPicker(false);
                setPerson({ person_id: null, display_name: "", is_resolved: false });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              icon="check"
              fullWidth
              loading={loading}
              disabled={!person.display_name.trim()}
              onClick={handleAttributeReturn}
            >
              Attribute
            </Button>
          </div>
        </div>
      )}

      {/* Separator + Check Out */}
      <div
        style={{
          marginTop: "1rem",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          variant="outline"
          size="lg"
          icon="log-out"
          fullWidth
          onClick={onCheckOut}
          style={{ minHeight: "48px", borderRadius: "10px" }}
        >
          Check Out
        </Button>
      </div>
    </div>
  );
}
