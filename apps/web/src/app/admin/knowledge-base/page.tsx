"use client";

import { useState, useEffect } from "react";

interface KnowledgeArticle {
  article_id: string;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  category: string;
  access_level: string;
  keywords: string[] | null;
  is_published: boolean;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

const CATEGORIES = [
  { value: "procedures", label: "Procedures", color: "var(--primary)" },
  { value: "training", label: "Training", color: "var(--info-text)" },
  { value: "faq", label: "FAQ", color: "var(--success-text)" },
  { value: "troubleshooting", label: "Troubleshooting", color: "var(--warning-text)" },
  { value: "talking_points", label: "Talking Points", color: "var(--danger-text)" },
  { value: "equipment", label: "Equipment", color: "var(--muted)" },
  { value: "policy", label: "Policy", color: "#9333ea" },
];

const ACCESS_LEVELS = [
  { value: "public", label: "Public", description: "Anyone (including public Tippy)" },
  { value: "volunteer", label: "Volunteer", description: "Volunteers and above" },
  { value: "staff", label: "Staff", description: "FFSC staff only" },
  { value: "admin", label: "Admin", description: "Admins only" },
];

export default function KnowledgeBasePage() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showUnpublished, setShowUnpublished] = useState(false);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [editorForm, setEditorForm] = useState({
    title: "",
    slug: "",
    summary: "",
    content: "",
    category: "procedures",
    access_level: "staff",
    keywords: "",
    is_published: true,
  });
  const [saving, setSaving] = useState(false);

  // Load articles
  const loadArticles = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCategory) params.set("category", filterCategory);
    if (showUnpublished) params.set("is_published", "false");
    params.set("limit", "100");

    const res = await fetch(`/api/knowledge?${params}`);
    if (res.ok) {
      const data = await res.json();
      setArticles(data.articles || []);
      setCategoryCounts(data.category_counts || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadArticles();
  }, [filterCategory, showUnpublished]);

  // Filter articles by search
  const filteredArticles = articles.filter((a) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(query) ||
      a.summary?.toLowerCase().includes(query) ||
      a.content.toLowerCase().includes(query) ||
      a.keywords?.some((k) => k.toLowerCase().includes(query))
    );
  });

  // Open editor for new article
  const openNewArticle = () => {
    setEditingArticle(null);
    setEditorForm({
      title: "",
      slug: "",
      summary: "",
      content: "",
      category: "procedures",
      access_level: "staff",
      keywords: "",
      is_published: true,
    });
    setShowEditor(true);
  };

  // Open editor for existing article
  const openEditArticle = async (article: KnowledgeArticle) => {
    // Fetch full article content
    const res = await fetch(`/api/knowledge/${article.article_id}`);
    if (res.ok) {
      const data = await res.json();
      const full = data.article;
      setEditingArticle(full);
      setEditorForm({
        title: full.title,
        slug: full.slug,
        summary: full.summary || "",
        content: full.content,
        category: full.category,
        access_level: full.access_level,
        keywords: full.keywords?.join(", ") || "",
        is_published: full.is_published,
      });
      setShowEditor(true);
    }
  };

  // Save article
  const handleSave = async () => {
    if (!editorForm.title || !editorForm.content || !editorForm.category) {
      alert("Title, content, and category are required");
      return;
    }

    setSaving(true);

    const payload = {
      title: editorForm.title,
      slug: editorForm.slug || undefined,
      summary: editorForm.summary || null,
      content: editorForm.content,
      category: editorForm.category,
      access_level: editorForm.access_level,
      keywords: editorForm.keywords
        ? editorForm.keywords.split(",").map((k) => k.trim()).filter(Boolean)
        : null,
      is_published: editorForm.is_published,
    };

    const res = editingArticle
      ? await fetch(`/api/knowledge/${editingArticle.article_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setSaving(false);

    if (res.ok) {
      setShowEditor(false);
      loadArticles();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to save article");
    }
  };

  // Delete article
  const handleDelete = async (articleId: string) => {
    if (!confirm("Are you sure you want to delete this article? This cannot be undone.")) {
      return;
    }

    const res = await fetch(`/api/knowledge/${articleId}`, { method: "DELETE" });
    if (res.ok) {
      loadArticles();
    } else {
      alert("Failed to delete article");
    }
  };

  // Get category config
  const getCategoryConfig = (category: string) => {
    return CATEGORIES.find((c) => c.value === category) || { label: category, color: "var(--muted)" };
  };

  if (loading && articles.length === 0) {
    return <div className="page-header"><h1>Loading...</h1></div>;
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Knowledge Base</h1>
          <p style={{ color: "var(--muted)", marginTop: "4px" }}>
            Manage procedures, training materials, FAQs, and talking points for Tippy AI
          </p>
        </div>
        <button onClick={openNewArticle} className="btn btn-primary">
          + New Article
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: "16px", padding: "16px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: "1",
              minWidth: "200px",
              padding: "8px 12px",
              border: "1px solid var(--card-border)",
              borderRadius: "6px",
              background: "var(--section-bg)",
              color: "var(--foreground)",
            }}
          />

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={() => setFilterCategory(null)}
              style={{
                padding: "6px 12px",
                background: filterCategory === null ? "var(--primary)" : "var(--section-bg)",
                color: filterCategory === null ? "var(--primary-foreground)" : "var(--foreground)",
                border: "1px solid var(--card-border)",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              All ({articles.length})
            </button>
            {CATEGORIES.map((cat) => {
              const count = categoryCounts.find((c) => c.category === cat.value)?.count || 0;
              return (
                <button
                  key={cat.value}
                  onClick={() => setFilterCategory(cat.value)}
                  style={{
                    padding: "6px 12px",
                    background: filterCategory === cat.value ? cat.color : "var(--section-bg)",
                    color: filterCategory === cat.value ? "white" : "var(--foreground)",
                    border: `1px solid ${filterCategory === cat.value ? cat.color : "var(--card-border)"}`,
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={showUnpublished}
              onChange={(e) => setShowUnpublished(e.target.checked)}
            />
            Show unpublished
          </label>
        </div>
      </div>

      {/* Articles list */}
      <div className="card">
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Access</th>
              <th>Updated</th>
              <th style={{ width: "100px" }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredArticles.map((article) => {
              const catConfig = getCategoryConfig(article.category);
              return (
                <tr key={article.article_id} style={{ opacity: article.is_published ? 1 : 0.6 }}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{article.title}</div>
                    {article.summary && (
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "2px" }}>
                        {article.summary.substring(0, 100)}...
                      </div>
                    )}
                    {!article.is_published && (
                      <span
                        style={{
                          display: "inline-block",
                          marginTop: "4px",
                          padding: "2px 6px",
                          fontSize: "0.7rem",
                          background: "var(--warning-bg)",
                          color: "var(--warning-text)",
                          borderRadius: "3px",
                        }}
                      >
                        Draft
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        padding: "4px 8px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        background: `${catConfig.color}20`,
                        color: catConfig.color,
                        borderRadius: "4px",
                      }}
                    >
                      {catConfig.label}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.85rem", textTransform: "capitalize" }}>
                    {article.access_level}
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {new Date(article.updated_at).toLocaleDateString()}
                    {article.updated_by_name && (
                      <div style={{ fontSize: "0.75rem" }}>by {article.updated_by_name}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => openEditArticle(article)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--primary)",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(article.article_id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--danger-text)",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredArticles.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: "40px" }}>
                  {searchQuery
                    ? `No articles found matching "${searchQuery}"`
                    : "No articles yet. Create one to get started."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Editor Modal */}
      {showEditor && (
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
            padding: "20px",
          }}
          onClick={(e) => e.target === e.currentTarget && setShowEditor(false)}
        >
          <div
            className="card"
            style={{
              width: "900px",
              maxWidth: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              {editingArticle ? "Edit Article" : "New Article"}
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Title *</label>
                <input
                  type="text"
                  value={editorForm.title}
                  onChange={(e) => setEditorForm({ ...editorForm, title: e.target.value })}
                  placeholder="Article title"
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Slug (URL-friendly)</label>
                <input
                  type="text"
                  value={editorForm.slug}
                  onChange={(e) => setEditorForm({ ...editorForm, slug: e.target.value })}
                  placeholder="auto-generated-from-title"
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Summary</label>
              <input
                type="text"
                value={editorForm.summary}
                onChange={(e) => setEditorForm({ ...editorForm, summary: e.target.value })}
                placeholder="Short description for search results"
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: "4px",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  background: "var(--section-bg)",
                  color: "var(--foreground)",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "16px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Category *</label>
                <select
                  value={editorForm.category}
                  onChange={(e) => setEditorForm({ ...editorForm, category: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Access Level</label>
                <select
                  value={editorForm.access_level}
                  onChange={(e) => setEditorForm({ ...editorForm, access_level: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                >
                  {ACCESS_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label} - {level.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Keywords</label>
                <input
                  type="text"
                  value={editorForm.keywords}
                  onChange={(e) => setEditorForm({ ...editorForm, keywords: e.target.value })}
                  placeholder="Comma-separated keywords"
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "4px",
                    border: "1px solid var(--card-border)",
                    borderRadius: "4px",
                    background: "var(--section-bg)",
                    color: "var(--foreground)",
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Content * (Markdown supported)</label>
              <textarea
                value={editorForm.content}
                onChange={(e) => setEditorForm({ ...editorForm, content: e.target.value })}
                placeholder="Article content in markdown format..."
                rows={15}
                style={{
                  width: "100%",
                  padding: "12px",
                  marginTop: "4px",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  background: "var(--section-bg)",
                  color: "var(--foreground)",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ marginTop: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={editorForm.is_published}
                  onChange={(e) => setEditorForm({ ...editorForm, is_published: e.target.checked })}
                />
                <span style={{ fontSize: "0.9rem" }}>Published (visible to users based on access level)</span>
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "24px" }}>
              <button onClick={() => setShowEditor(false)} className="btn">
                Cancel
              </button>
              <button onClick={handleSave} className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : editingArticle ? "Save Changes" : "Create Article"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
