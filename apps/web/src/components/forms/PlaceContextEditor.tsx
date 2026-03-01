"use client";

import { useState, useEffect, useCallback } from "react";

interface ContextType {
  context_type: string;
  display_label: string;
  description: string | null;
}

interface KnownOrganization {
  org_id: string;
  canonical_name: string;
  short_name: string | null;
  org_type: string;
  city: string | null;
}

interface Colony {
  colony_id: string;
  colony_name: string;
  status: string;
}

interface PlaceContext {
  context_id: string;
  context_type: string;
  context_label: string;
  is_verified: boolean;
  organization_name: string | null;
  known_org_id: string | null;
  known_org_name: string | null;
  colony_id: string | null;
  colony_name: string | null;
}

interface PlaceContextEditorProps {
  placeId: string;
  address?: string;
  initialContexts?: PlaceContext[];
  onContextChange?: (contexts: PlaceContext[]) => void;
  showColonyLink?: boolean;
  compact?: boolean;
}

// Icons for context types
const contextIcons: Record<string, string> = {
  organization: "🏢",
  business: "🏪",
  residential: "🏠",
  multi_unit: "🏘️",
  public_space: "🌳",
  farm_ranch: "🌾",
  colony_site: "🐱",
  feeding_station: "🍽️",
  foster_home: "💚",
  adopter_residence: "🏡",
  clinic: "🏥",
  shelter: "🏛️",
  partner_org: "🤝",
  trapper_base: "🪤",
  volunteer_location: "👋",
  trap_pickup: "📦",
};

