# Atlas Data Pattern Detection System

**Purpose:** Automatically detect and flag data patterns that indicate quality issues, edge cases, or anomalies that need attention. This prevents "running in circles" on the same issues.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DATA PATTERN DETECTION SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Source Data] → [Pattern Detectors] → [Alerts Table] → [Review Queue]     │
│                                                                             │
│  Pattern Types:                                                             │
│  ├── Identity Patterns (org-as-person, address-as-person, firstname-only)  │
│  ├── Relationship Patterns (pollution, circular, orphan)                   │
│  ├── Volume Patterns (spike, duplicate burst, missing data)                │
│  └── Quality Patterns (confidence drift, source conflicts)                 │
│                                                                             │
│  Actions:                                                                   │
│  ├── AUTO_FIX: Pattern has known fix, apply automatically                  │
│  ├── QUARANTINE: Route to quarantine for review                            │
│  ├── ALERT: Log alert, continue processing                                 │
│  └── BLOCK: Stop processing, require human intervention                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pattern Categories

### 1. Identity Patterns

| Pattern ID | Name | Detection | Action | Example |
|------------|------|-----------|--------|---------|
| `IDENT_001` | Org email as person | Email matches `@forgottenfelines.com`, `info@*`, `office@*` | AUTO_FIX → clinic_accounts | `info@forgottenfelines.com` |
| `IDENT_002` | Address as person name | `classify_owner_name()` returns 'address' | AUTO_FIX → clinic_accounts | "890 Rockwell Rd" |
| `IDENT_003` | Organization as person | `classify_owner_name()` returns 'organization' | QUARANTINE | "Marin Friends of Ferals" |
| `IDENT_004` | First-name-only | Last name NULL/empty, source not ShelterLuv/VolunteerHub | QUARANTINE | "Rosa" |
| `IDENT_005` | Garbage name | `classify_owner_name()` returns 'garbage' | AUTO_FIX → reject | "Test Test", "XXXX" |
| `IDENT_006` | Duplicate identifiers | Same email/phone on multiple unmerged people | ALERT | 2+ people with `john@gmail.com` |
| `IDENT_007` | Shared household phone | Phone appears on 3+ different people | ALERT + soft blacklist | Family sharing cell phone |
| `IDENT_008` | Fabricated PetLink email | `classify_petlink_email()` returns fabricated | AUTO_FIX → low confidence | `gordon@lohrmanln.com` |
| `IDENT_009` | Medical hold name | ShelterLuv owner with "(dental)", "(medical)" | AUTO_FIX → parse correctly | "Carlos Lopez Dental" |

### 2. Relationship Patterns

| Pattern ID | Name | Detection | Action | Example |
|------------|------|-----------|--------|---------|
| `REL_001` | Cat-place pollution | Cat has >5 links of same type to different places | ALERT | Cat at 10 "home" addresses |
| `REL_002` | Staff home pollution | Staff/trapper address has >20 unrelated cats | ALERT | Trapper's home shows 50 cats |
| `REL_003` | Orphan person | Person has no identifiers AND no relationships | ALERT | Created but never linked |
| `REL_004` | Circular merge | Merge chain forms a loop | BLOCK | A merged→B merged→A |
| `REL_005` | Cross-household link | Cat linked to people at different addresses via shared phone | ALERT | Cell phone cross-linking |
| `REL_006` | Missing appointment link | Appointment has person but no cat (for TNR) | ALERT | Spay/neuter without cat |
| `REL_007` | Orphan cat | Cat has no person_cat AND no cat_place relationships | ALERT | Unlinked cat |
| `REL_008` | Work address pollution | Residential cats appearing at commercial address | ALERT | Cats at "Dutton Ave" business |

### 3. Volume Patterns

| Pattern ID | Name | Detection | Action | Example |
|------------|------|-----------|--------|---------|
| `VOL_001` | Duplicate burst | >10 similar records in single ingest batch | ALERT | Same name/address repeated |
| `VOL_002` | Spike anomaly | Entity creation rate >3x normal for source | ALERT | 500 people from ClinicHQ in 1 hour |
| `VOL_003` | Missing required field | >5% of batch missing required field | ALERT | No microchips in cat batch |
| `VOL_004` | Zero matches | Entire batch has 0 matches to existing entities | ALERT | Possibly wrong source format |
| `VOL_005` | All matches | Entire batch matches existing (re-import?) | ALERT | Duplicate import detected |

