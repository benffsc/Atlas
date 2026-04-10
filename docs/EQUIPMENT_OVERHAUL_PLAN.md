# Equipment Overhaul Plan — Transfer Cage Readiness + Digital Checkout

**Status:** Plan mode (2026-04-09, updated 2026-04-10 with data analysis + industry research)
**Trigger:** Transfer cages arriving in ~2 weeks; need formalized checkout system
**Strategic context:** Equipment kiosk is the central checkout point. Paper slip is the mid-step. Beacon/Atlas tracks everything.
**Epic:** FFS-1201 in Linear (14 sub-issues: FFS-1202–1214, FFS-1224–1227)

---

## Data Analysis (2026-04-10 — live production database)

### Fleet snapshot
- **157 active items** (130 traps, 27 accessories)
- **64% checked out** (101 items), **26% available** (41), **10% missing** (15)
- All 15 missing items are Large Trap (Backdoor) from the April 3 Inventory Day audit
- Only 13 of 99 large backdoor traps are currently available on the shelf

### Checkout patterns
- **Median checkout duration: 10 days** (mean 19.6, max 236)
- **Typical month: 90-170 checkout events** across 35-55 unique items
- **April 2026 is 100% Atlas UI** (11 checkouts) — system transition is active
- **93.5% of historical checkouts have no named borrower** (Airtable legacy gap)

### Critical data gaps (fields that exist but are never used)
| Field | Usage | Impact |
|---|---|---|
| **Due date** | 0% set | No overdue tracking possible |
| **Deposit amount** | 0% set (tracked on paper per notes) | No "who owes us" dashboard |
| **Checkout purpose** | 0.4% set (5 of 1,410) | No purpose analytics |
| **Checkout type** | 0.7% set (10 of 1,410) | No type breakdown |
| **Place linked** | 0% of checkouts | No geographic tracking |
| **Digital agreements** | 0 signed | No waiver records |
| **Borrower identity** | 6.5% of historical checkouts | Person resolution mostly broken |

### What the notes tell us
- Paper slip transcription: staff entering old-form checkouts into Atlas after the fact
- Inventory Day: 4 distinct note patterns (confirmed shelf / stale clearing / confirmed out / missing)
- Deposit mentions: "Deposit NOT returned" appears in notes — deposits are real, just not in the schema

### Top borrowers (named only — 93.5% are unnamed)
- Crystal Furtado: 30 checkouts, avg 6.9 days (fast — likely a trapper)
- Cassie Thomson: 11 checkouts, avg 32.7 days (holds traps longer)
- Lesley Cowley: 4 checkouts, avg 85 days (significant outlier)

### Implications for design
1. **14-day default loan period** aligns with 10-day median + buffer
2. **Deposits are real** but only tracked on paper → first-class digital tracking is urgent
3. **The paper-to-digital transition is in progress** but the UI must be fast enough to replace paper at the counter
4. **Place linking is the biggest data gap** — traps go to specific locations but no record of where
5. **The 15 missing traps** suggest Inventory Day should be a repeatable scheduled workflow
6. **Borrower identity must be captured at checkout time**, not backfilled later

---

## Industry Research (2026-04-10)

### TNR Equipment Lending (HumanePro, Alley Cat Allies, Shelter Pro)
- **QR/barcode on every trap** — weatherproof stickers, scan at checkout (Operation Catnip + FCCO)
- **FCCO abandoned paper forms** for real-time barcode scanning that "forces staff to record transactions as they occur"
- **Deposits: $20-75/trap** (Alley Cat Allies: $60). Credit card kept under lock and key, NOT in digital system
- **Loan agreement = liability waiver** — "may serve as release form to protect from liability for injury"
- **Weekly follow-up calls** — check on colony status + troubleshoot, not just demand returns
- **Generous extensions** for trapping unpredictability; credit card charged only after repeated ignored calls

### Unified Kiosk (Bibliotheca, Lyngso, Vet Lobby)
- **"Menu of services" on one device** — lending + returns + account info + payments simultaneously
- **Each kiosk configurable differently** but managed from central admin
- **Accessibility first** — large touch targets, multilingual, clear visuals
- **"Too much complexity = users needing staff support"** — keep it simple

