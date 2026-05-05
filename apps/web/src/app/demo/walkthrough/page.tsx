"use client";

/**
 * /demo/walkthrough — Redirect to the static HTML walkthrough.
 *
 * The walkthrough now lives at /walkthrough/ (public/walkthrough/index.html)
 * so the Beacon team can edit it directly without touching React code.
 * This page preserves the old URL for any existing bookmarks/links.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WalkthroughRedirect() {
  const router = useRouter();

  useEffect(() => {
    window.location.href = "/walkthrough/";
  }, []);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "#0a0a0f",
      color: "rgba(255,255,255,0.5)",
      fontSize: "0.9rem",
    }}>
      Redirecting to walkthrough&hellip;
    </div>
  );
}
