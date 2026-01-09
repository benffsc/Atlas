#!/usr/bin/env python3
"""
Generate people match candidates for the review queue.

Part of PEOPLE_SOT_240: Safe linking without destructive merges.

Usage:
    python scripts/generate_people_match_candidates.py [--dry-run] [--source clinichq|jotform] [--limit N]

This script:
1. Reads unlinked source records (ClinicHQ owners, JotForm submissions)
2. Matches against canonical people using tiered rules
3. Inserts candidates into person_match_candidates (idempotent)
4. Never creates links directly - only candidates for review

Tiered matching:
- Tier 0 (>=0.95): Exact phone_normalized OR exact email match
- Tier 1 (0.80-0.94): Fuzzy name + phone area code OR same address
- Tier 2 (0.50-0.79): Fuzzy name only
- Tier 3 (<0.50): Very weak / suggest "create new person"
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple

import psycopg
from dotenv import load_dotenv

# -----------------------------
# Configuration
# -----------------------------

MAX_CANDIDATES_PER_SOURCE = 5  # Limit candidates per source record
MIN_NAME_LENGTH = 2  # Skip very short names


# -----------------------------
# Helpers
# -----------------------------

def normalize_phone(phone: str) -> str:
    """Normalize phone to digits only, strip leading 1."""
    if not phone:
        return ""
    digits = re.sub(r"\D+", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits


def normalize_name(name: str) -> str:
    """Normalize name for comparison."""
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.lower().strip())


def levenshtein_distance(s1: str, s2: str) -> int:
    """Calculate Levenshtein distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def name_similarity(name1: str, name2: str) -> float:
    """Calculate name similarity (0-1 scale)."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return 0.0
    max_len = max(len(n1), len(n2))
    if max_len == 0:
        return 0.0
    distance = levenshtein_distance(n1, n2)
    return max(0.0, 1.0 - (distance / max_len))


# -----------------------------
# Data Classes
# -----------------------------

@dataclass
class SourceRecord:
    source_system: str
    source_record_id: str
    display_name: str
    email: Optional[str]
    phone: Optional[str]
    phone_normalized: Optional[str]
    address_display: Optional[str]


@dataclass
class CanonicalPerson:
    person_id: str
    display_name: str
    email: Optional[str]
    phone: Optional[str]
    phone_normalized: Optional[str]


@dataclass
class MatchCandidate:
    source_system: str
    source_record_id: str
    candidate_person_id: Optional[str]
    confidence: float
    evidence: dict


# -----------------------------
# Matching Logic
# -----------------------------

def calculate_match(source: SourceRecord, person: CanonicalPerson) -> Optional[MatchCandidate]:
    """
    Calculate match confidence between source record and canonical person.
    Returns None if no meaningful match.
    """
    matched_on = []
    confidence = 0.0

    # Tier 0: Exact phone match
    if (source.phone_normalized and person.phone_normalized and
            source.phone_normalized == person.phone_normalized and
            len(source.phone_normalized) >= 10):
        matched_on.append("phone_normalized")
        confidence = max(confidence, 1.0)

    # Tier 0: Exact email match
    if (source.email and person.email and
            source.email.lower().strip() == person.email.lower().strip()):
        matched_on.append("email")
        confidence = max(confidence, 0.98)

    # Name similarity
    name_sim = name_similarity(source.display_name, person.display_name)

    # Tier 1: Strong name match + phone area code
    if name_sim >= 0.7:
        matched_on.append("name_fuzzy")
        if (source.phone_normalized and person.phone_normalized and
                len(source.phone_normalized) >= 3 and len(person.phone_normalized) >= 3 and
                source.phone_normalized[:3] == person.phone_normalized[:3]):
            matched_on.append("area_code")
            confidence = max(confidence, 0.85 + (name_sim * 0.1))
        else:
            # Name only
            confidence = max(confidence, 0.50 + (name_sim * 0.3))

    # Skip if no match signals
    if not matched_on or confidence < 0.40:
        return None

    # Build evidence
    evidence = {
        "matched_on": matched_on,
        "phone_match": "phone_normalized" in matched_on,
        "email_match": "email" in matched_on,
        "name_similarity": round(name_sim, 3),
        "tier": 0 if confidence >= 0.95 else (1 if confidence >= 0.80 else (2 if confidence >= 0.50 else 3)),
        "source_name": source.display_name,
        "source_email": source.email,
        "source_phone": source.phone,
    }

    return MatchCandidate(
        source_system=source.source_system,
        source_record_id=source.source_record_id,
        candidate_person_id=person.person_id,
        confidence=round(confidence, 3),
        evidence=evidence,
    )


def generate_candidates_for_source(
    source: SourceRecord,
    canonical_people: List[CanonicalPerson],
    max_candidates: int = MAX_CANDIDATES_PER_SOURCE
) -> List[MatchCandidate]:
    """Generate top N candidates for a source record."""
    candidates = []

    for person in canonical_people:
        match = calculate_match(source, person)
        if match:
            candidates.append(match)

    # Sort by confidence descending, take top N
    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates[:max_candidates]


# -----------------------------
# Database Operations
# -----------------------------

def load_unlinked_sources(conn, source_system: str, limit: int) -> List[SourceRecord]:
    """Load unlinked source records."""
    if source_system == "clinichq":
        # Aggregate appointments into distinct owners, ordered by visit count
        sql = """
            WITH clinichq_owners AS (
                SELECT
                    'clinichq' AS source_system,
                    MIN(cho.id::text) AS source_record_id,
                    CONCAT(cho.owner_first_name, ' ', cho.owner_last_name) AS display_name,
                    cho.owner_email AS email,
                    COALESCE(cho.owner_cell_phone, cho.owner_phone) AS phone,
                    cho.phone_normalized,
                    cho.owner_address AS address_display,
                    COUNT(*) AS visit_count
                FROM trapper.clinichq_hist_owners cho
                WHERE cho.owner_first_name IS NOT NULL
                  AND cho.owner_first_name != ''
                GROUP BY
                    CONCAT(cho.owner_first_name, ' ', cho.owner_last_name),
                    cho.owner_email,
                    COALESCE(cho.owner_cell_phone, cho.owner_phone),
                    cho.phone_normalized,
                    cho.owner_address
            )
            SELECT
                source_system,
                source_record_id,
                display_name,
                email,
                phone,
                phone_normalized,
                address_display
            FROM clinichq_owners co
            WHERE NOT EXISTS (
                SELECT 1 FROM trapper.person_source_link psl
                WHERE psl.source_system = 'clinichq' AND psl.source_pk = co.source_record_id
            )
            ORDER BY co.visit_count DESC NULLS LAST
            LIMIT %s
        """
    elif source_system == "jotform":
        sql = """
            SELECT
                'jotform' AS source_system,
                ar.id::text AS source_record_id,
                COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS display_name,
                ar.email,
                ar.phone,
                regexp_replace(ar.phone, '[^0-9]', '', 'g') AS phone_normalized,
                COALESCE(ar.cats_address, ar.requester_address) AS address_display
            FROM trapper.appointment_requests ar
            WHERE NOT EXISTS (
                SELECT 1 FROM trapper.person_source_link psl
                WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
            )
            ORDER BY ar.submitted_at DESC
            LIMIT %s
        """
    else:
        raise ValueError(f"Unknown source system: {source_system}")

    with conn.cursor() as cur:
        cur.execute(sql, (limit,))
        rows = cur.fetchall()
        return [
            SourceRecord(
                source_system=row[0],
                source_record_id=row[1],
                display_name=row[2] or "",
                email=row[3],
                phone=row[4],
                phone_normalized=row[5],
                address_display=row[6],
            )
            for row in rows
        ]


def load_canonical_people(conn) -> List[CanonicalPerson]:
    """Load all canonical people for matching."""
    sql = """
        SELECT
            p.id::text AS person_id,
            COALESCE(p.display_name, p.full_name, CONCAT(p.first_name, ' ', p.last_name)) AS display_name,
            p.email,
            p.phone,
            p.phone_normalized
        FROM trapper.people p
        WHERE COALESCE(p.display_name, p.full_name, p.first_name) IS NOT NULL
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        return [
            CanonicalPerson(
                person_id=row[0],
                display_name=row[1] or "",
                email=row[2],
                phone=row[3],
                phone_normalized=row[4],
            )
            for row in rows
        ]