Full source citations in `memory/industry-equipment-kiosk-research.md`.

---

## The Three Layers

### Layer 1 — Data & Infrastructure (build first)

The foundation that makes everything else possible. Most of this EXISTS today (the equipment schema is surprisingly mature) but needs hardening and a few additions.

#### L1.1 — Fix "free spay/neuter" messaging (quick win)
Two user-visible locations say "free" when FFSC actually asks a $50 donation:
- `KioskMissionFrame.tsx:70` → change to "$50 suggested donation" or configurable text
- `kiosk/page.tsx:28` subtitle → change "Free surgery" to match

Make this admin-configurable via `kiosk.clinic_description` so Ben can tune the language.

**Files:** `components/kiosk/KioskMissionFrame.tsx`, `app/kiosk/page.tsx`
**Effort:** Small (30 min)

#### L1.2 — Equipment type readiness for transfer cages
Transfer cage types already exist in `ops.equipment_types` (`transfer_cage`, `wire_cage_single_door`, `wire_cage_double_door`). Verify:
- The kiosk add-equipment page shows them in the "Cage" category ✓ (already does)
- The checkout slip's "Equipment Description" field handles them (it does — generic)
- The paper slip's Purpose options (FFR Appt / Feeding / Transport / Other) cover cage use cases

**If gaps found:** Add more types to `ops.equipment_types`, update form-options.ts.
**Effort:** Small (verification + possible seed migration)

#### L1.3 — Deposit ledger view
Today: `ops.equipment_events.deposit_amount` records the deposit at checkout, and `deposit_returned_at` records when it's refunded. But there's no way to see "who owes us money right now" without querying the event log manually.

Build: `ops.v_equipment_deposits_outstanding` view that shows all active checkouts with a deposit_amount > 0 AND no deposit_returned_at. Surface this in the admin equipment dashboard.

**Files:** New migration, admin equipment page enhancement
**Effort:** Small-Medium

#### L1.4 — Overdue alert automation
Today: `equipment.overdue_days_warning` (14) and `equipment.overdue_days_critical` (30) config keys exist but nothing reads them to send alerts.

Build: A cron route that checks `ops.v_equipment_inventory` for items past due, and creates entries in `ops.alert_queue` (already exists from FFS-911). Staff sees alerts in the admin dashboard.

**Files:** New cron route, alert queue integration
**Effort:** Medium

#### L1.5 — Person-equipment view on detail pages
When looking at a person's profile, staff should see "This person has 2 traps checked out (0106, 0203), 1 overdue." Same for places: "3 traps currently deployed at this address."

Build: Add equipment sections to person detail and place detail pages using the existing `current_custodian_id` + `current_place_id` joins.

**Files:** `components/person/` sections, `components/place/` sections
**Effort:** Medium

---

### Layer 2 — Formalization (build after Layer 1 is solid)

The policies, agreements, and tracking that turn a casual loan into a proper organizational process.

#### L2.1 — Digital checkout agreement / waiver
The big one. When someone checks out equipment, they need to:
1. Read the loan terms (return date, condition expectations, deposit policy)
2. Acknowledge / sign (digital signature or checkbox + timestamp)
3. Have that agreement stored and linked to the checkout event

**Architecture options:**
- **A. Kiosk-native:** Full-screen agreement modal on the kiosk with scroll-to-bottom + "I agree" button + name entry. Stores agreement as a record in a new `ops.equipment_agreements` table linked to the event.
- **B. Docusign/PDF-sign integration:** Generate a PDF waiver, collect signature via a signing service. More legally robust but heavier infra.
- **C. Paper-only (current):** Continue using the paper slip as the agreement. Staff keeps the signed copy. No digital record beyond the event.

**Recommendation:** Start with **A** (kiosk-native). It's the fastest path to a digital record, works with the existing kiosk flow, and doesn't require third-party integration. The agreement text is admin-configurable. The signature is a typed-name-plus-timestamp (legally sufficient for a loan agreement under CA law for this value range).

