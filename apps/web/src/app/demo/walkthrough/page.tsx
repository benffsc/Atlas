"use client";

/**
 * /demo/walkthrough — 5-step product walkthrough for the gala.
 *
 * Shows how Beacon works through the TNR lifecycle:
 *   1. FIND  — Intake form + map pin (someone reports cats)
 *   2. FIX   — Clinic day + cat medical data (we alter the cat)
 *   3. RETURN — Map zoomed out to show regional context (cat goes home)
 *   4. ANALYZE — Beacon analytics dashboard (we track the impact)
 *   5. THANK YOU — CTA + vision
 *
 * Each step embeds a live iframe of the actual app page, framed
 * with a step label and narrative text. Dark slide deck aesthetic
 * reuses the existing demo-* CSS classes.
 *
 * Controls: Arrow keys, spacebar, click prev/next, ESC to exit.
 *
 * Epic: FFS-1415 (Dashboard Impact Chart Redesign / Gala Prep)
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { useAppConfig } from "@/hooks/useAppConfig";

interface WalkthroughStep {
  step: number;
  label: string;
  title: string;
  subtitle: string;
  iframe?: string;
  /** Extra CSS class for slide background */
  bgClass?: string;
}

const STEPS: WalkthroughStep[] = [
  {
    step: 0,
    label: "",
    title: "Beacon",
    subtitle: "See how we find, fix, and return community cats — and track every one.",
    bgClass: "demo-slide-title",
  },
  {
    step: 1,
    label: "Find",
    title: "A community member reports cats on their street",
    subtitle: "Every request starts with a person reaching out. We capture the location, the situation, and how to help — then find it on the map.",
    iframe: "/intake/queue/new",
    bgClass: "wt-slide-find",
  },
  {
    step: 2,
    label: "Fix",
    title: "We bring them to our clinic",
    subtitle: "FFSC is the only dedicated spay/neuter clinic for community cats in Sonoma County. Every cat gets a medical record, microchip, and ear tip.",
    iframe: "/admin/clinic-days",
    bgClass: "wt-slide-fix",
  },
  {
    step: 3,
    label: "Return",
    title: "They go home — and we track the whole neighborhood",
    subtitle: "Each site isn't isolated. Beacon connects every colony to the places around it, building a regional picture of progress.",
    iframe: "/map?center=38.44,-122.72&zoom=12",
    bgClass: "wt-slide-return",
  },
  {
    step: 4,
    label: "Analyze",
    title: "Beacon shows us where to focus next",
    subtitle: "Population estimates, alteration rates, seasonal trends — data-driven decisions for every zone in the county.",
    iframe: "/beacon",
    bgClass: "wt-slide-analyze",
  },
  {
    step: 5,
    label: "Thank You",
    title: "With your support, we can reach every colony",
    subtitle: "",
    bgClass: "demo-slide-ask",
  },
];

const TOTAL = STEPS.length;

const STEP_COLORS: Record<string, string> = {
  Find: "#f59e0b",
  Fix: "#22c55e",
  Return: "#3b82f6",
  Analyze: "#8b5cf6",
};

