"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { postApi, fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { KioskWizardShell } from "@/components/kiosk/KioskWizardShell";
import { TippyQuestionCard } from "@/components/kiosk/TippyQuestionCard";
import { KioskLocationStep } from "@/components/kiosk/KioskLocationStep";
import { KioskContactStep, type KioskContactData } from "@/components/kiosk/KioskContactStep";
import { KioskWelcomeBack, type PersonLookupResult } from "@/components/kiosk/KioskWelcomeBack";
import { KioskMissionFrame } from "@/components/kiosk/KioskMissionFrame";
import { KioskClinicReview } from "@/components/kiosk/KioskClinicReview";
import {
  CLINIC_CAT_TREE,
  classifyCatFromTags,
  type ClinicClassification,
} from "@/lib/clinic-cat-tree";
import {
  createInitialState,
  advanceTree,
  goBackTree,
  getCurrentNode,
  getProgress,
  getScoring,
  computePriorityScore,
  type TippyTree,
  type TippyState,
} from "@/lib/tippy-tree";
import type { TippyResourceCard } from "@/lib/tippy-tree";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { isValidPhone } from "@/lib/formatters";
import { useCommunityResources } from "@/hooks/useCommunityResources";

type ClinicPhase =
  | "contact"
  | "lookup"
  | "mission"
  | "questions"
  | "pet_redirect"
  | "location"
  | "review"
  | "submitting"
  | "success";

/**
 * Clinic kiosk path — 8-phase wizard for the spay/neuter clinic lobby.
 *
 * Flow:
 *   contact → lookup → mission
 *     ├── "My own pet" → pet_redirect (resources, no intake)
 *     └── "Community cats" → questions (tree)
 *         ├── pet_score >= 7 → pet_redirect (soft redirect)
 *         └── pet_score < 7 → location → review → submit → success
 *
 * FFS-1102
 */
