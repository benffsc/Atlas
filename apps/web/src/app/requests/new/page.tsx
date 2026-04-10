"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackButton } from "@/components/common";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { fetchApi, postApi } from "@/lib/api-client";
import { extractPhones, formatPhone, isValidPhone } from "@/lib/formatters";
import { useGeoConfig } from "@/hooks/useGeoConfig";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, TRANSITIONS } from "@/lib/design-tokens";
import { MB_LG, MB_XL, SECTION_DIVIDER } from "../styles";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import {
  FIXED_STATUS_OPTIONS,
} from "@/lib/form-options";
import {
  PersonSection,
  PlaceSection,
  PropertyAccessSection,
  CatDetailsSection,
  KittenAssessmentSection,
  UrgencyNotesSection,
  StaffTriagePanel,
  EMPTY_STAFF_TRIAGE,
  OtherPartiesSection,
  EMPTY_OTHER_PARTIES,
  RelatedPlacesSection,
  EMPTY_RELATED_PLACES,
} from "@/components/request-sections";
import type {
  PersonSectionValue,
  PlaceSectionValue,
  PropertyAccessValue,
  CatDetailsSectionValue,
  KittenAssessmentValue,
  UrgencyNotesValue,
  StaffTriageValue,
  OtherPartiesSectionValue,
  RelatedPlacesSectionValue,
} from "@/components/request-sections";
import { LANGUAGE_OPTIONS } from "@/lib/form-options";
import { useSectionConfig } from "@/hooks/useSectionConfig";
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
  const { defaultCounty } = useGeoConfig();

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

  // Permission & Access (hasPropertyAccess, trapsOvernightSafe, accessWithoutContact now facade-derived / in StaffTriagePanel)
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [accessNotes, setAccessNotes] = useState("");

  // Trapping Details — some fields now in CatDetailsSection or StaffTriagePanel
  const [ownershipStatus, setOwnershipStatus] = useState("");
  const [handleability, setHandleability] = useState("");
  const [fixedStatus, setFixedStatus] = useState("");
  const [dogsOnSite, setDogsOnSite] = useState("");
  const [bestTrappingTime, setBestTrappingTime] = useState("");

  // Staff Triage (Phase 2) — collapsible panel below form
  const [staffTriageValue, setStaffTriageValue] = useState<StaffTriageValue>(EMPTY_STAFF_TRIAGE);

  // Related people + language (config-gated)
  const [otherParties, setOtherParties] = useState<OtherPartiesSectionValue>(EMPTY_OTHER_PARTIES);
  const [relatedPlaces, setRelatedPlaces] = useState<RelatedPlacesSectionValue>(EMPTY_RELATED_PLACES);
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const { isEnabled, getProps } = useSectionConfig("ffr_new");

  // Request Purpose (multi-select)
  const [requestPurposes, setRequestPurposes] = useState<string[]>(["tnr"]);
  const [wellnessCatCount, setWellnessCatCount] = useState<number | "">("");

  // Computed: check if specific purposes are selected
  const hasTnr = requestPurposes.includes("tnr");
  const hasWellness = requestPurposes.includes("wellness");
  const hasRelocation = requestPurposes.includes("relocation");
  const hasRescue = requestPurposes.includes("rescue");

  // About the Cats (totalCatsReported, peakCount, countConfidence, awarenessDuration, catsAreFriendly now facade-derived)
  const [catName, setCatName] = useState("");
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");
  const [colonyDuration, setColonyDuration] = useState("unknown");
  const [eartipCount, setEartipCount] = useState<number | "">("");
  const [eartipEstimate, setEartipEstimate] = useState("unknown");

  // MIG_2532: Third-party tracking (affects requester intelligence)
  const [isThirdPartyReport, setIsThirdPartyReport] = useState(false);
  const [thirdPartyRelationship, setThirdPartyRelationship] = useState("");
  const [siteContactValue, setSiteContactValue] = useState<PersonSectionValue>(EMPTY_PERSON_VALUE);

  // FFS-298: Requester relationship to location (non-third-party)
  const [requesterRole, setRequesterRole] = useState("resident");

  // MIG_2532: Service area (FFS-685: default from config)
  const [county, setCounty] = useState(defaultCounty || "Sonoma");

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

  // FFS-931: Gentle gate — soft validation warnings before submit
  const [gentleGateWarnings, setGentleGateWarnings] = useState<string[]>([]);
  const [showGentleGate, setShowGentleGate] = useState(false);
  const [gentleGateBypassed, setGentleGateBypassed] = useState(false);

  // FFS-932: Phone detection nudge for free text fields
  const [detectedPhone, setDetectedPhone] = useState<{ phone: string; field: string } | null>(null);
  const [phoneNudgeDismissed, setPhoneNudgeDismissed] = useState(false);

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

  // FFS-932: Detect phone numbers in free text fields on blur
  const handleTextFieldBlur = useCallback((value: string, fieldName: string) => {
    if (phoneNudgeDismissed || requestorPhone) return;
    const phones = extractPhones(value);
    if (phones.length > 0 && isValidPhone(phones[0])) {
      setDetectedPhone({ phone: phones[0], field: fieldName });
    }
  }, [phoneNudgeDismissed, requestorPhone]);

  // FFS-932: Also detect phones when urgency notes or case notes change (these are in child components)
  useEffect(() => {
    if (phoneNudgeDismissed || requestorPhone || detectedPhone) return;
    // Check urgency notes
    const urgencyPhones = extractPhones(urgencyNotes);
    if (urgencyPhones.length > 0 && isValidPhone(urgencyPhones[0])) {
      setDetectedPhone({ phone: urgencyPhones[0], field: "Urgency Notes" });
      return;
    }
    // Check case notes
    const notePhones = extractPhones(notes);
    if (notePhones.length > 0 && isValidPhone(notePhones[0])) {
      setDetectedPhone({ phone: notePhones[0], field: "Case Notes" });
    }
  }, [urgencyNotes, notes, phoneNudgeDismissed, requestorPhone, detectedPhone]);

  const acceptDetectedPhone = useCallback(() => {
    if (detectedPhone) {
      setRequestorPhone(detectedPhone.phone);
      setDetectedPhone(null);
    }
  }, [detectedPhone]);

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
    accessNotes,
  };

  const handlePropertyAccessChange = useCallback(
    (v: PropertyAccessValue) => {
      setPermissionStatus(v.permissionStatus);
      setAccessNotes(v.accessNotes);
    },
    []
  );

  const catDetailsValue: CatDetailsSectionValue = {
    estimatedCatCount,
    colonyDuration,
    eartipCount,
    eartipEstimate,
    catName,
    catDescription: "",
    wellnessCatCount,
    requestPurposes,
    handleability,
    ownershipStatus,
  };

  const handleCatDetailsChange = useCallback(
    (v: CatDetailsSectionValue) => {
      setEstimatedCatCount(v.estimatedCatCount);
      setColonyDuration(v.colonyDuration);
      setEartipCount(v.eartipCount);
      setEartipEstimate(v.eartipEstimate);
      setCatName(v.catName);
      setWellnessCatCount(v.wellnessCatCount);
      setRequestPurposes(v.requestPurposes);
      setHandleability(v.handleability);
      setOwnershipStatus(v.ownershipStatus);
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

  const handleStaffTriageChange = useCallback(
    (v: StaffTriageValue) => {
      setStaffTriageValue(v);
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

    // FFS-931: Hard validation for phone entry mode — caller is on the line
    if (entryMode === "phone") {
      const hardErrors: string[] = [];
      if (!requestorFirstName.trim()) {
        hardErrors.push("Caller's first name is required for phone intake");
      }
      if (!requestorPhone || !isValidPhone(requestorPhone)) {
        hardErrors.push("Caller's phone number is required for phone intake");
      }
      if (hardErrors.length > 0) {
        setError(hardErrors.join(". "));
        // Scroll to requester section
        document.getElementById("section-2")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    // FFS-931: Soft validation — gentle gate (warn but allow skip)
    if (!gentleGateBypassed) {
      const warnings: string[] = [];
      if (!summary && !requestorFirstName) warnings.push("No request title — will show blank in list views");
      if (estimatedCatCount === "") warnings.push("No cat count — helps with scheduling");
      if (!requestorPhone && entryMode !== "phone") warnings.push("No phone number — trappers may not be able to coordinate");
      if (warnings.length > 0) {
        setGentleGateWarnings(warnings);
        setShowGentleGate(true);
        return; // Show gate, don't submit yet
      }
    }
    // Reset gate state for next submission
    setGentleGateBypassed(false);
    setShowGentleGate(false);
    setGentleGateWarnings([]);

    // FFS-934: Auto-generate summary fallback from address + cat count
    let effectiveSummary = summary;
    if (!effectiveSummary) {
      const catCount = estimatedCatCount !== "" ? estimatedCatCount : "?";
      const address = selectedPlace?.formatted_address || selectedPlace?.display_name;
      if (address) {
        const shortAddr = address.split(",")[0];
        effectiveSummary = `${catCount} cat${catCount !== 1 ? "s" : ""} at ${shortAddr}`;
        setSummary(effectiveSummary);
      }
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
        // Facade: derive has_property_access from permissionStatus
        has_property_access: permissionStatus === "yes" || permissionStatus === "not_needed" ? true
          : permissionStatus === "no" ? false : null,
        access_notes: accessNotes || null,
        // Facade: traps_overnight_safe + access_without_contact from StaffTriagePanel (Phase 2)
        traps_overnight_safe: staffTriageValue.trapsOvernightSafe,
        access_without_contact: staffTriageValue.accessWithoutContact,
        // About the Cats
        estimated_cat_count: estimatedCatCount !== "" ? estimatedCatCount : null,
        // Facade: total_cats_reported defaults to estimated unless Phase 2 overrides
        total_cats_reported: staffTriageValue.totalCatsOverride !== ""
          ? staffTriageValue.totalCatsOverride
          : (estimatedCatCount !== "" ? estimatedCatCount : null),
        // Facade: peak_count defaults to estimated unless Phase 2 overrides
        peak_count: staffTriageValue.peakCount !== ""
          ? staffTriageValue.peakCount
          : (estimatedCatCount !== "" ? estimatedCatCount : null),
        wellness_cat_count: hasWellness ? (wellnessCatCount !== "" ? wellnessCatCount : null) : null,
        // Facade: count_confidence from StaffTriagePanel (Phase 2), default unknown
        count_confidence: staffTriageValue.countConfidence,
        colony_duration: colonyDuration,
        // Facade: derive awareness_duration from colonyDuration
        awareness_duration: colonyDuration === "under_1_month" ? "weeks"
          : colonyDuration === "1_to_6_months" ? "months"
          : colonyDuration === "6_to_24_months" || colonyDuration === "over_2_years" ? "years"
          : "unknown",
        eartip_count: showExactEartipCount ? (eartipCount !== "" ? eartipCount : null) : null,
        eartip_estimate: !showExactEartipCount ? eartipEstimate : null,
        // Facade: derive cats_are_friendly from handleability
        cats_are_friendly: handleability === "friendly_carrier" ? true
          : handleability === "unhandleable_trap" ? false : null,
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
        county: county || defaultCounty || "Sonoma",
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
        // Facade: priority from StaffTriagePanel if set, else from urgency section
        priority: staffTriageValue.priority !== "normal" ? staffTriageValue.priority : priority,
        // Triage category from StaffTriagePanel
        triage_category: staffTriageValue.triageCategory || null,
        // Trapping Logistics (FFS-151)
        ownership_status: ownershipStatus || null,
        handleability: handleability || null,
        fixed_status: fixedStatus || null,
        dogs_on_site: dogsOnSite || null,
        // Facade: trap_savvy + previous_tnr from StaffTriagePanel (Phase 2)
        trap_savvy: staffTriageValue.trapSavvy || null,
        previous_tnr: staffTriageValue.previousTnr || null,
        best_trapping_time: bestTrappingTime || null,
        // Facade: cat_description + important_notes from StaffTriagePanel (Phase 2)
        cat_description: staffTriageValue.catDescription || null,
        important_notes: staffTriageValue.importantNotes.length > 0 ? staffTriageValue.importantNotes : null,
        // Additional
        summary: effectiveSummary || null,
        notes: notes || null,
        internal_notes: internalNotes || null,
        created_by: "app_user",
        // Language preference
        preferred_language: preferredLanguage || null,
        // Related people
        related_people: otherParties.entries
          .filter((e) => e.is_resolved || e.phone || e.email || e.display_name)
          .map((e) => ({
            person_id: e.person_id,
            raw_name: e.display_name || `${e.first_name} ${e.last_name}`.trim(),
            raw_phone: e.phone || undefined,
            raw_email: e.email || undefined,
            relationship_type: e.relationship_type || "other",
            relationship_notes: e.relationship_notes || undefined,
            notify_before_release: e.notify_before_release,
            preferred_language: e.preferred_language || undefined,
          })),
        // Related places
        related_places: relatedPlaces.entries
          .filter((e) => e.place_id)
          .map((e) => ({
            place_id: e.place_id,
            relationship_type: e.relationship_type || "other",
            relationship_notes: e.relationship_notes || undefined,
            is_primary_trapping_site: e.is_primary_trapping_site,
          })),
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

  // ─── Section Configuration (FFS-1001 UX Consolidation) ─────────────────────
  const FORM_SECTIONS = [
    { id: "caller", icon: "phone" as const, label: "Who\u2019s calling?", shortLabel: "Caller" },
    { id: "location", icon: "map-pin" as const, label: "Where are the cats?", shortLabel: "Location" },
    { id: "cats", icon: "cat" as const, label: "Tell me about the cats", shortLabel: "Cats" },
    { id: "anything-else", icon: "clipboard-list" as const, label: "Anything else?", shortLabel: "Anything else?" },
  ];

  // Section completeness for step indicators (FFS-933)
  const sectionStatus = {
    caller: requestorFirstName && requestorPhone ? "complete" : requestorFirstName || requestorPhone ? "partial" : "empty",
    location: selectedPlace ? "complete" : "empty",
    cats: (estimatedCatCount !== "" && handleability) ? "complete" : estimatedCatCount !== "" ? "partial" : "empty",
    "anything-else": summary ? "complete" : notes || internalNotes || urgencyNotes ? "partial" : "empty",
  } as Record<string, "complete" | "partial" | "empty">;

  const sectionDotColor = (status: string) =>
    status === "complete" ? "var(--success-text, #16a34a)" :
    status === "partial" ? "var(--warning-text, #ca8a04)" :
    "var(--text-tertiary, #9ca3af)";

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto" }}>
      <BackButton fallbackHref="/requests" />

      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem", fontSize: "1.5rem", fontWeight: 700, color: "var(--foreground)" }}>New Request</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        {entryMode === "phone" ? "Capture the caller\u2019s information as you talk" : entryMode === "complete" ? "Record a completed request" : "Enter request details"}
      </p>

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

      {/* FFS-931: Gentle Gate Modal — soft validation warnings */}
      {showGentleGate && gentleGateWarnings.length > 0 && (
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
              maxWidth: "480px",
              width: "90%",
            }}
          >
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: BORDERS.radius.full,
              background: COLORS.warning,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: `0 auto ${SPACING.md}`,
              fontSize: "1.5rem",
            }}>!</div>
            <h3 style={{ textAlign: "center", marginBottom: SPACING.md }}>Quick check before submitting</h3>
            <ul style={{ margin: `0 0 ${SPACING.lg}`, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
              {gentleGateWarnings.map((w) => (
                <li key={w} style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{w}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => { setShowGentleGate(false); setGentleGateWarnings([]); }}
                style={{ fontWeight: 600 }}
              >
                Go back and add
              </button>
              <button
                type="button"
                onClick={() => {
                  setGentleGateBypassed(true);
                  setShowGentleGate(false);
                  setGentleGateWarnings([]);
                  // Re-trigger submit with gate bypassed
                  setTimeout(() => {
                    const form = document.querySelector("form");
                    if (form) form.requestSubmit();
                  }, 50);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border, #e5e7eb)",
                  color: "var(--text-muted, #6b7280)",
                  fontWeight: 400,
                }}
              >
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step indicator — jump nav with completeness dots */}
      <div style={{
        display: 'flex',
        gap: '6px',
        marginBottom: SPACING.xl,
        padding: '10px 0',
        overflowX: 'auto',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--background)',
        borderBottom: '1px solid var(--border-light, transparent)',
      }}>
        {FORM_SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#section-${section.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary, #f3f4f6)',
              borderRadius: '9999px',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'background 150ms, box-shadow 150ms',
              border: '1px solid transparent',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-raised, #e5e7eb)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'var(--bg-secondary, #f3f4f6)'; e.currentTarget.style.borderColor = 'transparent'; }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: sectionDotColor(sectionStatus[section.id]),
              flexShrink: 0,
            }} />
            <Icon name={section.icon} size={14} />
            {section.shortLabel}
          </a>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* ─── SECTION 1: Who's calling? ─────────────────────────────── */}
        <div id="section-caller" className="card card-elevated" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <Icon name="phone" size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--foreground)" }}>Who&apos;s calling?</h2>
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", marginBottom: "1rem", marginLeft: "30px" }}>
            Ask: &ldquo;May I have your name and the best number to reach you?&rdquo;
          </p>

          <PersonSection
            role="requestor"
            value={requestorPersonValue}
            onChange={handleRequestorPersonChange}
            onAddressSelected={handleRequestorAddressSelected}
            allowCreate
            required
            compact
            alwaysShowFields
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
              onBlur={(e) => handleTextFieldBlur(e.target.value, "Best Times to Contact")}
              placeholder="e.g., mornings, after 5pm, weekends..."
              style={{ width: "100%" }}
            />

            {/* FFS-932: Phone number detection nudge */}
            {detectedPhone && detectedPhone.field === "Best Times to Contact" && (
              <div style={{
                marginTop: "8px",
                padding: "8px 12px",
                background: "var(--warning-bg, #FEF3C7)",
                border: "1px solid var(--warning-border, #F59E0B)",
                borderRadius: "8px",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}>
                <span>Looks like a phone number ({formatPhone(detectedPhone.phone)})</span>
                <button
                  type="button"
                  onClick={acceptDetectedPhone}
                  style={{
                    padding: "2px 10px",
                    background: "var(--primary, #2563eb)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Add to Requester Phone
                </button>
                <button
                  type="button"
                  onClick={() => { setDetectedPhone(null); setPhoneNudgeDismissed(true); }}
                  style={{
                    padding: "2px 10px",
                    background: "transparent",
                    color: "var(--text-muted, #6b7280)",
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
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

          {/* Language preference */}
          <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: "1px solid var(--border-light, #f3f4f6)" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
              Language Preference
            </label>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
              style={{ width: "100%", maxWidth: "200px" }}
            >
              <option value="">English (default)</option>
              {LANGUAGE_OPTIONS.filter((o) => o.value !== "en").map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Other people involved (config-gated) */}
          {isEnabled("otherParties") && (
            <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: "1px solid var(--border-light, #f3f4f6)" }}>
              <OtherPartiesSection
                value={otherParties}
                onChange={setOtherParties}
                compact
                {...(getProps("otherParties") as { maxEntries?: number })}
              />
            </div>
          )}
        </div>

        {/* ─── SECTION 2: Where are the cats? ──────────────────────── */}
        <div id="section-location" className="card card-elevated" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <Icon name="map-pin" size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--foreground)" }}>Where are the cats?</h2>
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", marginBottom: "1rem", marginLeft: "30px" }}>
            Ask: &ldquo;What&apos;s the address where the cats are?&rdquo;
          </p>

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
            <p style={{ marginTop: "0.5rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--text-tertiary)" }}>
              Checking for existing requests...
            </p>
          )}

          {/* Permission & Access — inline in location section */}
          <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: "1px solid var(--border-light, #e5e7eb)" }}>
            <PropertyAccessSection
              value={propertyAccessValue}
              onChange={handlePropertyAccessChange}
              compact
            />
          </div>

          {/* Site logistics — dogs on site (trap-savvy + previous TNR moved to StaffTriagePanel) */}
          <div style={{ marginTop: SPACING.md, paddingTop: SPACING.md, borderTop: "1px solid var(--border-light, #e5e7eb)" }}>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.75rem" }}>Site conditions</p>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                  Dogs on site?
                </label>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }].map((o) => (
                    <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input type="radio" name="dogsOnSite" checked={dogsOnSite === o.v} onChange={() => setDogsOnSite(o.v)} />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Related locations (config-gated) */}
          {isEnabled("relatedPlaces") && (
            <div style={{ marginTop: SPACING.lg, paddingTop: SPACING.lg, borderTop: "1px solid var(--border-light, #f3f4f6)" }}>
              <RelatedPlacesSection
                value={relatedPlaces}
                onChange={setRelatedPlaces}
                compact
                {...(getProps("relatedPlaces") as { maxEntries?: number })}
              />
            </div>
          )}
        </div>

        {/* ─── SECTION 3: Tell me about the cats ────────────────────── */}
        <div id="section-cats" className="card card-elevated" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <Icon name="cat" size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--foreground)" }}>Tell me about the cats</h2>
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", marginBottom: "1rem", marginLeft: "30px" }}>
            Ask: &ldquo;How many cats are you seeing? Are they friendly or feral?&rdquo;
          </p>

          {/* Cat counts + assessment (existing component) */}
          <CatDetailsSection
            value={catDetailsValue}
            onChange={handleCatDetailsChange}
            compact
          />

          {/* Fixed Status — inline (handleability + ownershipStatus now in CatDetailsSection) */}
          <div style={{ marginTop: SPACING.md, paddingTop: SPACING.md, borderTop: "1px solid var(--border-light, #e5e7eb)" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Fixed status
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {FIXED_STATUS_OPTIONS.map((opt) => (
                  <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input type="radio" name="fixedStatus" checked={fixedStatus === opt.value} onChange={() => setFixedStatus(opt.value)} />
                    {opt.shortLabel}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Kittens */}
          <div style={{ marginTop: SPACING.md, paddingTop: SPACING.md, borderTop: "1px solid var(--border-light, #e5e7eb)" }}>
            <KittenAssessmentSection
              value={kittenValue}
              onChange={handleKittenChange}
              compact
            />
            {hasKittens && (
              <div style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #ffc107)", borderRadius: "8px", padding: "0.75rem", marginTop: "0.75rem", fontSize: "0.8rem" }}>
                <strong>Foster triage:</strong> Under 12 weeks ideal &bull; Friendly kittens prioritized &bull; Spayed mom = easier &bull; Already contained = faster intake
              </div>
            )}
          </div>
        </div>

        {/* Feeding + Medical — visually grouped with cat section */}
        <div className="card card-elevated" style={{ padding: SPACING.xl, marginBottom: SPACING.xl, marginTop: `-${SPACING.md}` }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "1rem" }}>Feeding &amp; health</p>

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

        {/* Medical Concerns — compact inline */}
        <div className="card card-elevated" style={{ padding: SPACING.lg, marginBottom: SPACING.xl, marginTop: `-${SPACING.md}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>Medical concerns</span>
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

        {/* ─── SECTION 4: Anything else? ──────────────────────────── */}
        <div id="section-anything-else" className="card card-elevated" style={{ padding: SPACING.xl, marginBottom: SPACING.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <Icon name="clipboard-list" size={20} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--foreground)" }}>Anything else?</h2>
          </div>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", marginBottom: "1rem", marginLeft: "30px" }}>
            Urgency, scheduling notes, and anything the caller wants to add
          </p>

          {/* Urgency section (merged from old section 4) */}
          <UrgencyNotesSection
            value={urgencyNotesValue}
            onChange={handleUrgencyNotesChange}
            showDetails={false}
            compact
          />

          {/* FFS-932: Phone detection nudge for urgency/case notes */}
          {detectedPhone && (detectedPhone.field === "Urgency Notes" || detectedPhone.field === "Case Notes") && (
            <div style={{
              margin: "-12px 0 20px",
              padding: "8px 12px",
              background: "var(--warning-bg, #FEF3C7)",
              border: "1px solid var(--warning-border, #F59E0B)",
              borderRadius: "8px",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}>
              <span>Phone number detected in {detectedPhone.field} ({formatPhone(detectedPhone.phone)})</span>
              <button
                type="button"
                onClick={acceptDetectedPhone}
                style={{
                  padding: "2px 10px",
                  background: "var(--primary, #2563eb)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Add to Requester Phone
              </button>
              <button
                type="button"
                onClick={() => { setDetectedPhone(null); setPhoneNudgeDismissed(true); }}
                style={{
                  padding: "2px 10px",
                  background: "transparent",
                  color: "var(--text-muted, #6b7280)",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Best trapping time */}
          <div style={{ marginBottom: SPACING.md }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Best trapping time
            </label>
            <input type="text" value={bestTrappingTime} onChange={(e) => setBestTrappingTime(e.target.value)} placeholder="e.g., Weekday evenings" style={{ width: "100%" }} />
          </div>

          {/* Summary + notes */}
          <div style={{ marginBottom: SPACING.md, paddingTop: SPACING.md, borderTop: "1px solid var(--border-light, #e5e7eb)" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Request title
            </label>
            <input type="text" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g., '5 cats at Oak Street colony' — auto-generated if blank" style={{ width: "100%" }} />
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              Shows in list views. Leave blank to auto-generate from address + cat count.
            </p>
          </div>

          <div style={{ marginBottom: SPACING.md }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Case info
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Situation description, history, special circumstances..." rows={3} style={{ width: "100%", resize: "vertical" }} />
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              Shared with volunteers. Use internal notes for staff-only info.
            </p>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Internal notes
            </label>
            <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Staff working notes, follow-up reminders..." rows={2} style={{ width: "100%", resize: "vertical" }} />
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              Private — not shared with clients or volunteers
            </p>
          </div>
        </div>

        {/* Staff Triage Panel (Phase 2) — between form and submit button */}
        {entryMode !== "complete" && (
          <StaffTriagePanel
            value={staffTriageValue}
            onChange={handleStaffTriageChange}
            entryMode={entryMode}
            estimatedCatCount={estimatedCatCount}
          />
        )}

        {/* SECTION: Completion Data (only shown in Quick Complete mode) */}
        {entryMode === "complete" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <CompletionSection
              value={completionData}
              onChange={setCompletionData}
            />
          </div>
        )}

        {error && (
          <div style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--danger-bg, #fee2e2)",
            border: "1px solid var(--danger-border, #dc2626)",
            borderRadius: "8px",
            color: "var(--danger-text, #721c24)",
            fontSize: "0.9rem",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 0" }}>
          <Button
            variant="primary"
            size="lg"
            type="submit"
            loading={submitting}
            icon={entryMode === "complete" ? "check" : "plus"}
          >
            {entryMode === "complete" ? "Complete & Close Request" : "Create Request"}
          </Button>
          <Button variant="outline" size="lg" onClick={() => router.push("/requests")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<div className="page-container"><SkeletonTable rows={6} columns={3} /></div>}>
      <NewRequestForm />
    </Suspense>
  );
}
