#!/usr/bin/env python3
"""
HYB_332: Apply Safe Now Airtable Fields (SN-1 through SN-7, SN-11, SN-12)

This script creates formula and select fields in Airtable using the Meta API.
Views (SN-8, SN-9, SN-10) must be created manually in Airtable UI.

Usage:
    .venv/bin/python scripts/apply_hyb332_safe_now.py

Requires:
    - AIRTABLE_API_KEY in .env (PAT with schema.bases:write scope)
    - AIRTABLE_BASE_ID in .env

Safe to run multiple times - will skip fields that already exist.
"""

import json
import os
import sys
from datetime import datetime
from typing import Any

import requests

# Try to load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ============================================================
# Configuration
# ============================================================

AIRTABLE_META_API = "https://api.airtable.com/v0/meta/bases"

# Table IDs (from schema snapshot)
TABLE_IDS = {
    "Clients": "tbl9rWVZiRnNfs6CE",
    "Trappers": "tblmPBnkrsfqtnsvD",
    "Fosters": "tblJl4oq2LYI3wkUm",
    "Potential Trappers": "tbl927ap2xClOKIR7",
    "Trapping Requests": "tblc1bva7jFzg8DVF",
    "Kitten Intake Assessment": "tbl4pXEoCeapT1tG3",
}

# Fields to create
FIELDS_TO_CREATE = [
    # SN-1: Clients - canonical_contact_key
    {
        "table": "Clients",
        "name": "canonical_contact_key",
        "type": "formula",
        "options": {
            "formula": 'LOWER(TRIM({Email})) & ":" & SUBSTITUTE(SUBSTITUTE({Phone}, "-", ""), " ", "")'
        },
        "id": "SN-1",
    },
    # SN-2: Trappers - canonical_contact_key
    {
        "table": "Trappers",
        "name": "canonical_contact_key",
        "type": "formula",
        "options": {
            "formula": 'LOWER(TRIM({Email})) & ":" & SUBSTITUTE(SUBSTITUTE({Phone}, "-", ""), " ", "")'
        },
        "id": "SN-2",
    },
    # SN-3: Fosters - canonical_contact_key
    {
        "table": "Fosters",
        "name": "canonical_contact_key",
        "type": "formula",
        "options": {
            "formula": 'LOWER(TRIM({Email})) & ":" & SUBSTITUTE(SUBSTITUTE({Phone}, "-", ""), " ", "")'
        },
        "id": "SN-3",
    },
    # SN-4: Potential Trappers - canonical_contact_key
    {
        "table": "Potential Trappers",
        "name": "canonical_contact_key",
        "type": "formula",
        "options": {
            "formula": 'LOWER(TRIM({Email})) & ":" & SUBSTITUTE(SUBSTITUTE({Phone}, "-", ""), " ", "")'
        },
        "id": "SN-4",
    },
    # SN-5: Trapping Requests - address_registry_key
    {
        "table": "Trapping Requests",
        "name": "address_registry_key",
        "type": "formula",
        "options": {
            "formula": 'SUBSTITUTE(UPPER(TRIM({Address})), ",", "")'
        },
        "id": "SN-5",
    },
    # SN-6: Trapping Requests - days_since_created
    {
        "table": "Trapping Requests",
        "name": "days_since_created",
        "type": "formula",
        "options": {
            "formula": "DATETIME_DIFF(NOW(), {Created}, 'days')"
        },
        "id": "SN-6",
    },
    # SN-7: Trapping Requests - is_stale
    {
        "table": "Trapping Requests",
        "name": "is_stale",
        "type": "formula",
        "options": {
            "formula": "DATETIME_DIFF(NOW(), {Last Modified}, 'days') > 30"
        },
        "id": "SN-7",
    },
    # SN-11: Kitten Intake Assessment - v2_signals
    {
        "table": "Kitten Intake Assessment",
        "name": "v2_signals",
        "type": "multilineText",
        "options": {},
        "id": "SN-11",
    },
    # SN-12a: Kitten Intake Assessment - weather_urgency
    {
        "table": "Kitten Intake Assessment",
        "name": "weather_urgency",
        "type": "singleSelect",
        "options": {
            "choices": [
                {"name": "winter", "color": "blueDark1"},
                {"name": "hot", "color": "redDark1"},
                {"name": "mild", "color": "greenDark1"},
            ]
        },
        "id": "SN-12a",
    },
    # SN-12b: Kitten Intake Assessment - mother_status
    {
        "table": "Kitten Intake Assessment",
        "name": "mother_status",
        "type": "singleSelect",
        "options": {
            "choices": [
                {"name": "nursing", "color": "pinkDark1"},
                {"name": "pregnant", "color": "purpleDark1"},
                {"name": "not_present", "color": "grayDark1"},
                {"name": "unknown", "color": "grayLight1"},
            ]
        },
        "id": "SN-12b",
    },
    # SN-12c: Kitten Intake Assessment - access_difficulty
    {
        "table": "Kitten Intake Assessment",
        "name": "access_difficulty",
        "type": "singleSelect",
        "options": {
            "choices": [
                {"name": "easy", "color": "greenDark1"},
                {"name": "moderate", "color": "yellowDark1"},
                {"name": "hard", "color": "redDark1"},
                {"name": "unknown", "color": "grayLight1"},
            ]
        },
        "id": "SN-12c",
    },
    # SN-12d: Kitten Intake Assessment - age_estimate
    {
        "table": "Kitten Intake Assessment",
        "name": "age_estimate",
        "type": "singleSelect",
        "options": {
            "choices": [
                {"name": "newborn", "color": "pinkLight1"},
                {"name": "2-4wk", "color": "pinkDark1"},
                {"name": "4-8wk", "color": "purpleLight1"},
                {"name": "8wk+", "color": "purpleDark1"},
            ]
        },
        "id": "SN-12d",
    },
]


