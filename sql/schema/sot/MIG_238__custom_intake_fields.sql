-- MIG_238: Custom Intake Fields
-- Allows admins to add custom questions to the intake form
-- and sync them to Airtable

\echo '=== MIG_238: Custom Intake Fields ==='

-- Table to store custom intake field definitions
CREATE TABLE IF NOT EXISTS trapper.intake_custom_fields (
    field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_key TEXT NOT NULL UNIQUE,  -- Snake_case key for form/db
    field_label TEXT NOT NULL,       -- Human-readable label
    field_type TEXT NOT NULL CHECK (field_type IN (
        'text', 'textarea', 'number', 'select', 'multiselect',
        'checkbox', 'date', 'phone', 'email'
    )),
    options JSONB,                    -- For select/multiselect: [{value, label}]
    placeholder TEXT,                 -- Placeholder text
    help_text TEXT,                   -- Help text shown below field
    is_required BOOLEAN DEFAULT FALSE,
    is_beacon_critical BOOLEAN DEFAULT FALSE,  -- Important for Beacon analytics
    display_order INT DEFAULT 0,      -- Order in form
    show_for_call_types TEXT[],       -- NULL = show for all, or array of call types
    airtable_field_name TEXT,         -- Name in Airtable (auto-generated if null)
    airtable_synced_at TIMESTAMPTZ,   -- When last synced to Airtable
    is_active BOOLEAN DEFAULT TRUE,   -- Soft delete
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_intake_custom_fields_order
ON trapper.intake_custom_fields(display_order) WHERE is_active = TRUE;

-- Add column to web_intake_submissions for custom field data
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'web_intake_submissions'
        AND column_name = 'custom_fields'
    ) THEN
        ALTER TABLE trapper.web_intake_submissions
        ADD COLUMN custom_fields JSONB DEFAULT '{}';
        COMMENT ON COLUMN trapper.web_intake_submissions.custom_fields IS 'Storage for custom intake field values';
    END IF;
END $$;

-- Function to get active custom fields for a call type
CREATE OR REPLACE FUNCTION trapper.get_intake_custom_fields(p_call_type TEXT DEFAULT NULL)
RETURNS TABLE (
    field_id UUID,
    field_key TEXT,
    field_label TEXT,
    field_type TEXT,
    options JSONB,
    placeholder TEXT,
    help_text TEXT,
    is_required BOOLEAN,
    is_beacon_critical BOOLEAN,
    display_order INT,
    airtable_field_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.field_id,
        f.field_key,
        f.field_label,
        f.field_type,
        f.options,
        f.placeholder,
        f.help_text,
        f.is_required,
        f.is_beacon_critical,
        f.display_order,
        COALESCE(f.airtable_field_name, f.field_label) as airtable_field_name
    FROM trapper.intake_custom_fields f
    WHERE f.is_active = TRUE
    AND (
        f.show_for_call_types IS NULL
        OR p_call_type = ANY(f.show_for_call_types)
        OR p_call_type IS NULL
    )
    ORDER BY f.display_order, f.created_at;
END;
$$ LANGUAGE plpgsql STABLE;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION trapper.intake_custom_fields_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_custom_fields_updated ON trapper.intake_custom_fields;
CREATE TRIGGER trg_intake_custom_fields_updated
    BEFORE UPDATE ON trapper.intake_custom_fields
    FOR EACH ROW
    EXECUTE FUNCTION trapper.intake_custom_fields_updated();

COMMENT ON TABLE trapper.intake_custom_fields IS 'Custom fields that can be added to the intake form from admin UI';

\echo 'MIG_238 complete: Custom intake fields table created'
