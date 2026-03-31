"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { KioskWizardShell } from "@/components/kiosk/KioskWizardShell";
import { KioskQuestionCard } from "@/components/kiosk/KioskQuestionCard";
import { KioskLocationStep } from "@/components/kiosk/KioskLocationStep";
import { KioskContactStep, type KioskContactData } from "@/components/kiosk/KioskContactStep";
import { KioskReviewStep } from "@/components/kiosk/KioskReviewStep";
import {
  DEFAULT_QUESTIONS,
  scoreAnswers,
  SITUATION_TO_CALL_TYPE,
  type IndirectQuestion,
} from "@/lib/kiosk-questions";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { isValidPhone } from "@/lib/formatters";

type WizardPhase = "welcome" | "questions" | "location" | "contact" | "review" | "submitting" | "success";

/**
 * Kiosk Help Request — public wizard flow.
 *
 * Welcome → Questions (1 per screen) → Location → Contact → Review → Submit → Success
 *
 * Submits to POST /api/intake with source_system: 'kiosk_help'.
 * Classification + scores stored in custom_fields for staff review.
 */
export default function KioskHelpPage() {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();

  // Load custom questions from admin config (null = use defaults)
  const { value: customQuestions } = useAppConfig<IndirectQuestion[] | null>("kiosk.help_questions");
  const { value: successMessage } = useAppConfig<string>("kiosk.success_message");
  const questions = useMemo(
    () => (Array.isArray(customQuestions) && customQuestions.length > 0 ? customQuestions : DEFAULT_QUESTIONS),
    [customQuestions],
  );

  // Wizard state
  const [phase, setPhase] = useState<WizardPhase>("welcome");
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  const [freeformAddress, setFreeformAddress] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contact, setContact] = useState<KioskContactData>({
    firstName: "",
    phone: "",
    email: "",
  });

  // Total wizard steps for progress dots
  // welcome(1) + questions(N) + location(1) + contact(1) + review(1)
  const totalSteps = 1 + questions.length + 3;
  const currentStep =
    phase === "welcome"
      ? 0
      : phase === "questions"
        ? 1 + currentQuestionIdx
        : phase === "location"
          ? 1 + questions.length
          : phase === "contact"
            ? 2 + questions.length
            : phase === "review"
              ? 3 + questions.length
              : 0;

  // Scoring
  const scoring = useMemo(() => scoreAnswers(answers, questions), [answers, questions]);

  // Can proceed?
  const canGoNext = useMemo(() => {
    if (phase === "welcome") return true;
    if (phase === "questions") {
      const q = questions[currentQuestionIdx];
      return !q?.is_required || !!answers[q.id];
    }
    if (phase === "location") return !!(place || freeformAddress.trim());
    if (phase === "contact") return !!(contact.firstName.trim() && contact.phone && isValidPhone(contact.phone));
    if (phase === "review") return true;
    return false;
  }, [phase, questions, currentQuestionIdx, answers, place, freeformAddress, contact]);

  // Submit to intake API (defined before goNext to avoid TDZ)
  const handleSubmit = useCallback(async () => {
    setPhase("submitting");

    const catsAddress =
      place?.formatted_address || place?.display_name || freeformAddress.trim() || "Unknown";

    // Extract phone digits for the API
    const phoneDigits = contact.phone.replace(/\D/g, "");

    try {
      await postApi("/api/intake", {
        source: "in_person" as const,
        source_system: "kiosk_help",
        first_name: contact.firstName.trim(),
        last_name: "(Walk-in)",
        phone: phoneDigits,
        email: contact.email.trim() || undefined,
        cats_address: catsAddress,
        selected_address_place_id: place?.place_id || undefined,
        call_type: SITUATION_TO_CALL_TYPE[scoring.classification],
        handleability: scoring.handleability,
        cat_count_estimate:
          answers["q_count"] === "one" ? 1 : answers["q_count"] === "few" ? 3 : answers["q_count"] === "many" ? 8 : undefined,
        has_kittens: (answers["q_kittens"] === "yes" || answers["q_kittens"] === "maybe") ? true : undefined,
        has_medical_concerns: (answers["q_medical"] === "yes" || answers["q_medical"] === "maybe") ? true : undefined,
        custom_fields: {
          kiosk_answers: JSON.stringify(answers),
          kiosk_scores: JSON.stringify(scoring.scores),
          kiosk_classification: scoring.classification,
          kiosk_confidence: String(scoring.confidence),
          kiosk_needs_review: scoring.confidence < 0.3 ? "true" : "false",
        },
      });

      setSubmitError(null);
      setPhase("success");
      toastSuccess("Request submitted!");
    } catch (err) {
      console.error("[KIOSK] Submit error:", err);
      setSubmitError("Something went wrong. Please try again or ask staff for help.");
      setPhase("review");
    }
  }, [contact, place, freeformAddress, answers, scoring, toastSuccess, toastError]);

  // Navigation
  const goNext = useCallback(() => {
    if (phase === "welcome") {
      setPhase("questions");
      setCurrentQuestionIdx(0);
    } else if (phase === "questions") {
      if (currentQuestionIdx < questions.length - 1) {
        setCurrentQuestionIdx((i) => i + 1);
      } else {
        setPhase("location");
      }
    } else if (phase === "location") {
      setPhase("contact");
    } else if (phase === "contact") {
      setPhase("review");
    } else if (phase === "review") {
      handleSubmit();
    }
  }, [phase, currentQuestionIdx, questions.length, handleSubmit]);

  const goBack = useCallback(() => {
    if (phase === "questions") {
      if (currentQuestionIdx > 0) {
        setCurrentQuestionIdx((i) => i - 1);
      } else {
        setPhase("welcome");
      }
    } else if (phase === "location") {
      setPhase("questions");
      setCurrentQuestionIdx(questions.length - 1);
    } else if (phase === "contact") {
      setPhase("location");
    } else if (phase === "review") {
      setPhase("contact");
    }
  }, [phase, currentQuestionIdx, questions.length]);

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
            <Icon name="heart-handshake" size={36} color="var(--primary)" />
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
            Let&apos;s figure out how we can help
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
            We&apos;ll ask a few quick questions about your situation, then get your
            contact info so we can follow up.
          </p>
          <p
            style={{
              fontSize: "0.85rem",
              color: "var(--muted)",
              margin: 0,
            }}
          >
            Takes about 2 minutes
          </p>
        </div>
      </KioskWizardShell>
    );
  }

  // ── Question step ───────────────────────────────────────────────────────────

  if (phase === "questions") {
    const question = questions[currentQuestionIdx];
    return (
      <KioskWizardShell
        currentStep={currentStep}
        totalSteps={totalSteps}
        onBack={goBack}
        onNext={goNext}
        canGoNext={canGoNext}
        nextLabel={currentQuestionIdx === questions.length - 1 ? "Continue" : "Next"}
      >
        <KioskQuestionCard
          question={question}
          selectedValue={answers[question.id]}
          onSelect={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
          onAutoAdvance={canGoNext ? goNext : undefined}
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

  // ── Contact step ────────────────────────────────────────────────────────────

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

  // ── Review step ─────────────────────────────────────────────────────────────

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
        <KioskReviewStep
          answers={answers}
          questions={questions}
          scoring={scoring}
          contact={contact}
          place={place}
          freeformAddress={freeformAddress}
        />
      </>
    </KioskWizardShell>
  );
}
