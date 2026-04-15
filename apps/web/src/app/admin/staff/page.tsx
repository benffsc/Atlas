"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from "react";
import { formatPhone } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebounce } from "@/hooks/useDebounce";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import DOMPurify from "dompurify";

interface Staff {
  staff_id: string;
  person_id: string | null;
  first_name: string;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  work_extension: string | null;
  role: string;
  department: string | null;
  is_active: boolean;
  hired_date: string | null;
  source_record_id: string | null;
  ai_access_level: string | null;
}

interface StaffAuth {
  staff_id: string;
  display_name: string;
  email: string | null;
  auth_role: string;
  is_active: boolean;
  password_status: "set" | "default" | "not_set";
  password_set_at: string | null;
  last_login: string | null;
  login_count: number;
}

const DEPARTMENTS = [
  "Administration",
  "Clinic",
  "Trapping",
  "Adoptions",
  "Volunteers",
  "Marketing",
  "Other",
];

const AI_ACCESS_LEVELS = [
  { value: "none", label: "None", description: "No AI assistant access" },
  { value: "read_only", label: "Read Only", description: "Can query data, cannot create or modify" },
  { value: "read_write", label: "Read + Write", description: "Can query data and create reminders, feedback, etc." },
  { value: "full", label: "Full Access", description: "All capabilities including admin tools" },
];

const FILTER_DEFAULTS = {
  department: "",
  search: "",
  role: "",
  showInactive: "false",
};

