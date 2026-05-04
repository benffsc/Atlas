import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";

export default function AdminLoading() {
  return (
    <div style={{ padding: "1.5rem 0" }}>
      <SkeletonStats count={4} />
      <div style={{ marginTop: "1.5rem" }}>
        <SkeletonTable rows={6} columns={3} />
      </div>
    </div>
  );
}
