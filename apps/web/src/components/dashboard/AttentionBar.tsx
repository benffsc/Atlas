interface AttentionBarStats {
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  person_dedup_pending: number;
  place_dedup_pending: number;
}

interface AttentionBarProps {
  stats: AttentionBarStats | null;
  isAdmin: boolean;
}

export function AttentionBar({ stats, isAdmin }: AttentionBarProps) {
  if (!stats) return null;

  const hasAttention = stats.needs_attention_total > 0;
  const hasDedup = isAdmin && (stats.person_dedup_pending > 0 || stats.place_dedup_pending > 0);

  if (!hasAttention && !hasDedup) return null;

  return (
    <div className="attention-bar" style={{ flexWrap: "wrap" }}>
      {stats.stale_requests > 0 && (
        <a href="/requests?sort=created&order=asc" className="attention-chip">
          <span className="chip-count">{stats.stale_requests}</span> stale requests
        </a>
      )}
      {stats.overdue_intake > 0 && (
        <a href="/intake/queue?mode=attention" className="attention-chip">
          <span className="chip-count">{stats.overdue_intake}</span> overdue intake
        </a>
      )}
      {stats.unassigned_requests > 0 && (
        <a href="/requests?trapper=pending" className="attention-chip">
          <span className="chip-count">{stats.unassigned_requests}</span> unassigned
        </a>
      )}
      {isAdmin && stats.person_dedup_pending > 0 && (
        <a href="/admin/person-dedup" className="attention-chip">
          <span className="chip-count">{stats.person_dedup_pending}</span> person dedup
        </a>
      )}
      {isAdmin && stats.place_dedup_pending > 0 && (
        <a href="/admin/place-dedup" className="attention-chip">
          <span className="chip-count">{stats.place_dedup_pending}</span> place dedup
        </a>
      )}
    </div>
  );
}
