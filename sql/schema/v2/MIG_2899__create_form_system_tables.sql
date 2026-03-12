-- MIG_2899: Create form system tables (field registry, templates, submissions)
-- Part of Paper-to-Digital Form System (FFS-402, FFS-410, FFS-411, FFS-412)
--
-- Three-layer architecture:
--   Layer 1: form_field_definitions — define fields once
--   Layer 2: form_templates + form_template_fields — compose fields into documents
--   Layer 3: form_submissions — record what was captured (audit trail)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- LAYER 1: Field Registry
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ops.form_field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    print_label TEXT,
    field_type TEXT NOT NULL CHECK (field_type IN ('text','number','boolean','select','multi_select','date','textarea','phone','email')),
    options JSONB,
    validation JSONB,
    default_value JSONB,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN ('contact','location','cat_info','logistics','trapping','kitten','medical','staff','referral')),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_defs_category ON ops.form_field_definitions(category);

-- ═══════════════════════════════════════════════════════════════════
-- LAYER 2: Form Templates
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ops.form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('request','cat','place')),
    schema_version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    print_layout JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops.form_template_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES ops.form_templates(id) ON DELETE CASCADE,
    field_definition_id UUID NOT NULL REFERENCES ops.form_field_definitions(id),
    sort_order INT NOT NULL,
    is_required BOOLEAN DEFAULT FALSE,
    section_name TEXT NOT NULL,
    print_section TEXT,
    override_label TEXT,
    override_validation JSONB,
    field_width TEXT DEFAULT 'sm' CHECK (field_width IN ('sm','md','lg','xl')),
    UNIQUE(template_id, field_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_template_fields_template ON ops.form_template_fields(template_id);

-- ═══════════════════════════════════════════════════════════════════
-- LAYER 3: Form Submissions
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ops.form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('request','cat','place')),
    entity_id UUID NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    submitted_by UUID,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'atlas_ui' CHECK (source IN ('atlas_ui','paper_entry','web_intake','import')),
    paper_scan_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_entity ON ops.form_submissions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_template ON ops.form_submissions(template_key);
CREATE INDEX IF NOT EXISTS idx_form_submissions_data ON ops.form_submissions USING GIN(data);

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Field Definitions (~85 fields across 9 categories)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO ops.form_field_definitions (field_key, label, field_type, category, sort_order, options, validation, description) VALUES
-- Contact (10 fields)
('first_name',              'First Name',               'text',     'contact',   10, NULL, '{"required":true}', NULL),
('last_name',               'Last Name',                'text',     'contact',   20, NULL, '{"required":true}', NULL),
('phone',                   'Phone',                    'phone',    'contact',   30, NULL, NULL, NULL),
('email',                   'Email',                    'email',    'contact',   40, NULL, NULL, NULL),
('preferred_contact_method','Preferred Contact',        'select',   'contact',   50, '["Call","Text","Email"]', NULL, NULL),
('best_contact_times',      'Best Contact Times',       'text',     'contact',   60, NULL, NULL, NULL),
('is_third_party_report',   'Third-Party Report?',      'boolean',  'contact',   70, NULL, NULL, 'Reporting on behalf of someone else'),
('third_party_relationship','Relationship',             'text',     'contact',   80, NULL, NULL, 'e.g. Neighbor, property manager'),
('property_owner_name',     'Property Owner Name',      'text',     'contact',   90, NULL, NULL, NULL),
('property_owner_contact',  'Owner Phone/Email',        'text',     'contact',  100, NULL, NULL, NULL),

