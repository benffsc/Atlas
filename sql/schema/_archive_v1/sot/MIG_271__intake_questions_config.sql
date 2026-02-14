\echo '=== MIG_237: Intake Questions Configuration ==='
\echo 'Dynamic intake question management for admin customization'

-- Intake questions configuration table
CREATE TABLE IF NOT EXISTS trapper.intake_questions (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_key TEXT NOT NULL UNIQUE,  -- e.g., 'ownership_status', 'feeds_cat', 'custom_1'
    question_type TEXT NOT NULL DEFAULT 'select',  -- select, radio, checkbox, text, textarea
    question_text TEXT NOT NULL,  -- The actual question displayed to users
    help_text TEXT,  -- Optional help text shown below question
    is_required BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_custom BOOLEAN DEFAULT FALSE,  -- TRUE for staff-added questions
    display_order INT NOT NULL DEFAULT 0,
    step_name TEXT NOT NULL DEFAULT 'cats',  -- Which step: contact, location, cats, situation, review
    show_condition JSONB,  -- When to show this question, e.g., {"field": "ownership_status", "value": "community_colony"}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT
);

-- Question options for select/radio types
CREATE TABLE IF NOT EXISTS trapper.intake_question_options (
    option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES trapper.intake_questions(question_id) ON DELETE CASCADE,
    option_value TEXT NOT NULL,  -- Value stored in database
    option_label TEXT NOT NULL,  -- Display text to user
    option_description TEXT,  -- Optional description/help text
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    show_warning BOOLEAN DEFAULT FALSE,  -- Show warning styling for this option
    warning_text TEXT,  -- Warning message to display
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom question responses (for staff-added questions)
CREATE TABLE IF NOT EXISTS trapper.intake_custom_responses (
    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES trapper.web_intake_submissions(submission_id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES trapper.intake_questions(question_id),
    response_value TEXT,
    response_text TEXT,  -- For text/textarea types
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_custom_responses_submission ON trapper.intake_custom_responses(submission_id);
CREATE INDEX IF NOT EXISTS idx_intake_questions_active ON trapper.intake_questions(is_active, display_order);

-- Seed the core questions with current wording
INSERT INTO trapper.intake_questions (question_key, question_type, question_text, help_text, is_required, display_order, step_name) VALUES
-- Cat type question (simplified wording)
('ownership_status', 'radio', 'What best describes this cat?', 'Select the option that best fits the situation', TRUE, 1, 'cats'),
-- Feeding behavior questions
('feeds_cat', 'radio', 'Do you feed this cat?', NULL, FALSE, 2, 'cats'),
('feeding_frequency', 'select', 'How often do you feed this cat?', NULL, FALSE, 3, 'cats'),
('feeding_duration', 'select', 'How long have you been feeding or aware of this cat?', NULL, FALSE, 4, 'cats'),
('cat_comes_inside', 'radio', 'Does this cat come inside your home?', NULL, FALSE, 5, 'cats'),
-- Fixed status
('fixed_status', 'radio', 'Are any of these cats already fixed (spayed/neutered)?', 'Look for an ear tip - a small notch cut from the ear tip during TNR surgery', TRUE, 6, 'cats'),
-- Emergency
('is_emergency', 'checkbox', 'This is an urgent situation', 'Injured cat, active labor, or immediate danger', FALSE, 1, 'situation')
ON CONFLICT (question_key) DO NOTHING;

-- Seed options for ownership_status (simplified wording)
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, option_description, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.option_description, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('unknown_stray', 'Stray cat (no apparent owner)', 'A cat that appears to have no home or caretaker', 1),
    ('community_colony', 'Outdoor cat I or someone feeds', 'A cat that lives outside but is being fed/cared for', 2),
    ('newcomer', 'Newcomer (just showed up recently)', 'A cat that recently appeared in your area', 3),
    ('neighbors_cat', 'Neighbor''s cat', 'A cat that belongs to someone nearby', 4),
    ('my_cat', 'My own pet', 'Your personal pet cat', 5)
) AS v(option_value, option_label, option_description, display_order)
WHERE q.question_key = 'ownership_status'
ON CONFLICT DO NOTHING;

-- Seed options for feeds_cat
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('yes', 'Yes', 1),
    ('no', 'No', 2)
) AS v(option_value, option_label, display_order)
WHERE q.question_key = 'feeds_cat'
ON CONFLICT DO NOTHING;

-- Seed options for feeding_frequency
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('daily', 'Daily', 1),
    ('few_times_week', 'A few times a week', 2),
    ('occasionally', 'Occasionally', 3),
    ('rarely', 'Rarely/Never', 4)
) AS v(option_value, option_label, display_order)
WHERE q.question_key = 'feeding_frequency'
ON CONFLICT DO NOTHING;

