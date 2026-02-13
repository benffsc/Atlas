-- MIG_0000__fresh_db_extensions.sql
-- Fresh DB Bootstrap: Enable required extensions for V2 architecture
--
-- This migration enables extensions needed by V2 tables on a FRESH database
-- that doesn't have the V1 bootstrap (MIG_001) applied.
--
-- Run BEFORE: MIG_1002 (SOT tables need geography type from PostGIS)
--
-- Created: 2026-02-12 (US-East-2 → US-West-2 migration)

-- Enable PostGIS (required for geography type in sot.places, sot.addresses)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_trgm (for fuzzy text search in identity resolution)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp (backup UUID generation, gen_random_uuid() is preferred)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify extensions are enabled
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RAISE EXCEPTION 'PostGIS extension failed to install';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        RAISE EXCEPTION 'pg_trgm extension failed to install';
    END IF;
    RAISE NOTICE 'MIG_0000: All required extensions enabled successfully';
END $$;
