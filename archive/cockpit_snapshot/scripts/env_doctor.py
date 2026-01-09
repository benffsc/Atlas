#!/usr/bin/env python3
"""
Environment Doctor - Check for common .env configuration issues.

Usage:
    python scripts/env_doctor.py
    python scripts/env_doctor.py --fix  # Show remediation commands

IMPORTANT: This script NEVER prints secret values.
"""

import os
import sys
from pathlib import Path
from typing import Optional

# ============================================================
# Configuration
# ============================================================

# Find repo root (where .env lives)
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
ENV_FILE = REPO_ROOT / ".env"
ENV_LOCAL_FILE = REPO_ROOT / "apps" / "web" / ".env.local"

# Minimum key length to be considered valid
MIN_KEY_LENGTH = 20

# Variables to check
REQUIRED_VARS = ["OPENAI_API_KEY"]
OPTIONAL_VARS = [
    "AI_EXTRACTOR_ENABLED",
    "AI_COPILOT_ENABLED",
    "DATABASE_URL",
    "AIRTABLE_API_KEY",
    "AIRTABLE_BASE_ID",
]


# ============================================================
# Check Functions
# ============================================================

def read_env_file(path: Path) -> list[tuple[int, str, str]]:
    """
    Read .env file and return list of (line_number, key, value).
    Does NOT return actual secret values - only metadata.
    """
    entries = []
    if not path.exists():
        return entries

    with open(path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            # Skip comments and empty lines
            if not line or line.startswith("#"):
                continue
            # Parse key=value
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                # Remove quotes if present
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                entries.append((line_num, key, value))

    return entries


def check_duplicates(entries: list[tuple[int, str, str]], var_name: str) -> list[int]:
    """Check for duplicate variable definitions. Return line numbers of duplicates."""
    lines = [line_num for line_num, key, _ in entries if key == var_name]
    return lines if len(lines) > 1 else []


def check_blank(entries: list[tuple[int, str, str]], var_name: str) -> Optional[int]:
    """Check if variable is blank. Return line number if blank, None otherwise."""
    for line_num, key, value in entries:
        if key == var_name:
            if not value or value.isspace():
                return line_num
    return None


def check_length(entries: list[tuple[int, str, str]], var_name: str, min_length: int) -> Optional[int]:
    """Check if variable value is too short. Return line number if too short."""
    for line_num, key, value in entries:
        if key == var_name:
            if len(value) < min_length:
                return line_num
    return None


def check_missing(entries: list[tuple[int, str, str]], var_name: str) -> bool:
    """Check if variable is missing entirely."""
    return not any(key == var_name for _, key, _ in entries)


def mask_value(value: str) -> str:
    """Mask a value for display (never show full value)."""
    if not value:
        return "(empty)"
    if len(value) <= 4:
        return "****"
    return f"{value[:4]}...({len(value)} chars)"


# ============================================================
# Main
# ============================================================

def main():
    show_fix = "--fix" in sys.argv

    print("=" * 60)
    print("Environment Doctor")
    print("=" * 60)
    print()

    # Check if .env exists
    if not ENV_FILE.exists():
        print(f"❌ .env file not found at: {ENV_FILE}")
        print()
        if show_fix:
            print("To create .env file:")
            print(f"  cp {REPO_ROOT}/.env.example {ENV_FILE}")
        sys.exit(1)

    print(f"📁 Checking: {ENV_FILE}")
    print()

    # Read .env
    entries = read_env_file(ENV_FILE)

    issues_found = 0

    # Check required variables
    print("Required Variables:")
    print("-" * 40)

    for var in REQUIRED_VARS:
        # Check missing
        if check_missing(entries, var):
            print(f"❌ {var}: MISSING")
            issues_found += 1
            if show_fix:
                print(f"   Fix: Add {var}=<your-value> to .env")
            continue

        # Check duplicates
        dup_lines = check_duplicates(entries, var)
        if dup_lines:
            print(f"⚠️  {var}: DUPLICATE (lines {', '.join(map(str, dup_lines))})")
            issues_found += 1
            if show_fix:
                print(f"   Fix: Remove duplicate lines, keep only one")
                print(f"   sed -i '' '/{var}=/d' .env && echo '{var}=<value>' >> .env")
            continue

        # Check blank
        blank_line = check_blank(entries, var)
        if blank_line is not None:
            print(f"❌ {var}: BLANK (line {blank_line})")
            issues_found += 1
            if show_fix:
                print(f"   Fix: Set a non-empty value")
                print(f"   nano .env  # then update line {blank_line}")
            continue

        # Check length (for API keys)
        if "API_KEY" in var or "SECRET" in var:
            short_line = check_length(entries, var, MIN_KEY_LENGTH)
            if short_line is not None:
                print(f"⚠️  {var}: TOO SHORT (line {short_line}, <{MIN_KEY_LENGTH} chars)")
                issues_found += 1
                if show_fix:
                    print(f"   Fix: Verify full key is present")
                continue

        # All good
        print(f"✓  {var}: present (length OK)")

    print()

    # Check optional variables
    print("Optional Variables:")
    print("-" * 40)

    for var in OPTIONAL_VARS:
        if check_missing(entries, var):
            print(f"○  {var}: not set")
        elif check_blank(entries, var) is not None:
            print(f"⚠️  {var}: set but blank")
        else:
            print(f"✓  {var}: present")

    print()

    # Check .env.local symlink (for Next.js)
    print("Next.js Environment:")
    print("-" * 40)

    if ENV_LOCAL_FILE.exists():
        if ENV_LOCAL_FILE.is_symlink():
            target = ENV_LOCAL_FILE.resolve()
            if target == ENV_FILE.resolve():
                print(f"✓  .env.local symlink OK → .env")
            else:
                print(f"⚠️  .env.local symlink points to unexpected target: {target}")
        else:
            print(f"○  .env.local exists (not a symlink)")
    else:
        print(f"○  .env.local not found")
        if show_fix:
            print(f"   To create symlink: ln -s ../../.env {ENV_LOCAL_FILE}")

    print()

    # Summary
    print("=" * 60)
    if issues_found == 0:
        print("✓ All checks passed!")
        print()
        print("Verify AI endpoints:")
        print("  curl -s http://localhost:3000/api/ai/extract/request-signals | jq '.configured'")
    else:
        print(f"❌ Found {issues_found} issue(s)")
        if not show_fix:
            print()
            print("Run with --fix for remediation commands:")
            print("  python scripts/env_doctor.py --fix")
        sys.exit(1)


if __name__ == "__main__":
    main()
