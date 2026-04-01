# Tippy Triage Research — FFS-1060

Research foundations for designing the Tippy kiosk help form. Compiled 2026-03-31.

---

## 1. Veterinary Triage Standards (Adapted for Public Use)

Veterinary ERs use a **5-level triage system** (VECCS / Silverstein & Hopper). For Tippy, we simplify to **3 public-facing tiers** since users aren't trained clinicians:

### Tier 1: EMERGENCY — Go to a vet NOW
Observable by anyone without equipment:
- **Open-mouth breathing** (cats NEVER pant normally — this is respiratory failure)
- White/blue/gray gums
- Seizures, unresponsive, sudden paralysis of back legs
- Male cat straining to urinate with no output >12 hours
- Hit by car or fall from height (even if "seems fine")
- Active bleeding that won't stop with pressure
- Known ingestion of: lily, antifreeze, rat poison, dog flea product, Tylenol
- Straining to deliver kitten >1 hour with no progress

### Tier 2: URGENT — Needs a vet within 24-48 hours
- Cat hasn't eaten in 48+ hours (hepatic lipidosis risk)
- Cat hiding and won't come out (unusual behavior = masking illness)
- First seizure (even if cat "seems fine now")
- Eye injury, bite wounds, fever
- Persistent vomiting >24 hours

### Tier 3: CAN WAIT — Schedule appointment
- Limping but weight-bearing, eating normally
- Single vomiting episode, sneezing with clear discharge
- Small wound that stopped bleeding, ear scratching
- Lumps not rapidly growing, chronic weight loss

### Critical Public Education Gap
**Cats hide illness.** By the time a cat SHOWS symptoms to a casual observer, the condition is often advanced. The #1 thing the public misses: **open-mouth breathing in cats is a life-threatening emergency.** The #1 thing the public over-reacts to: kittens found outside (mother is usually nearby — observe 4-8 hours before intervening).

### Public Decision Flowchart (for Tippy form logic)
```
Is the cat breathing with mouth open? → EMERGENCY
Is the cat conscious and responsive? → No → EMERGENCY
Can the cat walk normally? → Sudden back leg paralysis → EMERGENCY
Has male cat urinated in 12 hours? → No + straining → EMERGENCY
Did cat eat/contact something toxic? → EMERGENCY
Active bleeding that won't stop? → EMERGENCY
Has cat eaten in 48 hours? → No → URGENT
Cat hiding, won't come out (unusual)? → URGENT
Otherwise → SCHEDULE APPOINTMENT
```

---

## 2. TNR Priority Frameworks

### The 75% Sterilization Threshold

The dominant finding across all research: **TNR only reduces populations when sterilization exceeds ~70-75% of the colony.**

| Sterilization Rate | Population Effect | Source |
|---|---|---|
| < 50% | Minimal impact | Boone et al. 2019 |
| 50-70% | Stabilizes but may not decline | Boone et al. 2019 |
| > 70-75% | Population declines | Boone 2019, Gunther 2022 |
| > 90% | Near-elimination (SF Bay: 175 → 1 cat over 16 years) | Johnson & Cicirelli 2014 |

**Boone et al. (2019)** modeled 10-year outcomes: high-intensity TNR (75%) produced **31x fewer cumulative deaths** than no action. Low-intensity TNR (25%) was still 3.5x better than no action but "lifesaving advantages become much less compelling."

### Geographic Contiguity Is Non-Negotiable

**Gunther et al. (2022, PNAS)** — 12-year field study, 13,718 observations, 22,144 cats neutered:
- Areas with **80% sterilization** showed NO population decline when neighboring areas were untreated
- Immigration from untreated areas completely offset sterilization gains
- Population decline only occurred with **>70% neutering applied contiguously across the entire area**
- Compensatory reproduction: kitten-to-queen ratio increased 2.25x in treated areas

**Implication for Beacon:** Isolated colony treatment is futile. Atlas must identify geographic clusters and treat contiguous zones together. This is the core argument for targeted FFR over reactive response.

### Targeted TNR Evidence

**Levy et al. (2014)** — Selected single ZIP code with highest shelter intake:
- 57-64 TNR surgeries per 1,000 residents over 2 years
- **69% reduction in shelter intake, 95% reduction in shelter killing**
- Non-target areas: 3.5x higher intake, 17.5x higher euthanasia
- Method: Hired neighborhood resident for door-to-door outreach

### Colony Priority Scoring Factors (ranked by impact)

