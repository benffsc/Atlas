-- MIG_2984: Tippy anomaly log (FFS-756)
-- Stores data anomalies flagged by Tippy during conversations.
-- Anomalies are reviewed by staff via /admin/anomalies.

CREATE TABLE IF NOT EXISTS ops.tippy_anomaly_log (
  anomaly_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ops.tippy_conversations(conversation_id),
  staff_id UUID REFERENCES ops.staff(staff_id),
  entity_type TEXT,
  entity_id UUID,
  anomaly_type TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT DEFAULT 'new' CHECK (status IN ('new','acknowledged','investigating','resolved','wont_fix')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES ops.staff(staff_id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_anomaly_status ON ops.tippy_anomaly_log(status);
CREATE INDEX IF NOT EXISTS idx_tippy_anomaly_severity ON ops.tippy_anomaly_log(severity);
CREATE INDEX IF NOT EXISTS idx_tippy_anomaly_created ON ops.tippy_anomaly_log(created_at DESC);
