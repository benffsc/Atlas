"use client";

import { useState, useEffect, useCallback } from "react";

interface Person {
  person_id: string;
  display_name: string;
  cat_count?: number;
}

interface Cat {
  cat_id: string;
  display_name: string;
  owner_id: string | null;
  owner_name: string | null;
}

interface OwnershipTransferWizardProps {
  catId: string;
  catName: string;
  currentOwnerId?: string | null;
  currentOwnerName?: string | null;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = "select" | "confirm" | "complete";

export function OwnershipTransferWizard({
  catId,
  catName,
  currentOwnerId,
  currentOwnerName,
  onComplete,
  onCancel,
}: OwnershipTransferWizardProps) {
  const [step, setStep] = useState<Step>("select");
  const [nearbyPeople, setNearbyPeople] = useState<Person[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [includeWithOwners, setIncludeWithOwners] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load suggestions
  useEffect(() => {
    async function loadSuggestions() {
      try {
        const response = await fetch(`/api/entities/cat/${catId}/edit`);
        const data = await response.json();

        if (data.suggestions?.nearby_people) {
          setNearbyPeople(data.suggestions.nearby_people);
        }
      } catch (err) {
        console.error("Failed to load suggestions:", err);
      } finally {
        setLoading(false);
      }
    }

    loadSuggestions();
  }, [catId]);

  // Search people
  const handleSearch = useCallback(async () => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await fetch(
        `/api/people/search?q=${encodeURIComponent(searchQuery)}&limit=10`
      );
      const data = await response.json();
      setSearchResults(data.people || []);
    } catch (err) {
      console.error("Search failed:", err);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(handleSearch, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const handleSubmit = async () => {
    if (!selectedPerson) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/entities/cat/${catId}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edit_type: "ownership_transfer",
          cat_id: catId,
          new_owner_id: selectedPerson.person_id,
          relationship_type: "owner",
          reason: reason || "Ownership transfer via wizard",
          notes,
          editor_id: "current_user",
          editor_name: "Current User",
        }),
      });

      const data = await response.json();

      if (data.success) {
        setStep("complete");
      } else {
        setError(data.error || "Transfer failed");
      }
    } catch (err) {
      setError("Failed to complete transfer");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredNearbyPeople = nearbyPeople.filter((p) =>
    includeWithOwners ? true : (p.cat_count || 0) === 0
  );

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
        Transfer Ownership
      </h2>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        Transfer "{catName}" to a new owner
      </p>

      {currentOwnerName && (
        <div style={{
          padding: "0.75rem",
          background: "var(--warning-bg)",
          borderRadius: "4px",
          marginBottom: "1rem",
          fontSize: "0.9rem",
        }}>
          Current owner: <strong>{currentOwnerName}</strong>
        </div>
      )}

      {error && (
        <div style={{
          padding: "0.75rem",
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: "4px",
          marginBottom: "1rem",
          color: "var(--danger-text)",
        }}>
          {error}
        </div>
      )}

      {step === "select" && (
        <>
          {/* Search */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Search for new owner
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or phone..."
              style={{ width: "100%" }}
            />

            {searchResults.length > 0 && (
              <div style={{
                marginTop: "0.5rem",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                maxHeight: "200px",
                overflow: "auto",
              }}>
                {searchResults.map((person) => (
                  <button
                    key={person.person_id}
                    onClick={() => {
                      setSelectedPerson(person);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "0.75rem",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  >
                    {person.display_name}
                    {person.cat_count !== undefined && person.cat_count > 0 && (
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        {" "}({person.cat_count} cats)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Nearby suggestions */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}>
              <label style={{ fontWeight: 500 }}>Nearby People</label>
              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={includeWithOwners}
                  onChange={(e) => setIncludeWithOwners(e.target.checked)}
                />
                Include people with cats
              </label>
            </div>

            {loading ? (
              <div style={{ color: "var(--muted)", padding: "1rem", textAlign: "center" }}>
                Loading suggestions...
              </div>
            ) : filteredNearbyPeople.length === 0 ? (
              <div style={{
                color: "var(--muted)",
                padding: "1rem",
                textAlign: "center",
                background: "var(--section-bg)",
                borderRadius: "4px",
              }}>
                No nearby people without cats found.
                {!includeWithOwners && " Try enabling 'Include people with cats'."}
              </div>
            ) : (
              <div style={{
                display: "grid",
                gap: "0.5rem",
              }}>
                {filteredNearbyPeople.map((person) => (
                  <button
                    key={person.person_id}
                    onClick={() => setSelectedPerson(person)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: selectedPerson?.person_id === person.person_id
                        ? "var(--primary-light)"
                        : "var(--section-bg)",
                      border: selectedPerson?.person_id === person.person_id
                        ? "2px solid var(--primary)"
                        : "1px solid var(--border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{person.display_name}</span>
                    {person.cat_count !== undefined && person.cat_count > 0 && (
                      <span style={{
                        fontSize: "0.8rem",
                        padding: "0.2rem 0.5rem",
                        background: "var(--warning-bg)",
                        borderRadius: "3px",
                      }}>
                        {person.cat_count} cats
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected person */}
          {selectedPerson && (
            <div style={{
              padding: "1rem",
              background: "var(--success-bg)",
              border: "1px solid var(--success-border)",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}>
              <strong>Selected: </strong>{selectedPerson.display_name}
            </div>
          )}

          {/* Actions */}
          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1rem",
          }}>
            <button onClick={onCancel} style={{
              padding: "0.75rem 1.5rem",
              background: "transparent",
              border: "1px solid var(--border)",
            }}>
              Cancel
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={!selectedPerson}
              style={{
                padding: "0.75rem 1.5rem",
                background: selectedPerson ? "var(--primary)" : "var(--muted)",
                color: "white",
                border: "none",
                cursor: selectedPerson ? "pointer" : "not-allowed",
              }}
            >
              Continue
            </button>
          </div>
        </>
      )}

      {step === "confirm" && selectedPerson && (
        <>
          <div style={{
            padding: "1rem",
            background: "var(--section-bg)",
            borderRadius: "4px",
            marginBottom: "1.5rem",
          }}>
            <h4 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Confirm Transfer</h4>
            <p style={{ margin: 0 }}>
              Transfer <strong>{catName}</strong> from{" "}
              <strong>{currentOwnerName || "(no owner)"}</strong> to{" "}
              <strong>{selectedPerson.display_name}</strong>
            </p>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Reason for transfer
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select a reason...</option>
              <option value="Correction - wrong person linked">Correction - wrong person linked</option>
              <option value="Adoption - new owner">Adoption - new owner</option>
              <option value="Return to original owner">Return to original owner</option>
              <option value="Owner moved - new caretaker">Owner moved - new caretaker</option>
              <option value="Data entry error">Data entry error</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Additional notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context..."
              rows={3}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}>
            <button onClick={() => setStep("select")} style={{
              padding: "0.75rem 1.5rem",
              background: "transparent",
              border: "1px solid var(--border)",
            }}>
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !reason}
              style={{
                padding: "0.75rem 1.5rem",
                background: "#198754",
                color: "white",
                border: "none",
                opacity: submitting || !reason ? 0.7 : 1,
              }}
            >
              {submitting ? "Transferring..." : "Confirm Transfer"}
            </button>
          </div>
        </>
      )}

      {step === "complete" && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{
            fontSize: "3rem",
            marginBottom: "1rem",
          }}>
            ✓
          </div>
          <h3 style={{ marginBottom: "0.5rem" }}>Transfer Complete</h3>
          <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
            {catName} has been transferred to {selectedPerson?.display_name}
          </p>
          <button
            onClick={onComplete}
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--primary)",
              color: "white",
              border: "none",
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

export default OwnershipTransferWizard;
