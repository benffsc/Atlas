import { Pagination } from "@/components/ui/Pagination";

interface Props {
  offset: number;
  limit: number;
  hasMore: boolean;
  candidateCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function DedupPagination({ offset, limit, hasMore, candidateCount, onPrevious, onNext }: Props) {
  return (
    <Pagination
      offset={offset}
      limit={limit}
      hasMore={hasMore}
      itemCount={candidateCount}
      onPrevious={onPrevious}
      onNext={onNext}
    />
  );
}
