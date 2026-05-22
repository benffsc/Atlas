"use client";

import { Suspense, useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { TabBar, TabPanel } from "@/components/ui/TabBar";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Icon } from "@/components/ui/Icon";
import { EmptyList } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";

interface Meeting {
  meeting_id: string;
  title: string;
  meeting_date: string | null;
  status: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Slide {
  slide_id: string;
  slide_type: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  image_caption: string | null;
  background_style: string;
  custom_data: Record<string, unknown>;
  display_order: number;
  is_from_library: boolean;
  library_slide_id: string | null;
}

interface LibrarySlide {
  library_slide_id: string;
  name: string;
  category: string;
  slide_type: string;
  title: string | null;
  body: string | null;
}

const SLIDE_TYPE_ICONS: Record<string, string> = {
  title: "type",
  content: "file-text",
  stats: "bar-chart-3",
  photo: "image",
  two_column: "columns",
  quote: "quote",
};

const SLIDE_TYPES = [
  { id: "title", label: "Title" },
  { id: "content", label: "Content" },
  { id: "stats", label: "Stats" },
  { id: "photo", label: "Photo" },
  { id: "two_column", label: "Two Column" },
  { id: "quote", label: "Quote" },
];

const BG_STYLES = [
  { id: "default", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "accent", label: "Accent" },
  { id: "photo_bg", label: "Photo BG" },
];

function SlideEditorDrawer({
  slide,
  meetingId,
  onSaved,
  onClose,
}: {
  slide: Slide;
  meetingId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState({
    slide_type: slide.slide_type,
    title: slide.title || "",
    body: slide.body || "",
    image_caption: slide.image_caption || "",
    background_style: slide.background_style,
    custom_data: slide.custom_data || {},
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await postApi(`/api/meetings/${meetingId}/slides/${slide.slide_id}`, form, { method: "PATCH" });
      toastSuccess("Slide saved");
      onSaved();
    } catch {
      toastError("Failed to save slide");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/meetings/${meetingId}/slides/${slide.slide_id}/image`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.success && data.data?.image_url) {
        toastSuccess("Image uploaded");
        onSaved();
      } else {
        toastError(data.error?.message || "Upload failed");
      }
    } catch {
      toastError("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Stats editor helpers
  const stats = (form.custom_data?.stats as Array<{ label: string; value: string; highlight?: boolean }>) || [];
  const updateStat = (idx: number, field: string, value: string | boolean) => {
    const updated = [...stats];
    updated[idx] = { ...updated[idx], [field]: value };
    setForm({ ...form, custom_data: { ...form.custom_data, stats: updated } });
  };
  const addStat = () => {
    setForm({ ...form, custom_data: { ...form.custom_data, stats: [...stats, { label: "", value: "", highlight: false }] } });
  };
  const removeStat = (idx: number) => {
    setForm({ ...form, custom_data: { ...form.custom_data, stats: stats.filter((_, i) => i !== idx) } });
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8rem", fontWeight: 600,
    color: "var(--text-secondary)", marginBottom: "0.25rem",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.5rem 0.75rem", fontSize: "0.9rem",
    border: "1px solid var(--card-border)", borderRadius: "6px",
    background: "var(--bg-primary)", color: "var(--text-primary)",
  };

  return (
    <ActionDrawer
      isOpen
      onClose={onClose}
      title={`Edit Slide: ${form.slide_type}`}
      width="xl"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>Save</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Type */}
        <div>
          <label style={labelStyle}>Slide Type</label>
          <select
            value={form.slide_type}
            onChange={(e) => setForm({ ...form, slide_type: e.target.value })}
            style={inputStyle}
          >
            {SLIDE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label style={labelStyle}>{form.slide_type === "quote" ? "Attribution" : "Title"}</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            style={inputStyle}
            placeholder={form.slide_type === "quote" ? "Who said it" : "Slide heading"}
          />
        </div>

        {/* Body — not for stats/photo */}
        {!["stats", "photo"].includes(form.slide_type) && (
          <div>
            <label style={labelStyle}>
              {form.slide_type === "quote" ? "Quote Text" : "Body"}
            </label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              style={{ ...inputStyle, minHeight: "120px", resize: "vertical" }}
              placeholder={form.slide_type === "content" ? "Use - for bullet points" : "Content text"}
            />
          </div>
        )}

        {/* Two column */}
        {form.slide_type === "two_column" && (
          <>
            <div>
              <label style={labelStyle}>Left Column</label>
              <textarea
                value={(form.custom_data?.left_content as string) || ""}
                onChange={(e) => setForm({ ...form, custom_data: { ...form.custom_data, left_content: e.target.value } })}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              />
            </div>
            <div>
              <label style={labelStyle}>Right Column</label>
              <textarea
                value={(form.custom_data?.right_content as string) || ""}
                onChange={(e) => setForm({ ...form, custom_data: { ...form.custom_data, right_content: e.target.value } })}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              />
            </div>
          </>
        )}

        {/* Stats rows */}
        {form.slide_type === "stats" && (
          <div>
            <label style={labelStyle}>Stats</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {stats.map((stat, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Value"
                    value={stat.value}
                    onChange={(e) => updateStat(i, "value", e.target.value)}
                    style={{ ...inputStyle, width: "30%" }}
                  />
                  <input
                    type="text"
                    placeholder="Label"
                    value={stat.label}
                    onChange={(e) => updateStat(i, "label", e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={stat.highlight || false}
                      onChange={(e) => updateStat(i, "highlight", e.target.checked)}
                    />
                    Highlight
                  </label>
                  <button
                    onClick={() => removeStat(i)}
                    style={{ background: "none", border: "none", color: "var(--danger-text)", cursor: "pointer", fontSize: "1.1rem" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon="plus" onClick={addStat}>
                Add Stat
              </Button>
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={!!form.custom_data?.auto_stats}
                  onChange={(e) => setForm({ ...form, custom_data: { ...form.custom_data, auto_stats: e.target.checked } })}
                />
                Auto-populate from database
              </label>
            </div>
          </div>
        )}

        {/* Photo */}
        {form.slide_type === "photo" && (
          <div>
            <label style={labelStyle}>Image</label>
            {slide.image_url && (
              <img
                src={slide.image_url}
                alt="Slide"
                style={{ maxWidth: "100%", maxHeight: 200, borderRadius: "6px", marginBottom: "0.5rem", objectFit: "contain" }}
              />
            )}
            <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
            {uploading && <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Uploading...</span>}
            <div style={{ marginTop: "0.5rem" }}>
              <label style={labelStyle}>Caption</label>
              <input
                type="text"
                value={form.image_caption}
                onChange={(e) => setForm({ ...form, image_caption: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* Background */}
        <div>
          <label style={labelStyle}>Background</label>
          <select
            value={form.background_style}
            onChange={(e) => setForm({ ...form, background_style: e.target.value })}
            style={inputStyle}
          >
            {BG_STYLES.map((bg) => (
              <option key={bg.id} value={bg.id}>{bg.label}</option>
            ))}
          </select>
        </div>
      </div>
    </ActionDrawer>
  );
}

function LibraryDrawer({
  meetingId,
  onAdded,
  onClose,
}: {
  meetingId: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [byCategory, setByCategory] = useState<Record<string, LibrarySlide[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<{ byCategory: Record<string, LibrarySlide[]> }>("/api/meetings/library")
      .then((res) => setByCategory(res.byCategory || {}))
      .catch(() => toastError("Failed to load library"))
      .finally(() => setLoading(false));
  }, [toastError]);

  const cloneSlide = async (librarySlideId: string) => {
    try {
      await postApi(`/api/meetings/${meetingId}/slides`, { from_library_id: librarySlideId });
      toastSuccess("Slide added from library");
      onAdded();
    } catch {
      toastError("Failed to add slide");
    }
  };

  const categoryOrder = ["opening", "mission", "scoreboard", "process", "reminder", "closing", "general"];

  return (
    <ActionDrawer isOpen onClose={onClose} title="Add from Library" width="lg">
      {loading ? (
        <SkeletonList items={4} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {categoryOrder.map((cat) => {
            const slides = byCategory[cat];
            if (!slides?.length) return null;
            return (
              <div key={cat}>
                <h3 style={{
                  margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 600,
                  textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em",
                }}>
                  {cat}
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {slides.map((s) => (
                    <div
                      key={s.library_slide_id}
                      onClick={() => cloneSlide(s.library_slide_id)}
                      style={{
                        padding: "0.75rem 1rem",
                        border: "1px solid var(--card-border)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        transition: "background 150ms ease",
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{s.name}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {s.slide_type} · {s.title || "Untitled"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ActionDrawer>
  );
}

function MeetingEditorContent({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("slides");
  const [editingSlide, setEditingSlide] = useState<Slide | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Inline edit states for title/date
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetchApi<{ meeting: Meeting; slides: Slide[] }>(
        `/api/meetings/${meetingId}`
      );
      setMeeting(res.meeting);
      setSlides(res.slides);
      setEditTitle(res.meeting.title);
      setEditDate(res.meeting.meeting_date || "");
      setEditDesc(res.meeting.description || "");
    } catch {
      toastError("Failed to load meeting");
    } finally {
      setLoading(false);
    }
  }, [meetingId, toastError]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const saveMeta = async (updates: Partial<Meeting>) => {
    try {
      await postApi(`/api/meetings/${meetingId}`, updates, { method: "PATCH" });
      toastSuccess("Saved");
      fetchMeeting();
    } catch {
      toastError("Failed to save");
    }
  };

  const addSlide = async (slideType: string) => {
    try {
      await postApi(`/api/meetings/${meetingId}/slides`, {
        slide_type: slideType,
        title: slideType === "title" ? "New Slide" : "",
      });
      toastSuccess("Slide added");
      fetchMeeting();
    } catch {
      toastError("Failed to add slide");
    }
  };

  const deleteSlide = async (slideId: string) => {
    try {
      await postApi(`/api/meetings/${meetingId}/slides/${slideId}`, {}, { method: "DELETE" });
      toastSuccess("Slide removed");
      fetchMeeting();
    } catch {
      toastError("Failed to delete slide");
    }
  };

  const moveSlide = async (idx: number, direction: -1 | 1) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= slides.length) return;
    const newOrder = [...slides];
    [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
    const slide_ids = newOrder.map((s) => s.slide_id);
    // Optimistic update
    setSlides(newOrder.map((s, i) => ({ ...s, display_order: i })));
    try {
      await postApi(`/api/meetings/${meetingId}/slides/reorder`, { slide_ids });
    } catch {
      toastError("Failed to reorder");
      fetchMeeting();
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meeting?.title || "meeting"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      toastSuccess("PPTX downloaded");
    } catch {
      toastError("Failed to export PPTX");
    } finally {
      setExporting(false);
    }
  };

  const handleArchive = async () => {
    if (!confirm("Archive this meeting?")) return;
    await saveMeta({ status: "archived" } as Partial<Meeting>);
    router.push("/trappers/meetings");
  };

  if (loading) return <SkeletonList items={5} />;
  if (!meeting) return <div>Meeting not found</div>;

  return (
    <div>
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: "Trappers", href: "/trappers" },
        { label: "Meetings", href: "/trappers/meetings" },
        { label: meeting.title },
      ]} />

      {/* Header */}
      <div style={{ margin: "1rem 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => { if (editTitle !== meeting.title) saveMeta({ title: editTitle } as Partial<Meeting>); }}
            style={{
              fontSize: "1.4rem", fontWeight: 700, border: "none", background: "transparent",
              color: "var(--text-primary)", width: "100%", padding: "0.25rem 0",
              borderBottom: "2px solid transparent",
            }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--primary)")}
            onBlurCapture={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
            <input
              type="date"
              value={editDate}
              onChange={(e) => {
                setEditDate(e.target.value);
                saveMeta({ meeting_date: e.target.value || null } as Partial<Meeting>);
              }}
              style={{
                fontSize: "0.85rem", border: "1px solid var(--card-border)",
                borderRadius: "4px", padding: "0.25rem 0.5rem", background: "var(--bg-primary)",
                color: "var(--text-secondary)",
              }}
            />
            <select
              value={meeting.status}
              onChange={(e) => saveMeta({ status: e.target.value } as Partial<Meeting>)}
              style={{
                fontSize: "0.85rem", border: "1px solid var(--card-border)",
                borderRadius: "4px", padding: "0.25rem 0.5rem", background: "var(--bg-primary)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="presented">Presented</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            variant="outline"
            icon="download"
            loading={exporting}
            onClick={handleExport}
            disabled={slides.length === 0}
          >
            Export PPTX
          </Button>
          <Button
            variant="outline"
            icon="download"
            disabled={slides.length === 0}
            onClick={() => {
              window.open(`/trappers/meetings/${meetingId}/present?print=true`, "_blank");
            }}
          >
            Save as PDF
          </Button>
          <Button
            icon="presentation"
            onClick={() => router.push(`/trappers/meetings/${meetingId}/present`)}
            disabled={slides.length === 0}
          >
            Present
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: "slides", label: "Slides", count: slides.length },
          { id: "settings", label: "Settings" },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <TabPanel tabId="slides" activeTab={activeTab}>
        {/* Add slide controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {SLIDE_TYPES.map((t) => (
            <Button key={t.id} variant="ghost" size="sm" icon={SLIDE_TYPE_ICONS[t.id]} onClick={() => addSlide(t.id)}>
              {t.label}
            </Button>
          ))}
          <Button variant="secondary" size="sm" icon="book-open" onClick={() => setShowLibrary(true)}>
            From Library
          </Button>
        </div>

        {/* Slide list */}
        {slides.length === 0 ? (
          <EmptyList entityName="slides" onAdd={() => addSlide("content")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {slides.map((slide, idx) => (
              <div
                key={slide.slide_id}
                style={{
                  display: "flex", alignItems: "center", gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  border: "1px solid var(--card-border)", borderRadius: "8px",
                  background: "var(--card-bg)",
                }}
              >
                {/* Reorder arrows */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                  <button
                    onClick={() => moveSlide(idx, -1)}
                    disabled={idx === 0}
                    style={{
                      background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer",
                      opacity: idx === 0 ? 0.2 : 0.6, padding: "0.1rem", fontSize: "0.75rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    &#9650;
                  </button>
                  <button
                    onClick={() => moveSlide(idx, 1)}
                    disabled={idx === slides.length - 1}
                    style={{
                      background: "none", border: "none", cursor: idx === slides.length - 1 ? "default" : "pointer",
                      opacity: idx === slides.length - 1 ? 0.2 : 0.6, padding: "0.1rem", fontSize: "0.75rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    &#9660;
                  </button>
                </div>

                {/* Slide number */}
                <span style={{
                  width: 28, height: 28, borderRadius: "6px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.75rem", fontWeight: 600,
                  background: "var(--bg-secondary)", color: "var(--text-muted)",
                }}>
                  {idx + 1}
                </span>

                {/* Type icon */}
                <Icon name={SLIDE_TYPE_ICONS[slide.slide_type] || "file-text"} size={18} />

                {/* Content preview */}
                <div
                  style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
                  onClick={() => setEditingSlide(slide)}
                >
                  <div style={{ fontWeight: 500, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {slide.title || `(${slide.slide_type} slide)`}
                  </div>
                  {slide.body && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {slide.body.substring(0, 80)}
                    </div>
                  )}
                </div>

                {/* Badges */}
                {slide.is_from_library && (
                  <span style={{
                    fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "999px",
                    background: "var(--primary-light)", color: "var(--primary)",
                  }}>
                    library
                  </span>
                )}

                {/* Delete */}
                <button
                  onClick={() => deleteSlide(slide.slide_id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", fontSize: "1.1rem", padding: "0.25rem",
                  }}
                  title="Remove slide"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel tabId="settings" activeTab={activeTab}>
        <div style={{ maxWidth: 500, display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
              Description
            </label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={() => { if (editDesc !== (meeting.description || "")) saveMeta({ description: editDesc } as Partial<Meeting>); }}
              style={{
                width: "100%", padding: "0.5rem 0.75rem", fontSize: "0.9rem",
                border: "1px solid var(--card-border)", borderRadius: "6px",
                background: "var(--bg-primary)", color: "var(--text-primary)",
                minHeight: "80px", resize: "vertical",
              }}
              placeholder="Internal notes about this meeting..."
            />
          </div>
          <div>
            <Button variant="danger" onClick={handleArchive}>
              Archive Meeting
            </Button>
          </div>
        </div>
      </TabPanel>

      {/* Drawers */}
      {editingSlide && (
        <SlideEditorDrawer
          slide={editingSlide}
          meetingId={meetingId}
          onSaved={() => { setEditingSlide(null); fetchMeeting(); }}
          onClose={() => setEditingSlide(null)}
        />
      )}

      {showLibrary && (
        <LibraryDrawer
          meetingId={meetingId}
          onAdded={() => { setShowLibrary(false); fetchMeeting(); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

export default function MeetingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<SkeletonList items={5} />}>
      <MeetingEditorContent meetingId={id} />
    </Suspense>
  );
}
