"use client";

interface Lookup {
  lookup_id: string;
  title: string;
  query_text: string;
  summary: string | null;
  result_data: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  tool_calls?: unknown[] | null;
  created_at: string;
}

interface LookupViewerModalProps {
  lookup: Lookup;
  onClose: () => void;
  onArchive?: (id: string) => Promise<void>;
}

export function LookupViewerModal({ lookup, onClose, onArchive }: LookupViewerModalProps) {
  const getEntityLink = () => {
    if (!lookup.entity_type || !lookup.entity_id) return null;
    const typeToPath: Record<string, string> = {
      place: "/places",
      cat: "/cats",
      person: "/people",
      request: "/requests",
      intake: "/intake",
    };
    const basePath = typeToPath[lookup.entity_type];
    if (!basePath) return null;
    return `${basePath}/${lookup.entity_id}`;
  };

  const entityLink = getEntityLink();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleArchive = async () => {
    if (onArchive) {
      await onArchive(lookup.lookup_id);
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 1000,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "var(--background)",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          zIndex: 1001,
          width: "90%",
          maxWidth: "600px",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>{lookup.title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--muted)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "1.25rem", overflow: "auto", flex: 1 }}>
          {/* Meta info */}
          <div style={{ marginBottom: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            <div>Created: {formatDate(lookup.created_at)}</div>
            {entityLink && (
              <div style={{ marginTop: "0.25rem" }}>
                Linked to:{" "}
                <a href={entityLink} style={{ color: "#0d6efd" }}>
                  {lookup.entity_display || `${lookup.entity_type} ${lookup.entity_id}`}
                </a>
              </div>
            )}
          </div>

          {/* Original query */}
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Original Query
            </div>
            <div
              style={{
                background: "var(--card-bg, rgba(0,0,0,0.05))",
                padding: "0.75rem",
                borderRadius: "6px",
                fontSize: "0.9rem",
                fontStyle: "italic",
              }}
            >
              "{lookup.query_text}"
            </div>
          </div>

          {/* Summary */}
          {lookup.summary && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Summary
              </div>
              <div style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>{lookup.summary}</div>
            </div>
          )}

          {/* Result data */}
          {lookup.result_data && Object.keys(lookup.result_data).length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Data
              </div>
              <pre
                style={{
                  background: "var(--card-bg, rgba(0,0,0,0.05))",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  overflow: "auto",
                  maxHeight: "200px",
                }}
              >
                {JSON.stringify(lookup.result_data, null, 2)}
              </pre>
            </div>
          )}

          {/* Tool calls (if any) */}
          {lookup.tool_calls && lookup.tool_calls.length > 0 && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Tools Used ({lookup.tool_calls.length})
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                {lookup.tool_calls.map((tc: unknown, idx: number) => {
                  const toolCall = tc as { toolName?: string };
                  return (
                    <span
                      key={idx}
                      style={{
                        display: "inline-block",
                        background: "var(--card-bg, rgba(0,0,0,0.05))",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        marginRight: "0.5rem",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {toolCall.toolName || `Tool ${idx + 1}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.25rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          {onArchive && (
            <button
              onClick={handleArchive}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.85rem",
                background: "transparent",
                color: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Archive
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              background: "#0d6efd",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
