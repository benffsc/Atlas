"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api-client";

interface Slide {
  slide_id: string;
  slide_type: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  image_caption: string | null;
  background_style: string;
  custom_data: Record<string, unknown>;
  display_order: number;
}

interface MeetingData {
  meeting: { title: string; meeting_date: string | null };
  slides: Slide[];
}

interface MeetingStats {
  period: { since_last_meeting: string; meeting_date: string };
  since_last_meeting: {
    spays: number; neuters: number; total_fixed: number;
    wellness_only: number; total_appointments: number;
  };
  ytd: { spays: number; neuters: number; total_fixed: number; total_appointments: number };
  requests_resolved: number;
  active_requests: number;
}

/* --- Slide renderers --- */

function VideoEmbed({ slide }: { slide: Slide }) {
  const videoUrl = slide.custom_data?.video_url as string | undefined;
  if (!videoUrl) return null;

  // Google Drive: convert share URL to embed
  const driveMatch = videoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const embedSrc = driveMatch
    ? `https://drive.google.com/file/d/${driveMatch[1]}/preview`
    : videoUrl;

  return (
    <div className="meeting-slide-inner" style={{ maxWidth: "1100px" }}>
      {slide.title && (
        <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", marginBottom: "1.5rem" }}>
          {slide.title}
        </h2>
      )}
      <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", borderRadius: "8px", overflow: "hidden" }}>
        <iframe
          src={embedSrc}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      </div>
      {slide.body && (
        <p className="meeting-slide-subtitle" style={{ marginTop: "1rem" }}>{slide.body}</p>
      )}
    </div>
  );
}

function TitleSlide({ slide, isFirst }: { slide: Slide; isFirst?: boolean }) {
  // If this title slide has a video, render the video embed instead
  if (slide.custom_data?.video_url) return <VideoEmbed slide={slide} />;

  return (
    <div className="meeting-slide-inner">
      {slide.title && (
        <h1 className="meeting-slide-heading" style={{ fontSize: "clamp(2.5rem, 5vw, 3.5rem)" }}>
          {slide.title}
        </h1>
      )}
      {slide.body && <p className="meeting-slide-subtitle">{slide.body}</p>}
      {isFirst && (
        <div className="meeting-slide-hint">
          Press <kbd>&rarr;</kbd> to begin
        </div>
      )}
    </div>
  );
}

function ContentSlide({ slide }: { slide: Slide }) {
  const rawLines = slide.body?.split("\n").filter(Boolean) || [];
  const hasImage = !!slide.image_url;

  // Classify lines with context: after a heading, items become sub-items
  // until the next heading or standalone paragraph
  const classified = rawLines.map((line, i) => {
    const trimmed = line.replace(/^[-*]\s*/, "");
    const isExplicitIndent = line.startsWith("  ") || line.startsWith("   ") || line.startsWith("\t");
    const isHeading = trimmed.endsWith(":") && trimmed.length < 60 && !trimmed.startsWith("-") && !trimmed.includes("(");
    return { text: trimmed, isHeading, isExplicitIndent, raw: line };
  });

  // Second pass: lines after a heading are sub-items until next heading
  let inSection = false;
  for (const item of classified) {
    if (item.isHeading) {
      inSection = true;
      (item as { cls: string }).cls = "heading-item";
    } else if (item.isExplicitIndent) {
      (item as { cls: string }).cls = "sub-item";
    } else if (inSection && item.raw.startsWith("- ")) {
      (item as { cls: string }).cls = "sub-item";
    } else {
      inSection = false;
      (item as { cls: string }).cls = "";
    }
  }

  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      <div className={hasImage ? "meeting-split-layout" : ""}>
        <div className={hasImage ? "meeting-split-text" : ""}>
          {slide.title && (
            <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", textAlign: "left" }}>
              {slide.title}
            </h2>
          )}
          {classified.length > 0 && (
            <ul className="meeting-slide-bullets">
              {classified.map((item, i) => (
                <li key={i} className={(item as { cls: string }).cls}>{item.text}</li>
              ))}
            </ul>
          )}
        </div>
        {hasImage && (
          <div className="meeting-split-image">
            <img src={slide.image_url!} alt={slide.image_caption || ""} />
            {slide.image_caption && <div className="meeting-split-caption">{slide.image_caption}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function StatsSlide({ slide, autoStats }: { slide: Slide; autoStats?: MeetingStats | null }) {
  let stats = (slide.custom_data?.stats as Array<{ label: string; value: string; highlight?: boolean }>) || [];

  if (slide.custom_data?.auto_stats && autoStats) {
    const s = autoStats.since_last_meeting;
    stats = [
      { label: "Cats Fixed", value: String(s.total_fixed), highlight: true },
      { label: "Spays", value: String(s.spays) },
      { label: "Neuters", value: String(s.neuters) },
      { label: "Requests Resolved", value: String(autoStats.requests_resolved) },
      { label: "Active Requests", value: String(autoStats.active_requests) },
      { label: "YTD Total", value: String(autoStats.ytd.total_fixed), highlight: true },
    ];
  }

  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      {slide.title && (
        <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)" }}>
          {slide.title}
        </h2>
      )}
      <div className="meeting-stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className={`meeting-stat${stat.highlight ? " meeting-stat-highlight" : ""}`}>
            <div className="meeting-stat-value">{stat.value}</div>
            <div className="meeting-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoSlide({ slide }: { slide: Slide }) {
  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      {slide.title && (
        <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.3rem, 3vw, 1.8rem)" }}>
          {slide.title}
        </h2>
      )}
      {slide.image_url && (
        <img
          src={slide.image_url}
          alt={slide.image_caption || "Slide image"}
          className="meeting-slide-image"
        />
      )}
      {slide.image_caption && (
        <p className="meeting-slide-caption">{slide.image_caption}</p>
      )}
    </div>
  );
}

function TwoColumnSlide({ slide }: { slide: Slide }) {
  const left = (slide.custom_data?.left_content as string) || "";
  const right = (slide.custom_data?.right_content as string) || "";
  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      {slide.title && (
        <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)" }}>
          {slide.title}
        </h2>
      )}
      <div className="meeting-two-col">
        <div className="meeting-two-col-panel">
          {left.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} style={{ margin: "0.4rem 0" }}>{line.replace(/^[-*]\s*/, "")}</p>
          ))}
        </div>
        <div className="meeting-two-col-panel">
          {right.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} style={{ margin: "0.4rem 0" }}>{line.replace(/^[-*]\s*/, "")}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuoteSlide({ slide }: { slide: Slide }) {
  return (
    <div className="meeting-slide-inner">
      {slide.body && (
        <blockquote className="meeting-slide-quote">
          {slide.body}
        </blockquote>
      )}
      {slide.title && (
        <p className="meeting-slide-attribution">&mdash; {slide.title}</p>
      )}
    </div>
  );
}