function StaffManagementContent() {
  const { addToast } = useToast();
  const { filters, setFilter, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);

  const [viewMode, setViewMode] = useState<"directory" | "accounts">("directory");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkedPerson, setLinkedPerson] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Accounts view state
  const [authStaff, setAuthStaff] = useState<StaffAuth[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [sendingResetTo, setSendingResetTo] = useState<string | null>(null);
  const [sendingLoginInfoTo, setSendingLoginInfoTo] = useState<string | null>(null);

  // Email preview drawer state
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);
  const [emailDrawerStaff, setEmailDrawerStaff] = useState<StaffAuth | null>(null);
  const [emailDrawerType, setEmailDrawerType] = useState<"welcome" | "reset">("welcome");
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailPreviewSubject, setEmailPreviewSubject] = useState("");
  const [emailPreviewRecipient, setEmailPreviewRecipient] = useState("");
  const emailEditorRef = useRef<HTMLDivElement>(null);
  const [emailSending, setEmailSending] = useState(false);

  // Confirm dialogs
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const pendingDeactivateIdRef = useRef<string>("");

  // Form state
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    work_extension: "",
    role: "",
    department: "",
    hired_date: "",
    ai_access_level: "read_only",
  });

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.showInactive === "true") params.set("active", "false");
      if (filters.department) params.set("department", filters.department);

      const data = await fetchApi<{ staff: Staff[]; departments: string[] }>(`/api/staff?${params.toString()}`);
      const staffList = data.staff || [];
      setStaff(staffList);
      setDepartments(data.departments || []);
      // Extract unique roles from staff data
      const roles = [...new Set(staffList.map(s => s.role).filter(Boolean))].sort();
      setAllRoles(roles);
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.showInactive, filters.department]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Load auth data when switching to accounts view
  const fetchAuthStaff = useCallback(async () => {
    setAuthLoading(true);
    try {
      const data = await fetchApi<{ staff: StaffAuth[] }>("/api/admin/staff/auth-overview");
      setAuthStaff(data.staff || []);
    } catch (err) {
      console.error("Failed to fetch auth data:", err);
      addToast({ type: "error", message: "Failed to load account data" });
    } finally {
      setAuthLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (viewMode === "accounts") {
      fetchAuthStaff();
    }
  }, [viewMode, fetchAuthStaff]);

  const openEmailDrawer = async (s: StaffAuth, type: "welcome" | "reset") => {
    setEmailDrawerStaff(s);
    setEmailDrawerType(type);
    setEmailDrawerOpen(true);
    setEmailPreviewLoading(true);
    setEmailPreviewSubject("");
    setEmailPreviewRecipient(s.email || "");

    try {
      const data = await fetchApi<{
        subject: string;
        body_html: string;
        recipient: { email: string | null };
      }>(`/api/admin/staff/preview-email?staff_id=${s.staff_id}&type=${type}`);
      setEmailPreviewSubject(data.subject);
      setEmailPreviewRecipient(data.recipient.email || s.email || "");
      // Set editor HTML after a tick so the ref is mounted
      setTimeout(() => {
        if (emailEditorRef.current) {
          emailEditorRef.current.innerHTML = DOMPurify.sanitize(data.body_html);
        }
      }, 50);
    } catch {
      addToast({ type: "error", message: "Failed to load email preview" });
      setEmailDrawerOpen(false);
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  const handleEmailSend = async () => {
    if (!emailDrawerStaff) return;
    setEmailSending(true);
    try {
      const editedHtml = emailEditorRef.current?.innerHTML || "";
      await postApi("/api/admin/staff/send-login-info", {
        staff_id: emailDrawerStaff.staff_id,
        email_type: emailDrawerType,
        recipient_override: emailPreviewRecipient,
        subject_override: emailPreviewSubject,
        body_html_override: editedHtml,
      });
      addToast({
        type: "success",
        message: `Email sent to ${emailPreviewRecipient}`,
      });
      setEmailDrawerOpen(false);
    } catch {
      addToast({ type: "error", message: "Failed to send email" });
    } finally {
      setEmailSending(false);
    }
  };

  const handleSendLoginInfo = async (staffId: string, staffName: string) => {
    setSendingLoginInfoTo(staffId);
    try {
      await postApi("/api/admin/staff/send-login-info", { staff_id: staffId });
      addToast({ type: "success", message: `Login info sent to ${staffName}` });
    } catch {
      addToast({ type: "error", message: `Failed to send login info to ${staffName}` });
    } finally {
      setSendingLoginInfoTo(null);
    }
  };

  const handleSendResetEmail = async (staffEmail: string, staffName: string) => {
    setSendingResetTo(staffEmail);
    try {
      await postApi("/api/auth/forgot-password", { email: staffEmail });
      addToast({ type: "success", message: `Reset code sent to ${staffEmail}` });
    } catch {
      addToast({ type: "error", message: `Failed to send reset code to ${staffName}` });
    } finally {
      setSendingResetTo(null);
    }
  };

  const formatTimeAgo = (dateStr: string | null): string => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleSearchChange = useDebounce((value: string) => {
    setFilter("search", value);
  }, 300);

  const copyToClipboard = (text: string, staffId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(staffId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Client-side filtering for search and role
  const filteredStaff = staff.filter(s => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const match = s.display_name.toLowerCase().includes(q) ||
        (s.email && s.email.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q)) ||
        s.role.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (filters.role && s.role !== filters.role) return false;
    return true;
  });

  const openEdit = (s: Staff) => {
    setSelectedStaff(s);
    setFormData({
      first_name: s.first_name,
      last_name: s.last_name || "",
      email: s.email || "",
      phone: s.phone || "",
      work_extension: s.work_extension || "",
      role: s.role,
      department: s.department || "",
      hired_date: s.hired_date || "",
      ai_access_level: s.ai_access_level || "read_only",
    });
    setEditMode(true);
  };

  const openAdd = () => {
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      work_extension: "",
      role: "",
      department: "",
      hired_date: "",
      ai_access_level: "read_only",
    });
    setLinkedPerson({ person_id: null, display_name: "", is_resolved: false });
    setShowAddModal(true);
  };

  const handlePersonLinked = async (ref: PersonReference) => {
    setLinkedPerson(ref);
    if (ref.is_resolved && ref.person_id) {
      // Fetch person details to pre-fill form
      try {
        const data = await fetchApi<{ person_id: string; display_name: string; identifiers: Array<{ id_type: string; id_value: string }> | null }>(
          `/api/people/${ref.person_id}`
        );
        const nameParts = (data.display_name || ref.display_name).split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const email = data.identifiers?.find((i) => i.id_type === "email")?.id_value || "";
        const phone = data.identifiers?.find((i) => i.id_type === "phone")?.id_value || "";
        setFormData((prev) => ({
          ...prev,
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phone,
        }));
      } catch {
        // Fall back to just the display name
        const nameParts = ref.display_name.split(/\s+/);
        setFormData((prev) => ({
          ...prev,
          first_name: nameParts[0] || "",
          last_name: nameParts.slice(1).join(" ") || "",
        }));
      }
    } else if (!ref.is_resolved && ref.display_name) {
      // Free text name entry
      const nameParts = ref.display_name.split(/\s+/);
      setFormData((prev) => ({
        ...prev,
        first_name: nameParts[0] || "",
        last_name: nameParts.slice(1).join(" ") || "",
      }));
    }
  };

  const handleSave = async () => {
    if (!formData.first_name || !formData.role) {
      addToast({ type: "warning", message: "First name and role are required" });
      return;
    }

    setSaving(true);
    try {
      if (selectedStaff && editMode) {
        // Update existing
        await postApi(`/api/staff/${selectedStaff.staff_id}`, formData, { method: "PATCH" });
        setEditMode(false);
        setSelectedStaff(null);
        fetchStaff();
      } else {
        // Create new — include person_id if linked to existing person
        const payload = {
          ...formData,
          ...(linkedPerson.is_resolved && linkedPerson.person_id
            ? { person_id: linkedPerson.person_id }
            : {}),
        };
        await postApi("/api/staff", payload);
        setShowAddModal(false);
        fetchStaff();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = (staffId: string) => {
    pendingDeactivateIdRef.current = staffId;
    setShowDeactivateConfirm(true);
  };

  const handleDeactivateConfirm = async () => {
    const staffId = pendingDeactivateIdRef.current;
    setShowDeactivateConfirm(false);
    pendingDeactivateIdRef.current = "";
    try {
      await postApi(`/api/staff/${staffId}`, {}, { method: "DELETE" });
      fetchStaff();
      setSelectedStaff(null);
      setEditMode(false);
    } catch (err) {
      console.error("Failed to deactivate:", err);
    }
  };

  // Group filtered staff by department
  const groupedStaff = filteredStaff.reduce((acc, s) => {
    const dept = s.department || "Other";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(s);
    return acc;
  }, {} as Record<string, Staff[]>);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Staff Management</h1>
        <button
          onClick={openAdd}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--foreground)",
            color: "var(--background)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          + Add Staff
        </button>
      </div>

      {/* View Toggle */}
      <div style={{ display: "flex", gap: "0", marginBottom: "1.5rem", borderBottom: "1px solid var(--border)" }}>
        {(["directory", "accounts"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: "0.5rem 1.25rem",
              background: "transparent",
              border: "none",
              borderBottom: viewMode === mode ? "2px solid var(--primary)" : "2px solid transparent",
              color: viewMode === mode ? "var(--foreground)" : "var(--text-muted)",
              fontWeight: viewMode === mode ? 600 : 400,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {mode === "directory" ? "Directory" : "Accounts"}
          </button>
        ))}
      </div>

      {/* Accounts Table View */}
      {viewMode === "accounts" && (
        <div>
          {authLoading ? (
            <SkeletonTable rows={8} columns={5} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Name</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Email</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Auth Role</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Password</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Last Login</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600, textAlign: "right" }}>Logins</th>
                    <th style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {authStaff.map((s) => (
                    <tr
                      key={s.staff_id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: "0.6rem 0.5rem", fontWeight: 500 }}>
                        <a
                          href={`/admin/staff/${s.staff_id}?from=staff`}
                          style={{ color: "var(--primary)", textDecoration: "none" }}
                        >
                          {s.display_name}
                        </a>
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", color: "var(--text-muted)" }}>
                        {s.email || "—"}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 500,
                            background: s.auth_role === "admin" ? "#ede9fe" : s.auth_role === "staff" ? "#e0f2fe" : "#f0fdf4",
                            color: s.auth_role === "admin" ? "#6d28d9" : s.auth_role === "staff" ? "#0369a1" : "#15803d",
                          }}
                        >
                          {s.auth_role}
                        </span>
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 500,
                            background: s.password_status === "set" ? "#dcfce7"
                              : s.password_status === "default" ? "#fef3c7"
                              : "#fee2e2",
                            color: s.password_status === "set" ? "#166534"
                              : s.password_status === "default" ? "#92400e"
                              : "#b91c1c",
                          }}
                        >
                          {s.password_status === "set" ? "Set" : s.password_status === "default" ? "Default" : "Not Set"}
                        </span>
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                        {formatTimeAgo(s.last_login)}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", color: "var(--text-muted)" }}>
                        {s.login_count}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        {s.email && (
                          <button
                            onClick={() => {
                              // Smart: never logged in → welcome, otherwise → reset
                              const type = s.login_count === 0 ? "welcome" : "reset";
                              openEmailDrawer(s, type);
                            }}
                            style={{
                              padding: "0.25rem 0.5rem",
                              fontSize: "0.75rem",
                              background: s.login_count === 0 ? "var(--primary, #4291df)" : "transparent",
                              color: s.login_count === 0 ? "#fff" : "var(--foreground)",
                              border: s.login_count === 0 ? "none" : "1px solid var(--border)",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            {s.login_count === 0 ? "Send Welcome Email" : "Send Reset Email"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {authStaff.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                  No active staff found
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Directory View */}
      {viewMode === "directory" && <>
      {/* Search + Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search name, email, phone, role..."
          defaultValue={filters.search}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.875rem",
            minWidth: "220px",
          }}
        />
        <select
          value={filters.department}
          onChange={(e) => setFilter("department", e.target.value)}
          style={{ padding: "0.5rem", minWidth: "150px", border: "1px solid var(--border)", borderRadius: "6px" }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            checked={filters.showInactive === "true"}
            onChange={(e) => setFilter("showInactive", e.target.checked ? "true" : "false")}
          />
          Show inactive
        </label>

        {!isDefault && (
          <button
            onClick={clearFilters}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            Clear Filters
          </button>
        )}

        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.875rem" }}>
          {filteredStaff.length} of {staff.length} staff
        </span>
      </div>

      {/* Role Filter Chips */}
      {allRoles.length > 0 && (
        <div style={{ display: "flex", gap: "0.375rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <button
            onClick={() => setFilter("role", "")}
            style={{
              padding: "0.2rem 0.6rem",
              fontSize: "0.75rem",
              borderRadius: "9999px",
              border: "1px solid var(--border)",
              background: !filters.role ? "var(--foreground)" : "transparent",
              color: !filters.role ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            All Roles
          </button>
          {allRoles.map((role) => {
            const count = staff.filter(s => s.role === role).length;
            const isActive = filters.role === role;
            return (
              <button
                key={role}
                onClick={() => setFilter("role", isActive ? "" : role)}
                style={{
                  padding: "0.2rem 0.6rem",
                  fontSize: "0.75rem",
                  borderRadius: "9999px",
                  border: "1px solid var(--border)",
                  background: isActive ? "var(--foreground)" : "transparent",
                  color: isActive ? "var(--background)" : "inherit",
                  cursor: "pointer",
                }}
              >
                {role} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "2rem" }}>
          <SkeletonTable rows={6} columns={4} />
        </div>
      ) : filteredStaff.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No staff found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {Object.entries(groupedStaff)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dept, members]) => (
              <div key={dept}>
                <h3 style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.9rem", fontWeight: 500 }}>
                  {dept} ({members.length})
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                  {members.map((s) => (
                    <div
                      key={s.staff_id}
                      onClick={() => openEdit(s)}
                      style={{
                        padding: "1rem",
                        background: "var(--card-bg, rgba(0,0,0,0.05))",
                        borderRadius: "8px",
                        cursor: "pointer",
                        opacity: s.is_active ? 1 : 0.6,
                        border: "1px solid transparent",
                        transition: "border-color 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "1rem" }}>{s.display_name}</div>
                          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{s.role}</div>
                        </div>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {s.person_id && (
                            <span style={{
                              fontSize: "0.65rem",
                              padding: "0.125rem 0.4rem",
                              background: "#dcfce7",
                              color: "#166534",
                              borderRadius: "3px",
                            }}>
                              Linked
                            </span>
                          )}
                          {s.ai_access_level && s.ai_access_level !== "none" && (
                            <span style={{
                              fontSize: "0.65rem",
                              padding: "0.125rem 0.4rem",
                              background: s.ai_access_level === "full" ? "#6f42c1" :
                                s.ai_access_level === "read_write" ? "#198754" : "#0d6efd",
                              color: "#fff",
                              borderRadius: "3px",
                            }}>
                              AI: {s.ai_access_level === "read_write" ? "R/W" : s.ai_access_level === "read_only" ? "RO" : s.ai_access_level}
                            </span>
                          )}
                          {!s.is_active && (
                            <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", background: "#dc3545", color: "#fff", borderRadius: "4px" }}>
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Contact actions */}
                      <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        {s.email && (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <a
                              href={`mailto:${s.email}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}
                              title={`Email ${s.email}`}
                            >
                              {s.email}
                            </a>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(s.email!, s.staff_id + "-email"); }}
                              style={{
                                padding: "0.1rem 0.3rem",
                                fontSize: "0.65rem",
                                background: copiedId === s.staff_id + "-email" ? "#dcfce7" : "transparent",
                                border: "1px solid var(--border)",
                                borderRadius: "3px",
                                cursor: "pointer",
                                color: copiedId === s.staff_id + "-email" ? "#166534" : "var(--text-muted)",
                              }}
                              title="Copy email"
                            >
                              {copiedId === s.staff_id + "-email" ? "Copied" : "Copy"}
                            </button>
                          </div>
                        )}
                        {s.phone && (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <a
                              href={`tel:${s.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}
                              title={`Call ${formatPhone(s.phone)}`}
                            >
                              {formatPhone(s.phone)}
                              {s.work_extension && ` ext. ${s.work_extension}`}
                            </a>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(s.phone!, s.staff_id + "-phone"); }}
                              style={{
                                padding: "0.1rem 0.3rem",
                                fontSize: "0.65rem",
                                background: copiedId === s.staff_id + "-phone" ? "#dcfce7" : "transparent",
                                border: "1px solid var(--border)",
                                borderRadius: "3px",
                                cursor: "pointer",
                                color: copiedId === s.staff_id + "-phone" ? "#166534" : "var(--text-muted)",
                              }}
                              title="Copy phone"
                            >
                              {copiedId === s.staff_id + "-phone" ? "Copied" : "Copy"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      </>}

      {/* Edit Modal */}
      {editMode && selectedStaff && (
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
          onClick={() => { setEditMode(false); setSelectedStaff(null); }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Edit Staff Member</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  First Name *
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Phone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Work Extension
                </label>
                <input
                  type="text"
                  value={formData.work_extension}
                  onChange={(e) => setFormData({ ...formData, work_extension: e.target.value })}
                  placeholder="(707) 756-7999 ext."
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Role *
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Department
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  <option value="">Select...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Hire Date
                </label>
                <input
                  type="date"
                  value={formData.hired_date}
                  onChange={(e) => setFormData({ ...formData, hired_date: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>

            {/* AI Access Level - Full width */}
            <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--card-bg, rgba(0,0,0,0.03))", borderRadius: "8px" }}>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Tippy AI Access Level
              </label>
              <select
                value={formData.ai_access_level}
                onChange={(e) => setFormData({ ...formData, ai_access_level: e.target.value })}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                {AI_ACCESS_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                {AI_ACCESS_LEVELS.find(l => l.value === formData.ai_access_level)?.description}
              </p>
            </div>

            {selectedStaff.source_record_id && (
              <p style={{ margin: "1rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                Synced from Airtable. Changes here will be overwritten on next sync.
              </p>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              {selectedStaff.is_active && (
                <button
                  onClick={() => handleDeactivate(selectedStaff.staff_id)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#dc3545",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Deactivate
                </button>
              )}
              <button
                onClick={() => { setEditMode(false); setSelectedStaff(null); }}
                style={{
                  padding: "0.5rem 1rem",
                  marginLeft: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
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
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Add Staff Member</h2>

            {/* Person search — link to existing or create new */}
            <div style={{ marginBottom: "1rem" }}>
              <PersonReferencePicker
                value={linkedPerson}
                onChange={handlePersonLinked}
                label="Person"
                placeholder="Search existing people or type a name..."
                allowCreate
              />
              {linkedPerson.is_resolved && linkedPerson.person_id && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#166534", background: "#dcfce7", padding: "0.4rem 0.75rem", borderRadius: "6px" }}>
                  Linked to existing person record. Name, email, and phone pre-filled below.
                </p>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  First Name *
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Phone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Role *
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="e.g. Clinic Coordinator"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Department
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  <option value="">Select...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                {saving ? "Creating..." : "Create Staff"}
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  padding: "0.5rem 1rem",
                  marginLeft: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview & Send Drawer */}
      <ActionDrawer
        isOpen={emailDrawerOpen}
        onClose={() => setEmailDrawerOpen(false)}
        title={emailDrawerStaff ? `Email ${emailDrawerStaff.display_name}` : "Send Email"}
        width="xl"
        footer={
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
            <Button variant="secondary" onClick={() => setEmailDrawerOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="send"
              onClick={handleEmailSend}
              loading={emailSending}
            >
              Send Email
            </Button>
          </div>
        }
      >
        {emailPreviewLoading ? (
          <div style={{ padding: "2rem", color: "var(--text-muted)", textAlign: "center" }}>
            Rendering preview...
          </div>
        ) : (
          <div>
            {/* Type toggle */}
            {emailDrawerStaff && (
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                {(["welcome", "reset"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      if (t !== emailDrawerType && emailDrawerStaff) {
                        openEmailDrawer(emailDrawerStaff, t);
                      }
                    }}
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.8rem",
                      borderRadius: "6px",
                      border: emailDrawerType === t ? "none" : "1px solid var(--border)",
                      background: emailDrawerType === t ? "var(--primary, #4291df)" : "transparent",
                      color: emailDrawerType === t ? "#fff" : "var(--foreground)",
                      cursor: "pointer",
                    }}
                  >
                    {t === "welcome" ? "Welcome (Login Info)" : "Password Reset"}
                  </button>
                ))}
              </div>
            )}

            {/* Recipient + Subject */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                  To
                </label>
                <input
                  type="email"
                  value={emailPreviewRecipient}
                  onChange={(e) => setEmailPreviewRecipient(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                  Subject
                </label>
                <input
                  type="text"
                  value={emailPreviewSubject}
                  onChange={(e) => setEmailPreviewSubject(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                  }}
                />
              </div>
            </div>

            {/* Editable body */}
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              Body <span style={{ fontWeight: 400 }}>(click anywhere to edit)</span>
            </div>
            <div
              ref={emailEditorRef}
              contentEditable={true}
              suppressContentEditableWarning={true}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "24px",
                background: "#fff",
                minHeight: "350px",
                overflowY: "auto",
                outline: "none",
                lineHeight: 1.55,
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                color: "#222",
                cursor: "text",
              }}
            />

            {emailDrawerType === "reset" && (
              <p style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                Note: The code &quot;123456&quot; above is a placeholder. The actual reset code is generated
                when the staff member uses &quot;Forgot password?&quot; on the login page.
              </p>
            )}
          </div>
        )}
      </ActionDrawer>

      <ConfirmDialog
        open={showDeactivateConfirm}
        title="Deactivate Staff Member"
        message="Are you sure you want to deactivate this staff member?"
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={handleDeactivateConfirm}
        onCancel={() => {
          setShowDeactivateConfirm(false);
          pendingDeactivateIdRef.current = "";
        }}
      />
    </div>
  );
}

export default function StaffManagementPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonTable rows={6} columns={4} /></div>}>
      <StaffManagementContent />
    </Suspense>
  );
}
