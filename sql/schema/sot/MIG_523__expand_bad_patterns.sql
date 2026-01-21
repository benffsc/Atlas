\echo ''
\echo '=============================================='
\echo 'MIG_523: Expand Bad Data Patterns'
\echo '=============================================='
\echo ''
\echo 'Adding additional organization, location, and email patterns'
\echo 'that should not be treated as people.'
\echo ''

-- ============================================================================
-- ADD MISSING ORGANIZATION/LOCATION PATTERNS
-- These names appear in ClinicHQ as "owner" but are actually orgs/locations
-- ============================================================================

\echo 'Adding SCAS and location patterns to known_organizations...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes) VALUES
    -- SCAS (Sonoma County Animal Services) - often used as placeholder owner
    ('SCAS', '%SCAS%', 'shelter', 'Sonoma County Animal Services abbreviation - not a person'),

    -- Public parks and locations used as owner names
    ('Howarth Park', '%Howarth Park%', 'location', 'Public park in Santa Rosa - not a person'),
    ('Graton Rancheria', '%Graton Rancheria%', 'location', 'Federated Indians of Graton Rancheria land - not a person'),
    ('Spring Lake Park', '%Spring Lake%', 'location', 'Public park - not a person'),
    ('Sonoma County Landfill', '%Landfill%', 'location', 'County facility - not a person'),

    -- Apartment complexes and housing
    ('Harvest Park Apts', '%Harvest Park%', 'location', 'Apartment complex - not a person'),
    ('Vineyard Creek Apartments', '%Vineyard Creek%', 'location', 'Apartment complex - not a person'),
    ('Burbank Gardens', '%Burbank Gardens%', 'location', 'Housing complex - not a person'),

    -- Schools
    ('Comstock Middle School', '%Comstock%', 'location', 'School - not a person'),
    ('Rincon Valley Middle School', '%Rincon Valley%', 'location', 'School - not a person'),

    -- System artifacts
    ('Duplicate Report', '%Duplicate Report%', 'system', 'System-generated placeholder - not a person'),

    -- Businesses that appear as owners
    ('Dollar Tree', '%Dollar Tree%', 'business', 'Retail store - not a person'),
    ('Safeway', '%Safeway%', 'business', 'Grocery store - not a person'),
    ('McDonalds', '%McDonald%', 'business', 'Restaurant - not a person'),
    ('Taco Bell', '%Taco Bell%', 'business', 'Restaurant - not a person'),
    ('Starbucks', '%Starbucks%', 'business', 'Coffee shop - not a person'),

    -- More rescues/shelters that may not be in original list
    ('Paws for Healing', '%Paws for Healing%', 'rescue', 'Rescue organization'),
    ('Nine Lives Foundation', '%Nine Lives%', 'rescue', 'Rescue organization'),
    ('Fix Our Ferals', '%Fix Our Ferals%', 'rescue', 'TNR organization'),
    ('North Bay Animal Services', '%North Bay Animal%', 'shelter', 'Regional animal services'),

    -- Churches/religious orgs that sometimes feed cats
    ('Jehovahs Witnesses', '%Jehovah%', 'organization', 'Religious organization - not a person')
ON CONFLICT DO NOTHING;

\echo 'Known organizations updated.'

-- ============================================================================
-- ADD ADDRESS-IN-NAME DETECTION PATTERNS
-- These detect when an address was put in the name field
-- ============================================================================

\echo 'Adding address-in-name detection patterns...'

INSERT INTO trapper.data_fixing_patterns (
    pattern_name, pattern_type, pattern_regex,
    is_organization, is_garbage, fix_action, fix_notes
) VALUES
    -- Address patterns in name field
    ('address_in_name_st', 'name', '^\d+\s+\w+\s+(St|Street)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Street address used as person name'),
    ('address_in_name_ave', 'name', '^\d+\s+\w+\s+(Ave|Avenue)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Avenue address used as person name'),
    ('address_in_name_rd', 'name', '^\d+\s+\w+\s+(Rd|Road)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Road address used as person name'),
    ('address_in_name_dr', 'name', '^\d+\s+\w+\s+(Dr|Drive)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Drive address used as person name'),
    ('address_in_name_ln', 'name', '^\d+\s+\w+\s+(Ln|Lane)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Lane address used as person name'),
    ('address_in_name_ct', 'name', '^\d+\s+\w+\s+(Ct|Court)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Court address used as person name'),
    ('address_in_name_blvd', 'name', '^\d+\s+\w+\s+(Blvd|Boulevard)(\s|$|,)',
     FALSE, TRUE, 'reject', 'Boulevard address used as person name'),
    ('address_in_name_way', 'name', '^\d+\s+\w+\s+Way(\s|$|,)',
     FALSE, TRUE, 'reject', 'Way address used as person name'),
    ('address_in_name_hwy', 'name', '^\d+\s+(Hwy|Highway)',
     FALSE, TRUE, 'reject', 'Highway address used as person name'),

    -- FFSC suffix pattern (location FFSC)
    ('ffsc_suffix_pattern', 'name', '\s+(FFSC|Ffsc)\s*$',
     TRUE, FALSE, 'convert_to_org', 'FFSC suffix indicates location, not person'),

    -- SCAS patterns
    ('scas_as_lastname', 'name', '\s+SCAS\s*$',
     TRUE, FALSE, 'convert_to_org', 'SCAS as last name indicates shelter record'),
    ('scas_as_firstname', 'name', '^SCAS\s+',
     TRUE, FALSE, 'convert_to_org', 'SCAS as first name indicates shelter record'),

    -- Forgotten Felines patterns not already caught
    ('forgotten_felines_anywhere', 'name', 'Forgotten Felines',
     TRUE, TRUE, 'convert_to_org', 'Organization name in person field')