### 4. Quality Patterns

| Pattern ID | Name | Detection | Action | Example |
|------------|------|-----------|--------|---------|
| `QUAL_001` | Confidence drift | Average match confidence <0.5 for batch | ALERT | Poor data quality source |
| `QUAL_002` | Source conflict | Same entity, different values from different sources | ALERT | ClinicHQ says male, ShelterLuv says female |
| `QUAL_003` | Stale data | Entity not updated in >1 year but has recent relationships | ALERT | Person data outdated |
| `QUAL_004` | Geocode failure rate | >10% of addresses fail geocoding in batch | ALERT | Bad address format |
| `QUAL_005` | Review queue overflow | >100 pending reviews for >7 days | ALERT | Staff need to clear backlog |

---

## Implementation

### Database Tables

```sql
-- Pattern definitions (reference table)
CREATE TABLE atlas.pattern_definitions (
    pattern_id TEXT PRIMARY KEY,
    category TEXT NOT NULL,  -- 'identity', 'relationship', 'volume', 'quality'
    name TEXT NOT NULL,
    description TEXT,
    detection_query TEXT,    -- SQL to detect this pattern
    action TEXT NOT NULL,    -- 'AUTO_FIX', 'QUARANTINE', 'ALERT', 'BLOCK'
    auto_fix_function TEXT,  -- Function to call for AUTO_FIX
    severity TEXT DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Detected pattern instances (log table)
CREATE TABLE audit.pattern_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id TEXT REFERENCES atlas.pattern_definitions(pattern_id),
    entity_type TEXT,        -- 'person', 'cat', 'place', 'appointment', 'batch'
    entity_id UUID,
    batch_id UUID,           -- If detected during ingest
    source_system TEXT,
    details JSONB,           -- Pattern-specific details
    action_taken TEXT,       -- What was done
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_pattern_alerts_unresolved
ON audit.pattern_alerts(pattern_id, created_at)
WHERE resolved_at IS NULL;

CREATE INDEX idx_pattern_alerts_entity
ON audit.pattern_alerts(entity_type, entity_id);
```

### Detection Functions

```sql
-- Master detection function (run after each ingest batch)
CREATE OR REPLACE FUNCTION atlas.run_pattern_detection(
    p_batch_id UUID DEFAULT NULL,
    p_categories TEXT[] DEFAULT ARRAY['identity', 'relationship', 'volume', 'quality']
) RETURNS TABLE (
    pattern_id TEXT,
    alerts_created INT,
    auto_fixed INT,
    quarantined INT
) AS $$
DECLARE
    v_pattern RECORD;
    v_result RECORD;
BEGIN
    FOR v_pattern IN
        SELECT * FROM atlas.pattern_definitions
        WHERE is_active AND category = ANY(p_categories)
    LOOP
        -- Run detection for each pattern
        -- Log alerts, apply auto-fixes, route to quarantine
        -- Implementation varies by pattern
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Example: Detect org-as-person pattern
CREATE OR REPLACE FUNCTION atlas.detect_org_as_person(
    p_batch_id UUID DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    INSERT INTO audit.pattern_alerts (
        pattern_id, entity_type, entity_id, batch_id, source_system, details, action_taken
    )
    SELECT
        'IDENT_003',
        'person',
        p.id,
        p_batch_id,
        p.source_system,
        jsonb_build_object(
            'first_name', p.first_name,
            'last_name', p.last_name,
            'display_name', p.display_name,
            'classification', atlas.classify_owner_name(p.first_name, p.last_name)
        ),
        'QUARANTINE'
    FROM sot.people p
    WHERE p.merged_into_person_id IS NULL
      AND atlas.classify_owner_name(p.first_name, p.last_name) = 'organization'
      AND NOT EXISTS (
          SELECT 1 FROM audit.pattern_alerts pa
          WHERE pa.entity_id = p.id AND pa.pattern_id = 'IDENT_003'
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

### Trigger Integration

```sql
-- Run pattern detection after each ingest batch
CREATE OR REPLACE FUNCTION atlas.trigger_pattern_detection()
RETURNS TRIGGER AS $$
BEGIN
    -- Queue pattern detection for this batch
    PERFORM pg_notify('pattern_detection', NEW.id::TEXT);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ingest_batch_pattern_detection
