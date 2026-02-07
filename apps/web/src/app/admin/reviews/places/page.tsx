"use client";

// Re-export the place-dedup page at its new location
// The original is at /admin/place-dedup but we want it accessible at /admin/reviews/places
import PlaceDedupPage from "@/app/admin/place-dedup/page";

export default function PlacesReviewPage() {
  return <PlaceDedupPage />;
}
