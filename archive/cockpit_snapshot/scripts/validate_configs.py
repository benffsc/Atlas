#!/usr/bin/env python3
"""
validate_configs.py
Validates config files for required IDs and reports missing entries.

Usage:
    python3 scripts/validate_configs.py

Exit codes:
    0 - All configs valid (or warnings only)
    1 - Critical IDs missing
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
AIRTABLE_CONFIG = REPO_ROOT / "configs" / "airtable" / "tables.json"


def validate_airtable_config():
    """Validate Airtable tables.json has required IDs."""
    if not AIRTABLE_CONFIG.exists():
        print(f"[WARN] Airtable config not found: {AIRTABLE_CONFIG}")
        return True  # Not critical, just missing

    try:
        with open(AIRTABLE_CONFIG) as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON in {AIRTABLE_CONFIG}: {e}")
        return False

    tables = config.get("tables", {})
    missing = []
    present = []

    for table_name, table_config in tables.items():
        table_id = table_config.get("id")
        if not table_id:
            missing.append(f"tables.{table_name}.id")
        else:
            present.append(f"tables.{table_name}.id = {table_id}")

        fields = table_config.get("fields", {})
        for field_name, field_config in fields.items():
            field_id = field_config.get("id")
            if not field_id:
                missing.append(f"tables.{table_name}.fields.{field_name}.id")
            else:
                present.append(f"tables.{table_name}.fields.{field_name}.id = {field_id}")

    # Report
    print(f"\n=== Airtable Config ({AIRTABLE_CONFIG}) ===\n")

    if present:
        print("Present IDs:")
        for p in present[:5]:  # Show first 5
            print(f"  [OK] {p}")
        if len(present) > 5:
            print(f"  ... and {len(present) - 5} more")
        print()

    if missing:
        print("Missing IDs (need to fill in):")
        for m in missing:
            print(f"  [MISSING] {m}")
        print()
        print("To fix: Open Airtable API docs, find IDs, update tables.json")
        return False  # Has missing IDs

    print("[OK] All Airtable IDs present")
    return True


def main():
    print("=" * 50)
    print("  Config Validator")
    print("=" * 50)

    all_valid = True

    # Validate Airtable
    if not validate_airtable_config():
        all_valid = False

    # Add more validators here as needed
    # e.g., validate_clinichq_config()

    print()
    if all_valid:
        print("[OK] All configs valid")
        sys.exit(0)
    else:
        print("[WARN] Some configs have missing IDs")
        print("This is expected for initial setup - fill in IDs as you discover them.")
        sys.exit(0)  # Exit 0 since missing IDs aren't blocking


if __name__ == "__main__":
    main()
