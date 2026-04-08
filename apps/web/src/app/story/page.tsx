"use client";

/**
 * /story — Scrollytelling intro to Beacon.
 *
 * Three full-height slides that reveal on scroll:
 *   1. WHO — the scale of the community cat problem
 *   2. HOW — Beacon as the solution
 *   3. WHAT — impact numbers since inception
 *
 * Ends with a CTA button (default "Explore the map").
 *
 * All text is admin-configurable via ops.app_config (story.*).
 * Impact numbers come from live data.
 *
 * Uses IntersectionObserver for reveal animations + CSS scroll-snap
 * for the slide progression.
 *
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api-client";

interface StoryData {
  enabled: boolean;
  slides: Array<{ title: string; body: string }>;
  cta: { label: string; href: string };
  impact: {
    cats_altered: number;
    kittens_prevented: number;
    shelter_cost_avoided: number;
    start_year: number;
  };
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

export default function StoryPage() {
  const [data, setData] = useState<StoryData | null>(null);
  const [error, setError] = useState(false);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    fetchApi<StoryData>("/api/story-config")
      .then((result) => {
        if (result && typeof result === "object" && "slides" in result) {
          setData(result as StoryData);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, []);

  // Reveal slides with IntersectionObserver
  useEffect(() => {
    if (!data) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("story-slide-visible");
          }
        });
      },
      { threshold: 0.4 }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [data]);

  if (error) {
    return (
      <div className="story-error">
        <p>Unable to load the story. Try refreshing.</p>
        <a href="/" className="story-cta">Go home</a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="story-loading">
        <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, opacity: 0.7 }} />
        <div className="story-loading-text">Loading the story&hellip;</div>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="story-error">
        <p>This page is disabled.</p>
        <a href="/" className="story-cta">Go home</a>
      </div>
    );
  }

  return (
    <div className="story-container">
      {/* Slide 1 — WHO */}
      <section
        ref={(el) => { slideRefs.current[0] = el; }}
        className="story-slide story-slide-1"
        aria-label="The problem"
      >
        <div className="story-slide-content">
          <div className="story-eyebrow">The problem</div>
          <h1 className="story-title">{data.slides[0]?.title}</h1>
          <p className="story-body">{data.slides[0]?.body}</p>
        </div>
        <div className="story-scroll-hint" aria-hidden="true">
          <span>Scroll</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </div>
      </section>

      {/* Slide 2 — HOW */}
      <section
        ref={(el) => { slideRefs.current[1] = el; }}
        className="story-slide story-slide-2"
        aria-label="The solution"
      >
        <div className="story-slide-content">
          <div className="story-eyebrow">The solution</div>
          <h1 className="story-title">{data.slides[1]?.title}</h1>
          <p className="story-body">{data.slides[1]?.body}</p>
          <img
            src="/beacon-logo.jpeg"
            alt="Beacon"
            className="story-logo-mark"
          />
        </div>
      </section>

      {/* Slide 3 — WHAT */}
      <section
        ref={(el) => { slideRefs.current[2] = el; }}
        className="story-slide story-slide-3"
        aria-label="The impact"
      >
        <div className="story-slide-content">
          <div className="story-eyebrow">The impact</div>
          <h1 className="story-title">{data.slides[2]?.title}</h1>

          <div className="story-impact-grid">
            <div className="story-impact-stat">
              <div className="story-impact-number">{formatBigNumber(data.impact.cats_altered)}</div>
              <div className="story-impact-label">cats altered</div>
            </div>
            <div className="story-impact-stat story-impact-stat-highlight">
              <div className="story-impact-number">~{formatBigNumber(data.impact.kittens_prevented)}</div>
              <div className="story-impact-label">kittens prevented</div>
            </div>
            <div className="story-impact-stat">
              <div className="story-impact-number">{formatCurrency(data.impact.shelter_cost_avoided)}</div>
              <div className="story-impact-label">shelter costs avoided</div>
            </div>
          </div>

          <p className="story-body">{data.slides[2]?.body}</p>

          <a href={data.cta.href} className="story-cta">
            {data.cta.label}
            <span aria-hidden="true" style={{ marginLeft: "0.5rem" }}>→</span>
          </a>
        </div>
      </section>
    </div>
  );
}
