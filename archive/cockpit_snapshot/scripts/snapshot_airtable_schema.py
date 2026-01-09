#!/usr/bin/env python3
"""
Airtable Schema Snapshot Tool

Fetches schema metadata from Airtable Meta API and writes:
- docs/ops/airtable/SCHEMA_SNAPSHOT.json (raw schema)
- docs/ops/airtable/SCHEMA_SNAPSHOT.md (human-readable summary)

IMPORTANT: This script is READ-ONLY. It does NOT fetch record data.

Required environment variables:
- AIRTABLE_API_KEY: Personal access token with schema:read scope
- AIRTABLE_BASE_ID: The base ID (starts with 'app')

Usage:
    python scripts/snapshot_airtable_schema.py
    # or with explicit env
    AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... python scripts/snapshot_airtable_schema.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # Will use environment variables directly

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Run: pip install requests")
    sys.exit(1)


# ============================================================
# Configuration
# ============================================================

REPO_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = REPO_ROOT / "docs" / "ops" / "airtable"
JSON_OUTPUT = OUTPUT_DIR / "SCHEMA_SNAPSHOT.json"
MD_OUTPUT = OUTPUT_DIR / "SCHEMA_SNAPSHOT.md"
DIFF_NOTES = OUTPUT_DIR / "SCHEMA_DIFF_NOTES.md"

AIRTABLE_META_API = "https://api.airtable.com/v0/meta/bases"


# ============================================================
# API Functions
# ============================================================

def get_base_schema(api_key: str, base_id: str) -> dict[str, Any] | None:
    """Fetch base schema from Airtable Meta API."""
    url = f"{AIRTABLE_META_API}/{base_id}/tables"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if response.status_code == 401:
            print("ERROR: Invalid API key or insufficient permissions.")
            print("Required scope: schema.bases:read")
        elif response.status_code == 403:
            print("ERROR: Access forbidden. Check PAT scopes include schema.bases:read")
        elif response.status_code == 404:
            print(f"ERROR: Base not found: {base_id}")
        else:
            print(f"ERROR: HTTP {response.status_code}: {e}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request failed: {e}")
        return None


# ============================================================
# Output Generators
# ============================================================

def generate_markdown(schema: dict[str, Any], base_id: str) -> str:
    """Generate human-readable markdown from schema."""
    lines = [
        "# Airtable Schema Snapshot",
        "",
        f"> **Generated**: {datetime.now().isoformat()}",
        f"> **Base ID**: `{base_id}`",
        "> **Source**: Airtable Meta API (schema.bases:read)",
        "",
        "---",
        "",
        "## Table of Contents",
        "",
    ]

    tables = schema.get("tables", [])

    # TOC
    for i, table in enumerate(tables, 1):
        name = table.get("name", "Unknown")
        lines.append(f"{i}. [{name}](#{name.lower().replace(' ', '-')})")

    lines.extend(["", "---", ""])

    # Table details
    for table in tables:
        table_name = table.get("name", "Unknown")
        table_id = table.get("id", "")
        primary_field = table.get("primaryFieldId", "")

        lines.extend([
            f"## {table_name}",
            "",
            f"- **Table ID**: `{table_id}`",
            f"- **Primary Field ID**: `{primary_field}`",
            "",
            "### Fields",
            "",
            "| Field Name | Type | ID | Options/Linked Table |",
            "|------------|------|----|-----------------------|",
        ])

        fields = table.get("fields", [])
        for field in fields:
            fname = field.get("name", "")
            ftype = field.get("type", "")
            fid = field.get("id", "")

            # Extract useful options
            options = field.get("options", {})
            options_str = ""

            if ftype == "multipleRecordLinks":
                linked_table = options.get("linkedTableId", "")
                options_str = f"→ `{linked_table}`"
            elif ftype == "singleSelect" or ftype == "multipleSelects":
                choices = options.get("choices", [])
                if choices:
                    choice_names = [c.get("name", "") for c in choices[:5]]
                    options_str = ", ".join(choice_names)
                    if len(choices) > 5:
                        options_str += f" (+{len(choices)-5} more)"
            elif ftype == "formula":
                options_str = "(formula)"
            elif ftype == "rollup":
                options_str = "(rollup)"
            elif ftype == "lookup":
                options_str = "(lookup)"

            # Escape pipes in field names
            fname_safe = fname.replace("|", "\\|")
            options_safe = options_str.replace("|", "\\|")

            lines.append(f"| {fname_safe} | {ftype} | `{fid}` | {options_safe} |")

        # Views (if available in schema)
        views = table.get("views", [])
        if views:
            lines.extend([
                "",
                "### Views",
                "",
            ])
            for view in views:
                vname = view.get("name", "")
                vtype = view.get("type", "")
                lines.append(f"- {vname} ({vtype})")

        lines.extend(["", "---", ""])

    # Summary stats
    total_fields = sum(len(t.get("fields", [])) for t in tables)
    lines.extend([
        "## Summary Statistics",
        "",
        f"- **Total Tables**: {len(tables)}",
        f"- **Total Fields**: {total_fields}",
        f"- **Average Fields/Table**: {total_fields / len(tables):.1f}" if tables else "",
        "",
        "---",
        "",
        "*This snapshot is auto-generated. Do not edit manually.*",
    ])

    return "\n".join(lines)


def generate_diff_notes_template() -> str:
    """Generate empty diff notes template."""
    return """# Airtable Schema Diff Notes

