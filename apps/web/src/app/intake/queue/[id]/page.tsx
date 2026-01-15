"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

/**
 * This page redirects to the unified intake queue page with the submission
 * opened in a modal. This ensures a consistent experience whether the user
 * clicks from the dashboard or from the queue.
 */
export default function SubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  // Redirect to the unified queue page with the submission opened in modal
  useEffect(() => {
    router.replace(`/intake/queue?open=${id}`);
  }, [id, router]);

  // Show loading state while redirecting
  return (
    <div>
      <a href="/intake/queue" style={{ color: "var(--muted)" }}>← Back to Queue</a>
      <div style={{ marginTop: "2rem" }}>Redirecting to queue...</div>
    </div>
  );
}
