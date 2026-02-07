"use client";

// Re-export the data-quality review page at its new location
// The original is at /admin/data-quality/review but we want it accessible at /admin/reviews/quality
import DataQualityReviewPage from "@/app/admin/data-quality/review/page";

export default function QualityReviewPage() {
  return <DataQualityReviewPage />;
}
