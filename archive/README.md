# Archive Directory

Curated files from previous work that may be useful later but aren't part of active Atlas.

## Contents

### `cockpit_snapshot/`

Files copied from `ffsc-trapper-cockpit` repo (Jan 2026). Reference material for:
- Understanding previous migration patterns
- Finding SQL that might be reusable
- Checking how things were done before

**Structure:**
```
cockpit_snapshot/
├── sql/
│   ├── migrations/    # All migrations from Cockpit
│   ├── views/         # View definitions
│   ├── queries/       # Ad-hoc queries
│   └── checks/        # Sanity check queries
├── scripts/           # Shell and Python scripts
└── docs/              # Additional documentation
```

## Usage Guidelines

1. **Reference Only** — Don't run archive SQL directly; adapt for Atlas first
2. **Curate Before Use** — Review, test, and move to active directories
3. **Document Changes** — When adapting archived code, note what was changed and why

## What NOT to Archive

- Secrets or credentials (should never exist anywhere)
- Data exports or CSVs (never committed)
- Temporary files or build artifacts