export default function KioskClinicPage() {
  const router = useRouter();
  const { success: toastSuccess } = useToast();

  const { resources: petSpayResources } = useCommunityResources("pet_spay");
  const { value: customTree } = useAppConfig<TippyTree | null>("kiosk.clinic_tree");
  const { value: successMessage } = useAppConfig<string>("kiosk.clinic_success_message");
  const { value: petRedirectMessage } = useAppConfig<string>("kiosk.pet_redirect_message");
  const { value: trapperWaitMessage } = useAppConfig<string>("kiosk.trapper_wait_message");
  const { value: welcomeBackEnabled } = useAppConfig<boolean>("kiosk.welcome_back_enabled");

  const tree = useMemo(() => {
    if (!customTree || typeof customTree !== "object") return CLINIC_CAT_TREE;
    if ("nodes" in customTree || "root" in customTree) return customTree as TippyTree;
    return CLINIC_CAT_TREE;
  }, [customTree]);

  // Wizard state
  const [phase, setPhase] = useState<ClinicPhase>("contact");
  const [treeState, setTreeState] = useState<TippyState>(() => createInitialState(tree));
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  const [freeformAddress, setFreeformAddress] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contact, setContact] = useState<KioskContactData>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });
  const [lookupResult, setLookupResult] = useState<PersonLookupResult>({
    found: false,
    person_id: null,
    display_name: null,
    first_name: null,
    context: null,
  });
  const [classification, setClassification] = useState<ClinicClassification | null>(null);

  const currentNode = getCurrentNode(treeState, tree);

  // Progress: contact(0) + lookup(1) + mission(2) + questions(3..N) + location + review
  const questionProgress = useMemo(
    () => getProgress(treeState, tree, true),
    [treeState, tree],
  );

  const totalSteps = 3 + questionProgress.total; // 3 = contact + lookup + mission
  const currentStep = useMemo(() => {
    switch (phase) {
      case "contact": return 0;
      case "lookup": return 1;
      case "mission": return 2;
      case "questions": return 2 + questionProgress.current;
      case "pet_redirect": return 2 + questionProgress.current;
      case "location": return totalSteps - 2;
      case "review": return totalSteps - 1;
      default: return 0;
    }
  }, [phase, questionProgress.current, totalSteps]);

  const canGoNext = useMemo(() => {
    if (phase === "contact") {
      return !!(contact.firstName.trim() && contact.phone && isValidPhone(contact.phone));
    }
    if (phase === "location") return !!(place || freeformAddress.trim());
    if (phase === "review") return true;
    return false;
  }, [phase, contact, place, freeformAddress]);

  // Person lookup
  const doPersonLookup = useCallback(async () => {
    if (!welcomeBackEnabled) {
      setLookupResult({ found: false, person_id: null, display_name: null, first_name: null, context: null });
      setPhase("mission");
      return;
    }

    setPhase("lookup");
    try {
      const phoneDigits = contact.phone.replace(/\D/g, "");
      const params = new URLSearchParams();
      if (phoneDigits) params.set("phone", phoneDigits);
      if (contact.email.trim()) params.set("email", contact.email.trim());

      const result = await fetchApi<PersonLookupResult>(`/api/kiosk/person-lookup?${params}`);
      setLookupResult(result);
    } catch {
      // Lookup failure is non-fatal — proceed with unknown visitor
      setLookupResult({ found: false, person_id: null, display_name: null, first_name: null, context: null });
    }
  }, [contact, welcomeBackEnabled]);

  // Handle question answer
  const handleQuestionAnswer = useCallback(
    (value: string) => {
      const newState = advanceTree(treeState, value, tree);
      setTreeState(newState);

      if (newState.outcome) {
        // Check classification
        const cls = classifyCatFromTags(newState.tags);
        setClassification(cls);

        if (cls.classification === "pet_redirect") {
          setTimeout(() => setPhase("pet_redirect"), 500);
        } else {
          // Continue to location
          setTimeout(() => setPhase("location"), 500);
        }
      }
    },
    [treeState, tree],
  );

  // Build and submit intake payload
  const handleSubmit = useCallback(async () => {
    setPhase("submitting");

    try {
      const scoring = getScoring(tree);
      const tags = treeState.tags;
      const cls = classification || classifyCatFromTags(tags);
      const priorityScore = computePriorityScore(tags, scoring.scoring_rules);

      // Derive cat count from tags
      let catCount: number | undefined;
      for (const key of scoring.cat_count_tags) {
        if (typeof tags[key] === "number") {
          catCount = tags[key] as number;
          break;
        }
      }

      const catsAddress =
        place?.formatted_address || place?.display_name || freeformAddress.trim() || "Unknown";

      // Map handleability tag to intake enum
      const handleabilityMap: Record<string, string> = {
        friendly_carrier: "friendly_carrier",
        shy_handleable: "shy_handleable",
        unhandleable_trap: "unhandleable_trap",
      };

      const payload = {
        source: "in_person" as const,
        source_system: "kiosk_clinic",
        first_name: contact.firstName.trim(),
        last_name: contact.lastName?.trim() || "(Walk-in)",
        phone: contact.phone.replace(/\D/g, ""),
        email: contact.email.trim() || undefined,
        existing_person_id: lookupResult.person_id || undefined,
        cats_address: catsAddress,
        selected_address_place_id: place?.place_id || undefined,
        call_type: cls.classification === "colony" ? "colony_tnr" : "single_stray",
        cat_count_estimate: catCount,
        has_kittens: cls.has_kittens || undefined,
        handleability: handleabilityMap[tags.handleability as string] || undefined,
        feeding_location: tags.feeding_location_raw ? String(tags.feeding_location_raw) : undefined,
        fixed_status: tags.fixed_status_raw ? String(tags.fixed_status_raw) : undefined,
        requester_relationship: tags.caller_role ? String(tags.caller_role) : undefined,
        has_property_access: tags.property_access === true || undefined,
        is_property_owner: tags.caller_role === "resident" || undefined,
        custom_fields: {
          tippy_branch: `clinic_${cls.classification}`,
          tippy_outcome: cls.classification,
          tippy_answers: JSON.stringify(
            Object.fromEntries(treeState.history.map((h) => [h.node_id, h.value])),
          ),
          tippy_tags: JSON.stringify(tags),
          tippy_priority_score: String(priorityScore),
          tippy_cat_count: catCount != null ? String(catCount) : undefined,
          tippy_classification: cls.classification,
          tippy_net_score: String(cls.net_score),
          tippy_hoarding_flag: cls.hoarding_flag ? "true" : undefined,
          tippy_needs_trapper: cls.needs_trapper ? "true" : undefined,
          // Map key behavioral fields for staff review
          tippy_sleeping_location: tags.sleeping_location ? String(tags.sleeping_location) : undefined,
          tippy_feeding_location: tags.feeding_location_raw ? String(tags.feeding_location_raw) : undefined,
          tippy_litter_box: tags.litter_box ? String(tags.litter_box) : undefined,
          tippy_vet_history: tags.vet_history ? String(tags.vet_history) : undefined,
          tippy_handleability: tags.handleability ? String(tags.handleability) : undefined,
          tippy_ear_tip_coverage: tags.ear_tip_coverage ? String(tags.ear_tip_coverage) : undefined,
          tippy_growth: tags.growth ? String(tags.growth) : undefined,
          tippy_cats_inside: tags.cats_inside ? String(tags.cats_inside) : undefined,
          tippy_caller_role: tags.caller_role ? String(tags.caller_role) : undefined,
        },
      };

      await postApi("/api/intake", payload);
      setSubmitError(null);
      setPhase("success");
      toastSuccess("Request submitted!");
    } catch (err) {
      console.error("[KIOSK CLINIC] Submit error:", err);
      setSubmitError("Something went wrong. Please try again or ask staff for help.");
      setPhase("review");
    }
  }, [contact, place, freeformAddress, treeState, tree, classification, lookupResult, toastSuccess]);

  // Navigation
  const goNext = useCallback(() => {
    if (phase === "contact") {
      doPersonLookup();
    } else if (phase === "location") {
      setPhase("review");
    } else if (phase === "review") {
      handleSubmit();
    }
  }, [phase, doPersonLookup, handleSubmit]);

  const goBack = useCallback(() => {
    if (phase === "contact") {
      router.push("/kiosk");
    } else if (phase === "lookup") {
      setPhase("contact");
    } else if (phase === "mission") {
      setPhase("contact");
    } else if (phase === "questions") {
      if (treeState.history.length > 0) {
        setTreeState(goBackTree(treeState));
      } else {
        setPhase("mission");
      }
    } else if (phase === "pet_redirect") {
      // Go back to questions (undo last answer if outcome was reached)
      if (treeState.outcome) {
        const prevState = goBackTree(treeState);
        setTreeState(prevState);
        setClassification(null);
      }
      setPhase("questions");
    } else if (phase === "location") {
      // Back to last question (undo outcome)
      if (treeState.outcome) {
        const prevState = goBackTree(treeState);
        setTreeState(prevState);
        setClassification(null);
      }
      setPhase("questions");
    } else if (phase === "review") {
      setPhase("location");
    }
  }, [phase, treeState, router]);

  // ── Success screen ──────────────────────────────────────────────────────────
  if (phase === "success") {
    const cls = classification || classifyCatFromTags(treeState.tags);
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1.5rem",
          textAlign: "center",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "var(--success-bg, rgba(34,197,94,0.1))",
            border: "3px solid var(--success-text, #16a34a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={40} color="var(--success-text, #16a34a)" />
        </div>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {successMessage}
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 400 }}>
          {cls.needs_trapper
            ? trapperWaitMessage
            : "Someone from our team will reach out to you about your cat situation."}
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => router.push("/kiosk")}
          style={{ minHeight: 56, borderRadius: 14, minWidth: 200, marginTop: "1rem" }}
        >
          Done
        </Button>
      </div>
    );
  }

  // ── Submitting spinner ──────────────────────────────────────────────────────
  if (phase === "submitting") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: "4px solid var(--card-border, #e5e7eb)",
            borderTopColor: "var(--primary)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-secondary)" }}>
          Submitting your request...
        </p>
      </div>
    );
  }

  // ── Pet redirect screen ─────────────────────────────────────────────────────
  if (phase === "pet_redirect") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ textAlign: "center", paddingTop: "0.5rem" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "var(--info-bg, rgba(59,130,246,0.06))",
                border: "2px solid var(--info-text, #1d4ed8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
              }}
            >
              <Icon name="home" size={32} color="var(--info-text, #1d4ed8)" />
            </div>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--text-primary)",
                margin: "0 0 0.5rem",
                lineHeight: 1.2,
              }}
            >
              {classification?.net_score != null && classification.net_score >= 7
                ? "It sounds like this might be a pet!"
                : "Low-Cost Pet Spay/Neuter"}
            </h2>
            <p
              style={{
                fontSize: "0.95rem",
                color: "var(--text-secondary)",
                margin: 0,
                lineHeight: 1.5,
                maxWidth: 380,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              {petRedirectMessage}
            </p>
          </div>

          {/* Resource cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {petSpayResources.map((resource, idx) => (
              <PetResourceCard key={idx} resource={resource} />
            ))}
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push("/kiosk")}
            style={{ minHeight: 56, borderRadius: 14, fontSize: "1.05rem", marginTop: "0.5rem" }}
          >
            Done
          </Button>
        </div>
      </KioskWizardShell>
    );
  }

  // ── Lookup (auto-advancing welcome back) ────────────────────────────────────
  if (phase === "lookup") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
      >
        <KioskWelcomeBack
          lookupResult={lookupResult}
          onContinue={() => setPhase("mission")}
        />
      </KioskWizardShell>
    );
  }

  // ── Mission framing ─────────────────────────────────────────────────────────
  if (phase === "mission") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
      >
        <KioskMissionFrame
          hasPreviousPetSpay={lookupResult.context?.has_previous_pet_spay ?? false}
          onCommunity={() => {
            setTreeState(createInitialState(tree));
            setClassification(null);
            setPhase("questions");
          }}
          onPet={() => setPhase("pet_redirect")}
        />
      </KioskWizardShell>
    );
  }

  // ── Questions ───────────────────────────────────────────────────────────────
  if (phase === "questions" && currentNode) {
    const lastHistoryForNode = treeState.history.find((h) => h.node_id === currentNode.id);
    const selectedValue = lastHistoryForNode?.value;

    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
      >
        <TippyQuestionCard
          node={currentNode}
          selectedValue={selectedValue}
          onSelect={handleQuestionAnswer}
        />
      </KioskWizardShell>
    );
  }

  // ── Contact step ────────────────────────────────────────────────────────────
  if (phase === "contact") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={goNext}
        canGoNext={canGoNext}
        nextLabel="Next"
      >
        <KioskContactStep
          data={contact}
          onChange={setContact}
          showLastName
        />
      </KioskWizardShell>
    );
  }

  // ── Location step ───────────────────────────────────────────────────────────
  if (phase === "location") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={goNext}
        canGoNext={canGoNext}
      >
        <KioskLocationStep
          place={place}
          onPlaceChange={setPlace}
          freeformAddress={freeformAddress}
          onFreeformChange={setFreeformAddress}
        />
      </KioskWizardShell>
    );
  }

  // ── Review step ─────────────────────────────────────────────────────────────
  const locationDisplay =
    place?.display_name || place?.formatted_address || freeformAddress || "Not provided";
  const cls = classification || classifyCatFromTags(treeState.tags);

  // Derive cat count for display
  let displayCatCount: number | undefined;
  const scoring = getScoring(tree);
  for (const key of scoring.cat_count_tags) {
    if (typeof treeState.tags[key] === "number") {
      displayCatCount = treeState.tags[key] as number;
      break;
    }
  }

  return (
    <KioskWizardShell
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={goBack}
      onNext={goNext}
      canGoNext
      nextLabel="Submit Request"
    >
      <KioskClinicReview
        contact={contact}
        locationDisplay={locationDisplay}
        classification={cls}
        catCount={displayCatCount}
        submitError={submitError}
      />
    </KioskWizardShell>
  );
}

function PetResourceCard({ resource }: { resource: TippyResourceCard }) {
  return (
    <div
      style={{
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: 14,
        padding: "1rem 1.25rem",
        display: "flex",
        gap: "0.875rem",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "var(--primary-bg, rgba(59,130,246,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={resource.icon} size={20} color="var(--primary)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: "var(--text-primary)",
            marginBottom: "0.25rem",
          }}
        >
          {resource.name}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
            marginBottom: resource.phone ? "0.5rem" : 0,
          }}
        >
          {resource.description}
        </div>
        {resource.phone && (
          <a
            href={`tel:${resource.phone.replace(/\D/g, "")}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--primary)",
              textDecoration: "none",
            }}
          >
            <Icon name="phone" size={14} />
            {resource.phone}
          </a>
        )}
      </div>
    </div>
  );
}