export function PlaceContextEditor({
  placeId,
  address,
  initialContexts = [],
  onContextChange,
  showColonyLink = true,
  compact = false,
}: PlaceContextEditorProps) {
  const [contexts, setContexts] = useState<PlaceContext[]>(initialContexts);
  const [contextTypes, setContextTypes] = useState<ContextType[]>([]);
  const [organizations, setOrganizations] = useState<KnownOrganization[]>([]);
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add context form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [customOrgName, setCustomOrgName] = useState("");
  const [orgSearchQuery, setOrgSearchQuery] = useState("");

  // Create org modal
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgType, setNewOrgType] = useState("other");

  // Fetch data on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [typesRes, orgsRes, coloniesRes, contextsRes] = await Promise.all([
          fetch("/api/context-types"),
          fetch("/api/known-organizations?limit=100"),
          fetch("/api/colonies?status=active&limit=50"),
          placeId ? fetch(`/api/places/${placeId}/contexts`) : Promise.resolve(null),
        ]);

        if (typesRes.ok) {
          const data = await typesRes.json();
          setContextTypes(data.all || []);
        }

        if (orgsRes.ok) {
          const data = await orgsRes.json();
          setOrganizations(data.organizations || []);
        }

        if (coloniesRes.ok) {
          const data = await coloniesRes.json();
          setColonies(data.colonies || []);
        }

        if (contextsRes?.ok) {
          const data = await contextsRes.json();
          setContexts(data.contexts || []);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [placeId]);

  // Search organizations
  const searchOrganizations = useCallback(async (query: string) => {
    if (!query || query.length < 2) return;
    try {
      const res = await fetch(`/api/known-organizations?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data.organizations || []);
      }
    } catch (err) {
      console.error("Error searching organizations:", err);
    }
  }, []);

  // Debounced org search
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (orgSearchQuery) {
        searchOrganizations(orgSearchQuery);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [orgSearchQuery, searchOrganizations]);

  // Add context
  const handleAddContext = async () => {
    if (!selectedType) return;

    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        context_type: selectedType,
      };

      // For organization contexts, include org details
      if (selectedType === "organization" || selectedType === "business") {
        if (selectedOrgId) {
          body.known_org_id = selectedOrgId;
        } else if (customOrgName) {
          body.organization_name = customOrgName;
        }
      }

      const res = await fetch(`/api/places/${placeId}/contexts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add classification");
      }

      const newContext = await res.json();
      const updatedContexts = [...contexts, newContext];
      setContexts(updatedContexts);
      onContextChange?.(updatedContexts);

      // Reset form
      setShowAddForm(false);
      setSelectedType("");
      setSelectedOrgId("");
      setCustomOrgName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  // Remove context
  const handleRemoveContext = async (contextType: string) => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/places/${placeId}/contexts?type=${contextType}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove classification");
      }

      const updatedContexts = contexts.filter((c) => c.context_type !== contextType);
      setContexts(updatedContexts);
      onContextChange?.(updatedContexts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  };

  // Create new organization
  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/known-organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_name: newOrgName.trim(),
          org_type: newOrgType,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create organization");
      }

      const newOrg = await res.json();
      setOrganizations([newOrg, ...organizations]);
      setSelectedOrgId(newOrg.org_id);
      setShowCreateOrg(false);
      setNewOrgName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create org");
    } finally {
      setSaving(false);
    }
  };

  // Get available types (excluding already assigned)
  const assignedTypes = contexts.map((c) => c.context_type);
  const availableTypes = contextTypes.filter(
    (ct) => !assignedTypes.includes(ct.context_type)
  );

  if (loading) {
    return <div style={{ padding: "1rem", color: "#6b7280" }}>Loading...</div>;
  }

  return (
    <div
      style={{
        background: "var(--card-bg, #ffffff)",
        borderRadius: "8px",
        border: "1px solid var(--border, #e5e7eb)",
        padding: compact ? "0.75rem" : "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: compact ? "0.875rem" : "1rem" }}>
          Place Classifications
        </h3>
        {!showAddForm && availableTypes.length > 0 && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.5rem",
              background: "var(--accent, #3b82f6)",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            + Add
          </button>
        )}
      </div>

      {/* Info message */}
      <p
        style={{
          fontSize: "0.75rem",
          color: "#6b7280",
          margin: "0 0 0.75rem 0",
          fontStyle: "italic",
        }}
      >
        A place can have multiple classifications (e.g., both Organization AND Colony Site)
      </p>

      {error && (
        <div
          style={{
            padding: "0.5rem",
            marginBottom: "0.75rem",
            background: "#fef2f2",
            color: "#dc2626",
            borderRadius: "4px",
            fontSize: "0.75rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Current contexts */}
      {contexts.length === 0 ? (
        <div style={{ color: "#9ca3af", fontSize: "0.875rem", padding: "0.5rem 0" }}>
          No classifications set
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {contexts.map((ctx) => (
            <div
              key={ctx.context_id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.375rem 0.75rem",
                background: ctx.is_verified ? "#dcfce7" : "#f3f4f6",
                borderRadius: "9999px",
                fontSize: "0.8125rem",
              }}
            >
              <span>{contextIcons[ctx.context_type] || "📍"}</span>
              <span style={{ fontWeight: 500 }}>{ctx.context_label}</span>
              {ctx.known_org_name && (
                <span style={{ color: "#6b7280" }}>: {ctx.known_org_name}</span>
              )}
              {ctx.organization_name && !ctx.known_org_name && (
                <span style={{ color: "#6b7280" }}>: {ctx.organization_name}</span>
              )}
              {ctx.colony_name && (
                <span style={{ color: "#6b7280" }}>({ctx.colony_name})</span>
              )}
              {ctx.is_verified && (
                <span style={{ color: "#166534", fontSize: "0.75rem" }} title="Staff verified">
                  ✓
                </span>
              )}
              <button
                onClick={() => handleRemoveContext(ctx.context_type)}
                disabled={saving}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                  fontSize: "1rem",
                  lineHeight: 1,
                }}
                title="Remove classification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div
          style={{
            padding: "0.75rem",
            background: "#f9fafb",
            borderRadius: "6px",
            marginTop: "0.5rem",
          }}
        >
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", fontWeight: 500 }}>
              Classification Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setSelectedOrgId("");
                setCustomOrgName("");
              }}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "4px",
                border: "1px solid #d1d5db",
                fontSize: "0.875rem",
              }}
            >
              <option value="">Select a classification...</option>
              {availableTypes.map((ct) => (
                <option key={ct.context_type} value={ct.context_type}>
                  {contextIcons[ct.context_type] || "📍"} {ct.display_label}
                </option>
              ))}
            </select>
          </div>

          {/* Organization selection (for org/business types) */}
          {(selectedType === "organization" || selectedType === "business") && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Organization
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <select
                  value={selectedOrgId}
                  onChange={(e) => {
                    setSelectedOrgId(e.target.value);
                    if (e.target.value) setCustomOrgName("");
                  }}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #d1d5db",
                    fontSize: "0.875rem",
                  }}
                >
                  <option value="">Select from registry...</option>
                  {organizations.map((org) => (
                    <option key={org.org_id} value={org.org_id}>
                      {org.canonical_name}
                      {org.city && ` (${org.city})`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowCreateOrg(true)}
                  style={{
                    padding: "0.5rem",
                    background: "#f3f4f6",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                  title="Add new organization"
                >
                  + New
                </button>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <input
                  type="text"
                  placeholder="Or enter custom name..."
                  value={customOrgName}
                  onChange={(e) => {
                    setCustomOrgName(e.target.value);
                    if (e.target.value) setSelectedOrgId("");
                  }}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #d1d5db",
                    fontSize: "0.875rem",
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setShowAddForm(false);
                setSelectedType("");
                setSelectedOrgId("");
                setCustomOrgName("");
              }}
              style={{
                padding: "0.375rem 0.75rem",
                background: "transparent",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddContext}
              disabled={!selectedType || saving}
              style={{
                padding: "0.375rem 0.75rem",
                background: selectedType ? "var(--accent, #3b82f6)" : "#d1d5db",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "0.8125rem",
                cursor: selectedType ? "pointer" : "not-allowed",
              }}
            >
              {saving ? "Adding..." : "Add Classification"}
            </button>
          </div>
        </div>
      )}

      {/* Create org modal */}
      {showCreateOrg && (
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
          }}
          onClick={() => setShowCreateOrg(false)}
        >
          <div
            style={{
              background: "var(--background, #ffffff)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "400px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem 0" }}>Add Organization to Registry</h3>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Organization Name *
              </label>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="e.g., SMART Transit"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "4px",
                  border: "1px solid #d1d5db",
                }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Organization Type
              </label>
              <select
                value={newOrgType}
                onChange={(e) => setNewOrgType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "4px",
                  border: "1px solid #d1d5db",
                }}
              >
                <option value="other">Other</option>
                <option value="shelter">Shelter</option>
                <option value="rescue">Rescue</option>
                <option value="clinic">Clinic</option>
                <option value="municipal">Municipal/Government</option>
                <option value="partner">Partner Organization</option>
                <option value="business">Business</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowCreateOrg(false)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOrg}
                disabled={!newOrgName.trim() || saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: newOrgName.trim() ? "var(--accent, #3b82f6)" : "#d1d5db",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: newOrgName.trim() ? "pointer" : "not-allowed",
                }}
              >
                {saving ? "Creating..." : "Create Organization"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact badge display for place lists
export function PlaceContextBadges({ contexts }: { contexts: PlaceContext[] }) {
  if (!contexts || contexts.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
      {contexts.slice(0, 3).map((ctx) => (
        <span
          key={ctx.context_id}
          style={{
            fontSize: "0.6875rem",
            padding: "0.125rem 0.375rem",
            background: ctx.is_verified ? "#dcfce7" : "#f3f4f6",
            borderRadius: "4px",
            whiteSpace: "nowrap",
          }}
          title={ctx.context_label}
        >
          {contextIcons[ctx.context_type] || "📍"} {ctx.context_label}
        </span>
      ))}
      {contexts.length > 3 && (
        <span
          style={{
            fontSize: "0.6875rem",
            padding: "0.125rem 0.375rem",
            background: "#f3f4f6",
            borderRadius: "4px",
          }}
        >
          +{contexts.length - 3}
        </span>
      )}
    </div>
  );
}
