# Staff Guide: Identity Review

This guide helps staff understand how to use the Identity Review system in Atlas.

## Quick Start

**Access the review dashboard:** `/admin/reviews`

This shows all pending review queues with counts. Click "Identity" to review person duplicates.

---

## Understanding Match Probability

Each potential duplicate shows a **match probability percentage** indicating how likely the two records are the same person.

### Color Coding

| Color | Probability | Recommendation |
|-------|-------------|----------------|
| **Green** | 90%+ | High confidence - usually safe to **Merge** |
| **Orange** | 70-90% | Medium confidence - review carefully before deciding |
| **Red** | Below 70% | Lower confidence - often **Keep Separate** |

### What the Probability Means

The system uses **Fellegi-Sunter probabilistic matching**, which calculates the odds that two records represent the same person based on:

- **Email match**: Very strong indicator (+13 points)
- **Phone match**: Strong indicator (+10 points)
- **Name similarity**: Moderate indicator (+3 to +5 points)
- **Address match**: Supporting evidence (+7 points)

Higher probabilities mean more fields agree between the records.

---

## Field Comparison Breakdown

Each review card shows which fields matched, disagreed, or were missing:

| Symbol | Meaning | Example |
|--------|---------|---------|
| **✓ (green)** | Fields agree | Both have same email |
| **✗ (red)** | Fields disagree | Different phone numbers |
| **– (gray)** | Field missing | One record has no phone |

### Reading the Weight

Each field shows its contribution to the score in parentheses:
- **+13.1** = Strong agreement (email match)
- **+5.4** = Moderate agreement (name match)
- **-3.3** = Disagreement (email differs)
- **0** = Missing field (neutral)

**Missing fields are neutral** - they don't count for or against a match.

---

## When to Merge

**Merge** when you're confident the records represent the same person:

- Same email address (very reliable)
- Same phone number + similar name
- Same address + same name (be careful - could be household members)
- All identifying information matches

### Merge Examples

| Scenario | Decision |
|----------|----------|
| Same email, different phone | **Merge** - email is more reliable |
| Same phone, similar name (John Smith / J. Smith) | **Merge** - likely same person |
| Same address, same exact name | **Review carefully** - might be household or might be same person with two entries |

---

## When to Keep Separate

**Keep Separate** when you're confident these are different people:

- Different email AND different phone AND names aren't similar
- Same address but clearly different names (household members)
- One record is a business, other is a person
- Names match but other details suggest different people

### Keep Separate Examples

| Scenario | Decision |
|----------|----------|
| "Mary Jones" and "John Jones" at same address | **Keep Separate** - different household members |
| Same common name but different city | **Keep Separate** - different people |
| Business name matched to person name | **Keep Separate** - not the same entity |

---

## When to Dismiss

**Dismiss** when the record shouldn't be in the review queue:

- Garbage data (test entries, obvious typos)
- Internal accounts (staff@forgottenfelines.org)
- Records that were already resolved elsewhere

---

## Batch Processing

For efficiency, you can process multiple similar items at once:

1. Check the boxes next to records you want to batch process
2. Click **"Select all on this page"** if all items should have the same action
3. Click the batch action button:
   - **Merge All** - Merge all selected pairs
   - **Keep All Separate** - Mark all as different people
   - **Dismiss All** - Remove all from queue

**Tip:** Batch process obvious matches first (90%+ probability), then review uncertain ones individually.

---

## Filter Tabs

Use the filter tabs to focus on specific match types:

| Tab | Description |
|-----|-------------|
| **All** | All pending reviews |
| **Name + Address** | Same name at same address (Tier 4) |
| **Phone + Name** | Matching phone and similar name |
| **Email** | Matching email address |
| **Phone Only** | Matching phone, names may differ |
| **Name Only** | Only names match (lower confidence) |
| **Uncertain** | Data engine couldn't decide |

---

## Review Cards Explained

Each review card shows two entities side by side:

```
┌─────────────────────────────────────────────────────────────────┐
│ [Phone + Name]  @ 123 Main St, Santa Rosa                       │
│                                                                 │
│ ┌─────────────────┐    ┌───────┐    ┌─────────────────┐        │
│ │ EXISTING (KEEP) │    │  87%  │    │ MERGE INTO      │        │
│ │ John Smith      │    │       │    │ J. Smith        │        │
│ │ john@email.com  │    │ prob. │    │ (707) 555-1234  │        │
│ │ (707) 555-1234  │    │       │    │ Source: Web     │        │
│ │ 5 cats, 3 reqs  │    │score: │    │                 │        │
│ │ Created 1/2024  │    │ +8.2  │    │                 │        │
│ └─────────────────┘    └───────┘    └─────────────────┘        │
│                                                                 │
│ Detection: Phone match + name similarity                        │
│ Field Comparison: ✓ Phone (+10.7)  – Email (0)  ✓ Name (+5.4)  │
│                                                                 │
│            [Keep Separate]  [Merge]  [Dismiss]                  │
└─────────────────────────────────────────────────────────────────┘
```

### Card Elements

- **Left side (green)**: Existing record that will be kept
- **Center**: Match probability and composite score
- **Right side (gray)**: Record that would merge into the existing one
- **Field Comparison**: Shows which fields matched/disagreed
- **Action buttons**: Your decision options

---

## Tips for Efficient Review

1. **Start with high confidence** - Process 90%+ matches first (usually clear merges)
2. **Use batch actions** - Select multiple obvious matches and merge at once
3. **Check context** - Look at cat count, request count to understand which record is more complete
4. **When in doubt, Keep Separate** - It's easier to merge later than to split incorrectly merged records
5. **Filter by type** - Focus on one category at a time for consistency

---

## FAQ

**Q: What happens when I merge?**
A: The right-side record is soft-deleted and its data is associated with the left-side (canonical) record. Cats, requests, and appointments are transferred.

**Q: Can I undo a merge?**
A: Contact an administrator. Merges are tracked and can be reversed, but it requires database access.

**Q: Why do I see the same person appearing multiple times?**
A: They may have been entered multiple times through different sources (clinic, web form, Airtable). This is why we need to review and merge.

**Q: What if probability is exactly 50%?**
A: This is the threshold for the uncertain zone. Review the fields carefully - if any unique identifier matches (email/phone), lean toward merge.

---

## Getting Help

If you encounter:
- A complex case you're unsure about
- A bug in the review system
- Incorrect match suggestions

Contact an administrator or leave the item for later review.

---

*Last updated: February 2026*
*See also: [Identity Resolution Architecture](IDENTITY_RESOLUTION_ARCHITECTURE.md) for technical details*