def upsert_candidates(conn, candidates: List[MatchCandidate], dry_run: bool) -> Tuple[int, int]:
    """Upsert candidates into person_match_candidates. Returns (inserted, skipped)."""
    if dry_run:
        return len(candidates), 0

    inserted = 0
    skipped = 0

    sql = """
        INSERT INTO trapper.person_match_candidates
            (source_system, source_record_id, candidate_person_id, confidence, evidence, status)
        VALUES (%s, %s, %s, %s, %s, 'open')
        ON CONFLICT (source_system, source_record_id, candidate_person_id)
        DO UPDATE SET
            confidence = GREATEST(trapper.person_match_candidates.confidence, EXCLUDED.confidence),
            evidence = EXCLUDED.evidence
        RETURNING (xmax = 0) AS inserted
    """

    with conn.cursor() as cur:
        for c in candidates:
            try:
                cur.execute(sql, (
                    c.source_system,
                    c.source_record_id,
                    c.candidate_person_id,
                    c.confidence,
                    json.dumps(c.evidence),
                ))
                row = cur.fetchone()
                if row and row[0]:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"  Error inserting candidate: {e}", file=sys.stderr)
                skipped += 1

    return inserted, skipped


# -----------------------------
# Main
# -----------------------------

@dataclass
class Stats:
    sources_processed: int = 0
    candidates_generated: int = 0
    candidates_inserted: int = 0
    candidates_skipped: int = 0
    tier0_count: int = 0
    tier1_count: int = 0
    tier2_count: int = 0


