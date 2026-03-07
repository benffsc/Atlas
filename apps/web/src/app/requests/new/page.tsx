"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackButton } from "@/components/common";
import { PlaceResolver } from "@/components/forms";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { usePersonSuggestion } from "@/hooks/usePersonSuggestion";
import { PersonSuggestionBanner } from "@/components/ui/PersonSuggestionBanner";
import { formatPhone } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, TRANSITIONS, getStatusColor } from "@/lib/design-tokens";
import { INPUT, MB_LG, MB_XL, FLEX_WRAP, SECTION_DIVIDER } from "../styles";
import {
  OWNERSHIP_OPTIONS,
  HANDLEABILITY_OPTIONS,
  FIXED_STATUS_OPTIONS,
  IMPORTANT_NOTE_OPTIONS,
  URGENCY_REASON_OPTIONS,
} from "@/lib/intake-options";
import {
  EntryModeSelector,
  ActiveRequestWarning,
  CompletionSection,
  DEFAULT_COMPLETION_DATA,
  type EntryMode,
  type CompletionData,
} from "@/components/request-entry";
import type { CreateRequestBody } from "@/lib/types/request-contracts";

interface DuplicateMatch {
  request_id: string;
  summary: string | null;
  status: string;
  trapper_name: string | null;
  place_address: string | null;
  place_city: string | null;
  created_at: string;
  match_type: "exact_place" | "same_phone" | "same_email" | "nearby_address";
  distance_m: number | null;
}

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string;
  match_strength: string;
}


interface PersonAddress {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  role: string;
  confidence: number | null;
}

interface PersonDetails {
  person_id: string;
  display_name: string;
  email?: string;
  phone?: string;
  addresses?: PersonAddress[];
}

const PROPERTY_TYPE_OPTIONS = [
  { value: "private_home", label: "Private Home" },
  { value: "apartment_complex", label: "Apartment Complex" },
  { value: "mobile_home_park", label: "Mobile Home Park" },
  { value: "business", label: "Business" },
  { value: "farm_ranch", label: "Farm/Ranch" },
  { value: "public_park", label: "Public Park" },
  { value: "industrial", label: "Industrial" },
  { value: "other", label: "Other" },
];

const PERMISSION_OPTIONS = [
  { value: "yes", label: "Yes - Permission granted" },
  { value: "pending", label: "Pending - Waiting for response" },
  { value: "no", label: "No - Permission denied" },
  { value: "not_needed", label: "Not needed - Public property" },
  { value: "unknown", label: "Unknown" },
];

const COLONY_DURATION_OPTIONS = [
  { value: "under_1_month", label: "Less than 1 month" },
  { value: "1_to_6_months", label: "1-6 months" },
  { value: "6_to_24_months", label: "6 months - 2 years" },
  { value: "over_2_years", label: "More than 2 years" },
  { value: "unknown", label: "Unknown" },
];

const COUNT_CONFIDENCE_OPTIONS = [
  { value: "exact", label: "Exact count" },
  { value: "good_estimate", label: "Good estimate" },
  { value: "rough_guess", label: "Rough guess" },
  { value: "unknown", label: "Unknown" },
];

const EARTIP_ESTIMATE_OPTIONS = [
  { value: "none", label: "None ear-tipped" },
  { value: "few", label: "A few (less than 25%)" },
  { value: "some", label: "Some (25-50%)" },
  { value: "most", label: "Most (50-75%)" },
  { value: "all", label: "All or almost all (75%+)" },
  { value: "unknown", label: "Unknown" },
];

// URGENCY_REASON_OPTIONS imported from @/lib/intake-options

function NewRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Entry Mode (phone intake, paper entry, quick complete)
  const [entryMode, setEntryMode] = useState<EntryMode>("phone");
  const [completionData, setCompletionData] = useState<CompletionData>(DEFAULT_COMPLETION_DATA);

  // Smart matching - duplicate detection
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicatesDismissed, setDuplicatesDismissed] = useState(false);

  // Location
  const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null);
  const [propertyType, setPropertyType] = useState("");
  const [locationDescription, setLocationDescription] = useState("");

  // Contact - Requestor
  const [requestorMode, setRequestorMode] = useState<"search" | "create">("search");
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<SearchResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonDetails | null>(null);
  const [searchingPeople, setSearchingPeople] = useState(false);
  // Requestor fields (editable for both search and create modes)
  const [requestorFirstName, setRequestorFirstName] = useState("");
  const [requestorLastName, setRequestorLastName] = useState("");
  const [requestorPhone, setRequestorPhone] = useState("");
  const [requestorEmail, setRequestorEmail] = useState("");
  // Contact info editing (for existing person)
  const [editingContactInfo, setEditingContactInfo] = useState(false);
  const [originalContactInfo, setOriginalContactInfo] = useState<{ phone: string; email: string } | null>(null);
  // Property authority
  const [hasPropertyAuthority, setHasPropertyAuthority] = useState(true);
  const [propertyOwnerName, setPropertyOwnerName] = useState("");
  const [propertyOwnerPhone, setPropertyOwnerPhone] = useState("");
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [bestContactTimes, setBestContactTimes] = useState("");

  // Permission & Access
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [accessNotes, setAccessNotes] = useState("");
  const [trapsOvernightSafe, setTrapsOvernightSafe] = useState<boolean | null>(null);
  const [accessWithoutContact, setAccessWithoutContact] = useState<boolean | null>(null);

  // Trapping Logistics (FFS-151)
  const [showTrappingLogistics, setShowTrappingLogistics] = useState(false);
  const [ownershipStatus, setOwnershipStatus] = useState("");
  const [handleability, setHandleability] = useState("");
  const [fixedStatus, setFixedStatus] = useState("");
  const [dogsOnSite, setDogsOnSite] = useState("");
  const [trapSavvy, setTrapSavvy] = useState("");
  const [previousTnr, setPreviousTnr] = useState("");
  const [bestTrappingTime, setBestTrappingTime] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [importantNotes, setImportantNotes] = useState<string[]>([]);

  // Request Purpose (multi-select)
  const [requestPurposes, setRequestPurposes] = useState<string[]>(["tnr"]);
  const [wellnessCatCount, setWellnessCatCount] = useState<number | "">("");

  // Helper to toggle purpose selection
  const togglePurpose = (purpose: string) => {
    setRequestPurposes(prev => {
      if (prev.includes(purpose)) {
        // Don't allow empty selection - keep at least one
        if (prev.length === 1) return prev;
        return prev.filter(p => p !== purpose);
      }
      return [...prev, purpose];
    });
  };

  // Computed: check if specific purposes are selected
  const hasTnr = requestPurposes.includes("tnr");
  const hasWellness = requestPurposes.includes("wellness");
  const hasRelocation = requestPurposes.includes("relocation");
  const hasRescue = requestPurposes.includes("rescue");

  // About the Cats
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");
  const [peakCount, setPeakCount] = useState<number | "">("");  // MIG_2532: Beacon critical
  const [countConfidence, setCountConfidence] = useState("unknown");
  const [colonyDuration, setColonyDuration] = useState("unknown");
  const [awarenessDuration, setAwarenessDuration] = useState("unknown");  // MIG_2532: How long requester aware
  const [eartipCount, setEartipCount] = useState<number | "">("");
  const [eartipEstimate, setEartipEstimate] = useState("unknown");
  const [catsAreFriendly, setCatsAreFriendly] = useState<boolean | null>(null);

  // MIG_2532: Third-party tracking (affects requester intelligence)
  const [isThirdPartyReport, setIsThirdPartyReport] = useState(false);
  const [thirdPartyRelationship, setThirdPartyRelationship] = useState("");

  // MIG_2532: Service area
  const [county, setCounty] = useState("Sonoma");

  // Kittens
  const [hasKittens, setHasKittens] = useState(false);
  const [kittenCount, setKittenCount] = useState<number | "">("");
  const [kittenAgeWeeks, setKittenAgeWeeks] = useState<number | "">("");
  const [kittenAgeEstimate, setKittenAgeEstimate] = useState("");
  const [kittenMixedAgesDescription, setKittenMixedAgesDescription] = useState("");
  const [kittenBehavior, setKittenBehavior] = useState("");
  const [kittenContained, setKittenContained] = useState("");
  const [momPresent, setMomPresent] = useState("");
  const [momFixed, setMomFixed] = useState("");
  const [canBringIn, setCanBringIn] = useState("");
  const [kittenNotes, setKittenNotes] = useState("");

  // Feeding
  const [isBeingFed, setIsBeingFed] = useState<boolean | null>(null);
  const [feederName, setFeederName] = useState("");
  const [feedingFrequency, setFeedingFrequency] = useState("");
  const [feedingLocation, setFeedingLocation] = useState("");  // MIG_2532: Where cats are fed
  const [feedingTime, setFeedingTime] = useState("");  // MIG_2532: What time fed
  const [bestTimesSeen, setBestTimesSeen] = useState("");

  // Urgency
  const [urgencyReasons, setUrgencyReasons] = useState<string[]>([]);
  const [urgencyDeadline, setUrgencyDeadline] = useState("");
  const [urgencyNotes, setUrgencyNotes] = useState("");
  const [priority, setPriority] = useState("normal");

  // Additional Details
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState(""); // Case info - situation description
  const [internalNotes, setInternalNotes] = useState(""); // Staff working notes

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    success: boolean;
    status: "promoted" | "needs_review" | "rejected" | "pending";
    request_id?: string;
    raw_id?: string;
    message?: string;
    review_reason?: string;
    errors?: Record<string, string>;
  } | null>(null);

  // Person suggestion by email/phone (duplicate prevention)
  const personSuggestion = usePersonSuggestion({
    email: requestorEmail,
    phone: requestorPhone,
    enabled: !selectedPerson,
  });

  // Computed: should show exact ear-tip count vs estimate
  const showExactEartipCount = typeof estimatedCatCount === "number" && estimatedCatCount <= 5;

  // Pre-load place from query param
  useEffect(() => {
    const placeId = searchParams.get("place_id");
    if (placeId && !selectedPlace) {
      fetchApi<{ place_id: string; display_name: string; formatted_address: string; locality: string }>(`/api/places/${placeId}`)
        .then((place) => {
          if (place) {
            setSelectedPlace({
              place_id: place.place_id,
              display_name: place.display_name,
              formatted_address: place.formatted_address,
              locality: place.locality,
            });
          }
        })
        .catch((err) => console.error("Failed to pre-load place:", err));
    }
  }, [searchParams, selectedPlace]);

  // Pre-populate from intake submission (Phase 5: Unified Form Integration)
  useEffect(() => {
    const intakeId = searchParams.get("intake_id");
    if (!intakeId) return;

    // Set entry mode to paper (transcribing from intake)
    setEntryMode("paper");

    // Fetch intake submission data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchApi<{ submission: any }>(`/api/intake/${intakeId}`)
      .then((data) => {
        if (!data?.submission) return;
        const s = data.submission;

        // Pre-fill contact info
        if (s.first_name || s.last_name || s.submitter_name) {
          const nameParts = (s.submitter_name || "").split(" ");
          setRequestorFirstName(s.first_name || nameParts[0] || "");
          setRequestorLastName(s.last_name || nameParts.slice(1).join(" ") || "");
        }
        if (s.email) setRequestorEmail(s.email);
        if (s.phone) setRequestorPhone(s.phone);

        // Pre-fill location (if place already resolved)
        if (s.matched_place_id) {
          fetchApi<{ place_id: string; display_name: string; formatted_address?: string; locality?: string; place?: { place_id: string; display_name: string; formatted_address?: string; locality?: string } }>(`/api/places/${s.matched_place_id}`)
            .then((result) => {
              const place = result?.place || result;
              if (place?.place_id) {
                setSelectedPlace({
                  place_id: place.place_id,
                  display_name: place.display_name,
                  formatted_address: place.formatted_address || (s.geo_formatted_address as string) || (s.cats_address as string),
                  locality: place.locality || (s.cats_city as string),
                });
              }
            })
            .catch(() => { /* fire-and-forget: place pre-fill is best-effort */ });
        } else if (s.geo_formatted_address || s.cats_address) {
          // Use raw address - PlaceResolver will handle it
          setSelectedPlace({
            place_id: null,
            display_name: s.geo_formatted_address || s.cats_address,
            formatted_address: s.geo_formatted_address || s.cats_address,
            locality: s.cats_city,
          } as never); // Type assertion - PlaceResolver handles this
        }

        // Pre-fill cat info
        if (s.cat_count_estimate) setEstimatedCatCount(s.cat_count_estimate);
        if (s.has_kittens !== null) setHasKittens(s.has_kittens);
        if (s.kitten_count) setKittenCount(s.kitten_count);

        // Pre-fill property info
        if (s.ownership_status) setPropertyType(s.ownership_status);

        // Pre-fill notes
        if (s.situation_description) setNotes(s.situation_description);

        // Pre-fill urgency
        if (s.is_emergency) {
          setUrgencyReasons(["emergency"]);
        }

        // Store intake ID for reference (for linking back after creation)
      })
      .catch((err) => console.error("Failed to load intake:", err));
  }, [searchParams]);

  // Debounced person search
  useEffect(() => {
    if (personSearch.length < 2 || selectedPerson) {
      setPersonResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingPeople(true);
      try {
        const data = await fetchApi<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(personSearch)}&type=person&limit=5`
        );
        setPersonResults(data.results || []);
      } catch (err) {
        console.error("Person search error:", err);
      } finally {
        setSearchingPeople(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [personSearch, selectedPerson]);

  // Smart matching - check for duplicate requests when place or contact info changes
  const checkDuplicates = useCallback(async () => {
    // Need at least one criterion to check
    if (!selectedPlace?.place_id && !requestorPhone && !requestorEmail) {
      setDuplicateMatches([]);
      return;
    }

    // Don't re-check if user dismissed the warning
    if (duplicatesDismissed) return;

    setCheckingDuplicates(true);
    try {
      const data = await postApi<{ active_requests: DuplicateMatch[] }>("/api/requests/check-duplicates", {
        place_id: selectedPlace?.place_id || null,
        phone: requestorPhone || null,
        email: requestorEmail || null,
      });
      setDuplicateMatches(data.active_requests || []);
    } catch (err) {
      console.error("Duplicate check error:", err);
    } finally {
      setCheckingDuplicates(false);
    }
  }, [selectedPlace?.place_id, requestorPhone, requestorEmail, duplicatesDismissed]);

  // Debounced duplicate check
  useEffect(() => {
    const timer = setTimeout(checkDuplicates, 600);
    return () => clearTimeout(timer);
  }, [checkDuplicates]);

  // Reset dismissed state when place changes
  useEffect(() => {
    setDuplicatesDismissed(false);
  }, [selectedPlace?.place_id]);

  // Auto-fill the title with requester name when a requester is selected/entered
  useEffect(() => {
    const requesterName = [requestorFirstName, requestorLastName].filter(Boolean).join(" ").trim();
    // Only auto-fill if summary is empty and we have a requester name
    if (requesterName && !summary) {
      setSummary(requesterName);
    }
  }, [requestorFirstName, requestorLastName]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPerson = async (result: SearchResult) => {
    try {
      // Fetch person details and addresses in parallel
      const [person, addressData] = await Promise.all([
        fetchApi<{ person_id: string; display_name: string; identifiers?: { id_type: string; id_value: string }[] }>(`/api/people/${result.entity_id}`),
        fetchApi<{ addresses: PersonAddress[] }>(`/api/people/${result.entity_id}/addresses`).catch(() => ({ addresses: [] as PersonAddress[] })),
      ]);

      // Extract email and phone from identifiers (API returns id_value, not id_value_norm)
      const emailId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "email");
      const phoneId = person.identifiers?.find((id: { id_type: string }) => id.id_type === "phone");

      const email = emailId?.id_value || "";
      const phone = phoneId?.id_value || "";

      // Get addresses if available
      const addresses: PersonAddress[] = addressData.addresses || [];
      setSelectedPerson({
        person_id: person.person_id,
        display_name: person.display_name,
        email,
        phone,
        addresses,
      });
      // Pre-fill the fields
      const nameParts = person.display_name?.split(" ") || [];
      setRequestorFirstName(nameParts[0] || "");
      setRequestorLastName(nameParts.slice(1).join(" ") || "");
      setRequestorEmail(email);
      setRequestorPhone(phone);
      // Track original values for change detection
      setOriginalContactInfo({ phone, email });
      setEditingContactInfo(false);
      setPersonSearch("");
      setPersonResults([]);
    } catch (err) {
      console.error("Failed to fetch person details:", err);
    }
  };

  const handleSuggestionSelect = (person: Parameters<typeof personSuggestion.selectPerson>[0]) => {
    const nameParts = person.display_name.split(" ");
    setSelectedPerson({
      person_id: person.person_id,
      display_name: person.display_name,
      email: person.email || "",
      phone: person.phone || "",
      addresses: person.addresses?.map(a => ({
        place_id: a.place_id,
        formatted_address: a.formatted_address,
        display_name: null,
        role: a.role,
        confidence: null,
      })),
    });
    setRequestorFirstName(nameParts[0] || "");
    setRequestorLastName(nameParts.slice(1).join(" ") || "");
    setRequestorEmail(person.email || requestorEmail);
    setRequestorPhone(person.phone || requestorPhone);
    setOriginalContactInfo({ phone: person.phone || "", email: person.email || "" });
    setEditingContactInfo(false);
    setRequestorMode("search");
    personSuggestion.selectPerson(person);
  };

  const clearPlace = () => {
    setSelectedPlace(null);
  };

  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setSelectedPlace(place);
  };

  const clearPerson = () => {
    setSelectedPerson(null);
    setPersonSearch("");
    setRequestorFirstName("");
    setRequestorLastName("");
    setRequestorEmail("");
    setRequestorPhone("");
    setEditingContactInfo(false);
    setOriginalContactInfo(null);
    personSuggestion.reset();
  };

  // Use a known address from the selected person as the cat location
  const useKnownAddress = (address: PersonAddress) => {
    setSelectedPlace({
      place_id: address.place_id,
      display_name: address.display_name || address.formatted_address,
      formatted_address: address.formatted_address,
      locality: null,
    });
  };

  const toggleUrgencyReason = (reason: string) => {
    setUrgencyReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  };

  const toggleImportantNote = (note: string) => {
    setImportantNotes((prev) =>
      prev.includes(note) ? prev.filter((n) => n !== note) : [...prev, note]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedPlace && !summary) {
      setError("Please select a location or provide a request title");
      return;
    }

    setSubmitting(true);

    try {
      interface RequestPipelineResult {
        success: boolean;
        status: "promoted" | "needs_review" | "rejected" | "pending";
        request_id?: string;
        raw_id?: string;
        message?: string;
        review_reason?: string;
        errors?: Record<string, string>;
      }

      const requestBody: CreateRequestBody = {
        // Request Purpose - send primary and all selected
        // Priority: tnr > relocation > rescue > wellness (for primary)
        request_purpose: hasTnr ? "tnr" : hasRelocation ? "relocation" : hasRescue ? "rescue" : "wellness",
        request_purposes: requestPurposes, // Full array for notes/future use
        // Location
        place_id: selectedPlace?.place_id || null,
        property_type: propertyType || null,
        location_description: locationDescription || null,
        // Contact - Requestor
        requester_person_id: selectedPerson?.person_id || null,
        raw_requester_name: !selectedPerson && (requestorFirstName || requestorLastName)
          ? `${requestorFirstName} ${requestorLastName}`.trim()
          : null,
        raw_requester_phone: requestorPhone || null,
        raw_requester_email: requestorEmail || null,
        // Property authority
        property_owner_name: !hasPropertyAuthority ? propertyOwnerName || null : null,
        property_owner_phone: !hasPropertyAuthority ? propertyOwnerPhone || null : null,
        authorization_pending: !hasPropertyAuthority ? authorizationPending : false,
        best_contact_times: bestContactTimes || null,
        // Permission & Access
        permission_status: permissionStatus,
        access_notes: accessNotes || null,
        traps_overnight_safe: trapsOvernightSafe,
        access_without_contact: accessWithoutContact,
        // About the Cats
        estimated_cat_count: estimatedCatCount !== "" ? estimatedCatCount : null,
        peak_count: peakCount !== "" ? peakCount : null,  // MIG_2532: Beacon critical
        wellness_cat_count: hasWellness ? (wellnessCatCount !== "" ? wellnessCatCount : null) : null,
        count_confidence: countConfidence,
        colony_duration: colonyDuration,
        awareness_duration: awarenessDuration,  // MIG_2532
        eartip_count: showExactEartipCount ? (eartipCount !== "" ? eartipCount : null) : null,
        eartip_estimate: !showExactEartipCount ? eartipEstimate : null,
        cats_are_friendly: catsAreFriendly,
        // MIG_2532: Third-party tracking
        is_third_party_report: isThirdPartyReport,
        third_party_relationship: isThirdPartyReport ? thirdPartyRelationship || null : null,
        // MIG_2532: Service area
        county: county || "Sonoma",
        // Kittens
        has_kittens: hasKittens,
        kitten_count: hasKittens ? (kittenCount !== "" ? kittenCount : null) : null,
        kitten_age_weeks: hasKittens ? (kittenAgeWeeks !== "" ? kittenAgeWeeks : null) : null,
        kitten_age_estimate: hasKittens ? (kittenAgeEstimate || null) : null,
        kitten_mixed_ages_description: hasKittens && kittenAgeEstimate === "mixed" ? (kittenMixedAgesDescription || null) : null,
        kitten_behavior: hasKittens ? (kittenBehavior || null) : null,
        kitten_contained: hasKittens ? (kittenContained || null) : null,
        mom_present: hasKittens ? (momPresent || null) : null,
        mom_fixed: hasKittens && momPresent === "yes" ? (momFixed || null) : null,
        can_bring_in: hasKittens ? (canBringIn || null) : null,
        kitten_notes: hasKittens ? (kittenNotes || null) : null,
        // Feeding
        is_being_fed: isBeingFed,
        feeder_name: isBeingFed ? (feederName || null) : null,
        feeding_frequency: isBeingFed ? (feedingFrequency || null) : null,
        feeding_location: isBeingFed ? (feedingLocation || null) : null,  // MIG_2532
        feeding_time: isBeingFed ? (feedingTime || null) : null,  // MIG_2532
        best_times_seen: bestTimesSeen || null,
        // Urgency
        urgency_reasons: urgencyReasons.length > 0 ? urgencyReasons : null,
        urgency_deadline: urgencyDeadline || null,
        urgency_notes: urgencyNotes || null,
        priority,
        // Trapping Logistics (FFS-151)
        ownership_status: ownershipStatus || null,
        handleability: handleability || null,
        fixed_status: fixedStatus || null,
        dogs_on_site: dogsOnSite || null,
        trap_savvy: trapSavvy || null,
        previous_tnr: previousTnr || null,
        best_trapping_time: bestTrappingTime || null,
        cat_description: catDescription || null,
        important_notes: importantNotes.length > 0 ? importantNotes : null,
        // Additional
        summary: summary || null,
        notes: notes || null,
        internal_notes: internalNotes || null,
        created_by: "app_user",
        // Entry mode and completion data
        entry_mode: entryMode,
        initial_status: entryMode === "complete" ? "completed" : "new",
        completion_data: entryMode === "complete" ? {
          final_cat_count: completionData.final_cat_count ?? null,
          eartips_observed: completionData.eartips_observed ?? null,
          cats_altered_today: completionData.cats_altered_today ?? null,
          observation_notes: completionData.observation_notes || null,
          colony_complete: completionData.colony_complete,
          requester_followup: completionData.requester_followup,
          refer_partner: completionData.refer_partner,
          partner_name: completionData.partner_name || null,
        } : undefined,
      };

      const result = await postApi<RequestPipelineResult>("/api/requests", requestBody);

      // Handle the new pipeline response format
      setSubmissionResult({
        success: result.success,
        status: result.status,
        request_id: result.request_id,
        raw_id: result.raw_id,
        message: result.message,
        review_reason: result.review_reason,
        errors: result.errors,
      });

      // Only auto-redirect if successfully promoted
      if (result.status === "promoted" && result.request_id) {
        // Small delay to show success state
        setTimeout(() => {
          router.push(`/requests/${result.request_id}`);
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while creating request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <BackButton fallbackHref="/requests" />

      <h1 style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>New FFR Request</h1>

      {/* Entry Mode Selector */}
      <div style={{ marginBottom: "1.5rem" }}>
        <EntryModeSelector value={entryMode} onChange={setEntryMode} />
      </div>

      {/* Submission Result Modal */}
      {submissionResult && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              padding: "2rem",
              maxWidth: "500px",
              width: "90%",
              textAlign: "center",
            }}
          >
            {/* Promoted - Success */}
            {submissionResult.status === "promoted" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: BORDERS.radius.full,
                    background: COLORS.success,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: `0 auto ${SPACING.lg}`,
                    color: COLORS.white,
                    fontSize: TYPOGRAPHY.size['4xl'],
                  }}
                >
                  &#10003;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Created</h2>
                <p className="text-muted" style={MB_LG}>
                  Your request has been saved and is ready for review.
                </p>
                <p className="text-sm text-muted">Redirecting...</p>
              </>
            )}

            {/* Needs Review */}
            {submissionResult.status === "needs_review" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: BORDERS.radius.full,
                    background: COLORS.warning,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: `0 auto ${SPACING.lg}`,
                    color: COLORS.black,
                    fontSize: TYPOGRAPHY.size['4xl'],
                  }}
                >
                  !
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Saved - Needs Review</h2>
                <p className="text-muted" style={MB_LG}>
                  {submissionResult.message || "Your request has been saved but requires human review before activation."}
                </p>
                {submissionResult.review_reason && (
                  <p
                    style={{
                      background: "var(--bg-muted)",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <strong>Reason:</strong> {submissionResult.review_reason}
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                  <button onClick={() => router.push("/requests")}>
                    View All Requests
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionResult(null)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Create Another
                  </button>
                </div>
              </>
            )}

            {/* Rejected - Validation Failed */}
            {submissionResult.status === "rejected" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: BORDERS.radius.full,
                    background: COLORS.error,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: `0 auto ${SPACING.lg}`,
                    color: COLORS.white,
                    fontSize: TYPOGRAPHY.size['4xl'],
                  }}
                >
                  &#10005;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Validation Failed</h2>
                <p className="text-muted" style={MB_LG}>
                  {submissionResult.message || "The request failed validation and cannot be created."}
                </p>
                {submissionResult.errors && Object.keys(submissionResult.errors).length > 0 && (
                  <div
                    style={{
                      background: "var(--bg-muted)",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      textAlign: "left",
                      marginBottom: "1rem",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "0.5rem" }}>Errors:</strong>
                    <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                      {Object.entries(submissionResult.errors).map(([field, msg]) => (
                        <li key={field} style={{ fontSize: "0.9rem" }}>
                          <strong>{field}:</strong> {msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSubmissionResult(null)}
                >
                  Fix and Retry
                </button>
              </>
            )}

            {/* Pending - Awaiting Processing */}
            {submissionResult.status === "pending" && (
              <>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: BORDERS.radius.full,
                    background: COLORS.info,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: `0 auto ${SPACING.lg}`,
                    color: COLORS.white,
                    fontSize: TYPOGRAPHY.size['4xl'],
                  }}
                >
                  &#8987;
                </div>
                <h2 style={{ marginBottom: "0.5rem" }}>Request Saved</h2>
                <p className="text-muted" style={MB_LG}>
                  {submissionResult.message || "Your request has been saved and is awaiting processing."}
                </p>
                <p className="text-sm text-muted" style={MB_LG}>
                  Reference ID: {submissionResult.raw_id?.slice(0, 8)}...
                </p>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                  <button onClick={() => router.push("/requests")}>
                    View All Requests
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionResult(null)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Create Another
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div style={{
        display: 'flex',
        gap: SPACING.xs,
        marginBottom: SPACING.xl,
        padding: `${SPACING.sm} 0`,
        overflowX: 'auto',
      }}>
        {['Location', 'Requestor', 'Access', 'Cats', 'Kittens', 'Feeding', 'Urgency', 'Details'].map((step, i) => (
          <a
            key={step}
            href={`#section-${i + 1}`}
            style={{
              padding: `${SPACING.xs} ${SPACING.sm}`,
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: TYPOGRAPHY.weight.medium,
              color: COLORS.textSecondary,
              background: COLORS.gray100,
              borderRadius: BORDERS.radius.full,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: `background ${TRANSITIONS.fast}`,
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = COLORS.gray200; }}
            onMouseOut={(e) => { e.currentTarget.style.background = COLORS.gray100; }}
          >
            {i + 1}. {step}
          </a>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* SECTION 1: Location */}
        <div id="section-1" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Cat Location</h2>

          {/* Known addresses from selected person */}
          {selectedPerson?.addresses && selectedPerson.addresses.length > 0 && !selectedPlace && (
            <div
              style={{
                marginBottom: "1rem",
                padding: "1rem",
                background: "var(--success-bg, #d4edda)",
                border: "2px solid var(--success, #28a745)",
                borderRadius: "8px",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontWeight: 600, color: "var(--success, #155724)" }}>
                📍 Quick fill from {selectedPerson.display_name}'s known addresses:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {selectedPerson.addresses.map((addr) => (
                  <button
                    key={addr.place_id}
                    type="button"
                    onClick={() => useKnownAddress(addr)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: "var(--card-bg, #fff)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--foreground, #212529)",
                    }}
                  >
                    <span>
                      <span style={{ display: "block", color: "var(--foreground, #212529)" }}>{addr.formatted_address}</span>
                      {addr.role && (
                        <span style={{ color: "var(--muted, #6c757d)", fontSize: "0.85rem" }}>({addr.role})</span>
                      )}
                    </span>
                    <span style={{ color: "var(--primary)", fontWeight: 500, fontSize: "0.85rem" }}>
                      Use this address
                    </span>
                  </button>
                ))}
              </div>
              <p style={{ margin: "0.75rem 0 0", color: "var(--muted, #6c757d)", fontSize: "0.85rem" }}>
                Or search for a different address below
              </p>
            </div>
          )}

          <PlaceResolver
            value={selectedPlace}
            onChange={handlePlaceResolved}
            placeholder="Type an address..."
          />

          {/* Smart matching - show warning if active requests found at this location */}
          {duplicateMatches.length > 0 && !duplicatesDismissed && (
            <ActiveRequestWarning
              matches={duplicateMatches}
              onDismiss={() => setDuplicatesDismissed(true)}
              onLinkToRequest={(requestId) => router.push(`/requests/${requestId}`)}
            />
          )}

          {checkingDuplicates && (
            <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
              Checking for existing requests...
            </p>
          )}

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <div style={{ flex: "1 1 150px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                County
              </label>
              <select
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="Sonoma">Sonoma</option>
                <option value="Marin">Marin</option>
                <option value="Napa">Napa</option>
                <option value="Mendocino">Mendocino</option>
                <option value="Lake">Lake</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Property Type
              </label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Select...</option>
                {PROPERTY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "2 1 300px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Where on property?
              </label>
              <input
                type="text"
                value={locationDescription}
                onChange={(e) => setLocationDescription(e.target.value)}
                placeholder="e.g., behind dumpster, in barn, backyard..."
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        {/* SECTION 2: Requestor */}
        <div id="section-2" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requestor</h2>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="requestorMode"
                checked={requestorMode === "search"}
                onChange={() => { setRequestorMode("search"); clearPerson(); }}
              />
              Search existing person
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="requestorMode"
                checked={requestorMode === "create"}
                onChange={() => { setRequestorMode("create"); setSelectedPerson(null); }}
              />
              Create new person
            </label>
          </div>

          {/* Search mode */}
          {requestorMode === "search" && !selectedPerson && (
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search by name, phone, or email..."
                style={{ width: "100%" }}
              />
              {searchingPeople && (
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  Searching...
                </p>
              )}
              {personResults.length > 0 && (
                <div className="dropdown-menu">
                  {personResults.map((result) => (
                    <button
                      key={result.entity_id}
                      type="button"
                      onClick={() => selectPerson(result)}
                      className="dropdown-item"
                    >
                      <div>{result.display_name}</div>
                      {result.subtitle && (
                        <div className="text-muted text-sm">{result.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {personSearch.length >= 2 && personResults.length === 0 && !searchingPeople && (
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  No matching people found.{" "}
                  <button
                    type="button"
                    onClick={() => setRequestorMode("create")}
                    style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0 }}
                  >
                    Create new person
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Selected person badge */}
          {selectedPerson && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                border: "1px solid var(--primary)",
                background: "rgba(var(--primary-rgb), 0.05)",
                marginBottom: "1rem",
              }}
            >
              <div>
                <strong>{selectedPerson.display_name}</strong>
              </div>
              <button type="button" onClick={clearPerson} style={{ padding: "0.25rem 0.5rem" }}>
                Change Person
              </button>
            </div>
          )}

          {/* Contact fields - different display for existing vs new person */}
          {selectedPerson && !editingContactInfo ? (
            /* Read-only contact display for existing person */
            <div style={MB_LG}>
              <div
                style={{
                  padding: "1rem",
                  background: "var(--bg-muted)",
                  borderRadius: "8px",
                  marginBottom: "0.75rem",
                }}
              >
                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                  <div>
                    <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Phone</div>
                    <div style={{ fontWeight: 500 }}>
                      {selectedPerson.phone ? formatPhone(selectedPerson.phone) : <span className="text-muted">Not on file</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>Email</div>
                    <div style={{ fontWeight: 500 }}>
                      {selectedPerson.email || <span className="text-muted">Not on file</span>}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingContactInfo(true)}
                style={{
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.9rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "inherit",
                }}
              >
                Update Contact Info
              </button>
            </div>
          ) : (
            /* Editable contact fields for new person OR when editing existing */
            <>
              {selectedPerson && editingContactInfo && (
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    background: "#e3f2fd",
                    borderRadius: "6px",
                    marginBottom: "0.75rem",
                    fontSize: "0.9rem",
                  }}
                >
                  Editing contact info for <strong>{selectedPerson.display_name}</strong>
                  {" "}&mdash; changes will be tracked
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    First Name {requestorMode === "create" && "*"}
                  </label>
                  <input
                    type="text"
                    value={requestorFirstName}
                    onChange={(e) => setRequestorFirstName(e.target.value)}
                    placeholder="First name"
                    style={{ width: "100%" }}
                    disabled={selectedPerson !== null && !editingContactInfo}
                  />
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Last Name {requestorMode === "create" && "*"}
                  </label>
                  <input
                    type="text"
                    value={requestorLastName}
                    onChange={(e) => setRequestorLastName(e.target.value)}
                    placeholder="Last name"
                    style={{ width: "100%" }}
                    disabled={selectedPerson !== null && !editingContactInfo}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={requestorPhone}
                    onChange={(e) => setRequestorPhone(e.target.value)}
                    placeholder="(707) 555-1234"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: "1 1 250px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={requestorEmail}
                    onChange={(e) => setRequestorEmail(e.target.value)}
                    placeholder="email@example.com"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              {/* Cancel edit button when editing existing person */}
              {selectedPerson && editingContactInfo && (
                <div style={MB_LG}>
                  <button
                    type="button"
                    onClick={() => {
                      // Restore original values
                      if (originalContactInfo) {
                        setRequestorPhone(originalContactInfo.phone);
                        setRequestorEmail(originalContactInfo.email);
                      }
                      setEditingContactInfo(false);
                    }}
                    style={{
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.9rem",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "inherit",
                    }}
                  >
                    Cancel Edit
                  </button>
                  {(requestorPhone !== originalContactInfo?.phone || requestorEmail !== originalContactInfo?.email) && (
                    <span className="text-sm" style={{ marginLeft: "0.75rem", color: "#28a745" }}>
                      Changes will be saved with request
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {/* Person suggestion banner (email/phone duplicate prevention) */}
          <PersonSuggestionBanner
            suggestions={personSuggestion.suggestions}
            loading={personSuggestion.loading}
            dismissed={personSuggestion.dismissed}
            onDismiss={personSuggestion.dismiss}
            onSelect={handleSuggestionSelect}
          />

          {/* Property authority section */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "0.5rem" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                marginBottom: hasPropertyAuthority ? "0" : "1rem",
              }}
            >
              <input
                type="checkbox"
                checked={!hasPropertyAuthority}
                onChange={(e) => setHasPropertyAuthority(!e.target.checked)}
              />
              <span>Requestor does NOT have authority over property</span>
            </label>

            {!hasPropertyAuthority && (
              <div style={{ marginLeft: "1.5rem", marginTop: "0.75rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Property Owner Name
                    </label>
                    <input
                      type="text"
                      value={propertyOwnerName}
                      onChange={(e) => setPropertyOwnerName(e.target.value)}
                      placeholder="Owner/manager name"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div style={{ flex: "1 1 180px" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                      Property Owner Phone
                    </label>
                    <input
                      type="tel"
                      value={propertyOwnerPhone}
                      onChange={(e) => setPropertyOwnerPhone(e.target.value)}
                      placeholder="(707) 555-1234"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={authorizationPending}
                    onChange={(e) => setAuthorizationPending(e.target.checked)}
                  />
                  <span>Authorization pending (needs follow-up)</span>
                </label>
              </div>
            )}
          </div>

          {/* Best contact times */}
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Best Times to Contact
            </label>
            <input
              type="text"
              value={bestContactTimes}
              onChange={(e) => setBestContactTimes(e.target.value)}
              placeholder="e.g., mornings, after 5pm, weekends..."
              style={{ width: "100%" }}
            />
          </div>

          {/* Third-party report tracking */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "1rem" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                marginBottom: isThirdPartyReport ? "0.75rem" : "0",
              }}
            >
              <input
                type="checkbox"
                checked={isThirdPartyReport}
                onChange={(e) => setIsThirdPartyReport(e.target.checked)}
              />
              <span>Requestor is NOT the site contact (third-party report)</span>
            </label>

            {isThirdPartyReport && (
              <div
                style={{
                  marginLeft: "1.5rem",
                  padding: "0.75rem",
                  background: "var(--bg-muted)",
                  borderRadius: "6px",
                }}
              >
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Relationship to site
                </label>
                <select
                  value={thirdPartyRelationship}
                  onChange={(e) => setThirdPartyRelationship(e.target.value)}
                  style={{ width: "100%", maxWidth: "300px" }}
                >
                  <option value="">Select...</option>
                  <option value="neighbor">Neighbor</option>
                  <option value="friend_family">Friend/Family of resident</option>
                  <option value="concerned_citizen">Concerned citizen</option>
                  <option value="property_manager">Property manager</option>
                  <option value="business_employee">Business employee</option>
                  <option value="other">Other</option>
                </select>
                <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                  Helps us know who can authorize trapping and who to contact for updates
                </p>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 3: Permission & Access */}
        <div id="section-3" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Permission & Access</h2>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ flex: "1 1 250px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Permission Status
              </label>
              <select
                value={permissionStatus}
                onChange={(e) => setPermissionStatus(e.target.value)}
                style={{ width: "100%" }}
              >
                {PERMISSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                Can traps be left overnight?
              </label>
              <div style={{ display: "flex", gap: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === true}
                    onChange={() => setTrapsOvernightSafe(true)}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === false}
                    onChange={() => setTrapsOvernightSafe(false)}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="trapsOvernight"
                    checked={trapsOvernightSafe === null}
                    onChange={() => setTrapsOvernightSafe(null)}
                  />
                  Unknown
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                Can trapper access without requester?
              </label>
              <div style={{ display: "flex", gap: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === true}
                    onChange={() => setAccessWithoutContact(true)}
                  />
                  Yes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === false}
                    onChange={() => setAccessWithoutContact(false)}
                  />
                  No
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="accessWithout"
                    checked={accessWithoutContact === null}
                    onChange={() => setAccessWithoutContact(null)}
                  />
                  Unknown
                </label>
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Access Notes
            </label>
            <textarea
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate codes, dogs on property, parking instructions, hazards..."
              rows={2}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        </div>

        {/* SECTION 3b: Trapping Logistics (FFS-151) - collapsible */}
        <div className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <button
            type="button"
            onClick={() => setShowTrappingLogistics(!showTrappingLogistics)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Trapping Logistics</h2>
            <span style={{ fontSize: "0.85rem", color: COLORS.textSecondary }}>
              {showTrappingLogistics ? "Collapse" : "Expand"}
            </span>
          </button>

          {showTrappingLogistics && (
            <div style={{ marginTop: "1rem" }}>
              {/* Row 1: Ownership, Handleability, Fixed Status */}
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Ownership Status
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {OWNERSHIP_OPTIONS.map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="ownershipStatus"
                          checked={ownershipStatus === opt.value}
                          onChange={() => setOwnershipStatus(opt.value)}
                        />
                        {opt.shortLabel}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Handleability
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {HANDLEABILITY_OPTIONS.map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="handleability"
                          checked={handleability === opt.value}
                          onChange={() => setHandleability(opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Fixed Status
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {FIXED_STATUS_OPTIONS.map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="fixedStatus"
                          checked={fixedStatus === opt.value}
                          onChange={() => setFixedStatus(opt.value)}
                        />
                        {opt.shortLabel}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Dogs, Trap Savvy, Previous TNR */}
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Dogs on site?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }].map((o) => (
                      <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input type="radio" name="dogsOnSite" checked={dogsOnSite === o.v} onChange={() => setDogsOnSite(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Trap-savvy cats?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "unknown", l: "Unknown" }].map((o) => (
                      <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input type="radio" name="trapSavvy" checked={trapSavvy === o.v} onChange={() => setTrapSavvy(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Previous TNR?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "partial", l: "Partial" }].map((o) => (
                      <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input type="radio" name="previousTnr" checked={previousTnr === o.v} onChange={() => setPreviousTnr(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 3: Best trapping time + Cat description */}
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 250px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Best Trapping Time
                  </label>
                  <input
                    type="text"
                    value={bestTrappingTime}
                    onChange={(e) => setBestTrappingTime(e.target.value)}
                    placeholder="e.g., Weekday evenings"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: "2 1 300px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Cat Descriptions
                  </label>
                  <textarea
                    value={catDescription}
                    onChange={(e) => setCatDescription(e.target.value)}
                    placeholder="Colors, markings, names — describe individual cats"
                    rows={2}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>
              </div>

              {/* Row 4: Important Notes checkboxes */}
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                  Important Notes
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {IMPORTANT_NOTE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem 0.75rem",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        background: importantNotes.includes(opt.value)
                          ? "var(--primary)"
                          : "transparent",
                        color: importantNotes.includes(opt.value) ? "#fff" : "inherit",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={importantNotes.includes(opt.value)}
                        onChange={() => toggleImportantNote(opt.value)}
                        style={{ display: "none" }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 4: About the Cats */}
        <div id="section-4" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>About the Cats</h2>

          {/* Request Purpose Selector - Multi-select */}
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              What does this request involve? <span className="text-muted" style={{ fontWeight: 400 }}>(select all that apply)</span>
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {[
                { value: "tnr", label: "FFR", desc: "Cats need spay/neuter" },
                { value: "wellness", label: "Wellness", desc: "Check on altered cats" },
                { value: "relocation", label: "Relocation", desc: "Trapping to move cats" },
                { value: "rescue", label: "Rescue", desc: "Emergency assistance" },
              ].map((opt) => {
                const isSelected = requestPurposes.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "0.6rem 1rem",
                      border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      background: isSelected ? "rgba(var(--primary-rgb), 0.05)" : "transparent",
                      minWidth: "110px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePurpose(opt.value)}
                      style={{ display: "none" }}
                    />
                    <span style={{ fontWeight: 600 }}>{opt.label}</span>
                    <span className="text-muted" style={{ fontSize: "0.75rem" }}>{opt.desc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* TNR / Relocation / Rescue - Cats needing work */}
          {(hasTnr || hasRelocation || hasRescue) && (
            <>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 140px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    {hasTnr ? "Cats needing FFR" : "Cats to trap"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={estimatedCatCount}
                    onChange={(e) =>
                      setEstimatedCatCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                  <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                    {hasTnr ? "Unfixed cats" : "Total to trap"}
                  </p>
                </div>

                <div style={{ flex: "1 1 140px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Peak count observed
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={peakCount}
                    onChange={(e) =>
                      setPeakCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                  <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                    Most cats seen at once
                  </p>
                </div>

                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    How confident is this count?
                  </label>
                  <select
                    value={countConfidence}
                    onChange={(e) => setCountConfidence(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {COUNT_CONFIDENCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    How long have cats been here?
                  </label>
                  <select
                    value={colonyDuration}
                    onChange={(e) => setColonyDuration(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {COLONY_DURATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    How long has requester known?
                  </label>
                  <select
                    value={awarenessDuration}
                    onChange={(e) => setAwarenessDuration(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {COLONY_DURATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                    Helps assess colony stability
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Wellness - Altered cats to check */}
          {hasWellness && (
            <div
              style={{
                padding: "1rem",
                background: "var(--bg-muted)",
                borderRadius: "8px",
                marginBottom: "1rem",
              }}
            >
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 160px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Altered cats for wellness
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={wellnessCatCount}
                    onChange={(e) =>
                      setWellnessCatCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ flex: "2 1 300px" }}>
                  <p className="text-muted text-sm" style={{ margin: 0 }}>
                    Already ear-tipped cats to check on. These won&apos;t count toward FFR work.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Smart ear-tip input - only for TNR (context for how many are already done) */}
          {hasTnr && (
            <div style={MB_LG}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Ear-tipped at location {showExactEartipCount ? "(exact count)" : "(estimate)"}
              </label>
              {showExactEartipCount ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="number"
                    min="0"
                    max={typeof estimatedCatCount === "number" ? estimatedCatCount : undefined}
                    value={eartipCount}
                    onChange={(e) =>
                      setEartipCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "80px" }}
                  />
                  <span className="text-muted">
                    already fixed (context only, not part of this request)
                  </span>
                </div>
              ) : (
                <select
                  value={eartipEstimate}
                  onChange={(e) => setEartipEstimate(e.target.value)}
                  style={{ width: "100%", maxWidth: "300px" }}
                >
                  {EARTIP_ESTIMATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                For context only &mdash; these cats are already done and won&apos;t count toward this request
              </p>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Are the cats friendly?
            </label>
            <div style={{ display: "flex", gap: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === true}
                  onChange={() => setCatsAreFriendly(true)}
                />
                Yes, friendly
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === false}
                  onChange={() => setCatsAreFriendly(false)}
                />
                No, unhandleable
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="friendly"
                  checked={catsAreFriendly === null}
                  onChange={() => setCatsAreFriendly(null)}
                />
                Mixed/Unknown
              </label>
            </div>
          </div>
        </div>

        {/* SECTION 5: Kittens */}
        <div id="section-5" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Kittens</h2>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasKittens}
                onChange={(e) => setHasKittens(e.target.checked)}
              />
              Kittens present
            </label>
          </div>

          {hasKittens && (
            <>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 120px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    How many?
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={kittenCount}
                    onChange={(e) =>
                      setKittenCount(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="0"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "1 1 120px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Age (weeks)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="52"
                    value={kittenAgeWeeks}
                    onChange={(e) =>
                      setKittenAgeWeeks(e.target.value ? parseInt(e.target.value) : "")
                    }
                    placeholder="e.g., 6"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "2 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Age range
                  </label>
                  <select
                    value={kittenAgeEstimate}
                    onChange={(e) => setKittenAgeEstimate(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select...</option>
                    <option value="under_4_weeks">Under 4 weeks (bottle babies)</option>
                    <option value="4_to_8_weeks">4-8 weeks (weaning)</option>
                    <option value="8_to_12_weeks">8-12 weeks (ideal foster)</option>
                    <option value="12_to_16_weeks">12-16 weeks (socialization critical)</option>
                    <option value="over_16_weeks">Over 16 weeks / 4+ months</option>
                    <option value="mixed">Mixed ages</option>
                  </select>
                </div>
              </div>

              {kittenAgeEstimate === "mixed" && (
                <div style={MB_LG}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Describe the ages
                  </label>
                  <input
                    type="text"
                    value={kittenMixedAgesDescription}
                    onChange={(e) => setKittenMixedAgesDescription(e.target.value)}
                    placeholder='e.g., "3 at ~8 weeks, 2 at ~6 months"'
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <div style={MB_LG}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                  Kitten behavior/socialization
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    { value: "friendly", label: "Friendly - can be handled, approaches people" },
                    { value: "shy_handleable", label: "Shy but handleable - scared but can be picked up" },
                    { value: "shy_young", label: "Shy/hissy (young) - may be socializable" },
                    { value: "unhandleable_older", label: "Unhandleable (older) - very scared, hard to handle" },
                    { value: "unknown", label: "Unknown - haven't been able to assess" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="kittenBehavior"
                        value={opt.value}
                        checked={kittenBehavior === opt.value}
                        onChange={(e) => setKittenBehavior(e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Kittens contained/caught?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "some", label: "Some" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="kittenContained"
                          value={opt.value}
                          checked={kittenContained === opt.value}
                          onChange={(e) => setKittenContained(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Mom cat present?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unsure", label: "Unsure" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="momPresent"
                          value={opt.value}
                          checked={momPresent === opt.value}
                          onChange={(e) => setMomPresent(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {momPresent === "yes" && (
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                      Mom fixed (ear-tipped)?
                    </label>
                    <div style={{ display: "flex", gap: "1rem" }}>
                      {[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                        { value: "unsure", label: "Unsure" },
                      ].map((opt) => (
                        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="momFixed"
                            value={opt.value}
                            checked={momFixed === opt.value}
                            onChange={(e) => setMomFixed(e.target.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
                    Can bring them in?
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "need_help", label: "Need help" },
                      { value: "no", label: "No" },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="canBringIn"
                          value={opt.value}
                          checked={canBringIn === opt.value}
                          onChange={(e) => setCanBringIn(e.target.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Kitten notes
                </label>
                <textarea
                  value={kittenNotes}
                  onChange={(e) => setKittenNotes(e.target.value)}
                  placeholder="Colors, where they hide, feeding times, trap-savvy, etc..."
                  rows={2}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #ffc107)", borderRadius: "6px", padding: "0.75rem", marginTop: "1rem", fontSize: "0.85rem" }}>
                <strong>Foster triage factors:</strong>
                <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
                  <li>Age: Under 12 weeks ideal, 12+ weeks need socialization</li>
                  <li>Behavior: Friendly/handleable kittens prioritized</li>
                  <li>Mom: Spayed mom with kittens increases foster likelihood</li>
                  <li>Ease: Already contained = easier intake</li>
                </ul>
              </div>
            </>
          )}
        </div>

        {/* SECTION 6: Feeding */}
        <div id="section-6" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Feeding</h2>

          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Are the cats being fed regularly?
            </label>
            <div style={{ display: "flex", gap: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === true}
                  onChange={() => setIsBeingFed(true)}
                />
                Yes
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === false}
                  onChange={() => setIsBeingFed(false)}
                />
                No
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="beingFed"
                  checked={isBeingFed === null}
                  onChange={() => setIsBeingFed(null)}
                />
                Unknown
              </label>
            </div>
          </div>

          {isBeingFed && (
            <>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Who feeds them?
                  </label>
                  <input
                    type="text"
                    value={feederName}
                    onChange={(e) => setFeederName(e.target.value)}
                    placeholder="Name of feeder"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "1 1 200px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Feeding frequency
                  </label>
                  <select
                    value={feedingFrequency}
                    onChange={(e) => setFeedingFrequency(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select frequency...</option>
                    <option value="daily">Daily</option>
                    <option value="few_times_week">A few times a week</option>
                    <option value="occasionally">Occasionally</option>
                    <option value="rarely">Rarely / Not at all</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 250px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Where are they fed?
                  </label>
                  <input
                    type="text"
                    value={feedingLocation}
                    onChange={(e) => setFeedingLocation(e.target.value)}
                    placeholder="e.g., back porch, by the shed, parking lot..."
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ flex: "1 1 180px" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    What time(s)?
                  </label>
                  <input
                    type="text"
                    value={feedingTime}
                    onChange={(e) => setFeedingTime(e.target.value)}
                    placeholder="e.g., 7am and 5pm"
                    style={{ width: "100%" }}
                  />
                  <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                    Helps trappers plan visits
                  </p>
                </div>
              </div>
            </>
          )}

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Best times to see the cats
            </label>
            <input
              type="text"
              value={bestTimesSeen}
              onChange={(e) => setBestTimesSeen(e.target.value)}
              placeholder="e.g., early morning, dusk..."
              style={{ width: "100%" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Helps trappers plan visits
            </p>
          </div>
        </div>

        {/* SECTION 7: Urgency */}
        <div id="section-7" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Urgency</h2>

          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Priority Level
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{ width: "100%", maxWidth: "200px" }}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              Urgency factors (select all that apply)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {URGENCY_REASON_OPTIONS.map((reason) => (
                <label
                  key={reason.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    background: urgencyReasons.includes(reason.value)
                      ? "var(--primary)"
                      : "transparent",
                    color: urgencyReasons.includes(reason.value) ? "#fff" : "inherit",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={urgencyReasons.includes(reason.value)}
                    onChange={() => toggleUrgencyReason(reason.value)}
                    style={{ display: "none" }}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Deadline (if any)
              </label>
              <input
                type="date"
                value={urgencyDeadline}
                onChange={(e) => setUrgencyDeadline(e.target.value)}
                style={{ width: "100%" }}
              />
              <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Moving date, eviction, etc.
              </p>
            </div>

            <div style={{ flex: "2 1 300px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Urgency notes
              </label>
              <textarea
                value={urgencyNotes}
                onChange={(e) => setUrgencyNotes(e.target.value)}
                placeholder="Additional context about urgency..."
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        {/* SECTION 8: Additional Details */}
        <div id="section-8" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Additional Details</h2>

          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Request Title
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g., '5 cats at Oak Street colony' or 'Rescue injured cat'"
              style={{ width: "100%" }}
            />
            <small style={{ color: "#666", fontSize: "0.8rem" }}>
              This will be the display name for this request
            </small>
          </div>

          <div style={MB_LG}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Case Info
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detailed situation description, history with these cats, special circumstances..."
              rows={4}
              style={{ width: "100%", resize: "vertical" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Case details that can be shared with volunteers or referenced later
            </p>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Internal Notes
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Staff working notes, follow-up reminders, private observations..."
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
            <p className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Private notes for staff only &mdash; not shared with clients
            </p>
          </div>
        </div>

        {/* SECTION: Completion Data (only shown in Quick Complete mode) */}
        {entryMode === "complete" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <CompletionSection
              value={completionData}
              onChange={setCompletionData}
            />
          </div>
        )}

        {error && <div style={{ color: "#dc3545", marginBottom: "1rem" }}>{error}</div>}

        <div style={{ display: "flex", gap: "1rem" }}>
          <button type="submit" disabled={submitting}>
            {submitting
              ? "Creating..."
              : entryMode === "complete"
              ? "Complete & Close Request"
              : "Create Request"}
          </button>
          <a
            href="/requests"
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <NewRequestForm />
    </Suspense>
  );
}
