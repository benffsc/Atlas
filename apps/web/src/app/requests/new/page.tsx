"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackButton } from "@/components/common";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { fetchApi, postApi } from "@/lib/api-client";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, TRANSITIONS } from "@/lib/design-tokens";
import { MB_LG, MB_XL, SECTION_DIVIDER } from "../styles";
import {
  OWNERSHIP_OPTIONS,
  HANDLEABILITY_OPTIONS,
  FIXED_STATUS_OPTIONS,
  IMPORTANT_NOTE_OPTIONS,
} from "@/lib/form-options";
import {
  PersonSection,
  PlaceSection,
  PropertyAccessSection,
  CatDetailsSection,
  KittenAssessmentSection,
  UrgencyNotesSection,
} from "@/components/request-sections";
import type {
  PersonSectionValue,
  PlaceSectionValue,
  PropertyAccessValue,
  CatDetailsSectionValue,
  KittenAssessmentValue,
  UrgencyNotesValue,
} from "@/components/request-sections";
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

const EMPTY_PERSON_VALUE: PersonSectionValue = {
  person_id: null, display_name: "", is_resolved: false,
  first_name: "", last_name: "", email: "", phone: "",
};

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

  // Contact - Requestor (individual vars for effect compat: intake preload, dup check, auto-fill)
  const [requestorPersonId, setRequestorPersonId] = useState<string | null>(null);
  const [requestorFirstName, setRequestorFirstName] = useState("");
  const [requestorLastName, setRequestorLastName] = useState("");
  const [requestorPhone, setRequestorPhone] = useState("");
  const [requestorEmail, setRequestorEmail] = useState("");
  // Property authority
  const [hasPropertyAuthority, setHasPropertyAuthority] = useState(true);
  const [propertyOwnerValue, setPropertyOwnerValue] = useState<PersonSectionValue>(EMPTY_PERSON_VALUE);
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [bestContactTimes, setBestContactTimes] = useState("");

  // Permission & Access
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [hasPropertyAccess, setHasPropertyAccess] = useState<boolean | null>(null);
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

  // Computed: check if specific purposes are selected
  const hasTnr = requestPurposes.includes("tnr");
  const hasWellness = requestPurposes.includes("wellness");
  const hasRelocation = requestPurposes.includes("relocation");
  const hasRescue = requestPurposes.includes("rescue");

  // About the Cats
  const [totalCatsReported, setTotalCatsReported] = useState<number | "">("");
  const [catName, setCatName] = useState("");
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
  const [siteContactValue, setSiteContactValue] = useState<PersonSectionValue>(EMPTY_PERSON_VALUE);

  // FFS-298: Requester relationship to location (non-third-party)
  const [requesterRole, setRequesterRole] = useState("resident");

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

  // Medical (FFS-461)
  const [hasMedicalConcerns, setHasMedicalConcerns] = useState<boolean | null>(null);
  const [medicalDescription, setMedicalDescription] = useState("");

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

  const toggleImportantNote = (note: string) => {
    setImportantNotes((prev) =>
      prev.includes(note) ? prev.filter((n) => n !== note) : [...prev, note]
    );
  };

  // ─── Section Adapter Values (FFS-493) ─────────────────────────────────────
  // Bridge individual state vars → section component value objects.
  // State stays flat (no refactor of submit/effects), components read these.

  const requestorPersonValue: PersonSectionValue = {
    person_id: requestorPersonId,
    display_name: [requestorFirstName, requestorLastName].filter(Boolean).join(" "),
    is_resolved: !!requestorPersonId,
    first_name: requestorFirstName,
    last_name: requestorLastName,
    email: requestorEmail,
    phone: requestorPhone,
  };

  const handleRequestorPersonChange = useCallback(
    (v: PersonSectionValue) => {
      setRequestorPersonId(v.person_id);
      setRequestorFirstName(v.first_name);
      setRequestorLastName(v.last_name);
      setRequestorEmail(v.email);
      setRequestorPhone(v.phone);
    },
    []
  );

  const handleRequestorAddressSelected = useCallback(
    (address: { place_id: string; formatted_address: string }) => {
      setSelectedPlace({
        place_id: address.place_id,
        display_name: address.formatted_address,
        formatted_address: address.formatted_address,
        locality: null,
      });
    },
    []
  );

  const placeValue: PlaceSectionValue = {
    place: selectedPlace,
    propertyType,
    county,
    whereOnProperty: locationDescription,
  };

  const handlePlaceChange = useCallback(
    (v: PlaceSectionValue) => {
      setSelectedPlace(v.place);
      setPropertyType(v.propertyType);
      setCounty(v.county);
      setLocationDescription(v.whereOnProperty);
    },
    []
  );

  const propertyAccessValue: PropertyAccessValue = {
    permissionStatus,
    hasPropertyAccess,
    trapsOvernightSafe,
    accessWithoutContact,
    accessNotes,
  };

  const handlePropertyAccessChange = useCallback(
    (v: PropertyAccessValue) => {
      setPermissionStatus(v.permissionStatus);
      setHasPropertyAccess(v.hasPropertyAccess);
      setTrapsOvernightSafe(v.trapsOvernightSafe);
      setAccessWithoutContact(v.accessWithoutContact);
      setAccessNotes(v.accessNotes);
    },
    []
  );

  const catDetailsValue: CatDetailsSectionValue = {
    estimatedCatCount,
    totalCatsReported,
    peakCount,
    countConfidence,
    colonyDuration,
    awarenessDuration,
    eartipCount,
    eartipEstimate,
    catsAreFriendly,
    catName,
    catDescription,
    wellnessCatCount,
    requestPurposes,
  };

  const handleCatDetailsChange = useCallback(
    (v: CatDetailsSectionValue) => {
      setEstimatedCatCount(v.estimatedCatCount);
      setTotalCatsReported(v.totalCatsReported);
      setPeakCount(v.peakCount);
      setCountConfidence(v.countConfidence);
      setColonyDuration(v.colonyDuration);
      setAwarenessDuration(v.awarenessDuration);
      setEartipCount(v.eartipCount);
      setEartipEstimate(v.eartipEstimate);
      setCatsAreFriendly(v.catsAreFriendly);
      setCatName(v.catName);
      setCatDescription(v.catDescription);
      setWellnessCatCount(v.wellnessCatCount);
      setRequestPurposes(v.requestPurposes);
    },
    []
  );

  const kittenValue: KittenAssessmentValue = {
    hasKittens,
    kittenCount,
    kittenAgeWeeks,
    kittenAgeEstimate,
    kittenMixedAgesDescription,
    kittenBehavior,
    kittenContained,
    momPresent,
    momFixed,
    canBringIn,
    kittenNotes,
  };

  const handleKittenChange = useCallback(
    (v: KittenAssessmentValue) => {
      setHasKittens(v.hasKittens);
      setKittenCount(v.kittenCount);
      setKittenAgeWeeks(v.kittenAgeWeeks);
      setKittenAgeEstimate(v.kittenAgeEstimate);
      setKittenMixedAgesDescription(v.kittenMixedAgesDescription);
      setKittenBehavior(v.kittenBehavior);
      setKittenContained(v.kittenContained);
      setMomPresent(v.momPresent);
      setMomFixed(v.momFixed);
      setCanBringIn(v.canBringIn);
      setKittenNotes(v.kittenNotes);
    },
    []
  );

  const urgencyNotesValue: UrgencyNotesValue = {
    priority,
    urgencyReasons,
    urgencyDeadline,
    urgencyNotes,
    summary,
    notes,
    internalNotes,
  };

  const handleUrgencyNotesChange = useCallback(
    (v: UrgencyNotesValue) => {
      setPriority(v.priority);
      setUrgencyReasons(v.urgencyReasons);
      setUrgencyDeadline(v.urgencyDeadline);
      setUrgencyNotes(v.urgencyNotes);
      setSummary(v.summary);
      setNotes(v.notes);
      setInternalNotes(v.internalNotes);
    },
    []
  );

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
        requester_person_id: requestorPersonId,
        raw_requester_name: !requestorPersonId && (requestorFirstName || requestorLastName)
          ? `${requestorFirstName} ${requestorLastName}`.trim()
          : null,
        raw_requester_phone: requestorPhone || null,
        raw_requester_email: requestorEmail || null,
        // Property authority
        property_owner_name: !hasPropertyAuthority
          ? (propertyOwnerValue.is_resolved
            ? propertyOwnerValue.display_name
            : [propertyOwnerValue.first_name, propertyOwnerValue.last_name].filter(Boolean).join(" ") || null)
          : null,
        property_owner_phone: !hasPropertyAuthority ? propertyOwnerValue.phone || null : null,
        property_owner_person_id: !hasPropertyAuthority && propertyOwnerValue.is_resolved ? propertyOwnerValue.person_id : null,
        raw_property_owner_email: !hasPropertyAuthority ? propertyOwnerValue.email || null : null,
        authorization_pending: !hasPropertyAuthority ? authorizationPending : false,
        best_contact_times: bestContactTimes || null,
        // Property ownership (derived from "Someone else owns" checkbox)
        is_property_owner: hasPropertyAuthority,
        // Permission & Access
        permission_status: permissionStatus,
        has_property_access: hasPropertyAccess,
        access_notes: accessNotes || null,
        traps_overnight_safe: trapsOvernightSafe,
        access_without_contact: accessWithoutContact,
        // About the Cats
        estimated_cat_count: estimatedCatCount !== "" ? estimatedCatCount : null,
        total_cats_reported: totalCatsReported !== "" ? totalCatsReported : null,
        peak_count: peakCount !== "" ? peakCount : null,  // MIG_2532: Beacon critical
        wellness_cat_count: hasWellness ? (wellnessCatCount !== "" ? wellnessCatCount : null) : null,
        count_confidence: countConfidence,
        colony_duration: colonyDuration,
        awareness_duration: awarenessDuration,  // MIG_2532
        eartip_count: showExactEartipCount ? (eartipCount !== "" ? eartipCount : null) : null,
        eartip_estimate: !showExactEartipCount ? eartipEstimate : null,
        cats_are_friendly: catsAreFriendly,
        cat_name: (typeof estimatedCatCount === "number" && estimatedCatCount <= 3) ? catName || null : null,
        // MIG_2532: Third-party tracking
        is_third_party_report: isThirdPartyReport,
        third_party_relationship: isThirdPartyReport ? thirdPartyRelationship || null : null,
        site_contact_person_id: isThirdPartyReport && siteContactValue.is_resolved ? siteContactValue.person_id : null,
        raw_site_contact_name: isThirdPartyReport && !siteContactValue.is_resolved
          ? [siteContactValue.first_name, siteContactValue.last_name].filter(Boolean).join(" ") || null
          : null,
        raw_site_contact_phone: isThirdPartyReport && !siteContactValue.is_resolved ? siteContactValue.phone || null : null,
        raw_site_contact_email: isThirdPartyReport && !siteContactValue.is_resolved ? siteContactValue.email || null : null,
        requester_is_site_contact: !isThirdPartyReport,
        // FFS-298: Requester role at submission (always from the requester dropdown)
        // third_party_relationship stores the site contact's role separately
        requester_role_at_submission: requesterRole,
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
        // Medical (FFS-461)
        has_medical_concerns: hasMedicalConcerns,
        medical_description: hasMedicalConcerns ? (medicalDescription || null) : null,
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
        {/* SECTION 1: Location (FFS-493) */}
        <div id="section-1">
          <PlaceSection
            value={placeValue}
            onChange={handlePlaceChange}
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
            <p className="text-muted text-sm" style={{ marginTop: "0.5rem", marginBottom: "1rem" }}>
              Checking for existing requests...
            </p>
          )}
        </div>

        {/* SECTION 2: Requestor */}
        <div id="section-2" className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Requestor</h2>

          <PersonSection
            role="requestor"
            value={requestorPersonValue}
            onChange={handleRequestorPersonChange}
            onAddressSelected={handleRequestorAddressSelected}
            allowCreate
            required
            compact
          />

          {/* Property authority section */}
          <div style={SECTION_DIVIDER}>
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
                checked={!hasPropertyAuthority}
                onChange={(e) => setHasPropertyAuthority(!e.target.checked)}
              />
              <span>Someone else owns/manages this property</span>
            </label>

            <div className={`expandable-section${!hasPropertyAuthority ? " expanded" : ""}`} style={{ marginTop: "0.75rem" }}>
              <div className="expandable-content">
                <PersonSection
                  role="property_owner"
                  value={propertyOwnerValue}
                  onChange={setPropertyOwnerValue}
                  allowCreate
                  compact
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "0.9rem",
                    marginTop: "0.5rem",
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
            </div>
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

          {/* Requester relationship to location */}
          <div style={SECTION_DIVIDER}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Requestor&apos;s relationship to location
            </label>
            <select
              value={requesterRole}
              onChange={(e) => setRequesterRole(e.target.value)}
              style={{ width: "100%", maxWidth: "300px" }}
            >
              <option value="resident">Resident</option>
              <option value="property_owner">Property owner</option>
              <option value="colony_caretaker">Colony caretaker</option>
              <option value="neighbor">Neighbor</option>
              <option value="concerned_citizen">Concerned citizen</option>
              <option value="volunteer">Volunteer</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Third-party report tracking */}
          <div style={SECTION_DIVIDER}>
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
                checked={isThirdPartyReport}
                onChange={(e) => setIsThirdPartyReport(e.target.checked)}
              />
              <span>Someone else is the on-site contact</span>
            </label>

            <div className={`expandable-section${isThirdPartyReport ? " expanded" : ""}`} style={{ marginTop: "0.75rem" }}>
              <div className="expandable-content">
                <PersonSection
                  role="site_contact"
                  value={siteContactValue}
                  onChange={setSiteContactValue}
                  allowCreate
                  compact
                />
                <div style={{ marginTop: "0.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                    Site contact&apos;s role at location
                  </label>
                  <select
                    value={thirdPartyRelationship}
                    onChange={(e) => setThirdPartyRelationship(e.target.value)}
                    style={{ width: "100%", maxWidth: "300px" }}
                  >
                    <option value="">Select...</option>
                    <option value="resident">Resident</option>
                    <option value="property_owner">Property owner</option>
                    <option value="property_manager">Property manager</option>
                    <option value="colony_caretaker">Colony caretaker</option>
                    <option value="business_employee">Business employee</option>
                    <option value="neighbor">Neighbor</option>
                    <option value="other">Other</option>
                  </select>
                  <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
                    Their role at the site — helps us know who to contact for access
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: Permission & Access (FFS-493) */}
        <div id="section-3">
          <PropertyAccessSection
            value={propertyAccessValue}
            onChange={handlePropertyAccessChange}
          />
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

        {/* SECTION 4: About the Cats (FFS-493) */}
        <div id="section-4">
          <CatDetailsSection
            value={catDetailsValue}
            onChange={handleCatDetailsChange}
          />
        </div>

        {/* SECTION 5: Kittens (FFS-493) */}
        <div id="section-5">
          <KittenAssessmentSection
            value={kittenValue}
            onChange={handleKittenChange}
          />
          {hasKittens && (
            <div style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #ffc107)", borderRadius: "6px", padding: "0.75rem", marginTop: "-12px", marginBottom: "20px", fontSize: "0.85rem" }}>
              <strong>Foster triage factors:</strong>
              <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
                <li>Age: Under 12 weeks ideal, 12+ weeks need socialization</li>
                <li>Behavior: Friendly/handleable kittens prioritized</li>
                <li>Mom: Spayed mom with kittens increases foster likelihood</li>
                <li>Ease: Already contained = easier intake</li>
              </ul>
            </div>
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

        {/* SECTION 6b: Medical Concerns (FFS-461) */}
        <div className="card" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Medical Concerns</h2>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasMedicalConcerns === true}
                onChange={(e) => setHasMedicalConcerns(e.target.checked ? true : null)}
              />
              Has medical concerns
            </label>
          </div>

          {hasMedicalConcerns && (
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Describe the medical concerns
              </label>
              <textarea
                value={medicalDescription}
                onChange={(e) => setMedicalDescription(e.target.value)}
                placeholder="Injuries, illness, limping, eye issues, pregnant cats..."
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>
          )}
        </div>

        {/* SECTION 7+8: Urgency & Additional Details (FFS-493) */}
        <div id="section-7">
          <UrgencyNotesSection
            value={urgencyNotesValue}
            onChange={handleUrgencyNotesChange}
            showDetails={true}
          />
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
