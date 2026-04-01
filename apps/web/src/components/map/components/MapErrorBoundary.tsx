"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for the map component.
 * Catches Google Maps crashes and renders a recovery UI instead of white-screening the app.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[MapErrorBoundary] Map crashed:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "var(--background, #fff)",
            color: "var(--foreground, #111)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div style={{ fontSize: 48, lineHeight: 1 }}>&#x1F5FA;</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Map failed to load</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary, #6b7280)", maxWidth: 400, textAlign: "center" }}>
            Something went wrong while rendering the map. This is usually a temporary issue.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "10px 20px",
                background: "var(--primary, #3b82f6)",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
            <a
              href="/"
              style={{
                padding: "10px 20px",
                background: "var(--bg-secondary, #f3f4f6)",
                color: "var(--foreground, #374151)",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Back to Atlas
            </a>
          </div>
          {this.state.error && (
            <details style={{ fontSize: 11, color: "var(--text-tertiary, #9ca3af)", maxWidth: 500 }}>
              <summary style={{ cursor: "pointer" }}>Error details</summary>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{this.state.error.message}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