**Schema:**
```sql
CREATE TABLE ops.equipment_agreements (
  agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES ops.equipment_events(event_id),
  equipment_id UUID REFERENCES ops.equipment(equipment_id),
  person_id UUID REFERENCES sot.people(person_id),
  person_name TEXT NOT NULL,
  agreement_version TEXT NOT NULL,
  agreement_text TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_type TEXT NOT NULL DEFAULT 'typed_name',
  signature_value TEXT, -- the typed name or image data
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Files:** Migration, kiosk checkout flow enhancement, admin view
**Effort:** Large (1-2 sessions)

#### L2.2 — Card info handling (SENSITIVE — needs careful design)
If someone can't pay cash deposit, staff needs to take card info. This is **PCI-sensitive**. Options:
- **A. Don't store card info digitally.** Staff writes card details on the paper slip (existing process). The paper slip is the PCI-scoped artifact. Atlas never touches card data.
- **B. Tokenized payment.** Integrate with a payment processor (Stripe, Square) that handles PCI compliance. Atlas stores only a token reference, never raw card numbers.
- **C. "Card on file" flag.** Atlas records "deposit method: card" as a tag on the event but stores NO card details. Staff handles the card manually via the POS terminal.

**Recommendation:** Start with **C** (flag-only). It's zero PCI scope for Atlas. Upgrade to B later if volume justifies the Stripe integration cost.

**Files:** Add `deposit_method` enum to events schema, surface in checkout form
**Effort:** Small (C) / Large (B)

#### L2.3 — Return policy formalization
Admin-configurable return policy text that appears on:
- The digital agreement (L2.1)
- The paper checkout slip footer
- The kiosk checkout success screen
- Automated overdue reminder emails (L2.4)

Stored as `ops.app_config` key: `equipment.return_policy_text`.

**Files:** Config seed, surface in 4 locations
**Effort:** Small

#### L2.4 — Automated return reminders
When due date approaches (configurable: 1 day before, day-of, 1 day after), send an email/text to the borrower:
- "Your trap is due back tomorrow"
- "Your trap was due today — please return it"
- Escalation after N days: alert staff via `ops.alert_queue`

Requires: email infrastructure (FFS-1181 is building this), phone number on file, person linked to the checkout.

**Files:** Cron route, email template, alert integration
**Effort:** Medium-Large (depends on email infra readiness)

---

### Layer 3 — Integration & Intelligence (build after Layers 1-2)

The connective tissue that makes equipment part of the broader Atlas/Beacon intelligence layer.

#### L3.1 — Future appointment ingest
Today: the clinic doesn't push future appointments to Atlas (only past/completed ones via ClinicHQ batch ingest). The equipment system infers due dates from purpose + offset, not from actual appointment dates.

When future appointment ingest is built (separate infrastructure project), the equipment system should:
- Auto-link checkouts to the next appointment for that person/place
- Adjust due dates based on actual appointment dates
- Surface "this person's appointment is in 3 days and they still have the trap" in the admin view

**Depends on:** ClinicHQ forward-appointment ingest infra
**Effort:** Medium (once the ingest exists)

#### L3.2 — "Still trying to trap" vs "not responding" differentiation
When someone is overdue, staff needs to know: are they actively trying (cat hasn't gone in the trap) or have they gone silent? Today there's no way to distinguish.

Options:
- **A. Self-service check-in via text/email:** "Your trap is overdue. Reply TRYING if you're still working on it, or RETURN if you're bringing it back." Response updates the event log.
- **B. Staff manual tag:** Admin UI button on the overdue alert: "Mark as still trying" / "Mark as non-responsive." Stored as a status on the event or a new tracking field.

**Recommendation:** Start with **B** (manual tag). Automated text response (A) is nice but requires Twilio integration.

**Files:** New status field or note type, admin overdue UI enhancement
**Effort:** Medium

#### L3.3 — Equipment linked to cats via waivers
The waiver ingest pipeline (FFS-1087 family) sometimes records which trap a cat arrived in. When that data is available, link the cat record to the equipment record so staff can see "Trap 0106 brought in 3 cats this month."

**Depends on:** Waiver ingest pipeline (FFS-1087)
**Effort:** Small (once waiver data is flowing)

#### L3.4 — Equipment section on person/place/cat detail pages
Cross-link equipment throughout the app:
- **Person detail:** "Currently holding: Trap 0106 (checked out 4/3), Transfer Cage 0301 (checked out 4/8)"
- **Place detail:** "Equipment deployed here: 2 traps, 1 camera"
- **Cat detail:** "Arrived in Trap 0106 on 4/5 (from waiver scan)"

**Files:** New sections in person/place/cat detail components
**Effort:** Medium

---

## Implementation Order

```
IMMEDIATE (before transfer cages arrive):
  L1.1 — Fix "free spay/neuter" text               [30 min]
  L1.2 — Verify transfer cage type readiness        [30 min]

