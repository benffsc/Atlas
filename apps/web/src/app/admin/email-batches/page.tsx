"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BackButton } from "@/components/BackButton";

interface ReadyRequest {
  request_id: string;
  source_record_id: string;
  email_summary: string;
  requester_name: string;
  requester_email: string;
  formatted_address: string;
  estimated_cat_count: number | null;
  status: string;
  created_at: string;
}

interface TrapperGroup {
  trapper_person_id: string;
  trapper_name: string;
  trapper_email: string;
  requests: ReadyRequest[];
}

interface EmailBatch {
  batch_id: string;
  batch_type: string;
  recipient_email: string;
  recipient_name: string | null;
  outlook_account_id: string | null;
  subject: string;
  body_html: string;
  status: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  from_email?: string;
  created_by_name?: string;
  request_count?: number;
}

interface OutlookAccount {
  account_id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
}

type TabStatus = "ready" | "draft" | "sent" | "failed";

export default function EmailBatchesPage() {
  const [activeTab, setActiveTab] = useState<TabStatus>("ready");
  const [trapperGroups, setTrapperGroups] = useState<TrapperGroup[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [counts, setCounts] = useState({ draft: 0, sent: 0, failed: 0 });
  const [readyCount, setReadyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedRequests, setSelectedRequests] = useState<Record<string, Set<string>>>({});

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewBatch, setPreviewBatch] = useState<EmailBatch | null>(null);
  const [createTarget, setCreateTarget] = useState<TrapperGroup | null>(null);

  // Outlook accounts
  const [outlookAccounts, setOutlookAccounts] = useState<OutlookAccount[]>([]);

  // Create form state
  const [createForm, setCreateForm] = useState({
    subject: "",
    custom_intro: "",
    outlook_account_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const fetchReadyRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/email-batches?mode=ready-requests");
      if (!res.ok) throw new Error("Failed to fetch ready requests");
      const data = await res.json();
      setTrapperGroups(data.ready_requests || []);
      setReadyCount(data.total_count || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ready requests");
    }
  }, []);

  const fetchBatches = useCallback(async (status?: string) => {
    try {
      const url = status && status !== "all"
        ? `/api/admin/email-batches?status=${status}`
        : "/api/admin/email-batches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch batches");
      const data = await res.json();
      setBatches(data.batches || []);
      setCounts(data.counts || { draft: 0, sent: 0, failed: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load batches");
    }
  }, []);

  const fetchOutlookAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/email-settings/accounts");
      if (!res.ok) return;
      const data = await res.json();
      setOutlookAccounts(data.accounts || []);

      // Get default account for trapper category
      const catRes = await fetch("/api/admin/email-categories");
      if (catRes.ok) {
        const catData = await catRes.json();
        const trapperCat = catData.categories?.find((c: { category_key: string }) => c.category_key === "trapper");
        if (trapperCat?.default_outlook_account_id) {
          setCreateForm(prev => ({ ...prev, outlook_account_id: trapperCat.default_outlook_account_id }));
        }
      }
    } catch {
      // Ignore errors
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchReadyRequests(),
      fetchBatches(activeTab === "ready" ? undefined : activeTab),
      fetchOutlookAccounts(),
    ]).finally(() => setLoading(false));
  }, [activeTab, fetchReadyRequests, fetchBatches, fetchOutlookAccounts]);

  const toggleRequestSelection = (trapperId: string, requestId: string) => {
    setSelectedRequests(prev => {
      const trapperSet = new Set(prev[trapperId] || []);
      if (trapperSet.has(requestId)) {
        trapperSet.delete(requestId);
      } else {
        trapperSet.add(requestId);
      }
      return { ...prev, [trapperId]: trapperSet };
    });
  };

  const selectAllForTrapper = (trapperId: string, requests: ReadyRequest[]) => {
    setSelectedRequests(prev => ({
      ...prev,
      [trapperId]: new Set(requests.map(r => r.request_id)),
    }));
  };

  const deselectAllForTrapper = (trapperId: string) => {
    setSelectedRequests(prev => ({
      ...prev,
      [trapperId]: new Set(),
    }));
  };

  const openCreateModal = (group: TrapperGroup) => {
    setCreateTarget(group);
    const selectedIds = selectedRequests[group.trapper_person_id || "unassigned"];
    const count = selectedIds?.size || group.requests.length;
    setCreateForm({
      subject: `${count} Assignment${count > 1 ? "s" : ""} Ready for Trapping`,
      custom_intro: "",
      outlook_account_id: createForm.outlook_account_id,
    });
    setShowCreateModal(true);
  };

  const handleCreateBatch = async () => {
    if (!createTarget) return;

    setCreating(true);
    try {
      const trapperId = createTarget.trapper_person_id || "unassigned";
      const selectedIds = selectedRequests[trapperId];
      const requestIds = selectedIds && selectedIds.size > 0
        ? Array.from(selectedIds)
        : createTarget.requests.map(r => r.request_id);

      const res = await fetch("/api/admin/email-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_person_id: createTarget.trapper_person_id || null,
          recipient_email: createTarget.trapper_email,
          recipient_name: createTarget.trapper_name,
          request_ids: requestIds,
          outlook_account_id: createForm.outlook_account_id || undefined,
          subject: createForm.subject,
          custom_intro: createForm.custom_intro || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create batch");
      }

      setShowCreateModal(false);
      setCreateTarget(null);
      setSelectedRequests(prev => ({ ...prev, [trapperId]: new Set() }));
      setActiveTab("draft");
      await fetchReadyRequests();
      await fetchBatches("draft");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  };

  const handleSendBatch = async (batchId: string) => {
    setSending(batchId);
    try {
      const res = await fetch(`/api/admin/email-batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send batch");
      }

      await fetchBatches(activeTab === "ready" ? undefined : activeTab);
      await fetchReadyRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send batch");
    } finally {
      setSending(null);
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    if (!confirm("Cancel this batch? Requests will be unmarked and available again.")) return;

    try {
      const res = await fetch(`/api/admin/email-batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to cancel batch");
      }

      await fetchBatches(activeTab === "ready" ? undefined : activeTab);
      await fetchReadyRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel batch");
    }
  };

  const openPreview = async (batch: EmailBatch) => {
    setPreviewBatch(batch);
    setShowPreviewModal(true);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      sending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      sent: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Email Batches</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Batch emails for trapper assignments
          </p>
        </div>
        <BackButton fallbackHref="/admin" />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: "ready" as const, label: "Ready to Email", count: readyCount },
          { key: "draft" as const, label: "Drafts", count: counts.draft },
          { key: "sent" as const, label: "Sent", count: counts.sent },
          { key: "failed" as const, label: "Failed", count: counts.failed },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      ) : activeTab === "ready" ? (
        /* Ready to Email Tab */
        <div className="space-y-6">
          {trapperGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No requests marked ready to email
            </div>
          ) : (
            trapperGroups.map(group => {
              const trapperId = group.trapper_person_id || "unassigned";
              const selected = selectedRequests[trapperId] || new Set();
              const allSelected = selected.size === group.requests.length;

              return (
                <div
                  key={trapperId}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  {/* Trapper Header */}
                  <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {group.trapper_name}
                      </span>
                      {group.trapper_email && (
                        <span className="ml-2 text-gray-500 dark:text-gray-400 text-sm">
                          {group.trapper_email}
                        </span>
                      )}
                      <span className="ml-3 text-gray-400 dark:text-gray-500 text-sm">
                        {group.requests.length} request{group.requests.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => allSelected ? deselectAllForTrapper(trapperId) : selectAllForTrapper(trapperId, group.requests)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {allSelected ? "Deselect All" : "Select All"}
                      </button>
                      <button
                        onClick={() => openCreateModal(group)}
                        disabled={!group.trapper_email}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Create Batch ({selected.size || group.requests.length})
                      </button>
                    </div>
                  </div>

                  {/* Request List */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {group.requests.map(req => (
                      <div
                        key={req.request_id}
                        className={`px-4 py-3 flex items-start gap-3 ${
                          selected.has(req.request_id) ? "bg-blue-50 dark:bg-blue-900/20" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(req.request_id)}
                          onChange={() => toggleRequestSelection(trapperId, req.request_id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-white text-sm">
                              {req.formatted_address || "No address"}
                            </span>
                            {req.estimated_cat_count && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ~{req.estimated_cat_count} cats
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {req.requester_name}
                            {req.requester_email && ` • ${req.requester_email}`}
                          </div>
                          {req.email_summary && (
                            <div className="text-sm text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                              {req.email_summary}
                            </div>
                          )}
                          {!req.email_summary && (
                            <div className="text-sm text-orange-600 dark:text-orange-400 mt-1 italic">
                              No summary written
                            </div>
                          )}
                        </div>
                        <Link
                          href={`/requests/${req.request_id}`}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Batches List */
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {batches.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No {activeTab} batches
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Recipient
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Subject
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Requests
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {batches.map(batch => (
                  <tr key={batch.batch_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {batch.recipient_name || batch.recipient_email}
                      </div>
                      {batch.recipient_name && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {batch.recipient_email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 dark:text-white truncate max-w-xs">
                        {batch.subject}
                      </div>
                      {batch.from_email && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          from {batch.from_email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {batch.request_count || 0}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(batch.status)}
                      {batch.error_message && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1 truncate max-w-xs" title={batch.error_message}>
                          {batch.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {formatDate(batch.sent_at || batch.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openPreview(batch)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Preview
                        </button>
                        {batch.status === "draft" && (
                          <>
                            <button
                              onClick={() => handleSendBatch(batch.batch_id)}
                              disabled={sending === batch.batch_id}
                              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              {sending === batch.batch_id ? "Sending..." : "Send"}
                            </button>
                            <button
                              onClick={() => handleCancelBatch(batch.batch_id)}
                              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {batch.status === "failed" && (
                          <button
                            onClick={() => handleSendBatch(batch.batch_id)}
                            disabled={sending === batch.batch_id}
                            className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Create Batch Modal */}
      {showCreateModal && createTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Create Email Batch
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Send to {createTarget.trapper_name} ({createTarget.trapper_email})
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={createForm.subject}
                  onChange={e => setCreateForm(prev => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Custom Intro (optional)
                </label>
                <textarea
                  value={createForm.custom_intro}
                  onChange={e => setCreateForm(prev => ({ ...prev, custom_intro: e.target.value }))}
                  rows={3}
                  placeholder="Hi, here are your assignments..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Leave blank for default intro
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Send From
                </label>
                <select
                  value={createForm.outlook_account_id}
                  onChange={e => setCreateForm(prev => ({ ...prev, outlook_account_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select account...</option>
                  {outlookAccounts.map(acc => (
                    <option key={acc.account_id} value={acc.account_id}>
                      {acc.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>Requests included:</strong>{" "}
                  {(selectedRequests[createTarget.trapper_person_id || "unassigned"]?.size) || createTarget.requests.length}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateTarget(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBatch}
                disabled={creating || !createForm.subject || !createForm.outlook_account_id}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Batch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Email Preview
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  To: {previewBatch.recipient_email}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewBatch(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-auto flex-1">
              <div className="mb-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">Subject:</span>
                <span className="ml-2 text-gray-900 dark:text-white font-medium">
                  {previewBatch.subject}
                </span>
              </div>
              <div
                className="border border-gray-200 dark:border-gray-600 rounded p-4 bg-white dark:bg-gray-900"
                dangerouslySetInnerHTML={{ __html: previewBatch.body_html }}
              />
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewBatch(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
