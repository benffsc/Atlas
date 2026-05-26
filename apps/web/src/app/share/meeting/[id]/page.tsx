"use client";

/**
 * Public meeting presentation viewer.
 * No login required. Accessible at /share/meeting/[id]
 * Uses the same slide renderers as the internal presenter.
 */

import { useEffect, useState, useRef, useCallback, use } from "react";
// NOTE: Do NOT use fetchApi here - it auto-redirects to /login on 401.
// This page is public and must work without auth.

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

const BG_MAP: Record<string, string> = {
  default: "default",
  dark: "dark",
  accent: "accent",
  photo_bg: "photo_bg",
};

/* ---- Slide renderers (self-contained, no imports from internal pages) ---- */

function VideoEmbed({ slide }: { slide: Slide }) {
  const videoUrl = slide.custom_data?.video_url as string | undefined;
  if (!videoUrl) return null;
  const driveMatch = videoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const embedSrc = driveMatch
    ? `https://drive.google.com/file/d/${driveMatch[1]}/preview`
    : videoUrl;
  return (
    <div className="meeting-slide-inner" style={{ maxWidth: "1100px" }}>
      {slide.title && <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", marginBottom: "1.5rem" }}>{slide.title}</h2>}
      <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", borderRadius: "8px", overflow: "hidden" }}>
        <iframe src={embedSrc} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} allow="autoplay; encrypted-media" allowFullScreen />
      </div>
      {slide.body && <p className="meeting-slide-subtitle" style={{ marginTop: "1rem" }}>{slide.body}</p>}
    </div>
  );
}

function TitleSlide({ slide, isFirst }: { slide: Slide; isFirst?: boolean }) {
  if (slide.custom_data?.video_url) return <VideoEmbed slide={slide} />;
  return (
    <div className="meeting-slide-inner">
      {slide.title && <h1 className="meeting-slide-heading" style={{ fontSize: "clamp(2.5rem, 5vw, 3.5rem)" }}>{slide.title}</h1>}
      {slide.body && <p className="meeting-slide-subtitle">{slide.body}</p>}
      {isFirst && <div className="meeting-slide-hint">Press <kbd>&rarr;</kbd> to begin</div>}
    </div>
  );
}

function ContentSlide({ slide }: { slide: Slide }) {
  const rawLines = slide.body?.split("\n").filter(Boolean) || [];
  const hasImage = !!slide.image_url;
  const classified: Array<{ text: string; cls: string }> = [];
  let inSection = false;
  for (const line of rawLines) {
    const trimmed = line.replace(/^[-*]\s*/, "");
    const isExplicitIndent = line.startsWith("  ") || line.startsWith("   ") || line.startsWith("\t");
    const isHeading = trimmed.endsWith(":") && trimmed.length < 60 && !trimmed.startsWith("-") && !trimmed.includes("(");
    let cls = "";
    if (isHeading) { inSection = true; cls = "heading-item"; }
    else if (isExplicitIndent) { cls = "sub-item"; }
    else if (inSection && line.startsWith("- ")) { cls = "sub-item"; }
    else { inSection = false; }
    classified.push({ text: trimmed, cls });
  }
  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      <div className={hasImage ? "meeting-split-layout" : ""}>
        <div className={hasImage ? "meeting-split-text" : ""}>
          {slide.title && <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", textAlign: "left" }}>{slide.title}</h2>}
          {classified.length > 0 && (
            <ul className="meeting-slide-bullets">
              {classified.map((item, i) => <li key={i} className={item.cls}>{item.text}</li>)}
            </ul>
          )}
        </div>
        {hasImage && (
          <div className="meeting-split-image">
            <img src={slide.image_url!} alt={slide.image_caption || ""} />
          </div>
        )}
      </div>
    </div>
  );
}

function TwoColumnSlide({ slide }: { slide: Slide }) {
  const left = (slide.custom_data?.left_content as string) || "";
  const right = (slide.custom_data?.right_content as string) || "";
  return (
    <div className="meeting-slide-inner meeting-slide-inner-wide">
      {slide.title && <h2 className="meeting-slide-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)" }}>{slide.title}</h2>}
      <div className="meeting-two-col">
        <div className="meeting-two-col-panel">
          {left.split("\n").filter(Boolean).map((line, i) => <p key={i} style={{ margin: "0.4rem 0" }}>{line.replace(/^[-*]\s*/, "")}</p>)}
        </div>
        <div className="meeting-two-col-panel">
          {right.split("\n").filter(Boolean).map((line, i) => <p key={i} style={{ margin: "0.4rem 0" }}>{line.replace(/^[-*]\s*/, "")}</p>)}
        </div>
      </div>
    </div>
  );
}

function QuoteSlide({ slide }: { slide: Slide }) {
  return (
    <div className="meeting-slide-inner">
      {slide.body && <blockquote className="meeting-slide-quote">{slide.body}</blockquote>}
      {slide.title && <p className="meeting-slide-attribution">&mdash; {slide.title}</p>}
    </div>
  );
}

const RENDERERS: Record<string, React.FC<{ slide: Slide; isFirst?: boolean }>> = {
  title: TitleSlide,
  content: ContentSlide,
  two_column: TwoColumnSlide,
  quote: QuoteSlide,
};

export default function ShareMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [current, setCurrent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((json) => {
        const data = json.success ? json.data : json;
        setSlides(data.slides || []);
        setMeetingTitle(data.meeting?.title || "");
        setLoaded(true);
      })
      .catch(() => setError(true));
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
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); prev(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [next, prev]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loaded) return;
    const observer = new IntersectionObserver(
      (entries) => { for (const entry of entries) { if (entry.isIntersecting) { const idx = Array.from(container.children).indexOf(entry.target as HTMLElement); if (idx >= 0) setCurrent(idx); } } },
      { root: container, threshold: 0.6 }
    );
    Array.from(container.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [loaded]);

  if (error) {
    return (
      <div className="meeting-present">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "rgba(255,255,255,0.5)", fontSize: "1.1rem" }}>
          Meeting not found.
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="meeting-present">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />
          <div style={{ marginTop: "1.5rem", color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>Loading presentation...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-present">
      <div className="meeting-present-slides" ref={containerRef}>
        {slides.map((slide, idx) => {
          const Renderer = RENDERERS[slide.slide_type] || ContentSlide;
          return (
            <section key={slide.slide_id} className="meeting-present-slide" data-bg={slide.background_style}>
              <Renderer slide={slide} isFirst={idx === 0} />
            </section>
          );
        })}
      </div>

      <div className="meeting-present-nav">
        <button className="meeting-present-nav-btn" onClick={prev} disabled={current === 0}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="meeting-present-dots">
          {slides.map((_, i) => (
            <button key={i} className={`meeting-present-dot${i === current ? " meeting-present-dot-active" : ""}`} onClick={() => goTo(i)} />
          ))}
        </div>
        <button className="meeting-present-nav-btn" onClick={next} disabled={current === slides.length - 1}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <div className="meeting-present-counter">{current + 1} / {slides.length}</div>
    </div>
  );
}
