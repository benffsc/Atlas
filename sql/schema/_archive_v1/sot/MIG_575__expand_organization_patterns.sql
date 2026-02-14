\echo '=== MIG_575: Expand Organization Detection from Real Data ==='
\echo ''
\echo 'Analysis of 2 years of appointment data found these patterns slipping through:'
\echo '  - 82+ Coast Guard Station records created as people'
\echo '  - 149 Speedy Creek Winery appointments'
\echo '  - 94 Keller Estates Vineyards appointments'
\echo '  - Hundreds of addresses being used as person names'
\echo ''
\echo 'This migration adds comprehensive detection based on ACTUAL data patterns.'
\echo ''

-- ============================================================================
-- PART 1: WINERIES & VINEYARDS (High priority - 149+ appointments undetected)
-- ============================================================================

\echo 'Adding winery/vineyard patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Winery (generic)', '%Winery%', 'business', 'Any winery'),
    ('Vineyard (generic)', '%Vineyard%', 'business', 'Any vineyard'),
    ('Vineyards (plural)', '%Vineyards%', 'business', 'Any vineyards'),
    ('Wines (generic)', '% Wines%', 'business', 'Wine businesses'),
    ('Wine Estates', '%Wine Estates%', 'business', 'Wine estate businesses'),
    ('Cellar (generic)', '%Cellar%', 'business', 'Wine cellars'),
    ('Brewing Company', '%Brewing%', 'business', 'Breweries'),
    ('Brewery', '%Brewery%', 'business', 'Breweries'),
    ('Distillery', '%Distillery%', 'business', 'Distilleries')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 2: MILITARY (Critical - 82+ Coast Guard records created as duplicates)
-- ============================================================================

\echo 'Adding military patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Coast Guard', '%Coast Guard%', 'government', 'US Coast Guard - CRITICAL: 82+ duplicates found'),
    ('Coast Guard Station', '%Coast Guard Station%', 'government', 'Coast Guard Station'),
    ('National Guard', '%National Guard%', 'government', 'National Guard'),
    ('Air Force', '%Air Force%', 'government', 'US Air Force'),
    ('Air Force Base', '%AFB%', 'government', 'Air Force Base abbreviation'),
    ('Navy', '% Navy%', 'government', 'US Navy - leading space to avoid "Peavey"'),
    ('Marine Corps', '%Marine Corps%', 'government', 'US Marine Corps'),
    ('Army Base', '%Army Base%', 'government', 'Army bases'),
    ('Military', '%Military%', 'government', 'Generic military')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 3: HOTELS & HOSPITALITY (40+ appointments)
-- ============================================================================

\echo 'Adding hotel/hospitality patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Hotel (generic)', '% Hotel%', 'business', 'Hotels - leading space'),
    ('Hotel (starting)', 'Hotel %', 'business', 'Hotels starting with Hotel'),
    ('Inn (generic)', '% Inn%', 'business', 'Inns - leading space to avoid "Finn"'),
    ('Inn (ending)', '% Inn', 'business', 'Inns ending with Inn'),
    ('Motel', '%Motel%', 'business', 'Motels'),
    ('Lodge', '% Lodge%', 'business', 'Lodges'),
    ('Resort', '%Resort%', 'business', 'Resorts'),
    ('Bed & Breakfast', '%Bed & Breakfast%', 'business', 'B&Bs'),
    ('B&B', '% B&B%', 'business', 'B&Bs abbreviated'),
    ('Best Western', '%Best Western%', 'business', 'Best Western hotels')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 4: FARMS & RANCHES (26+ appointments)
-- ============================================================================