1. **Sterilization gap** — `(1 - ear_tipped_rate)` × colony size = surgeries needed to reach threshold
2. **Geographic contiguity** — Adjacent to other untreated colonies? Cluster treatment is essential
3. **Growth trajectory** — Stable colony vs. growing colony (new cats arriving)
4. **Kitten presence** — Reproductive urgency, especially pre-kitten-season (Feb-Sep)
5. **Complaint urgency** — Animal control called, hostile neighbors, risk of harm
6. **Caretaker cooperation** — Consistent feeder = easier trapping
7. **Colony accessibility** — Property access, dogs on-site, overnight trapping safe

### Questions Atlas Doesn't Yet Capture (Research Gaps)
- Are new cats arriving / is the colony growing? (growth trajectory)
- Are there pregnant cats visible? (immediate urgency)
- Are any cats visibly sick or injured? (medical urgency)
- Is there community opposition to the cats? (risk of harm)
- Has animal control been called? (removal risk)

---

## 3. FFSC Clinic Capacity Context

The form must implicitly account for clinic constraints when routing and prioritizing:

| Resource | Capacity | Variable |
|---|---|---|
| Clinic days | Monday + Wednesday | Fixed |
| Total cats per day | 40-50 | Hard ceiling |
| Spay vet | 20-25 spays | ~50% pregnancy rate reduces throughput |
| Neuter vet | 15-30 neuters | Kittens vs. large adults affects speed |
| Wellness checks | 5-8 per day | Severity dependent |

**Targeted FFR competes with public demand for the same clinic slots.** The form's routing decisions directly affect this balance — every pet owner redirected to Sonoma Humane/Love Me Fix Me frees a slot for a colony cat.

---

## 4. Sonoma County Resource Directory (for Tippy routing)

### FFSC (Internal — FFR Pipeline)
- **Address:** 1814 Empire Industrial Court, Suite F, Santa Rosa, CA 95404
- **Phone:** (707) 576-7999
- **Hours:** Mon-Thu 9AM-5PM, Clinic days Mon/Wed
- **Covers:** Community/feral cat spay/neuter, vaccinations, ear-tipping, trap loans
- **Pricing:** $50 donation (you bring cat), $100 (FFSC sends trapper)
- **Does NOT cover:** Owned pet spay/neuter, emergency care, general vet medicine, dogs

### Emergency Veterinary (24hr)

| Hospital | Address | Phone | Hours |
|---|---|---|---|
| **VCA PetCare East** | 2425 Mendocino Ave, Santa Rosa | (707) 579-3900 | 24/7/365 |
| **TruVet Specialty & Emergency** | 2620 Lakeville Hwy, Bldg D, Petaluma | (707) 787-5340 | 24/7/365 |
| **Emergency Animal Hospital of SR** | 1946 Santa Rosa Ave | (707) 542-4012 | After-hours only (weekday 6PM-8AM, weekends 24hr) |

### Pet Spay/Neuter (Redirect targets)

| Program | Eligibility | Contact |
|---|---|---|
| **Humane Society of Sonoma County** | Must be 18+, Sonoma County resident, income-qualified | (707) 284-3499 |
| **Love Me Fix Me** (County Animal Services) | Low-income Santa Rosa / unincorporated Sonoma County, up to 2 vouchers/yr | (707) 565-7100 |
| **Pets Lifeline** (Sonoma Valley) | Low-income Sonoma Valley residents | (707) 996-4577 |
| **Esperanza Truck** (mobile) | Low-income communities, bilingual, first-come first-served | (707) 474-3345 |
| **Rohnert Park Animal Shelter** | Low-income Rohnert Park/Cotati residents, free monthly clinics | (707) 588-3531 |

### Other Cat Resources

| Org | Services | Contact |
|---|---|---|
| **Sonoma County Animal Services** | Animal control, stray intake, lost/found | (707) 565-7100 |
| **Twenty Tails Rescue** | Cat rescue, TNR, barn cat program | meow@twentytailsrescue.org |
| **Dogwood Animal Rescue** | Free/low-cost spay/neuter for rural areas | (707) 799-9957 |

---

## 5. Form UX Principles (for target audience)

### Audience Profile
Primary users: Women 55+, passionate about cats, low technical skill, high motivation. Willing to fill out a form if it gets them help.

### Research-Backed Design Rules

