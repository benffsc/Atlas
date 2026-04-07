"use client";

import { useState, useCallback, useMemo, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useKioskStaff } from "@/components/kiosk/KioskStaffContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
  | "trapping_fork"
  | "trapping_wait"
  | "questions"
  | "pet_redirect"
  | "location"
  | "review"
  | "submitting"
  | "success";

/**
 * Clinic kiosk path — wizard for the spay/neuter clinic lobby.
 *
 * Flow:
 *   contact → lookup → mission
 *     ├── "My own pet" → pet_redirect (resources, no intake)
 *     └── "Community cats" → trapping_fork
 *         ├── "Yes, I need a trapper" → trapping_wait → questions
 *         └── "No, I'll trap myself"  →                  questions
 *                                       ├── pet_score >= 7 → pet_redirect
 *                                       └── pet_score < 7  → location → review → submit → success
 *
 * The trapping_fork question is the explicit user-facing equivalent of the
 * `needs_trapper` tag (which is otherwise inferred from cat-tree handleability).
 * "No" routes through the intake queue tagged for self-service appointment
 * scheduling — the main way submissions reach Jami.
 *
 * **Phone intake mode (FFS-1107):** When opened with `?mode=phone`, this page
 * runs as a staff-driven phone call intake. It shares the same Tippy tree,
 * mission framing, person lookup, pet redirect, and classification as the
 * public lobby flow — guaranteeing both channels ask identical questions and
 * produce comparable `ops.intake_submissions` rows.
 *
 * Phone-mode attribution prefers the kiosk-badge staff (if set), falling back
 * to the admin-authenticated user. The `kiosk.allow_phone_intake` config key
 * (default `true`) can disable the entry point entirely.
 *
 * FFS-1102 / FFS-1107
 */
export default function KioskClinicPage() {
  return (
    <Suspense fallback={null}>
      <KioskClinicContent />
    </Suspense>
  );
}

function KioskClinicContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeStaff } = useKioskStaff();
  const { user: adminUser } = useCurrentUser();
  const { success: toastSuccess } = useToast();

  // FFS-1107 — phone-intake mode
  const { value: allowPhoneIntake } = useAppConfig<boolean>("kiosk.allow_phone_intake");
  const isPhoneMode = searchParams.get("mode") === "phone";

  // Phone-mode attribution: prefer the kiosk-badge staff, fall back to the
  // admin-authenticated user (so clicking the CTA from /admin/intake/call
  // works even without a PIN-selected badge).
  const phoneIntakeStaffId = isPhoneMode
    ? activeStaff?.staff_id || adminUser?.staff_id || null
    : null;
  const phoneIntakeStaffName = isPhoneMode
    ? activeStaff?.display_name || adminUser?.display_name || null
    : null;

  // If phone intake is explicitly disabled via config, fall back to legacy form.
  useEffect(() => {
    if (isPhoneMode && allowPhoneIntake === false) {
      router.replace("/admin/intake/call");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhoneMode, allowPhoneIntake]);

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
  // Explicit answer to "Do you need trapping assistance?" (FFS-1107 outline)
  // null = not yet asked, true = yes (route through trapper queue), false = self-service
  const [trappingAssistance, setTrappingAssistance] = useState<boolean | null>(null);

  const currentNode = getCurrentNode(treeState, tree);

  // FFS-1107 — banner shown on every wizard step while in phone mode
  const phoneBanner = isPhoneMode ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.625rem 0.875rem",
        background: "var(--info-bg, rgba(59,130,246,0.08))",
        border: "1px solid var(--info-border, #93c5fd)",
        borderRadius: 10,
        fontSize: "0.85rem",
        color: "var(--info-text, #1d4ed8)",
      }}
    >
      <Icon name="phone" size={16} color="var(--info-text, #1d4ed8)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, lineHeight: 1.2 }}>
          Phone intake
          {phoneIntakeStaffName
            ? ` — ${phoneIntakeStaffName} entering on behalf of caller`
            : " — staff entering on behalf of caller"}
        </div>
        <div style={{ fontSize: "0.72rem", opacity: 0.85, marginTop: 2 }}>
          Same questions as the lobby kiosk · source: phone
        </div>
      </div>
    </div>
  ) : null;

  // Progress: contact(0) + lookup(1) + mission(2) + trapping_fork(3) + questions(4..N) + location + review
  const questionProgress = useMemo(
    () => getProgress(treeState, tree, true),
    [treeState, tree],
  );

  const totalSteps = 4 + questionProgress.total; // 4 = contact + lookup + mission + trapping_fork
  const currentStep = useMemo(() => {
    switch (phase) {
      case "contact": return 0;
      case "lookup": return 1;
      case "mission": return 2;
      case "trapping_fork": return 3;
      case "trapping_wait": return 3; // overlay between fork and questions
      case "questions": return 3 + questionProgress.current;
      case "pet_redirect": return 3 + questionProgress.current;
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
      // Explicit trapping-fork answer overrides cat-tree inference for `needs_trapper`
      const effectiveNeedsTrapper =
        trappingAssistance == null ? cls.needs_trapper : trappingAssistance;
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
        source: isPhoneMode ? ("phone" as const) : ("in_person" as const),
        source_system: isPhoneMode ? "kiosk_clinic_phone" : "kiosk_clinic",
        first_name: contact.firstName.trim(),
        last_name: contact.lastName?.trim() || (isPhoneMode ? "(Phone call)" : "(Walk-in)"),
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
          tippy_needs_trapper: effectiveNeedsTrapper ? "true" : undefined,
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
          // FFS-1107 — phone intake attribution
          intake_method: isPhoneMode ? "phone_call" : "in_person_kiosk",
          phone_intake_staff_id: phoneIntakeStaffId || undefined,
          phone_intake_staff_name: phoneIntakeStaffName || undefined,
          // Trapping fork (explicit user answer, overrides cat-tree inference)
          trapping_assistance_requested:
            trappingAssistance == null ? undefined : String(trappingAssistance),
          // Self-service path → flag for the intake queue (Jami's main interface)
          intake_assigned_to: trappingAssistance === false ? "jami" : undefined,
          intake_followup_needed:
            trappingAssistance === false ? "self_service_appointment" : undefined,
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
  }, [contact, place, freeformAddress, treeState, tree, classification, lookupResult, toastSuccess, isPhoneMode, phoneIntakeStaffId, phoneIntakeStaffName, trappingAssistance]);

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
      router.push(isPhoneMode ? "/admin/intake/call" : "/kiosk");
    } else if (phase === "lookup") {
      setPhase("contact");
    } else if (phase === "mission") {
      setPhase("contact");
    } else if (phase === "trapping_fork") {
      setTrappingAssistance(null);
      setPhase("mission");
    } else if (phase === "trapping_wait") {
      setPhase("trapping_fork");
    } else if (phase === "questions") {
      if (treeState.history.length > 0) {
        setTreeState(goBackTree(treeState));
      } else {
        // Back from first question lands on the wait warning (if shown) or fork
        setPhase(trappingAssistance === true ? "trapping_wait" : "trapping_fork");
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
  }, [phase, treeState, router, isPhoneMode, trappingAssistance]);

  // FFS-1107 — reset wizard for logging another phone call without a full page reload
  const handleLogAnotherCall = () => {
    setContact({ firstName: "", lastName: "", phone: "", email: "" });
    setLookupResult({
      found: false,
      person_id: null,
      display_name: null,
      first_name: null,
      context: null,
    });
    setTreeState(createInitialState(tree));
    setPlace(null);
    setFreeformAddress("");
    setClassification(null);
    setTrappingAssistance(null);
    setSubmitError(null);
    setPhase("contact");
  };

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
          {isPhoneMode ? "Call logged" : successMessage}
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 400 }}>
          {isPhoneMode
            ? `Intake submitted. Classification: ${cls.classification.replace(/_/g, " ")}.`
            : (trappingAssistance ?? cls.needs_trapper)
              ? trapperWaitMessage
              : "Someone from our team will reach out to you about scheduling your appointment."}
        </p>
        {isPhoneMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", maxWidth: 320, marginTop: "0.5rem" }}>
            <Button
              variant="primary"
              size="lg"
              icon="phone"
              onClick={handleLogAnotherCall}
              style={{ minHeight: 56, borderRadius: 14 }}
            >
              Log Another Call
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => router.push("/admin/intake/call")}
              style={{ minHeight: 56, borderRadius: 14 }}
            >
              Back to Admin
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push("/kiosk")}
            style={{ minHeight: 56, borderRadius: 14, minWidth: 200, marginTop: "1rem" }}
          >
            Done
          </Button>
        )}
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
        headerBanner={phoneBanner}
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
        headerBanner={phoneBanner}
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
        headerBanner={phoneBanner}
      >
        <KioskMissionFrame
          hasPreviousPetSpay={lookupResult.context?.has_previous_pet_spay ?? false}
          onCommunity={() => {
            setTreeState(createInitialState(tree));
            setClassification(null);
            setTrappingAssistance(null);
            setPhase("trapping_fork");
          }}
          onPet={() => setPhase("pet_redirect")}
        />
      </KioskWizardShell>
    );
  }

  // ── Trapping assistance fork ────────────────────────────────────────────────
  // Explicit user-facing question matching the original sketch:
  // "Do you need our help trapping the cats?"
  if (phase === "trapping_fork") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
        headerBanner={phoneBanner}
      >
        <TrappingForkCard
          onYes={() => {
            setTrappingAssistance(true);
            setPhase("trapping_wait");
          }}
          onNo={() => {
            setTrappingAssistance(false);
            setPhase("questions");
          }}
        />
      </KioskWizardShell>
    );
  }

  // ── Trapping wait-time warning (only after Yes) ─────────────────────────────
  if (phase === "trapping_wait") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => setPhase("questions")}
        canGoNext
        nextLabel="Continue"
        headerBanner={phoneBanner}
      >
        <TrappingWaitWarning message={trapperWaitMessage} />
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
        headerBanner={phoneBanner}
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
        headerBanner={phoneBanner}
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
        headerBanner={phoneBanner}
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
      nextLabel={isPhoneMode ? "Submit Call" : "Submit Request"}
      headerBanner={phoneBanner}
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

