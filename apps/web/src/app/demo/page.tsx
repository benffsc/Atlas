"use client";

/**
 * /demo — Guided gala presentation deck.
 *
 * A single-page keynote-style flow that walks a donor through
 * the Beacon story using live data. Each "slide" fills the viewport.
 *
 * Controls:
 *   - Arrow keys (←/→) or click prev/next
 *   - Progress dots at bottom
 *   - ESC exits back to dashboard
 *   - Swipe on touch devices
 *
 * Slides:
 *   1. Title — Beacon logo + tagline
 *   2. The Problem — community cats in Sonoma County
 *   3. Impact Numbers — hero stats (live)
 *   4. Year-by-Year — alteration chart (live)
 *   5. Live Map — embedded fullscreen map
 *   6. The Vision — what Beacon means
 *
 * Auth required (presenter is logged in).
 * Epic: FFS-1193 (Beacon Polish)
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { YearlyImpactChart } from "@/components/dashboard/YearlyImpactChart";

interface StoryData {
  slides: Array<{ title: string; body: string }>;
  impact: {
    cats_altered: number;
    kittens_prevented: number;
    shelter_cost_avoided: number;
    start_year: number;
  };
}

interface DashboardStats {
  active_requests: number;
  pending_intake: number;
  cats_this_month: number;
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

const TOTAL_SLIDES = 6;

export default function DemoPage() {
  const router = useRouter();
  const [story, setStory] = useState<StoryData | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [current, setCurrent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch data
  useEffect(() => {
    Promise.all([
      fetchApi<StoryData>("/api/story-config").catch(() => null),
      fetchApi<DashboardStats>("/api/dashboard/stats").catch(() => null),
    ]).then(([storyData, statsData]) => {
      if (storyData && "slides" in storyData) setStory(storyData as StoryData);
      if (statsData) setStats(statsData);
      setLoaded(true);
    });
  }, []);

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(TOTAL_SLIDES - 1, idx));
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

  // Track scroll position for dot sync
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
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="demo-page">
        <div className="demo-loading">
          <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 140, opacity: 0.7 }} />
          <div style={{ marginTop: "1rem", color: "var(--text-muted)" }}>Preparing presentation...</div>
        </div>
      </div>
    );
  }

  const impact = story?.impact;

  return (
    <div className="demo-page">
      {/* Slides container */}
      <div className="demo-slides" ref={containerRef}>
        {/* Slide 1: Title */}
        <section className="demo-slide demo-slide-title">
          <div className="demo-slide-inner">
            <img src="/beacon-logo.jpeg" alt="Beacon" className="demo-logo" />
            <h1 className="demo-headline">Beacon</h1>
            <p className="demo-tagline">A guiding light for humane cat population management</p>
            <div className="demo-hint">
              Press <kbd>→</kbd> to begin
            </div>
          </div>
        </section>

        {/* Slide 2: The Problem */}
        <section className="demo-slide demo-slide-problem">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">The challenge</div>
            <h2 className="demo-slide-title-text">
              {story?.slides[0]?.title || "Sonoma County has thousands of community cats"}
            </h2>
            <p className="demo-slide-body">
              {story?.slides[0]?.body || "Community cats live outdoors without an owner — in neighborhoods, farms, parks, and industrial areas. Without intervention, a single pair can lead to hundreds of descendants in just a few years."}
            </p>
            <div className="demo-callout">
              <span className="demo-callout-label">The only sustainable solution</span>
              <span className="demo-callout-value">Trap-Neuter-Return (TNR)</span>
            </div>
          </div>
        </section>

        {/* Slide 3: Impact Numbers */}
        <section className="demo-slide demo-slide-impact">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">Our impact{impact ? ` since ${impact.start_year}` : ""}</div>
            <div className="demo-impact-grid">
              <div className="demo-impact-stat">
                <div className="demo-impact-number">
                  {impact ? formatBigNumber(impact.cats_altered) : "—"}
                </div>
                <div className="demo-impact-label">cats altered</div>
              </div>
              <div className="demo-impact-stat demo-impact-highlight">
                <div className="demo-impact-number">
                  {impact ? `~${formatBigNumber(impact.kittens_prevented)}` : "—"}
                </div>
                <div className="demo-impact-label">kittens prevented</div>
              </div>
              <div className="demo-impact-stat">
                <div className="demo-impact-number">
                  {impact ? formatCurrency(impact.shelter_cost_avoided) : "—"}
                </div>
                <div className="demo-impact-label">shelter costs avoided</div>
              </div>
            </div>
            <p className="demo-impact-note">
              Every number is backed by real records — click any stat on the dashboard to see the data
            </p>
          </div>
        </section>

        {/* Slide 4: Year-by-Year */}
        <section className="demo-slide demo-slide-chart">
          <div className="demo-slide-inner demo-slide-inner-wide">
            <div className="demo-eyebrow">Growth over time</div>
            <h2 className="demo-slide-title-text">
              From 180 cats in 1990 to {impact ? formatBigNumber(impact.cats_altered) : "tens of thousands"} today
            </h2>
            <div className="demo-chart-wrapper">
              <YearlyImpactChart />
            </div>
          </div>
        </section>

        {/* Slide 5: Live Map */}
        <section className="demo-slide demo-slide-map">
          <div className="demo-slide-inner demo-slide-inner-full">
            <div className="demo-eyebrow">Where we work</div>
            <h2 className="demo-slide-title-text">
              Every pin is a real request for help
            </h2>
            {stats && (
              <div className="demo-map-stats">
                <span>{stats.active_requests} active requests</span>
                <span className="demo-map-stats-sep">·</span>
                <span>{stats.cats_this_month} cats this month</span>
                <span className="demo-map-stats-sep">·</span>
                <span>{stats.pending_intake} pending intake</span>
              </div>
            )}
            <div className="demo-map-frame">
              <iframe
                src="/map"
                title="Beacon live map"
                className="demo-map-iframe"
                loading="lazy"
              />
            </div>
          </div>
        </section>

        {/* Slide 6: The Vision */}
        <section className="demo-slide demo-slide-vision">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">The vision</div>
            <h2 className="demo-slide-title-text">
              {story?.slides[1]?.title || "Beacon illuminates where help is needed most"}
            </h2>
            <p className="demo-slide-body">
              Beacon is a data platform built for TNR organizations. It tracks every cat, every request, every volunteer — and turns operational data into measurable community impact.
            </p>
            <p className="demo-slide-body">
              What started as a tool for Forgotten Felines of Sonoma County is being built to serve any TNR organization that wants to prove their impact with data.
            </p>
            <div className="demo-cta-group">
              <a href="/impact" className="demo-cta">See the full data</a>
              <a href="/" className="demo-cta demo-cta-secondary">Explore the dashboard</a>
            </div>
          </div>
        </section>
      </div>

      {/* Navigation controls */}
      <div className="demo-nav">
        <button
          className="demo-nav-btn"
          onClick={prev}
          disabled={current === 0}
          aria-label="Previous slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="demo-dots">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button
              key={i}
              className={`demo-dot${i === current ? " demo-dot-active" : ""}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        <button
          className="demo-nav-btn"
          onClick={next}
          disabled={current === TOTAL_SLIDES - 1}
          aria-label="Next slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Exit hint */}
      <button
        className="demo-exit"
        onClick={() => router.push("/")}
        aria-label="Exit presentation"
      >
        ESC to exit
      </button>
    </div>
  );
}
