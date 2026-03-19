"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import type { JournalEntry } from "@/components/sections";

// ---- Base Person Types ----

export interface PersonIdentifier {
  id_type: string;
  id_value: string;
  source_system: string | null;
  source_table: string | null;
  confidence?: number;
}

export interface PersonAlias {
  alias_id: string;
  name_raw: string;
  source_system: string | null;
  source_table: string | null;
  created_at: string;
}

export interface AssociatedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  source_type: "relationship" | "request" | "intake";
}

export interface PersonCat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
  source_system: string;
  data_source: string;
  microchip: string | null;
}

export interface PersonPlace {
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  role: string;
  confidence: number;
}

export interface PersonRelationship {
  person_id: string;
  person_name: string;
  relationship_type: string;
  relationship_label: string;
  confidence: number;
}

export interface PersonDetail {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: PersonCat[] | null;
  places: PersonPlace[] | null;
  person_relationships: PersonRelationship[] | null;
  cat_count: number;
  place_count: number;
  source_created_at: string | null;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  data_quality: string | null;
  primary_place_id: string | null;
  identifiers: PersonIdentifier[] | null;
  entity_type: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  associated_places: AssociatedPlace[] | null;
  aliases: PersonAlias[] | null;
}

export interface RelatedRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  created_at: string;
  place_name: string | null;
}

export interface TrapperInfo {
  trapper_type: string;
  is_ffsc_trapper: boolean;
}

export interface VolunteerRolesData {
  roles: Array<{
    role: string;
    trapper_type: string | null;
    role_status: string;
    source_system: string | null;
    started_at: string | null;
    ended_at: string | null;
    notes: string | null;
  }>;
  volunteer_groups: {
    active: Array<{ name: string; joined_at: string | null }>;
    history: Array<{ name: string; joined_at: string | null; left_at: string | null }>;
  };
  volunteer_profile: {
    hours_logged: number | null;
    event_count: number | null;
    last_activity: string | null;
    last_login: string | null;
    joined: string | null;
    is_active: boolean | null;
    notes: string | null;
    motivation: string | null;
    experience: string | null;
    skills: Record<string, string> | null;
    availability: string | null;
    languages: string | null;
    pronouns: string | null;
    occupation: string | null;
    how_heard: string | null;
    emergency_contact: string | null;
    can_drive: boolean | null;
  } | null;
  operational_summary: {
    trapper_stats: { total_caught: number; active_assignments: number; last_catch: string | null } | null;
    foster_stats: { cats_fostered: number; current_fosters: number };
    places_linked: number;
  };
}

// ---- Foster-Specific Types ----

export interface FosterCat {
  cat_id: string;
  cat_name: string | null;
  microchip: string | null;
  breed: string | null;
  source_system: string | null;
  confidence: number | null;
  linked_at: string | null;
}

export interface FosterAgreement {
  agreement_id: string;
  agreement_type: string;
  signed_at: string | null;
  source_system: string;
  notes: string | null;
  created_at: string;
}

// ---- Trapper-Specific Types ----

export interface TrapperStats {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_site_visits: number;
  assessment_visits: number;
  first_visit_success_rate_pct: number | null;
  cats_from_visits: number;
  cats_from_assignments: number;
  cats_altered_from_assignments: number;
  manual_catches: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  spayed_count: number;
  neutered_count: number;
  total_altered: number;
  felv_tested_count: number;
  felv_positive_count: number;
  felv_positive_rate_pct: number | null;
  first_clinic_date: string | null;
  last_clinic_date: string | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
  email: string | null;
  phone: string | null;
  availability_status: string;
}

export interface ManualCatch {
  catch_id: string;
  cat_id: string | null;
  microchip: string | null;
  catch_date: string;
  catch_location: string | null;
  notes: string | null;
  cat_name: string | null;
  created_at: string;
}

export interface ServiceArea {
  id: string;
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  service_type: string;
  notes: string | null;
  source_system: string | null;
  created_at: string;
}

export interface TrapperProfile {
  person_id: string;
  trapper_type: string | null;
  rescue_name: string | null;
  is_active: boolean;
  certified_date: string | null;
  notes: string | null;
  has_signed_contract: boolean;
  contract_signed_date: string | null;
  contract_areas: string[] | null;
  is_legacy_informal: boolean;
  tier: string | null;
  source_system: string | null;
}