/**
 * Trapping fork — explicit "Do you need our help trapping?" question.
 * Matches the original kiosk outline. Yes routes through the trapper-assistance
 * queue with a wait-time warning; No routes through the self-service intake
 * queue (the main path that reaches Jami for appointment scheduling).
 */
function TrappingForkCard({
  onYes,
  onNo,
}: {
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            border: "2px solid var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon name="paw-print" size={32} color="var(--primary)" />
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
          Do you need our help trapping the cats?
        </h2>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 380,
            marginInline: "auto",
            lineHeight: 1.5,
          }}
        >
          We can send a volunteer trapper, or you can borrow our equipment and
          trap the cats yourself.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Button
          variant="outline"
          size="lg"
          icon="users"
          fullWidth
          onClick={onYes}
          style={{
            minHeight: 72,
            borderRadius: 14,
            fontSize: "1.05rem",
            fontWeight: 600,
            justifyContent: "flex-start",
            paddingInline: "1.25rem",
          }}
        >
          Yes — I need a trapper
        </Button>
        <Button
          variant="outline"
          size="lg"
          icon="tool"
          fullWidth
          onClick={onNo}
          style={{
            minHeight: 72,
            borderRadius: 14,
            fontSize: "1.05rem",
            fontWeight: 600,
            justifyContent: "flex-start",
            paddingInline: "1.25rem",
          }}
        >
          No — I&apos;ll trap them myself
        </Button>
      </div>
    </div>
  );
}

/**
 * Wait-time warning shown after the user picks "Yes, I need a trapper".
 * Uses the admin-configurable `kiosk.trapper_wait_message` so the warning
 * stays current as trapper availability changes.
 */
function TrappingWaitWarning({ message }: { message: string }) {
  const fallback =
    "Right now our volunteer trappers have a wait. We'll still help — please continue answering a few questions so we can prepare for your situation.";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--warning-bg, #fffbeb)",
            border: "2px solid var(--warning-border, #fcd34d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <Icon name="clock" size={32} color="var(--warning-text, #92400e)" />
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
          Heads up about the trapper wait
        </h2>
      </div>
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "var(--warning-bg, #fffbeb)",
          border: "1px solid var(--warning-border, #fcd34d)",
          borderRadius: 14,
          fontSize: "1rem",
          color: "var(--warning-text, #92400e)",
          lineHeight: 1.5,
        }}
      >
        {message || fallback}
      </div>
    </div>
  );
}
