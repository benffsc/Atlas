import { SkeletonStats, SkeletonList } from "@/components/feedback/Skeleton";

export default function DashboardLoading() {
  return (
    <div style={{ padding: "1.5rem 0" }}>
      <SkeletonStats count={4} />
      <div
        style={{
          marginTop: "1.5rem",
          height: 300,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--card-bg)",
        }}
      />
      <div style={{ marginTop: "1.5rem" }}>
        <SkeletonList items={5} />
      </div>
    </div>
  );
}
