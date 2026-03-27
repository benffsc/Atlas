"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

interface EducationMaterial {
  material_id: string;
  title: string;
  description: string | null;
  category: string;
  file_type: string;
  storage_url: string;
  file_size_bytes: number;
  is_required: boolean;
  required_for_onboarding_status: string | null;
  display_order: number;
  view_count: number;
  download_count: number;
  created_at: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

interface MaterialsData {
  materials: EducationMaterial[];
  categories: CategoryCount[];
  total: number;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  general: { label: "General Information", icon: "📚", color: "var(--text-secondary)" },
  orientation: { label: "Orientation", icon: "🎓", color: "var(--primary)" },
  trapping: { label: "Trapping Techniques", icon: "🪤", color: "var(--healthy-text)" },
  safety: { label: "Safety Guidelines", icon: "🛡️", color: "var(--critical-text)" },
  animal_care: { label: "Animal Care", icon: "🐱", color: "var(--priority-high)" },
  forms: { label: "Forms & Documents", icon: "📝", color: "#6f42c1" }, // purple — no direct CSS variable
  video: { label: "Training Videos", icon: "🎥", color: "var(--status-completed)" },
};

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: "📄",
  document: "📝",
  video: "🎥",
  image: "🖼️",
  other: "📎",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TrapperMaterialsPage() {
  const [data, setData] = useState<MaterialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.set("category", selectedCategory);

      const result = await fetchApi<MaterialsData>(`/api/trappers/materials?${params.toString()}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  // Filter by search term
  const filteredMaterials = data?.materials.filter(
    (m) =>
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.description && m.description.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  // Group by category for display
  const materialsByCategory = filteredMaterials.reduce((acc, material) => {
    const cat = material.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(material);
    return acc;
  }, {} as Record<string, EducationMaterial[]>);

  const handleView = (material: EducationMaterial) => {
    // Open in new tab
    window.open(material.storage_url, "_blank");

    // Track view (fire and forget)
    postApi(`/api/trappers/materials/${material.material_id}/track`, { action: "view" }).catch(() => { /* fire-and-forget: analytics tracking */ });
  };

  const handleDownload = async (material: EducationMaterial) => {
    // Track download (fire and forget)
    postApi(`/api/trappers/materials/${material.material_id}/track`, { action: "download" }).catch(() => { /* fire-and-forget: analytics tracking */ });

    // Download the file (external URL, use raw fetch)
    const response = await fetch(material.storage_url);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = material.title + (material.file_type === "pdf" ? ".pdf" : "");
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: "0 0 0.5rem" }}>Training Materials</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Resources and guides for FFSC trappers
        </p>
      </div>

      {/* Category filters */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setSelectedCategory(null)}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            background: selectedCategory === null ? "var(--primary)" : "var(--background)",
            color: selectedCategory === null ? "#fff" : "var(--text-primary)",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          All
        </button>
        {data?.categories.map((cat) => {
          const info = CATEGORY_LABELS[cat.category] || {
            label: cat.category,
            icon: "📁",
            color: "var(--muted)",
          };
          return (
            <button
              key={cat.category}
              onClick={() => setSelectedCategory(cat.category)}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: "20px",
                background: selectedCategory === cat.category ? info.color : "var(--background)",
                color: selectedCategory === cat.category ? "#fff" : "var(--text-primary)",
                cursor: "pointer",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              <span>{info.icon}</span>
              <span>{info.label}</span>
              <span
                style={{
                  background: selectedCategory === cat.category ? "rgba(255,255,255,0.3)" : "var(--bg-secondary)",
                  borderRadius: "10px",
                  padding: "0.1rem 0.4rem",
                  fontSize: "0.75rem",
                }}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search materials..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{
          width: "100%",
          padding: "0.75rem 1rem",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          fontSize: "1rem",
          marginBottom: "1.5rem",
        }}
      />

      {/* Loading */}
      {loading && <div className="loading">Loading materials...</div>}

      {/* Error */}
      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {filteredMaterials.length === 0 ? (
            <div className="empty">
              {searchTerm
                ? "No materials match your search."
                : "No materials available yet."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {Object.entries(materialsByCategory).map(([category, materials]) => {
                const info = CATEGORY_LABELS[category] || {
                  label: category,
                  icon: "📁",
                  color: "var(--muted)",
                };
                return (
                  <div key={category}>
                    <h2
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "1.1rem",
                        color: info.color,
                        marginBottom: "0.75rem",
                        borderBottom: `2px solid ${info.color}`,
                        paddingBottom: "0.5rem",
                      }}
                    >
                      <span>{info.icon}</span>
                      <span>{info.label}</span>
                    </h2>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                        gap: "1rem",
                      }}
                    >
                      {materials.map((material) => (
                        <div
                          key={material.material_id}
                          style={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            padding: "1rem",
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem" }}>
                            <div
                              style={{
                                fontSize: "2rem",
                                width: "48px",
                                height: "48px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "var(--section-bg)",
                                borderRadius: "8px",
                              }}
                            >
                              {FILE_TYPE_ICONS[material.file_type] || "📎"}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                }}
                              >
                                {material.title}
                                {material.is_required && (
                                  <span
                                    style={{
                                      background: "var(--critical-text)",
                                      color: "#fff",
                                      padding: "0.1rem 0.4rem",
                                      borderRadius: "4px",
                                      fontSize: "0.65rem",
                                      fontWeight: 600,
                                    }}
                                  >
                                    REQUIRED
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                                {formatFileSize(material.file_size_bytes)} • Added {formatDate(material.created_at)}
                              </div>
                            </div>
                          </div>

                          {material.description && (
                            <p
                              style={{
                                color: "var(--muted)",
                                fontSize: "0.9rem",
                                margin: "0 0 0.75rem",
                                flex: 1,
                              }}
                            >
                              {material.description}
                            </p>
                          )}

                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              onClick={() => handleView(material)}
                              style={{
                                flex: 1,
                                padding: "0.5rem",
                                background: "var(--primary)",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontWeight: 500,
                              }}
                            >
                              View
                            </button>
                            <button
                              onClick={() => handleDownload(material)}
                              style={{
                                flex: 1,
                                padding: "0.5rem",
                                background: "var(--section-bg)",
                                color: "var(--text-primary)",
                                border: "1px solid var(--border)",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontWeight: 500,
                              }}
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Required Materials Notice */}
      {data && data.materials.some((m) => m.is_required) && (
        <div
          style={{
            marginTop: "2rem",
            padding: "1rem",
            background: "var(--warning-bg)",
            borderRadius: "8px",
            border: "1px solid var(--warning-border)",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", color: "var(--warning-text)" }}>
            Required Materials
          </h3>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--warning-text)" }}>
            Some materials are marked as required for trapper onboarding.
            Please review all required materials before your orientation or training session.
          </p>
        </div>
      )}
    </div>
  );
}