-- Location (10 fields)
('address',                 'Street Address',           'text',     'location',  10, NULL, '{"required":true}', NULL),
('city',                    'City',                     'text',     'location',  20, NULL, NULL, NULL),
('zip',                     'ZIP',                      'text',     'location',  30, NULL, '{"pattern":"^\\d{5}$"}', NULL),
('county',                  'County',                   'select',   'location',  40, '["Sonoma","Marin","Napa","Other"]', NULL, NULL),
('property_type',           'Property Type',            'select',   'location',  50, '["House","Apartment","Business","Rural","Other"]', NULL, NULL),
('ownership_status',        'Caller Relationship',      'select',   'location',  60, '["Stray (no owner)","Community cat I feed","Newcomer","Neighbor''s cat","My pet"]', NULL, 'Caller''s relationship to the cat'),
('location_description',    'Location Description',     'textarea', 'location',  70, NULL, NULL, 'Landmarks, access details'),
('access_notes',            'Access Notes',             'textarea', 'location',  80, NULL, NULL, 'Gate codes, parking, hazards'),
('is_property_owner',       'Is Property Owner?',       'select',   'location',  90, '["Yes","Renter","Neighbor"]', NULL, NULL),
('has_property_access',     'Property Access?',         'select',   'location', 100, '["Yes","Need Permission","No"]', NULL, NULL),

-- Cat Info (12 fields)
('cat_count',               'How Many Cats?',           'number',   'cat_info',  10, NULL, '{"min":0}', 'Estimated cat count'),
('peak_count',              'Peak Count',               'number',   'cat_info',  15, NULL, '{"min":0}', 'Most cats seen at one time'),
('eartip_count',            'Eartipped Count',          'number',   'cat_info',  20, NULL, '{"min":0}', NULL),
('count_confidence',        'Count Confidence',         'select',   'cat_info',  25, '["Exact","Good Estimate","Rough Guess","Unknown"]', NULL, NULL),
('cats_friendly',           'Cats Friendly?',           'select',   'cat_info',  30, '["Yes","No","Mixed","Unknown"]', NULL, NULL),
('handleability',           'Handleability',            'select',   'cat_info',  35, '["Carrier OK","Shy but handleable","Trap needed"]', NULL, NULL),
('fixed_status',            'Fixed Status',             'select',   'cat_info',  40, '["None fixed","Some fixed","Most/All fixed","Unknown"]', NULL, 'Eartipped / known fixed'),
('colony_duration',         'Colony Duration',          'select',   'cat_info',  45, '["<1 month","1-6 months","6mo-2yr","2+ years","Unknown"]', NULL, NULL),
('cat_descriptions',        'Cat Descriptions',         'textarea', 'cat_info',  50, NULL, NULL, 'Colors, markings, distinguishing features'),
('is_being_fed',            'Being Fed?',               'boolean',  'cat_info',  55, NULL, NULL, NULL),
('feeding_frequency',       'Feeding Frequency',        'select',   'cat_info',  60, '["Daily","Few times/week","Occasionally","Rarely"]', NULL, NULL),
('awareness_duration',      'How Long Aware?',          'select',   'cat_info',  65, '["Days","Weeks","Months","Years"]', NULL, 'How long caller has known about cats'),

-- Logistics (10 fields)
('dogs_on_site',            'Dogs on Site?',            'select',   'logistics', 10, '["Yes","No"]', NULL, NULL),
('trap_savvy',              'Trap-Savvy Cats?',         'select',   'logistics', 20, '["Yes","No","Unknown"]', NULL, NULL),
('previous_tnr',            'Previous TNR?',            'select',   'logistics', 30, '["Yes","No","Partial"]', NULL, NULL),
('traps_overnight_safe',    'Traps Safe Overnight?',    'boolean',  'logistics', 40, NULL, NULL, NULL),
('permission_status',       'Permission Status',        'select',   'logistics', 50, '["Granted","Pending","Denied"]', NULL, NULL),
('feeder_name',             'Who Feeds?',               'text',     'logistics', 60, NULL, NULL, NULL),
('feeding_time',            'Feeding Time',             'text',     'logistics', 70, NULL, NULL, NULL),
('feeding_location',        'Feeding Location',         'text',     'logistics', 80, NULL, NULL, 'Where cats eat'),
('best_trapping_time',      'Best Trapping Day/Time',   'text',     'logistics', 90, NULL, NULL, NULL),
('important_notes',         'Important Notes',          'multi_select','logistics',100, '["Withhold food 24hr","Other feeders","Cross property lines","Pregnant cat","Injured/sick priority","Caller can help","Wildlife concerns","Neighbor issues","Urgent/time-sensitive"]', NULL, NULL),

