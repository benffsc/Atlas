# Tippy Showcase Questions

**For FFSC Board Presentation - February 2026**

These 20 questions are designed to demonstrate Tippy's strategic reasoning capabilities for TNR operations. Each question showcases a different aspect of AI-assisted data analysis.

---

## Strategic Resource Allocation

### 1. "Which city in Sonoma County has the most unaltered cats, and what does that tell us?"
*Demonstrates: City-level analysis with nuanced interpretation*

Expected reasoning: Tippy will identify the city with highest counts but caveat that cities with NO data might actually be worse - they could be completely unserved.

### 2. "If we had to choose between focusing on Santa Rosa or Petaluma next month, which should we prioritize and why?"
*Demonstrates: Multi-factor decision analysis*

Expected reasoning: Tippy will compare alteration rates, active requests, untrapped potential, and density to make a data-driven recommendation.

### 3. "Where are we likely to find cats that we don't know about yet?"
*Demonstrates: Predictive reasoning about hidden populations*

Expected reasoning: Tippy will identify places with 0 verified cats but surrounded by high-activity neighbors, areas with active requests showing reported > verified counts, and recent kitten reports.

---

## Geographic & Spatial Analysis

### 4. "What's the situation in the Roseland area of Santa Rosa?"
*Demonstrates: Neighborhood-level analysis*

Expected insight: Roseland (95407 zip) is one of the highest-density TNR areas with 500+ cats within 500m of some locations.

### 5. "Are there any areas where cats from one location might be roaming to nearby locations?"
*Demonstrates: Spatial colony connection reasoning*

Expected reasoning: Tippy will identify high-density clusters where locations are within 50-100m and discuss colony interconnection.

### 6. "If someone calls about cats at an address we've never seen before, how would you assess whether it's likely a real cat problem?"
*Demonstrates: Spatial context for new reports*

Expected reasoning: Check nearby activity - if it's in a hot zone with many locations within 500m, very likely. If nearest known location is 3km away, might be a new isolated population.

---

## Trend & Progress Analysis

### 7. "How are we doing overall? Are we making progress on the cat population in Sonoma County?"
*Demonstrates: High-level progress assessment*

Expected reasoning: Tippy will analyze overall alteration rates, compare to 70% stabilization threshold, and discuss trends.

### 8. "What does our data tell us about the effectiveness of mass trapping events?"
*Demonstrates: Intervention analysis*

Expected reasoning: Identify locations where mass trapping (10+ cats/day) occurred and their current alteration rates to show impact.

### 9. "Which colonies have we successfully stabilized, and what made them successful?"
*Demonstrates: Success pattern analysis*

Expected insight: Colonies at 90%+ alteration rate with engaged caretakers and completed follow-up.

---

## Operational Intelligence

### 10. "What locations have active requests where we know there are more cats than we've trapped?"
*Demonstrates: Work queue prioritization*

Expected reasoning: Query requests where estimated_cat_count > verified cats to show untrapped potential.

### 11. "Are there any signs of new breeding activity we should be concerned about?"
*Demonstrates: Early warning detection*

Expected reasoning: Look for requests with has_kittens=true, recent kitten sightings, or places where unaltered cats remain.

### 12. "If a trapper has limited time next week, where would they have the most impact?"
*Demonstrates: Efficiency optimization*

Expected reasoning: Balance factors like untrapped count, accessibility, density (more cats = more efficient), and urgency.

---

## Data Quality & Transparency

### 13. "What don't we know? Where are our data gaps?"
*Demonstrates: Honest assessment of limitations*

Expected reasoning: Tippy will discuss cities with little data, areas where outreach hasn't reached, and the difference between "no data" and "no cats."

### 14. "How reliable are our cat counts? What's the difference between estimates and verified numbers?"
*Demonstrates: Data source transparency*

Expected reasoning: Explain colony estimates vs verified clinic data, how discrepancies arise, and what each number means.

### 15. "Why might our numbers look different from what a caretaker reports?"
*Demonstrates: Stakeholder communication*

Expected reasoning: Explain that our data reflects cats that came through the clinic, not all cats at a location. New arrivals, outdoor/indoor cats, and timing of observations affect counts.

---

## Comparative Analysis

### 16. "Compare the TNR progress at 15760 Pozzan Rd versus 1170 Walker Rd"
*Demonstrates: Place-to-place comparison*

Expected reasoning: Side-by-side analysis of cat counts, alteration rates, caretaker engagement, and current status.

### 17. "How does our work in rural areas compare to urban areas?"
*Demonstrates: Geographic segment analysis*

Expected reasoning: Compare metrics between rural vs urban zip codes, discuss different challenges and densities.

### 18. "What's the profile of our most successful colonies versus ones still needing work?"
*Demonstrates: Pattern recognition*

Expected reasoning: Analyze characteristics of 90%+ colonies vs <70% colonies - caretaker presence, mass trapping history, etc.

---

## Forward-Looking

### 19. "Based on our current pace and where cats remain, what areas should be our focus for the next year?"
*Demonstrates: Strategic planning support*

Expected reasoning: Identify high-impact opportunities based on untrapped potential, alteration gaps, and operational efficiency.

### 20. "If we could only do one thing to have the biggest impact on the cat population, what would it be?"
*Demonstrates: Prioritization reasoning*

Expected reasoning: Synthesize all data to recommend highest-impact action - might be focusing on a specific high-density area, improving follow-up on existing requests, or expanding outreach to underserved areas.

---

## Tips for the Presentation

1. **Ask follow-up questions** - Tippy can dig deeper. After any answer, ask "Why?" or "Tell me more about..."

2. **Be specific when possible** - "Tell me about Roseland" works better than "Tell me about Santa Rosa"

3. **Tippy will caveat appropriately** - This shows sophistication, not uncertainty. Low data may mean lack of outreach, not lack of cats.

4. **The reasoning matters** - Watch HOW Tippy approaches the question, not just the answer. It will explain its thinking.

5. **Real-time queries** - Tippy is querying live data, so numbers reflect current state of Atlas.

---

## Quick Demo Sequence (5 minutes)

If time is limited, these 5 questions give a good overview:

1. **Q3** - "Where are we likely to find cats we don't know about?" (Predictive)
2. **Q10** - "What locations have more cats than we've trapped?" (Operational)
3. **Q7** - "How are we doing overall?" (Progress)
4. **Q13** - "What don't we know?" (Transparency)
5. **Q20** - "What one thing would have the biggest impact?" (Strategic)
