"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy Duplicates Page - Redirects to Data Hub
 *
 * The duplicates functionality has been consolidated into the unified Data Hub
 * at /admin/data with the Review Queue tab for identity and place duplicates.
 */
export default function DuplicatesRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to Data Hub with review tab selected
    router.replace("/admin/data?tab=review");
  }, [router]);

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Redirecting...</h1>
      <p className="text-muted">
        The Duplicates page has been consolidated into the{" "}
        <a href="/admin/data">Data Hub</a>.
      </p>
      <p className="text-muted text-sm" style={{ marginTop: "1rem" }}>
        If you are not redirected automatically,{" "}
        <a href="/admin/data?tab=review">click here</a>.
      </p>
    </div>
  );
}
