"use client";

import { DedupPageLayout } from "@/components/admin/dedup";
import type { DedupConfig } from "@/components/admin/dedup";

interface DedupCandidate {
  canonical_person_id: string;
  duplicate_person_id: string;
  match_tier: number;
  shared_email: string | null;
  shared_phone: string | null;
  canonical_name: string;
  duplicate_name: string;
  name_similarity: number;
  canonical_created_at: string;
  duplicate_created_at: string;
  canonical_identifiers: number;
  canonical_places: number;
  canonical_cats: number;
  canonical_requests: number;
  duplicate_identifiers: number;
  duplicate_places: number;
  duplicate_cats: number;
  duplicate_requests: number;
  shared_place_count: number;
}

function PersonStats({
  identifiers,
  places,
  cats,
  requests,
}: {
  identifiers: number;
  places: number;
  cats: number;
  requests: number;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem", flexWrap: "wrap" }}>
      <span title="Identifiers (emails, phones)">{identifiers} IDs</span>
      <span title="Places linked">{places} places</span>
      <span title="Cat relationships">{cats} cats</span>
      <span title="Requests as requester">{requests} requests</span>
    </div>
  );
}

const TIER_TABS = [
  { value: "0", label: "All", color: "#6c757d" },
  { value: "1", label: "Email Match", color: "#198754" },
  { value: "2", label: "Phone + Name", color: "#0d6efd" },
  { value: "3", label: "Phone Only", color: "#fd7e14" },
  { value: "4", label: "Name + Place", color: "#6f42c1" },
  { value: "5", label: "Name Only", color: "#dc3545" },
  { value: "6", label: "Phonetic + Address", color: "#20c997" },
];

const config: DedupConfig<DedupCandidate> = {
  entityName: "Person",
  apiPath: "/api/admin/person-dedup",
  description:
    "Comprehensive duplicate detection across email, phone, and name signals. Review and resolve candidate pairs.",

  tabs: TIER_TABS,
  filterParamName: "tier",
  defaultFilterValue: "0",
  summaryGroupKey: "match_tier",

  getPairKey: (c) => `${c.canonical_person_id}|${c.duplicate_person_id}`,
  getSinglePayload: (c) => ({
    canonical_person_id: c.canonical_person_id,
    duplicate_person_id: c.duplicate_person_id,
  }),
  getBatchPairPayload: (key) => {
    const [canonical_person_id, duplicate_person_id] = key.split("|");
    return { canonical_person_id, duplicate_person_id };
  },

  actions: [
    { key: "keep_separate", label: "Keep Separate", batchLabel: "Keep Separate All", color: "#198754" },
    { key: "merge", label: "Merge", batchLabel: "Merge All", color: "#fd7e14" },
    { key: "dismiss", label: "Skip", batchLabel: "Dismiss All", color: "#6c757d" },
  ],

  getTierValue: (c) => String(c.match_tier),

  renderCanonical: (c) => (
    <div
      style={{
        padding: "0.75rem",
        background: "rgba(25, 135, 84, 0.08)",
        borderRadius: "8px",
        border: "1px solid rgba(25, 135, 84, 0.2)",
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          textTransform: "uppercase",
          color: "#198754",
          marginBottom: "0.25rem",
          fontWeight: 600,
        }}
      >
        Keep (Canonical)
      </div>
      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.5rem" }}>
        <a href={`/people/${c.canonical_person_id}`}>{c.canonical_name || "(no name)"}</a>
      </div>
      <PersonStats
        identifiers={c.canonical_identifiers}
        places={c.canonical_places}
        cats={c.canonical_cats}
        requests={c.canonical_requests}
      />
      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
        Created {new Date(c.canonical_created_at).toLocaleDateString()}
      </div>
    </div>
  ),

  renderDuplicate: (c) => (
    <div
      style={{
        padding: "0.75rem",
        background: "rgba(108, 117, 125, 0.08)",
        borderRadius: "8px",
        border: "1px solid rgba(108, 117, 125, 0.2)",
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          textTransform: "uppercase",
          color: "#6c757d",
          marginBottom: "0.25rem",
          fontWeight: 600,
        }}
      >
        Merge Into Canonical
      </div>
      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.5rem" }}>
        <a href={`/people/${c.duplicate_person_id}`}>{c.duplicate_name || "(no name)"}</a>
      </div>
      <PersonStats
        identifiers={c.duplicate_identifiers}
        places={c.duplicate_places}
        cats={c.duplicate_cats}
        requests={c.duplicate_requests}
      />
      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
        Created {new Date(c.duplicate_created_at).toLocaleDateString()}
      </div>
    </div>
  ),

  renderCenter: (c) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "60px",
      }}
    >
      <div
        style={{
          fontSize: "1.4rem",
          fontWeight: 700,
          color:
            c.name_similarity >= 0.8
              ? "#198754"
              : c.name_similarity >= 0.5
                ? "#fd7e14"
                : "#dc3545",
        }}
      >
        {Math.round(c.name_similarity * 100)}%
      </div>
      <div className="text-muted" style={{ fontSize: "0.7rem" }}>
        name match
      </div>
    </div>
  ),

  renderHeaderMeta: (c) => (
    <>
      {c.shared_email && <span className="text-muted text-sm">Email: {c.shared_email}</span>}
      {c.shared_phone && <span className="text-muted text-sm">Phone: {c.shared_phone}</span>}
      {c.shared_place_count > 0 && (
        <span className="text-muted text-sm">
          {c.shared_place_count} shared place{c.shared_place_count !== 1 ? "s" : ""}
        </span>
      )}
    </>
  ),
};

export default function PersonDedupPage() {
  return <DedupPageLayout config={config} />;
}