export default function WalkthroughPage() {
  const router = useRouter();
  const orgConfig = useOrgConfig();
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Config for thank-you slide
  const { value: askTitle } = useAppConfig<string>("demo.ask_title");
  const { value: askBody } = useAppConfig<string>("demo.ask_body");
  const { value: tier1Amount } = useAppConfig<number>("demo.unit_tier1_amount");
  const { value: tier1Outcome } = useAppConfig<string>("demo.unit_tier1_outcome");
  const { value: tier2Amount } = useAppConfig<number>("demo.unit_tier2_amount");
  const { value: tier2Outcome } = useAppConfig<string>("demo.unit_tier2_outcome");
  const { value: tier3Amount } = useAppConfig<number>("demo.unit_tier3_amount");
  const { value: tier3Outcome } = useAppConfig<string>("demo.unit_tier3_outcome");

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(TOTAL - 1, idx));
    setCurrent(clamped);
    containerRef.current?.children[clamped]?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        router.push("/");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [next, prev, router]);

  // Scroll sync
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Array.from(container.children).indexOf(entry.target as HTMLElement);
            if (idx >= 0) setCurrent(idx);
          }
        }
      },
      { root: container, threshold: 0.6 }
    );
    Array.from(container.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);

  function formatDollar(n: number): string {
    return `$${n.toLocaleString()}`;
  }

  return (
    <div className="demo-page">
      <div className="demo-slides" ref={containerRef}>
        {STEPS.map((step, i) => (
          <section key={i} className={`demo-slide ${step.bgClass || ""}`}>
            <div className="demo-slide-inner demo-slide-inner-full">

              {/* Step badge */}
              {step.label && (
                <div
                  className="demo-eyebrow"
                  style={{
                    background: STEP_COLORS[step.label] || "rgba(255,255,255,0.1)",
                    color: "#fff",
                    padding: "0.3rem 1rem",
                    borderRadius: "999px",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: "1rem",
                  }}
                >
                  Step {step.step}: {step.label}
                </div>
              )}

              {/* Title slide — special layout */}
              {i === 0 && (
                <>
                  <img src="/beacon-logo.jpeg" alt="Beacon" className="demo-logo" />
                  <h1 className="demo-headline">{step.title}</h1>
                  <p className="demo-tagline">{step.subtitle}</p>
                  <p className="demo-tagline" style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.5 }}>
                    {orgConfig.nameFull}
                  </p>
                  <div className="demo-hint">
                    Press <kbd>&rarr;</kbd> to begin
                  </div>
                </>
              )}

              {/* Thank you slide — special layout */}
              {i === TOTAL - 1 && (
                <>
                  <h2 className="demo-slide-title-text">{askTitle || step.title}</h2>
                  <p className="demo-slide-body" style={{ marginBottom: "2rem" }}>
                    {askBody || "Every dollar goes directly to helping community cats."}
                  </p>

                  <div className="demo-unit-grid">
                    {tier1Amount && (
                      <div className="demo-unit-card">
                        <div className="demo-unit-amount">{formatDollar(tier1Amount)}</div>
                        <div className="demo-unit-equals">=</div>
                        <div className="demo-unit-outcome">{tier1Outcome}</div>
                      </div>
                    )}
                    {tier2Amount && (
                      <div className="demo-unit-card">
                        <div className="demo-unit-amount">{formatDollar(tier2Amount)}</div>
                        <div className="demo-unit-equals">=</div>
                        <div className="demo-unit-outcome">{tier2Outcome}</div>
                      </div>
                    )}
                    {tier3Amount && (
                      <div className="demo-unit-card">
                        <div className="demo-unit-amount">{formatDollar(tier3Amount)}</div>
                        <div className="demo-unit-equals">=</div>
                        <div className="demo-unit-outcome">{tier3Outcome}</div>
                      </div>
                    )}
                  </div>

                  <p className="demo-tagline" style={{ marginTop: "2rem", fontSize: "1.25rem" }}>
                    Thank you
                  </p>
                </>
              )}

              {/* Content slides (1-4) — narrative + live iframe */}
              {i > 0 && i < TOTAL - 1 && (
                <>
                  <h2 className="demo-slide-title-text" style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
                    {step.title}
                  </h2>
                  <p className="demo-slide-body" style={{ marginBottom: "1.25rem", maxWidth: "600px", margin: "0 auto 1.25rem" }}>
                    {step.subtitle}
                  </p>

                  {/* Live app embed */}
                  {step.iframe && (
                    <div style={{
                      width: "100%",
                      maxWidth: "1000px",
                      margin: "0 auto",
                      borderRadius: "12px",
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      aspectRatio: "16 / 9",
                      background: "#111",
                    }}>
                      <iframe
                        src={step.iframe}
                        title={step.label}
                        style={{
                          width: "100%",
                          height: "100%",
                          border: "none",
                          display: "block",
                        }}
                        loading={i <= 2 ? "eager" : "lazy"}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        ))}
      </div>

      {/* Step indicator bar */}
      <div className="demo-nav">
        <button className="demo-nav-btn" onClick={prev} disabled={current === 0} aria-label="Previous">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="demo-dots">
          {STEPS.map((step, i) => (
            <button
              key={i}
              className={`demo-dot${i === current ? " demo-dot-active" : ""}`}
              onClick={() => goTo(i)}
              aria-label={step.label ? `Step ${step.step}: ${step.label}` : `Slide ${i + 1}`}
              style={i === current && step.label ? { background: STEP_COLORS[step.label] } : undefined}
            />
          ))}
        </div>

        <button className="demo-nav-btn" onClick={next} disabled={current === TOTAL - 1} aria-label="Next">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Step label overlay — shows current step name */}
      {STEPS[current]?.label && (
        <div style={{
          position: "fixed",
          top: "1.25rem",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: "0.5rem",
          zIndex: 9992,
        }}>
          {["Find", "Fix", "Return", "Analyze"].map((label) => (
            <span
              key={label}
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "0.25rem 0.75rem",
                borderRadius: "999px",
                background: STEPS[current]?.label === label ? STEP_COLORS[label] : "rgba(255,255,255,0.08)",
                color: STEPS[current]?.label === label ? "#fff" : "rgba(255,255,255,0.3)",
                transition: "all 300ms ease",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <button className="demo-exit" onClick={() => router.push("/")} aria-label="Exit">
        ESC to exit
      </button>
    </div>
  );
}
