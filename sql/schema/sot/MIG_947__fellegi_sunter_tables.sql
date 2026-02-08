\echo ''
\echo '=============================================='
\echo 'MIG_947: Fellegi-Sunter Probabilistic Matching Tables'
\echo '=============================================='
\echo ''
\echo 'Creates tables for full Fellegi-Sunter identity matching:'
\echo '  - fellegi_sunter_parameters: M/U probabilities per field'
\echo '  - fellegi_sunter_thresholds: Configurable decision thresholds'
\echo '  - Extends data_engine_match_decisions with F-S columns'
\echo ''

-- ============================================================================
-- PART 1: Create fellegi_sunter_parameters table
-- ============================================================================

\echo '1. Creating fellegi_sunter_parameters table...'

CREATE TABLE IF NOT EXISTS trapper.fellegi_sunter_parameters (
    param_id SERIAL PRIMARY KEY,
    field_name TEXT NOT NULL UNIQUE,

    -- Core F-S probabilities
    -- M = P(field agrees | records are a true match)
    -- U = P(field agrees | records are a random non-match)
    m_probability NUMERIC(6,5) NOT NULL CHECK (m_probability BETWEEN 0.00001 AND 0.99999),
    u_probability NUMERIC(6,5) NOT NULL CHECK (u_probability BETWEEN 0.00001 AND 0.99999),

    -- Pre-computed log-odds weights (for performance)
    -- Agreement weight = log2(M/U) - positive when agree
    -- Disagreement weight = log2((1-M)/(1-U)) - negative when disagree
    agreement_weight NUMERIC(8,4) GENERATED ALWAYS AS (
        LOG(2::NUMERIC, m_probability / u_probability)
    ) STORED,
    disagreement_weight NUMERIC(8,4) GENERATED ALWAYS AS (
        LOG(2::NUMERIC, (1::NUMERIC - m_probability) / (1::NUMERIC - u_probability))
    ) STORED,

    -- Field-specific configuration
    field_type TEXT NOT NULL CHECK (field_type IN ('exact', 'fuzzy', 'phonetic', 'proximity')),
    comparison_function TEXT,  -- SQL function name for custom comparison (optional)

    -- Metadata
    description TEXT,
    last_calibrated_at TIMESTAMPTZ,
    calibration_sample_size INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.fellegi_sunter_parameters IS
'Fellegi-Sunter M and U probabilities for each comparison field.

M = P(field agrees | records are a true match)
U = P(field agrees | records are a random non-match pair)

Weight formulas:
  Agreement: log2(M/U) - positive contribution when fields match
  Disagreement: log2((1-M)/(1-U)) - negative contribution when fields differ
  Missing: 0 (neutral contribution)

Example: email_exact with M=0.90, U=0.0001
  Agreement weight = log2(0.90/0.0001) = +13.14
  Disagreement weight = log2(0.10/0.9999) = -3.32';

-- Index for active parameters lookup
CREATE INDEX IF NOT EXISTS idx_fs_params_active
ON trapper.fellegi_sunter_parameters(field_name)
WHERE is_active = TRUE;

-- ============================================================================
-- PART 2: Seed initial M/U values
-- ============================================================================

\echo ''
\echo '2. Seeding initial Fellegi-Sunter parameters...'

INSERT INTO trapper.fellegi_sunter_parameters
(field_name, m_probability, u_probability, field_type, description) VALUES

-- Primary identifiers (highest discrimination power)
('email_exact', 0.90, 0.0001, 'exact',
 'Exact normalized email match. M=0.90 assumes 90% of true matches share email. U=0.0001 reflects extremely rare random email collision.'),

('phone_exact', 0.85, 0.0005, 'exact',
 'Exact normalized phone match. M=0.85 accounts for households sharing phones. U=0.0005 reflects some phone sharing in population.'),

('phone_softblacklist', 0.60, 0.10, 'exact',
 'Phone match on soft-blacklisted number (known shared/org phones). Lower M due to organizational use. Higher U due to common sharing.'),

-- Name fields (multiple similarity levels)
('name_exact', 0.70, 0.001, 'exact',
 'Exact full name match after normalization. M=0.70 accounts for nicknames/variations. U=0.001 reflects rare exact name collision.'),

('name_similar_high', 0.85, 0.02, 'fuzzy',
 'Name trigram similarity >= 0.8. High confidence - typos, slight variations. M=0.85, U=0.02 (2% false positive rate).'),

('name_similar_med', 0.75, 0.08, 'fuzzy',
 'Name trigram similarity 0.5-0.8. Medium confidence - abbreviations, middle names. M=0.75, U=0.08 (8% false positive rate).'),

('name_phonetic', 0.65, 0.05, 'phonetic',
 'Soundex/metaphone match on name. Catches phonetic variations but less precise. M=0.65, U=0.05.'),

('first_name_exact', 0.80, 0.01, 'exact',
 'First name exact match only. M=0.80 for partial match value. U=0.01 reflects common first names.'),

('last_name_exact', 0.85, 0.005, 'exact',
 'Last name exact match only. M=0.85 - last names more stable. U=0.005 - less common than first names.'),

-- Address fields
('address_exact', 0.60, 0.005, 'exact',
 'Exact normalized address match. M=0.60 - many matches at different addresses. U=0.005 - rare random address collision.'),

('address_proximity', 0.40, 0.02, 'proximity',
 'Address within 100m geocoded distance. Lower M due to neighbors. U=0.02 for nearby non-matches.')

ON CONFLICT (field_name) DO UPDATE SET
    m_probability = EXCLUDED.m_probability,
    u_probability = EXCLUDED.u_probability,
    field_type = EXCLUDED.field_type,
    description = EXCLUDED.description,
    updated_at = NOW();

\echo 'Inserted/updated parameters:'
SELECT field_name, m_probability, u_probability,
       ROUND(agreement_weight::NUMERIC, 2) AS agree_wt,
       ROUND(disagreement_weight::NUMERIC, 2) AS disagree_wt
FROM trapper.fellegi_sunter_parameters
ORDER BY ABS(agreement_weight) DESC;

-- ============================================================================
-- PART 3: Create fellegi_sunter_thresholds table
-- ============================================================================

\echo ''
\echo '3. Creating fellegi_sunter_thresholds table...'

CREATE TABLE IF NOT EXISTS trapper.fellegi_sunter_thresholds (
    threshold_id SERIAL PRIMARY KEY,
    source_system TEXT DEFAULT 'all',  -- 'all', 'clinichq', 'shelterluv', etc.

    -- Log-odds thresholds
    upper_threshold NUMERIC(8,4) NOT NULL,  -- Score >= this = auto-match
    lower_threshold NUMERIC(8,4) NOT NULL,  -- Score < this = new entity
    -- Between lower and upper = review_pending

    -- Equivalent probability thresholds (for UI display)
    -- P = 1 / (1 + 2^(-score))
    upper_probability NUMERIC(4,3) GENERATED ALWAYS AS (
        ROUND((1.0 / (1.0 + POWER(2::NUMERIC, -upper_threshold)))::NUMERIC, 3)
    ) STORED,
    lower_probability NUMERIC(4,3) GENERATED ALWAYS AS (
        ROUND((1.0 / (1.0 + POWER(2::NUMERIC, -lower_threshold)))::NUMERIC, 3)
    ) STORED,

    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_active_source UNIQUE (source_system)
);

COMMENT ON TABLE trapper.fellegi_sunter_thresholds IS
'Configurable thresholds for Fellegi-Sunter identity matching decisions.

Decision logic:
  score >= upper_threshold → auto_match (automatic linking)
  score >= lower_threshold → review_pending (human review needed)
  score < lower_threshold → new_entity (create new person)

Probability equivalents are computed for UI display:
  P = 1 / (1 + 2^(-score))

Example with upper=15, lower=2:
  upper_probability = 1/(1+2^-15) ≈ 0.97 (97%)
  lower_probability = 1/(1+2^-2) ≈ 0.80 (80%)';

-- Seed default thresholds
INSERT INTO trapper.fellegi_sunter_thresholds
(source_system, upper_threshold, lower_threshold, description) VALUES
('all', 15.0, 2.0,
 'Default thresholds: auto-match at >97% probability (15 log-odds), review at >80% (2 log-odds), new entity below 80%')
ON CONFLICT (source_system) DO NOTHING;

\echo 'Current thresholds:'
SELECT source_system, upper_threshold, lower_threshold,
       upper_probability || ' (' || ROUND(upper_probability * 100) || '%)' AS auto_match_prob,
       lower_probability || ' (' || ROUND(lower_probability * 100) || '%)' AS review_prob
FROM trapper.fellegi_sunter_thresholds;

-- ============================================================================
-- PART 4: Extend data_engine_match_decisions with F-S columns
-- ============================================================================

\echo ''
\echo '4. Extending data_engine_match_decisions with F-S columns...'

-- Add new columns for F-S scoring details
ALTER TABLE trapper.data_engine_match_decisions
ADD COLUMN IF NOT EXISTS fs_composite_score NUMERIC(10,4),
ADD COLUMN IF NOT EXISTS fs_field_scores JSONB,
ADD COLUMN IF NOT EXISTS fs_match_probability NUMERIC(6,5),
ADD COLUMN IF NOT EXISTS comparison_vector JSONB;

COMMENT ON COLUMN trapper.data_engine_match_decisions.fs_composite_score IS
'Sum of log-odds weights from Fellegi-Sunter scoring. Positive = evidence for match.';

COMMENT ON COLUMN trapper.data_engine_match_decisions.fs_field_scores IS
'JSONB breakdown of contribution from each field. Example: {"email_exact": 13.14, "phone_exact": -2.58, "name_similar_high": 5.41}';

COMMENT ON COLUMN trapper.data_engine_match_decisions.fs_match_probability IS
'Posterior probability of match, computed as 1/(1+2^(-fs_composite_score)). Range 0-1.';

COMMENT ON COLUMN trapper.data_engine_match_decisions.comparison_vector IS
'Comparison result for each field. Example: {"email_exact": "agree", "phone_exact": "missing", "name_similar_high": "agree"}';

-- Index for analyzing F-S decisions
CREATE INDEX IF NOT EXISTS idx_match_decisions_fs_score
ON trapper.data_engine_match_decisions(fs_composite_score)
WHERE fs_composite_score IS NOT NULL;

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Fellegi-Sunter parameters by weight (highest discrimination first):'
SELECT field_name,
       m_probability AS m,
       u_probability AS u,
       ROUND(agreement_weight::NUMERIC, 2) AS agree,
       ROUND(disagreement_weight::NUMERIC, 2) AS disagree,
       field_type
FROM trapper.fellegi_sunter_parameters
WHERE is_active = TRUE
ORDER BY agreement_weight DESC;

\echo ''
\echo 'Decision thresholds:'
SELECT * FROM trapper.fellegi_sunter_thresholds;

\echo ''
\echo '=============================================='
\echo 'MIG_947 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - fellegi_sunter_parameters: 11 field parameters'
\echo '  - fellegi_sunter_thresholds: 1 default threshold set'
\echo '  - Extended data_engine_match_decisions with F-S columns'
\echo ''
\echo 'Next: Run MIG_948 to create F-S scoring functions'
\echo ''
