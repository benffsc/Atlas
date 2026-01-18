"use client";

import { useState, useEffect } from "react";

interface PendingReview {
  decision_id: string;
  source_system: string;
  incoming_email: string | null;
  incoming_phone: string | null;
  incoming_name: string | null;
  incoming_address: string | null;
  top_candidate_person_id: string | null;
  top_candidate_name: string | null;
  top_candidate_score: number | null;
  score_breakdown: {
    email_score?: number;
    phone_score?: number;
    name_score?: number;
    address_score?: number;
  } | null;
  decision_reason: string | null;
  processed_at: string;
}

interface ReviewResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default function DataEngineReviewPage() {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchReviews = async () => {
    try {
      const res = await fetch("/api/admin/data-engine/review?limit=50");
      if (!res.ok) throw new Error("Failed to fetch reviews");
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleAction = async (decisionId: string, action: "approve" | "reject" | "merge") => {
    setActionLoading(decisionId);
    try {
      const res = await fetch(`/api/admin/data-engine/review/${decisionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data: ReviewResponse = await res.json();

      if (data.success) {
        // Remove from list
        setReviews((prev) => prev.filter((r) => r.decision_id !== decisionId));
      } else {
        alert(data.error || "Action failed");
      }
    } catch {
      alert("Failed to perform action");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1>Match Review Queue</h1>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1>Match Review Queue</h1>
        <div className="card" style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}>
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Match Review Queue</h1>
          <p className="text-muted">
            Review uncertain identity matches that need human decision
          </p>
        </div>
        <a
          href="/admin/data-engine"
          className="btn btn-secondary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          Back to Data Engine
        </a>
      </div>

      {/* Stats Bar */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", gap: "2rem" }}>
        <div>
          <span className="text-muted">Pending:</span>{" "}
          <strong>{reviews.length}</strong>
        </div>
        <div className="text-muted text-sm" style={{ marginLeft: "auto" }}>
          Matches with 50-94% confidence need human review
        </div>
      </div>

      {/* Review List */}
      {reviews.length === 0 ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>No pending reviews</div>
          <p className="text-muted">All identity matches have been resolved</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {reviews.map((review) => (
            <ReviewCard
              key={review.decision_id}
              review={review}
              onAction={handleAction}
              loading={actionLoading === review.decision_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  onAction,
  loading,
}: {
  review: PendingReview;
  onAction: (id: string, action: "approve" | "reject" | "merge") => void;
  loading: boolean;
}) {
  const scoreBreakdown = review.score_breakdown || {};

  return (
    <div className="card" style={{ padding: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <span
            style={{
              padding: "0.125rem 0.5rem",
              borderRadius: "4px",
              background: "#eff6ff",
              color: "#2563eb",
              fontSize: "0.75rem",
              fontWeight: 500,
              marginRight: "0.5rem",
            }}
          >
            {review.source_system}
          </span>
          <span className="text-muted text-sm">
            {new Date(review.processed_at).toLocaleString()}
          </span>
        </div>
        {review.top_candidate_score && (
          <div
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "4px",
              background: "#fef3c7",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            {(review.top_candidate_score * 100).toFixed(0)}% match
          </div>
        )}
      </div>

      {/* Comparison */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {/* Incoming */}
        <div style={{ padding: "1rem", background: "var(--card-border)", borderRadius: "8px" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            Incoming Data
          </div>
          {review.incoming_name && (
            <div style={{ marginBottom: "0.25rem" }}>
              <span className="text-muted">Name:</span> {review.incoming_name}
            </div>
          )}
          {review.incoming_email && (
            <div style={{ marginBottom: "0.25rem" }}>
              <span className="text-muted">Email:</span> {review.incoming_email}
            </div>
          )}
          {review.incoming_phone && (
            <div style={{ marginBottom: "0.25rem" }}>
              <span className="text-muted">Phone:</span> {review.incoming_phone}
            </div>
          )}
          {review.incoming_address && (
            <div style={{ marginBottom: "0.25rem" }}>
              <span className="text-muted">Address:</span> {review.incoming_address}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div style={{ display: "flex", alignItems: "center", fontSize: "1.5rem" }}>
          ?
        </div>

        {/* Candidate */}
        <div style={{ padding: "1rem", background: "var(--card-border)", borderRadius: "8px" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            Best Candidate
          </div>
          {review.top_candidate_person_id ? (
            <>
              <div style={{ marginBottom: "0.25rem" }}>
                <span className="text-muted">Name:</span>{" "}
                <a href={`/people/${review.top_candidate_person_id}`}>
                  {review.top_candidate_name || "Unknown"}
                </a>
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Score Breakdown:</div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
                  {scoreBreakdown.email_score !== undefined && (
                    <ScorePill label="Email" score={scoreBreakdown.email_score} />
                  )}
                  {scoreBreakdown.phone_score !== undefined && (
                    <ScorePill label="Phone" score={scoreBreakdown.phone_score} />
                  )}
                  {scoreBreakdown.name_score !== undefined && (
                    <ScorePill label="Name" score={scoreBreakdown.name_score} />
                  )}
                  {scoreBreakdown.address_score !== undefined && (
                    <ScorePill label="Address" score={scoreBreakdown.address_score} />
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-muted">No candidate found</div>
          )}
        </div>
      </div>

      {/* Reason */}
      {review.decision_reason && (
        <div className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
          <strong>Reason:</strong> {review.decision_reason}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid var(--card-border)", paddingTop: "1rem" }}>
        {review.top_candidate_person_id && (
          <button
            onClick={() => onAction(review.decision_id, "merge")}
            disabled={loading}
            className="btn btn-primary"
            style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
          >
            {loading ? "..." : "Merge (Same Person)"}
          </button>
        )}
        <button
          onClick={() => onAction(review.decision_id, "approve")}
          disabled={loading}
          className="btn btn-secondary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
        >
          {loading ? "..." : "Keep Separate"}
        </button>
        <button
          onClick={() => onAction(review.decision_id, "reject")}
          disabled={loading}
          className="btn"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
            color: "#dc2626",
          }}
        >
          {loading ? "..." : "Reject / Bad Data"}
        </button>
      </div>
    </div>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  const pct = (score * 100).toFixed(0);
  const color = score >= 0.8 ? "#10b981" : score >= 0.5 ? "#f59e0b" : "#ef4444";

  return (
    <span
      style={{
        padding: "0.125rem 0.375rem",
        borderRadius: "4px",
        background: `${color}20`,
        color: color,
        fontWeight: 500,
      }}
    >
      {label}: {pct}%
    </span>
  );
}
