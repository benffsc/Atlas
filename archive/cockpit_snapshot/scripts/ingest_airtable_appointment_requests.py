#!/usr/bin/env python3
"""
Ingest Airtable appointment request submissions into trapper.appointment_requests.

Usage:
    python ingest_airtable_appointment_requests.py --file <csv_path> [--schema trapper] [--dry-run] [--verbose]
"""
import argparse
import csv
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import psycopg
from dotenv import load_dotenv


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def first_present(row: Dict[str, Any], keys) -> str:
    for k in keys:
        if k in row and str(row[k]).strip() != "":
            return str(row[k]).strip()
    return ""


def parse_int(s: str) -> Optional[int]:
    try:
        s = (s or "").strip()
        if not s:
            return None
        # Handle ranges like "0-5" by taking first number
        match = re.match(r"(\d+)", s)
        if match:
            return int(match.group(1))
        return None
    except Exception:
        return None


def parse_date(s: str) -> Optional[str]:
    """Parse various date formats to ISO date string."""
    if not s or not s.strip():
        return None
    s = s.strip()
    # Try common formats
    for fmt in ["%m/%d/%Y %I:%M%p", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y-%m-%d"]:
        try:
            dt = datetime.strptime(s, fmt)
            return dt.date().isoformat()
        except ValueError:
            continue
    return None


def parse_datetime(s: str) -> Optional[str]:
    """Parse various datetime formats to ISO datetime string."""
    if not s or not s.strip():
        return None
    s = s.strip()
    for fmt in ["%m/%d/%Y %I:%M%p", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
        try:
            dt = datetime.strptime(s, fmt)
            return dt.isoformat()
        except ValueError:
            continue
    return None


def compute_source_pk(row: Dict[str, Any]) -> str:
    """Compute a stable source primary key for upserts.

    MEGA_008: source_pk is the stable identifier for a record.
    Uses Airtable Record ID if present, otherwise a hash of stable columns.
    This is used for ON CONFLICT uniqueness (not row_hash which changes with content).
    """
    # Use Airtable Record ID if present - this is the stable PK
    record_id = first_present(row, ["Record ID", "record_id", "Airtable Record ID"])
    if record_id:
        return record_id

    # Fallback: hash of stable identifying columns (NOT mutable content like notes)
    submitted = first_present(row, ["New Submitted", "New Submitted / Former Created Date", "Former Created Date", "submitted_at"])
    email = first_present(row, ["Email", "email"]).lower()
    phone = re.sub(r"\D+", "", first_present(row, ["Best phone number to reach you", "Phone", "phone"]))
    address = norm_ws(first_present(row, ["Street address where cats are located", "cats_address", "Clean Address (Cats)"])).lower()

    key_string = f"{submitted}|{email}|{phone}|{address}"
    return f"hash:{hashlib.sha256(key_string.encode()).hexdigest()[:32]}"


def compute_row_hash(row: Dict[str, Any]) -> str:
    """Compute a hash of the row content for change detection.

    MEGA_008: row_hash is for detecting changes, NOT for uniqueness.
    When row_hash differs but source_pk is the same, we update the existing record.
    """
    # Hash of all significant content fields
    content_fields = [
        first_present(row, ["New Submitted", "New Submitted / Former Created Date", "Former Created Date"]),
        first_present(row, ["Name", "name"]),
        first_present(row, ["First Name", "first_name"]),
        first_present(row, ["Last Name", "last_name"]),
        first_present(row, ["Email", "email"]),
        first_present(row, ["Best phone number to reach you", "Phone", "phone"]),
        first_present(row, ["Street address where cats are located", "cats_address"]),
        first_present(row, ["Clean Address (Cats)", "Clean Address"]),
        first_present(row, ["Notes", "notes"]),
        first_present(row, ["Submission Status", "Status"]),
        first_present(row, ["Appointment Date", "appointment_date"]),
    ]
    content_string = "|".join(str(f) for f in content_fields)
    return hashlib.sha256(content_string.encode()).hexdigest()[:32]


def is_blank_row(row: Dict[str, Any]) -> bool:
    return all(str(v).strip() == "" for v in row.values())


@dataclass
class Counters:
    rows_processed: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_skipped_blank: int = 0


def upsert_appointment_request(
    conn,
    schema: str,
    row: Dict[str, Any],
    source_file: str,
    dry_run: bool,
    verbose: bool
) -> tuple[bool, bool]:
    """Upsert a single appointment request. Returns (inserted, updated).

    MEGA_008: Uses source_pk (stable identifier) for ON CONFLICT, not row_hash.
    row_hash is still computed for change detection but not used for uniqueness.
    """
    source_pk = compute_source_pk(row)
    row_hash = compute_row_hash(row)

    # Extract fields
    submitted_at = parse_datetime(first_present(row, ["New Submitted", "New Submitted / Former Created Date", "Former Created Date"]))
    requester_name = first_present(row, ["Name", "name"])
    first_name = first_present(row, ["First Name", "first_name"])
    last_name = first_present(row, ["Last Name", "last_name"])
    email = first_present(row, ["Email", "email"])
    phone = first_present(row, ["Best phone number to reach you", "Phone", "phone"])
    requester_address = first_present(row, ["Your address", "requester_address"])
    requester_city = first_present(row, ["Your city", "requester_city"])
    requester_zip = first_present(row, ["Your Zip Code", "requester_zip"])
    cats_address = first_present(row, ["Street address where cats are located", "cats_address"])
    cats_address_clean = first_present(row, ["Clean Address (Cats)", "Clean Address", "cats_address_clean"])
    county = first_present(row, ["County", "county"])
    cat_count = parse_int(first_present(row, ["Estimated number of unowned/feral/stray cats", "cat_count"]))
    situation = first_present(row, ["Describe the Situation ", "Describe the Situation", "situation_description"])
    notes = first_present(row, ["Notes", "notes"])
    submission_status = first_present(row, ["Submission Status", "Status", "submission_status"])
    appointment_date = parse_date(first_present(row, ["Appointment Date", "appointment_date"]))
    airtable_record_id = first_present(row, ["Record ID", "record_id", "Airtable Record ID"])

    if verbose:
        print(f"  Source PK: {source_pk}")
        print(f"  Row hash: {row_hash}")
        print(f"  Submitted: {submitted_at}, Name: {requester_name}, Status: {submission_status}")

    with conn.cursor() as cur:
        # MEGA_008: ON CONFLICT uses source_pk for stable identity
        sql = f"""
        INSERT INTO {schema}.appointment_requests (
            source_file, source_row_hash, source_system, source_pk, airtable_record_id,
            submitted_at, requester_name, first_name, last_name, email, phone,
            requester_address, requester_city, requester_zip,
            cats_address, cats_address_clean, county,
            cat_count_estimate, situation_description, notes,
            submission_status, appointment_date,
            first_seen_at, last_seen_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (source_system, source_pk) DO UPDATE SET
            source_file = EXCLUDED.source_file,
            source_row_hash = EXCLUDED.source_row_hash,
            airtable_record_id = COALESCE(EXCLUDED.airtable_record_id, {schema}.appointment_requests.airtable_record_id),
            submitted_at = COALESCE(EXCLUDED.submitted_at, {schema}.appointment_requests.submitted_at),
            requester_name = COALESCE(EXCLUDED.requester_name, {schema}.appointment_requests.requester_name),
            first_name = COALESCE(EXCLUDED.first_name, {schema}.appointment_requests.first_name),
            last_name = COALESCE(EXCLUDED.last_name, {schema}.appointment_requests.last_name),
            email = COALESCE(EXCLUDED.email, {schema}.appointment_requests.email),
            phone = COALESCE(EXCLUDED.phone, {schema}.appointment_requests.phone),
            cats_address = COALESCE(EXCLUDED.cats_address, {schema}.appointment_requests.cats_address),
            cats_address_clean = COALESCE(EXCLUDED.cats_address_clean, {schema}.appointment_requests.cats_address_clean),
            submission_status = COALESCE(EXCLUDED.submission_status, {schema}.appointment_requests.submission_status),
            appointment_date = COALESCE(EXCLUDED.appointment_date, {schema}.appointment_requests.appointment_date),
            notes = COALESCE(EXCLUDED.notes, {schema}.appointment_requests.notes),
            last_seen_at = NOW(),
            updated_at = NOW()
        RETURNING (xmax = 0) AS inserted;
        """
        cur.execute(sql, (
            source_file, row_hash, "airtable", source_pk, airtable_record_id or None,
            submitted_at, requester_name or None, first_name or None, last_name or None, email or None, phone or None,
            requester_address or None, requester_city or None, requester_zip or None,
            cats_address or None, cats_address_clean or None, county or None,
            cat_count, situation or None, notes or None,
            submission_status or None, appointment_date
        ))
        result = cur.fetchone()
        inserted = bool(result[0]) if result else False
        return inserted, not inserted


def main():
    load_dotenv()

    ap = argparse.ArgumentParser(description="Ingest Airtable appointment requests CSV")
    ap.add_argument("--file", required=True, help="Path to CSV file")
    ap.add_argument("--schema", default="trapper", help="DB schema (default: trapper)")
    ap.add_argument("--dry-run", action="store_true", help="Print what would happen, no DB writes")
    ap.add_argument("--verbose", action="store_true", help="Print detailed output")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env", file=sys.stderr)
        sys.exit(2)

    csv_path = Path(args.file)
    if not csv_path.exists():
        print(f"ERROR: File not found: {csv_path}", file=sys.stderr)
        sys.exit(2)

    source_file = csv_path.name
    counters = Counters()

    if args.dry_run:
        print(f"[DRY RUN] Would ingest: {csv_path}")

    with psycopg.connect(db_url) as conn:
        conn.execute("SELECT 1")  # smoke test

        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)

            for row in reader:
                if is_blank_row(row):
                    counters.rows_skipped_blank += 1
                    continue

                counters.rows_processed += 1

                if args.verbose:
                    print(f"\nProcessing row {counters.rows_processed}...")

                inserted, updated = upsert_appointment_request(
                    conn, args.schema, row, source_file, args.dry_run, args.verbose
                )

                if inserted:
                    counters.rows_inserted += 1
                elif updated:
                    counters.rows_updated += 1

        if args.dry_run:
            conn.rollback()
            print("\n[ROLLBACK - dry-run mode, no changes persisted]")
        else:
            conn.commit()

    print(f"\n=== Appointment Requests Import Summary ===")
    print(f"File: {source_file}")
    print(f"Rows processed:    {counters.rows_processed}")
    print(f"Rows inserted:     {counters.rows_inserted}")
    print(f"Rows updated:      {counters.rows_updated}")
    print(f"Rows skipped:      {counters.rows_skipped_blank}")
    if args.dry_run:
        print("[DRY RUN - no changes made]")
    print("=" * 44)


if __name__ == "__main__":
    main()
