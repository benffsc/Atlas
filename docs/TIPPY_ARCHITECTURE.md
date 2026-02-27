# Tippy Architecture: Unified Expert Agent System

**Version:** 2.0
**Date:** 2026-02-26
**Status:** Implementation Guide

Tippy is an **expert agentic AI** that knows the ins and outs of FFSC's data, operations, strengths, weaknesses, and data gaps. This document defines the unified architecture for all Tippy components.

---

## Design Philosophy

Based on [industry best practices](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) for agentic AI systems:

### 1. Single Agent with Deep Domain Expertise
Tippy uses the **single-agent pattern** with comprehensive domain knowledge embedded in its system prompt. Unlike generic chatbots, Tippy reasons like an experienced TNR coordinator who has worked at FFSC for years.

### 2. Reasoning-Action Coupling
Per [Amazon's evaluation framework](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/), Tippy couples reasoning tightly with action:
- **Sense**: Receive question + context
- **Think**: Reason about what data would answer it (chain-of-thought)
- **Act**: Execute tools to gather data
- **Reflect**: Interpret results, identify gaps, explain caveats

### 3. Honest Data Quality Awareness
Unlike systems that blindly report numbers, Tippy:
- Distinguishes NULL (unknown) from actual values
- Acknowledges when data gaps exist
- Explains why numbers might differ between systems
- Recommends caution when statistics seem suspicious

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      TIPPY AGENT SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐   ┌─────────────────┐   ┌────────────────┐ │
│  │ DOMAIN KNOWLEDGE│   │ REASONING ENGINE │   │ COMMUNICATION  │ │
│  │                 │   │                  │   │    STYLE       │ │
│  │ - TNR science   │   │ - Chain of       │   │ - Story-first  │ │
│  │ - FFSC ops      │   │   thought        │   │ - Caveats      │ │
│  │ - Data quality  │   │ - Hypothesis     │   │ - Mission      │ │
│  │ - Known gaps    │   │   testing        │   │   connection   │ │
│  └────────┬────────┘   │ - Self-reflection│   └────────────────┘ │
│           │            └────────┬─────────┘                       │
│           │                     │                                 │
│           ▼                     ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                     TOOL MANIFEST                            │ │
│  │                                                              │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │ │
│  │  │  QUERY TOOLS │ │ ACTION TOOLS │ │  REASONING TOOLS     │ │ │
│  │  │              │ │              │ │                      │ │ │
│  │  │ run_sql      │ │ create_      │ │ analyze_place_       │ │ │
│  │  │ query_*      │ │   reminder   │ │   situation          │ │ │
│  │  │ lookup_*     │ │ send_staff_  │ │ strategic_city_      │ │ │
│  │  │ comprehensive│ │   message    │ │   analysis           │ │ │
│  │  │   _*_lookup  │ │ log_*        │ │ compare_places       │ │ │
│  │  └──────────────┘ │ save_lookup  │ │ check_data_quality   │ │ │
│  │                   └──────────────┘ └──────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  DATA QUALITY LAYER                          │ │
│  │                                                              │ │
│  │  Known Gaps:  DATA_GAP_056, 057, 058, 059, ...              │ │
│  │  Soft Blacklist: Org emails, fabricated PetLink emails      │ │
│  │  Confidence Thresholds: >= 0.5 for identifiers              │ │
│  │  NULL Awareness: Always distinguish unknown vs actual       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
apps/web/src/app/api/tippy/
├── chat/
│   └── route.ts           # Main API endpoint, system prompt, orchestration
├── tools.ts               # Tool definitions and implementations
├── domain-knowledge.ts    # NEW: Centralized domain expertise
├── data-quality.ts        # NEW: Known gaps, caveats, quality checks
├── reasoning-patterns.ts  # NEW: Structured reasoning templates
└── feedback/
    └── route.ts           # Feedback collection

docs/
├── TIPPY_ARCHITECTURE.md  # THIS FILE - unified design
├── TIPPY_SHOWCASE_QUESTIONS.md  # Demo questions with expected responses
├── TIPPY_DATA_QUALITY_REFERENCE.md  # Data quality issues for staff
└── TIPPY_VIEWS_AND_SCHEMA.md  # Database schema reference
```

---

## Domain Knowledge Module

### Location: `apps/web/src/app/api/tippy/domain-knowledge.ts`

Centralizes all FFSC-specific knowledge that makes Tippy an expert:

```typescript
export const DOMAIN_KNOWLEDGE = {
  // Scientific thresholds
  alteration_thresholds: {
    under_control: { min: 90, description: "Population stable, breeding stopped" },
    good_progress: { min: 70, max: 89, description: "Significant impact, not yet stable" },
    needs_attention: { min: 50, max: 69, description: "Active breeding likely continuing" },
    early_stages: { max: 49, description: "Substantial work still needed" },
    stabilization_threshold: 70,  // Scientific basis for population control
  },

  // Operational definitions
  mass_trapping: {
    threshold: 10,  // 10+ cats in one day = mass trapping event
    significance: "Shows coordinated TNR effort, can stabilize colony quickly",
  },

  // Geographic context
  sonoma_regions: {
    "west county": ["Sebastopol", "Forestville", "Guerneville", "Monte Rio", "Occidental"],
    "north county": ["Healdsburg", "Cloverdale", "Geyserville", "Windsor"],
    "russian river": ["Guerneville", "Monte Rio", "Forestville", "Rio Nido"],
    // ... more regions
  },

  // Role definitions
  roles: {
    caretaker: "Feeds colony regularly, knows the cats",
    resident: "Lives at the address",
    colony_caretaker: "Specifically manages a feral colony",
    trapper: "FFSC-trained volunteer who traps cats",
    coordinator: "FFSC staff who manages trapping operations",
  },

  // Data source authorities
  source_authority: {
    clinichq: ["TNR procedures", "medical records", "microchips"],
    shelterluv: ["foster placements", "adoptions", "intake events"],
    volunteerhub: ["volunteer/trapper info", "training status"],
    airtable: ["legacy requests", "historical data"],
  },
};
```

---

## Data Quality Module

### Location: `apps/web/src/app/api/tippy/data-quality.ts`

Centralizes knowledge of data gaps, caveats, and quality checks:

```typescript
export const DATA_QUALITY = {
  // Known gaps with explanations
  known_gaps: {
    DATA_GAP_056: {
      name: "Shared Phone Cross-Linking",
      impact: "Some older records may have wrong person-place links",
      caveat: "If data seems inconsistent, acknowledge possible data quality issues",
    },
    DATA_GAP_057: {
      name: "ShelterLuv Sync Stale",
      impact: "Foster/adoption outcomes may be incomplete",
      caveat: "ShelterLuv foster data isn't fully synced yet",
    },
    DATA_GAP_058: {
      name: "Places Without Address Links",
      impact: "32% of places not in city-level aggregations",
      caveat: "City totals may undercount due to missing address links",
    },
    DATA_GAP_059: {
      name: "NULL Altered Status",
      impact: "Low alteration rates may be data gaps, not reality",
      caveat: "Most cats have unknown status from legacy imports",
      check: "When rate < 50% and total > 50 cats, check NULL count",
    },
  },

  // Validation checks
  suspicious_patterns: [
    {
      pattern: "alteration_rate < 10% AND total_cats > 100",
      likely_cause: "NULL altered_status from legacy data",
      recommendation: "Check NULL count before treating as priority",
    },
    {
      pattern: "person linked to 50+ places",
      likely_cause: "Organization or trapper, not resident",
      recommendation: "Filter by relationship type",
    },
  ],

  // Explanation templates
  caveats: {
    null_vs_intact: "A cat with NULL altered_status means 'unknown' - we haven't recorded the status. This is different from 'intact' (confirmed unaltered).",
    reported_vs_verified: "Caretakers count cats at the food bowl; we count verified clinic visits. The gap tells us how much work remains.",
    legacy_data: "Data before 2024 was entered with less rigorous practices. Some historical links may be inaccurate.",
  },
};
```

---

## Reasoning Patterns Module

### Location: `apps/web/src/app/api/tippy/reasoning-patterns.ts`

Provides structured reasoning templates for complex questions:

```typescript
export const REASONING_PATTERNS = {
  // Pattern: Place Analysis
  place_analysis: {
    steps: [
      "1. Get place data (cats, alteration rate, people)",
      "2. Check for data quality flags (NULL status count, suspicious rates)",
      "3. Look for nearby activity if no exact match",
      "4. Interpret using domain knowledge (70% threshold, mass trapping)",
      "5. Acknowledge limitations and explain what we know vs don't know",
    ],
    example: `
      User: "What's happening at 1688 Jennings Way?"

      Reasoning:
      - Query place → 187 cats, 5.9% altered
      - Check quality → 176/187 have NULL status (94%)
      - Interpretation → This rate is suspicious given NULL count

      Response: "1688 Jennings Way has 187 cats in our records, but I should
      flag something about the 5.9% rate - most of those cats have unknown
      status from legacy data, not confirmed unaltered."
    `,
  },

  // Pattern: Priority Identification
  prioritization: {
    steps: [
      "1. Identify places with untrapped potential (reported > verified)",
      "2. Check for places below 70% with CONFIRMED status (not NULL)",
      "3. Consider geographic clustering (nearby colonies)",
      "4. Weight by urgency (active requests, recent activity)",
      "5. Explain reasoning and acknowledge data limitations",
    ],
  },

  // Pattern: Comparison
  comparison: {
    steps: [
      "1. Gather metrics for both entities",
      "2. Normalize for fair comparison (rates, not raw counts)",
      "3. Identify what's actually different vs noise",
      "4. Consider data quality differences between entities",
      "5. Provide actionable insight, not just numbers",
    ],
  },

  // Pattern: Strategic Analysis
  strategic_analysis: {
    steps: [
      "1. State the question clearly",
      "2. Identify what data would answer it",
      "3. Query and interpret results",
      "4. Consider what's NOT in the data",
      "5. Provide recommendation with caveats",
    ],
  },
};
```

---

## Tool Categories

Tools are organized by purpose:

### 1. Query Tools (Read-Only Data Access)
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `run_sql` | Dynamic SQL queries | Complex or exploratory questions |
| `query_cats_at_place` | Cats at location | Simple cat count questions |
| `query_place_colony_status` | Colony metrics | Alteration rate questions |
| `comprehensive_place_lookup` | Full place report | "Tell me about [address]" |
| `comprehensive_person_lookup` | Full person report | "Tell me about [person]" |
| `comprehensive_cat_lookup` | Full cat report | "Tell me about [cat]" |
| `query_cats_altered_in_area` | Regional stats | City/region questions |
| `query_region_stats` | Comprehensive area stats | "What's happening in [area]?" |

### 2. Action Tools (Write Operations)
| Tool | Purpose | Access Level |
|------|---------|--------------|
| `create_reminder` | Personal reminders | read_write |
| `save_lookup` | Save research | read_write |
| `send_staff_message` | Staff messaging | read_write |
| `log_site_observation` | Log observations | read_write |
| `create_draft_request` | Draft new request | read_write |
| `propose_data_correction` | Flag data issues | full |

### 3. Analysis Tools (Reasoning Support)
| Tool | Purpose | Output |
|------|---------|--------|
| `analyze_place_situation` | Full place analysis with hints | Structured interpretation |
| `analyze_spatial_context` | Nearby activity analysis | Hot zone detection |
| `strategic_city_analysis` | City-level TNR analysis | Coverage gaps |
| `compare_places` | Multi-dimensional comparison | Prioritization guidance |
| `check_data_quality` | Data quality assessment | Issues and caveats |

### 4. Data Exploration Tools (Discovery)
| Tool | Purpose | Use Case |
|------|---------|----------|
| `discover_views` | Find available views | Schema exploration |
| `query_view` | Query specific views | Custom analysis |
| `explore_entity` | Entity deep-dive | Understanding data |
| `query_data_lineage` | Track data sources | Provenance questions |

---

## Communication Style Guidelines

Tippy communicates like an experienced colleague, not a database query engine.

### DO:
- **Lead with the story**: "175 Scenic Avenue is one of our great success stories..."
- **Explain what numbers mean**: "94.5% altered means this colony is stabilized"
- **Acknowledge limitations honestly**: "I should mention that most cats here have unknown status"
- **Connect to the mission**: "This is exactly how TNR works at scale"
- **Guide prioritization**: "The real priority is active requests with untrapped potential"

### DON'T:
- Report raw statistics without context
- Say "I don't have that data" without trying tools
- Ignore suspicious patterns (very low rates, very high counts)
- Treat all data as equally reliable
- Overwhelm with numbers instead of insights

### Example Transformation:

**BAD Response:**
> "Query results: 187 cats, 11 altered, 176 unaltered. Alteration rate: 5.9%."

**GOOD Response:**
> "1688 Jennings Way has 187 cats in our records, but I should flag something about the 5.9% rate - most of those cats have unknown status from legacy data, not confirmed unaltered. We can't say if this is a priority or a data gap without checking individual records. The real priorities are active requests where we KNOW cats are waiting, like 36855 Annapolis Road where someone reported 45 cats but we've only verified 22."

---

## Test Suite Alignment

Tests should validate the story-like response style, not just data accuracy.

### Test Categories:

1. **Accuracy Tests** (`tippy-accuracy-verification.spec.ts`)
   - Verify correct tool selection
   - Validate data retrieval
   - Check for hallucination

2. **Response Quality Tests** (`tippy-human-questions.spec.ts`)
   - Story-like response format
   - Appropriate caveats included
   - Mission connection present

3. **Data Quality Awareness Tests** (`tippy-expected-gaps.spec.ts`)
   - Acknowledges known gaps
   - Flags suspicious statistics
   - Explains NULL vs actual

4. **Edge Case Tests** (`tippy-edge-cases.spec.ts`)
   - Handles missing data gracefully
   - Provides spatial fallback
   - Manages ambiguous queries

### Test Fixtures Update:

```typescript
// fixtures/tippy-questions.ts
export const SHOWCASE_QUESTIONS = [
  {
    question: "How many cats has FFSC helped?",
    expectedTools: ["query_ffr_impact"],
    expectedPatterns: [
      /\d{2,},?\d{3}.*cats/i,  // Numeric answer
      /threshold|stabiliz/i,   // Context about meaning
      /sonoma county|ffsc/i,   // Mission connection
    ],
    shouldNotInclude: [
      /I don't have/i,
      /I cannot/i,
    ],
  },
  {
    question: "What location needs the most attention?",
    expectedTools: ["run_sql", "analyze_place_situation"],
    expectedPatterns: [
      /untrapped potential|reported.*verified/i,  // Priority reasoning
      /caveat|should note|should mention/i,       // Data quality awareness
    ],
    mustCheckNullStatus: true,  // If rate < 50%, must mention NULL
  },
];
```

---

## Implementation Checklist

### Phase 1: Foundation
- [x] Create TIPPY_ARCHITECTURE.md (this document)
- [ ] Create domain-knowledge.ts module
- [ ] Create data-quality.ts module
- [ ] Create reasoning-patterns.ts module

### Phase 2: Integration
- [ ] Refactor tools.ts to import domain knowledge
- [ ] Update chat/route.ts system prompt to use centralized modules
- [ ] Add structured reasoning to tool implementations

### Phase 3: Testing
- [ ] Update test fixtures with story-style validation
- [ ] Add data quality awareness tests
- [ ] Create benchmark suite for reasoning quality

### Phase 4: Documentation
- [ ] Update TIPPY_DATA_QUALITY_REFERENCE.md
- [ ] Update TIPPY_SHOWCASE_QUESTIONS.md (DONE)
- [ ] Create staff training guide for Tippy

---

## References

- [Google Cloud: Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [Amazon: Evaluating AI Agents](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [Survey: AI Agent Architectures for Reasoning & Tool Calling](https://arxiv.org/html/2404.11584v1)
- [Model Context Protocol](https://www.speakeasy.com/mcp/using-mcp/ai-agents/architecture-patterns)
