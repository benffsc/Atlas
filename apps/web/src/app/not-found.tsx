import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background) 55%)",
        padding: "1rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <img
          src="/beacon-logo.jpeg"
          alt="Beacon"
          style={{ width: 180, height: "auto", marginBottom: "1.5rem" }}
        />
        <h1
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
          }}
        >
          404
        </h1>
        <p
          style={{
            fontSize: "1.1rem",
            color: "var(--text-secondary)",
            margin: "0 0 2rem",
          }}
        >
          This page doesn't exist or has been moved.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <Link
            href="/"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: "0.95rem",
              fontWeight: 600,
            }}
          >
            Go home
          </Link>
          <Link
            href="/search"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--card-bg)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: "0.95rem",
              fontWeight: 500,
            }}
          >
            Search
          </Link>
        </div>
      </div>
    </div>
  );
}