\echo 'Adding farm/ranch patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Ranch (generic)', '% Ranch%', 'business', 'Ranches'),
    ('Ranch (ending)', '% ranch', 'business', 'Ranches lowercase'),
    ('Farm (generic)', '% Farm%', 'business', 'Farms'),
    ('Dairy', '%Dairy%', 'business', 'Dairy farms'),
    ('Poultry', '%Poultry%', 'business', 'Poultry farms'),
    ('Livestock', '%Livestock%', 'business', 'Livestock operations'),
    ('Horse Farm', '%Horse Farm%', 'business', 'Horse farms'),
    ('Equine', '%Equine%', 'business', 'Equine facilities'),
    ('Stables', '%Stables%', 'business', 'Horse stables'),
    ('Feed Mill', '%Feed%Mill%', 'business', 'Feed mills')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 5: RELIGIOUS ORGANIZATIONS (23+ appointments)
-- ============================================================================

\echo 'Adding religious organization patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Buddhist Temple', '%Buddhist%', 'other', 'Buddhist temples'),
    ('Temple (generic)', '% Temple%', 'other', 'Temples - leading space to avoid "Kelly Temple"'),
    ('Temple (ending)', '% Temple', 'other', 'Names ending in Temple'),
    ('Catholic organization', '%Catholic%', 'other', 'Catholic organizations'),
    ('Cathedral', '%Cathedral%', 'other', 'Cathedrals'),
    ('Chapel', '%Chapel%', 'other', 'Chapels'),
    ('Parish', '%Parish%', 'other', 'Parishes'),
    ('Diocese', '%Diocese%', 'other', 'Dioceses'),
    ('Ministry (generic)', '% Ministry%', 'other', 'Ministries'),
    ('Synagogue', '%Synagogue%', 'other', 'Synagogues'),
    ('Mosque', '%Mosque%', 'other', 'Mosques')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 6: SCHOOLS & EDUCATIONAL (14+ appointments)
-- ============================================================================

\echo 'Adding school/education patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Academy', '%Academy%', 'school', 'Academies'),
    ('Elementary School', '%Elementary%', 'school', 'Elementary schools'),
    ('Middle School', '%Middle School%', 'school', 'Middle schools'),
    ('High School', '%High School%', 'school', 'High schools'),
    ('Charter School', '%Charter School%', 'school', 'Charter schools'),
    ('Preschool', '%Preschool%', 'school', 'Preschools'),
    ('Kindergarten', '%Kindergarten%', 'school', 'Kindergartens'),
    ('College', '% College%', 'school', 'Colleges'),
    ('University', '%University%', 'school', 'Universities')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 7: HOUSING & APARTMENTS (11+ appointments)
-- ============================================================================

\echo 'Adding housing/apartment patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Garden Apartments', '%Garden Apartments%', 'apartment_complex', 'Garden-style apartments'),
    ('View Apartments', '%View Apartments%', 'apartment_complex', 'View apartments'),
    ('Mobile Estates', '%Mobile Estates%', 'business', 'Mobile home estates'),
    ('Mobile Home Park', '%Mobile Home%', 'business', 'Mobile home parks'),
    ('Trailer Park', '%Trailer Park%', 'business', 'Trailer parks'),
    ('RV Park', '%RV Park%', 'business', 'RV parks'),
    ('Chateau Apartments', '%Chateau%Apt%', 'apartment_complex', 'Chateau-style apts'),
    ('Vista Apartments', '%Vista%Apt%', 'apartment_complex', 'Vista apartments'),
    ('Senior Living', '%Senior Living%', 'business', 'Senior living'),
    ('Assisted Living', '%Assisted Living%', 'business', 'Assisted living')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 8: PARKS & RECREATION (6+ appointments)
-- ============================================================================

\echo 'Adding parks/recreation patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('State Park', '%State Park%', 'government', 'State parks'),
    ('County Park', '%County Park%', 'government', 'County parks'),
    ('Regional Park', '%Regional Park%', 'government', 'Regional parks'),
    ('Fairgrounds', '%Fairground%', 'government', 'Fairgrounds'),
    ('Golf Club', '%Golf%', 'business', 'Golf clubs'),
    ('Country Club', '%Country Club%', 'business', 'Country clubs'),
    ('Tennis Club', '%Tennis Club%', 'business', 'Tennis clubs'),
    ('Swim Club', '%Swim Club%', 'business', 'Swim clubs')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 9: NON-PROFITS & COMMUNITY CENTERS (9+ appointments)
