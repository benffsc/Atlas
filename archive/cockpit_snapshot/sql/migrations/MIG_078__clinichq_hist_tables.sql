-- MIG_078__clinichq_hist_tables.sql
-- Creates historical mirror tables for ClinicHQ legacy XLSX reports
--
-- Source files (do not commit to git):
--   data/raw/clinichq/appointments/legacy_reports/8af_82e_b38/report_8af__appts.xlsx (272,664 rows)
--   data/raw/clinichq/appointments/legacy_reports/8af_82e_b38/report_82e__cats.xlsx (37,857 rows)
--   data/raw/clinichq/appointments/legacy_reports/8af_82e_b38/report_b38__owners.xlsx (37,857 rows)
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_078__clinichq_hist_tables.sql

-- ============================================
-- CLINICHQ_HIST_APPTS (from report_8af)
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_appts') THEN
        RAISE NOTICE 'Table trapper.clinichq_hist_appts already exists, skipping';
    ELSE
        CREATE TABLE trapper.clinichq_hist_appts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Core typed fields
            appt_date date,
            appt_number integer,
            animal_name text,
            vet_name text,
            microchip_number text,
            internal_medical_notes text,
            no_surgery_reason text,
            -- Surgery flags
            neuter boolean,
            spay boolean,
            cryptorchid boolean,
            pregnant boolean,
            pyometra boolean,
            in_heat boolean,
            -- Health observations
            uri boolean,
            fleas boolean,
            ticks boolean,
            ear_mites boolean,
            tapeworms boolean,
            lactating boolean,
            -- Financials
            total_invoiced numeric(10,2),
            -- Raw row for full data access
            raw_row jsonb NOT NULL,
            -- Source tracking
            source_file text NOT NULL,
            source_row_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        -- Idempotency constraint
        ALTER TABLE trapper.clinichq_hist_appts
        ADD CONSTRAINT uq_clinichq_hist_appts_source
        UNIQUE (source_file, source_row_hash);

        -- Indexes
        CREATE INDEX idx_clinichq_hist_appts_date ON trapper.clinichq_hist_appts(appt_date);
        CREATE INDEX idx_clinichq_hist_appts_microchip ON trapper.clinichq_hist_appts(microchip_number)
            WHERE microchip_number IS NOT NULL;
        CREATE INDEX idx_clinichq_hist_appts_number ON trapper.clinichq_hist_appts(appt_number);
        CREATE INDEX idx_clinichq_hist_appts_animal ON trapper.clinichq_hist_appts(animal_name);

        COMMENT ON TABLE trapper.clinichq_hist_appts IS
        'Historical ClinicHQ appointments from report_8af. 272K+ records with surgery/medical details.';

        RAISE NOTICE 'Created table trapper.clinichq_hist_appts';
    END IF;
END $$;

-- ============================================
-- CLINICHQ_HIST_CATS (from report_82e)
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_cats') THEN
        RAISE NOTICE 'Table trapper.clinichq_hist_cats already exists, skipping';
    ELSE
        CREATE TABLE trapper.clinichq_hist_cats (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Core typed fields
            appt_date date,
            appt_number integer,
            animal_name text,
            microchip_number text,
            breed text,
            sex text,
            primary_color text,
            secondary_color text,
            spay_neuter_status text,
            weight numeric(5,2),
            age_months integer,
            age_years integer,
            -- Raw row for full data
            raw_row jsonb NOT NULL,
            -- Source tracking
            source_file text NOT NULL,
            source_row_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        -- Idempotency constraint
        ALTER TABLE trapper.clinichq_hist_cats
        ADD CONSTRAINT uq_clinichq_hist_cats_source
        UNIQUE (source_file, source_row_hash);

        -- Indexes
        CREATE INDEX idx_clinichq_hist_cats_date ON trapper.clinichq_hist_cats(appt_date);
        CREATE INDEX idx_clinichq_hist_cats_microchip ON trapper.clinichq_hist_cats(microchip_number)
            WHERE microchip_number IS NOT NULL;
        CREATE INDEX idx_clinichq_hist_cats_number ON trapper.clinichq_hist_cats(appt_number);
        CREATE INDEX idx_clinichq_hist_cats_breed ON trapper.clinichq_hist_cats(breed);

        COMMENT ON TABLE trapper.clinichq_hist_cats IS
        'Historical ClinicHQ cat records from report_82e. 37K+ records with breed/age/color.';

        RAISE NOTICE 'Created table trapper.clinichq_hist_cats';
    END IF;
END $$;

-- ============================================
-- CLINICHQ_HIST_OWNERS (from report_b38)
-- ============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'trapper' AND table_name = 'clinichq_hist_owners') THEN
        RAISE NOTICE 'Table trapper.clinichq_hist_owners already exists, skipping';
    ELSE
        CREATE TABLE trapper.clinichq_hist_owners (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Core typed fields
            appt_date date,
            appt_number integer,
            animal_name text,
            microchip_number text,
            ownership text,
            owner_first_name text,
            owner_last_name text,
            owner_address text,
            owner_cell_phone text,
            owner_phone text,
            owner_email text,
            client_type text,
            -- Normalized phone for matching
            phone_normalized text,
            -- Raw row for full data
            raw_row jsonb NOT NULL,
            -- Source tracking
            source_file text NOT NULL,
            source_row_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        -- Idempotency constraint
        ALTER TABLE trapper.clinichq_hist_owners
        ADD CONSTRAINT uq_clinichq_hist_owners_source
        UNIQUE (source_file, source_row_hash);

        -- Indexes
        CREATE INDEX idx_clinichq_hist_owners_date ON trapper.clinichq_hist_owners(appt_date);
        CREATE INDEX idx_clinichq_hist_owners_microchip ON trapper.clinichq_hist_owners(microchip_number)
            WHERE microchip_number IS NOT NULL;
        CREATE INDEX idx_clinichq_hist_owners_number ON trapper.clinichq_hist_owners(appt_number);
        CREATE INDEX idx_clinichq_hist_owners_email ON trapper.clinichq_hist_owners(owner_email)
            WHERE owner_email IS NOT NULL;
        CREATE INDEX idx_clinichq_hist_owners_phone_normalized ON trapper.clinichq_hist_owners(phone_normalized)
            WHERE phone_normalized IS NOT NULL;

        -- Trigram index for owner name search
        CREATE INDEX idx_clinichq_hist_owners_name_trgm
        ON trapper.clinichq_hist_owners
        USING gin ((COALESCE(owner_first_name, '') || ' ' || COALESCE(owner_last_name, '')) gin_trgm_ops);

        COMMENT ON TABLE trapper.clinichq_hist_owners IS
        'Historical ClinicHQ owner records from report_b38. 37K+ records with contact info.';

        RAISE NOTICE 'Created table trapper.clinichq_hist_owners';
    END IF;
END $$;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT
    'clinichq_hist_appts' AS table_name,
    (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) AS rows
UNION ALL
SELECT
    'clinichq_hist_cats',
    (SELECT COUNT(*) FROM trapper.clinichq_hist_cats)
UNION ALL
SELECT
    'clinichq_hist_owners',
    (SELECT COUNT(*) FROM trapper.clinichq_hist_owners);