AFTER UPDATE OF status ON source.ingest_batches
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION atlas.trigger_pattern_detection();
```

---

## Pattern Detection Views

### Dashboard View

```sql
CREATE OR REPLACE VIEW audit.v_pattern_dashboard AS
SELECT
    pd.category,
    pd.pattern_id,
    pd.name,
    pd.severity,
    COUNT(pa.id) FILTER (WHERE pa.resolved_at IS NULL) as open_alerts,
    COUNT(pa.id) FILTER (WHERE pa.resolved_at IS NOT NULL) as resolved_alerts,
    MAX(pa.created_at) as last_detected,
    pd.action as default_action
FROM atlas.pattern_definitions pd
LEFT JOIN audit.pattern_alerts pa ON pa.pattern_id = pd.pattern_id
WHERE pd.is_active
GROUP BY pd.category, pd.pattern_id, pd.name, pd.severity, pd.action
ORDER BY
    CASE pd.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END,
    open_alerts DESC;
```

### Unresolved Alerts by Entity

```sql
CREATE OR REPLACE VIEW audit.v_unresolved_pattern_alerts AS
SELECT
    pa.id,
    pa.pattern_id,
    pd.name as pattern_name,
    pd.category,
    pd.severity,
    pa.entity_type,
    pa.entity_id,
    pa.source_system,
    pa.details,
    pa.action_taken,
    pa.created_at,
    CASE pa.entity_type
        WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE id = pa.entity_id)
        WHEN 'cat' THEN (SELECT name FROM sot.cats WHERE id = pa.entity_id)
        WHEN 'place' THEN (SELECT display_name FROM sot.places WHERE id = pa.entity_id)
    END as entity_name
FROM audit.pattern_alerts pa
JOIN atlas.pattern_definitions pd ON pd.pattern_id = pa.pattern_id
WHERE pa.resolved_at IS NULL
ORDER BY
    CASE pd.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END,
    pa.created_at DESC;
