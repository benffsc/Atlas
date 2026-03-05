# Atlas Technical Visualizations

High-resolution technical diagrams for engineers working on Atlas.

## Available Diagrams

| Diagram | Description |
|---------|-------------|
| [Entity Relationship Diagram](./ENTITY_RELATIONSHIP_DIAGRAM.md) | Database schema with all tables, columns, and relationships |
| [SQL Functions Map](./SQL_FUNCTIONS_MAP.md) | Function signatures with parameters, return types, and file locations |
| [API Routes Map](./API_ROUTES_MAP.md) | All API routes with handlers, views, and TypeScript contracts |
| [Data Flow Diagram](./DATA_FLOW_DIAGRAM.md) | End-to-end data pipeline with processing sequences |

## Rendering Mermaid Diagrams

### GitHub
GitHub renders Mermaid diagrams natively in markdown files.

### VS Code
Install "Markdown Preview Mermaid Support" extension.

### FigJam Import
1. Copy the Mermaid code block
2. Go to [mermaid.live](https://mermaid.live)
3. Paste and export as SVG
4. Import SVG into FigJam

### Documentation Sites
Most modern documentation tools (Docusaurus, GitBook, Notion) support Mermaid.

## Key Technical Details

All diagrams include:
- **File paths** with line numbers (e.g., `src/app/api/cats/[id]/route.ts:15`)
- **Function signatures** with full parameter lists
- **Database columns** with types and constraints
- **Processing rules** with migration references (e.g., MIG_2400)

## Related Documentation

- `CLAUDE.md` - Development rules and invariants
- `docs/CENTRALIZED_FUNCTIONS.md` - Full function signatures
- `docs/DATA_FLOW_ARCHITECTURE.md` - Narrative documentation
- `@/lib/types/view-contracts.ts` - TypeScript interfaces