const SLIDE_RENDERERS: Record<
  string,
  React.FC<{ slide: Slide; autoStats?: MeetingStats | null; isFirst?: boolean }>
> = {
  title: TitleSlide,
  content: ContentSlide,
  stats: StatsSlide,
  photo: PhotoSlide,
  two_column: TwoColumnSlide,
  quote: QuoteSlide,
};

export default function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [slides, setSlides] = useState<Slide[]>([]);
  const [autoStats, setAutoStats] = useState<MeetingStats | null>(null);
  const [current, setCurrent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetchApi<MeetingData>(`/api/meetings/${id}`),
      fetchApi<MeetingStats>(`/api/meetings/${id}/stats`).catch(() => null),
    ]).then(([meetingData, statsData]) => {
      setSlides(meetingData?.slides || []);
      setAutoStats(statsData);
      setLoaded(true);
    });
  }, [id]);

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, idx));
    setCurrent(clamped);
    containerRef.current?.children[clamped]?.scrollIntoView({ behavior: "smooth" });
  }, [slides.length]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        router.push(`/trappers/meetings/${id}`);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [next, prev, router, id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loaded) return;
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
      <div className="meeting-present">
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100vh", textAlign: "center",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            border: "3px solid rgba(37, 99, 235, 0.3)",
            borderTopColor: "#2563eb",
            animation: "spin 0.8s linear infinite",
          }} />
          <div style={{ marginTop: "1.5rem", color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>
            Preparing presentation...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="meeting-present">
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100vh", gap: "1rem",
        }}>
          <div style={{ fontSize: "1.1rem", color: "rgba(255,255,255,0.5)" }}>
            No slides in this meeting yet.
          </div>
          <button
            onClick={() => router.push(`/trappers/meetings/${id}`)}
            style={{
              padding: "0.5rem 1.25rem", background: "#2563eb", color: "#fff",
              border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem",
            }}
          >
            Back to editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-present">
      <div className="meeting-present-slides" ref={containerRef}>
        {slides.map((slide, idx) => {
          const Renderer = SLIDE_RENDERERS[slide.slide_type] || ContentSlide;
          return (
            <section
              key={slide.slide_id}
              className="meeting-present-slide"
              data-bg={slide.background_style}
            >
              <Renderer slide={slide} autoStats={autoStats} isFirst={idx === 0} />
            </section>
          );
        })}
      </div>

      {/* Navigation bar */}
      <div className="meeting-present-nav">
        <button
          className="meeting-present-nav-btn"
          onClick={prev}
          disabled={current === 0}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="meeting-present-dots">
          {slides.map((_, i) => (
            <button
              key={i}
              className={`meeting-present-dot${i === current ? " meeting-present-dot-active" : ""}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        <button
          className="meeting-present-nav-btn"
          onClick={next}
          disabled={current === slides.length - 1}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Slide counter */}
      <div className="meeting-present-counter">
        {current + 1} / {slides.length}
      </div>

      {/* Exit button */}
      <button
        className="meeting-present-exit"
        onClick={() => router.push(`/trappers/meetings/${id}`)}
      >
        ESC to exit
      </button>

      {/* Fullscreen toggle */}
      <button
        className="meeting-present-exit"
        style={{ right: "auto", left: "1rem" }}
        onClick={() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        }}
      >
        Fullscreen
      </button>
    </div>
  );
}
