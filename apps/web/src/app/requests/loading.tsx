import { SkeletonStats, SkeletonList } from "@/components/feedback/Skeleton";

export default function RequestsLoading() {
  return (
    <div style={{ padding: "1.5rem 0" }}>
      <SkeletonStats count={5} />
      <div
        style={{
          marginTop: "1.5rem",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: "1rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--background)",
            }}
          >
            <SkeletonList items={4} />
          </div>
        ))}
      </div>
    </div>
  );
}
