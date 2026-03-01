"use client";

import Link from "next/link";

interface DuplicateMatch {
  request_id: string;
  summary: string | null;
  status: string;
  trapper_name: string | null;
  place_address: string | null;
  place_city: string | null;
  created_at: string;
  match_type: "exact_place" | "same_phone" | "same_email" | "nearby_address";
  distance_m: number | null;
}

interface ActiveRequestWarningProps {
  matches: DuplicateMatch[];
  onDismiss: () => void;
  onLinkToRequest?: (requestId: string) => void;
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact_place: "Same address",
  same_phone: "Same phone",
  same_email: "Same email",
  nearby_address: "Nearby location",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  working: "bg-yellow-100 text-yellow-800",
  paused: "bg-gray-100 text-gray-800",
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

export default function ActiveRequestWarning({
  matches,
  onDismiss,
  onLinkToRequest,
}: ActiveRequestWarningProps) {
  if (matches.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 mt-3">
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-amber-800">
              {matches.length === 1
                ? "Active Request at This Location"
                : `${matches.length} Active Requests Found`}
            </h4>
            <button
              onClick={onDismiss}
              className="text-amber-600 hover:text-amber-800 p-1 text-lg leading-none"
              aria-label="Dismiss warning"
            >
              &times;
            </button>
          </div>

          <div className="mt-2 space-y-3">
            {matches.slice(0, 3).map((match) => (
              <div
                key={match.request_id}
                className="bg-white rounded-md border border-amber-200 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {match.summary || "Untitled Request"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[match.status] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {match.status}
                      </span>
                      {match.trapper_name && (
                        <span>Trapper: {match.trapper_name}</span>
                      )}
                      <span>Created {formatTimeAgo(match.created_at)}</span>
                    </div>
                    {match.place_address && (
                      <p className="mt-1 text-xs text-gray-500 truncate">
                        {match.place_address}
                        {match.place_city && `, ${match.place_city}`}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-amber-700">
                      Match: {MATCH_TYPE_LABELS[match.match_type] || match.match_type}
                      {match.match_type === "nearby_address" &&
                        match.distance_m != null && (
                          <span> ({Math.round(match.distance_m)}m away)</span>
                        )}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/requests/${match.request_id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                  >
                    View Request ↗
                  </Link>
                  {onLinkToRequest && (
                    <button
                      onClick={() => onLinkToRequest(match.request_id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
                    >
                      Update This Request →
                    </button>
                  )}
                </div>
              </div>
            ))}

            {matches.length > 3 && (
              <p className="text-xs text-amber-700">
                + {matches.length - 3} more matching requests
              </p>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-amber-200">
            <p className="text-xs text-amber-700">
              You can still create a new request by filling out the form and submitting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
