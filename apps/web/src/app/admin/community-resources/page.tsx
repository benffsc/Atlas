"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { COLORS, TYPOGRAPHY } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommunityResource {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  phone: string | null;
  address: string | null;
  hours: string | null;
  website_url: string | null;
  scrape_url: string | null;
  icon: string;
  urgency: string;
  display_order: number;
  is_active: boolean;
  last_verified_at: string | null;
  last_verified_by: string | null;
  verify_by: string | null;
  county_served: string | null;
  region: string | null;
  priority: number | null;
}

interface ResourceFormState {
  name: string;
  county_served: string;
  phone: string;
  address: string;
  website_url: string;
  description: string;
  category: string;
  hours: string;
  is_active: boolean;
}

const EMPTY_FORM: ResourceFormState = {
  name: "",
  county_served: "",
  phone: "",
  address: "",
  website_url: "",
  description: "",
  category: "",
  hours: "",
  is_active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Shared input style
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: TYPOGRAPHY.size.sm,
  background: "var(--background, #fff)",
  color: "var(--text-primary, #111827)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 500,
  marginBottom: "0.25rem",
  fontSize: TYPOGRAPHY.size.sm,
  color: "var(--text-secondary, #6b7280)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommunityResourcesPage() {
  const toast = useToast();

  // Data
  const [resources, setResources] = useState<CommunityResource[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter
  const [countyFilter, setCountyFilter] = useState<string>("all");

  // Accordion: expanded county groups
  const [expandedCounties, setExpandedCounties] = useState<Set<string>>(
    new Set()
  );

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingResource, setEditingResource] =
    useState<CommunityResource | null>(null);
  const [form, setForm] = useState<ResourceFormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<CommunityResource | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  // Toggle active loading tracker
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{
        resources: CommunityResource[];
        counties: string[];
      }>("/api/admin/community-resources");
      setResources(data.resources || []);
      setCounties(data.counties || []);
      // Expand all counties by default on first load
      setExpandedCounties((prev) => {
        if (prev.size === 0) {
          const allCounties = new Set(
            (data.resources || [])
              .map((r) => r.county_served || "Uncategorized")
          );
          return allCounties;
        }
        return prev;
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fetch resources"
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Grouped data
  // -------------------------------------------------------------------------

  const grouped = useMemo(() => {
    const filtered =
      countyFilter === "all"
        ? resources
        : resources.filter(
            (r) => (r.county_served || "Uncategorized") === countyFilter
          );

    const groups: Record<string, CommunityResource[]> = {};
    for (const r of filtered) {
      const key = r.county_served || "Uncategorized";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    // Sort county keys alphabetically, but "statewide" first, "Uncategorized" last
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a.toLowerCase() === "statewide") return -1;
      if (b.toLowerCase() === "statewide") return 1;
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map((county) => ({
      county,
      resources: groups[county],
    }));
  }, [resources, countyFilter]);

  // -------------------------------------------------------------------------
  // Drawer: Add / Edit
  // -------------------------------------------------------------------------

  function openAdd() {
    setEditingResource(null);
    setForm({ ...EMPTY_FORM });
    setDrawerOpen(true);
  }

  function openEdit(resource: CommunityResource) {
    setEditingResource(resource);
    setForm({
      name: resource.name,
      county_served: resource.county_served || "",
      phone: resource.phone || "",
      address: resource.address || "",
      website_url: resource.website_url || "",
      description: resource.description || "",
      category: resource.category || "",
      hours: resource.hours || "",
      is_active: resource.is_active,
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingResource(null);
    setForm({ ...EMPTY_FORM });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSaving(true);
    try {
      if (editingResource) {
        await postApi("/api/admin/community-resources", {
          id: editingResource.id,
          name: form.name.trim(),
          county_served: form.county_served || null,
          phone: form.phone || null,
          address: form.address || null,
          website_url: form.website_url || null,
          description: form.description || null,
          category: form.category || null,
          hours: form.hours || null,
          is_active: form.is_active,
        }, { method: "PATCH" });
        toast.success("Resource updated");
      } else {
        await postApi("/api/admin/community-resources", {
          name: form.name.trim(),
          county_served: form.county_served || null,
          phone: form.phone || null,
          address: form.address || null,
          website_url: form.website_url || null,
          description: form.description || null,
          category: form.category || null,
          hours: form.hours || null,
          is_active: form.is_active,
        });
        toast.success("Resource created");
      }
      closeDrawer();
      fetchData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save resource"
      );
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Toggle is_active inline
  // -------------------------------------------------------------------------

  async function handleToggleActive(resource: CommunityResource) {
    setTogglingId(resource.id);
    try {
      await postApi("/api/admin/community-resources", {
        id: resource.id,
        is_active: !resource.is_active,
      }, { method: "PATCH" });
      // Optimistic update
      setResources((prev) =>
        prev.map((r) =>
          r.id === resource.id ? { ...r, is_active: !r.is_active } : r
        )
      );
      toast.success(
        `${resource.name} ${!resource.is_active ? "activated" : "deactivated"}`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to toggle status"
      );
    } finally {
      setTogglingId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchApi(
        `/api/admin/community-resources?id=${deleteTarget.id}`,
        { method: "DELETE" }
      );
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete resource"
      );
    } finally {
      setDeleting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Accordion toggle
  // -------------------------------------------------------------------------

  function toggleCounty(county: string) {
    setExpandedCounties((prev) => {
      const next = new Set(prev);
      if (next.has(county)) {
        next.delete(county);
      } else {
        next.add(county);
      }
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // County options for the dropdown (existing + typed)
  // -------------------------------------------------------------------------

  const allCountyOptions = useMemo(() => {
    const set = new Set(counties);
    // Include the current form county_served if it was typed in
    if (form.county_served && !set.has(form.county_served)) {
      set.add(form.county_served);
    }
    return [...set].sort();
  }, [counties, form.county_served]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: TYPOGRAPHY.size["2xl"] }}>
            Community Resources
          </h1>
          <p
            style={{
              color: COLORS.textSecondary,
              margin: "0.25rem 0 0",
              fontSize: TYPOGRAPHY.size.sm,
            }}
          >
            Manage resources shown in out-of-area emails by county
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={openAdd}>
          Add Resource
        </Button>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.25rem",
        }}
      >
        <label
          style={{
            fontSize: TYPOGRAPHY.size.sm,
            fontWeight: 500,
            color: COLORS.textSecondary,
            whiteSpace: "nowrap",
          }}
        >
          Filter by county:
        </label>
        <select
          value={countyFilter}
          onChange={(e) => setCountyFilter(e.target.value)}
          style={{
            padding: "0.375rem 0.75rem",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "6px",
            fontSize: TYPOGRAPHY.size.sm,
            background: "var(--background, #fff)",
            color: "var(--text-primary, #111827)",
            minWidth: 160,
          }}
        >
          <option value="all">All counties ({resources.length})</option>
          {counties.map((c) => {
            const count = resources.filter(
              (r) => (r.county_served || "Uncategorized") === c
            ).length;
            return (
              <option key={c} value={c}>
                {c} ({count})
              </option>
            );
          })}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No community resources"
          description={
            countyFilter !== "all"
              ? `No resources found for "${countyFilter}"`
              : "Add your first community resource to get started"
          }
          variant={countyFilter !== "all" ? "filtered" : "default"}
          action={
            countyFilter !== "all"
              ? { label: "Clear filter", onClick: () => setCountyFilter("all") }
              : { label: "Add Resource", onClick: openAdd }
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {grouped.map(({ county, resources: countyResources }) => {
            const isExpanded = expandedCounties.has(county);
            const activeCount = countyResources.filter(
              (r) => r.is_active
            ).length;

            return (
              <div
                key={county}
                style={{
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                {/* County header / accordion trigger */}
                <button
                  onClick={() => toggleCounty(county)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    background: "var(--bg-secondary, #f9fafb)",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontSize: TYPOGRAPHY.size.xs,
                      color: COLORS.textSecondary,
                      transition: "transform 150ms ease",
                      transform: isExpanded
                        ? "rotate(90deg)"
                        : "rotate(0deg)",
                      display: "inline-block",
                    }}
                  >
                    &#9654;
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: TYPOGRAPHY.size.sm,
                      color: "var(--text-primary, #111827)",
                    }}
                  >
                    {county}
                  </span>
                  <span
                    style={{
                      fontSize: TYPOGRAPHY.size.xs,
                      background: "var(--primary, #3b82f6)",
                      color: "#fff",
                      borderRadius: "10px",
                      padding: "0.125rem 0.5rem",
                      fontWeight: 500,
                    }}
                  >
                    {countyResources.length}
                  </span>
                  <span
                    style={{
                      fontSize: TYPOGRAPHY.size.xs,
                      color: COLORS.textSecondary,
                      marginLeft: "auto",
                    }}
                  >
                    {activeCount} active
                  </span>
                </button>

                {/* Expandable table */}
                {isExpanded && (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: "1px solid var(--border, #e5e7eb)",
                          }}
                        >
                          <th style={thStyle}>Name</th>
                          <th style={thStyle}>Phone</th>
                          <th style={thStyle}>Address</th>
                          <th style={thStyle}>Website</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>
                            Active
                          </th>
                          <th style={thStyle}>Verified</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {countyResources.map((resource) => (
                          <tr
                            key={resource.id}
                            style={{
                              borderBottom:
                                "1px solid var(--border, #e5e7eb)",
                              opacity: resource.is_active ? 1 : 0.55,
                            }}
                          >
                            <td style={tdStyle}>
                              <div style={{ fontWeight: 500 }}>
                                {resource.name}
                              </div>
                              {resource.category && (
                                <div
                                  style={{
                                    fontSize: TYPOGRAPHY.size.xs,
                                    color: COLORS.textSecondary,
                                    marginTop: "0.125rem",
                                  }}
                                >
                                  {resource.category}
                                </div>
                              )}
                            </td>
                            <td style={tdStyle}>
                              <span
                                style={{
                                  fontSize: TYPOGRAPHY.size.sm,
                                  color: resource.phone
                                    ? "var(--text-primary)"
                                    : COLORS.textMuted,
                                }}
                              >
                                {resource.phone || "--"}
                              </span>
                            </td>
                            <td style={tdStyle}>
                              <span
                                style={{
                                  fontSize: TYPOGRAPHY.size.sm,
                                  maxWidth: 200,
                                  display: "inline-block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  color: resource.address
                                    ? "var(--text-primary)"
                                    : COLORS.textMuted,
                                }}
                                title={resource.address || undefined}
                              >
                                {resource.address || "--"}
                              </span>
                            </td>
                            <td style={tdStyle}>
                              {resource.website_url ? (
                                <a
                                  href={resource.website_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: TYPOGRAPHY.size.sm,
                                    color: COLORS.primary,
                                    textDecoration: "none",
                                    maxWidth: 180,
                                    display: "inline-block",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={resource.website_url}
                                >
                                  {(() => {
                                    try {
                                      return new URL(resource.website_url!).hostname.replace(
                                        /^www\./,
                                        ""
                                      );
                                    } catch {
                                      return resource.website_url;
                                    }
                                  })()}
                                </a>
                              ) : (
                                <span style={{ color: COLORS.textMuted }}>
                                  --
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              <button
                                onClick={() => handleToggleActive(resource)}
                                disabled={togglingId === resource.id}
                                title={
                                  resource.is_active
                                    ? "Click to deactivate"
                                    : "Click to activate"
                                }
                                style={{
                                  width: 36,
                                  height: 20,
                                  borderRadius: 10,
                                  border: "none",
                                  cursor:
                                    togglingId === resource.id
                                      ? "not-allowed"
                                      : "pointer",
                                  background: resource.is_active
                                    ? COLORS.success
                                    : COLORS.gray300,
                                  position: "relative",
                                  transition: "background 150ms ease",
                                  opacity:
                                    togglingId === resource.id ? 0.6 : 1,
                                }}
                              >
                                <span
                                  style={{
                                    display: "block",
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    background: "#fff",
                                    position: "absolute",
                                    top: 2,
                                    left: resource.is_active ? 18 : 2,
                                    transition: "left 150ms ease",
                                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                                  }}
                                />
                              </button>
                            </td>
                            <td style={tdStyle}>
                              <span
                                style={{
                                  fontSize: TYPOGRAPHY.size.xs,
                                  color: resource.last_verified_at
                                    ? COLORS.textSecondary
                                    : COLORS.textMuted,
                                }}
                              >
                                {formatDate(resource.last_verified_at)}
                              </span>
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                textAlign: "right",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: "0.375rem",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <Button
                                  variant="outline"
                                  size="sm"
                                  icon="pencil"
                                  onClick={() => openEdit(resource)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  icon="trash-2"
                                  onClick={() => setDeleteTarget(resource)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Add / Edit Drawer                                                 */}
      {/* ----------------------------------------------------------------- */}
      <ActionDrawer
        isOpen={drawerOpen}
        onClose={closeDrawer}
        title={editingResource ? "Edit Resource" : "Add Resource"}
        width="md"
        footer={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="secondary" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!form.name.trim()}
            >
              {editingResource ? "Save Changes" : "Create Resource"}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>
              Name <span style={{ color: COLORS.error }}>*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Sonoma County Animal Services"
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* County */}
          <div>
            <label style={labelStyle}>County Served</label>
            <input
              list="county-options"
              value={form.county_served}
              onChange={(e) =>
                setForm({ ...form, county_served: e.target.value })
              }
              placeholder="Type or select a county (e.g., Sonoma)"
              style={inputStyle}
            />
            <datalist id="county-options">
              {allCountyOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.textMuted,
              }}
            >
              Type a new county name to add it, or select an existing one
            </p>
          </div>

          {/* Category */}
          <div>
            <label style={labelStyle}>Category</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g., Animal Control, Low-Cost Vet"
              style={inputStyle}
            />
          </div>

          {/* Phone */}
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(707) 555-1234"
              style={inputStyle}
            />
          </div>

          {/* Address */}
          <div>
            <label style={labelStyle}>Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Main St, Santa Rosa, CA"
              style={inputStyle}
            />
          </div>

          {/* Website URL */}
          <div>
            <label style={labelStyle}>Website URL</label>
            <input
              type="url"
              value={form.website_url}
              onChange={(e) =>
                setForm({ ...form, website_url: e.target.value })
              }
              placeholder="https://example.org"
              style={inputStyle}
            />
          </div>

          {/* Hours */}
          <div>
            <label style={labelStyle}>Hours</label>
            <input
              type="text"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              placeholder="Mon-Fri 8am-5pm"
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Brief description of services offered..."
              rows={3}
              style={{
                ...inputStyle,
                resize: "vertical",
              }}
            />
          </div>

          {/* Is Active */}
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                fontSize: TYPOGRAPHY.size.sm,
              }}
            >
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span style={{ fontWeight: 500 }}>Active</span>
              <span style={{ color: COLORS.textMuted, fontSize: TYPOGRAPHY.size.xs }}>
                (inactive resources are hidden from emails)
              </span>
            </label>
          </div>
        </div>
      </ActionDrawer>

      {/* ----------------------------------------------------------------- */}
      {/* Delete Confirmation                                               */}
      {/* ----------------------------------------------------------------- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete resource?"
        message={`This will permanently delete "${deleteTarget?.name}". This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table cell styles
// ---------------------------------------------------------------------------

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  fontSize: TYPOGRAPHY.size.xs,
  fontWeight: 600,
  color: COLORS.textSecondary,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  fontSize: TYPOGRAPHY.size.sm,
};
