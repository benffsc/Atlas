/**
 * Shared type definitions for place detail pages.
 */
import type { JournalEntry } from "@/components/sections";
import type { MediaItem } from "@/components/media";

export interface PlaceCat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
}

export interface PlacePerson {
  person_id: string;
  person_name: string;
  role: string;
  confidence: number;
}

export interface PlaceRelationship {
  place_id: string;
  place_name: string;
  relationship_type: string;
  relationship_label: string;
}

export interface PlaceContext {
  context_id: string;
  context_type: string;
  context_label: string;
  valid_from: string | null;
  evidence_type: string | null;
  confidence: number;
  is_verified: boolean;
  assigned_at: string;
  source_system: string | null;
  organization_name?: string | null;
  known_org_id?: string | null;
  known_org_name?: string | null;
}

export interface PartnerOrgInfo {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_type: string | null;
  relationship_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  appointments_count: number | null;
  cats_processed: number | null;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
}

export interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  source_created_at: string | null;
  created_at: string;
  updated_at: string;
  cats: PlaceCat[] | null;
  people: PlacePerson[] | null;
  place_relationships: PlaceRelationship[] | null;
  cat_count: number;
  person_count: number;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  last_appointment_date: string | null;
  active_request_count: number;
  contexts?: PlaceContext[];
  partner_org?: PartnerOrgInfo | null;
}

export interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  requester_name: string | null;
}

export interface PlaceDetailData {
  place: PlaceDetail | null;
  heroMedia: (MediaItem & { is_hero?: boolean })[];
  journal: JournalEntry[];
  requests: RelatedRequest[];
  loading: boolean;
  error: string | null;
  fetchPlace: () => Promise<void>;
  fetchJournal: () => Promise<void>;
  fetchHeroMedia: () => Promise<void>;
}
