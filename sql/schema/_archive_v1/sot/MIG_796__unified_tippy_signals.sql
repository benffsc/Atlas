\echo '=== MIG_796: Unified Tippy Signals View ==='
\echo 'Creates v_tippy_all_signals and v_tippy_signal_summary'
\echo 'Purpose: Single place to see ALL Tippy feedback, corrections, gaps, and drafts'
\echo ''

-- Unified view of all actionable Tippy signals
CREATE OR REPLACE VIEW trapper.v_tippy_all_signals AS

-- Staff feedback ("Tippy was wrong")
SELECT
  'feedback'::text as signal_type,
  f.feedback_id as signal_id,
  f.created_at,
  f.status,
  f.feedback_type as detail_type,
  COALESCE(f.user_correction, LEFT(f.tippy_message, 200)) as summary,
  f.entity_type,
  f.entity_id,
  s.display_name as reported_by,
  f.staff_id,
  NULL::text as confidence,
  false as is_silent
FROM trapper.tippy_feedback f
LEFT JOIN trapper.staff s ON s.staff_id = f.staff_id

UNION ALL

-- Proposed corrections (Tippy self-discovered)
SELECT
  'correction'::text as signal_type,
  c.correction_id as signal_id,
  c.created_at,
  c.status,
  c.field_name as detail_type,
  COALESCE(c.reasoning, c.discovery_context) as summary,
  c.entity_type,
  c.entity_id,
  NULL::text as reported_by,
  NULL::uuid as staff_id,
  c.confidence,
  true as is_silent
FROM trapper.tippy_proposed_corrections c

UNION ALL

-- Unanswerable questions (schema gaps)
SELECT
  'gap'::text as signal_type,
  q.question_id as signal_id,
  q.first_asked_at as created_at,
  q.resolution_status as status,
  q.reason as detail_type,
  q.question_text as summary,
  NULL::text as entity_type,
  NULL::uuid as entity_id,
  st.display_name as reported_by,
  q.staff_id,
  NULL::text as confidence,
  true as is_silent
FROM trapper.tippy_unanswerable_questions q
LEFT JOIN trapper.staff st ON st.staff_id = q.staff_id

UNION ALL

-- Draft requests (Tippy-proposed requests)
SELECT
  'draft_request'::text as signal_type,
  d.draft_id as signal_id,
  d.created_at,
  d.status,
  'draft_request'::text as detail_type,
  COALESCE(d.summary, d.raw_address) as summary,
  'place'::text as entity_type,
  d.place_id as entity_id,
  s.display_name as reported_by,
  d.created_by_staff_id as staff_id,
  NULL::text as confidence,
  false as is_silent
FROM trapper.tippy_draft_requests d
LEFT JOIN trapper.staff s ON s.staff_id = d.created_by_staff_id;

COMMENT ON VIEW trapper.v_tippy_all_signals IS 'Unified view of all Tippy signals: feedback, corrections, gaps, and draft requests';

-- Summary view with counts per signal type
CREATE OR REPLACE VIEW trapper.v_tippy_signal_summary AS
SELECT
  signal_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status IN ('pending', 'proposed', 'unresolved')) as needs_attention,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7_days,
  MAX(created_at) as latest
FROM trapper.v_tippy_all_signals
GROUP BY signal_type;

COMMENT ON VIEW trapper.v_tippy_signal_summary IS 'Counts of Tippy signals by type with needs_attention highlighting';

-- Add to Tippy view catalog so Tippy can check its own feedback
INSERT INTO trapper.tippy_view_catalog (
  view_name, category, description, key_columns, filter_columns, example_questions, is_safe_for_ai
) VALUES (
  'v_tippy_all_signals',
  'quality',
  'Unified view of all Tippy feedback, corrections, gaps, and draft requests. Shows signal_type (feedback, correction, gap, draft_request), status, summary, entity links, and who reported it.',
  ARRAY['signal_id', 'signal_type', 'status', 'summary'],
  ARRAY['signal_type', 'status', 'entity_type', 'staff_id'],
  ARRAY[
    'Show me all pending Tippy feedback',
    'What corrections has Tippy proposed?',
    'What questions could Tippy not answer?',
    'How many Tippy signals need attention?'
  ],
  true
), (
  'v_tippy_signal_summary',
  'quality',
  'Summary counts of Tippy signals by type. Shows total, needs_attention count, last_7_days count, and latest timestamp per signal type.',
  ARRAY['signal_type', 'total', 'needs_attention'],
  ARRAY['signal_type'],
  ARRAY[
    'How many Tippy issues need attention?',
    'What type of Tippy feedback is most common?'
  ],
  true
)
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions,
  updated_at = NOW();

\echo ''
\echo '=== MIG_796 Complete ==='
\echo 'Created: v_tippy_all_signals (unified timeline)'
\echo 'Created: v_tippy_signal_summary (counts by type)'
\echo 'Added both views to tippy_view_catalog'
