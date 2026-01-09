#!/usr/bin/env python3
"""
Pipeline runner for automated data refresh.

Usage:
    python scripts/run_pipeline.py --pipeline airtable_pull
    python scripts/run_pipeline.py --pipeline clinichq_file_ingest
    python scripts/run_pipeline.py --list

Part of DEP_010: Deploy + auto-refresh pipeline
"""

import os
import sys
import json
import argparse
import traceback
from datetime import datetime
from typing import Optional, Dict, Any

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor

# ============================================================
# Database Connection
# ============================================================

def get_db_connection():
    """Get database connection from DATABASE_URL."""
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        raise RuntimeError("DATABASE_URL environment variable not set")
    return psycopg2.connect(db_url)

# ============================================================
# Pipeline Tracking
# ============================================================

def start_pipeline_run(conn, pipeline_name: str, details: Optional[Dict] = None) -> str:
    """Insert a new pipeline run with 'running' status. Returns run_id."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trapper.pipeline_runs (pipeline_name, details)
            VALUES (%s, %s)
            RETURNING id::text
        """, (pipeline_name, json.dumps(details or {})))
        run_id = cur.fetchone()[0]
        conn.commit()
    return run_id

def complete_pipeline_run(
    conn,
    run_id: str,
    status: str,
    row_counts: Optional[Dict] = None,
    error_message: Optional[str] = None,
    error_trace: Optional[str] = None
):
    """Update a pipeline run with final status."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE trapper.pipeline_runs
            SET
                finished_at = NOW(),
                status = %s,
                row_counts = %s,
                error_message = %s,
                error_trace = %s
            WHERE id = %s
        """, (
            status,
            json.dumps(row_counts or {}),
            error_message,
            error_trace,
            run_id
        ))
        conn.commit()

# ============================================================
# Pipelines
# ============================================================

def run_airtable_pull(conn) -> Dict[str, Any]:
    """
    Pull data from Airtable and upsert into DB.

    This is a placeholder that calls the existing ingest script.
    In production, this would use the Airtable API directly.
    """
    import subprocess

    # Check if Airtable is configured
    airtable_key = os.environ.get('AIRTABLE_API_KEY')
    airtable_base = os.environ.get('AIRTABLE_BASE_ID')

    if not airtable_key or not airtable_base:
        return {
            'status': 'skipped',
            'row_counts': {},
            'details': {'reason': 'AIRTABLE_API_KEY or AIRTABLE_BASE_ID not configured'}
        }

    # For now, run the existing ingest script
    # In the future, this could be a direct API call
    try:
        result = subprocess.run(
            ['python3', 'ingest_airtable_trapping_requests.py', '--dry-run'],
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode != 0:
            return {
                'status': 'error',
                'row_counts': {},
                'error_message': result.stderr[:1000] if result.stderr else 'Unknown error'
            }

        # Parse output for counts (simplified)
        output = result.stdout
        return {
            'status': 'ok',
            'row_counts': {'dry_run': 1},
            'details': {'output': output[:500]}
        }

    except subprocess.TimeoutExpired:
        return {
            'status': 'error',
            'row_counts': {},
            'error_message': 'Pipeline timed out after 5 minutes'
        }
    except Exception as e:
        return {
            'status': 'error',
            'row_counts': {},
            'error_message': str(e)
        }

def run_clinichq_file_ingest(conn) -> Dict[str, Any]:
    """
    Ingest ClinicHQ data from configured file path.

    This checks for a file and ingests if present.
    Currently a placeholder since ClinicHQ is file-based.
    """
    # Check if a file path is configured
    file_path = os.environ.get('CLINICHQ_INGEST_FILE')

    if not file_path:
        return {
            'status': 'skipped',
            'row_counts': {},
            'details': {'reason': 'CLINICHQ_INGEST_FILE not configured (file-based ingest)'}
        }

    if not os.path.exists(file_path):
        return {
            'status': 'skipped',
            'row_counts': {},
            'details': {'reason': f'File not found: {file_path}'}
        }

    # Would run actual ingest here
    return {
        'status': 'ok',
        'row_counts': {'files_checked': 1},
        'details': {'file': file_path}
    }

# Pipeline registry
PIPELINES = {
    'airtable_pull': run_airtable_pull,
    'clinichq_file_ingest': run_clinichq_file_ingest,
}

# ============================================================
# Main
# ============================================================

def run_pipeline(pipeline_name: str, dry_run: bool = False):
    """Run a single pipeline and record results."""
    if pipeline_name not in PIPELINES:
        print(f"Unknown pipeline: {pipeline_name}")
        print(f"Available pipelines: {', '.join(PIPELINES.keys())}")
        sys.exit(1)

    print(f"[{datetime.now().isoformat()}] Starting pipeline: {pipeline_name}")

    if dry_run:
        print("  (dry-run mode - no DB writes)")
        return

    conn = get_db_connection()
    run_id = None

    try:
        # Start tracking
        run_id = start_pipeline_run(conn, pipeline_name)
        print(f"  Run ID: {run_id}")

        # Execute pipeline
        pipeline_fn = PIPELINES[pipeline_name]
        result = pipeline_fn(conn)

        # Record result
        complete_pipeline_run(
            conn,
            run_id,
            status=result.get('status', 'ok'),
            row_counts=result.get('row_counts'),
            error_message=result.get('error_message')
        )

        print(f"  Status: {result.get('status', 'ok')}")
        if result.get('row_counts'):
            print(f"  Counts: {result.get('row_counts')}")
        if result.get('error_message'):
            print(f"  Error: {result.get('error_message')}")

    except Exception as e:
        error_msg = str(e)
        error_trace = traceback.format_exc()
        print(f"  ERROR: {error_msg}")

        if run_id:
            complete_pipeline_run(
                conn,
                run_id,
                status='error',
                error_message=error_msg,
                error_trace=error_trace
            )

    finally:
        conn.close()

    print(f"[{datetime.now().isoformat()}] Pipeline complete: {pipeline_name}")

def main():
    parser = argparse.ArgumentParser(description='Run data pipelines')
    parser.add_argument('--pipeline', '-p', help='Pipeline to run')
    parser.add_argument('--list', '-l', action='store_true', help='List available pipelines')
    parser.add_argument('--dry-run', action='store_true', help='Dry run (no DB writes)')
    parser.add_argument('--all', action='store_true', help='Run all pipelines')

    args = parser.parse_args()

    if args.list:
        print("Available pipelines:")
        for name in PIPELINES:
            print(f"  - {name}")
        return

    if args.all:
        for name in PIPELINES:
            run_pipeline(name, dry_run=args.dry_run)
        return

    if not args.pipeline:
        parser.print_help()
        sys.exit(1)

    run_pipeline(args.pipeline, dry_run=args.dry_run)

if __name__ == '__main__':
    main()
