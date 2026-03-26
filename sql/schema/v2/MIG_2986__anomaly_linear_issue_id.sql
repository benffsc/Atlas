-- MIG_2986: Add linear_issue_id to tippy_anomaly_log
-- Referenced by /api/admin/anomalies/linear/route.ts when creating Linear issues from anomalies
ALTER TABLE ops.tippy_anomaly_log ADD COLUMN IF NOT EXISTS linear_issue_id TEXT;
