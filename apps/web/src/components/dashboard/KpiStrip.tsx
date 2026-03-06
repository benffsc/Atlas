import { KpiCard } from "./KpiCard";

interface KpiStripStats {
  active_requests: number;
  pending_intake: number;
  cats_this_month: number;
  cats_last_month: number;
}

interface KpiStripProps {
  stats: KpiStripStats | null;
}

export function KpiStrip({ stats }: KpiStripProps) {
  return (
    <div className="kpi-strip">
      <KpiCard
        label="Active Requests"
        value={stats?.active_requests ?? null}
        href="/requests"
        accentColor="#3b82f6"
      />
      <KpiCard
        label="Pending Intake"
        value={stats?.pending_intake ?? null}
        href="/intake/queue"
        accentColor="#f59e0b"
        invertDelta
      />
      <KpiCard
        label="Cats This Month"
        value={stats?.cats_this_month ?? null}
        previousValue={stats?.cats_last_month}
        href="/cats"
        accentColor="#9333ea"
      />
    </div>
  );
}
