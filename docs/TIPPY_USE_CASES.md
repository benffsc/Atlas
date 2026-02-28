
## NBAS Failure Analysis (2026-02-27)

### The Ask
"Find all clients where NBAS failed them, causing them to come to FFSC instead. Look for foster cats that got pregnant due to long waitlists, people who were turned away, capacity issues, etc. Don't use keyword matching - I want AI to understand context."

### What Tippy Did
1. Searched ClinicHQ notes for any mention of NBAS/North Bay Animal Services (77 records)
2. Used AI to analyze each note and determine if it represented a genuine NBAS failure vs. neutral mention
3. Classified failures by type: foster_failure, waitlist, refused, capacity
4. Cross-referenced with Atlas to pull microchips, appointment dates, cat names
5. Generated printer-friendly report with full documentation

### Results
- **77 total NBAS mentions** in clinic notes
- **41 verified failures** (53%) where NBAS failed clients
- **36 neutral mentions** (traps loaned, scans, referrals - not failures)

### Failure Breakdown
| Type | Count | Description |
|------|-------|-------------|
| Foster Failure | 14 | Cats adopted out unaltered, no timely spay/neuter |
| Waitlist | 14 | 6-12 month waits, cats got pregnant |
| Refused | 8 | NBAS turned away clients |
| Capacity | 4 | No room, couldn't take animals |

### Example AI Analysis
**Input Note:** "Client was foster/adopt client through NBAS and tried for three months to have cats neutered. Called SCAS, RPAS. Called us out of desperation."

**AI Output:** 
```json
{
  "is_failure": true,
  "type": "foster_failure", 
  "confidence": "high",
  "reason": "NBAS foster-to-adopt program failed to provide timely spay/neuter for three months, forcing desperate client to seek help elsewhere."
}
```

### Why This Matters
- **Not keyword matching:** "NBAS loaned us a trap" would NOT be flagged as a failure
- **Context understanding:** AI distinguishes between NBAS helping vs. failing
- **Structured output:** Categorized by failure type for reporting
- **Evidence gathering:** Full clinic notes preserved for documentation

### Files Generated
- `nbas_failures_ai_analyzed.csv` - Raw data with AI classifications
- `nbas_failures_LANDSCAPE.txt` - Printer-friendly report (130 char width)
- `nbas_complete_FINAL.csv` - All NBAS mentions with microchips/appointments

### Implementation
This analysis used Claude Sonnet to evaluate each clinic note against specific criteria:
- NBAS FAILURE: waitlists, foster failures, refusals, capacity issues
- NOT FAILURE: trap loans, scans, volunteering, NBAS taking in cats

The same approach could be used for:
- Finding rabies exposure cases in notes
- Identifying hoarding situations
- Extracting colony size estimates from free-text
- Classifying complaint types from intake notes

