#!/usr/bin/env node
/**
 * Import Knowledge Base Articles
 *
 * This script imports initial knowledge base content for Tippy AI.
 * Run with: node scripts/import-knowledge.mjs
 */

import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Initial knowledge base articles based on training documents
const ARTICLES = [
  // Training Manual Content
  {
    title: "History of FFSC Trapping Program",
    slug: "history-of-ffsc-trapping-program",
    summary: "Background on Forgotten Felines trapping program and how it evolved over the years.",
    category: "training",
    access_level: "staff",
    keywords: ["history", "background", "origins", "program"],
    content: `# History of FFSC Trapping Program

Forgotten Felines of Sonoma County (FFSC) has been working to help community cats through TNR (Trap-Neuter-Return) since its founding.

## Program Evolution

The trapping program has grown from a small volunteer effort to a coordinated operation with trained trappers, clinic partnerships, and data-driven approaches to colony management.

## Key Milestones

- Establishment of regular clinic days (Mon/Wed/Thu)
- Development of trapper training curriculum
- Implementation of the Atlas data system for tracking
- Launch of the Beacon ecological metrics dashboard

## Current Structure

Today, the program includes:
- **Head Trappers**: Experienced volunteers who lead operations
- **FFSC Trappers**: Trained volunteers who represent FFSC
- **Community Trappers**: Individuals who trap with guidance but don't represent FFSC
- **Coordinators**: Staff who manage scheduling and logistics
`,
  },

  {
    title: "Trapper Training Requirements",
    slug: "trapper-training-requirements",
    summary: "Requirements for becoming an FFSC trapper and the training process.",
    category: "training",
    access_level: "volunteer",
    keywords: ["training", "requirements", "certification", "trapper"],
    content: `# Trapper Training Requirements

## Becoming an FFSC Trapper

To become an official FFSC trapper, volunteers must complete the following:

### 1. Orientation Session
- Overview of FFSC mission and values
- Introduction to TNR principles
- Understanding cat behavior and welfare

### 2. Field Training
- Shadow an experienced trapper on at least 2 outings
- Learn trap setup, baiting, and placement
- Practice safe cat handling

### 3. Equipment Training
- Humane trap operation
- Transfer cage use
- Transport safety

### 4. Documentation
- Sign trapper agreement
- Complete liability waiver
- Register in Atlas system

## Ongoing Requirements

- Follow all FFSC protocols
- Report all trapping activities
- Maintain equipment in good condition
- Participate in refresher training as needed

## Types of Trappers

| Type | Description | Represents FFSC? |
|------|-------------|------------------|
| Coordinator | FFSC staff coordinator | Yes |
| Head Trapper | Experienced lead trapper | Yes |
| FFSC Trapper | Trained volunteer | Yes |
| Community Trapper | Contract-only, limited scope | No |
`,
  },

  {
    title: "Setting Traps Safely",
    slug: "setting-traps-safely",
    summary: "Step-by-step guide for safely setting humane cat traps.",
    category: "procedures",
    access_level: "volunteer",
    keywords: ["traps", "setup", "procedure", "safety", "humane"],
    content: `# Setting Traps Safely

## Before You Start

1. **Survey the area** - Look for:
   - Safe, flat surfaces for trap placement
   - Shelter from weather
   - Signs of cat activity (paw prints, food bowls, etc.)

2. **Check your equipment**
   - Trap door mechanism works smoothly
   - No sharp edges or damage
   - Trip plate is sensitive but not too light

## Trap Placement

### Good Locations
- Near feeding stations
- Along cat pathways (walls, fences)
- Sheltered from wind and rain
- Away from traffic and dogs

### Bad Locations
- Direct sunlight
- Near busy roads
- Inside buildings without permission
- Areas with dog access

## Setting the Trap

1. Place trap on flat, stable surface
2. Open rear door (if equipped)
3. Line bottom with newspaper (optional, helps cats feel secure)
4. Place bait at back of trap past trip plate
5. Set trip mechanism
6. Ensure door opens and closes freely
7. Cover trap with dark cloth leaving front entrance open

## Baiting Tips

- Wet food with strong smell works best (tuna, sardines)
- Don't overfeed area before trapping
- Time withholding food appropriately (12-24 hours)
- Small amount of bait - you want them to go IN for it

## After Setting

- Note trap location (GPS or description)
- Set a timer - check traps every 2-4 hours
- Never leave traps overnight without monitoring plan
- Have transport carrier ready
`,
  },

  {
    title: "Handling No-Feeding Policy Objections",
    slug: "handling-no-feeding-policy-objections",
    summary: "How to respond when property owners or managers want to stop feeding community cats.",
    category: "talking_points",
    access_level: "staff",
    keywords: ["objections", "feeding", "policy", "talking points", "property manager"],
    content: `# Handling No-Feeding Policy Objections

## Common Scenario

Property managers, HOAs, or neighbors often want to implement "no feeding" policies believing it will solve cat problems. Here's how to explain why this approach doesn't work.

## Key Talking Points

### 1. Feeding Bans Don't Remove Cats

"No-feeding policies might seem like a solution, but they don't actually remove cats from the area. Cats are territorial and will stay in their home range even without food being provided. They'll simply:
- Hunt more wildlife
- Dig through garbage
- Become more visible searching for food
- Move to neighboring properties"

### 2. Feeding Enables TNR Success

"When cats are fed reliably, we can:
- Accurately count the population
- Trap them efficiently for spay/neuter
- Ensure they're healthy enough for surgery
- Return them to a stable, managed situation"

### 3. Managed Colonies Benefit Everyone

"A properly managed cat colony with a dedicated caretaker actually reduces problems:
- Altered cats don't reproduce (population stabilizes then declines)
- They don't yowl or spray as much
- They keep new strays away from territory
- One feeder means less mess than random garbage digging"

### 4. The Vacuum Effect

"Removing or starving out cats creates a 'vacuum effect.' New unaltered cats will quickly move in to claim the resources. You end up with the same problems plus new breeding cats."

## Suggested Approach

1. **Acknowledge concerns**: "I understand you're dealing with a frustrating situation."

2. **Offer partnership**: "We can work together to reduce the population humanely and permanently."

3. **Propose a plan**: "Let us help trap and alter these cats. Within 6 months you'll see improvement."

4. **Offer ongoing support**: "We can help establish a responsible caretaker system with scheduled feeding."

## If They're Firm on No-Feeding

- Ask for time: "Can we have 30 days to trap and alter the current cats before the policy takes effect?"
- Offer documentation: "We'll provide records of all cats altered."
- Suggest a trial: "Let's try our approach for 3 months and measure the results."
`,
  },

  {
    title: "Objection Handling: Property Owner Concerns",
    slug: "objection-handling-property-owners",
    summary: "Scripts for addressing common property owner objections to TNR programs.",
    category: "talking_points",
    access_level: "staff",
    keywords: ["objections", "property owner", "landlord", "talking points", "complaints"],
    content: `# Property Owner Objection Handling

## "Just remove the cats"

**Response:**
"I understand you want the cats gone. Here's why removal doesn't work long-term:

1. **It's not legal or practical** to remove outdoor cats in most cases
2. **Shelters are overcrowded** and can't accept healthy community cats
3. **The vacuum effect** means new cats quickly fill empty territory
4. **TNR is the proven solution** - we alter the existing cats so the population naturally declines over time

Our approach: We trap, neuter/spay, and return the current cats. They keep their territory but can't reproduce. In 2-3 years, you'll have significantly fewer cats."

## "I don't want cats returned to my property"

**Response:**
"That's a common concern. Here's what happens when cats are returned:

1. **Altered cats are calmer** - no more mating behaviors, fighting, or spraying
2. **They're already adapted** to the location and won't cause new problems
3. **They prevent new cats** from moving in
4. **The population shrinks naturally** as older cats pass on

If we remove them, unaltered cats will immediately take their place and you'll have breeding, yowling, and spraying again."

## "Why can't you trap faster?"

**Response:**
"We're working as quickly as we can while ensuring quality outcomes. Here's our process:

1. **Assessment first** - We need to know how many cats and their patterns
2. **Coordinate with caretakers** - We work with anyone already feeding
3. **Clinic capacity** - We can only alter as many cats as our vets can handle
4. **Weather and timing** - Some conditions make trapping unsafe

We typically see significant progress within 30-60 days for most colonies."

## "I've tried everything"

**Response:**
"I hear you - this can be really frustrating. Can you tell me what you've tried?

[Listen to their experiences]

Here's what makes our approach different:
- We have trained trappers with professional equipment
- We coordinate with veterinary clinics for same-day surgery
- We track every cat in our database
- We follow up to ensure the colony stabilizes

Would you be willing to let us try our process?"
`,
  },

  {
    title: "Handling Kittens During Trapping",
    slug: "handling-kittens-during-trapping",
    summary: "Procedures for safely handling kittens encountered during TNR operations.",
    category: "procedures",
    access_level: "volunteer",
    keywords: ["kittens", "babies", "young cats", "procedure"],
    content: `# Handling Kittens During Trapping

## Age Assessment

Kittens' needs vary dramatically by age:

| Age | Weight | Eyes | Mobility | Action |
|-----|--------|------|----------|--------|
| 0-2 weeks | <8 oz | Closed or just opening | Crawling | Leave with mom if possible |
| 2-4 weeks | 8-12 oz | Open, blue | Wobbly walking | Need mom or foster |
| 4-8 weeks | 12 oz - 1.5 lb | Color changing | Walking/playing | Socialization window |
| 8+ weeks | 1.5+ lb | Adult color | Running/climbing | Approaching alter weight |

## Decision Tree

### Nursing Kittens (Under 4 weeks)
1. **Is mom nearby?** If yes, leave kittens and trap mom separately
2. **Is mom trapped with kittens?** Keep together, transport to foster
3. **Orphaned?** Contact coordinator immediately for foster placement

### Weaning Age (4-8 weeks)
1. Can often be socialized and adopted
2. Prioritize foster placement
3. If truly feral at 8 weeks, may need to treat as adult

### Alter-Ready (8+ weeks, 2+ lbs)
1. Can be spayed/neutered
2. If friendly: adopt out
3. If feral: TNR protocol

## Important Guidelines

- **Never separate nursing kittens from mom** unless mom is clearly absent for 8+ hours
- **Kittens need warmth** - provide heating pad on low
- **Dehydration is dangerous** - watch for lethargy, sunken eyes
- **Contact coordinator** before making decisions about young kittens

## Emergency Contacts

If you encounter kittens during trapping:
1. Call coordinator immediately
2. Take photos and note location
3. Monitor for mom's return (observe from distance)
4. Prepare for possible foster transport
`,
  },

  {
    title: "Ear Tipping Guidelines",
    slug: "ear-tipping-guidelines",
    summary: "Information about ear tipping - the universal sign of a TNR'd cat.",
    category: "procedures",
    access_level: "public",
    keywords: ["ear tip", "identification", "TNR", "altered"],
    content: `# Ear Tipping Guidelines

## What is an Ear Tip?

An ear tip is the universal symbol that a community cat has been spayed or neutered through a TNR (Trap-Neuter-Return) program. It involves removing approximately 3/8 inch from the tip of the left ear while the cat is under anesthesia.

## Why Ear Tip?

1. **Prevents re-trapping** - Easy visual identification from a distance
2. **Confirms altered status** - Even without records, the ear tip tells the story
3. **Saves resources** - No need to trap, transport, and anesthetize already-altered cats
4. **Protects the cat** - Reduces stress of repeated handling

## Important Facts

- **Done under anesthesia** - The cat feels no pain
- **Heals quickly** - Just a few days
- **Permanent and visible** - Unlike microchips, can be seen without scanning
- **Standard practice** - Recognized by animal welfare organizations worldwide
- **Left ear** - Universal standard (though some regions historically used right)

## What Ear Tips Mean for Our Work

When you see an ear-tipped cat:
- They've been through a TNR program
- They don't need to be trapped again
- They're part of a managed colony
- Document but don't re-trap

## Ear Tip vs Other Markings

| Marking | What It Means |
|---------|---------------|
| Ear tip (left) | TNR'd - altered |
| Ear notch (various) | Older or regional marking |
| Collar | May have owner |
| Microchip | Requires scanner to detect |

If you're unsure about a cat's status, it's better to trap and have the vet check than to assume.
`,
  },

  {
    title: "FFSC Trapping Equipment Checklist",
    slug: "ffsc-trapping-equipment-checklist",
    summary: "Essential equipment needed for TNR trapping operations.",
    category: "equipment",
    access_level: "volunteer",
    keywords: ["equipment", "supplies", "checklist", "trapping"],
    content: `# FFSC Trapping Equipment Checklist

## Essential Trapping Supplies

### Traps
- [ ] Humane box traps (one per cat expected)
- [ ] Trap covers (dark towels or sheets)
- [ ] Trap dividers (for transferring)
- [ ] Drop traps (for hard-to-catch cats)

### Bait
- [ ] Wet food (strong-smelling: tuna, sardines, mackerel)
- [ ] Spoon or fork for bait
- [ ] Paper plates
- [ ] Water bowl

### Transport
- [ ] Transfer cages
- [ ] Newspaper for cage lining
- [ ] Plastic sheeting for vehicle protection
- [ ] Tie-downs or straps

### Safety & Comfort
- [ ] Heavy work gloves
- [ ] Flashlight/headlamp
- [ ] First aid kit
- [ ] Hand sanitizer
- [ ] Trash bags

### Documentation
- [ ] Phone (photos, GPS)
- [ ] Trap tags/labels
- [ ] Marker for writing
- [ ] Colony tracking sheet

## Optional but Helpful

- Laser pointer (for cat direction)
- Cat treats
- Portable scale
- Catch pole (advanced users only)
- Remote trap triggers

## Pre-Trip Checklist

Before leaving:
1. All trap doors working smoothly?
2. Enough bait for expected cats?
3. Vehicle prepped for transport?
4. Coordinator knows your plan?
5. Phone charged?

## Post-Trip

- Clean all traps with mild soap
- Check for damage
- Restock supplies
- Report to coordinator
`,
  },

  {
    title: "What to Do If You Find an Injured Cat",
    slug: "injured-cat-procedure",
    summary: "Emergency procedures when encountering an injured community cat.",
    category: "troubleshooting",
    access_level: "public",
    keywords: ["injured", "emergency", "hurt", "sick", "veterinary"],
    content: `# What to Do If You Find an Injured Cat

## Immediate Assessment

### Is it an emergency?
Signs requiring IMMEDIATE veterinary care:
- Visible wounds or bleeding
- Difficulty breathing
- Unable to stand or walk
- Obvious broken limbs
- Hit by car
- Unconscious or unresponsive

### For Emergencies
1. **Contain safely** - Use a carrier, box, or towel to gently secure the cat
2. **Minimize handling** - Injured cats may bite or scratch
3. **Keep warm** - Cover with towel, keep in calm dark space
4. **Call for help**:
   - FFSC Coordinator: [number]
   - Emergency Vet: [number]
   - Sonoma County Animal Services: [number]

## Non-Emergency Concerns

Signs to monitor but not immediately critical:
- Limping but bearing weight
- Sneezing or watery eyes
- Thin but eating
- Scruffy coat

For these cases:
1. Document with photos
2. Note location and any identifying features
3. Report to FFSC coordinator
4. Monitor the situation

## Important Guidelines

### DO
- Approach slowly and calmly
- Speak softly
- Use a towel to pick up if needed
- Keep in quiet, dark space during transport

### DON'T
- Corner a frightened cat
- Force handling if cat is defensive
- Move a cat with possible spinal injury
- Delay getting emergency care

## Colony Cat vs Lost Pet?

If the cat might be someone's pet:
- Check for collar/tags
- Take to vet for microchip scan
- Post on local lost pet pages
- Contact animal services

Ear-tipped cats are community cats from a TNR program.
`,
  },

  {
    title: "Frequently Asked Questions - TNR Basics",
    slug: "tnr-basics-faq",
    summary: "Common questions about Trap-Neuter-Return and FFSC's approach.",
    category: "faq",
    access_level: "public",
    keywords: ["faq", "questions", "tnr", "basics", "common"],
    content: `# TNR Basics - Frequently Asked Questions

## What does TNR mean?

TNR stands for **Trap-Neuter-Return**. It's the humane and effective approach to managing community cat populations:
1. **Trap** cats humanely
2. **Neuter/Spay** them at a clinic
3. **Return** them to their home territory

## Why return the cats?

- Altered cats are calm, don't reproduce, and keep new cats away
- Removing cats creates a "vacuum effect" - new cats move in
- Cats are adapted to their location and have caretakers
- It's more humane than lethal methods

## How long until we see results?

- **Immediate**: Reduced yowling, spraying, fighting (mating behaviors stop)
- **6-12 months**: No new kittens, stable population
- **2-5 years**: Significant population decline through natural attrition

## Can I just trap and remove the cats?

In most cases, no:
- Shelters won't accept healthy community cats
- Relocation is traumatic and often fails
- New cats quickly fill the vacancy
- TNR provides lasting, humane results

## What about the wildlife?

Studies show:
- Managed colonies have less wildlife impact than unmanaged
- Feeding cats makes them hunt less
- Population decline over time means fewer cats
- We support keeping cats in enclosures when possible

## How do I know if a cat has been TNR'd?

Look for an **ear tip** - a straight line across the tip of the left ear. This is the universal sign of an altered community cat.

## What if I can't afford to help?

FFSC provides:
- Free spay/neuter for community cats
- Loaner traps
- Training and support
- Low-cost options for owned cats

## How can I help?

- Become a volunteer trapper
- Foster kittens or friendly cats
- Donate to support our programs
- Help with transport
- Spread the word about humane TNR
`,
  },
];

async function importArticles() {
  console.log("Connecting to database...");
  await client.connect();

  console.log(`\nImporting ${ARTICLES.length} knowledge base articles...\n`);

  let imported = 0;
  let skipped = 0;

  for (const article of ARTICLES) {
    try {
      // Check if article already exists
      const existing = await client.query(
        `SELECT article_id FROM trapper.knowledge_articles WHERE slug = $1`,
        [article.slug]
      );

      if (existing.rows.length > 0) {
        console.log(`  SKIP: ${article.title} (already exists)`);
        skipped++;
        continue;
      }

      // Insert article
      await client.query(
        `
        INSERT INTO trapper.knowledge_articles (
          title, slug, summary, content, category, access_level,
          keywords, is_published, source_system
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'manual')
        `,
        [
          article.title,
          article.slug,
          article.summary,
          article.content,
          article.category,
          article.access_level,
          article.keywords,
        ]
      );

      console.log(`  OK: ${article.title}`);
      imported++;
    } catch (error) {
      console.error(`  ERROR: ${article.title}:`, error.message);
    }
  }

  console.log(`\nImport complete: ${imported} imported, ${skipped} skipped`);

  await client.end();
}

importArticles().catch(console.error);
