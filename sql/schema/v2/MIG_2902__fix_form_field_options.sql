-- MIG_2902: Fix form field option mismatches and add missing fields
--
-- The field registry options need to match what's actually used in print pages.
-- Print pages use abbreviated labels for space. Also adds missing fields
-- discovered during the options audit.
--
-- Safe: only updates ops.form_field_definitions data, no schema changes.

BEGIN;

-- ── Fix option mismatches ──

-- awareness_duration: print pages use "Days" not "<2 weeks"
UPDATE ops.form_field_definitions
SET options = '["Days","Weeks","Months","1+ year"]'::jsonb
WHERE field_key = 'awareness_duration';

-- colony_duration: add "Unknown" option used in call sheet
UPDATE ops.form_field_definitions
SET options = '["<1 month","1-6 months","6mo-2yr","2+ years","Unknown"]'::jsonb
WHERE field_key = 'colony_duration';

-- handleability: add "Mixed" used in call sheet, keep existing
UPDATE ops.form_field_definitions
SET options = '["Carrier OK","Shy but handleable","Trap needed","Mixed"]'::jsonb
WHERE field_key = 'handleability';

-- intake_source: add "Website" option
UPDATE ops.form_field_definitions
SET options = '["Phone","Paper","Walk-in","Website"]'::jsonb
WHERE field_key = 'intake_source';

-- ── Add missing fields ──

-- Eartip count (qualitative) — used on intake and call sheet
INSERT INTO ops.form_field_definitions (field_key, label, print_label, field_type, options, category, sort_order)
VALUES ('eartip_status', 'Eartipped Cats', 'Eartipped?', 'select',
        '["None","Some","Most/All","Unknown"]'::jsonb,
        'cat_info', 165)
ON CONFLICT (field_key) DO NOTHING;

-- Home access — used on intake form
INSERT INTO ops.form_field_definitions (field_key, label, print_label, field_type, options, category, sort_order)
VALUES ('home_access', 'Cats Enter Home', 'Go inside?', 'select',
        '["Yes","Sometimes","Never"]'::jsonb,
        'cat_info', 170)
ON CONFLICT (field_key) DO NOTHING;

-- Kitten outcome assessment — used on intake kitten page
INSERT INTO ops.form_field_definitions (field_key, label, print_label, field_type, options, category, sort_order)
VALUES ('kitten_outcome', 'Kitten Outcome', NULL, 'select',
        '["Foster intake","FFR candidate","Pending space","Declined"]'::jsonb,
        'kitten', 830)
ON CONFLICT (field_key) DO NOTHING;

-- Kitten readiness — used on intake kitten page
INSERT INTO ops.form_field_definitions (field_key, label, print_label, field_type, options, category, sort_order)
VALUES ('kitten_readiness', 'Kitten Readiness', NULL, 'select',
        '["High (friendly, ideal age)","Medium (needs socialization)","Low (FFR likely)"]'::jsonb,
        'kitten', 835)
ON CONFLICT (field_key) DO NOTHING;

-- Kitten urgency factors — used on intake kitten page
INSERT INTO ops.form_field_definitions (field_key, label, print_label, field_type, options, category, sort_order)
VALUES ('kitten_urgency', 'Urgency Factors', NULL, 'multi_select',
        '["Bottle babies","Medical needs","Unsafe location","Mom unfixed"]'::jsonb,
        'kitten', 840)
ON CONFLICT (field_key) DO NOTHING;

-- Verify
SELECT field_key, options
FROM ops.form_field_definitions
WHERE field_key IN ('awareness_duration', 'colony_duration', 'handleability', 'intake_source',
                    'eartip_status', 'home_access', 'kitten_outcome', 'kitten_readiness', 'kitten_urgency')
ORDER BY field_key;

COMMIT;
