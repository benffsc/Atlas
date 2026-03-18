"use client";

import { useState, useEffect, useRef } from "react";
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
  is_active: boolean;
  view_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

const CATEGORIES = [
  { value: "general", label: "General Information", icon: "📚" },
  { value: "orientation", label: "Orientation", icon: "🎓" },
  { value: "trapping", label: "Trapping Techniques", icon: "🪤" },
  { value: "safety", label: "Safety Guidelines", icon: "🛡️" },
  { value: "animal_care", label: "Animal Care", icon: "🐱" },
  { value: "forms", label: "Forms & Documents", icon: "📝" },
  { value: "video", label: "Training Videos", icon: "🎥" },
];

const ONBOARDING_STATUSES = [
  { value: "", label: "Not tied to onboarding" },
  { value: "interested", label: "Before first contact" },
  { value: "contacted", label: "Before orientation scheduled" },
  { value: "orientation_scheduled", label: "Before orientation" },
  { value: "orientation_complete", label: "Before training scheduled" },
  { value: "training_scheduled", label: "Before training" },
  { value: "training_complete", label: "Before contract" },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EducationMaterialsAdminPage() {
  const [materials, setMaterials] = useState<EducationMaterial[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<EducationMaterial | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    title: "",
    description: "",
    category: "general",
    is_required: false,
    required_for_onboarding_status: "",
    display_order: 0,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("include_inactive", "true");
      if (selectedCategory) params.set("category", selectedCategory);

      const data = await fetchApi<{ materials: EducationMaterial[]; categories: CategoryCount[] }>(`/api/trappers/materials?${params.toString()}`);
      setMaterials(data.materials || []);
      setCategories(data.categories || []);
    } catch (err) {
      console.error("Failed to fetch materials:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, [selectedCategory]);

  const resetUploadForm = () => {
    setUploadForm({
      title: "",
      description: "",
      category: "general",
      is_required: false,
      required_for_onboarding_status: "",
      display_order: 0,
    });
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Auto-fill title from filename
      if (!uploadForm.title) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setUploadForm({ ...uploadForm, title: nameWithoutExt });
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadForm.title) {
      setMessage({ type: "error", text: "Please select a file and enter a title" });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", uploadForm.title);
      formData.append("description", uploadForm.description);
      formData.append("category", uploadForm.category);
      formData.append("is_required", String(uploadForm.is_required));
      formData.append("required_for_onboarding_status", uploadForm.required_for_onboarding_status);
      formData.append("display_order", String(uploadForm.display_order));

      const response = await fetch("/api/trappers/materials", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: "Material uploaded successfully!" });
        fetchMaterials();
        setTimeout(() => {
          setShowUploadModal(false);
          resetUploadForm();
          setMessage(null);
        }, 1500);
      } else {
        setMessage({ type: "error", text: data.error || "Upload failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const updateMaterial = async (materialId: string, updates: Partial<EducationMaterial>) => {
    try {
      await postApi("/api/trappers/materials", { material_id: materialId, ...updates }, { method: "PATCH" });
      fetchMaterials();
      setEditingMaterial(null);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const toggleActive = async (material: EducationMaterial) => {
    await updateMaterial(material.material_id, { is_active: !material.is_active });
  };

  const getCategoryInfo = (category: string) => {
    return CATEGORIES.find((c) => c.value === category) || { label: category, icon: "📁" };
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Training Materials</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Upload and manage trapper education resources
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          style={{
            padding: "0.5rem 1rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span>+</span> Upload Material
        </button>
      </div>

      {/* Category Filter */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button
          onClick={() => setSelectedCategory(null)}
          style={{
            padding: "0.375rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            background: selectedCategory === null ? "#0d6efd" : "#fff",
            color: selectedCategory === null ? "#fff" : "var(--text-primary)",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          All ({materials.length})
        </button>
        {categories.map((cat) => {
          const info = getCategoryInfo(cat.category);
          return (
            <button
              key={cat.category}
              onClick={() => setSelectedCategory(cat.category)}
              style={{
                padding: "0.375rem 0.75rem",
                border: "1px solid var(--border)",
                borderRadius: "20px",
                background: selectedCategory === cat.category ? "#0d6efd" : "#fff",
                color: selectedCategory === cat.category ? "#fff" : "var(--text-primary)",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              {info.icon} {info.label} ({cat.count})
            </button>
          );
        })}
      </div>

      {/* Materials List */}
      {loading ? (
        <div className="loading">Loading materials...</div>
      ) : materials.length === 0 ? (
        <div className="empty">
          No materials found. Upload your first training resource to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {materials.map((material) => {
            const catInfo = getCategoryInfo(material.category);
            return (
              <div
                key={material.material_id}
                className="card"
                style={{
                  padding: "1rem",
                  opacity: material.is_active ? 1 : 0.6,
                  display: "flex",
                  gap: "1rem",
                  alignItems: "flex-start",
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    background: "#f0f0f0",
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.5rem",
                    flexShrink: 0,
                  }}
                >
                  {catInfo.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>{material.title}</h3>
                    {material.is_required && (
                      <span
                        style={{
                          background: "#dc3545",
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
                    {!material.is_active && (
                      <span
                        style={{
                          background: "#6c757d",
                          color: "#fff",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.65rem",
                        }}
                      >
                        INACTIVE
                      </span>
                    )}
                  </div>

                  {material.description && (
                    <p style={{ color: "var(--muted)", margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                      {material.description}
                    </p>
                  )}

                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                    <span>{formatFileSize(material.file_size_bytes)}</span>
                    <span>{material.view_count} views</span>
                    <span>{material.download_count} downloads</span>
                    {material.required_for_onboarding_status && (
                      <span style={{ color: "#0d6efd" }}>
                        Required before: {material.required_for_onboarding_status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <a
                    href={material.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "#e0f2fe",
                      color: "#0369a1",
                      textDecoration: "none",
                      borderRadius: "4px",
                      fontSize: "0.875rem",
                    }}
                  >
                    View
                  </a>
                  <button
                    onClick={() => setEditingMaterial(material)}
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: "var(--section-bg)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(material)}
                    style={{
                      padding: "0.375rem 0.75rem",
                      background: material.is_active ? "#fff3cd" : "#d1fae5",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                    }}
                  >
                    {material.is_active ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowUploadModal(false);
              resetUploadForm();
            }
          }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "600px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ margin: 0 }}>Upload Training Material</h2>
            </div>

            <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
              {message && (
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "6px",
                    background: message.type === "success" ? "#d1fae5" : "#fee2e2",
                    color: message.type === "success" ? "#065f46" : "#dc2626",
                  }}
                >
                  {message.text}
                </div>
              )}

              {/* File Upload */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  File <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.mp4,.mov,.webm,.jpg,.jpeg,.png,.gif"
                  onChange={handleFileSelect}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
                {selectedFile && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Title <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  placeholder="Trapper Orientation Guide"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Description
                </label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  rows={2}
                  placeholder="Brief description of the material"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              {/* Category */}
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Category
                </label>
                <select
                  value={uploadForm.category}
                  onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.icon} {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Required for Onboarding */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={uploadForm.is_required}
                      onChange={(e) => setUploadForm({ ...uploadForm, is_required: e.target.checked })}
                    />
                    <span style={{ fontWeight: 500 }}>Required for trappers</span>
                  </label>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Required Before Status
                  </label>
                  <select
                    value={uploadForm.required_for_onboarding_status}
                    onChange={(e) => setUploadForm({ ...uploadForm, required_for_onboarding_status: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                    }}
                  >
                    {ONBOARDING_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
              }}
            >
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  resetUploadForm();
                }}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--section-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !uploadForm.title}
                style={{
                  padding: "0.5rem 1rem",
                  background: uploading ? "#6c757d" : "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingMaterial && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingMaterial(null);
          }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "500px",
              padding: "1.5rem",
            }}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Edit Material</h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Title</label>
                <input
                  type="text"
                  defaultValue={editingMaterial.title}
                  id="edit-title"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Description</label>
                <textarea
                  defaultValue={editingMaterial.description || ""}
                  id="edit-description"
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Category</label>
                <select
                  defaultValue={editingMaterial.category}
                  id="edit-category"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    defaultChecked={editingMaterial.is_required}
                    id="edit-required"
                  />
                  <span>Required for trappers</span>
                </label>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>Display Order</label>
                <input
                  type="number"
                  defaultValue={editingMaterial.display_order}
                  id="edit-order"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button
                onClick={() => setEditingMaterial(null)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--section-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const title = (document.getElementById("edit-title") as HTMLInputElement).value;
                  const description = (document.getElementById("edit-description") as HTMLTextAreaElement).value;
                  const category = (document.getElementById("edit-category") as HTMLSelectElement).value;
                  const is_required = (document.getElementById("edit-required") as HTMLInputElement).checked;
                  const display_order = parseInt((document.getElementById("edit-order") as HTMLInputElement).value, 10);

                  updateMaterial(editingMaterial.material_id, {
                    title,
                    description,
                    category,
                    is_required,
                    display_order,
                  });
                }}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
