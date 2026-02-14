-- MIG_462: Tippy Discrepancy View for CLI Export
-- View for exporting Tippy-found data discrepancies for Claude Code review
--
\echo '=== MIG_462: Tippy Discrepancy View ==='

-- Index for efficient discrepancy queries
CREATE INDEX IF NOT EXISTS idx_data_improvements_tippy
  ON trapper.data_improvements(created_at DESC)
  WHERE source = 'tippy_auto_check';

-- View for CLI export of Tippy-found discrepancies
CREATE OR REPLACE VIEW trapper.v_tippy_discrepancies_for_review AS
SELECT
  di.improvement_id,
  di.title,
  di.description,
  di.entity_type,
  di.entity_id,
  di.category,
  di.priority,
  di.suggested_fix,
  di.fix_sql,
  di.status,
  di.created_at,
  -- Resolve entity display name
  CASE
    WHEN di.entity_type = 'cat' THEN (
      SELECT c.display_name
      FROM trapper.sot_cats c
      WHERE c.cat_id = di.entity_id
    )
    WHEN di.entity_type = 'place' THEN (
      SELECT p.formatted_address
      FROM trapper.places p
      WHERE p.place_id = di.entity_id
    )
    WHEN di.entity_type = 'person' THEN (
      SELECT per.display_name
      FROM trapper.sot_people per
      WHERE per.person_id = di.entity_id
    )
    WHEN di.entity_type = 'request' THEN (
      SELECT r.summary
      FROM trapper.sot_requests r
      WHERE r.request_id = di.entity_id
    )
    ELSE NULL
  END as entity_display
FROM trapper.data_improvements di
WHERE di.source = 'tippy_auto_check'
  AND di.status = 'pending'
ORDER BY
  CASE di.priority
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    ELSE 4
  END,
  di.created_at DESC;

COMMENT ON VIEW trapper.v_tippy_discrepancies_for_review IS
'Pending data discrepancies discovered by Tippy AI during appointment lookups. Use for CLI/Claude Code review sessions.';

-- Helper function to get discrepancies as markdown
CREATE OR REPLACE FUNCTION trapper.export_tippy_discrepancies_markdown()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  result TEXT := '';
  rec RECORD;
  current_priority TEXT := '';
BEGIN
  result := '# Tippy Data Discrepancies' || E'\n\n';
  result := result || 'Generated: ' || NOW()::TEXT || E'\n\n';

  FOR rec IN SELECT * FROM trapper.v_tippy_discrepancies_for_review
  LOOP
    -- Add priority header if changed
    IF rec.priority != current_priority THEN
      current_priority := rec.priority;
      result := result || '## ' || INITCAP(current_priority) || ' Priority' || E'\n\n';
    END IF;

    -- Add discrepancy entry
    result := result || '### ' || rec.title || E'\n';
    result := result || '- **ID:** ' || rec.improvement_id || E'\n';
    IF rec.entity_type IS NOT NULL THEN
      result := result || '- **Entity:** ' || rec.entity_type ||
        COALESCE(' (' || rec.entity_display || ')', '') || E'\n';
    END IF;
    result := result || '- **Category:** ' || COALESCE(rec.category, 'unknown') || E'\n';
    result := result || '- **Created:** ' || rec.created_at::DATE::TEXT || E'\n';
    result := result || E'\n**Description:**\n' || COALESCE(rec.description, 'No description') || E'\n\n';

    IF rec.suggested_fix IS NOT NULL THEN
      result := result || '**Suggested Fix:**' || E'\n```json\n' ||
        rec.suggested_fix::TEXT || E'\n```\n\n';
    END IF;

    IF rec.fix_sql IS NOT NULL THEN
      result := result || '**Fix SQL:**' || E'\n```sql\n' ||
        rec.fix_sql || E'\n```\n\n';
    END IF;

    result := result || '---' || E'\n\n';
  END LOOP;

  IF result = '# Tippy Data Discrepancies' || E'\n\n' || 'Generated: ' || NOW()::TEXT || E'\n\n' THEN
    result := result || 'No pending discrepancies found.' || E'\n';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION trapper.export_tippy_discrepancies_markdown() IS
'Export pending Tippy discrepancies as markdown for Claude Code review';

\echo 'MIG_462 complete: Tippy discrepancy view and export function created'