NEXT SESSION:
  L1.3 — Deposit ledger view                        [2-3 hrs]
  L1.5 — Person-equipment view on detail pages      [2-3 hrs]

FOLLOWING SESSION:
  L1.4 — Overdue alert automation                   [3-4 hrs]
  L2.1 — Digital checkout agreement                  [4-6 hrs]
  L2.3 — Return policy formalization                 [1-2 hrs]

LATER (after email infra matures):
  L2.2 — Card info handling (flag-only first)        [1-2 hrs]
  L2.4 — Automated return reminders                  [4-6 hrs]

AFTER INFRASTRUCTURE:
  L3.1 — Future appointment ingest integration
  L3.2 — "Still trying" vs "not responding"
  L3.3 — Equipment linked to cats via waivers
  L3.4 — Cross-entity equipment sections
```

---

## Key Design Decisions for Ben

1. **Digital waiver: kiosk-native (typed name + timestamp) vs third-party signing?**
   Recommend kiosk-native. Faster, no vendor dependency, legally sufficient for this value range.

2. **Card info: never-store (C) vs tokenized (B)?**
   Recommend never-store (C) first. Zero PCI scope. Upgrade to Stripe tokenization later if volume justifies.

3. **Overdue differentiation: manual staff tag (B) vs automated text response (A)?**
   Recommend manual tag (B) first. Staff knows the context. Text automation later.

4. **Future appointment ingest: block on this or proceed without?**
   Proceed without — the equipment system calculates due dates from purpose offsets today, which is sufficient. Future appointment data improves accuracy but isn't a blocker.

---

## Linear Issues to Create

| ID | Layer | Title | Priority | Labels |
|----|-------|-------|----------|--------|
| — | L1.1 | Fix "free spay/neuter" text on kiosk (should be $50 donation) | Urgent | Kiosk |
| — | L1.2 | Verify transfer cage equipment type readiness | High | Equipment |
| — | L1.3 | Equipment deposit ledger view (outstanding deposits dashboard) | High | Equipment |
| — | L1.4 | Overdue equipment alert automation (cron + alert queue) | Medium | Equipment |
| — | L1.5 | Person/place detail pages — equipment section | Medium | Equipment, Frontend |
| — | L2.1 | Digital checkout agreement / waiver (kiosk-native) | High | Equipment, Kiosk |
| — | L2.2 | Deposit method tracking (card-on-file flag, no PCI) | Medium | Equipment |
| — | L2.3 | Return policy text formalization (admin-configurable) | Medium | Equipment |
| — | L2.4 | Automated return reminder emails | Medium | Equipment |
| — | L3.1 | Future appointment ↔ equipment linkage | Low | Equipment, Clinic |
| — | L3.2 | Overdue differentiation: still-trying vs non-responsive | Low | Equipment |
| — | L3.3 | Cat ↔ equipment linkage via waiver data | Low | Equipment |
| — | L3.4 | Cross-entity equipment sections (person/place/cat) | Low | Equipment, Frontend |

Plus an EPIC issue to track all of these.