-- Trapping (8 fields)
('trap_count',              '# Traps Set',              'number',   'trapping',  10, NULL, '{"min":0}', NULL),
('set_time',                'Set Time',                 'text',     'trapping',  20, NULL, NULL, NULL),
('return_time',             'Return Time',              'text',     'trapping',  30, NULL, NULL, NULL),
('cats_caught',             '# Caught',                 'number',   'trapping',  40, NULL, '{"min":0}', NULL),
('trap_locations',          'Trap Locations',           'text',     'trapping',  50, NULL, NULL, 'Where to set traps'),
('recon_count',             'Recon Cat Count',          'number',   'trapping',  60, NULL, '{"min":0}', NULL),
('recon_adult_kitten_tipped','Adults / Kittens / Tipped','text',    'trapping',  70, NULL, NULL, 'e.g. 5/2/3'),
('recon_observations',      'Recon Observations',       'textarea', 'trapping',  80, NULL, NULL, 'Site conditions, food sources, hiding spots'),

-- Kitten (9 fields)
('has_kittens',             'Kittens Present?',         'boolean',  'kitten',    10, NULL, NULL, NULL),
('kitten_count',            'Kitten Count',             'number',   'kitten',    20, NULL, '{"min":0}', NULL),
('kitten_age_estimate',     'Kitten Age Range',         'select',   'kitten',    30, '["Under 4 wks","4-8 wks","8-12 wks","12-16 wks","4+ months","Mixed"]', NULL, NULL),
('kitten_behavior',         'Kitten Behavior',          'select',   'kitten',    40, '["Friendly","Shy but handleable","Feral/hissy","Unknown"]', NULL, NULL),
('kitten_contained',        'Kittens Contained?',       'select',   'kitten',    50, '["Yes","Some","No"]', NULL, NULL),
('mom_present',             'Mom Present?',             'select',   'kitten',    60, '["Yes","No","Unsure"]', NULL, NULL),
('mom_fixed',               'Mom Fixed?',               'select',   'kitten',    70, '["Yes","No","Unsure"]', NULL, NULL),
('can_bring_in',            'Can Bring Kittens In?',    'select',   'kitten',    80, '["Yes","Need Help","No"]', NULL, NULL),
('kitten_notes',            'Kitten Details',           'textarea', 'kitten',    90, NULL, NULL, 'Colors, hiding spots, feeding schedule'),

-- Medical (5 fields)
('has_medical_concerns',    'Medical Concerns?',        'boolean',  'medical',   10, NULL, NULL, NULL),
('medical_description',     'Medical Description',      'textarea', 'medical',   20, NULL, NULL, NULL),
('is_emergency',            'Emergency?',               'boolean',  'medical',   30, NULL, NULL, NULL),
('urgency_reasons',         'Urgency Reasons',          'multi_select','medical', 40, '["Young kittens","Sick/injured","Threat to cats","Poison risk","Eviction","Moving soon","Pregnant cat","Weather"]', NULL, NULL),
('urgency_notes',           'Urgency Notes',            'textarea', 'medical',   50, NULL, NULL, NULL),

-- Staff / Office Use (8 fields)
('date_received',           'Date Received',            'date',     'staff',     10, NULL, NULL, NULL),
('received_by',             'Received By',              'text',     'staff',     20, NULL, NULL, 'Staff initials'),
('intake_source',           'Source',                   'select',   'staff',     30, '["Phone","Paper","Walk-in","Website"]', NULL, NULL),
('priority',                'Priority',                 'select',   'staff',     40, '["High","Normal","Low"]', NULL, NULL),
('triage_category',         'Triage',                   'select',   'staff',     50, '["FFR","Wellness","Owned","Out of Area","Review"]', NULL, NULL),
('staff_notes',             'Staff Notes',              'textarea', 'staff',     60, NULL, NULL, NULL),
('assigned_trapper',        'Assigned Trapper',         'text',     'staff',     70, NULL, NULL, NULL),
('scheduled_date',          'Scheduled Date',           'date',     'staff',     80, NULL, NULL, NULL),

