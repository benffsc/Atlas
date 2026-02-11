"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy ingest page - redirects to unified Data Hub
 *
 * The Data Hub (/admin/data?tab=processing) now provides:
 * - ClinicHQ batch upload with real-time progress
 * - Data source status for all integrations
 * - Entity linking pipeline stats
 * - Background job monitoring
 */
export default function IngestRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/data?tab=processing");
  }, [router]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "50vh",
      gap: "1rem"
    }}>
      <div className="spinner" style={{ width: "32px", height: "32px" }} />
      <p style={{ color: "var(--muted, #6b7280)" }}>
        Redirecting to Data Hub...
      </p>
    </div>
  );
}
