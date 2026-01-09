#!/usr/bin/env python3
import argparse
import csv
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import requests
import psycopg
from dotenv import load_dotenv

# -----------------------------
# Helpers
# -----------------------------

def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def normalize_text(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s#/-]", "", s)  # keep basic address chars
    s = norm_ws(s)
    return s

def normalize_phone(s: str) -> str:
    digits = re.sub(r"\D+", "", s or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits

def first_present(row: Dict[str, Any], keys) -> str:
    for k in keys:
        if k in row and str(row[k]).strip() != "":
            return str(row[k]).strip()
    return ""

def normalize_csv_headers(fieldnames: list) -> Dict[str, str]:
    """
    Create a mapping from normalized (trimmed) header names to original names.
    Also handles common variants (trailing spaces, etc).
    """
    mapping = {}
    for orig in fieldnames:
        cleaned = orig.strip()
        mapping[cleaned] = orig
    return mapping

def get_field(row: Dict[str, Any], header_map: Dict[str, str], *keys) -> str:
    """
    Get field value by trying multiple possible header names.
    Uses header_map to handle trailing spaces etc.
    """
    for k in keys:
        # Try exact match first
        if k in row and str(row[k]).strip():
            return str(row[k]).strip()
        # Try via header map (cleaned -> original)
        if k in header_map:
            orig = header_map[k]
            if orig in row and str(row[orig]).strip():
                return str(row[orig]).strip()
    return ""

def coerce_request_status(raw):
    """Map Airtable 'Case Status' strings to trapper.request_status enum values."""
    s = (raw or "").strip()
    if not s:
        return None
    s0 = re.sub(r"\s+", " ", s.lower()).strip()

    mapping = {
        # Explicit mappings for all Airtable Case Status values
        "new": "new",
        "requested": "new",
        "needs attention": "needs_review",
        "need to re-book": "needs_review",
        "need to re book": "needs_review",
        "in progress": "in_progress",
        "partially complete": "in_progress",
        "revisit": "active",
        "complete/closed": "closed",
        "complete / closed": "closed",
        "complete": "closed",
        "closed": "closed",
        "hold": "paused",
        "referred elsewhere": "resolved",
        # Archived statuses - mapped to terminal states; archive_reason set separately
        "duplicate request": "closed",
        "duplicate": "closed",
        "denied": "closed",
    }
    if s0 in mapping:
        return mapping[s0]

    # Fallback: try snake_case normalization
    candidate = re.sub(r"[^a-z0-9]+", "_", s0).strip("_")
    allowed = {"new","needs_review","active","scheduled","in_progress","paused","resolved","closed"}
    return candidate if candidate in allowed else None


def coerce_priority_smallint(raw):
    """Coerce Airtable priority-ish values into an int (or None)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None

    # Prefer digits if present (e.g. '2 - Medium' -> 2)
    m = re.search(r"\d+", s)
    if m:
        try:
            return int(m.group(0))
        except Exception:
            return None

    # Common words -> simple scale (adjust later if you want)
    s0 = re.sub(r"\s+", " ", s.lower()).strip()
    word_map = {"low": 1, "medium": 2, "med": 2, "high": 3, "urgent": 4, "critical": 5}
    return word_map.get(s0)


def coerce_archive_reason(raw_status: str):
    """Map Airtable case-status strings -> archive_reason (or None)."""
    s = (raw_status or "").strip().lower()
    if not s:
        return None
    s = " ".join(s.split())
    if s in ("duplicate request", "duplicate", "dup"):
        return "duplicate"
    if s in ("denied",):
        return "denied"
    if s in ("referred elsewhere", "referred", "refer elsewhere"):
        return "referred_elsewhere"
    return None

def mark_request_archived(conn, schema: str, request_id: str, archive_reason: str):
    """Idempotently set archived_at + archive_reason (only if columns exist)."""
    if not request_id or not archive_reason:
        return
    cols = table_columns(conn, schema, "requests")
    if not has_col(cols, "archived_at") or not has_col(cols, "archive_reason"):
        return
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE {schema}.requests
            SET archived_at    = now(),
                archive_reason = COALESCE(archive_reason, %s)
            WHERE id = %s
            """,
            (archive_reason, request_id),
        )


def parse_float(s: str) -> Optional[float]:
    try:
        s = (s or "").strip()
        if not s:
            return None
        return float(s)
    except Exception:
        return None

def is_blank_row(row: Dict[str, Any]) -> bool:
    return all(str(v).strip() == "" for v in row.values())

# -----------------------------
# Google geocoding (optional)
# -----------------------------

def geocode_address(address: str, api_key: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    resp = requests.get(url, params={"address": address, "key": api_key}, timeout=20)
    resp.raise_for_status()
    j = resp.json()
    if j.get("status") != "OK" or not j.get("results"):
        return None, None, None
    r0 = j["results"][0]
    loc = r0["geometry"]["location"]
    return float(loc["lat"]), float(loc["lng"]), r0.get("formatted_address")

# -----------------------------
# DB Introspection (lightweight)
# -----------------------------

def table_columns(conn: psycopg.Connection, schema: str, table: str) -> set:
    with conn.cursor() as cur:
        cur.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
            """,
            (schema, table),
        )
        return {r[0] for r in cur.fetchall()}

def has_col(cols: set, name: str) -> bool:
    return name in cols

def lookup_case_number_by_source_record_id(conn, schema: str, source_record_id: str) -> Optional[str]:
    """Look up case_number from the DB by source_record_id."""
    if not source_record_id:
        return None
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT case_number FROM {schema}.requests WHERE source_record_id = %s LIMIT 1",
            (source_record_id,)
        )
        row = cur.fetchone()
        return row[0] if row else None

def build_rid_to_case_number_map(csv_path: str) -> Dict[str, str]:
    """
    Pre-scan the CSV to build a mapping from Record ID -> Case Number.
    This allows resolving merge targets within the file without DB lookups.
    """
    mapping = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return mapping
        header_map = normalize_csv_headers(reader.fieldnames)
        for row in reader:
            rid = get_field(row, header_map, "Record ID", "record_id", "Airtable Record ID")
            case_num = get_field(row, header_map, "Case Number", "case_number", "Case #", "CaseNumber")
            if rid and case_num:
                mapping[rid] = case_num
    return mapping

# -----------------------------
# Upserts
# -----------------------------

@dataclass
class Counters:
    addresses_inserted: int = 0
    places_inserted: int = 0
    people_inserted: int = 0
    requests_inserted: int = 0
    requests_updated: int = 0
    request_parties_inserted: int = 0
    notes_inserted: int = 0
    notes_updated: int = 0
    skipped_blank_rows: int = 0
    skipped_missing_case_number: int = 0
    skipped_dupe_case_in_file: int = 0
    # Merge tracking counters
    merged_links_set: int = 0
    merged_case_resolved: int = 0
    merged_case_unresolved: int = 0

def upsert_address(conn, schema: str, raw_addr: str, lat: Optional[float], lng: Optional[float], formatted: Optional[str]) -> Tuple[Optional[str], bool]:
    if not raw_addr:
        return None, False

    cols = table_columns(conn, schema, "addresses")
    address_key = "addr:" + normalize_text(raw_addr)

    fields = []
    values = []
    placeholders = []

    def add(col, val):
        if has_col(cols, col):
            fields.append(col)
            values.append(val)
            placeholders.append("%s")

    add("address_key", address_key)
    add("raw_address", raw_addr)
    add("formatted_address", formatted or None)
    add("latitude", lat)
    add("longitude", lng)

    geom_expr = None
    if lat is not None and lng is not None:
        # common column names: geom, geog
        if has_col(cols, "geom"):
            geom_expr = "ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography"
        elif has_col(cols, "geog"):
            geom_expr = "ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography"

    with conn.cursor() as cur:
        if geom_expr:
            # add geom/geog as expression
            geom_col = "geom" if has_col(cols, "geom") else "geog"
            fields.append(geom_col)
            placeholders.append(geom_expr)
            values.extend([lng, lat])

        if not fields:
            return None, False

        sql = f"""
        insert into {schema}.addresses ({", ".join(fields)})
        values ({", ".join(placeholders)})
        on conflict (address_key)
        do update set
          raw_address = excluded.raw_address,
          formatted_address = coalesce(excluded.formatted_address, {schema}.addresses.formatted_address),
          latitude = coalesce(excluded.latitude, {schema}.addresses.latitude),
          longitude = coalesce(excluded.longitude, {schema}.addresses.longitude)
        returning id, (xmax = 0) as inserted;
        """
        cur.execute(sql, values)
        row = cur.fetchone()
        return (str(row[0]), bool(row[1]))

def upsert_place(conn, schema: str, address_id: Optional[str], place_name: str, raw_addr: str) -> Tuple[Optional[str], bool]:
    cols = table_columns(conn, schema, "places")
    if not raw_addr and not place_name:
        return None, False

    base_key = "addr:" + normalize_text(raw_addr) if raw_addr else "addr:unknown"
    pname = normalize_text(place_name) if place_name else ""
    place_key = "place:" + (pname + "|" + base_key if pname else base_key)

    fields = []
    values = []
    placeholders = []

    def add(col, val):
        if has_col(cols, col):
            fields.append(col)
            values.append(val)
            placeholders.append("%s")

    add("place_key", place_key)
    add("display_name", place_name or raw_addr)
    add("address_id", address_id)

    with conn.cursor() as cur:
        sql = f"""
        insert into {schema}.places ({", ".join(fields)})
        values ({", ".join(placeholders)})
        on conflict (place_key)
        do update set
          display_name = excluded.display_name,
          address_id = coalesce(excluded.address_id, {schema}.places.address_id)
        returning id, (xmax = 0) as inserted;
        """
        cur.execute(sql, values)
        row = cur.fetchone()
        return (str(row[0]), bool(row[1]))

def upsert_person(conn, schema: str, first: str, last: str, email: str, phone: str) -> Tuple[Optional[str], bool]:
    cols = table_columns(conn, schema, "people")

    email_n = (email or "").strip().lower()
    phone_n = normalize_phone(phone)
    # Keep original phone for display, use normalized for key
    phone_raw = (phone or "").strip()

    if email_n:
        person_key = "email:" + email_n
    elif phone_n:
        person_key = "phone:" + phone_n
    else:
        name_n = normalize_text((first or "") + " " + (last or ""))
        if not name_n:
            return None, False
        person_key = "name:" + name_n

    fields = []
    values = []
    placeholders = []

    def add(col, val, placeholder="%s"):
        if has_col(cols, col):
            fields.append(col)
            values.append(val)
            placeholders.append(placeholder)

    add("person_key", person_key)
    add("first_name", first or None)
    add("last_name", last or None)
    add("email", email_n or None)
    # Store the cleaned digits in phone
    add("phone", phone_n or None)

    # Also set phone_normalized using the DB function if column exists
    if has_col(cols, "phone_normalized") and phone_raw:
        fields.append("phone_normalized")
        placeholders.append(f"{schema}.normalize_phone(%s)")
        values.append(phone_raw)

    with conn.cursor() as cur:
        # Build update clause dynamically
        update_parts = [
            f"first_name = coalesce(excluded.first_name, {schema}.people.first_name)",
            f"last_name  = coalesce(excluded.last_name,  {schema}.people.last_name)",
            f"email      = coalesce(excluded.email,      {schema}.people.email)",
            f"phone      = coalesce(excluded.phone,      {schema}.people.phone)",
        ]
        if has_col(cols, "phone_normalized"):
            update_parts.append(f"phone_normalized = coalesce(excluded.phone_normalized, {schema}.people.phone_normalized)")

        sql = f"""
        insert into {schema}.people ({", ".join(fields)})
        values ({", ".join(placeholders)})
        on conflict (person_key)
        do update set
          {", ".join(update_parts)}
        returning id, (xmax = 0) as inserted;
        """
        cur.execute(sql, values)
        row = cur.fetchone()
        return (str(row[0]), bool(row[1]))

def upsert_request(conn, schema: str, case_number: str, source_record_id: str,
                  primary_place_id: Optional[str], primary_person_id: Optional[str],
                  status: str, priority, priority_label: str, notes: str,
                  archive_reason: Optional[str] = None,
                  merged_into_case_number: Optional[str] = None,
                  merged_into_source_record_id: Optional[str] = None) -> Tuple[Optional[str], bool]:
    """
    Upsert a request. Merge fields are set directly here (not via separate mark_request_archived).
    If archive_reason is provided, also sets archived_at.
    """
    cols = table_columns(conn, schema, "requests")

    fields = []
    values = []
    placeholders = []

    def add(col, val):
        if has_col(cols, col):
            fields.append(col)
            values.append(val)
            placeholders.append("%s")

    add("case_number", case_number)
    add("source_record_id", source_record_id or None)
    add("primary_place_id", primary_place_id)
    add("primary_contact_person_id", primary_person_id)
    add("status", status or None)
    add("priority", priority or None)
    add("priority_label", priority_label or None)
    add("notes", notes or None)
    add("archive_reason", archive_reason or None)
    add("merged_into_case_number", merged_into_case_number or None)
    add("merged_into_source_record_id", merged_into_source_record_id or None)

    # If archive_reason is set and archived_at column exists, set it
    archived_at_expr = None
    if archive_reason and has_col(cols, "archived_at"):
        fields.append("archived_at")
        placeholders.append("now()")  # Don't overwrite if already set

    with conn.cursor() as cur:
        # Build update clause - merge fields should be set (not coalesced) if provided
        update_parts = [
            f"source_record_id = coalesce(excluded.source_record_id, {schema}.requests.source_record_id)",
            f"primary_place_id = coalesce(excluded.primary_place_id, {schema}.requests.primary_place_id)",
            f"primary_contact_person_id = coalesce(excluded.primary_contact_person_id, {schema}.requests.primary_contact_person_id)",
            f"status = coalesce(excluded.status, {schema}.requests.status)",
            f"priority = coalesce(excluded.priority, {schema}.requests.priority)",
            f"priority_label = coalesce(excluded.priority_label, {schema}.requests.priority_label)",
            f"notes = coalesce(excluded.notes, {schema}.requests.notes)",
        ]
        # Archive fields: set directly if provided (don't coalesce to keep existing)
        if has_col(cols, "archive_reason"):
            update_parts.append(f"archive_reason = coalesce(excluded.archive_reason, {schema}.requests.archive_reason)")
        if has_col(cols, "merged_into_case_number"):
            update_parts.append(f"merged_into_case_number = coalesce(excluded.merged_into_case_number, {schema}.requests.merged_into_case_number)")
        if has_col(cols, "merged_into_source_record_id"):
            update_parts.append(f"merged_into_source_record_id = coalesce(excluded.merged_into_source_record_id, {schema}.requests.merged_into_source_record_id)")
        if has_col(cols, "archived_at"):
            update_parts.append(f"archived_at = coalesce({schema}.requests.archived_at, CASE WHEN excluded.archive_reason IS NOT NULL THEN now() ELSE NULL END)")

        sql = f"""
        insert into {schema}.requests ({", ".join(fields)})
        values ({", ".join(placeholders)})
        on conflict (case_number)
        do update set
          {", ".join(update_parts)}
        returning id, (xmax = 0) as inserted;
        """
        cur.execute(sql, values)
        row = cur.fetchone()
        return (str(row[0]), bool(row[1]))

def upsert_request_party(conn, schema: str, request_id: str, person_id: str, role: str) -> bool:
    cols = table_columns(conn, schema, "request_parties")
    if not (request_id and person_id):
        return False
    if not (has_col(cols, "request_id") and has_col(cols, "person_id")):
        return False

    role_col = "role" if has_col(cols, "role") else None
    with conn.cursor() as cur:
        if role_col:
            sql = f"""
            insert into {schema}.request_parties (request_id, person_id, role)
            values (%s,%s,%s)
            on conflict do nothing;
            """
            cur.execute(sql, (request_id, person_id, role))
        else:
            sql = f"""
            insert into {schema}.request_parties (request_id, person_id)
            values (%s,%s)
            on conflict do nothing;
            """
            cur.execute(sql, (request_id, person_id))
        return cur.rowcount > 0

def upsert_request_note(conn, schema: str, request_id: str, case_number: str,
                        note_kind: str, note_body: str) -> Tuple[bool, bool]:
    """
    Upsert a note to request_notes. Returns (inserted, updated).
    Uses note_key for idempotency: airtable_trapping_requests::<case_number>::<note_kind>
    """
    if not request_id or not note_body:
        return False, False

    note_body = note_body.strip()
    if not note_body:
        return False, False

    cols = table_columns(conn, schema, "request_notes")
    if not has_col(cols, "note_key"):
        # Migration not applied yet; skip silently
        return False, False

    note_key = f"airtable_trapping_requests::{case_number}::{note_kind}"

    with conn.cursor() as cur:
        sql = f"""
        INSERT INTO {schema}.request_notes (request_id, note_kind, note_body, note_key, source_system, created_at)
        VALUES (%s, %s, %s, %s, 'airtable', now())
        ON CONFLICT (note_key) WHERE note_key IS NOT NULL
        DO UPDATE SET
            note_body = EXCLUDED.note_body,
            updated_at = now()
        RETURNING (xmax = 0) AS inserted;
        """
        cur.execute(sql, (request_id, note_kind, note_body, note_key))
        row = cur.fetchone()
        if row:
            inserted = bool(row[0])
            return inserted, not inserted
        return False, False

# -----------------------------
# Main
# -----------------------------

def main():
    load_dotenv()

    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="Path to Airtable CSV export")
    ap.add_argument("--schema", default="trapper", help="DB schema (default: trapper)")
    ap.add_argument("--geocode", action="store_true", help="Enable Google geocoding if lat/lng missing")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        print("ERROR: DATABASE_URL is not set in .env", file=sys.stderr)
        sys.exit(2)

    geocode_enabled = args.geocode or (os.getenv("GEOCODE_ENABLED", "false").lower() == "true")
    gmaps_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()

    if geocode_enabled and not gmaps_key:
        print("ERROR: --geocode requested but GOOGLE_MAPS_API_KEY is not set.", file=sys.stderr)
        sys.exit(2)

    counters = Counters()
    seen_case_numbers = set()

    # Pre-scan: build Record ID -> Case Number mapping for merge resolution
    print("Pre-scanning CSV for Record ID -> Case Number mapping...")
    rid_to_case_number = build_rid_to_case_number_map(args.csv)
    print(f"  Found {len(rid_to_case_number)} record ID mappings")

    with psycopg.connect(db_url) as conn:
        conn.execute("select 1")  # smoke test

        with open(args.csv, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                print("ERROR: CSV has no headers", file=sys.stderr)
                sys.exit(2)

            # Build header map to handle trailing spaces in column names
            header_map = normalize_csv_headers(reader.fieldnames)

            for row in reader:
                if is_blank_row(row):
                    counters.skipped_blank_rows += 1
                    continue

                case_number = get_field(row, header_map, "Case Number", "case_number", "Case #", "CaseNumber")
                if not case_number:
                    counters.skipped_missing_case_number += 1
                    continue
                case_number = case_number.strip()

                if case_number in seen_case_numbers:
                    counters.skipped_dupe_case_in_file += 1
                    continue
                seen_case_numbers.add(case_number)

                # Record ID may have trailing space in Airtable export
                source_record_id = get_field(row, header_map, "Record ID", "record_id", "Airtable Record ID", "source_record_id")

                raw_addr = get_field(row, header_map, "Address", "Primary Address", "address", "primary_address")
                place_name = get_field(row, header_map, "Request Place Name", "Place Name", "place_name", "Location Name", "Colony Name")
                first = get_field(row, header_map, "First Name", "first_name")
                last = get_field(row, header_map, "Last Name", "last_name")
                # Prefer Clean Email, then Email
                email = get_field(row, header_map, "Clean Email", "Email", "email", "Client Email (LK)")
                # Prefer Clean Phone, then Client Phone (LK), then Business Phone
                phone = get_field(row, header_map, "Clean Phone", "Client Phone (LK)", "Business Phone", "Phone", "phone")
                raw_status = get_field(row, header_map, "Case Status", "Status", "status")
                status = coerce_request_status(raw_status)
                archive_reason = coerce_archive_reason(raw_status)

                # --- MERGE TARGET EXTRACTION ---
                # LookupRecordIDPrimaryReq is the Airtable Record ID of the canonical request
                merged_target_rid = get_field(row, header_map,
                    "LookupRecordIDPrimaryReq", "Lookup Record ID Primary Req",
                    "Primary Request Record ID", "MergedIntoRecordID")
                merged_into_source_record_id = merged_target_rid if merged_target_rid else None
                merged_into_case_number = None

                if merged_into_source_record_id:
                    # "LOCK IT IN" RULE: If merge target exists, this IS a duplicate
                    # regardless of Case Status text
                    archive_reason = 'duplicate'
                    status = 'closed'
                    counters.merged_links_set += 1

                    # Resolve case_number: first from file, then from DB
                    if merged_into_source_record_id in rid_to_case_number:
                        merged_into_case_number = rid_to_case_number[merged_into_source_record_id]
                        counters.merged_case_resolved += 1
                    else:
                        # Try DB lookup
                        db_case = lookup_case_number_by_source_record_id(conn, args.schema, merged_into_source_record_id)
                        if db_case:
                            merged_into_case_number = db_case
                            counters.merged_case_resolved += 1
                        else:
                            counters.merged_case_unresolved += 1
                            print(f"WARN: merge target {merged_into_source_record_id} not found in file or DB (case {case_number})")

                # Fallback status setting for non-merge archive reasons
                if archive_reason and not status:
                    if archive_reason in ('duplicate', 'denied'):
                        status = 'closed'
                    elif archive_reason == 'referred_elsewhere':
                        status = 'resolved'

                if raw_status and not status:
                    print("WARN: unmapped status %r (case %s); leaving NULL" % (raw_status, case_number))

                raw_priority = get_field(row, header_map, "Priority (Final Shown)", "Priority", "priority", "Intake Priority")
                priority = coerce_priority_smallint(raw_priority)
                # Preserve original label (Low/Medium/High) for reference
                priority_label = raw_priority if raw_priority else None

                if raw_priority and priority is None:
                    print("WARN: ignoring non-numeric priority %r (case %s)" % (raw_priority, case_number))

                # Notes for requests.notes field (legacy behavior)
                notes = get_field(row, header_map, "Internal Notes", "Notes", "notes", "internal_notes")

                # Separate notes fields for request_notes journal
                case_info_text = get_field(row, header_map, "Case Info")
                internal_notes_text = get_field(row, header_map, "Internal Notes")

                lat = parse_float(get_field(row, header_map, "Latitude", "lat", "latitude"))
                lng = parse_float(get_field(row, header_map, "Longitude", "lng", "longitude"))
                formatted = None

                if raw_addr and (lat is None or lng is None) and geocode_enabled:
                    glat, glng, gfmt = geocode_address(raw_addr, gmaps_key)
                    lat = lat if lat is not None else glat
                    lng = lng if lng is not None else glng
                    formatted = gfmt

                addr_id, addr_inserted = upsert_address(conn, args.schema, raw_addr, lat, lng, formatted)
                if addr_inserted:
                    counters.addresses_inserted += 1

                place_id, place_inserted = upsert_place(conn, args.schema, addr_id, place_name, raw_addr)
                if place_inserted:
                    counters.places_inserted += 1

                person_id, person_inserted = upsert_person(conn, args.schema, first, last, email, phone)
                if person_inserted:
                    counters.people_inserted += 1

                req_id, req_inserted = upsert_request(
                    conn, args.schema, case_number, source_record_id,
                    place_id, person_id, status, priority, priority_label, notes,
                    archive_reason=archive_reason,
                    merged_into_case_number=merged_into_case_number,
                    merged_into_source_record_id=merged_into_source_record_id
                )
                if req_inserted:
                    counters.requests_inserted += 1
                else:
                    counters.requests_updated += 1

                if req_id and person_id:
                    if upsert_request_party(conn, args.schema, req_id, person_id, "reporter"):
                        counters.request_parties_inserted += 1

                # Write notes to request_notes journal (idempotent via note_key)
                if req_id:
                    if case_info_text:
                        inserted, updated = upsert_request_note(conn, args.schema, req_id, case_number, "case_info", case_info_text)
                        if inserted:
                            counters.notes_inserted += 1
                        elif updated:
                            counters.notes_updated += 1

                    if internal_notes_text:
                        inserted, updated = upsert_request_note(conn, args.schema, req_id, case_number, "internal", internal_notes_text)
                        if inserted:
                            counters.notes_inserted += 1
                        elif updated:
                            counters.notes_updated += 1

        conn.commit()

    print("\n=== Import Summary ===")
    print(f"addresses inserted:        {counters.addresses_inserted}")
    print(f"places inserted:           {counters.places_inserted}")
    print(f"people inserted:           {counters.people_inserted}")
    print(f"requests inserted:         {counters.requests_inserted}")
    print(f"requests updated (reused): {counters.requests_updated}")
    print(f"request_parties inserted:  {counters.request_parties_inserted}")
    print(f"notes inserted:            {counters.notes_inserted}")
    print(f"notes updated:             {counters.notes_updated}")
    print(f"skipped blank rows:        {counters.skipped_blank_rows}")
    print(f"skipped missing case #:    {counters.skipped_missing_case_number}")
    print(f"skipped dupe case in file: {counters.skipped_dupe_case_in_file}")
    print("--- Merge Tracking ---")
    print(f"merged_links_set:          {counters.merged_links_set}")
    print(f"merged_case_resolved:      {counters.merged_case_resolved}")
    print(f"merged_case_unresolved:    {counters.merged_case_unresolved}")
    print("======================\n")

if __name__ == "__main__":
    main()
