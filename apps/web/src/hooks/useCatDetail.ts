"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchApi, ApiError } from "@/lib/api-client";
import type { JournalEntry } from "@/components/sections";
import type {
  CatDetail,
  CatDetailData,
  ClinicalNotesData,
  ScheduledAppointment,
  FelvFivStatus,
  CatVital,
} from "@/lib/cat-types";

function computeFelvFivStatus(cat: CatDetail): FelvFivStatus {
  const getFivTest = () =>
    cat.tests?.find(
      (t) =>
        t.test_type === "fiv" ||
        t.test_type === "felv_fiv" ||
        t.test_type === "felv_fiv_combo"
    );

  const getFelvTest = () =>
    cat.tests?.find(
      (t) =>
        t.test_type === "felv" ||
        t.test_type === "felv_fiv" ||
        t.test_type === "felv_fiv_combo"
    );

  const parseComboResult = (
    result: string | undefined,
    disease: "fiv" | "felv"
  ) => {
    if (!result) return null;
    const lower = result.toLowerCase();
    if (lower.includes(disease)) {
      if (
        lower.includes(`${disease} positive`) ||
        lower.includes(`${disease}: positive`)
      )
        return "positive";
      if (
        lower.includes(`${disease} negative`) ||
        lower.includes(`${disease}: negative`)
      )
        return "negative";
    }
    if (lower === "positive" || lower === "negative") return lower;
    return null;
  };

  const fivTest = getFivTest();
  const felvTest = getFelvTest();

  let fivResult: string | null = null;
  let felvResult: string | null = null;
  let testDate: string | null = null;

  if (fivTest) {
    testDate = fivTest.test_date;
    if (fivTest.test_type === "fiv") {
      fivResult = fivTest.result?.toLowerCase() || null;
    } else {
      fivResult =
        parseComboResult(fivTest.result, "fiv") ||
        fivTest.result?.toLowerCase() ||
        null;
    }
  }

  if (felvTest) {
    testDate = testDate || felvTest.test_date;
    if (felvTest.test_type === "felv") {
      felvResult = felvTest.result?.toLowerCase() || null;
    } else {
      felvResult =
        parseComboResult(felvTest.result, "felv") ||
        felvTest.result?.toLowerCase() ||
        null;
    }
  }

  return {
    fivResult,
    felvResult,
    testDate,
    hasAnyTest: !!(fivTest || felvTest),
    anyPositive: fivResult === "positive" || felvResult === "positive",
    allNegative:
      (fivResult === "negative" || !fivResult) &&
      (felvResult === "negative" || !felvResult) &&
      !!(fivTest || felvTest),
  };
}

/**
 * Data fetching hook for the cat detail page.
 * Fetches cat data, appointments, journal entries, and clinical notes.
 */
export function useCatDetail(id: string): CatDetailData {
  const [cat, setCat] = useState<CatDetail | null>(null);
  const [appointments, setAppointments] = useState<ScheduledAppointment[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNotesData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCat = useCallback(async () => {
    try {
      const data = await fetchApi<CatDetail>(`/api/cats/${id}`);
      setCat(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 404) {
        setError("Cat not found");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }, [id]);

  const fetchAppointments = useCallback(async () => {
    try {
      const data = await fetchApi<{ appointments: ScheduledAppointment[] }>(
        `/api/appointments?cat_id=${id}&limit=20`
      );
      setAppointments(data.appointments || []);
    } catch (err) {
      console.error("Failed to fetch appointments:", err);
    }
  }, [id]);

  const fetchJournal = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: JournalEntry[] }>(
        `/api/journal?cat_id=${id}&limit=50&include_related=true`
      );
      setJournal(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, [id]);

  const fetchClinicalNotes = useCallback(async () => {
    try {
      const data = await fetchApi<ClinicalNotesData>(`/api/cats/${id}/notes`);
      setClinicalNotes(data);
    } catch {
      // Non-critical — scrape data may not exist for all cats
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([
        fetchCat(),
        fetchAppointments(),
        fetchJournal(),
        fetchClinicalNotes(),
      ]);
      setLoading(false);
    };

    loadData();
  }, [id, fetchCat, fetchAppointments, fetchJournal, fetchClinicalNotes]);

  // Expose setCat for local state updates (e.g., inline clinic day edits)
  const updateCatLocally = useCallback(
    (updater: (prev: CatDetail) => CatDetail) => {
      setCat((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  const felvFivStatus = useMemo(
    () => (cat ? computeFelvFivStatus(cat) : { fivResult: null, felvResult: null, testDate: null, hasAnyTest: false, anyPositive: false, allNegative: false }),
    [cat]
  );

  const latestWeight = useMemo(
    () => cat?.vitals?.find((v) => v.weight_lbs != null) || null,
    [cat]
  );

  const latestTemp = useMemo(
    () => cat?.vitals?.find((v) => v.temperature_f != null) || null,
    [cat]
  );

  return {
    cat,
    appointments,
    journal,
    clinicalNotes,
    loading,
    error,
    fetchCat,
    fetchJournal,
    felvFivStatus,
    latestWeight,
    latestTemp,
  };
}

// Re-export updateCatLocally setter for CatDetailShell
export type { CatDetail, CatDetailData };