```

---

## Source System Drawbacks Registry

Based on the original architecture diagram, document known issues per source:

```sql
CREATE TABLE reference.source_drawbacks (
    id SERIAL PRIMARY KEY,
    source_system TEXT NOT NULL,
    drawback_category TEXT NOT NULL,  -- 'data_quality', 'format', 'completeness', 'consistency'
    description TEXT NOT NULL,
    detection_pattern TEXT,           -- Pattern ID if auto-detectable
    workaround TEXT,                  -- How we handle it
    examples TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with known drawbacks from diagram
INSERT INTO reference.source_drawbacks (source_system, drawback_category, description, detection_pattern, workaround, examples) VALUES
-- ClinicHQ
('clinichq', 'data_quality', 'Messy owner info - orgs stored as people', 'IDENT_001,IDENT_002,IDENT_003', 'classify_owner_name() + should_be_person() gate', ARRAY['info@forgottenfelines.com', '890 Rockwell Rd']),
('clinichq', 'format', 'Microchips stored in weird places (animal name field)', NULL, 'extract_microchip_from_animal_name()', ARRAY['Tabby 981020000000000', '9.8102E+14']),
('clinichq', 'data_quality', 'Super messy historical data', NULL, 'Pre-2024 data flagged, use place as source of truth', NULL),
('clinichq', 'consistency', 'Owner fields contain site names instead of people', 'IDENT_002', 'Route to clinic_accounts', ARRAY['Silveira Ranch', '5403 San Antonio Road Petaluma']),

-- Airtable
('airtable', 'consistency', 'Old connections to various integrations, workflow changes', NULL, 'Source-dependent validation, only migrate salvageable records', NULL),
('airtable', 'data_quality', 'Messy public submissions', 'IDENT_004,IDENT_005', 'Quarantine first-name-only unless has valuable linked data', ARRAY['Rosa', 'John']),
('airtable', 'completeness', 'Unknown how historical data was stored', NULL, 'Treat as legacy, dont auto-process', NULL),

-- ShelterLuv
('shelterluv', 'completeness', 'Partial data - their own system, separate logic', NULL, 'Allow first-name-only with flag, real adopters/fosters', NULL),
('shelterluv', 'format', 'Medical holds use owner name + reason', 'IDENT_009', 'Parse "(dental)", "(medical)" suffixes', ARRAY['Carlos Lopez Dental', 'Jupiter (dental)']),
('shelterluv', 'data_quality', 'Foster data sometimes incomplete', NULL, 'Allow with data_quality flag', NULL),

-- VolunteerHub
('volunteerhub', 'data_quality', 'Some people added manually, some via public signup', NULL, 'Allow first-name-only with flag (verified volunteers)', NULL),
('volunteerhub', 'completeness', 'Missing data from public signups', NULL, 'Accept with data_quality=incomplete', NULL),
('volunteerhub', 'consistency', 'Public signup = messy data', 'IDENT_004', 'Validate on entry, flag for review', NULL),

-- PetLink
('petlink', 'data_quality', 'Fabricated emails by FFSC staff', 'IDENT_008', 'classify_petlink_email() + low confidence', ARRAY['gordon@lohrmanln.com', 'kathleen@jeffersonst.com']),
('petlink', 'completeness', 'Registry-only data, cats may never have been seen at FFSC', NULL, 'Expected unlinked, not a gap', NULL),

-- Web Intake
('web_intake', 'data_quality', 'Public submissions may have incomplete data', 'IDENT_004,IDENT_005', 'Quarantine if fails validation', NULL),
('web_intake', 'format', 'Free-text fields can contain anything', NULL, 'Classify and route appropriately', NULL);
```

---

## Integration with Ingest Pipeline

### Pre-Processing Detection

```
source.* (raw data)
    ↓
[Pattern Detection: IDENT_*, VOL_*]
    ↓
    ├── AUTO_FIX patterns → Apply fix, continue
    ├── QUARANTINE patterns → Route to quarantine.failed_records
    ├── ALERT patterns → Log alert, continue processing
    └── BLOCK patterns → Stop batch, notify staff
    ↓
atlas.* (Data Engine)
    ↓
[Pattern Detection: REL_*, QUAL_*]
    ↓
sot.* (canonical)
```

### Post-Processing Detection

Run periodically (cron) to catch patterns that emerge over time:

```sql
-- Daily pattern scan
SELECT atlas.run_pattern_detection(
    p_batch_id := NULL,  -- All data
    p_categories := ARRAY['relationship', 'quality']
);

-- After each ingest
SELECT atlas.run_pattern_detection(
    p_batch_id := 'uuid-of-batch',
    p_categories := ARRAY['identity', 'volume']
);
```

---

## Alert Resolution Workflow

1. **Staff reviews** `audit.v_unresolved_pattern_alerts`
2. **Takes action:**
   - Merge duplicates
   - Mark as organization
   - Correct data
   - Dismiss false positive
3. **Records resolution:**
   ```sql
   UPDATE audit.pattern_alerts
   SET resolved_at = NOW(),
       resolved_by = 'staff_email',
       resolution_notes = 'Merged into person X'
   WHERE id = 'alert-uuid';
   ```
4. **Pattern learns** (future: ML to reduce false positives)

---

## Monitoring & Metrics

### Key Metrics to Track

| Metric | Query | Target |
|--------|-------|--------|
| Open alerts by severity | `SELECT severity, COUNT(*) FROM v_unresolved... GROUP BY severity` | Critical: 0, High: <10 |
| Alert resolution time | `AVG(resolved_at - created_at)` | <7 days |
| Auto-fix success rate | `COUNT(action='AUTO_FIX') / COUNT(*)` | >80% |
| False positive rate | `COUNT(resolution='false_positive') / COUNT(*)` | <10% |
| Pattern detection coverage | Patterns with >0 detections / Total patterns | >70% |

### Weekly Report Query

```sql
SELECT
    DATE_TRUNC('week', created_at) as week,
    category,
    COUNT(*) as alerts_created,
    COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved,
    COUNT(*) FILTER (WHERE action_taken = 'AUTO_FIX') as auto_fixed,
    ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)::NUMERIC, 1) as avg_hours_to_resolve
FROM audit.pattern_alerts
WHERE created_at > NOW() - INTERVAL '8 weeks'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

---

## Adding New Patterns

When a new edge case is discovered:

1. **Document in DATA_GAPS.md** with SQL evidence
2. **Create pattern definition:**
   ```sql
   INSERT INTO atlas.pattern_definitions (
       pattern_id, category, name, description,
       detection_query, action, auto_fix_function, severity
   ) VALUES (
       'IDENT_010', 'identity', 'New pattern name',
       'Description of what this pattern detects',
       'SELECT ... FROM ... WHERE ...',
       'QUARANTINE',
       NULL,
       'medium'
   );
   ```
3. **Create detection function** if complex
4. **Test on historical data**
5. **Enable pattern** (`is_active = TRUE`)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-11 | Initial pattern detection system design |
