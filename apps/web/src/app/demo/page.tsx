"use client";

/**
 * /demo — Guided gala presentation deck.
 *
 * Narrative arc (research-driven):
 *   Problem → Impact → Growth → Map → Strategic Insight → Ask → Vision
 *
 * Follows the charity:water / Best Friends storytelling pattern:
 *   - Lead with ONE powerful stat, not a data dump
 *   - Show geographic reach via map
 *   - Prove the model works with zone-level analysis
 *   - Close with unit economics (what a donation buys)
 *
 * Controls:
 *   - Arrow keys (←/→) or click prev/next
 *   - Progress dots at bottom
 *   - ESC exits back to dashboard
 *
 * Data sources:
 *   /api/story-config, /api/dashboard/stats,
 *   /api/beacon/zones, /api/beacon/county-rollup
 *
 * All slide text is admin-configurable via ops.app_config (demo.* keys).
 * Edit at /admin/demo. MIG_3078 seeds defaults.
 *
 * Auth required (presenter is logged in).
 * Epic: FFS-1193 (Beacon Polish)
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useOrgConfig } from "@/hooks/useOrgConfig";
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
  cats_last_month: number;
}

interface ZoneRollup {
  zone_code: string;
  zone_name: string;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  alteration_rate_pct: number | null;
  zone_status: string;
  active_requests: number;
  alterations_last_90d: number;
}

interface ZonesResponse {
  zones: ZoneRollup[];
  summary: {
    total_zones: number;
    total_places: number;
    total_cats: number;
    total_altered: number;
    alteration_rate_pct: number | null;
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

function formatDollar(n: number): string {
  return `$${n.toLocaleString()}`;
}

const TOTAL_SLIDES = 8;

export default function DemoPage() {
  const router = useRouter();
  const [story, setStory] = useState<StoryData | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [current, setCurrent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Config values
  const orgConfig = useOrgConfig();
  const { value: demoEnabled } = useAppConfig<boolean>("demo.enabled");
  const { value: tagline } = useAppConfig<string>("demo.tagline");
  const { value: clinicDistinction } = useAppConfig<string>("demo.clinic_distinction");
  const { value: impactFootnote } = useAppConfig<string>("demo.impact_footnote");
  const { value: zonesTitle } = useAppConfig<string>("demo.zones_title");
  const { value: zonesFootnote } = useAppConfig<string>("demo.zones_footnote");
  const { value: askEyebrow } = useAppConfig<string>("demo.ask_eyebrow");
  const { value: askTitle } = useAppConfig<string>("demo.ask_title");
  const { value: tier1Amount } = useAppConfig<number>("demo.unit_tier1_amount");
  const { value: tier1Outcome } = useAppConfig<string>("demo.unit_tier1_outcome");
  const { value: tier2Amount } = useAppConfig<number>("demo.unit_tier2_amount");
  const { value: tier2Outcome } = useAppConfig<string>("demo.unit_tier2_outcome");
  const { value: tier3Amount } = useAppConfig<number>("demo.unit_tier3_amount");
  const { value: tier3Outcome } = useAppConfig<string>("demo.unit_tier3_outcome");
  const { value: askBody } = useAppConfig<string>("demo.ask_body");
  const { value: visionBody1 } = useAppConfig<string>("demo.vision_body1");
  const { value: visionBody2 } = useAppConfig<string>("demo.vision_body2");
  const { value: cta1Label } = useAppConfig<string>("demo.cta1_label");
  const { value: cta1Href } = useAppConfig<string>("demo.cta1_href");
  const { value: cta2Label } = useAppConfig<string>("demo.cta2_label");
  const { value: cta2Href } = useAppConfig<string>("demo.cta2_href");

  // Kill switch — redirect if demo is disabled
  useEffect(() => {
    if (demoEnabled === false) {
      router.replace("/");
    }
  }, [demoEnabled, router]);

  // Fetch all data in parallel
  useEffect(() => {
    Promise.all([
      fetchApi<StoryData>("/api/story-config").catch(() => null),
      fetchApi<DashboardStats>("/api/dashboard/stats").catch(() => null),
      fetchApi<ZonesResponse>("/api/beacon/zones").catch(() => null),
    ]).then(([storyData, statsData, zonesData]) => {
      if (storyData && "slides" in storyData) setStory(storyData as StoryData);
      if (statsData) setStats(statsData);
      if (zonesData && "zones" in zonesData) setZones(zonesData as ZonesResponse);
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

  if (demoEnabled === false) return null;

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

  // Compute zone-level insights
  const managedZones = zones?.zones?.filter(z => z.zone_status === "managed") || [];
  const topActiveZones = [...(zones?.zones || [])]
    .sort((a, b) => b.active_requests - a.active_requests)
    .slice(0, 5);
  const overallRate = zones?.summary?.alteration_rate_pct;

  return (
    <div className="demo-page">
      {/* Slides container */}
      <div className="demo-slides" ref={containerRef}>

        {/* -- Slide 1: Title -- */}
        <section className="demo-slide demo-slide-title">
          <div className="demo-slide-inner">
            <img src="/beacon-logo.jpeg" alt="Beacon" className="demo-logo" />
            <h1 className="demo-headline">Beacon</h1>
            <p className="demo-tagline">{tagline}</p>
            <p className="demo-tagline" style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.5 }}>
              {orgConfig.nameFull}
            </p>
            <div className="demo-hint">
              Press <kbd>→</kbd> to begin
            </div>
          </div>
        </section>

        {/* -- Slide 2: The Problem -- */}
        <section className="demo-slide demo-slide-problem">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">The challenge</div>
            <h2 className="demo-slide-title-text">
              {story?.slides[0]?.title || "Sonoma County has thousands of community cats"}
            </h2>
            <p className="demo-slide-body">
              {story?.slides[0]?.body || "Community cats live outdoors without an owner — in neighborhoods, farms, parks, and industrial areas. Without intervention, a single pair can produce 100+ descendants in just 7 years."}
            </p>
            <div className="demo-callout">
              <span className="demo-callout-label">The only sustainable, humane solution</span>
              <span className="demo-callout-value">Trap-Neuter-Return (TNR)</span>
            </div>
            <p className="demo-slide-body" style={{ marginTop: "1.5rem", fontSize: "0.85rem" }}>
              {clinicDistinction}
            </p>
          </div>
        </section>

        {/* -- Slide 3: Impact Numbers -- */}
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
              {impactFootnote}
            </p>
          </div>
        </section>

        {/* -- Slide 4: Year-by-Year Growth -- */}
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

        {/* -- Slide 5: Live Map -- */}
        <section className="demo-slide demo-slide-map">
          <div className="demo-slide-inner demo-slide-inner-full">
            <div className="demo-eyebrow">Where we work</div>
            <h2 className="demo-slide-title-text">
              Every pin is a real community member asking for help
            </h2>
            {stats && (
              <div className="demo-map-stats">
                <span><strong>{stats.active_requests}</strong> active requests</span>
                <span className="demo-map-stats-sep">·</span>
                <span><strong>{stats.cats_this_month}</strong> cats this month</span>
                {stats.pending_intake > 0 && (
                  <>
                    <span className="demo-map-stats-sep">·</span>
                    <span><strong>{stats.pending_intake}</strong> waiting for help</span>
                  </>
                )}
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

        {/* -- Slide 6: Strategic Insight (Beacon's core promise) -- */}
        <section className="demo-slide demo-slide-zones">
          <div className="demo-slide-inner demo-slide-inner-wide">
            <div className="demo-eyebrow">Strategic insight</div>
            <h2 className="demo-slide-title-text">
              {zonesTitle}
            </h2>

            {zones?.summary && (
              <div className="demo-zone-overview">
                <div className="demo-zone-stat">
                  <div className="demo-zone-number">{zones.summary.total_zones}</div>
                  <div className="demo-zone-label">service zones tracked</div>
                </div>
                <div className="demo-zone-stat">
                  <div className="demo-zone-number">{zones.summary.total_places?.toLocaleString()}</div>
                  <div className="demo-zone-label">locations monitored</div>
                </div>
                <div className="demo-zone-stat">
                  <div className="demo-zone-number" style={{ color: "#22c55e" }}>
                    {overallRate ? `${overallRate}%` : "—"}
                  </div>
                  <div className="demo-zone-label">county alteration rate</div>
                </div>
                <div className="demo-zone-stat">
                  <div className="demo-zone-number" style={{ color: "#60a5fa" }}>
                    {managedZones.length}
                  </div>
                  <div className="demo-zone-label">zones at managed status</div>
                </div>
              </div>
            )}

            {topActiveZones.length > 0 && (
              <div className="demo-zone-table">
                <div className="demo-zone-table-title">Highest-need zones right now</div>
                {topActiveZones.map((z) => (
                  <div key={z.zone_code} className="demo-zone-row">
                    <span className="demo-zone-row-name">{z.zone_name}</span>
                    <span className="demo-zone-row-requests">
                      {z.active_requests} request{z.active_requests !== 1 ? "s" : ""}
                    </span>
                    <span className="demo-zone-row-rate">
                      {z.alteration_rate_pct != null ? `${z.alteration_rate_pct}%` : "—"} altered
                    </span>
                    <span className={`demo-zone-row-status demo-zone-status-${z.zone_status}`}>
                      {z.zone_status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="demo-slide-body" style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.85rem" }}>
              {zonesFootnote}
            </p>
          </div>
        </section>

        {/* -- Slide 7: Unit Economics / The Ask -- */}
        <section className="demo-slide demo-slide-ask">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">{askEyebrow}</div>
            <h2 className="demo-slide-title-text">
              {askTitle}
            </h2>

            <div className="demo-unit-grid">
              <div className="demo-unit-card">
                <div className="demo-unit-amount">{formatDollar(tier1Amount)}</div>
                <div className="demo-unit-equals">=</div>
                <div className="demo-unit-outcome">{tier1Outcome}</div>
              </div>
              <div className="demo-unit-card">
                <div className="demo-unit-amount">{formatDollar(tier2Amount)}</div>
                <div className="demo-unit-equals">=</div>
                <div className="demo-unit-outcome">{tier2Outcome}</div>
              </div>
              <div className="demo-unit-card">
                <div className="demo-unit-amount">{formatDollar(tier3Amount)}</div>
                <div className="demo-unit-equals">=</div>
                <div className="demo-unit-outcome">{tier3Outcome}</div>
              </div>
            </div>

            <p className="demo-slide-body" style={{ marginTop: "1.5rem" }}>
              {askBody}
            </p>
          </div>
        </section>

        {/* -- Slide 8: The Vision -- */}
        <section className="demo-slide demo-slide-vision">
          <div className="demo-slide-inner">
            <div className="demo-eyebrow">The vision</div>
            <h2 className="demo-slide-title-text">
              {story?.slides[1]?.title || "Beacon illuminates where help is needed most"}
            </h2>
            <p className="demo-slide-body">
              {visionBody1}
            </p>
            <p className="demo-slide-body">
              {visionBody2}
            </p>
            <div className="demo-cta-group">
              <a href={cta1Href} className="demo-cta">{cta1Label}</a>
              <a href={cta2Href} className="demo-cta demo-cta-secondary">{cta2Label}</a>
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