export interface Contract {
  contract_id: string;
  person_id: string;
  contract_type: string;
  status: string;
  signed_date: string | null;
  expiration_date: string | null;
  service_area_description: string | null;
  contract_notes: string | null;
  renewed_from_contract_id: string | null;
  is_expiring_soon: boolean;
  is_expired: boolean;
  created_at: string;
}

export interface Assignment {
  assignment_id: string;
  request_id: string;
  request_address: string | null;
  request_status: string;
  assignment_type: string;
  assignment_status: string;
  assigned_at: string;
  notes: string | null;
  estimated_cat_count: number | null;
  cats_attributed: number;
}

export interface ChangeHistoryEntry {
  edit_id: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  editor: string;
  edit_source: string;
  created_at: string;
}

// ---- Unified Hook Return ----

export interface PersonDetailData {
  // Base person data (always fetched)
  person: PersonDetail | null;
  journal: JournalEntry[];
  requests: RelatedRequest[];
  trapperInfo: TrapperInfo | null;
  volunteerRoles: VolunteerRolesData | null;

  // Trapper-specific data (fetched when trapper role detected)
  trapperStats: TrapperStats | null;
  manualCatches: ManualCatch[];
  serviceAreas: ServiceArea[];
  trapperProfile: TrapperProfile | null;
  assignments: Assignment[];
  changeHistory: ChangeHistoryEntry[];
  contracts: Contract[];

  // Foster-specific data (fetched when foster role detected)
  fosterCats: FosterCat[];
  fosterAgreements: FosterAgreement[];

  // State
  loading: boolean;
  error: string | null;
  partialErrors: Record<string, string>;

  // Derived
  primaryEmail: string | undefined;
  primaryPhone: string | undefined;
  isTrapper: boolean;

  // Refetch functions
  refetchPerson: () => Promise<void>;
  refetchJournal: () => Promise<void>;
  refetchRequests: () => Promise<void>;
  refetchTrapperData: () => Promise<void>;
  refetchFosterData: () => Promise<void>;
  refetchAll: () => Promise<void>;
}

/**
 * Unified data fetching hook for person detail pages.
 *
 * Fetches base person data always, and trapper-specific data
 * when the person has a trapper role.
 *
 * @param id - Person UUID
 * @param options.initialRole - Pre-select role to determine which data to fetch initially
 */
