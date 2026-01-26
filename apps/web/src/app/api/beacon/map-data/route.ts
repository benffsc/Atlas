import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/beacon/map-data
 *
 * Returns geographic data for the Beacon preview map.
 * Supports multiple layers that can be toggled on/off.
 *
 * Query params:
 *   - layers: comma-separated list of layers to include
 *     - places: Places with cat activity
 *     - google_pins: Google Maps entries with parsed signals
 *     - zones: Observation zones
 *     - tnr_priority: Targeted TNR priority layer (ecology data)
 *   - zone: filter by service_zone (optional)
 *   - bounds: lat1,lng1,lat2,lng2 bounding box (optional)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const layersParam = searchParams.get("layers") || "places";
  const layers = layersParam.split(",").map((l) => l.trim());
  const zone = searchParams.get("zone");
  const bounds = searchParams.get("bounds");

  const result: {
    places?: Array<{
      id: string;
      address: string;
      lat: number;
      lng: number;
      cat_count: number;
      priority: string;
      has_observation: boolean;
      service_zone: string;
    }>;
    google_pins?: Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      notes: string;
      entry_type: string;
      signals: string[];
      cat_count: number | null;
      // AI classification fields
      ai_meaning: string | null;
      display_label: string;
      display_color: string;
      staff_alert: boolean;
      ai_confidence: number | null;
      disease_mentions: string[] | null;
      safety_concerns: string[] | null;
    }>;
    tnr_priority?: Array<{
      id: string;
      address: string;
      lat: number;
      lng: number;
      cat_count: number;
      altered_count: number;
      alteration_rate: number;
      tnr_priority: string;
      has_observation: boolean;
      service_zone: string;
    }>;
    zones?: Array<{
      zone_id: string;
      zone_code: string;
      anchor_lat: number;
      anchor_lng: number;
      places_count: number;
      total_cats: number;
      observation_status: string;
      boundary?: string; // GeoJSON
    }>;
    volunteers?: Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      role: string;
      role_label: string;
      service_zone: string | null;
      is_active: boolean;
    }>;
    clinic_clients?: Array<{
      id: string;
      address: string;
      lat: number;
      lng: number;
      appointment_count: number;
      cat_count: number;
      last_visit: string;
      service_zone: string;
    }>;
    historical_sources?: Array<{
      place_id: string;
      address: string;
      lat: number;
      lng: number;
      condition_type: string;
      display_label: string;
      display_color: string;
      severity: string;
      valid_from: string;
      valid_to: string | null;
      peak_cat_count: number | null;
      ecological_impact: string | null;
      description: string | null;
      opacity: number;
    }>;
    data_coverage?: Array<{
      zone_id: string;
      zone_name: string;
      google_maps_entries: number;
      airtable_requests: number;
      clinic_appointments: number;
      intake_submissions: number;
      coverage_level: string;
    }>;
    summary?: {
      total_places: number;
      total_cats: number;
      zones_needing_obs: number;
    };
  } = {};

  try {
    // Build zone filter
    const zoneFilter = zone ? `AND p.service_zone = '${zone}'` : "";

    // Places layer
    if (layers.includes("places")) {
      const places = await queryRows<{
        id: string;
        address: string;
        lat: number;
        lng: number;
        cat_count: number;
        priority: string;
        has_observation: boolean;
        service_zone: string;
      }>(`
        WITH place_stats AS (
          SELECT
            p.place_id as id,
            p.formatted_address as address,
            ST_Y(p.location::geometry) as lat,
            ST_X(p.location::geometry) as lng,
            COALESCE(cc.cat_count, 0) as cat_count,
            CASE
              WHEN COALESCE(cc.cat_count, 0) >= 10 THEN 'high'
              WHEN COALESCE(cc.cat_count, 0) >= 5 THEN 'medium'
              ELSE 'low'
            END as priority,
            EXISTS (
              SELECT 1 FROM trapper.place_colony_estimates pce
              WHERE pce.place_id = p.place_id AND pce.eartip_count_observed > 0
            ) as has_observation,
            COALESCE(p.service_zone, 'Unknown') as service_zone
          FROM trapper.places p
          LEFT JOIN (
            SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
            FROM trapper.cat_place_relationships
            GROUP BY place_id
          ) cc ON cc.place_id = p.place_id
          WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND COALESCE(cc.cat_count, 0) > 0
            ${zoneFilter}
        )
        SELECT * FROM place_stats
        ORDER BY cat_count DESC
        LIMIT 5000
      `);
      result.places = places;
    }

    // Google Maps pins layer (with AI classification)
    if (layers.includes("google_pins")) {
      const pins = await queryRows<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        notes: string;
        entry_type: string;
        signals: string[];
        cat_count: number | null;
        ai_meaning: string | null;
        display_label: string;
        display_color: string;
        staff_alert: boolean;
        ai_confidence: number | null;
        disease_mentions: string[] | null;
        safety_concerns: string[] | null;
      }>(`
        SELECT
          entry_id::text as id,
          COALESCE(kml_name, 'Unnamed') as name,
          lat,
          lng,
          COALESCE(ai_summary, original_content, '') as notes,
          -- Use AI meaning if available, otherwise fall back to parsed signals
          COALESCE(
            ai_meaning,
            CASE
              WHEN parsed_signals->>'signals' IS NOT NULL
                AND jsonb_array_length(parsed_signals->'signals') > 0
              THEN (parsed_signals->'signals'->>0)
              ELSE 'general'
            END
          ) as entry_type,
          COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(parsed_signals->'signals')),
            ARRAY[]::text[]
          ) as signals,
          COALESCE(
            (ai_classification->'signals'->>'cat_count')::int,
            parsed_cat_count
          ) as cat_count,
          -- AI classification fields
          ai_meaning,
          COALESCE(display_label, 'Unknown') as display_label,
          COALESCE(display_color, '#CCCCCC') as display_color,
          COALESCE(staff_alert, false) as staff_alert,
          (ai_classification->>'confidence')::numeric as ai_confidence,
          CASE
            WHEN ai_classification->'signals'->'disease_mentions' IS NOT NULL
            THEN ARRAY(SELECT jsonb_array_elements_text(ai_classification->'signals'->'disease_mentions'))
            ELSE NULL
          END as disease_mentions,
          CASE
            WHEN ai_classification->'signals'->'safety_concerns' IS NOT NULL
            THEN ARRAY(SELECT jsonb_array_elements_text(ai_classification->'signals'->'safety_concerns'))
            ELSE NULL
          END as safety_concerns
        FROM trapper.v_google_map_entries_classified
        WHERE lat IS NOT NULL
          AND lng IS NOT NULL
        ORDER BY
          -- Prioritize entries with staff alerts
          CASE WHEN staff_alert THEN 0 ELSE 1 END,
          priority,
          synced_at DESC NULLS LAST
        LIMIT 5000
      `);
      result.google_pins = pins;
    }

    // TNR Priority layer (Targeted TNR data)
    if (layers.includes("tnr_priority")) {
      const tnrData = await queryRows<{
        id: string;
        address: string;
        lat: number;
        lng: number;
        cat_count: number;
        altered_count: number;
        alteration_rate: number;
        tnr_priority: string;
        has_observation: boolean;
        service_zone: string;
      }>(`
        WITH place_stats AS (
          SELECT
            p.place_id as id,
            p.formatted_address as address,
            ST_Y(p.location::geometry) as lat,
            ST_X(p.location::geometry) as lng,
            COALESCE(cc.cat_count, 0) as cat_count,
            COALESCE(ac.altered_count, 0) as altered_count,
            CASE
              WHEN COALESCE(cc.cat_count, 0) > 0
              THEN ROUND(100.0 * COALESCE(ac.altered_count, 0) / COALESCE(cc.cat_count, 1), 1)
              ELSE 0
            END as alteration_rate,
            CASE
              WHEN COALESCE(cc.cat_count, 0) >= 10 AND COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.25 THEN 'critical'
              WHEN COALESCE(cc.cat_count, 0) >= 5 AND COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.50 THEN 'high'
              WHEN COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.75 THEN 'medium'
              WHEN COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) >= 0.75 THEN 'managed'
              ELSE 'unknown'
            END as tnr_priority,
            EXISTS (
              SELECT 1 FROM trapper.place_colony_estimates pce
              WHERE pce.place_id = p.place_id AND pce.eartip_count_observed > 0
            ) as has_observation,
            COALESCE(p.service_zone, 'Unknown') as service_zone
          FROM trapper.places p
          LEFT JOIN (
            SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
            FROM trapper.cat_place_relationships
            GROUP BY place_id
          ) cc ON cc.place_id = p.place_id
          LEFT JOIN (
            SELECT cpr.place_id, COUNT(DISTINCT cp.cat_id) as altered_count
            FROM trapper.cat_place_relationships cpr
            JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id
            WHERE cp.is_spay OR cp.is_neuter
            GROUP BY cpr.place_id
          ) ac ON ac.place_id = p.place_id
          WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND COALESCE(cc.cat_count, 0) > 0
            ${zoneFilter}
        )
        SELECT * FROM place_stats
        WHERE tnr_priority IN ('critical', 'high', 'medium')
        ORDER BY
          CASE tnr_priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
          END,
          cat_count DESC
        LIMIT 3000
      `);
      result.tnr_priority = tnrData;
    }

    // Observation zones layer
    if (layers.includes("zones")) {
      const zones = await queryRows<{
        zone_id: string;
        zone_code: string;
        anchor_lat: number;
        anchor_lng: number;
        places_count: number;
        total_cats: number;
        observation_status: string;
        boundary: string;
      }>(`
        SELECT
          oz.zone_id::text,
          oz.zone_code,
          ST_Y(oz.centroid::geometry) as anchor_lat,
          ST_X(oz.centroid::geometry) as anchor_lng,
          COALESCE(zs.places_in_zone, 0)::int as places_count,
          COALESCE(zs.total_cats_linked, 0)::int as total_cats,
          COALESCE(zs.observation_status, 'unknown') as observation_status,
          ST_AsGeoJSON(oz.boundary_geom) as boundary
        FROM trapper.observation_zones oz
        LEFT JOIN trapper.v_observation_zone_summary zs ON zs.zone_id = oz.zone_id
        WHERE oz.status = 'active'
          ${zone ? `AND oz.service_zone = '${zone}'` : ""}
        ORDER BY COALESCE(zs.total_cats_linked, 0) DESC
      `);
      result.zones = zones;
    }

    // Volunteers layer - people with roles who have place associations
    if (layers.includes("volunteers")) {
      const volunteers = await queryRows<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        role: string;
        role_label: string;
        service_zone: string | null;
        is_active: boolean;
      }>(`
        SELECT DISTINCT ON (p.person_id)
          p.person_id::text as id,
          p.display_name as name,
          ST_Y(pl.location::geometry) as lat,
          ST_X(pl.location::geometry) as lng,
          pr.trapper_type as role,
          CASE pr.trapper_type
            WHEN 'coordinator' THEN 'FFSC Coordinator'
            WHEN 'head_trapper' THEN 'Head Trapper'
            WHEN 'ffsc_trapper' THEN 'FFSC Trapper'
            WHEN 'community_trapper' THEN 'Community Trapper'
            ELSE INITCAP(REPLACE(pr.trapper_type, '_', ' '))
          END as role_label,
          pl.service_zone,
          pr.ended_at IS NULL as is_active
        FROM trapper.sot_people p
        JOIN trapper.person_roles pr ON pr.person_id = p.person_id
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
          AND pr.ended_at IS NULL
          AND pl.location IS NOT NULL
          AND pl.merged_into_place_id IS NULL
          ${zone ? `AND pl.service_zone = '${zone}'` : ""}
        ORDER BY p.person_id, pr.started_at DESC
        LIMIT 500
      `);
      result.volunteers = volunteers;
    }

    // ClinicHQ clients layer - places with recent appointments
    if (layers.includes("clinic_clients")) {
      const clinicClients = await queryRows<{
        id: string;
        address: string;
        lat: number;
        lng: number;
        appointment_count: number;
        cat_count: number;
        last_visit: string;
        service_zone: string;
      }>(`
        WITH clinic_places AS (
          SELECT
            p.place_id,
            p.formatted_address as address,
            ST_Y(p.location::geometry) as lat,
            ST_X(p.location::geometry) as lng,
            COUNT(DISTINCT a.appointment_id) as appointment_count,
            COUNT(DISTINCT a.cat_id) as cat_count,
            MAX(a.appointment_date)::text as last_visit,
            COALESCE(p.service_zone, 'Unknown') as service_zone
          FROM trapper.places p
          JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
          JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
          WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND a.appointment_date > NOW() - INTERVAL '2 years'
            ${zoneFilter}
          GROUP BY p.place_id, p.formatted_address, p.location, p.service_zone
        )
        SELECT
          place_id::text as id,
          address,
          lat,
          lng,
          appointment_count::int,
          cat_count::int,
          last_visit,
          service_zone
        FROM clinic_places
        WHERE appointment_count > 0
        ORDER BY appointment_count DESC
        LIMIT 3000
      `);
      result.clinic_clients = clinicClients;
    }

    // Historical Sources layer - places with historical ecological conditions
    if (layers.includes("historical_sources")) {
      const historicalSources = await queryRows<{
        place_id: string;
        address: string;
        lat: number;
        lng: number;
        condition_type: string;
        display_label: string;
        display_color: string;
        severity: string;
        valid_from: string;
        valid_to: string | null;
        peak_cat_count: number | null;
        ecological_impact: string | null;
        description: string | null;
        opacity: number;
      }>(`
        SELECT
          p.place_id::text,
          p.formatted_address as address,
          ST_Y(p.location::geometry) as lat,
          ST_X(p.location::geometry) as lng,
          pch.condition_type,
          COALESCE(pct.display_label, INITCAP(REPLACE(pch.condition_type, '_', ' '))) as display_label,
          COALESCE(pct.display_color, '#9333ea') as display_color,
          pch.severity,
          pch.valid_from::text,
          pch.valid_to::text,
          pch.peak_cat_count,
          pch.ecological_impact,
          pch.description,
          CASE
            WHEN pch.valid_to IS NULL THEN 1.0
            WHEN pch.valid_to > CURRENT_DATE - INTERVAL '2 years' THEN 0.9
            WHEN pch.valid_to > CURRENT_DATE - INTERVAL '5 years' THEN 0.7
            WHEN pch.valid_to > CURRENT_DATE - INTERVAL '10 years' THEN 0.5
            ELSE 0.3
          END as opacity
        FROM trapper.places p
        JOIN trapper.place_condition_history pch ON pch.place_id = p.place_id
        LEFT JOIN trapper.place_condition_types pct ON pct.condition_type = pch.condition_type
        WHERE p.merged_into_place_id IS NULL
          AND p.location IS NOT NULL
          AND pch.superseded_at IS NULL
          AND (pct.is_ecological_significant = TRUE OR pct.is_ecological_significant IS NULL)
          ${zoneFilter}
        ORDER BY pch.peak_cat_count DESC NULLS LAST
        LIMIT 2000
      `);
      result.historical_sources = historicalSources;
    }

    // Data Coverage layer - zone-level data coverage stats
    if (layers.includes("data_coverage")) {
      // First ensure the coverage table is populated
      try {
        await queryRows(`SELECT trapper.refresh_zone_data_coverage()`);
      } catch (e) {
        // Ignore if function doesn't exist yet or fails
        console.log("refresh_zone_data_coverage not available yet:", e);
      }

      const dataCoverage = await queryRows<{
        zone_id: string;
        zone_name: string;
        google_maps_entries: number;
        airtable_requests: number;
        clinic_appointments: number;
        intake_submissions: number;
        coverage_level: string;
      }>(`
        SELECT
          zone_id,
          zone_name,
          COALESCE(google_maps_entries, 0)::int as google_maps_entries,
          COALESCE(airtable_requests, 0)::int as airtable_requests,
          COALESCE(clinic_appointments, 0)::int as clinic_appointments,
          COALESCE(intake_submissions, 0)::int as intake_submissions,
          COALESCE(coverage_level, 'unknown') as coverage_level
        FROM trapper.zone_data_coverage
        ORDER BY
          CASE coverage_level
            WHEN 'gap' THEN 1
            WHEN 'sparse' THEN 2
            WHEN 'moderate' THEN 3
            WHEN 'rich' THEN 4
            ELSE 5
          END,
          zone_name
      `);
      result.data_coverage = dataCoverage;
    }

    // Summary stats
    const summary = await queryRows<{
      total_places: number;
      total_cats: number;
      zones_needing_obs: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL ${zoneFilter.replace('p.', '')}) as total_places,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships) as total_cats,
        (SELECT COUNT(*) FROM trapper.observation_zones WHERE status = 'active') as zones_needing_obs
    `);
    result.summary = summary[0];

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching map data:", error);
    return NextResponse.json(
      { error: "Failed to fetch map data" },
      { status: 500 }
    );
  }
}