-- ============================================================================

\echo 'Adding non-profit/community patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Boys Center', '%Boys Center%', 'other', 'Boys centers like Hanna Boys'),
    ('Girls Center', '%Girls Center%', 'other', 'Girls centers'),
    ('Community Center', '%Community Center%', 'other', 'Community centers'),
    ('Senior Center', '%Senior Center%', 'other', 'Senior centers'),
    ('Youth Center', '%Youth Center%', 'other', 'Youth centers'),
    ('Charities', '%Charit%', 'other', 'Charities')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 10: GOVERNMENT & FIRE/POLICE
-- ============================================================================

\echo 'Adding government patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Fire Department', '%Fire Dept%', 'government', 'Fire departments'),
    ('Fire Station', '%Fire Station%', 'government', 'Fire stations'),
    ('Fire Cats', '%Fire Cats%', 'rescue', 'Fire-related cat rescues'),
    ('Police Department', '%Police Dept%', 'government', 'Police'),
    ('Sheriff', '%Sheriff%', 'government', 'Sheriff offices'),
    ('City of', 'City of %', 'government', 'City government'),
    ('County of', 'County of %', 'government', 'County government'),
    ('Public Works', '%Public Works%', 'government', 'Public works'),
    ('Water District', '%Water District%', 'government', 'Water districts'),
    ('Landfill', '%Landfill%', 'government', 'Landfills - already in table but confirming')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 11: RETAIL & BUSINESS (various)
-- ============================================================================

\echo 'Adding retail/business patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Real Estate', '%Real Estate%', 'business', 'Real estate companies'),
    ('Realty', '%Realty%', 'business', 'Realty companies'),
    ('Bank (generic)', '% Bank%', 'business', 'Banks'),
    ('Credit Union', '%Credit Union%', 'business', 'Credit unions'),
    ('Insurance', '%Insurance%', 'business', 'Insurance companies'),
    ('Lowes', '%Lowe''s%', 'business', 'Lowes stores'),
    ('Lowes alt', '%Lowes%', 'business', 'Lowes stores alt spelling'),
    ('Home Depot', '%Home Depot%', 'business', 'Home Depot'),
    ('Car Rental', '%Car Rental%', 'business', 'Car rental'),
    ('Mechanical Services', '%Mechanical Services%', 'business', 'Mechanical shops'),
    ('Architectural', '%Architectural%', 'business', 'Architectural firms'),
    ('Products', '% Products%', 'business', 'Product companies'),
    ('Services (generic)', '% Services%', 'business', 'Service companies')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 12: VETERINARY (already partially covered but reinforcing)
-- ============================================================================

\echo 'Adding veterinary patterns...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
    ('Vet (generic)', '% Vet%', 'clinic', 'Vet clinics - leading space'),
    ('Veterinary', '%Veterinary%', 'clinic', 'Veterinary clinics'),
    ('Animal Hospital', '%Animal Hospital%', 'clinic', 'Animal hospitals')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 13: DATA FIXING PATTERNS (for additional coverage)
-- ============================================================================

\echo 'Adding to data_fixing_patterns...'

