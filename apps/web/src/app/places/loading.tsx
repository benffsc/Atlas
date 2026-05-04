import { Skeleton, SkeletonTable } from "@/components/feedback/Skeleton";

export default function PlacesLoading() {
  return (
    <div style={{ padding: "1.5rem 0" }}>
      <Skeleton height={28} width="15%" style={{ marginBottom: "1.5rem" }} />
      <SkeletonTable rows={8} columns={4} />
    </div>
  );
}
