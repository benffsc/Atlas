"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";

// --- Shared interfaces ---

export interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  primary_color: string | null;
  identifiers: Array<{ id_type: string; id_value: string }>;
  owners: Array<{ person_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string; formatted_address?: string | null }>;
  last_appointment_date?: string | null;
  first_appointment_date?: string | null;
  total_appointments?: number;
  tests?: Array<{ test_type?: string; disease_key?: string; disease_display_name?: string; result?: string; disease_badge_color?: string; short_code?: string }>;
  // Health fields (FFS-427)
  is_deceased?: boolean | null;
  age_group?: string | null;
  weight_lbs?: number | null;
  vitals?: Array<{ weight_lbs?: number | null; is_pregnant?: boolean | null; is_lactating?: boolean | null }>;
  conditions?: Array<{ condition_type: string; severity?: string | null; resolved_at?: string | null }>;
}

export interface PersonDetail {
  person_id: string;
  display_name: string;
  identifiers: Array<{ id_type: string; id_value: string }>;
  cats: Array<{ cat_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string; role: string }>;
  cat_count?: number;
  place_count?: number;
  last_appointment_date?: string | null;
  entity_type?: string | null;
  // Status fields (FFS-436)
  do_not_contact?: boolean;
  primary_role?: string | null;
  trapper_type?: string | null;
  // Enrichments (FFS-629)
  is_verified?: boolean;
  primary_address?: string | null;
}

export interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  cats: Array<{ cat_id: string; display_name: string }>;
  people: Array<{ person_id: string; display_name: string; role: string }>;
  cat_count?: number;
  person_count?: number;
  last_appointment_date?: string | null;
  active_request_count?: number;
  // Risk fields (FFS-432)
  watch_list?: boolean;
  disease_badges?: Array<{ disease_key: string; short_code: string; color: string; status: string; positive_cat_count?: number }>;
  // Enrichments (FFS-629)
  total_altered_count?: number;
  colony_size?: number | null;
}

export interface RequestDetail {
  request_id: string;
  status: string;
  priority: string | null;
  summary: string | null;
  place_name: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  total_cats_reported: number | null;
  created_at: string;
  resolved_at: string | null;
  // Enrichments (FFS-629)
  place_id?: string | null;
  place_address?: string | null;
  place_kind?: string | null;
  linked_cat_count?: number;
  assignment_status?: string;
  primary_trapper_name?: string | null;
}

export type EntityType = "cat" | "person" | "place" | "request";
export type EntityDetail = CatDetail | PersonDetail | PlaceDetail | RequestDetail;

// --- Data fetching hook ---

export function useEntityDetail(entityType: EntityType | null, entityId: string | null) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityType || !entityId) {
      setDetail(null);
      return;
    }

    setLoading(true);
    setDetail(null);

    const endpoint =
      entityType === "cat" ? "cats" :
      entityType === "person" ? "people" :
      entityType === "place" ? "places" :
      "requests";

    fetchApi<EntityDetail>(`/api/${endpoint}/${entityId}`)
      .then((data) => setDetail(data))
      .catch(() => { /* best-effort preview */ })
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  return { detail, loading };
}
