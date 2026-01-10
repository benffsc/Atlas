# Search: Google-like Search for Atlas

Atlas provides a unified search across cats, people, and places with ranking, typeahead suggestions, and deep search for raw data.

---

## Overview

The search system has four core functions:

| Function | Purpose |
|----------|---------|
| `trapper.search_unified()` | Main search with ranking and match reasons |
| `trapper.search_suggestions()` | Fast typeahead (top 8 results) |
| `trapper.search_unified_counts()` | Facet counts by entity type |
| `trapper.search_deep()` | Search raw/staged data (clinichq_hist_*) |

---

## Migrations

Apply in order:

```bash
# Load environment
set -a && source .env && set +a

# Core search functions and indexes
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_026__search_unified_v4_google_like.sql

# Hardening for edge cases (missing tables, NULLs)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_027__hardening_search_and_views.sql
```

---

## Acceptance Test

Run the acceptance test to verify the search is working:

```bash
# Load environment
set -a && source .env && set +a

# Run test
./scripts/acceptance_test_atlas_019.sh

# Debug mode (shows redacted connection info)
DEBUG=1 ./scripts/acceptance_test_atlas_019.sh
```

The test verifies:
1. pg_trgm extension is installed
2. All search functions exist
3. Required views exist
4. Suggestions return results
5. Unified search returns results
6. Counts function works
7. Deep search executes without error
8. Trigram indexes exist (>= 4)

---

## Web API Endpoints

### GET /api/search

Main search endpoint with multiple modes.

**Canonical search (default):**
```
GET /api/search?q=fluffy&type=cat&limit=25&offset=0
```

Response:
```json
{
  "query": "fluffy",
  "mode": "canonical",
  "suggestions": [...],
  "results": [...],
  "possible_matches": [...],
  "counts_by_type": { "cat": 5, "person": 2, "place": 1 },
  "total": 8,
  "timing_ms": 45
}
```

**Suggestions only (for typeahead):**
```
GET /api/search?q=flu&suggestions=true
```

**Deep search (raw data):**
```
GET /api/search?q=tiger&mode=deep&limit=10
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | required | Search query |
| `type` | string | null | Filter: `cat`, `person`, or `place` |
| `mode` | string | `canonical` | `canonical` or `deep` |
| `limit` | int | 25 | Max results (max 100) |
| `offset` | int | 0 | Pagination offset |
| `suggestions` | bool | false | Return only suggestions (max 10) |
| `include_possible` | bool | true | Include weak matches when few strong matches |

---

## Match Strength and Scoring

Results are classified by match strength:

| Strength | Score Range | Meaning |
|----------|-------------|---------|
| strong | 90-100 | Exact or prefix match |
| medium | 50-89 | Similar name, contains match |
| weak | 0-49 | Fuzzy/trigram match only |

### Match Reasons

- `exact_name` - Query equals display name
- `prefix_name` - Display name starts with query
- `similar_name` - Trigram similarity match
- `contains_name` - Display name contains query
- `identifier_match` - Matched microchip or other ID
- `address_match` - Matched address text
- `email_match` - Matched email address
- `phone_match` - Matched phone number

---

## SQL Examples

### Basic Search
```sql
SELECT entity_type, display_name, match_strength, score
FROM trapper.search_unified('fluffy', NULL, 10, 0)
ORDER BY score DESC;
```

### Filter by Type
```sql
SELECT display_name, match_reason, score
FROM trapper.search_unified('smith', 'person', 25, 0);
```

### Typeahead Suggestions
```sql
SELECT entity_type, display_name, subtitle
FROM trapper.search_suggestions('whi', 8);
```

### Counts by Type
```sql
SELECT entity_type, count, strong_count, medium_count, weak_count
FROM trapper.search_unified_counts('cat', NULL);
```

### Deep Search (Raw Data)
```sql
SELECT source_table, match_field, match_value, score
FROM trapper.search_deep('tiger', 10);
```

### See More Examples
```bash
psql "$DATABASE_URL" -f sql/queries/QRY_034__search_examples.sql
```

---

## Views for Detail Pages

| View | Used By |
|------|---------|
| `trapper.v_person_detail` | `/api/people/[id]` |
| `trapper.v_place_detail` | `/api/places/[id]` |
| `trapper.v_person_list` | `/api/people` (listing) |
| `trapper.v_place_list` | `/api/places` (listing) |

---

## Troubleshooting

### Search returns no results

1. Check pg_trgm extension:
   ```sql
   SELECT extname FROM pg_extension WHERE extname='pg_trgm';
   ```

2. Check data exists:
   ```sql
   SELECT COUNT(*) FROM trapper.sot_cats;
   SELECT COUNT(*) FROM trapper.sot_people;
   SELECT COUNT(*) FROM trapper.places;
   ```

3. Check indexes exist:
   ```sql
   SELECT indexname FROM pg_indexes
   WHERE schemaname='trapper' AND indexname LIKE '%trgm%';
   ```

### Deep search returns empty

The `search_deep` function checks for table existence before querying. If `clinichq_hist_*` tables don't exist (fresh DB), it returns empty results gracefully.

Check tables:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='trapper' AND table_name LIKE 'clinichq_hist_%';
```

### v_place_detail errors

Ensure MIG_027 was applied. It fixes the `state_province` column reference (was incorrectly referencing `sa.state_province` instead of `sa.admin_area_1`).

---

## Security Notes

- Never run acceptance tests with `bash -x` or `set -x` (exposes DATABASE_URL)
- Use `DEBUG=1` mode for safe connection debugging
- Search queries are sanitized with parameterized SQL

---

*Part of ATLAS_019: Google-like Search*
