"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, ApiError } from "@/lib/api-client";
import type { JournalEntry } from "@/components/sections";
import type { MediaItem } from "@/components/media";
import type {
  PlaceDetail,
  PlaceDetailData,
  RelatedRequest,
} from "@/lib/place-types";

export function usePlaceDetail(id: string): PlaceDetailData {
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [heroMedia, setHeroMedia] = useState<(MediaItem & { is_hero?: boolean })[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [requests, setRequests] = useState<RelatedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlace = useCallback(async () => {
    try {
      const data = await fetchApi<PlaceDetail>(`/api/places/${id}`);
      setPlace(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 404) {
        setError("Place not found");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(
        `/api/journal?place_id=${id}&limit=50&include_related=true`
      );
      setJournal(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  const fetchRequests = useCallback(async () => {
    try {
      const data = await fetchApi<{ requests: RelatedRequest[] }>(
        `/api/requests?place_id=${id}&limit=10`
      );
      setRequests(data.requests || []);
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    }
  }, [id]);

  const fetchHeroMedia = useCallback(async () => {
    try {
      const data = await fetchApi<{ media: (MediaItem & { is_hero?: boolean })[] }>(
        `/api/places/${id}/media`
      );
      setHeroMedia(data.media || []);
    } catch (err) {
      console.error("Failed to fetch media:", err);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchPlace(), fetchJournal(), fetchRequests(), fetchHeroMedia()]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchPlace, fetchJournal, fetchRequests, fetchHeroMedia]);

  return {
    place,
    heroMedia,
    journal,
    requests,
    loading,
    error,
    fetchPlace,
    fetchJournal,
    fetchHeroMedia,
  };
}
