\echo '=== MIG_450: Tippy Feedback Table ==='
\echo 'Staff can report data discrepancies to Tippy for admin review'

-- Create tippy_feedback table
CREATE TABLE IF NOT EXISTS trapper.tippy_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted the feedback
  staff_id UUID REFERENCES trapper.staff(staff_id),

  -- What Tippy said that was wrong
  tippy_message TEXT NOT NULL,

  -- What the staff says is correct
  user_correction TEXT NOT NULL,

  -- Full conversation context for reference
  conversation_context JSONB,

  -- Entity reference (optional - what record is affected)
  entity_type TEXT CHECK (entity_type IN ('place', 'cat', 'person', 'request', 'other')),
  entity_id UUID,

  -- Type of feedback
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'incorrect_count',     -- Wrong number of cats, etc.
    'incorrect_status',    -- Wrong alteration status, request status
    'incorrect_location',  -- Wrong address, place association
    'incorrect_person',    -- Wrong person linked
    'outdated_info',       -- Info was correct but is now stale
    'other'                -- General feedback
  )),

  -- Review workflow
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'rejected')),
  reviewed_by UUID REFERENCES trapper.staff(staff_id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Link to data improvement created from this feedback
  data_improvement_id UUID, -- FK added after data_improvements table exists

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for pending feedback review
CREATE INDEX IF NOT EXISTS idx_tippy_feedback_status
  ON trapper.tippy_feedback(status) WHERE status = 'pending';

-- Index for feedback by entity
CREATE INDEX IF NOT EXISTS idx_tippy_feedback_entity
  ON trapper.tippy_feedback(entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- Index for staff's feedback history
CREATE INDEX IF NOT EXISTS idx_tippy_feedback_staff
  ON trapper.tippy_feedback(staff_id);

COMMENT ON TABLE trapper.tippy_feedback IS 'Staff feedback on Tippy responses for data accuracy improvement';
COMMENT ON COLUMN trapper.tippy_feedback.tippy_message IS 'The AI response that contained incorrect information';
COMMENT ON COLUMN trapper.tippy_feedback.user_correction IS 'Staff description of the correct information';
COMMENT ON COLUMN trapper.tippy_feedback.conversation_context IS 'JSON of recent conversation history for context';
COMMENT ON COLUMN trapper.tippy_feedback.entity_type IS 'Type of entity the feedback relates to';
COMMENT ON COLUMN trapper.tippy_feedback.entity_id IS 'ID of the specific entity (place_id, cat_id, etc.)';
COMMENT ON COLUMN trapper.tippy_feedback.feedback_type IS 'Category of the data issue';
COMMENT ON COLUMN trapper.tippy_feedback.data_improvement_id IS 'Link to auto-created data improvement record';

\echo 'MIG_450 complete: tippy_feedback table created'
