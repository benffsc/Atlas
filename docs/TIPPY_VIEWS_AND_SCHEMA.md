# Tippy Views and Schema Navigation

This document describes Tippy's dynamic schema navigation system and view infrastructure.

## Overview

Tippy uses a **dynamic schema navigation** approach instead of hardcoded query tools. This allows Tippy to answer questions using any of the 190+ database views without requiring new code for each question type.

## Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `tippy_view_catalog` | MIG_517 | Registry of views Tippy can query |
| `tippy_proposed_corrections` | MIG_518 | Data corrections Tippy proposes |
| `tippy_unanswerable_questions` | MIG_519 | Questions Tippy couldn't answer |
| `tippy_view_usage` | MIG_520 | Analytics on which views are queried |

### Tippy Tools

**V2 (current, when `TIPPY_V2_ENABLED=true`):** Located in `apps/web/src/app/api/tippy/tools-v2.ts`

In V2, the `discover_views`, `query_view`, and `explore_entity` tools are **retired** — their functionality is absorbed by `run_sql` (which can execute any SELECT query directly). `propose_data_correction` and `log_unanswerable` are absorbed into the `log_event` dispatcher tool.

| V2 Tool | Replaces | Purpose |
|---------|----------|---------|
| `run_sql` | `discover_views`, `query_view`, `explore_entity`, `run_sql` | Execute any read-only SQL — covers all schema exploration |
| `log_event` (action_type: `data_correction`) | `propose_data_correction` | Flag discrepancies for admin review |

**V1 (legacy):** Located in `apps/web/src/app/api/tippy/tools.ts`

| Tool | Type | Purpose |
|------|------|---------|
| `discover_views` | User-facing | Find available views by category or search |
| `query_view` | User-facing | Execute queries against any cataloged view |
| `explore_entity` | User-facing | Deep-dive into entity with relationships |
| `propose_data_correction` | Internal/silent | Flag discrepancies for admin review |
| `log_unanswerable` | Internal/silent | Track questions that can't be answered |

## View Catalog

### Categories

The view catalog organizes views into 6 categories:

| Category | Description | Example Views |
|----------|-------------|---------------|
| `entity` | Core entity views | v_canonical_people, v_cat_detail |
| `stats` | Statistics and aggregations | v_trapper_full_stats, v_request_alteration_stats |
| `processing` | Data pipeline and jobs | v_processing_dashboard, v_intake_triage_queue |
| `quality` | Data quality and duplicates | v_data_quality_dashboard, v_duplicate_merge_candidates |
| `ecology` | Beacon/population modeling | v_beacon_summary, v_place_colony_status |
| `linkage` | Relationship views | v_request_current_trappers, v_person_cat_history |

### Adding a View to the Catalog

To make a view accessible to Tippy:

```sql
INSERT INTO ops.tippy_view_catalog (
    view_name,
    category,
    description,
    key_columns,
    filter_columns,
    example_questions
) VALUES (
    'v_my_new_view',
    'stats',
    'Description of what this view provides',
    ARRAY['key_col1', 'key_col2'],
    ARRAY['filter_col1', 'filter_col2'],
    ARRAY['Example question 1?', 'Example question 2?']
);
```

### Querying the Catalog

```sql
-- Find views by category
SELECT * FROM ops.tippy_discover_schema('stats');

-- Search views by keyword
SELECT * FROM ops.tippy_discover_schema(NULL, 'ops');

-- Execute a query against a cataloged view
SELECT * FROM ops.tippy_query_view(
    'v_trapper_full_stats',
    '[{"column_name": "display_name", "operator": "ILIKE", "value": "%ben%"}]'::jsonb,
    10
);
```

## View Naming Conventions

### Standard Views
- `v_{entity}_detail` - Full detail view for a single entity
- `v_{entity}_list` - List view for browsing entities
- `v_{noun}_{verb}_stats` - Aggregated statistics

### Versioned Views

Some views have versioned variants that coexist intentionally:

| Base View | Versioned | Difference |
|-----------|-----------|------------|
| `v_place_detail` | `v_place_detail_v2` | `_v2` has smart display_name logic, filters invalid person names. API uses `_v2`, Tippy uses base. |
| `v_search_sot_unified` | `v_search_unified_v3` | Different purposes: `sot` for Tippy, `_v3` for CLI scripts |
| `v_person_list` | `v_person_list_v3` | `v_person_list` is an alias to `_v3` for consistency |

## Admin Pages

### Tippy Corrections (`/admin/tippy-corrections`)

Review and apply data corrections that Tippy proposes when it finds discrepancies.

**API Routes:**
- `GET /api/admin/tippy-corrections` - List corrections
- `GET /api/admin/tippy-corrections/[id]` - Get single correction
- `PATCH /api/admin/tippy-corrections/[id]` - Update status
- `POST /api/admin/tippy-corrections/[id]/apply` - Apply approved correction

**Workflow:**
1. Tippy finds discrepancy during conversation
2. Calls `propose_data_correction` tool (silent)
3. Correction appears in admin queue with status `proposed`
4. Admin reviews evidence and either approves or rejects
5. If approved, admin clicks "Apply" to execute the correction
6. Creates audit trail in `entity_edits` table

### Tippy Gaps (`/admin/tippy-gaps`)

Review questions Tippy couldn't answer to identify schema gaps.

**API Routes:**
- `GET /api/admin/tippy-gaps` - List unanswerable questions
- `PATCH /api/admin/tippy-gaps/[id]` - Update resolution status

**Resolution Types:**
- `view_created` - Created a new view to answer this
- `data_added` - Added missing data
- `tool_added` - Added a new tool
- `documentation` - Documented how to ask differently
- `out_of_scope` - Not something Tippy should answer
- `duplicate` - Same as another question

## View Usage Analytics

Track which views Tippy queries to optimize performance:

```sql
-- Most popular views
SELECT * FROM ops.v_tippy_view_popularity;

-- Usage by category
SELECT * FROM ops.v_tippy_usage_summary;

-- Recent queries
SELECT * FROM ops.tippy_view_usage
ORDER BY created_at DESC
LIMIT 20;
```

## Migration History

| Migration | Purpose |
|-----------|---------|
| MIG_517 | View catalog table and discovery functions |
| MIG_518 | Proposed corrections table and workflow |
| MIG_519 | Unanswerable questions tracking |
| MIG_520 | View usage analytics |
| MIG_521 | View cleanup (removed orphans, created aliases) |

## Best Practices

### When Creating New Views

1. **Name consistently** - Use `v_{entity}_{purpose}` pattern
2. **Add to catalog** - If Tippy should be able to query it
3. **Document columns** - Add COMMENT ON VIEW
4. **Consider performance** - Add indexes for filter columns
5. **Test with Tippy** - Ask questions to verify discovery works

### When Modifying Views

1. **Use CREATE OR REPLACE** when only adding columns
2. **DROP and CREATE** when changing column names/types
3. **Update catalog** if key_columns or filter_columns change
4. **Check dependents** - Some views reference other views

### Avoid

- Creating versioned views (`_v2`, `_v3`) unless truly different behavior
- Adding views to catalog that expose sensitive data
- Changing column semantics without updating documentation
