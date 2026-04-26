"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import type { JournalEntry } from "@/components/sections";
import type { RequestDetail } from "@/app/requests/[id]/types";

interface TripReportRow {
  report_id: string;
  trapper_name: string | null;
  visit_date: string;
  cats_trapped: number;
  cats_returned: number;
  traps_set: number | null;
  traps_retrieved: number | null;
  cats_seen: number | null;
  eartipped_seen: number | null;
  issues_encountered: string[];
  issue_details: string | null;
  site_notes: string | null;
  is_final_visit: boolean;
  submitted_from: string;
  created_at: string;
}

interface RelatedPersonDisplay {
  id: string;
  person_id: string;
  relationship_type: string;
  relationship_notes: string | null;
  notify_before_release: boolean;
  preferred_language: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface RequestDetailData {
  request: RequestDetail | null;
  loading: boolean;
  error: string | null;
  previousStatus: string | null;
  journalEntries: JournalEntry[];
  tripReports: TripReportRow[];
  relatedPeople: RelatedPersonDisplay[];
  mapUrl: string | null;
  refreshRequest: () => Promise<void>;
  fetchJournalEntries: () => Promise<void>;
  fetchTripReports: () => Promise<void>;
  fetchRelatedPeople: () => Promise<void>;
  setPreviousStatus: (status: string | null) => void;
  setError: (error: string | null) => void;
}

export type { TripReportRow, RelatedPersonDisplay };

export function useRequestDetail(requestId: string): RequestDetailData {
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousStatus, setPreviousStatus] = useState<string | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [tripReports, setTripReports] = useState<TripReportRow[]>([]);
  const [relatedPeople, setRelatedPeople] = useState<RelatedPersonDisplay[]>([]);
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const fetchRelatedPeople = useCallback(async () => {
    try {
      const data = await fetchApi<{ related_people: RelatedPersonDisplay[] }>(`/api/requests/${requestId}/related-people`);
      setRelatedPeople(data.related_people || []);
    } catch {
      // Non-critical
    }
  }, [requestId]);

  const fetchTripReports = useCallback(async () => {
    try {
      const data = await fetchApi<{ reports: TripReportRow[] }>(`/api/requests/${requestId}/trip-report`);
      setTripReports(data.reports || []);
    } catch (err) {
      console.error("Failed to fetch trip reports:", err);
    }
  }, [requestId]);

  const fetchJournalEntries = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(`/api/journal?request_id=${requestId}&include_related=true`);
      setJournalEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal entries:", err);
    }
  }, [requestId]);

  const refreshRequest = useCallback(async () => {
    try {
      const data = await fetchApi<RequestDetail>(`/api/requests/${requestId}`);
      setRequest(data);
    } catch {
      /* refresh failure is non-critical, keep existing data */
    }
  }, [requestId]);

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const data = await fetchApi<RequestDetail>(`/api/requests/${requestId}`);
        setRequest(data);
        if (data.place_coordinates) {
          setMapUrl(`https://maps.googleapis.com/maps/api/staticmap?center=${data.place_coordinates.lat},${data.place_coordinates.lng}&zoom=16&size=400x200&markers=color:green%7C${data.place_coordinates.lat},${data.place_coordinates.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`);
        }
      } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr.code === 404 ? "Request not found" : apiErr.message || "Failed to load request");
      } finally {
        setLoading(false);
      }
    };
    fetchRequest();
    fetchJournalEntries();
    fetchTripReports();
    fetchRelatedPeople();
  }, [requestId, fetchJournalEntries, fetchTripReports, fetchRelatedPeople]);

  return {
    request,
    loading,
    error,
    previousStatus,
    journalEntries,
    tripReports,
    relatedPeople,
    mapUrl,
    refreshRequest,
    fetchJournalEntries,
    fetchTripReports,
    fetchRelatedPeople,
    setPreviousStatus,
    setError,
  };
}
