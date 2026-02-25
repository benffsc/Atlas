-- MIG_2497: Add Missing Business Keywords
--
-- DATA_QUALITY FIX: "Grow Generation" and similar brand names were being
-- misclassified as 'likely_person' instead of 'organization' because
-- "generation" wasn't in the business keywords table.
--
-- Other missing keywords discovered during data quality audit.
--
-- Created: 2026-02-24

\echo ''
\echo '=============================================='
\echo '  MIG_2497: Add Missing Business Keywords'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD MISSING BUSINESS KEYWORDS
-- ============================================================================

\echo '1. Adding missing business keywords...'

INSERT INTO ref.business_keywords (keyword, category, weight, notes) VALUES
    -- Brand/retail name patterns (often used in business names)
    ('generation', 'retail', 0.8, 'Common in brand names: Grow Generation, Next Generation - MIG_2497'),
    ('gardens', 'retail', 0.7, 'Nurseries, garden centers - MIG_2497'),
    ('nursery', 'retail', 0.8, 'Plant nurseries - MIG_2497'),
    ('hydroponics', 'retail', 0.9, 'Growing supply stores - MIG_2497'),
    ('supply', 'retail', 0.7, 'X Supply, Farm Supply - MIG_2497'),
    ('supplies', 'retail', 0.7, 'Plural form - MIG_2497'),
    ('center', 'retail', 0.6, 'Shopping Center, Garden Center - MIG_2497'),
    ('depot', 'retail', 0.8, 'Home Depot style names - MIG_2497'),
    ('warehouse', 'retail', 0.8, 'X Warehouse - MIG_2497'),

    -- More automotive/repair
    ('transmission', 'automotive', 1.0, 'Auto repair - MIG_2497'),
    ('muffler', 'automotive', 1.0, 'Auto repair - MIG_2497'),
    ('brakes', 'automotive', 0.9, 'Auto repair - MIG_2497'),
    ('smog', 'automotive', 0.9, 'Smog check - MIG_2497'),

    -- Professional services
    ('dental', 'professional', 0.8, 'Dental practice - MIG_2497'),
    ('medical', 'professional', 0.8, 'Medical practice - MIG_2497'),
    ('clinic', 'professional', 0.8, 'Medical/vet clinic - MIG_2497'),
    ('law', 'professional', 0.7, 'Law firm - MIG_2497'),
    ('legal', 'professional', 0.7, 'Legal services - MIG_2497'),
    ('accounting', 'professional', 0.9, 'Accounting firm - MIG_2497'),
    ('insurance', 'professional', 0.8, 'Insurance agency - MIG_2497'),
    ('realty', 'real_estate', 0.9, 'Real estate - MIG_2497'),
    ('properties', 'real_estate', 0.8, 'Real estate - MIG_2497'),

    -- Food service
    ('restaurant', 'food', 0.9, 'Restaurant - MIG_2497'),
    ('cafe', 'food', 0.8, 'Cafe/coffee shop - MIG_2497'),
    ('bakery', 'food', 0.9, 'Bakery - MIG_2497'),
    ('pizza', 'food', 0.9, 'Pizza place - MIG_2497'),
    ('grill', 'food', 0.8, 'Bar & Grill - MIG_2497'),
    ('brewery', 'food', 0.9, 'Brewery - MIG_2497'),
    ('distillery', 'food', 0.9, 'Distillery - MIG_2497'),

    -- Manufacturing/industrial (using 'service' category)
    ('manufacturing', 'service', 1.0, 'Manufacturing company - MIG_2497'),
    ('industries', 'service', 0.9, 'X Industries - MIG_2497'),
    ('industrial', 'service', 0.9, 'Industrial company - MIG_2497'),
    ('systems', 'service', 0.7, 'X Systems - MIG_2497'),
    ('solutions', 'service', 0.7, 'X Solutions - MIG_2497'),
    ('enterprises', 'service', 0.9, 'X Enterprises - MIG_2497'),
    ('holdings', 'service', 0.9, 'X Holdings - MIG_2497'),
    ('group', 'service', 0.6, 'X Group - MIG_2497'),
    ('associates', 'professional', 0.8, 'X Associates - MIG_2497'),
    ('partners', 'professional', 0.8, 'X Partners - MIG_2497'),

    -- Technology (using 'service' category)
    ('tech', 'service', 0.8, 'Tech company - MIG_2497'),
    ('software', 'service', 0.9, 'Software company - MIG_2497'),
    ('computing', 'service', 0.9, 'Computing company - MIG_2497'),
    ('digital', 'service', 0.7, 'Digital agency - MIG_2497'),
    ('media', 'service', 0.7, 'Media company - MIG_2497'),

    -- Specific known businesses from audit
    ('grow', 'retail', 0.6, 'Lower weight - could be verb; Grow Generation is known business - MIG_2497')
ON CONFLICT (keyword) DO UPDATE SET
    weight = GREATEST(ref.business_keywords.weight, EXCLUDED.weight),
    notes = COALESCE(ref.business_keywords.notes, '') || '; updated by MIG_2497';

-- ============================================================================
-- 2. VERIFY "GROW GENERATION" NOW CLASSIFIES CORRECTLY
-- ============================================================================

\echo ''
\echo '2. Testing classification of known problematic names:'

SELECT
    test_name,
    sot.classify_owner_name(test_name) as classification,
    ref.get_business_score(test_name) as business_score
FROM (VALUES
    ('Grow Generation'),
    ('Next Generation'),
    ('New Generation Farms'),
    ('Garden Supply'),
    ('Home Depot'),
    ('Atlas Tree Surgery'),
    ('Petaluma Poultry'),
    -- These should still be people
    ('John Smith'),
    ('Mary Carpenter'),
    ('Michael Miller')
) AS t(test_name);

-- ============================================================================
-- 3. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2497 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Added ~45 missing business keywords including:'
\echo '  - "generation" (fixes "Grow Generation" misclassification)'
\echo '  - Professional service keywords (dental, medical, legal, etc.)'
\echo '  - Food service keywords (restaurant, cafe, bakery, etc.)'
\echo '  - Manufacturing/industrial keywords (manufacturing, enterprises, etc.)'
\echo '  - Technology keywords (tech, software, digital, etc.)'
\echo ''
\echo 'These keywords help classify_owner_name() correctly identify'
\echo 'business names that were previously falling through to "likely_person".'
\echo ''
