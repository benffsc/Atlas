import { NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface ReviewItem {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  entity_link: string;
  review_reason: string;
  source_system: string;
  confidence: string;
  created_at: string;
  details: string | null;
}

export async function GET() {
  try {
    // Fetch items needing review from various sources
    const items: ReviewItem[] = [];

    // 1. AI-parsed colony estimates with low confidence
    const colonyEstimates = await queryRows<{
      estimate_id: string;
      place_id: string;
      place_name: string;
      total_cats: number;
      source_type: string;
      confidence_score: number;
      reported_at: string;
    }>(`
      SELECT
        pce.estimate_id,
        pce.place_id,
        COALESCE(p.display_name, p.formatted_address) AS place_name,
        pce.total_cats,
        pce.source_type::TEXT,
        pce.confidence_score,
        pce.reported_at::TEXT
      FROM sot.place_colony_estimates pce
      JOIN sot.places p ON p.place_id = pce.place_id
      WHERE pce.source_type IN ('ai_parsed', 'note_parser', 'beacon')
        AND (pce.confidence_score < 0.7 OR pce.confidence_score IS NULL)
      ORDER BY pce.reported_at DESC
      LIMIT 50
    `, []);

    for (const est of colonyEstimates) {
      items.push({
        entity_type: "colony_estimate",
        entity_id: est.estimate_id,
        entity_name: `${est.place_name}: ${est.total_cats} cats`,
        entity_link: `/places/${est.place_id}`,
        review_reason: "Low confidence AI-parsed estimate",
        source_system: est.source_type,
        confidence: est.confidence_score ? `${Math.round(est.confidence_score * 100)}%` : "Unknown",
        created_at: est.reported_at,
        details: null,
      });
    }

    // 2. Reproduction data from AI parsing
    const reproductionData = await queryRows<{
      vitals_id: string;
      cat_id: string;
      cat_name: string;
      is_pregnant: boolean;
      is_lactating: boolean;
      is_in_heat: boolean;
      source_system: string;
      recorded_at: string;
    }>(`
      SELECT
        cv.vitals_id,
        cv.cat_id,
        c.display_name AS cat_name,
        cv.is_pregnant,
        cv.is_lactating,
        cv.is_in_heat,
        cv.source_system,
        cv.recorded_at::TEXT
      FROM ops.cat_vitals cv
      JOIN sot.cats c ON c.cat_id = cv.cat_id
      WHERE cv.source_system IN ('ai_parsed', 'note_parser', 'beacon')
        AND (cv.is_pregnant OR cv.is_lactating OR cv.is_in_heat)
      ORDER BY cv.recorded_at DESC
      LIMIT 50
    `, []);

    for (const rep of reproductionData) {
      const flags = [];
      if (rep.is_pregnant) flags.push("Pregnant");
      if (rep.is_lactating) flags.push("Lactating");
      if (rep.is_in_heat) flags.push("In Heat");

      items.push({
        entity_type: "reproduction",
        entity_id: rep.vitals_id,
        entity_name: rep.cat_name || "Unknown cat",
        entity_link: `/cats/${rep.cat_id}`,
        review_reason: `AI-parsed reproduction: ${flags.join(", ")}`,
        source_system: rep.source_system,
        confidence: "Medium",
        created_at: rep.recorded_at,
        details: flags.join(", "),
      });
    }

    // 3. Mortality events from AI parsing
    const mortalityData = await queryRows<{
      mortality_event_id: string;
      cat_id: string;
      cat_name: string;
      death_cause: string;
      source_system: string;
      created_at: string;
    }>(`
      SELECT
        me.mortality_event_id,
        me.cat_id,
        c.display_name AS cat_name,
        me.death_cause::TEXT,
        me.source_system,
        me.created_at::TEXT
      FROM sot.cat_mortality_events me
      JOIN sot.cats c ON c.cat_id = me.cat_id
      WHERE me.source_system IN ('ai_parsed', 'note_parser', 'beacon')
      ORDER BY me.created_at DESC
      LIMIT 50
    `, []);

    for (const mort of mortalityData) {
      items.push({
        entity_type: "mortality",
        entity_id: mort.mortality_event_id,
        entity_name: mort.cat_name || "Unknown cat",
        entity_link: `/cats/${mort.cat_id}`,
        review_reason: `AI-parsed death: ${mort.death_cause || "Unknown cause"}`,
        source_system: mort.source_system,
        confidence: "Medium",
        created_at: mort.created_at,
        details: mort.death_cause,
      });
    }

    // 4. Birth events from AI parsing
    const birthData = await queryRows<{
      birth_event_id: string;
      cat_id: string;
      cat_name: string;
      birth_date_precision: string;
      source_system: string;
      created_at: string;
    }>(`
      SELECT
        be.birth_event_id,
        be.cat_id,
        c.display_name AS cat_name,
        be.birth_date_precision::TEXT,
        be.source_system,
        be.created_at::TEXT
      FROM sot.cat_birth_events be
      JOIN sot.cats c ON c.cat_id = be.cat_id
      WHERE be.source_system IN ('ai_parsed', 'note_parser', 'beacon')
        AND be.birth_date_precision IN ('estimate', 'season_only', 'year_only')
      ORDER BY be.created_at DESC
      LIMIT 50
    `, []);

    for (const birth of birthData) {
      items.push({
        entity_type: "birth",
        entity_id: birth.birth_event_id,
        entity_name: birth.cat_name || "Unknown cat",
        entity_link: `/cats/${birth.cat_id}`,
        review_reason: `AI-parsed birth (${birth.birth_date_precision})`,
        source_system: birth.source_system,
        confidence: "Low",
        created_at: birth.created_at,
        details: `Precision: ${birth.birth_date_precision}`,
      });
    }

    // Sort all items by created_at
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Summary counts
    const summary = {
      total: items.length,
      colony_estimates: items.filter((i) => i.entity_type === "colony_estimate").length,
      reproduction: items.filter((i) => i.entity_type === "reproduction").length,
      mortality: items.filter((i) => i.entity_type === "mortality").length,
      birth: items.filter((i) => i.entity_type === "birth").length,
    };

    return NextResponse.json({ items, summary });
  } catch (error) {
    console.error("Error fetching review items:", error);
    return NextResponse.json(
      { error: "Failed to fetch review items" },
      { status: 500 }
    );
  }
}
