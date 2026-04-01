"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { KioskWizardShell } from "@/components/kiosk/KioskWizardShell";
import { TippyQuestionCard } from "@/components/kiosk/TippyQuestionCard";
import { TippyOutcomeScreen } from "@/components/kiosk/TippyOutcomeScreen";
import { KioskLocationStep } from "@/components/kiosk/KioskLocationStep";
import { KioskContactStep, type KioskContactData } from "@/components/kiosk/KioskContactStep";
import {
  DEFAULT_TIPPY_TREE,
  createInitialState,
  advanceTree,
  goBackTree,
  getCurrentNode,
  getProgress,
  buildIntakePayload,
  type TippyTree,
  type TippyState,
} from "@/lib/tippy-tree";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { isValidPhone } from "@/lib/formatters";

type WizardPhase = "welcome" | "questions" | "outcome" | "location" | "contact" | "review" | "submitting" | "success";

/**
 * Kiosk Help Request — Tippy branching form.
 *
 * Welcome → Questions (branching tree) → Outcome
 *   ├── creates_intake=true  → Location → Contact → Review → Submit → Success
 *   └── creates_intake=false → Done (back to /kiosk)
 *
 * Submits to POST /api/intake with source_system: 'kiosk_tippy'.
 * Tree answers + outcome stored in custom_fields for staff review.
 *
 * FFS-1061, FFS-1062, FFS-1064, FFS-1065
 */
