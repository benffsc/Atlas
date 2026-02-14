\echo '=== MIG_241: Staff Management ==='
\echo 'Create staff table with FFSC-specific fields'

-- ============================================================
-- 1. Create staff table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.staff (
    staff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to person (optional - staff may not have been imported as sot_people yet)
    person_id UUID REFERENCES trapper.sot_people(person_id) ON DELETE SET NULL,

    -- Basic info (denormalized for easy editing)
    first_name TEXT NOT NULL,
    last_name TEXT,
    display_name TEXT GENERATED ALWAYS AS (
        TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    ) STORED,

    -- Contact
    email TEXT,
    phone TEXT,
    work_extension TEXT,

    -- Role at FFSC
    role TEXT NOT NULL,
    department TEXT,

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    hired_date DATE,
    end_date DATE,

    -- Airtable source
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate Airtable records
    UNIQUE (source_system, source_record_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_active ON trapper.staff(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_staff_email ON trapper.staff(email);
CREATE INDEX IF NOT EXISTS idx_staff_person ON trapper.staff(person_id);

COMMENT ON TABLE trapper.staff IS
'FFSC staff members with their roles and contact info. Editable in the UI.';

COMMENT ON COLUMN trapper.staff.person_id IS
'Links staff to sot_people for person-level data like communication logs';

COMMENT ON COLUMN trapper.staff.work_extension IS
'Extension for main FFSC number (707) 756-7999';

-- ============================================================
-- 2. Create trigger to update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.staff_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_updated_at ON trapper.staff;
CREATE TRIGGER trg_staff_updated_at
    BEFORE UPDATE ON trapper.staff
    FOR EACH ROW
    EXECUTE FUNCTION trapper.staff_update_timestamp();

-- ============================================================
-- 3. View for active staff
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_active_staff AS
SELECT
    s.staff_id,
    s.display_name,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.work_extension,
    s.role,
    s.department,
    s.hired_date,
    s.person_id,
    s.source_record_id AS airtable_id
FROM trapper.staff s
WHERE s.is_active = TRUE
ORDER BY s.display_name;

-- ============================================================
-- 4. Update communication_logs to reference staff
-- ============================================================

-- Add staff_id column for proper linking
ALTER TABLE trapper.communication_logs
ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.communication_logs.staff_id IS
'Staff member who made the contact. Optional if using contacted_by text field.';

\echo ''
\echo 'MIG_241 complete!'
\echo 'Created:'
\echo '  - staff table with FFSC-specific fields'
\echo '  - v_active_staff view'
\echo '  - staff_id reference in communication_logs'
\echo ''
