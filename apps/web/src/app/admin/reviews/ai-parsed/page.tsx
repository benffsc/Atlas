"use client";

// Re-export the needs-review page at its new location
// The original is at /admin/needs-review but we want it accessible at /admin/reviews/ai-parsed
import NeedsReviewPage from "@/app/admin/needs-review/page";

export default function AIParsedReviewPage() {
  return <NeedsReviewPage />;
}