-- Referral (3 fields)
('referral_source',         'Heard From',               'select',   'referral',  10, '["Website","Social Media","Friend","Vet/Shelter","Repeat Caller","Other"]', NULL, NULL),
('situation_description',   'Situation Description',    'textarea', 'referral',  20, NULL, NULL, 'Describe the full situation'),
('caller_notes',            'Caller/Voicemail Notes',   'textarea', 'referral',  30, NULL, NULL, 'Notes from voicemail or callback')
ON CONFLICT (field_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Form Templates (3 core documents)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO ops.form_templates (template_key, name, description, entity_type, print_layout) VALUES
('help_request',    'Help Request Form',        'Public intake form for requesting assistance with community cats',       'request', '{"pages":2,"orientation":"portrait","audience":"public"}'),
('tnr_call_sheet',  'TNR Call Sheet',           'Standardized phone script for trappers calling people back',             'request', '{"pages":2,"orientation":"portrait","audience":"trappers"}'),
('trapper_sheet',   'Trapper Assignment Sheet', 'Pre-filled field trapping assignment with recon mode',                   'request', '{"pages":2,"orientation":"portrait","audience":"trappers"}')
ON CONFLICT (template_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SEED: Template-Field Mappings
-- Maps which fields appear on which forms, grouped by section
-- ═══════════════════════════════════════════════════════════════════

-- Helper: get IDs
DO $$
DECLARE
  t_help UUID;
  t_call UUID;
  t_trap UUID;
BEGIN
  SELECT id INTO t_help FROM ops.form_templates WHERE template_key = 'help_request';
  SELECT id INTO t_call FROM ops.form_templates WHERE template_key = 'tnr_call_sheet';
  SELECT id INTO t_trap FROM ops.form_templates WHERE template_key = 'trapper_sheet';

  -- ── HELP REQUEST FORM ──
  -- Contact (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, field_key IN ('first_name','last_name','email'), 'Contact Information', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('first_name','last_name','phone','email','preferred_contact_method')
  ON CONFLICT DO NOTHING;

  -- Third-party (3 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'Third-Party Report', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('is_third_party_report','third_party_relationship','property_owner_name')
  ON CONFLICT DO NOTHING;

  -- Location (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, field_key = 'address', 'Where Are the Cats?', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('address','city','zip','county','ownership_status')
  ON CONFLICT DO NOTHING;

  -- Cat Info (7 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'About the Cats', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('cat_count','eartip_count','cats_friendly','is_being_fed','feeding_frequency','awareness_duration','has_kittens')
  ON CONFLICT DO NOTHING;

  -- Medical (3 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'Emergency', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('is_emergency','has_medical_concerns','urgency_reasons')
  ON CONFLICT DO NOTHING;

  -- Details (2 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'Additional Details', CASE WHEN field_type = 'textarea' THEN 'lg' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('situation_description','referral_source')
  ON CONFLICT DO NOTHING;

  -- Staff (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'Office Use Only', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('date_received','received_by','intake_source','priority','triage_category')
  ON CONFLICT DO NOTHING;

  -- Kitten (8 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_help, id, sort_order, false, 'Kitten Information', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('kitten_count','kitten_age_estimate','kitten_behavior','kitten_contained','mom_present','mom_fixed','can_bring_in','kitten_notes')
  ON CONFLICT DO NOTHING;

  -- ── TNR CALL SHEET ──
  -- Contact (7 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, field_key IN ('first_name','last_name','phone'), 'Contact Information', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('first_name','last_name','phone','email','is_third_party_report','third_party_relationship','best_contact_times')
  ON CONFLICT DO NOTHING;

  -- Location (7 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, field_key = 'address', 'Where Are the Cats?', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('address','city','zip','county','property_type','ownership_status','location_description')
  ON CONFLICT DO NOTHING;

  -- Cat Info (9 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'About the Cats', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('cat_count','eartip_count','cats_friendly','is_being_fed','feeding_frequency','colony_duration','has_kittens','awareness_duration','fixed_status')
  ON CONFLICT DO NOTHING;

  -- Medical (3 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Emergency', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('is_emergency','has_medical_concerns','urgency_reasons')
  ON CONFLICT DO NOTHING;

  -- Details (3 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Additional Details', CASE WHEN field_type = 'textarea' THEN 'lg' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('situation_description','referral_source','important_notes')
  ON CONFLICT DO NOTHING;

  -- Staff (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Office Use Only', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('date_received','received_by','intake_source','priority','triage_category')
  ON CONFLICT DO NOTHING;

  -- Logistics (9 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Property Access & Logistics', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('has_property_access','is_property_owner','dogs_on_site','trap_savvy','previous_tnr','handleability','access_notes','feeder_name','feeding_time')
  ON CONFLICT DO NOTHING;

  -- Trapping schedule (2 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Best Trapping Times', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('feeding_location','best_trapping_time')
  ON CONFLICT DO NOTHING;

  -- Staff plan (3 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Trapping Plan', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('assigned_trapper','scheduled_date','staff_notes')
  ON CONFLICT DO NOTHING;

  -- Kitten (8 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_call, id, sort_order, false, 'Kitten Information', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('kitten_count','kitten_age_estimate','kitten_behavior','kitten_contained','mom_present','mom_fixed','can_bring_in','kitten_notes')
  ON CONFLICT DO NOTHING;

  -- ── TRAPPER ASSIGNMENT SHEET ──
  -- Contact (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Contact', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('first_name','last_name','phone','email','preferred_contact_method')
  ON CONFLICT DO NOTHING;

  -- Location (7 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Location', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('address','city','zip','county','property_type','location_description','access_notes')
  ON CONFLICT DO NOTHING;

  -- Cat Info (9 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Cats', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('cat_count','eartip_count','count_confidence','colony_duration','is_being_fed','feeding_frequency','feeder_name','handleability','has_kittens')
  ON CONFLICT DO NOTHING;

  -- Logistics (7 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Access & Logistics', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('permission_status','traps_overnight_safe','is_property_owner','dogs_on_site','trap_savvy','property_owner_contact','important_notes')
  ON CONFLICT DO NOTHING;

  -- Schedule (4 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Trapping Schedule', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('best_contact_times','feeding_time','feeding_location','best_trapping_time')
  ON CONFLICT DO NOTHING;

  -- Trapping (5 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Trapper Recon', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('recon_count','recon_adult_kitten_tipped','trap_locations','cat_descriptions','recon_observations')
  ON CONFLICT DO NOTHING;

  -- Trap Day (4 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Trap Day', 'sm'
  FROM ops.form_field_definitions WHERE field_key IN ('set_time','trap_count','cats_caught','return_time')
  ON CONFLICT DO NOTHING;

  -- Medical (4 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Urgency', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('has_medical_concerns','medical_description','urgency_reasons','urgency_notes')
  ON CONFLICT DO NOTHING;

  -- Kitten (8 fields)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, sort_order, false, 'Kitten Details', CASE WHEN field_type = 'textarea' THEN 'md' ELSE 'sm' END
  FROM ops.form_field_definitions WHERE field_key IN ('kitten_count','kitten_age_estimate','kitten_behavior','kitten_contained','mom_present','mom_fixed','can_bring_in','kitten_notes')
  ON CONFLICT DO NOTHING;

  -- Notes (1 field)
  INSERT INTO ops.form_template_fields (template_id, field_definition_id, sort_order, is_required, section_name, field_width)
  SELECT t_trap, id, 200, false, 'Notes', 'lg'
  FROM ops.form_field_definitions WHERE field_key = 'staff_notes'
  ON CONFLICT DO NOTHING;

END $$;

COMMIT;
