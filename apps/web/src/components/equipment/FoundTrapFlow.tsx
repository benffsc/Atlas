"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getCustodyStyle } from "@/lib/equipment-styles";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";

interface FoundTrapFlowProps {
  equipmentId: string;
  equipmentName: string;
  onComplete: () => void;
}

/**
 * Shown when scanning a missing trap. Offers three location options:
 * On the Shelf, In the Van, or With Someone (person picker).
 */
export function FoundTrapFlow({
  equipmentId,
  equipmentName,
  onComplete,
}: FoundTrapFlowProps) {
  const toast = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [person, setPerson] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });

  const colors = getCustodyStyle("missing");

  const handleFound = async (location: string, personId?: string | null) => {
    setLoading(location);
    try {
      await postApi(`/api/equipment/${equipmentId}/events`, {
        event_type: "found",
        custodian_person_id: personId || undefined,
        notes: location,
      });

      toast.success(`${equipmentName} marked as found`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await postApi(`/api/equipment/${equipmentId}/events`, {
              event_type: "reported_missing",
              notes: "Undo found",
            });
          },
        },
        duration: 5000,
      });

      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark as found");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      style={{
        borderRadius: "12px",
        border: `2px solid ${colors.border}`,
        background: colors.bg,
        padding: "1.25rem",
        animation: "fadeIn 0.2s ease-in",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <Icon name="search" size={32} color="var(--danger-text)" />
        <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.1rem", fontWeight: 700 }}>
          This trap was marked missing
        </h3>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          {equipmentName} — Where did you find it?
        </p>
      </div>

      {/* Location options */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <Button
          variant="primary"
          size="lg"
          icon="package"
          fullWidth
          loading={loading === "Found on shelf"}
          disabled={loading !== null && loading !== "Found on shelf"}
          onClick={() => handleFound("Found on shelf")}
          style={{
            minHeight: "56px",
            borderRadius: "12px",
            background: "var(--success-text, #16a34a)",
            color: "#fff",
            border: "1px solid transparent",
            fontSize: "1rem",
          }}
        >
          On the Shelf
        </Button>

        <Button
          variant="primary"
          size="lg"
          icon="truck"
          fullWidth
          loading={loading === "Found in van"}
          disabled={loading !== null && loading !== "Found in van"}
          onClick={() => handleFound("Found in van")}
          style={{
            minHeight: "56px",
            borderRadius: "12px",
            background: "var(--info-text, #1e40af)",
            color: "#fff",
            border: "1px solid transparent",
            fontSize: "1rem",
          }}
        >
          In the Van
        </Button>

        {!showPersonPicker ? (
          <Button
            variant="outline"
            size="lg"
            icon="user"
            fullWidth
            disabled={loading !== null}
            onClick={() => setShowPersonPicker(true)}
            style={{
              minHeight: "56px",
              borderRadius: "12px",
              fontSize: "1rem",
            }}
          >
            With Someone
          </Button>
        ) : (
          <div
            style={{
              padding: "0.75rem",
              background: "var(--card-bg, #fff)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
            }}
          >
            <PersonReferencePicker
              value={person}
              onChange={setPerson}
              placeholder="Who had it?"
              label="Found with"
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <Button
                variant="ghost"
                size="md"
                fullWidth
                onClick={() => {
                  setShowPersonPicker(false);
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
                loading={loading === "Found with person"}
                disabled={!person.display_name.trim()}
                onClick={() =>
                  handleFound(
                    `Found with ${person.display_name}`,
                    person.person_id
                  )
                }
                style={{
                  background: "var(--success-text, #16a34a)",
                  color: "#fff",
                  border: "1px solid transparent",
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
