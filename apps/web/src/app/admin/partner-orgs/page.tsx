"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_name_patterns: string[];
  org_type: string;
  place_id: string | null;
  facility_address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  relationship_type: string;
  is_active: boolean;
  appointments_count: number;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  notes: string | null;
}

interface Stats {
  total_org_appts: number;
  with_partner_org: number;
  with_place: number;
  fully_linked: number;
}

interface NewOrgForm {
  org_name: string;
  org_name_short: string;
  org_type: string;
  address: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  relationship_type: string;
  notes: string;
  patterns: string;
}

const ORG_TYPES = [
  { value: "rescue", label: "Rescue" },
  { value: "shelter", label: "Shelter" },
  { value: "animal_services", label: "Animal Services" },
  { value: "vet_clinic", label: "Vet Clinic" },
  { value: "other", label: "Other" },
];

const RELATIONSHIP_TYPES = [
  { value: "partner", label: "Partner" },
  { value: "referral_source", label: "Referral Source" },
  { value: "transfer_destination", label: "Transfer Destination" },
  { value: "vendor", label: "Vendor" },
];

export default function PartnerOrgsPage() {
  const [orgs, setOrgs] = useState<PartnerOrg[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<PartnerOrg | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [newOrg, setNewOrg] = useState<NewOrgForm>({
    org_name: "",
    org_name_short: "",
    org_type: "rescue",
    address: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    relationship_type: "partner",
    notes: "",
    patterns: "",
  });

  useEffect(() => {
    fetchOrgs();
  }, [showInactive]);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/partner-orgs?include_inactive=${showInactive}`
      );
      const data = await res.json();
      setOrgs(data.organizations || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching orgs:", error);
    }
    setLoading(false);
  };

  const handleAddOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const patterns = newOrg.patterns
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p);

      const res = await fetch("/api/admin/partner-orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newOrg,
          org_name_patterns: patterns,
        }),
      });

      if (res.ok) {
        setShowAddForm(false);
        setNewOrg({
          org_name: "",
          org_name_short: "",
          org_type: "rescue",
          address: "",
          contact_name: "",
          contact_email: "",
          contact_phone: "",
          relationship_type: "partner",
          notes: "",
          patterns: "",
        });
        fetchOrgs();
      }
    } catch (error) {
      console.error("Error adding org:", error);
    }
  };

  const handleUpdateOrg = async (orgId: string, updates: Partial<PartnerOrg>) => {
    try {
      const res = await fetch(`/api/admin/partner-orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        setEditingOrg(null);
        fetchOrgs();
      }
    } catch (error) {
      console.error("Error updating org:", error);
    }
  };

  const handleDeleteOrg = async (orgId: string) => {
    if (!confirm("Are you sure you want to deactivate this organization?")) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/partner-orgs/${orgId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchOrgs();
      }
    } catch (error) {
      console.error("Error deleting org:", error);
    }
  };

  const coveragePercent = stats
    ? Math.round((stats.fully_linked / stats.total_org_appts) * 100)
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Partner Organizations</h1>
          <p className="text-gray-600">
            Manage rescues, shelters, and other partner orgs that bring cats to
            FFSC
          </p>
        </div>
        <Link
          href="/admin"
          className="text-blue-600 hover:text-blue-800"
        >
          Back to Admin
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Org Appointments</div>
            <div className="text-2xl font-bold">{stats.total_org_appts}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">With Partner Org</div>
            <div className="text-2xl font-bold text-green-600">
              {stats.with_partner_org}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">With Place</div>
            <div className="text-2xl font-bold text-blue-600">
              {stats.with_place}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Coverage</div>
            <div className="text-2xl font-bold text-purple-600">
              {coveragePercent}%
            </div>
            <div className="text-xs text-gray-400">
              {stats.fully_linked} / {stats.total_org_appts}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-between items-center mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm">Show inactive</span>
        </label>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Partner Org
        </button>
      </div>

      {/* Add Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Add Partner Organization</h2>
            <form onSubmit={handleAddOrg} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  value={newOrg.org_name}
                  onChange={(e) =>
                    setNewOrg({ ...newOrg, org_name: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Short Name
                  </label>
                  <input
                    type="text"
                    value={newOrg.org_name_short}
                    onChange={(e) =>
                      setNewOrg({ ...newOrg, org_name_short: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    placeholder="e.g., SCAS"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Type *
                  </label>
                  <select
                    value={newOrg.org_type}
                    onChange={(e) =>
                      setNewOrg({ ...newOrg, org_type: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    {ORG_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={newOrg.address}
                  onChange={(e) =>
                    setNewOrg({ ...newOrg, address: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  placeholder="123 Main St, City, CA 12345"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Matching Patterns (one per line)
                </label>
                <textarea
                  value={newOrg.patterns}
                  onChange={(e) =>
                    setNewOrg({ ...newOrg, patterns: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="%Organization Name%&#10;%Alt Name%"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use % as wildcard. These patterns match against ClinicHQ owner
                  names.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={newOrg.contact_name}
                    onChange={(e) =>
                      setNewOrg({ ...newOrg, contact_name: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Relationship
                  </label>
                  <select
                    value={newOrg.relationship_type}
                    onChange={(e) =>
                      setNewOrg({
                        ...newOrg,
                        relationship_type: e.target.value,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  >
                    {RELATIONSHIP_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={newOrg.contact_email}
                    onChange={(e) =>
                      setNewOrg({ ...newOrg, contact_email: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={newOrg.contact_phone}
                    onChange={(e) =>
                      setNewOrg({ ...newOrg, contact_phone: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={newOrg.notes}
                  onChange={(e) =>
                    setNewOrg({ ...newOrg, notes: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add Organization
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Organizations Table */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organization
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Appointments
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patterns
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orgs.map((org) => (
                <tr
                  key={org.org_id}
                  className={!org.is_active ? "opacity-50" : ""}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{org.org_name}</div>
                    {org.org_name_short && (
                      <div className="text-xs text-gray-500">
                        ({org.org_name_short})
                      </div>
                    )}
                    {org.facility_address && (
                      <div className="text-xs text-gray-400">
                        {org.facility_address}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        org.org_type === "rescue"
                          ? "bg-green-100 text-green-800"
                          : org.org_type === "shelter"
                          ? "bg-blue-100 text-blue-800"
                          : org.org_type === "animal_services"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {org.org_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{org.appointments_count}</div>
                    {org.last_appointment_date && (
                      <div className="text-xs text-gray-500">
                        Last: {org.last_appointment_date}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {org.contact_name && <div>{org.contact_name}</div>}
                    {org.contact_email && (
                      <div className="text-xs text-gray-500">
                        {org.contact_email}
                      </div>
                    )}
                    {org.contact_phone && (
                      <div className="text-xs text-gray-500">
                        {org.contact_phone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-600 max-w-xs truncate">
                      {org.org_name_patterns?.length || 0} patterns
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingOrg(org)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Edit
                      </button>
                      {org.is_active && (
                        <button
                          onClick={() => handleDeleteOrg(org.org_id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      {editingOrg && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Edit {editingOrg.org_name}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Matching Patterns (one per line)
                </label>
                <textarea
                  defaultValue={editingOrg.org_name_patterns?.join("\n") || ""}
                  id="edit-patterns"
                  className="w-full border rounded px-3 py-2"
                  rows={5}
                  placeholder="%Organization Name%&#10;%Alt Name%"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use % as wildcard. These patterns match against ClinicHQ owner
                  names.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  defaultValue={editingOrg.notes || ""}
                  id="edit-notes"
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const patternsEl = document.getElementById(
                      "edit-patterns"
                    ) as HTMLTextAreaElement;
                    const notesEl = document.getElementById(
                      "edit-notes"
                    ) as HTMLTextAreaElement;
                    const patterns = patternsEl.value
                      .split("\n")
                      .map((p) => p.trim())
                      .filter((p) => p);
                    handleUpdateOrg(editingOrg.org_id, {
                      org_name_patterns: patterns,
                      notes: notesEl.value,
                    } as Partial<PartnerOrg>);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
