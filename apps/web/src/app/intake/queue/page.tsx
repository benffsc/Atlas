"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CreateRequestWizard } from "@/components/forms";
import { formatPhone, isValidPhone, extractPhone } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import type { IntakeSubmission, StaffMember, TabType } from "@/lib/intake-types";
import {
  SubmissionStatusBadge,
  formatDate,
  normalizeName,
} from "@/components/intake/IntakeBadges";
import { ContactLogModal } from "@/components/intake/ContactLogModal";
import { BookingModal } from "@/components/intake/BookingModal";
import { DeclineModal } from "@/components/intake/DeclineModal";
import { IntakeQueueRow } from "@/components/intake/IntakeQueueRow";
import { IntakeDetailPanel } from "@/components/intake/IntakeDetailPanel";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

function IntakeQueueContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const openSubmissionId = searchParams.get("open");
  const { user: currentUser } = useCurrentUser();

  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const { filters, setFilter } = useUrlFilters({
    tab: "active",
    category: "",
    q: "",
    sort: "date",
    order: "desc",
    group: "",
    legacy: "",
    test: "",
  });
  const activeTab = filters.tab as TabType;
  const setActiveTab = (v: TabType) => setFilter("tab", v);
  const categoryFilter = filters.category;
  const setCategoryFilter = (v: string) => setFilter("category", v);
  const searchQuery = filters.q;
  const [searchInput, setSearchInput] = useState(filters.q);
  const sortBy = filters.sort as "date" | "category" | "type" | "priority";
  const setSortBy = (v: "date" | "category" | "type" | "priority") => setFilter("sort", v);
  const sortOrder = filters.order as "asc" | "desc";
  const setSortOrder = (v: "asc" | "desc") => setFilter("order", v);
  const groupBy = filters.group as "" | "category" | "type" | "status";
  const showLegacy = filters.legacy === "1";
  const showTest = filters.test === "1";
  const [selectedSubmission, setSelectedSubmission] = useState<IntakeSubmission | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialOpenHandled, setInitialOpenHandled] = useState(false);

  // Communication log modal state (shared between queue table and detail panel)
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactModalSubmission, setContactModalSubmission] = useState<IntakeSubmission | null>(null);

  // Staff list for dropdown
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Create Request wizard state
  const [showRequestWizard, setShowRequestWizard] = useState(false);
  const [wizardSubmission, setWizardSubmission] = useState<IntakeSubmission | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Appointment booking modal state
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSubmission, setBookingSubmission] = useState<IntakeSubmission | null>(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");

  // Decline modal state
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineSubmission, setDeclineSubmission] = useState<IntakeSubmission | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>("");

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = (currentSubs: IntakeSubmission[]) => {
    if (selectedIds.size === currentSubs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentSubs.map((s) => s.submission_id)));
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedIds.size === 0 || !bulkStatusTarget) return;
    if (!confirm(`Update ${selectedIds.size} submissions to "${bulkStatusTarget}"?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        postApi(`/api/intake/queue/${id}`, { submission_status: bulkStatusTarget }, { method: "PATCH" })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setBulkStatusTarget("");
      await fetchSubmissions();
    } catch (err) {
      alert("Error updating submissions");
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Archive ${selectedIds.size} submissions?`)) return;

    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        postApi(`/api/intake/queue/${id}`, { submission_status: "archived" }, { method: "PATCH" })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      await fetchSubmissions();
    } catch (err) {
      alert("Error archiving submissions");
    } finally {
      setBulkUpdating(false);
    }
  };

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();

      // Map new tab names to API mode parameter
      params.set("mode", activeTab);

      if (categoryFilter) params.set("category", categoryFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (showLegacy) params.set("include_legacy", "true");
      if (showTest) params.set("include_test", "true");

      const data = await fetchApi<{ submissions: IntakeSubmission[] }>(`/api/intake/queue?${params.toString()}`);
      setSubmissions(data.submissions || []);
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, categoryFilter, searchQuery, showLegacy, showTest]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Handle opening a specific submission from URL parameter
  useEffect(() => {
    if (openSubmissionId && !initialOpenHandled && !loading) {
      // Try to find in current list first
      const found = submissions.find(s => s.submission_id === openSubmissionId);
      if (found) {
        openDetail(found);
        setInitialOpenHandled(true);
        // Clear the URL parameter
        router.replace("/intake/queue", { scroll: false });
      } else if (submissions.length > 0) {
        // Submission not in current list - fetch directly
        fetchApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${openSubmissionId}`)
          .then((data) => {
            if (data?.submission) {
              openDetail(data.submission);
            }
          })
          .catch(err => console.error("Failed to fetch submission:", err))
          .finally(() => {
            setInitialOpenHandled(true);
            router.replace("/intake/queue", { scroll: false });
          });
      }
    }
  }, [openSubmissionId, initialOpenHandled, loading, submissions, router]);

  // Fetch staff list on mount
  useEffect(() => {
    fetchApi<{ staff: StaffMember[] }>("/api/staff")
      .then((data) => setStaffList(data.staff || []))
      .catch((err) => console.error("Failed to fetch staff:", err));
  }, []);

  // Open contact modal for a submission
  const openContactModal = (sub: IntakeSubmission) => {
    setContactModalSubmission(sub);
    setShowContactModal(true);
  };

  const closeContactModal = () => {
    setShowContactModal(false);
    setContactModalSubmission(null);
  };

  const handleQuickStatus = async (submissionId: string, field: string, value: string) => {
    setSaving(true);
    try {
      await postApi("/api/intake/status", {
        submission_id: submissionId,
        [field]: value || null,
      }, { method: "PATCH" });
      fetchSubmissions();
    } catch (err) {
      console.error("Failed to update:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkBooked = (sub: IntakeSubmission) => {
    // Show booking modal instead of immediately setting status
    setBookingSubmission(sub);
    setBookingDate("");
    setBookingNotes("");
    setShowBookingModal(true);
  };

  const handleConfirmBookingFromModal = async (date: string, notes: string) => {
    if (!bookingSubmission) return;
    const wasAlreadyScheduled = bookingSubmission.submission_status === "scheduled";
    setSaving(true);
    try {
      await postApi("/api/intake/status", {
        submission_id: bookingSubmission.submission_id,
        submission_status: "scheduled",
        appointment_date: date || null,
        legacy_submission_status: "Booked",
        legacy_appointment_date: date || null,
        legacy_notes: notes
          ? (bookingSubmission.legacy_notes ? bookingSubmission.legacy_notes + "\n" + notes : notes)
          : bookingSubmission.legacy_notes,
      }, { method: "PATCH" });

      const submitterName = normalizeName(bookingSubmission.submitter_name);
      setShowBookingModal(false);
      setBookingSubmission(null);
      fetchSubmissions();

      if (selectedSubmission?.submission_id === bookingSubmission.submission_id) {
        setSelectedSubmission({
          ...selectedSubmission,
          submission_status: "scheduled",
          appointment_date: date || null,
          legacy_submission_status: "Booked",
          legacy_appointment_date: date || null,
        });
      }

      if (wasAlreadyScheduled) {
        setToastMessage(`Updated appointment for ${submitterName}`);
      } else {
        setToastMessage(`Scheduled ${submitterName}. Find in "Scheduled" tab.`);
      }
      setTimeout(() => setToastMessage(null), 5000);
    } catch (err) {
      console.error("Failed to schedule:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleChangeAppointment = (sub: IntakeSubmission) => {
    // Open booking modal with existing date pre-filled
    setBookingSubmission(sub);
    setBookingDate(sub.appointment_date || sub.legacy_appointment_date || "");
    setBookingNotes("");
    setShowBookingModal(true);
  };

  const closeBookingModal = () => {
    setShowBookingModal(false);
    setBookingSubmission(null);
    setBookingDate("");
    setBookingNotes("");
  };

  const openDetail = (sub: IntakeSubmission) => {
    setSelectedSubmission(sub);
  };

  const handleArchive = async (submissionId: string) => {
    try {
      await postApi("/api/intake/status", {
        submission_id: submissionId,
        submission_status: "archived",
        status: "archived", // Keep legacy field updated too
      }, { method: "PATCH" });

      fetchSubmissions();
      setSelectedSubmission(null);
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleRequestWizardComplete = (requestId: string) => {
    setShowRequestWizard(false);
    setWizardSubmission(null);
    fetchSubmissions();
    // Optionally navigate to the new request
    window.location.href = `/requests/${requestId}`;
  };

  const handleRequestWizardCancel = () => {
    setShowRequestWizard(false);
    setWizardSubmission(null);
  };

  // Stats for current view using unified status
  const stats = {
    total: submissions.length,
    new: submissions.filter(s => s.submission_status === "new").length,
    inProgress: submissions.filter(s => s.submission_status === "in_progress").length,
    scheduled: submissions.filter(s => s.submission_status === "scheduled").length,
    complete: submissions.filter(s => s.submission_status === "complete").length,
    highPriority: submissions.filter(s => s.triage_category === "high_priority_tnr").length,
    thirdParty: submissions.filter(s => s.is_third_party_report).length,
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 60px)" }}>
      {/* Main Queue Panel */}
      <div style={{
        flex: selectedSubmission ? "0 0 45%" : "1",
        overflow: "auto",
        padding: "0 1rem 1rem 0",
        transition: "flex 0.2s ease-in-out",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Intake Queue</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/intake?test=true"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              background: "#0dcaf0",
              color: "#000",
              textDecoration: "none",
              borderRadius: "4px",
              fontSize: "0.85rem",
            }}
            title="Create test submission for demo purposes"
          >
            Demo Test
          </a>
          <a
            href="/intake"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            + New Intake
          </a>
          <a
            href="/intake/print"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Print Form
          </a>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "1.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#198754",
            color: "#fff",
            padding: "0.75rem 1.5rem",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              padding: "0",
              fontSize: "1.2rem",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Tabs (FFS-111: reduced to 4) */}
      <div style={{ display: "flex", gap: "0", borderBottom: "2px solid var(--border)", marginBottom: "0.5rem" }}>
        {([
          { id: "active" as TabType, label: "Active" },
          { id: "scheduled" as TabType, label: "Scheduled" },
          { id: "completed" as TabType, label: "Completed" },
          { id: "all" as TabType, label: "All" },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.75rem 1.5rem",
              border: "none",
              background: activeTab === tab.id ? "var(--foreground)" : "transparent",
              color: activeTab === tab.id ? "var(--background)" : "var(--foreground)",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: activeTab === tab.id ? 600 : 400,
              borderRadius: "6px 6px 0 0",
              marginBottom: "-2px",
              borderBottom: activeTab === tab.id ? "2px solid var(--foreground)" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter chips (FFS-111: legacy/test as toggleable chips) */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button
          onClick={() => setFilter("legacy", showLegacy ? "" : "1")}
          style={{
            padding: "0.25rem 0.75rem",
            fontSize: "0.8rem",
            border: `1px solid ${showLegacy ? "#6c757d" : "var(--border)"}`,
            borderRadius: "16px",
            background: showLegacy ? "#6c757d" : "transparent",
            color: showLegacy ? "#fff" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          Legacy {showLegacy ? "On" : "Off"}
        </button>
        <button
          onClick={() => setFilter("test", showTest ? "" : "1")}
          style={{
            padding: "0.25rem 0.75rem",
            fontSize: "0.8rem",
            border: `1px solid ${showTest ? "#dc3545" : "var(--border)"}`,
            borderRadius: "16px",
            background: showTest ? "#dc3545" : "transparent",
            color: showTest ? "#fff" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          Test {showTest ? "On" : "Off"}
        </button>
      </div>

      {/* Search and Filter */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", searchInput);
          }}
          style={{ display: "flex", gap: "0.5rem", flex: 1, minWidth: "200px", maxWidth: "400px" }}
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, phone, address..."
            style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)" }}
          />
          <button
            type="submit"
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Search
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setFilter("q", "");
              }}
              style={{
                padding: "0.5rem 0.75rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </form>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "180px" }}
        >
          <option value="">All Categories</option>
          <option value="high_priority_tnr">High Priority FFR</option>
          <option value="standard_tnr">Standard FFR</option>
          <option value="wellness_only">Wellness Only</option>
          <option value="owned_cat_low">Owned Cat (Low)</option>
          <option value="out_of_county">Out of County</option>
          <option value="needs_review">Needs Review</option>
        </select>

        {/* Sort controls (FFS-111: simplified, added Priority) */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "date" | "category" | "type" | "priority")}
          style={{ padding: "0.5rem", minWidth: "130px" }}
        >
          <option value="date">Sort by Date</option>
          <option value="priority">Sort by Priority</option>
          <option value="category">Sort by Category</option>
          <option value="type">Sort by Type</option>
        </select>

        <button
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          style={{ padding: "0.5rem", minWidth: "40px" }}
          title={sortOrder === "asc" ? "Oldest first" : "Newest first"}
        >
          {sortOrder === "asc" ? "↑" : "↓"}
        </button>

        <button onClick={fetchSubmissions} style={{ padding: "0.5rem 1rem" }}>
          Refresh
        </button>

        <span style={{ color: "var(--muted)", fontSize: "0.875rem", marginLeft: "auto" }}>
          {submissions.length} submissions
        </span>
      </div>

      {/* Quick stats for current tab */}
      {stats.total > 0 && (
        <div style={{ display: "flex", gap: SPACING.md, marginBottom: SPACING.lg, flexWrap: "wrap" }}>
          {stats.new > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.primary, color: COLORS.white, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.new} New
            </span>
          )}
          {stats.inProgress > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.warning, color: COLORS.black, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.inProgress} In Progress
            </span>
          )}
          {stats.scheduled > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.success, color: COLORS.white, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.scheduled} Scheduled
            </span>
          )}
          {activeTab !== "active" && stats.complete > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.successLight, color: COLORS.black, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.complete} Complete
            </span>
          )}
          {stats.highPriority > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.error, color: COLORS.white, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.highPriority} High Priority
            </span>
          )}
          {stats.thirdParty > 0 && (
            <span style={{ padding: `${SPACING.xs} ${SPACING.md}`, background: COLORS.warning, color: COLORS.black, borderRadius: BORDERS.radius['2xl'], fontSize: TYPOGRAPHY.size.sm }}>
              {stats.thirdParty} Third-Party
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{
              height: '4rem',
              background: COLORS.gray100,
              borderRadius: BORDERS.radius.lg,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      ) : submissions.length === 0 ? (
        <div style={{ padding: SPACING['3xl'], textAlign: "center", color: "var(--muted)" }}>
          {activeTab === "active" ? (
            <>
              <p style={{ fontSize: TYPOGRAPHY.size.xl, marginBottom: SPACING.sm }}>All caught up!</p>
              <p style={{ color: COLORS.textSecondary }}>No new submissions need attention right now.</p>
            </>
          ) : activeTab === "scheduled" ? (
            <p style={{ color: COLORS.textSecondary }}>No scheduled intakes at this time.</p>
          ) : activeTab === "completed" ? (
            <p style={{ color: COLORS.textSecondary }}>No completed intakes to display.</p>
          ) : (
            <p style={{ color: COLORS.textSecondary }}>No submissions found.</p>
          )}
        </div>
      ) : (() => {
        // Sort submissions
        const sortedSubmissions = [...submissions].sort((a, b) => {
          let comparison = 0;
          if (sortBy === "date") {
            comparison = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
          } else if (sortBy === "priority") {
            // Urgent first, then by triage score (higher = more urgent)
            const aUrgent = a.is_emergency ? 1 : 0;
            const bUrgent = b.is_emergency ? 1 : 0;
            comparison = bUrgent - aUrgent || (b.triage_score || 0) - (a.triage_score || 0);
          } else if (sortBy === "category") {
            comparison = (a.triage_category || "zzz").localeCompare(b.triage_category || "zzz");
          } else if (sortBy === "type") {
            comparison = (a.is_legacy ? 1 : 0) - (b.is_legacy ? 1 : 0);
          }
          return sortOrder === "asc" ? comparison : -comparison;
        });

        // Group submissions if groupBy is set
        const groupedSubmissions = groupBy
          ? sortedSubmissions.reduce((acc, sub) => {
              let key = "";
              if (groupBy === "category") {
                key = sub.triage_category?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Uncategorized";
              } else if (groupBy === "type") {
                key = sub.is_legacy ? "Legacy (Airtable)" : "Native (Atlas)";
              } else if (groupBy === "status") {
                key = (sub.submission_status || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              }
              if (!acc[key]) acc[key] = [];
              acc[key].push(sub);
              return acc;
            }, {} as Record<string, IntakeSubmission[]>)
          : { "": sortedSubmissions };

        const groupOrder = groupBy === "type"
          ? ["Native (Atlas)", "Legacy (Airtable)"]
          : groupBy === "category"
          ? ["High Priority Tnr", "Standard Tnr", "Wellness Only", "Owned Cat Low", "Out Of County", "Needs Review", "Uncategorized"]
          : ["New", "Reviewed", "Converted", "Rejected"];

        const sortedGroups = Object.entries(groupedSubmissions).sort(([a], [b]) => {
          const aIdx = groupOrder.indexOf(a);
          const bIdx = groupOrder.indexOf(b);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });

        return (
        <div>
          {/* Bulk Action Bar */}
          {selectedIds.size > 0 && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "#dbeafe",
                borderRadius: "8px",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontWeight: 500, color: "#1e40af" }}>
                {selectedIds.size} submission{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={bulkStatusTarget}
                  onChange={(e) => setBulkStatusTarget(e.target.value)}
                  style={{ minWidth: "140px", padding: "0.4rem 0.5rem", fontSize: "0.875rem" }}
                >
                  <option value="">Change status to...</option>
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="complete">Complete</option>
                </select>
                <button
                  onClick={handleBulkStatusUpdate}
                  disabled={!bulkStatusTarget || bulkUpdating}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "none",
                    borderRadius: "6px",
                    background: bulkStatusTarget ? "#2563eb" : "#94a3b8",
                    color: "white",
                    cursor: bulkStatusTarget && !bulkUpdating ? "pointer" : "not-allowed",
                    fontSize: "0.875rem",
                  }}
                >
                  {bulkUpdating ? "Updating..." : "Apply"}
                </button>
                <button
                  onClick={handleBulkArchive}
                  disabled={bulkUpdating}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "1px solid #dc2626",
                    borderRadius: "6px",
                    background: "transparent",
                    color: "#dc2626",
                    cursor: bulkUpdating ? "not-allowed" : "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Archive
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  style={{
                    padding: "0.4rem 0.75rem",
                    border: "1px solid #64748b",
                    borderRadius: "6px",
                    background: "transparent",
                    color: "#64748b",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

        <div className="table-container">
          {sortedGroups.map(([groupName, groupSubs]) => (
            <div key={groupName || "all"} style={{ marginBottom: groupBy ? "2rem" : 0 }}>
              {groupBy && (
                <h3 style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  marginBottom: "0.75rem",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}>
                  {groupName}
                  <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "var(--muted)" }}>
                    ({groupSubs.length})
                  </span>
                </h3>
              )}
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === sortedSubmissions.length && sortedSubmissions.length > 0}
                    onChange={() => toggleSelectAll(sortedSubmissions)}
                  />
                </th>
                <th style={{ width: "60px" }}>Type</th>
                <th style={{ width: "180px" }}>Submitter</th>
                <th style={{ width: "200px" }}>Location</th>
                <th style={{ width: "80px" }}>Cats</th>
                <th style={{ width: "120px" }}>Status</th>
                <th style={{ width: "80px" }}>Submitted</th>
                <th style={{ width: "200px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupSubs.map((sub) => (
                <IntakeQueueRow
                  key={sub.submission_id}
                  submission={sub}
                  isSelected={selectedIds.has(sub.submission_id)}
                  onSelect={() => toggleSelect(sub.submission_id)}
                  onOpenDetail={() => openDetail(sub)}
                  onOpenContactModal={() => openContactModal(sub)}
                  onQuickStatus={handleQuickStatus}
                  onSchedule={() => handleMarkBooked(sub)}
                  onChangeAppointment={() => handleChangeAppointment(sub)}
                  saving={saving}
                />
              ))}
            </tbody>
          </table>
            </div>
          ))}
        </div>
        </div>
        );
      })()}
      </div>
      {/* End Queue Panel */}


      {/* Detail Side Panel */}
      {selectedSubmission && (
        <IntakeDetailPanel
          submission={selectedSubmission}
          currentUser={currentUser}
          staffList={staffList}
          saving={saving}
          setSaving={setSaving}
          onClose={() => setSelectedSubmission(null)}
          onRefresh={fetchSubmissions}
          onSubmissionUpdate={(updated) => setSelectedSubmission(updated)}
          onOpenContactModal={openContactModal}
          onOpenBookingModal={handleMarkBooked}
          onOpenDeclineModal={(sub) => {
            setDeclineSubmission(sub);
            setShowDeclineModal(true);
          }}
          onChangeAppointment={handleChangeAppointment}
          onQuickStatus={handleQuickStatus}
          onArchive={handleArchive}
          toastMessage={toastMessage}
          setToastMessage={setToastMessage}
        />
      )}


      {/* Contact Log Modal */}
      {contactModalSubmission && (
        <ContactLogModal
          submission={contactModalSubmission}
          isOpen={showContactModal}
          onClose={closeContactModal}
          onLogSaved={fetchSubmissions}
          staffList={staffList}
          currentUser={currentUser}
        />
      )}

      {/* Create Request Wizard */}
      {showRequestWizard && wizardSubmission && (
        <CreateRequestWizard
          submission={wizardSubmission}
          onComplete={handleRequestWizardComplete}
          onCancel={handleRequestWizardCancel}
        />
      )}

      {/* Booking Modal */}
      {bookingSubmission && (
        <BookingModal
          submission={bookingSubmission}
          isOpen={showBookingModal}
          onClose={closeBookingModal}
          onBooked={handleConfirmBookingFromModal}
          saving={saving}
          initialDate={bookingDate}
        />
      )}

      {/* Decline Modal */}
      {declineSubmission && (
        <DeclineModal
          submission={declineSubmission}
          isOpen={showDeclineModal}
          onClose={() => setShowDeclineModal(false)}
          onDeclined={() => {
            setShowDeclineModal(false);
            if (selectedSubmission?.submission_id === declineSubmission.submission_id) {
              setSelectedSubmission({ ...selectedSubmission, submission_status: "declined" });
            }
            setToastMessage(`${normalizeName(declineSubmission.submitter_name)} declined`);
            setTimeout(() => setToastMessage(null), 5000);
            fetchSubmissions();
          }}
        />
      )}
    </div>
  );
}

export default function IntakeQueuePage() {
  return (
    <Suspense fallback={<div className="loading">Loading queue...</div>}>
      <IntakeQueueContent />
    </Suspense>
  );
}