export function usePersonDetail(
  id: string,
  options?: { initialRole?: string }
): PersonDetailData {
  // Base data
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [trapperInfo, setTrapperInfo] = useState<TrapperInfo | null>(null);
  const [volunteerRoles, setVolunteerRoles] = useState<VolunteerRolesData | null>(null);

  // Foster data
  const [fosterCats, setFosterCats] = useState<FosterCat[]>([]);
  const [fosterAgreements, setFosterAgreements] = useState<FosterAgreement[]>([]);

  // Trapper data
  const [trapperStats, setTrapperStats] = useState<TrapperStats | null>(null);
  const [manualCatches, setManualCatches] = useState<ManualCatch[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [trapperProfile, setTrapperProfile] = useState<TrapperProfile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryEntry[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<Record<string, string>>({});

  // ---- Base Fetchers ----

  const fetchPerson = useCallback(async () => {
    try {
      const data = await fetchApi<PersonDetail>(`/api/people/${id}`);
      setPerson(data);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("not found")) {
        setError("Person not found");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(`/api/journal?person_id=${id}&limit=50&include_related=true`);
      setJournal(data.entries || []);
      setPartialErrors(prev => { const { journal: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch journal:", err);
      setPartialErrors(prev => ({ ...prev, journal: err instanceof Error ? err.message : "Failed to load journal" }));
    }
  }, [id]);

  const fetchRequests = useCallback(async () => {
    try {
      const data = await fetchApi<{ requests: RelatedRequest[] }>(`/api/requests?person_id=${id}&limit=10`);
      setRequests(data.requests || []);
      setPartialErrors(prev => { const { requests: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch requests:", err);
      setPartialErrors(prev => ({ ...prev, requests: err instanceof Error ? err.message : "Failed to load requests" }));
    }
  }, [id]);

  const fetchTrapperInfo = useCallback(async () => {
    try {
      const data = await fetchApi<{ trapper_type: string; is_ffsc_trapper: boolean }>(`/api/people/${id}/trapper-stats`);
      setTrapperInfo({ trapper_type: data.trapper_type, is_ffsc_trapper: data.is_ffsc_trapper });
      setPartialErrors(prev => { const { trapperInfo: _, ...rest } = prev; return rest; });
    } catch {
      setTrapperInfo(null);
    }
  }, [id]);

  const fetchVolunteerRoles = useCallback(async () => {
    try {
      const data = await fetchApi<VolunteerRolesData>(`/api/people/${id}/roles`);
      if (data.roles && data.roles.length > 0) {
        setVolunteerRoles(data);
      } else {
        setVolunteerRoles(null);
      }
      setPartialErrors(prev => { const { volunteerRoles: _, ...rest } = prev; return rest; });
    } catch (err) {
      setVolunteerRoles(null);
      setPartialErrors(prev => ({ ...prev, volunteerRoles: err instanceof Error ? err.message : "Failed to load roles" }));
    }
  }, [id]);

  // ---- Trapper Fetchers ----

  const fetchTrapperStats = useCallback(async () => {
    try {
      const data = await fetchApi<TrapperStats>(`/api/people/${id}/trapper-stats`);
      setTrapperStats(data);
      setPartialErrors(prev => { const { trapperStats: _, ...rest } = prev; return rest; });
    } catch (err) {
      setTrapperStats(null);
      setPartialErrors(prev => ({ ...prev, trapperStats: err instanceof Error ? err.message : "Failed to load trapper stats" }));
    }
  }, [id]);

  const fetchManualCatches = useCallback(async () => {
    try {
      const data = await fetchApi<{ catches: ManualCatch[] }>(`/api/people/${id}/trapper-cats`);
      setManualCatches(data.catches || []);
      setPartialErrors(prev => { const { manualCatches: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch manual catches:", err);
      setPartialErrors(prev => ({ ...prev, manualCatches: err instanceof Error ? err.message : "Failed to load catches" }));
    }
  }, [id]);

  const fetchServiceAreas = useCallback(async () => {
    try {
      const data = await fetchApi<{ areas: ServiceArea[] }>(`/api/people/${id}/service-areas`);
      setServiceAreas(data.areas || []);
      setPartialErrors(prev => { const { serviceAreas: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch service areas:", err);
      setPartialErrors(prev => ({ ...prev, serviceAreas: err instanceof Error ? err.message : "Failed to load service areas" }));
    }
  }, [id]);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await fetchApi<{ profile: TrapperProfile | null }>(`/api/people/${id}/trapper-profile`);
      setTrapperProfile(data.profile);
      setPartialErrors(prev => { const { trapperProfile: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch trapper profile:", err);
      setPartialErrors(prev => ({ ...prev, trapperProfile: err instanceof Error ? err.message : "Failed to load profile" }));
    }
  }, [id]);

  const fetchAssignments = useCallback(async () => {
    try {
      const data = await fetchApi<{ assignments: Assignment[] }>(`/api/people/${id}/assignments`);
      setAssignments(data.assignments || []);
      setPartialErrors(prev => { const { assignments: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch assignments:", err);
      setPartialErrors(prev => ({ ...prev, assignments: err instanceof Error ? err.message : "Failed to load assignments" }));
    }
  }, [id]);

  const fetchChangeHistory = useCallback(async () => {
    try {
      const data = await fetchApi<{ history: ChangeHistoryEntry[] }>(`/api/entities/person/${id}/history?limit=20`);
      setChangeHistory(data.history || []);
      setPartialErrors(prev => { const { changeHistory: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch change history:", err);
      setPartialErrors(prev => ({ ...prev, changeHistory: err instanceof Error ? err.message : "Failed to load history" }));
    }
  }, [id]);

  const fetchContracts = useCallback(async () => {
    try {
      const data = await fetchApi<{ contracts: Contract[] }>(`/api/people/${id}/contracts`);
      setContracts(data.contracts || []);
      setPartialErrors(prev => { const { contracts: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
      setPartialErrors(prev => ({ ...prev, contracts: err instanceof Error ? err.message : "Failed to load contracts" }));
    }
  }, [id]);

  // ---- Foster Fetchers ----

  const fetchFosterCats = useCallback(async () => {
    try {
      const data = await fetchApi<{
        cats: Array<{
          cat_id: string;
          cat_name: string | null;
          microchip: string | null;
          data_source: string | null;
          relationships: Array<{
            type: string;
            confidence: string;
            source_system: string;
            effective_date: string | null;
          }>;
        }>;
      }>(`/api/people/${id}/cats?relationship=foster`);
      // Transform grouped response into flat FosterCat list
      const cats: FosterCat[] = (data.cats || []).map(c => {
        const rel = c.relationships?.[0];
        return {
          cat_id: c.cat_id,
          cat_name: c.cat_name,
          microchip: c.microchip,
          breed: null,
          source_system: rel?.source_system || c.data_source,
          confidence: rel?.confidence != null ? Number(rel.confidence) : null,
          linked_at: rel?.effective_date || null,
        };
      });
      setFosterCats(cats);
      setPartialErrors(prev => { const { fosterCats: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch foster cats:", err);
      setPartialErrors(prev => ({ ...prev, fosterCats: err instanceof Error ? err.message : "Failed to load foster cats" }));
    }
  }, [id]);

  const fetchFosterAgreements = useCallback(async () => {
    try {
      const data = await fetchApi<{ agreements: FosterAgreement[] }>(`/api/people/${id}/foster-agreements`);
      setFosterAgreements(data.agreements || []);
      setPartialErrors(prev => { const { fosterAgreements: _, ...rest } = prev; return rest; });
    } catch (err) {
      console.error("Failed to fetch foster agreements:", err);
      setPartialErrors(prev => ({ ...prev, fosterAgreements: err instanceof Error ? err.message : "Failed to load agreements" }));
    }
  }, [id]);

  // ---- Composite Fetchers ----

  const refetchTrapperData = useCallback(async () => {
    await Promise.all([
      fetchTrapperStats(),
      fetchManualCatches(),
      fetchServiceAreas(),
      fetchProfile(),
      fetchAssignments(),
      fetchChangeHistory(),
      fetchContracts(),
    ]);
  }, [fetchTrapperStats, fetchManualCatches, fetchServiceAreas, fetchProfile, fetchAssignments, fetchChangeHistory, fetchContracts]);

  const refetchFosterData = useCallback(async () => {
    await Promise.all([fetchFosterCats(), fetchFosterAgreements()]);
  }, [fetchFosterCats, fetchFosterAgreements]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      fetchPerson(),
      fetchJournal(),
      fetchRequests(),
      fetchTrapperInfo(),
      fetchVolunteerRoles(),
      refetchTrapperData(),
      refetchFosterData(),
    ]);
  }, [fetchPerson, fetchJournal, fetchRequests, fetchTrapperInfo, fetchVolunteerRoles, refetchTrapperData, refetchFosterData]);

  // ---- Initial Load ----

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      // Always fetch base data
      const baseFetches = [fetchPerson(), fetchJournal(), fetchRequests(), fetchTrapperInfo(), fetchVolunteerRoles()];

      // If we know the role, fetch role-specific data in parallel
      if (options?.initialRole === "trapper") {
        baseFetches.push(refetchTrapperData());
      }
      if (options?.initialRole === "foster") {
        baseFetches.push(refetchFosterData());
      }

      await Promise.all(baseFetches);
      setLoading(false);
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch trapper data when trapper info is detected (for person page)
  useEffect(() => {
    if (trapperInfo && !trapperStats && !options?.initialRole) {
      refetchTrapperData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trapperInfo]);

  // Fetch foster data when foster role is detected (for person page)
  useEffect(() => {
    if (
      volunteerRoles?.roles?.some(r => r.role === "foster" && r.role_status === "active") &&
      fosterCats.length === 0 &&
      !options?.initialRole
    ) {
      refetchFosterData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteerRoles]);

  // Derived values
  const primaryEmail = person?.identifiers?.find(i => i.id_type === "email" && (i.confidence ?? 1) >= 0.5)?.id_value;
  const primaryPhone = person?.identifiers?.find(i => i.id_type === "phone")?.id_value;
  const isTrapper = !!trapperInfo || !!trapperStats;

  return {
    person,
    journal,
    requests,
    trapperInfo,
    volunteerRoles,
    trapperStats,
    manualCatches,
    serviceAreas,
    trapperProfile,
    assignments,
    changeHistory,
    contracts,
    fosterCats,
    fosterAgreements,
    loading,
    error,
    partialErrors,
    primaryEmail,
    primaryPhone,
    isTrapper,
    refetchPerson: fetchPerson,
    refetchJournal: fetchJournal,
    refetchRequests: fetchRequests,
    refetchTrapperData,
    refetchFosterData,
    refetchAll,
  };
}
