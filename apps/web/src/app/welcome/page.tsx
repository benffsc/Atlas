"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api-client";

interface ImpactData {
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
}

interface StoryConfigResponse {
  impact: ImpactData;
}

function formatBigNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

const SLIDES = [
  {
    eyebrow: "The Problem",
    title: "The life of a stray cat",
    body: "Thousands of community cats live across Sonoma County — unfixed, untracked, and often invisible. Without coordinated intervention, a single pair can produce hundreds of descendants in just a few years. The current approach is reactive, fragmented, and data-blind.",
    theme: "intro",
  },
  {
    eyebrow: "Step 1: Find",
    title: "A community member spots a cat",
    body: "It starts with a sighting. A resident submits an intake form reporting stray cats in their neighborhood. That report becomes a trapping request — pinned on a map, triaged by urgency, and assigned to a volunteer trapper.",
    theme: "find",
  },
  {
    eyebrow: "Step 2: Fix",
    title: "The cat comes into the clinic",
    body: "A trapper is dispatched to the site. The cat is captured and brought to the FFSC clinic — the only dedicated spay/neuter clinic for community cats in Sonoma County. Procedures, wellness checks, FIV screening, and microchipping are all recorded in a single visit.",
    theme: "fix",
  },
  {
    eyebrow: "Step 3: Return",
    title: "Returned and tracked",
    body: "The cat is returned to its location, now altered and microchipped. But the work doesn't stop there — population forecasts estimate how many cats remain unfixed in the area, guiding where to focus next.",
    theme: "return",
  },
  {
    eyebrow: "The Future",
    title: "Beacon: a platform for the bigger picture",
    body: "Beacon unifies scattered records, maps every colony, and uses predictive analytics to move from reactive to proactive management. Heatmaps reveal where help is needed most. Population models forecast outcomes. Every cat, every place, every volunteer — connected in one system.",
    theme: "beacon",
  },
  {
    eyebrow: "Get Involved",
    title: "Help us find every cat that needs help",
    body: "Community-sourced sightings are the foundation of effective TNR. By reporting stray cats in your area, you help us identify colonies, prioritize resources, and reach cats before populations grow beyond control.",
    theme: "cta",
  },
];

export default function WelcomePage() {
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    fetchApi<StoryConfigResponse>("/api/story-config")
      .then((result) => {
        if (result?.impact) setImpact(result.impact);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("story-slide-visible");
          }
        });
      },
      { threshold: 0.3 }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="welcome-page">
      <nav className="welcome-nav">
        <img src="/beacon-logo.jpeg" alt="Beacon" className="welcome-nav-logo" />
        <a href="/login" className="welcome-nav-signin">Sign In</a>
      </nav>

      <div className="story-container">
        {SLIDES.map((slide, i) => (
          <section
            key={slide.theme}
            ref={(el) => { slideRefs.current[i] = el; }}
            className={`story-slide welcome-slide-${slide.theme}`}
            aria-label={slide.eyebrow}
          >
            <div className="story-slide-content">
              <div className="story-eyebrow">{slide.eyebrow}</div>
              <h1 className="story-title">{slide.title}</h1>
              <p className="story-body">{slide.body}</p>

              {/* Impact stats on the Return slide */}
              {slide.theme === "return" && impact && (
                <div className="story-impact-grid">
                  <div className="story-impact-stat story-impact-stat-highlight">
                    <div className="story-impact-number">{formatBigNumber(impact.cats_altered)}</div>
                    <div className="story-impact-label">cats altered</div>
                  </div>
                  <div className="story-impact-stat">
                    <div className="story-impact-number">~{formatBigNumber(impact.kittens_prevented)}</div>
                    <div className="story-impact-label">kittens prevented</div>
                  </div>
                  <div className="story-impact-stat">
                    <div className="story-impact-number">{formatCurrency(impact.shelter_cost_avoided)}</div>
                    <div className="story-impact-label">shelter costs avoided</div>
                  </div>
                </div>
              )}

              {/* Beacon logo on the Future slide */}
              {slide.theme === "beacon" && (
                <img src="/beacon-logo.jpeg" alt="Beacon" className="story-logo-mark" />
              )}

              {/* CTA button on the final slide */}
              {slide.theme === "cta" && (
                <a href="/login" className="story-cta">
                  Get Started
                  <span aria-hidden="true" style={{ marginLeft: "0.5rem" }}>→</span>
                </a>
              )}
            </div>

            {/* Scroll hint on first slide only */}
            {i === 0 && (
              <div className="story-scroll-hint" aria-hidden="true">
                <span>Scroll</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