> Track changes between schema snapshots here.

## Change Log

| Date | Change Type | Table | Field | Notes |
|------|-------------|-------|-------|-------|
| (none yet) | - | - | - | - |

## Pending Changes (Proposed)

(List any proposed schema changes here before applying)

## Protected Fields (Do Not Modify)

See `AIRTABLE_COMPAT_MATRIX.md` for the definitive list of Zap-bound fields.

---

*Update this file when schema changes are proposed or applied.*
"""


# ============================================================
# Main
# ============================================================

def main():
    print("Airtable Schema Snapshot Tool")
    print("=" * 40)

    # Get credentials
    api_key = os.environ.get("AIRTABLE_API_KEY")
    base_id = os.environ.get("AIRTABLE_BASE_ID")

    if not api_key:
        print("ERROR: AIRTABLE_API_KEY not set in environment")
        print("Set it in .env or export before running")
        sys.exit(1)

    if not base_id:
        print("ERROR: AIRTABLE_BASE_ID not set in environment")
        sys.exit(1)

    print(f"Base ID: {base_id}")
    print("Fetching schema from Airtable Meta API...")

    # Fetch schema
    schema = get_base_schema(api_key, base_id)

    if schema is None:
        print("\nFailed to fetch schema. See error above.")
        print("\nCreating placeholder docs with error note...")

        # Create placeholder with error
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        error_note = f"""# Airtable Schema Snapshot

> **Generated**: {datetime.now().isoformat()}
> **Status**: FAILED - API access error

## Error

Could not fetch schema from Airtable Meta API.

### Possible causes:
1. Invalid or expired API key
2. PAT missing `schema.bases:read` scope
3. Base ID incorrect
4. Network connectivity issue

### Manual capture required

Until API access is resolved, manually document:
- Table names
- Key field names
- View names

See `AIRTABLE_WORKFLOWS_CATALOG.md` for workflow-based field inventory.
"""
        MD_OUTPUT.write_text(error_note)
        print(f"Wrote placeholder: {MD_OUTPUT}")
        sys.exit(1)

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Write JSON snapshot
    snapshot_data = {
        "meta": {
            "generated_at": datetime.now().isoformat(),
            "base_id": base_id,
            "source": "airtable_meta_api",
            "note": "Schema only - no record data",
        },
        "schema": schema,
    }

    with open(JSON_OUTPUT, "w") as f:
        json.dump(snapshot_data, f, indent=2)
    print(f"Wrote JSON: {JSON_OUTPUT}")

    # Write Markdown summary
    md_content = generate_markdown(schema, base_id)
    MD_OUTPUT.write_text(md_content)
    print(f"Wrote Markdown: {MD_OUTPUT}")

    # Write diff notes template if doesn't exist
    if not DIFF_NOTES.exists():
        DIFF_NOTES.write_text(generate_diff_notes_template())
        print(f"Wrote diff notes template: {DIFF_NOTES}")

    # Summary
    tables = schema.get("tables", [])
    total_fields = sum(len(t.get("fields", [])) for t in tables)

    print("\n" + "=" * 40)
    print("Schema Snapshot Complete")
    print(f"  Tables: {len(tables)}")
    print(f"  Fields: {total_fields}")
    print("\nFiles created:")
    print(f"  - {JSON_OUTPUT.relative_to(REPO_ROOT)}")
    print(f"  - {MD_OUTPUT.relative_to(REPO_ROOT)}")
    print(f"  - {DIFF_NOTES.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