ON CONFLICT (pattern_name) DO NOTHING;

\echo 'Address-in-name patterns added.'

-- ============================================================================
-- ADD EMAIL BLACKLIST PATTERNS
-- ============================================================================

\echo 'Adding email blacklist patterns...'

INSERT INTO trapper.email_blacklist_patterns (email_pattern, match_type, reason, is_active) VALUES
    -- Prefix patterns for common placeholders
    ('none@', 'contains', 'Placeholder pattern - none@', TRUE),
    ('noemail@', 'contains', 'Placeholder pattern - noemail@', TRUE),
    ('noemailaddress@', 'contains', 'Placeholder pattern', TRUE),
    ('na@', 'contains', 'N/A placeholder', TRUE),
    ('notavailable@', 'contains', 'Not available placeholder', TRUE),
    ('donotcontact@', 'contains', 'Do not contact marker', TRUE),
    ('declined@', 'contains', 'Declined to provide email', TRUE),

    -- ClinicHQ specific placeholder domains
    ('@noemail.com', 'suffix', 'ClinicHQ placeholder domain', TRUE),
    ('@noemail.net', 'suffix', 'Placeholder domain variant', TRUE),
    ('@nomail.com', 'suffix', 'Placeholder domain', TRUE),
    ('@example.com', 'suffix', 'RFC example domain - placeholder', TRUE),

    -- Additional test domains
    ('@test.com', 'suffix', 'Test domain', TRUE),
    ('@testing.com', 'suffix', 'Test domain', TRUE),
    ('@mailinator.com', 'suffix', 'Disposable email domain', TRUE),
    ('@tempmail.com', 'suffix', 'Temporary email domain', TRUE),
    ('@fakeemail.com', 'suffix', 'Fake email domain', TRUE),

    -- Internal FFSC patterns that should not match to people
    ('info@forgottenfelines', 'contains', 'FFSC organization email', TRUE),
    ('clinic@forgottenfelines', 'contains', 'FFSC clinic email', TRUE),
    ('volunteer@forgottenfelines', 'contains', 'FFSC volunteer email', TRUE)
ON CONFLICT DO NOTHING;

\echo 'Email blacklist patterns added.'

-- ============================================================================
-- ADD SINGLE-WORD NAME PATTERN
-- Names that are suspiciously short or single-word
-- ============================================================================

\echo 'Adding single-word/short name patterns...'

INSERT INTO trapper.data_fixing_patterns (
    pattern_name, pattern_type, pattern_regex,
    is_placeholder, is_garbage, fix_action, fix_notes
) VALUES
    -- Single character names
    ('single_char_name', 'name', '^[A-Za-z]$',
     TRUE, TRUE, 'manual_review', 'Single character name - likely placeholder'),

    -- Just initials (like "J B" or "J.B.")
    ('initials_only', 'name', '^[A-Za-z]\.?\s+[A-Za-z]\.?$',
     TRUE, FALSE, 'manual_review', 'Just initials - may need full name'),

    -- Repeated same word (like "Smith Smith" or "Unknown Unknown")
    ('repeated_word', 'name', '^(\w+)\s+\1$',
     TRUE, FALSE, 'manual_review', 'Same word repeated - likely data entry error'),

    -- Numbers in name
    ('number_in_name', 'name', '^\d',
     FALSE, TRUE, 'reject', 'Name starting with number - likely address or ID'),

    -- All caps (often data entry issues)
    ('all_caps_long', 'name', '^[A-Z\s]{20,}$',
     FALSE, FALSE, 'manual_review', 'Long all-caps name - review for data quality')
ON CONFLICT (pattern_name) DO NOTHING;

\echo 'Short/single-word patterns added.'

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_523 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Known Organizations' AS table_name, COUNT(*) AS record_count
FROM trapper.known_organizations
UNION ALL
SELECT 'Data Fixing Patterns', COUNT(*)
FROM trapper.data_fixing_patterns
UNION ALL
SELECT 'Email Blacklist Patterns', COUNT(*)
FROM trapper.email_blacklist_patterns;

\echo ''
\echo 'Next steps:'
\echo '  1. Run MIG_522 to add validation to Data Engine'
\echo '  2. Run MIG_524 to clean up historical bad data'
\echo ''