export default function KioskHelpPage() {
  const router = useRouter();
  const { success: toastSuccess } = useToast();

  // Load custom tree from admin config (null = use default)
  const { value: customTree } = useAppConfig<TippyTree | null>("kiosk.help_tree");
  const { value: successMessage } = useAppConfig<string>("kiosk.success_message");
  const tree = useMemo(
    () => {
      if (!customTree || typeof customTree !== "object") return DEFAULT_TIPPY_TREE;
      // Support both formats: new { nodes, scoring } and legacy { root, ... }
      if ("nodes" in customTree || "root" in customTree) return customTree as TippyTree;
      return DEFAULT_TIPPY_TREE;
    },
    [customTree],
  );

  // Wizard state
  const [phase, setPhase] = useState<WizardPhase>("welcome");
  const [treeState, setTreeState] = useState<TippyState>(() => createInitialState(tree));
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  const [freeformAddress, setFreeformAddress] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contact, setContact] = useState<KioskContactData>({
    firstName: "",
    phone: "",
    email: "",
  });

  const currentNode = getCurrentNode(treeState, tree);
  const createsIntake = treeState.outcome?.creates_intake ?? false;

  // Progress calculation
  const progressInfo = useMemo(
    () => getProgress(treeState, tree, createsIntake),
    [treeState, tree, createsIntake],
  );

  const totalSteps = useMemo(() => {
    if (phase === "welcome" || phase === "questions") return progressInfo.total;
    // Once we're past outcome, we know createsIntake
    return progressInfo.total;
  }, [phase, progressInfo.total]);

  const currentStep = useMemo(() => {
    if (phase === "welcome") return 0;
    if (phase === "questions") return progressInfo.current;
    if (phase === "outcome") return progressInfo.current;
    // Intake collection steps come after outcome
    const outcomeStep = progressInfo.current;
    if (phase === "location") return outcomeStep + 1;
    if (phase === "contact") return outcomeStep + 2;
    if (phase === "review") return outcomeStep + 3;
    return 0;
  }, [phase, progressInfo.current]);

  // Can proceed?
  const canGoNext = useMemo(() => {
    if (phase === "welcome") return true;
    if (phase === "questions") {
      // Need a selection on current node
      return false; // auto-advance handles progression
    }
    if (phase === "location") return !!(place || freeformAddress.trim());
    if (phase === "contact") return !!(contact.firstName.trim() && contact.phone && isValidPhone(contact.phone));
    if (phase === "review") return true;
    return false;
  }, [phase, place, freeformAddress, contact]);

  // Handle question answer — auto-advances via tree
  const handleQuestionAnswer = useCallback(
    (value: string) => {
      const newState = advanceTree(treeState, value, tree);
      setTreeState(newState);

      // If outcome resolved, move to outcome phase
      if (newState.outcome) {
        // Small delay so the user sees their selection highlight
        setTimeout(() => setPhase("outcome"), 500);
      }
      // Otherwise tree moved to next node automatically (TippyQuestionCard handles display)
    },
    [treeState, tree],
  );

  // Submit to intake API
  const handleSubmit = useCallback(async () => {
    setPhase("submitting");

    try {
      const payload = buildIntakePayload(treeState, contact, place, freeformAddress, tree);
      await postApi("/api/intake", payload);
      setSubmitError(null);
      setPhase("success");
      toastSuccess("Request submitted!");
    } catch (err) {
      console.error("[KIOSK] Submit error:", err);
      setSubmitError("Something went wrong. Please try again or ask staff for help.");
      setPhase("review");
    }
  }, [contact, place, freeformAddress, treeState, tree, toastSuccess]);

  // Navigation
  const goNext = useCallback(() => {
    if (phase === "welcome") {
      setPhase("questions");
      setTreeState(createInitialState(tree));
    } else if (phase === "location") {
      setPhase("contact");
    } else if (phase === "contact") {
      setPhase("review");
    } else if (phase === "review") {
      handleSubmit();
    }
  }, [phase, tree, handleSubmit]);

  const goBack = useCallback(() => {
    if (phase === "questions") {
      if (treeState.history.length > 0) {
        setTreeState(goBackTree(treeState));
      } else {
        setPhase("welcome");
      }
    } else if (phase === "outcome") {
      // Go back to questions, undo the last answer
      const prevState = goBackTree(treeState);
      setTreeState(prevState);
      setPhase("questions");
    } else if (phase === "location") {
      // Back to outcome
      setPhase("outcome");
    } else if (phase === "contact") {
      setPhase("location");
    } else if (phase === "review") {
      setPhase("contact");
    }
  }, [phase, treeState]);

  // ── Success screen ──────────────────────────────────────────────────────────

  if (phase === "success") {
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
          Someone from our team will reach out to you about your cat situation.
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

  // ── Welcome screen ──────────────────────────────────────────────────────────

  if (phase === "welcome") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={() => router.push("/kiosk")}
        onNext={goNext}
        canGoNext
        nextLabel="Get Started"
        showBack
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "1.5rem",
            paddingTop: "2rem",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "var(--primary-bg, rgba(59,130,246,0.08))",
              border: "2px solid var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="cat" size={36} color="var(--primary)" />
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 800,
              color: "var(--text-primary)",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Hi! I&apos;m Tippy!
          </h1>
          <p
            style={{
              fontSize: "1rem",
              color: "var(--text-secondary)",
              margin: 0,
              maxWidth: 360,
              lineHeight: 1.5,
            }}
          >
            I&apos;ll ask a few quick questions to figure out the best way to help.
          </p>
          <p
            style={{
              fontSize: "0.85rem",
              color: "var(--muted)",
              margin: 0,
            }}
          >
            Takes about 1 minute
          </p>
        </div>
      </KioskWizardShell>
    );
  }

  // ── Outcome screen ──────────────────────────────────────────────────────────

  if (phase === "outcome" && treeState.outcome) {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={() => {}}
        canGoNext={false}
      >
        <TippyOutcomeScreen
          outcome={treeState.outcome}
          onContinueToIntake={() => setPhase("location")}
          onDone={() => router.push("/kiosk")}
        />
      </KioskWizardShell>
    );
  }

  // ── Question step ─────────────────────────────────────────────────────────

  if (phase === "questions" && currentNode) {
    // Find the currently selected value (last history entry for this node, if any)
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

  // ── Location step ─────────────────────────────────────────────────────────

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

  // ── Contact step ──────────────────────────────────────────────────────────

  if (phase === "contact") {
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={goNext}
        canGoNext={canGoNext}
      >
        <KioskContactStep data={contact} onChange={setContact} />
      </KioskWizardShell>
    );
  }

  // ── Review step (inline — simpler than old KioskReviewStep) ───────────────

  const locationDisplay = place?.display_name || place?.formatted_address || freeformAddress || "Not provided";
  const outcomeLabel = treeState.outcome?.headline || "Unknown";

  return (
    <KioskWizardShell
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={goBack}
      onNext={goNext}
      canGoNext
      nextLabel="Submit Request"
    >
      <>
        {submitError && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: 10,
              color: "var(--danger-text)",
              fontSize: "0.9rem",
              fontWeight: 500,
              marginBottom: "1rem",
            }}
          >
            {submitError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h2
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Review your request
          </h2>

          {/* Outcome summary */}
          <div
            style={{
              background: "var(--primary-bg, rgba(59,130,246,0.08))",
              border: "2px solid var(--primary)",
              borderRadius: 16,
              padding: "1rem 1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name={treeState.outcome?.icon || "check"} size={20} color="#fff" />
            </div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--primary)" }}>
              {outcomeLabel}
            </div>
          </div>

          {/* Contact & location summary */}
          <div
            style={{
              background: "var(--card-bg, #fff)",
              border: "1px solid var(--card-border, #e5e7eb)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <SummaryRow label="Name" value={contact.firstName} />
            <SummaryRow label="Phone" value={contact.phone} />
            {contact.email && <SummaryRow label="Email" value={contact.email} />}
            <SummaryRow label="Location" value={locationDisplay} />
          </div>
        </div>
      </>
    </KioskWizardShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--card-border, #e5e7eb)",
        gap: "1rem",
      }}
    >
      <span
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          flexShrink: 0,
          maxWidth: "40%",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.9rem",
          color: "var(--text-primary)",
          textAlign: "right",
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}