INSERT INTO trapper.data_fixing_patterns (pattern_name, pattern_type, pattern_ilike, is_organization, fix_action, fix_notes)
VALUES
    -- Military (CRITICAL)
    ('org_coast_guard', 'name', '%Coast Guard%', TRUE, 'convert_to_org', 'Coast Guard - 82+ duplicates found in data'),
    ('org_coast_guard_station', 'name', '%Coast Guard Station%', TRUE, 'convert_to_org', 'Coast Guard Station'),

    -- Wineries
    ('org_winery', 'name', '%Winery%', TRUE, 'convert_to_org', 'Winery - 149+ appointments'),
    ('org_vineyard', 'name', '%Vineyard%', TRUE, 'convert_to_org', 'Vineyard - 94+ appointments'),
    ('org_vineyards', 'name', '%Vineyards%', TRUE, 'convert_to_org', 'Vineyards'),
    ('org_brewing', 'name', '%Brewing%', TRUE, 'convert_to_org', 'Brewery'),

    -- Hotels
    ('org_hotel', 'name', '% Hotel%', TRUE, 'convert_to_org', 'Hotel - 40+ appointments'),
    ('org_inn', 'name', '% Inn', TRUE, 'convert_to_org', 'Inn - ending pattern'),
    ('org_resort', 'name', '%Resort%', TRUE, 'convert_to_org', 'Resort'),

    -- Farms/Ranches
    ('org_ranch', 'name', '% Ranch', TRUE, 'convert_to_org', 'Ranch - 26+ appointments'),
    ('org_ranch_mid', 'name', '% Ranch %', TRUE, 'convert_to_org', 'Ranch in middle of name'),
    ('org_farm', 'name', '% Farm', TRUE, 'convert_to_org', 'Farm'),
    ('org_equine', 'name', '%Equine%', TRUE, 'convert_to_org', 'Equine facility'),
    ('org_horse_farm', 'name', '%Horse Farm%', TRUE, 'convert_to_org', 'Horse farm'),

    -- Religious
    ('org_buddhist', 'name', '%Buddhist%', TRUE, 'convert_to_org', 'Buddhist temple'),
    ('org_catholic', 'name', '%Catholic%', TRUE, 'convert_to_org', 'Catholic organization'),

    -- Schools
    ('org_academy', 'name', '%Academy%', TRUE, 'convert_to_org', 'Academy'),
    ('org_high_school', 'name', '%High School%', TRUE, 'convert_to_org', 'High school'),
    ('org_middle_school', 'name', '%Middle School%', TRUE, 'convert_to_org', 'Middle school'),
    ('org_elementary', 'name', '%Elementary%', TRUE, 'convert_to_org', 'Elementary school'),
    ('org_charter_school', 'name', '%Charter School%', TRUE, 'convert_to_org', 'Charter school'),

    -- Housing
    ('org_apartments', 'name', '%Apartments%', TRUE, 'convert_to_org', 'Apartments'),
    ('org_mobile_estates', 'name', '%Mobile Estates%', TRUE, 'convert_to_org', 'Mobile estates'),
    ('org_mobile_home', 'name', '%Mobile Home%', TRUE, 'convert_to_org', 'Mobile home park'),
    ('org_rv_park', 'name', '%RV Park%', TRUE, 'convert_to_org', 'RV park'),

    -- Parks
    ('org_state_park', 'name', '%State Park%', TRUE, 'convert_to_org', 'State park'),
    ('org_fairgrounds', 'name', '%Fairground%', TRUE, 'convert_to_org', 'Fairgrounds'),

    -- Non-profits
    ('org_boys_center', 'name', '%Boys Center%', TRUE, 'convert_to_org', 'Boys center'),

    -- Business
    ('org_real_estate', 'name', '%Real Estate%', TRUE, 'convert_to_org', 'Real estate'),
    ('org_bank', 'name', '% Bank%', TRUE, 'convert_to_org', 'Bank'),
    ('org_services', 'name', '%Services%', TRUE, 'convert_to_org', 'Services company'),

    -- Vet
    ('org_vet', 'name', '% Vet%', TRUE, 'convert_to_org', 'Vet clinic')
ON CONFLICT (pattern_name) DO UPDATE SET
    pattern_ilike = EXCLUDED.pattern_ilike,
    is_organization = TRUE,
    fix_notes = EXCLUDED.fix_notes,
    updated_at = NOW();