# ============================================================
# API Functions
# ============================================================

def get_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def get_existing_fields(api_key: str, base_id: str, table_id: str) -> set[str]:
    """Get set of existing field names for a table."""
    url = f"{AIRTABLE_META_API}/{base_id}/tables"
    resp = requests.get(url, headers=get_headers(api_key))

    if resp.status_code != 200:
        print(f"Error fetching schema: {resp.status_code}")
        return set()

    data = resp.json()
    for table in data.get("tables", []):
        if table.get("id") == table_id:
            return {f.get("name") for f in table.get("fields", [])}

    return set()


def create_field(
    api_key: str,
    base_id: str,
    table_id: str,
    name: str,
    field_type: str,
    options: dict,
) -> dict[str, Any]:
    """Create a new field in a table."""
    url = f"{AIRTABLE_META_API}/{base_id}/tables/{table_id}/fields"

    payload = {
        "name": name,
        "type": field_type,
    }

    if options:
        payload["options"] = options

    resp = requests.post(url, headers=get_headers(api_key), json=payload)

    return {
        "status": resp.status_code,
        "data": resp.json() if resp.content else {},
    }


# ============================================================
# Main
# ============================================================

def main():
    print("=" * 60)
    print("HYB_332: Apply Safe Now Fields")
    print("=" * 60)
    print()

    # Get credentials
    api_key = os.environ.get("AIRTABLE_API_KEY")
    base_id = os.environ.get("AIRTABLE_BASE_ID")

    if not api_key or not base_id:
        print("ERROR: Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in environment")
        sys.exit(1)

    print(f"Base ID: {base_id}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    # Check for dry-run mode
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("*** DRY RUN MODE - No changes will be made ***")
        print()

    # Track results
    results = {
        "created": [],
        "skipped": [],
        "errors": [],
    }

    # Process each field
    for field_def in FIELDS_TO_CREATE:
        table_name = field_def["table"]
        field_name = field_def["name"]
        field_type = field_def["type"]
        field_options = field_def.get("options", {})
        field_id = field_def["id"]

        table_id = TABLE_IDS.get(table_name)
        if not table_id:
            print(f"[{field_id}] ERROR: Unknown table '{table_name}'")
            results["errors"].append(f"{field_id}: Unknown table {table_name}")
            continue

        print(f"[{field_id}] {table_name}.{field_name} ({field_type})")

        # Check if field already exists
        existing = get_existing_fields(api_key, base_id, table_id)
        if field_name in existing:
            print(f"    → SKIPPED (already exists)")
            results["skipped"].append(f"{field_id}: {table_name}.{field_name}")
            continue

        if dry_run:
            print(f"    → Would create (dry-run)")
            results["created"].append(f"{field_id}: {table_name}.{field_name}")
            continue

        # Create the field
        result = create_field(api_key, base_id, table_id, field_name, field_type, field_options)

        if result["status"] == 200:
            print(f"    → CREATED successfully")
            results["created"].append(f"{field_id}: {table_name}.{field_name}")
        else:
            error_msg = result["data"].get("error", {}).get("message", "Unknown error")
            print(f"    → ERROR: {error_msg}")
            results["errors"].append(f"{field_id}: {error_msg}")

    # Summary
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Created: {len(results['created'])}")
    for item in results["created"]:
        print(f"  ✓ {item}")

    print(f"\nSkipped (already exist): {len(results['skipped'])}")
    for item in results["skipped"]:
        print(f"  - {item}")

    print(f"\nErrors: {len(results['errors'])}")
    for item in results["errors"]:
        print(f"  ✗ {item}")

    # Reminder about views
    print()
    print("=" * 60)
    print("MANUAL STEPS REQUIRED")
    print("=" * 60)
    print("The following views must be created manually in Airtable UI:")
    print("  - SN-8: Clients → 'Cockpit: Find by Phone' view")
    print("  - SN-9: Clients → 'Cockpit: Find by Email' view")
    print("  - SN-10: Trapping Requests → 'Cockpit: Stale Requests' view")
    print()
    print("See docs/ops/HYB_331_MANUAL_CLICK_RUNBOOK.md for exact steps.")
    print()

    # Exit code
    if results["errors"]:
        sys.exit(1)
    return 0


if __name__ == "__main__":
    main()