| Dimension | Recommendation | Source |
|---|---|---|
| **Flow** | One question per screen, progressive disclosure | GOV.UK GDS: +20-30% completion rates |
| **Question count** | 5-7 max (kiosk = standing, 2min session) | Burke 2014: abandonment spikes at 3min |
| **Font size** | 22-28px questions, 18-20px buttons/helpers | NNG 2019: seniors need 1.5x standard size |
| **Touch targets** | 60px minimum, 72px preferred, full-width buttons | MIT Touch Lab + Fisk 2009: -40% error rate |
| **Contrast** | 7:1+ (WCAG AAA), dark on light | Age-related contrast sensitivity loss |
| **Input method** | Tap-to-select over typing, multiple choice only | Phreesia: 3-4x faster, fewer errors |
| **Language** | Grade 5-6 reading level, no jargon, 15 words/sentence max | AHRQ 2010: 36% adults have basic health literacy |
| **Progress** | Visible bar with step count ("Step 2 of 5") | NNG 2015: reduces abandonment anxiety |
| **Scrolling** | None — paginate instead | Kiosk users don't discover scroll |
| **Persona** | Warm + professional ("Let's figure out how to help!") | Nass & Moon 2000: +10-15% completion |
| **Help escape** | Visible "Ask for help" on every screen | Reduces anxiety, improves confidence |

### Optimal Pattern: Conversational Hybrid

Research converges on **conversational flow with form controls** — not a pure chatbot:
1. One question at a time with friendly contextual text from Tippy
2. Proper form controls (big buttons, selectors) — not free-text input
3. Progress indicator visible throughout
4. Review/confirmation screen before submission
5. "I need more time" button if session timeout triggers

### Key Don'ts
- No icons without labels (older adults don't know icon conventions)
- No swipe, drag-and-drop, or long-press gestures — tap only
- No auto-advancing screens or countdown timers during selection
- No clearing form data on error (extreme frustration)
- No ALL CAPS for body text (13-18% slower to read)
- No "TNR" or "FFR" in user-facing text — say "spay/neuter program" or "fix"

---

## 6. Recommended Tippy Form Structure

Based on all research, the form should follow this branching flow:

### Screen 1: Greeting + Situation Type (Root)
> "Hi! I'm Tippy! I'm here to help you with your cat situation. Which best describes what's going on?"

- Stray or outdoor cat(s) at my home → Branch A
- I found an injured or sick cat → Branch B (emergency check)
- I want to get my pet fixed → Branch C (pet redirect)
- I'm feeding a group of cats → Branch A (colony variant)
- Kittens! → Branch D (kitten triage)
- Something else → Branch E (general info)

### Branch A: Colony/Stray Assessment (3-4 screens)
Extracts: cat count, duration, kittens present, ear-tips observed, growth trajectory, address

### Branch B: Emergency Triage (1-2 screens)
Uses the decision flowchart from Section 1. Routes to 24hr vet if true emergency.

### Branch C: Pet Owner Redirect (1-2 screens)
Indoor only → resource cards for Sonoma Humane / Love Me Fix Me.
Indoor/outdoor + feeding strays → HYBRID: redirect pet + create FFR request for strays.

### Branch D: Kitten Assessment (2-3 screens)
Age, mother present, indoor/outdoor, how many. Routes appropriately.

### Branch E: General → Contact info + resource page

### Final Screen: Outcome
- FFR-eligible → "We'll get this into our system! Here's what happens next..."
- Emergency → "Please go to [vet name] immediately. Here's the address..."
- Pet redirect → "Great news! [Program] can help with that. Here's how to reach them..."

---

## Sources

### Veterinary Triage
- VECCS triage classification standards
- Silverstein & Hopper, *Small Animal Emergency and Critical Care Medicine*
- ASV *Guidelines for Standards of Care in Animal Shelters* (2010)
- UC Davis Koret Shelter Medicine Program (sheltermedicine.vetmed.ucdavis.edu)
- ASPCA Animal Poison Control Center (888-426-4435)

### TNR Research
- Boone et al. (2019) "A Long-Term Lens" — *Frontiers in Veterinary Science* 6:238
- Gunther et al. (2022) "Spatial Contiguity Required" — *PNAS* 119(15)
- Levy et al. (2014) "Targeted TNR Reduces Feline Intake" — *The Veterinary Journal*
- Johnson & Cicirelli (2014) "SF Bay Trail 16-Year TNR Study" — PMC 7698188
- Alley Cat Allies Colony Care Guide / TNR Research Compendium
- Neighborhood Cats TNR Handbook

### Form UX
- Nielsen Norman Group: "Usability for Seniors" (2013, updated 2019)
- GOV.UK Design System: "One thing per page" pattern
- Czaja & Sharit: *Designing for Older Adults* (2012)
- Fisk et al.: *Designing for Older Adults* (2009)
- MIT Touch Lab: "Human Fingertips" (Dandekar et al.)
- WCAG 2.1/2.2 (W3C)
- Nass & Moon: "Machines and Mindlessness" (2000)
- Phreesia patient intake design patterns

### Sonoma County Resources
- Forgotten Felines of Sonoma County (forgottenfelines.com)
- Humane Society of Sonoma County (humanesocietysoco.org)
- Love Me Fix Me Voucher Program (sonomacounty.gov)
- Sonoma County Animal Services (sonomacounty.gov)
