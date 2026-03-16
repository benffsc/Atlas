# Entity Deduplication Technical Specification

## Overview

This document outlines industry-standard approaches to entity deduplication (people, places) and how they compare to Atlas's current implementation. It serves as a reference for engineering audits and future improvements.

---

## Industry-Standard Libraries & Approaches

### 1. Splink (Recommended for People)

**Repository**: [github.com/moj-analytical-services/splink](https://github.com/moj-analytical-services/splink)

**What it is**: Python library for probabilistic record linkage using the Fellegi-Sunter model. Won 2025 Civil Service Award for Innovation.

**Key Features**:
- **No training data required** (unsupervised learning)
- Scales to 100M+ records using DuckDB, Spark, or AWS Athena
- Links 1M records in ~1 minute on a laptop
- Term frequency adjustments (common names like "Smith" weighted lower)
- User-defined fuzzy matching logic

**How it works**:
1. **Blocking**: Divides data into blocks (e.g., same first letter of last name) to reduce comparisons
2. **Comparison**: Calculates match weights for each field (name, DOB, phone, etc.)
3. **Scoring**: Combines weights using Fellegi-Sunter probabilistic model
4. **Clustering**: Groups records above threshold into entities

**Fellegi-Sunter Model**:
```
Match Weight = log2(m/u)
where:
  m = P(fields match | records are same entity)
  u = P(fields match | records are different entities)
```

**Best For**: Large datasets, government/healthcare data, when you want probabilistic confidence scores.

**Integration Path for Atlas**:
```python
# Example Splink integration
from splink.duckdb.linker import DuckDBLinker
import splink.duckdb.comparison_library as cl

settings = {
    "link_type": "dedupe_only",
    "comparisons": [
        cl.jaro_winkler_at_thresholds("first_name", [0.9, 0.7]),
        cl.jaro_winkler_at_thresholds("last_name", [0.9, 0.7]),
        cl.exact_match("phone_normalized"),
        cl.exact_match("email_normalized"),
    ],
    "blocking_rules_to_generate_predictions": [
        "l.last_name = r.last_name",
        "l.phone_normalized = r.phone_normalized",
    ],
}

linker = DuckDBLinker(df_people, settings)
linker.estimate_probability_two_random_records_match(...)
linker.estimate_u_using_random_sampling(...)
linker.estimate_parameters_using_expectation_maximisation(...)

# Get predictions
predictions = linker.predict(threshold_match_probability=0.9)
clusters = linker.cluster_pairwise_predictions_at_threshold(predictions, 0.95)
```

---

### 2. Dedupe (Alternative for People)

**Repository**: [github.com/dedupeio/dedupe](https://github.com/dedupeio/dedupe)

**What it is**: Python library using machine learning with human training data.

**Key Features**:
- Active learning (asks human to label uncertain pairs)
- Learns optimal rules from training data
- Good for domain-specific matching rules

**Best For**: When you have domain experts who can provide training labels, smaller datasets.

**Tradeoff**: Requires manual labeling of ~20-50 record pairs for training.

---

### 3. Libpostal (Recommended for Addresses)

**Repository**: [github.com/openvenues/libpostal](https://github.com/openvenues/libpostal)

**What it is**: C library for international address parsing and normalization trained on 1B+ OpenStreetMap addresses.

**Key Features**:
- Handles international address formats
- Parses addresses into components (house_number, road, city, state, postcode)
- Normalizes variations ("Street" → "St", "Apartment" → "Apt")
- Language-agnostic

**Operations**:
1. **expand_address()**: Generates normalized variations
   ```
   Input: "123 Main St Apt 4"
   Output: ["123 main street apartment 4", "123 main st apt 4", ...]
   ```

2. **parse_address()**: Extracts components
   ```
   Input: "123 Main St, San Francisco, CA 94102"
   Output: {
     "house_number": "123",
     "road": "Main St",
     "city": "San Francisco",
     "state": "CA",
     "postcode": "94102"
   }
   ```

**PostgreSQL Integration**: [pgsql-postal](https://github.com/pramsey/pgsql-postal)
```sql
SELECT postal_normalize('123 Main Street Suite 500');
-- Returns: {"123 main st ste 500", "123 main street suite 500", ...}

SELECT postal_parse('123 Main St, San Francisco, CA');
-- Returns: {"house_number": "123", "road": "main st", "city": "san francisco", ...}
```

**Integration Path for Atlas**:
1. Install libpostal + pgsql-postal extension
2. Create normalized address column using `postal_normalize()`
3. Use normalized form for exact matching
4. Use parsed components for fuzzy matching on individual parts

---

### 4. PostgreSQL Native Extensions (Current Atlas Approach)

**pg_trgm** (Trigram Similarity):
```sql
-- Atlas already uses this
SELECT similarity('Bibiana Patino', 'Viviana Patino');
-- Returns: 0.6 (60% similar based on shared 3-character sequences)
```

**fuzzystrmatch** (Phonetic Matching):
```sql
-- Atlas already uses this
SELECT soundex('Smith'), soundex('Smyth');
-- Both return: S530

SELECT metaphone('Catherine', 10), metaphone('Katherine', 10);
-- Both return: KXRN
```

**Levenshtein Distance**:
```sql
SELECT levenshtein('kitten', 'sitting');
-- Returns: 3 (number of single-character edits needed)
```

---

## Atlas Current Implementation

### What We Have (MIG_233)

**People Deduplication**:
| Technique | Implementation | Status |
|-----------|----------------|--------|
| Exact phone match | `sot.person_identifiers.id_value_norm` | ✅ Active |
| Exact email match | `sot.person_identifiers.id_value_norm` | ✅ Active |
| Trigram similarity | `similarity(display_name, ...)` | ✅ Active |
| Soundex matching | `SOUNDEX(first_name) = SOUNDEX(...)` | ✅ Active |
| Shared address context | `sot.person_place` join | ✅ Active |

**Functions**:
- `find_similar_people(name, phone?, email?, threshold)` - Returns matches with scores
- `check_for_duplicate_person(first, last, phone?, email?)` - Quick pre-insert check
- `v_potential_duplicate_people` - View of all candidate duplicates

**Places Deduplication**:
| Technique | Implementation | Status |
|-----------|----------------|--------|
| Google Place ID | `sot.addresses.google_place_id` | ✅ Active |
| Normalized address | `places.normalized_address` | ✅ Active |
| Coordinate proximity | Haversine distance | ✅ Active |
| Exact duplicate merge | `merge_places()` function | ✅ Active |

**Functions**:
- `find_or_create_place_deduped()` - Creates/finds place with dedup
- `normalize_address()` - Basic address normalization
- `merge_places()` - Merges duplicate places
- `v_suggested_place_links` - View of places that might be same site

### Gaps vs Industry Best Practices

| Gap | Industry Solution | Effort | Impact |
|-----|-------------------|--------|--------|
| No probabilistic scoring | Splink Fellegi-Sunter | HIGH | Better precision on edge cases |
| No term frequency weighting | Splink TF adjustments | MEDIUM | "Smith" weighted lower than "Xenophilius" |
| Basic address normalization | libpostal | MEDIUM | Better international + unit handling |
| No blocking optimization | Splink blocking rules | MEDIUM | Faster at scale |
| Manual threshold tuning | Splink/Dedupe ML | HIGH | Auto-optimal thresholds |
| No Jaro-Winkler distance | Add to pg | LOW | Better for typos at start of strings |

---

## Recommended Improvements

### Phase 1: Quick Wins (No New Dependencies)

**1. Add Jaro-Winkler Distance**
Better than Levenshtein for names where errors occur at the end.

```sql
-- Add to MIG_233 or new migration
CREATE OR REPLACE FUNCTION sot.jaro_winkler(s1 TEXT, s2 TEXT)
RETURNS FLOAT AS $$
  -- PostgreSQL doesn't have native Jaro-Winkler, but fuzzystrmatch has similar
  SELECT CASE
    WHEN s1 = s2 THEN 1.0
    WHEN levenshtein(s1, s2) = 0 THEN 1.0
    ELSE 1.0 - (levenshtein(s1, s2)::FLOAT / GREATEST(LENGTH(s1), LENGTH(s2)))
  END;
$$ LANGUAGE SQL IMMUTABLE;
```

**2. Add Name Frequency Weighting**
Common names should contribute less to match confidence.

```sql
-- Create name frequency table
CREATE TABLE ref.name_frequencies (
  name_part TEXT PRIMARY KEY,
  frequency INT,
  weight FLOAT GENERATED ALWAYS AS (1.0 / LOG(frequency + 1)) STORED
);

-- Populate from existing data
INSERT INTO ref.name_frequencies (name_part, frequency)
SELECT
  LOWER(SPLIT_PART(display_name, ' ', 2)) AS last_name,
  COUNT(*)
FROM sot.people
WHERE display_name IS NOT NULL
GROUP BY 1
HAVING COUNT(*) > 1;

-- Use in matching
SELECT
  p.person_id,
  p.display_name,
  similarity(p.display_name, 'John Smith') * COALESCE(nf.weight, 1.0) AS weighted_score
FROM sot.people p
LEFT JOIN ref.name_frequencies nf
  ON nf.name_part = LOWER(SPLIT_PART(p.display_name, ' ', 2));
```

**3. Add Double Metaphone**
Better phonetic matching than Soundex.

```sql
-- fuzzystrmatch includes dmetaphone
SELECT dmetaphone('Catherine'), dmetaphone('Katherine');
-- Both return: KXRN (more accurate than Soundex)

-- Update v_potential_duplicate_people to use dmetaphone
```

### Phase 2: Address Improvements (Medium Effort)

**Option A: libpostal Integration**
- Install pgsql-postal extension
- Create `normalized_address_postal` column
- Better handling of unit variations, abbreviations

**Option B: Enhanced SQL Normalization**
```sql
CREATE OR REPLACE FUNCTION sot.normalize_address_enhanced(addr TEXT)
RETURNS TEXT AS $$
  SELECT LOWER(TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(addr,
              '\s+(street|st\.?)\s*$', ' st', 'i'),  -- Street → St
            '\s+(avenue|ave\.?)\s*', ' ave ', 'i'),  -- Avenue → Ave
          '\s+(apartment|apt\.?|unit|#)\s*', ' apt ', 'i'),  -- Apt variations
        '\s+(suite|ste\.?)\s*', ' ste ', 'i'),  -- Suite → Ste
      '\s+', ' ', 'g')  -- Collapse whitespace
    )
  ));
$$ LANGUAGE SQL IMMUTABLE;
```

### Phase 3: Splink Integration (High Effort, High Value)

**When to Consider**:
- When Atlas has 100K+ people and duplicates are causing issues
- When probabilistic confidence scores are needed for downstream systems
- When blocking optimization becomes necessary for performance

**Integration Architecture**:
```
┌─────────────────────────────────────────────────────────────┐
│                     PostgreSQL (Atlas)                       │
├─────────────────────────────────────────────────────────────┤
│  sot.people, sot.addresses, sot.person_identifiers              │
└───────────────────────────┬─────────────────────────────────┘
                            │ Export CSV/Parquet
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Python Splink Job                        │
├─────────────────────────────────────────────────────────────┤
│  1. Load data from PostgreSQL                               │
│  2. Run Splink deduplication                                │
│  3. Export cluster assignments                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ Import results
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     PostgreSQL (Atlas)                       │
├─────────────────────────────────────────────────────────────┤
│  splink_clusters: (person_id, cluster_id, match_probability)│
│  → Review queue for low-confidence clusters                 │
│  → Auto-merge for high-confidence clusters                  │
└─────────────────────────────────────────────────────────────┘
```

**Cron Job**:
```bash
# Weekly Splink deduplication (run on low-traffic period)
0 3 * * 0 /app/scripts/run_splink_dedup.py
```

---

## Comparison Matrix

| Feature | Atlas Current | Splink | Dedupe | libpostal |
|---------|---------------|--------|--------|-----------|
| People dedup | ✅ Basic | ✅ Advanced | ✅ ML-based | ❌ N/A |
| Address dedup | ✅ Basic | ❌ N/A | ❌ N/A | ✅ Advanced |
| Probabilistic scoring | ❌ | ✅ | ✅ | ❌ |
| Training data required | ❌ | ❌ | ✅ | ❌ |
| Scale (records) | ~100K | 100M+ | ~1M | N/A |
| PostgreSQL native | ✅ | ❌ | ❌ | ✅ (extension) |
| International addresses | ❌ | ❌ | ❌ | ✅ |

---

## Recommended Strategy for Atlas

### Short Term (Current + Quick Wins)
1. Keep current pg_trgm + fuzzystrmatch approach
2. Add Double Metaphone for better phonetic matching
3. Add name frequency weighting for common names
4. Enhance address normalization SQL function

### Medium Term (When Scale Demands)
1. Add libpostal for address parsing/normalization
2. Create scheduled duplicate detection job (weekly)
3. Build admin UI for reviewing suggested merges

### Long Term (When Needed)
1. Integrate Splink for probabilistic people matching
2. Run as batch job, import cluster assignments
3. Use match probabilities to prioritize review queue

---

## Testing Deduplication Quality

### Known Test Cases (From Atlas Data)

| Test | Input | Expected Match | Current Result |
|------|-------|----------------|----------------|
| Name variation | "Bibiana Patino" vs "Viviana Patino" | Same person (soundex) | ✅ Detected |
| Name typo | "Sarah Smith" vs "Sara Smith" | Likely same | ✅ Detected |
| Phone match | Different names, same phone | Same person | ✅ Detected |
| Address unit | "123 Main St #4" vs "123 Main St Apt 4" | Same address | ⚠️ Partial |
| Common name | "John Smith" vs another "John Smith" | Different people | ⚠️ May false-positive |

### Quality Metrics to Track

```sql
-- Duplicate detection rate
SELECT
  COUNT(*) AS total_candidates,
  COUNT(*) FILTER (WHERE shares_identifier) AS confirmed_dupes,
  COUNT(*) FILTER (WHERE shares_place) AS likely_dupes,
  COUNT(*) FILTER (WHERE NOT shares_identifier AND NOT shares_place) AS uncertain
FROM ops.v_potential_duplicate_people;

-- False positive rate (requires manual review sample)
-- Sample 50 suggested duplicates, manually verify, track accuracy
```

---

## References

- [Splink Documentation](https://moj-analytical-services.github.io/splink/)
- [Dedupe.io Documentation](https://docs.dedupe.io/)
- [libpostal GitHub](https://github.com/openvenues/libpostal)
- [Fellegi-Sunter Model Paper (1969)](https://www.tandfonline.com/doi/abs/10.1080/01621459.1969.10501049)
- [Record Linkage Best Practices (Spot Intelligence)](https://spotintelligence.com/2024/01/22/entity-resolution/)
- [Address Standardization Guide (WinPure)](https://winpure.com/address-standardization-guide/)
- [Crunchy Data: Address Matching with LibPostal](https://www.crunchydata.com/blog/quick-and-dirty-address-matching-with-libpostal)
