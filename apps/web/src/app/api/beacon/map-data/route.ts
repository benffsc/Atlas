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
 *     NEW (simplified):
 *     - atlas_pins: Consolidated Atlas data (places + people + cats + Google history)
 *     LEGACY (still supported):
 *     - places: Places with cat activity
 *     - google_pins: Google Maps entries with parsed signals
 *     - zones: Observation zones
 *     - tnr_priority: Targeted TNR priority layer (ecology data)
 *
 *   - zone: filter by service_zone (optional)
 *   - bounds: lat1,lng1,lat2,lng2 bounding box (optional)
 *   - risk_filter: 'all' | 'disease' | 'watch_list' | 'needs_tnr' | 'needs_trapper' (for atlas_pins)
 *   - data_filter: 'all' | 'has_atlas' | 'has_google' | 'has_people' (for atlas_pins)
 *   - disease_filter: comma-separated disease keys to filter atlas_pins (e.g. 'felv,fiv')
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const layersParam = searchParams.get("layers") || "places";
  const layers = layersParam.split(",").map((l) => l.trim());
  const zone = searchParams.get("zone");
  const bounds = searchParams.get("bounds");
  const riskFilter = searchParams.get("risk_filter") || "all";
  const dataFilter = searchParams.get("data_filter") || "all";
  const diseaseFilterParam = searchParams.get("disease_filter") || "";
  const diseaseFilterKeys = diseaseFilterParam ? diseaseFilterParam.split(",").map(k => k.trim()).filter(Boolean) : [];

  // Parse bounds for viewport-based loading (format: south,west,north,east)
  let boundsCondition = "";
  if (bounds) {
    const [south, west, north, east] = bounds.split(",").map(Number);
    if (!isNaN(south) && !isNaN(west) && !isNaN(north) && !isNaN(east)) {
      // Add 10% buffer to avoid edge flickering during pan
      const latBuffer = (north - south) * 0.1;
      const lngBuffer = (east - west) * 0.1;
      // Use parameterized-style values (already validated as numbers above)
      boundsCondition = `AND lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN ${south - latBuffer} AND ${north + latBuffer} AND lng BETWEEN ${west - lngBuffer} AND ${east + lngBuffer}`;
    }
  }

  const result: {
    // NEW consolidated layers
    atlas_pins?: Array<{
      id: string;
      address: string;
      display_name: string | null;
      lat: number;
      lng: number;
      service_zone: string | null;
      parent_place_id: string | null;
      place_kind: string | null;
      unit_identifier: string | null;
      cat_count: number;
      people: Array<{ name: string; roles: string[]; is_staff: boolean }>;
      person_count: number;
      disease_risk: boolean;
      disease_risk_notes: string | null;
      disease_badges: Array<{ disease_key: string; short_code: string; color: string; status: string; last_positive: string | null; positive_cats: number }>;
      disease_count: number;
      watch_list: boolean;
      google_entry_count: number;
      google_summaries: Array<{ summary: string; meaning: string | null; date: string | null }>;
      request_count: number;
      active_request_count: number;
      needs_trapper_count: number;
      intake_count: number;
      total_altered: number;
      last_alteration_at: string | null;
      pin_style: "disease" | "watch_list" | "active" | "active_requests" | "has_history" | "minimal";
      pin_tier: "active" | "reference";
    }>;
    // LEGACY layers (still supported)
    places?: Array<{
      id: string;
      address: string;
      lat: number;
      lng: number;
      cat_count: number;
      priority: string;
      has_observation: boolean;
      service_zone: string;
      primary_person_name: string | null;
      person_count: number;
    }>;
    google_pins?: Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      notes: string;
      entry_type: string;
      cat_count: number | null;
      ai_meaning: string | null;
      display_label: string;
      display_color: string;
      staff_alert: boolean;
      ai_confidence: number | null;
      classification_description: string | null;
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
    annotations?: Array<{
      annotation_id: string;
      lat: number;
      lng: number;
      label: string;
      note: string | null;
      photo_url: string | null;
      annotation_type: string;
      created_by: string;
      expires_at: string | null;
      created_at: string;
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

    // =========================================================================
    // NEW: Atlas Pins layer (consolidated places + people + cats + history)
    // =========================================================================
    if (layers.includes("atlas_pins")) {
      // Build filter conditions
      let riskCondition = "";
      if (riskFilter === "disease") {
        riskCondition = "AND disease_risk = TRUE";
      } else if (riskFilter === "watch_list") {
        riskCondition = "AND watch_list = TRUE";
      } else if (riskFilter === "needs_tnr") {
        riskCondition = "AND pin_style = 'active' AND total_altered < cat_count";
      } else if (riskFilter === "needs_trapper") {
        riskCondition = "AND needs_trapper_count > 0";
      }

      let dataCondition = "";
      if (dataFilter === "has_atlas") {
        dataCondition = "AND (cat_count > 0 OR request_count > 0)";
      } else if (dataFilter === "has_google") {
        dataCondition = "AND google_entry_count > 0";
      } else if (dataFilter === "has_people") {
        dataCondition = "AND person_count > 0";
      }

      // Disease type filter: only show pins with specific disease types
      let diseaseCondition = "";
      if (diseaseFilterKeys.length > 0) {
        // Filter atlas_pins that have any of the specified disease keys in their badges
        const escaped = diseaseFilterKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(",");
        diseaseCondition = `AND disease_count > 0 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(disease_badges) b
          WHERE b->>'disease_key' IN (${escaped})
        )`;
      }

      const atlasPins = await queryRows<{
        id: string;
        address: string;
        display_name: string | null;
        lat: number;
        lng: number;
        service_zone: string | null;
        parent_place_id: string | null;
        place_kind: string | null;
        unit_identifier: string | null;
        cat_count: number;
        people: Array<{ name: string; roles: string[]; is_staff: boolean }>;
        person_count: number;
        disease_risk: boolean;
        disease_risk_notes: string | null;
        disease_badges: Array<{ disease_key: string; short_code: string; color: string; status: string; last_positive: string | null; positive_cats: number }>;
        disease_count: number;
        watch_list: boolean;
        google_entry_count: number;
        google_summaries: Array<{ summary: string; meaning: string | null; date: string | null }>;
        request_count: number;
        active_request_count: number;
        needs_trapper_count: number;
        intake_count: number;
        total_altered: number;
        last_alteration_at: string | null;
        pin_style: "disease" | "watch_list" | "active" | "active_requests" | "has_history" | "minimal";
        pin_tier: "active" | "reference";
      }>(`
        SELECT
          id::text,
          address,
          display_name,
          lat,
          lng,
          service_zone,
          parent_place_id::text,
          place_kind,
          unit_identifier,
          cat_count::int,
          COALESCE(people, '[]')::jsonb as people,
          person_count::int,
          disease_risk,
          disease_risk_notes,
          COALESCE(disease_badges, '[]')::jsonb as disease_badges,
          COALESCE(disease_count, 0)::int as disease_count,
          watch_list,
          google_entry_count::int,
          COALESCE(google_summaries, '[]')::jsonb as google_summaries,
          request_count::int,
          active_request_count::int,
          COALESCE(needs_trapper_count, 0)::int as needs_trapper_count,
          intake_count::int,
          total_altered::int,
          last_alteration_at::text,
          pin_style,
          pin_tier
        FROM trapper.v_map_atlas_pins
        WHERE 1=1
          ${zone ? `AND service_zone = '${zone}'` : ""}
          ${boundsCondition}
          ${riskCondition}
          ${dataCondition}
          ${diseaseCondition}
        ORDER BY
          CASE pin_style
            WHEN 'disease' THEN 1
            WHEN 'watch_list' THEN 2
            WHEN 'active' THEN 3
            WHEN 'has_history' THEN 4
            ELSE 5
          END,
          (cat_count + request_count + person_count + google_entry_count) DESC
        LIMIT 12000
      `);

      // Parse JSONB columns
      result.atlas_pins = atlasPins.map((pin) => ({
        ...pin,
        people: Array.isArray(pin.people) ? pin.people : [],
        google_summaries: Array.isArray(pin.google_summaries) ? pin.google_summaries : [],
        disease_badges: Array.isArray(pin.disease_badges) ? pin.disease_badges : [],
      }));
    }

    // =========================================================================
    // LEGACY: Places layer (use atlas_pins instead)
    // =========================================================================
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
        primary_person_name: string | null;
        person_count: number;
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
            COALESCE(p.service_zone, 'Unknown') as service_zone,
            -- Get primary person at this place
            (
              SELECT per.display_name
              FROM trapper.person_place_relationships ppr
              JOIN trapper.sot_people per ON per.person_id = ppr.person_id
              WHERE ppr.place_id = p.place_id
              ORDER BY ppr.is_primary DESC NULLS LAST, ppr.created_at ASC
              LIMIT 1
            ) as primary_person_name,
            (
              SELECT COUNT(DISTINCT ppr.person_id)::int
              FROM trapper.person_place_relationships ppr
              WHERE ppr.place_id = p.place_id
            ) as person_count
          FROM trapper.places p
          LEFT JOIN (
            SELECT cpr.place_id, COUNT(DISTINCT cpr.cat_id) as cat_count
            FROM trapper.cat_place_relationships cpr
            JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
            GROUP BY cpr.place_id
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
        cat_count: number | null;
        ai_meaning: string | null;
        display_label: string;
        display_color: string;
        staff_alert: boolean;
        ai_confidence: number | null;
        classification_description: string | null;
      }>(`
        SELECT
          entry_id::text as id,
          COALESCE(kml_name, 'Unnamed') as name,
          lat,
          lng,
          COALESCE(ai_summary, original_content, '') as notes,
          COALESCE(ai_meaning, 'general') as entry_type,
          parsed_cat_count as cat_count,
          ai_meaning,
          COALESCE(display_label, 'Unknown') as display_label,
          COALESCE(display_color, '#CCCCCC') as display_color,
          COALESCE(staff_alert, false) as staff_alert,
          (ai_classification->>'confidence')::numeric as ai_confidence,
          classification_description
        FROM trapper.v_google_map_entries_classified
        WHERE lat IS NOT NULL
          AND lng IS NOT NULL
        ORDER BY
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
            SELECT cpr.place_id, COUNT(DISTINCT cpr.cat_id) as cat_count
            FROM trapper.cat_place_relationships cpr
            JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
            GROUP BY cpr.place_id
          ) cc ON cc.place_id = p.place_id
          LEFT JOIN (
            SELECT cpr.place_id, COUNT(DISTINCT cp.cat_id) as altered_count
            FROM trapper.cat_place_relationships cpr
            JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
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
          COALESCE(pr.trapper_type, pr.role) as role,
          CASE
            WHEN pr.trapper_type = 'coordinator' THEN 'FFSC Coordinator'
            WHEN pr.trapper_type = 'head_trapper' THEN 'Head Trapper'
            WHEN pr.trapper_type = 'ffsc_trapper' THEN 'FFSC Trapper'
            WHEN pr.trapper_type = 'community_trapper' THEN 'Community Trapper'
            WHEN pr.role = 'foster' THEN 'Foster'
            WHEN pr.role = 'caretaker' THEN 'Colony Caretaker'
            WHEN pr.role = 'staff' THEN 'Staff'
            WHEN pr.role = 'volunteer' THEN 'Volunteer'
            ELSE INITCAP(REPLACE(pr.role, '_', ' '))
          END as role_label,
          pl.service_zone,
          pr.role_status = 'active' as is_active
        FROM trapper.sot_people p
        JOIN trapper.person_roles pr ON pr.person_id = p.person_id
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE pr.role IN ('trapper', 'foster', 'caretaker', 'staff', 'volunteer')
          AND pr.role_status = 'active'
          AND pl.location IS NOT NULL
          AND pl.merged_into_place_id IS NULL
          AND p.merged_into_person_id IS NULL
          AND COALESCE(p.data_quality, 'normal') NOT IN ('garbage', 'needs_review')
          ${zone ? `AND pl.service_zone = '${zone}'` : ""}
        ORDER BY p.person_id,
          CASE pr.role
            WHEN 'trapper' THEN 1
            WHEN 'staff' THEN 2
            WHEN 'foster' THEN 3
            WHEN 'caretaker' THEN 4
            ELSE 5
          END
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
          JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
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
    // =========================================================================
    // Annotations layer (staff map notes)
    // =========================================================================
    if (layers.includes("annotations")) {
      const annotations = await queryRows<{
        annotation_id: string;
        lat: number;
        lng: number;
        label: string;
        note: string | null;
        photo_url: string | null;
        annotation_type: string;
        created_by: string;
        expires_at: string | null;
        created_at: string;
      }>(`
        SELECT
          annotation_id,
          ST_Y(location::geometry) AS lat,
          ST_X(location::geometry) AS lng,
          label, note, photo_url, annotation_type,
          created_by, expires_at::text, created_at::text
        FROM trapper.map_annotations
        WHERE is_active = TRUE
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
        LIMIT 500
      `);
      result.annotations = annotations;
    }

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
        (SELECT COUNT(DISTINCT cpr.cat_id) FROM trapper.cat_place_relationships cpr JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL) as total_cats,
        (SELECT COUNT(*) FROM trapper.observation_zones WHERE status = 'active') as zones_needing_obs
    `);
    result.summary = summary[0];

    return NextResponse.json(result, {
      headers: {
        // Map data cached for 2 minutes, serve stale for 5 more while revalidating
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Error fetching map data:", error);
    return NextResponse.json(
      { error: "Failed to fetch map data" },
      { status: 500 }
    );
  }
}