-- Seed options for feeding_duration
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('just_started', 'Just started (less than 2 weeks)', 1),
    ('few_weeks', 'A few weeks', 2),
    ('few_months', 'A few months', 3),
    ('over_year', 'Over a year', 4)
) AS v(option_value, option_label, display_order)
WHERE q.question_key = 'feeding_duration'
ON CONFLICT DO NOTHING;

-- Seed options for cat_comes_inside
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('yes_regularly', 'Yes, regularly', 1),
    ('sometimes', 'Sometimes', 2),
    ('never', 'Never', 3)
) AS v(option_value, option_label, display_order)
WHERE q.question_key = 'cat_comes_inside'
ON CONFLICT DO NOTHING;

-- Seed options for fixed_status
INSERT INTO trapper.intake_question_options (question_id, option_value, option_label, option_description, display_order)
SELECT q.question_id, v.option_value, v.option_label, v.option_description, v.display_order
FROM trapper.intake_questions q
CROSS JOIN (VALUES
    ('none_fixed', 'None are fixed', 'No ear tips visible', 1),
    ('some_fixed', 'Some are fixed', 'A few have ear tips', 2),
    ('most_fixed', 'Most are fixed', 'Most have ear tips', 3),
    ('all_fixed', 'All are fixed', 'All have ear tips', 4),
    ('unknown', 'I don''t know', 'Can''t tell or haven''t checked', 5)
) AS v(option_value, option_label, option_description, display_order)
WHERE q.question_key = 'fixed_status'
ON CONFLICT DO NOTHING;

-- Function to get active questions with options
CREATE OR REPLACE FUNCTION trapper.get_intake_questions(p_step TEXT DEFAULT NULL)
RETURNS TABLE(
    question_id UUID,
    question_key TEXT,
    question_type TEXT,
    question_text TEXT,
    help_text TEXT,
    is_required BOOLEAN,
    is_custom BOOLEAN,
    display_order INT,
    step_name TEXT,
    show_condition JSONB,
    options JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        q.question_id,
        q.question_key,
        q.question_type,
        q.question_text,
        q.help_text,
        q.is_required,
        q.is_custom,
        q.display_order,
        q.step_name,
        q.show_condition,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'value', o.option_value,
                    'label', o.option_label,
                    'description', o.option_description,
                    'showWarning', o.show_warning,
                    'warningText', o.warning_text
                ) ORDER BY o.display_order
            ) FILTER (WHERE o.option_id IS NOT NULL),
            '[]'::jsonb
        ) as options
    FROM trapper.intake_questions q
    LEFT JOIN trapper.intake_question_options o ON o.question_id = q.question_id AND o.is_active = TRUE
    WHERE q.is_active = TRUE
      AND (p_step IS NULL OR q.step_name = p_step)
    GROUP BY q.question_id, q.question_key, q.question_type, q.question_text,
             q.help_text, q.is_required, q.is_custom, q.display_order, q.step_name, q.show_condition
    ORDER BY q.display_order;
END;
$$ LANGUAGE plpgsql;

-- View for easy admin access
CREATE OR REPLACE VIEW trapper.v_intake_questions_admin AS
SELECT
    q.question_id,
    q.question_key,
    q.question_type,
    q.question_text,
    q.help_text,
    q.is_required,
    q.is_active,
    q.is_custom,
    q.display_order,
    q.step_name,
    q.show_condition,
    q.created_at,
    q.updated_at,
    q.created_by,
    q.updated_by,
    COUNT(o.option_id) as option_count
FROM trapper.intake_questions q
LEFT JOIN trapper.intake_question_options o ON o.question_id = q.question_id
GROUP BY q.question_id
ORDER BY q.step_name, q.display_order;

COMMENT ON TABLE trapper.intake_questions IS 'Dynamic intake form questions - admin can edit wording and add custom questions';
COMMENT ON TABLE trapper.intake_question_options IS 'Options for select/radio intake questions';
COMMENT ON TABLE trapper.intake_custom_responses IS 'Responses to custom staff-added questions';

\echo 'MIG_237 complete: Intake questions config tables created with seed data'
