-- MIG_2098: Create ops.* compatibility views for remaining V1 tables
-- Date: 2026-02-14
-- Issue: Some routes still reference trapper.* tables that exist as real tables in V1
--        but may not exist in V2. Create ops.* views pointing to trapper.* where available.
--
-- NOTE: Disease tracking is handled by MIG_2110 (creates proper ops.* tables)
-- NOTE: This migration uses safe IF EXISTS checks

\echo ''
\echo '=============================================='
\echo '  MIG_2098: OPS Compatibility Views (Safe)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- HELPER: Safe view creation that checks if source exists
-- ============================================================================

DO $$
DECLARE
    v_created INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- EMAIL SYSTEM
    -- ========================================================================

    -- email_templates
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'email_templates') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.email_templates AS SELECT * FROM trapper.email_templates';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- email_jobs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'email_jobs') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.email_jobs AS SELECT * FROM trapper.email_jobs';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- email_batches
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'email_batches') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.email_batches AS SELECT * FROM trapper.email_batches';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- sent_emails
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'sent_emails') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.sent_emails AS SELECT * FROM trapper.sent_emails';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- TIPPY (AI ASSISTANT)
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'tippy_feedback') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.tippy_feedback AS SELECT * FROM trapper.tippy_feedback';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'tippy_conversations') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.tippy_conversations AS SELECT * FROM trapper.tippy_conversations';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'tippy_draft_requests') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.tippy_draft_requests AS SELECT * FROM trapper.tippy_draft_requests';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- DISEASE TRACKING - SKIP (handled by MIG_2110)
    -- ========================================================================
    -- ops.disease_types and ops.place_disease_status are created as TABLES by MIG_2110
    -- Do NOT create views that would conflict

    -- ========================================================================
    -- PARTNER ORGANIZATIONS
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'partner_organizations') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.partner_organizations AS SELECT * FROM trapper.partner_organizations';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'org_matches') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.org_matches AS SELECT * FROM trapper.org_matches';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- DEDUPLICATION
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'place_dedup_candidates') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.place_dedup_candidates AS SELECT * FROM trapper.place_dedup_candidates';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'potential_person_duplicates') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.potential_person_duplicates AS SELECT * FROM trapper.potential_person_duplicates';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- INTAKE SYSTEM
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'intake_custom_fields') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.intake_custom_fields AS SELECT * FROM trapper.intake_custom_fields';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'intake_questions') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.intake_questions AS SELECT * FROM trapper.intake_questions';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- CLINIC DAYS
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'clinic_day_entries') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.clinic_day_entries AS SELECT * FROM trapper.clinic_day_entries';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- STAFF & AUTH
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'staff') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.staff AS SELECT * FROM trapper.staff';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'staff_sessions') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.staff_sessions AS SELECT * FROM trapper.staff_sessions';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'outlook_email_accounts') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.outlook_email_accounts AS SELECT * FROM trapper.outlook_email_accounts';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- ADDITIONAL
    -- ========================================================================

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'test_mode_state') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.test_mode_state AS SELECT * FROM trapper.test_mode_state';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'entity_edits') THEN
        EXECUTE 'CREATE OR REPLACE VIEW ops.entity_edits AS SELECT * FROM trapper.entity_edits';
        v_created := v_created + 1;
    ELSE
        v_skipped := v_skipped + 1;
    END IF;

    -- ========================================================================
    -- SUMMARY
    -- ========================================================================

    RAISE NOTICE 'MIG_2098: Created % ops.* views, skipped % (source tables not found)', v_created, v_skipped;

END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2098 Complete (Safe Version)'
\echo '=============================================='
\echo ''
\echo 'Note: Views only created where trapper.* source tables exist.'
\echo 'Disease tracking handled separately by MIG_2110.'
\echo ''