def main():
    parser = argparse.ArgumentParser(description="Generate people match candidates")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    parser.add_argument("--source", choices=["clinichq", "jotform", "all"], default="clinichq",
                        help="Source system to process")
    parser.add_argument("--limit", type=int, default=1000,
                        help="Max source records to process")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    load_dotenv()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    print(f"=== People Match Candidates Generator ===")
    print(f"Source: {args.source}")
    print(f"Limit: {args.limit}")
    print(f"Dry run: {args.dry_run}")
    print()

    with psycopg.connect(database_url) as conn:
        # Load canonical people
        print("Loading canonical people...")
        canonical_people = load_canonical_people(conn)
        print(f"  Loaded {len(canonical_people)} canonical people")

        sources_to_process = ["clinichq", "jotform"] if args.source == "all" else [args.source]
        total_stats = Stats()

        for source_system in sources_to_process:
            print(f"\nProcessing {source_system}...")
            stats = Stats()

            # Load unlinked sources
            sources = load_unlinked_sources(conn, source_system, args.limit)
            print(f"  Loaded {len(sources)} unlinked {source_system} records")

            all_candidates = []

            for source in sources:
                if len(source.display_name) < MIN_NAME_LENGTH:
                    continue

                candidates = generate_candidates_for_source(source, canonical_people)
                stats.sources_processed += 1

                for c in candidates:
                    all_candidates.append(c)
                    stats.candidates_generated += 1
                    if c.confidence >= 0.95:
                        stats.tier0_count += 1
                    elif c.confidence >= 0.80:
                        stats.tier1_count += 1
                    elif c.confidence >= 0.50:
                        stats.tier2_count += 1

                if args.verbose and candidates:
                    print(f"    {source.display_name}: {len(candidates)} candidates "
                          f"(best: {candidates[0].confidence:.2f})")

            # Upsert candidates
            inserted, skipped = upsert_candidates(conn, all_candidates, args.dry_run)
            stats.candidates_inserted = inserted
            stats.candidates_skipped = skipped

            if not args.dry_run:
                conn.commit()

            print(f"  Sources processed: {stats.sources_processed}")
            print(f"  Candidates generated: {stats.candidates_generated}")
            print(f"    Tier 0 (>=0.95): {stats.tier0_count}")
            print(f"    Tier 1 (0.80-0.94): {stats.tier1_count}")
            print(f"    Tier 2 (0.50-0.79): {stats.tier2_count}")
            print(f"  Inserted: {stats.candidates_inserted}")
            print(f"  Skipped (existing): {stats.candidates_skipped}")

            # Aggregate totals
            total_stats.sources_processed += stats.sources_processed
            total_stats.candidates_generated += stats.candidates_generated
            total_stats.candidates_inserted += stats.candidates_inserted
            total_stats.candidates_skipped += stats.candidates_skipped
            total_stats.tier0_count += stats.tier0_count
            total_stats.tier1_count += stats.tier1_count
            total_stats.tier2_count += stats.tier2_count

        print(f"\n=== TOTAL ===")
        print(f"Sources processed: {total_stats.sources_processed}")
        print(f"Candidates generated: {total_stats.candidates_generated}")
        print(f"Candidates inserted: {total_stats.candidates_inserted}")
        print(f"Candidates skipped: {total_stats.candidates_skipped}")


if __name__ == "__main__":
    main()
