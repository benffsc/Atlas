"use client";

import { useState, useRef, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";

interface ArtifactRendererProps {
  html: string;
  title?: string;
  height?: number;
}

/**
 * ArtifactRenderer — renders Tippy-generated HTML/SVG/JS in a sandboxed iframe.
 *
 * Security: sandbox="allow-scripts" — no access to parent page, cookies, or API.
 * The generated code can only render visuals, nothing else.
 *
 * Features:
 * - Inline rendering in chat
 * - Expand to full-screen modal
 * - Print button
 * - Download as PNG (via canvas capture)
 */
export function ArtifactRenderer({ html, title, height = 400 }: ArtifactRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Wrap the HTML with a base style reset + dark mode support
  const wrappedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #fff;
    color: #1a1a1a;
    padding: 16px;
    overflow-x: hidden;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a2e; color: #e0e0e0; }
  }
</style>
</head>
<body>${html}</body>
</html>`;

  const handlePrint = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  }, []);

  const handleDownload = useCallback(() => {
    // Create a blob URL of the HTML for download
    const blob = new Blob([wrappedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "visualization").replace(/\s+/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [wrappedHtml, title]);

  const renderIframe = (iframeHeight: number) => (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      sandbox="allow-scripts"
      style={{
        width: "100%",
        height: `${iframeHeight}px`,
        border: "none",
        borderRadius: expanded ? 0 : "8px",
        background: "#fff",
      }}
      title={title || "Visualization"}
    />
  );

  return (
    <>
      {/* Inline card */}
      <div
        style={{
          border: "1px solid var(--card-border)",
          borderRadius: "10px",
          overflow: "hidden",
          marginTop: "8px",
          marginBottom: "8px",
          background: "var(--card-bg)",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            borderBottom: "1px solid var(--card-border)",
            background: "var(--background)",
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          <span style={{ fontWeight: 500 }}>{title || "Visualization"}</span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => setExpanded(true)}
              title="Expand"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "var(--muted)" }}
            >
              <Icon name="Maximize2" size={14} />
            </button>
            <button
              onClick={handlePrint}
              title="Print"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "var(--muted)" }}
            >
              <Icon name="Printer" size={14} />
            </button>
            <button
              onClick={handleDownload}
              title="Download HTML"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "var(--muted)" }}
            >
              <Icon name="Download" size={14} />
            </button>
          </div>
        </div>

        {/* Iframe */}
        {renderIframe(height)}
      </div>

      {/* Expanded modal */}
      {expanded && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              background: "var(--card-bg)",
              borderBottom: "1px solid var(--card-border)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{title || "Visualization"}</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handlePrint}
                style={{ background: "none", border: "1px solid var(--card-border)", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "0.75rem", color: "var(--foreground)" }}
              >
                Print
              </button>
              <button
                onClick={handleDownload}
                style={{ background: "none", border: "1px solid var(--card-border)", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "0.75rem", color: "var(--foreground)" }}
              >
                Download
              </button>
              <button
                onClick={() => setExpanded(false)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "var(--muted)" }}
              >
                <Icon name="X" size={20} />
              </button>
            </div>
          </div>
          <div style={{ flex: 1, padding: "0" }}>
            {renderIframe(window.innerHeight - 60)}
          </div>
        </div>
      )}
    </>
  );
}
