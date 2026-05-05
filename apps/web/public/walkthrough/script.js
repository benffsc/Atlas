/* ============================================================================
   Beacon Gala Walkthrough — Dynamic Renderer

   Fetches slide config from /api/walkthrough-config and renders.
   Falls back to the HTML already in the page if the API is unavailable.

   Edit transitions/animations here. Edit content via /admin/walkthrough.
   ============================================================================ */

(function () {
  const container = document.getElementById("slides");
  const nav = document.querySelector(".nav");
  const progress = document.getElementById("progress");
  const prevBtn = document.getElementById("nav-prev");
  const nextBtn = document.getElementById("nav-next");
  const exitBtn = document.getElementById("exit-btn");

  let slides = [];
  let current = 0;

  // ── Fetch config and render ──────────────────────────────────────────

  fetch("/api/walkthrough-config")
    .then((r) => r.json())
    .then((res) => {
      const data = res.data || res;
      if (data.slides && data.slides.length > 0) {
        renderSlides(data.slides);
      } else {
        // API returned empty — use whatever HTML is already in the page
        initFromExistingHTML();
      }
    })
    .catch(() => {
      // API unavailable (offline preview, etc.) — use existing HTML
      initFromExistingHTML();
    });

  function initFromExistingHTML() {
    slides = Array.from(container.children);
    buildNav();
    bindEvents();
    updateUI();
  }

  // ── Render slides from API config ────────────────────────────────────

  function renderSlides(config) {
    container.innerHTML = "";

    config.forEach((slide) => {
      const section = document.createElement("section");
      section.className = "slide";

      if (slide.label) {
        section.dataset.label = slide.label;
        section.dataset.color = slide.color || "";
      }

      const inner = document.createElement("div");
      inner.className = "slide-inner";

      if (slide.type === "title") {
        section.classList.add("slide--title");
        inner.innerHTML = `
          <img src="/beacon-logo.jpeg" alt="Beacon" class="logo" />
          <h1 class="headline">${esc(slide.headline || "Beacon")}</h1>
          <p class="tagline">${esc(slide.subtitle || "")}</p>
          ${slide.org ? `<p class="tagline org-name">${esc(slide.org)}</p>` : ""}
          <div class="hint">Press <kbd>&rarr;</kbd> to begin</div>
        `;
      } else if (slide.type === "step") {
        // Dynamic background class or inline gradient
        const bgKey = (slide.label || "").toLowerCase();
        const knownBgs = ["find", "fix", "return", "analyze"];
        if (knownBgs.includes(bgKey)) {
          section.classList.add("slide--" + bgKey);
        } else if (slide.color) {
          section.style.background = `radial-gradient(ellipse 80% 60% at 50% 30%, ${hexToRgba(slide.color, 0.1)} 0%, transparent 70%), var(--bg, #0a0a0f)`;
        }

        let embed = "";
        if (slide.image) {
          embed = `<div class="iframe-wrapper"><img src="${esc(slide.image)}" alt="${esc(slide.label || "")}" style="width:100%;height:100%;object-fit:cover" /></div>`;
        } else if (slide.iframe) {
          embed = `<div class="iframe-wrapper"><iframe src="${esc(slide.iframe)}" title="${esc(slide.label || "")}" loading="${slide.step <= 2 ? "eager" : "lazy"}"></iframe></div>`;
        }

        inner.innerHTML = `
          <div class="step-badge" style="background: ${slide.color || "#6b7280"}">Step ${slide.step}: ${esc(slide.label || "")}</div>
          <h2 class="slide-title">${esc(slide.title || "")}</h2>
          <p class="slide-body">${esc(slide.body || "")}</p>
          ${embed}
        `;
      } else if (slide.type === "thankyou") {
        section.classList.add("slide--thankyou");

        const tiersHtml = (slide.tiers || [])
          .map(
            (t) => `
            <div class="unit-card">
              <div class="unit-amount">${esc(t.amount)}</div>
              <div class="unit-equals">=</div>
              <div class="unit-outcome">${esc(t.outcome)}</div>
            </div>`
          )
          .join("");

        inner.innerHTML = `
          <h2 class="slide-title" style="font-size: 1.75rem">${esc(slide.title || "")}</h2>
          <p class="slide-body" style="margin-bottom: 2rem">${esc(slide.body || "")}</p>
          <div class="unit-grid">${tiersHtml}</div>
          <p class="tagline thankyou-text">Thank you</p>
        `;
      }

      section.appendChild(inner);
      container.appendChild(section);
    });

    slides = Array.from(container.children);
    buildNav();
    bindEvents();
    updateUI();
  }

  // ── Build nav dots + progress pills from current slides ──────────────

  function buildNav() {
    // Dots
    const dotsContainer = document.querySelector(".dots");
    dotsContainer.innerHTML = "";
    slides.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.className = "dot";
      dot.setAttribute("aria-label", "Slide " + (i + 1));
      dot.addEventListener("click", () => goTo(i));
      dotsContainer.appendChild(dot);
    });

    // Progress pills
    progress.innerHTML = "";
    slides.forEach((s) => {
      if (s.dataset.label) {
        const pill = document.createElement("span");
        pill.className = "progress-pill";
        pill.dataset.step = s.dataset.label;
        pill.dataset.color = s.dataset.color || "";
        pill.textContent = s.dataset.label;
        progress.appendChild(pill);
      }
    });
  }

  // ── Navigation ───────────────────────────────────────────────────────

  function goTo(idx) {
    current = Math.max(0, Math.min(slides.length - 1, idx));
    slides[current].scrollIntoView({ behavior: "smooth" });
    updateUI();
  }

  function goBack() {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
      history.back();
    } else {
      window.location.href = "/";
    }
  }

  function updateUI() {
    const dots = Array.from(document.querySelectorAll(".dots .dot"));
    const pills = Array.from(document.querySelectorAll(".progress-pill"));

    dots.forEach((dot, i) => {
      dot.classList.toggle("dot--active", i === current);
      const color = slides[i] && slides[i].dataset.color;
      dot.style.background = i === current && color ? color : "";
    });

    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === slides.length - 1;

    const currentLabel = slides[current] && slides[current].dataset.label;
    if (currentLabel) {
      progress.style.display = "flex";
      pills.forEach((pill) => {
        const match = pill.dataset.step === currentLabel;
        pill.classList.toggle("progress-pill--active", match);
        pill.style.background = match ? pill.dataset.color : "";
      });
    } else {
      progress.style.display = "none";
    }
  }

  function bindEvents() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === "Escape") {
        goBack();
      }
    });

    prevBtn.addEventListener("click", () => goTo(current - 1));
    nextBtn.addEventListener("click", () => goTo(current + 1));
    exitBtn.addEventListener("click", goBack);

    // Scroll-snap sync
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = slides.indexOf(entry.target);
            if (idx >= 0) {
              current = idx;
              updateUI();
            }
          }
        }
      },
      { root: container, threshold: 0.6 }
    );
    slides.forEach((slide) => observer.observe(slide));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  function esc(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
})();