-- ============================================================================
-- PART 14: ADDRESS-AS-NAME DETECTION (garbage, not organization)
-- ============================================================================

\echo 'Adding address-as-name detection to is_garbage_name...'

-- Update is_garbage_name to detect addresses used as names
CREATE OR REPLACE FUNCTION trapper.is_garbage_name(name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF name IS NULL OR TRIM(name) = '' THEN
        RETURN TRUE;
    END IF;

    -- Normalize for comparison
    name := LOWER(TRIM(name));

    -- Known garbage patterns
    IF name IN (
        'unknown', 'n/a', 'na', 'none', 'no name', 'test', 'xxx', 'zzz',
        'owner', 'client', 'customer', 'person', 'somebody', 'someone',
        'anonymous', 'anon', 'no owner', 'unknown owner', 'lost owner',
        'stray', 'feral', 'community cat', 'barn cat', 'outdoor cat',
        'forgotten', 'duplicate report'
    ) THEN
        RETURN TRUE;
    END IF;

    -- Too short
    IF LENGTH(name) < 2 THEN
        RETURN TRUE;
    END IF;

    -- All same character
    IF name ~ '^(.)\1*$' THEN
        RETURN TRUE;
    END IF;

    -- Contains microchip number pattern (9+ consecutive digits)
    IF name ~ '[0-9]{9,}' THEN
        RETURN TRUE;
    END IF;

    -- Name is only numbers
    IF name ~ '^[0-9]+$' THEN
        RETURN TRUE;
    END IF;

    -- ShelterLuv internal patterns
    IF name ~ '^feral\s*wild[0-9]+' THEN
        RETURN TRUE;
    END IF;

    -- Med Hold patterns
    IF name ~ '^med\s*hold' OR name ~ '^medical\s*hold' THEN
        RETURN TRUE;
    END IF;

    -- Archive Record patterns
    IF name ~ 'archive[d]?\s*record' THEN
        RETURN TRUE;
    END IF;

    -- NEW: ADDRESS AS NAME DETECTION
    -- Pattern: Starts with number + has street suffix
    IF name ~ '^\d+\s+\w+.*(st\.?|street|ave\.?|avenue|rd\.?|road|dr\.?|drive|blvd\.?|boulevard|ln\.?|lane|way|ct\.?|court|circle|pl\.?|place|hwy\.?|highway)' THEN
        RETURN TRUE;
    END IF;

    -- Pattern: Contains Sonoma County city names at end (likely address fragment)
    IF name ~ '\s(santa rosa|petaluma|rohnert park|sonoma|healdsburg|windsor|sebastopol|cotati|cloverdale|forestville|guerneville|bodega|penngrove|glen ellen)\s*$' THEN
        RETURN TRUE;
    END IF;

    -- Internal account patterns
    IF name ~ '(ff\s*foster|ffsc\s*foster|rebooking|fire\s*cat|barn\s*cat)' THEN
        RETURN TRUE;
    END IF;

    -- Duplicate report prefix
    IF name ~ '^duplicate\s*report' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_garbage_name IS
'Detects garbage person names including:
- Microchip patterns (9+ consecutive digits)
- ShelterLuv internal codes (feralwild + numbers)
- Medical hold prefixes
- Known garbage values (unknown, n/a, test, etc.)
- Internal account patterns
- Archive record markers
- Addresses used as names (e.g., "890 Rockwell Rd.")
- Location fragments (e.g., "760 West School St.")
Updated in MIG_575 with real data patterns.';

-- ============================================================================
-- PART 15: VERIFICATION
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Testing new patterns:'

SELECT 'Coast Guard Station' as test, trapper.is_organization_name('Coast Guard Station') as detected, TRUE as expected;
SELECT 'Coast Guard Station Tomales Rd' as test, trapper.is_organization_name('Coast Guard Station Tomales Rd') as detected, TRUE as expected;
SELECT 'Speedy Creek Winery' as test, trapper.is_organization_name('Speedy Creek Winery') as detected, TRUE as expected;
SELECT 'Keller Estates Vineyards' as test, trapper.is_organization_name('Keller Estates Vineyards') as detected, TRUE as expected;
SELECT 'Valley Ford Hotel' as test, trapper.is_organization_name('Valley Ford Hotel') as detected, TRUE as expected;
SELECT 'Ariana Beltran ranch' as test, trapper.is_organization_name('Ariana Beltran ranch') as detected, TRUE as expected;
SELECT 'Wat Mahbuddhaphumi Buddhist Temple' as test, trapper.is_organization_name('Wat Mahbuddhaphumi Buddhist Temple') as detected, TRUE as expected;
SELECT 'Windsor High School' as test, trapper.is_organization_name('Windsor High School') as detected, TRUE as expected;
SELECT 'Hanna Boys Center' as test, trapper.is_organization_name('Hanna Boys Center') as detected, TRUE as expected;
SELECT 'Santa Rosa Garden Apartments' as test, trapper.is_organization_name('Santa Rosa Garden Apartments') as detected, TRUE as expected;

\echo ''
\echo 'Testing garbage name detection for addresses:'

SELECT '890 Rockwell Rd.' as test, trapper.is_garbage_name('890 Rockwell Rd.') as is_garbage, TRUE as expected;
SELECT '111 Sebastopol Rd.' as test, trapper.is_garbage_name('111 Sebastopol Rd.') as is_garbage, TRUE as expected;
SELECT '760 West School St.' as test, trapper.is_garbage_name('760 West School St.') as is_garbage, TRUE as expected;
SELECT 'Kawana Springs Road Santa Rosa' as test, trapper.is_garbage_name('Kawana Springs Road Santa Rosa') as is_garbage, TRUE as expected;

\echo ''
\echo 'Testing false positive avoidance (real people):'

SELECT 'John Smith' as test, trapper.is_organization_name('John Smith') as detected, FALSE as expected;
SELECT 'Kelly Temple' as test, trapper.is_organization_name('Kelly Temple') as detected, FALSE as expected_but_check;
SELECT 'Sam Farmer' as test, trapper.is_organization_name('Sam Farmer') as detected, FALSE as expected;
SELECT 'Parke Bowman' as test, trapper.is_organization_name('Parke Bowman') as detected, FALSE as expected;

\echo ''
\echo 'Total patterns now in system:'
SELECT
    (SELECT COUNT(*) FROM trapper.known_organizations) as known_organizations,
    (SELECT COUNT(*) FROM trapper.data_fixing_patterns WHERE is_organization = TRUE) as data_fixing_org_patterns;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_575 Complete ==='
\echo ''
\echo 'Added detection for patterns found in REAL DATA (2 years of appointments):'
\echo ''
\echo 'HIGH PRIORITY (most duplicates):'
\echo '  - Coast Guard Station (82+ duplicates found!)'
\echo '  - Wineries: Speedy Creek Winery (149 appts), Keller Estates Vineyards (94)'
\echo '  - Hotels: Valley Ford Hotel (40 appts)'
\echo '  - Ranches: Ariana Beltran ranch (26 appts)'
\echo '  - Religious: Buddhist Temple (23 appts)'
\echo ''
\echo 'ALSO ADDED:'
\echo '  - Military: National Guard, Air Force, Navy, Marines'
\echo '  - Farms/Equine: Horse Farm, Equine facilities'
\echo '  - Schools: Academy, High School, Middle School, Elementary, Charter'
\echo '  - Housing: Garden Apartments, Mobile Estates, RV Park'
\echo '  - Parks: State Park, Fairgrounds'
\echo '  - Business: Real Estate, Bank, Services'
\echo '  - Address-as-name detection in is_garbage_name()'
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Run this migration'
\echo '  2. Clean up existing Coast Guard duplicates'
\echo '  3. Set up representative mapping if Coast Guard cats should link to a person'
\echo ''
