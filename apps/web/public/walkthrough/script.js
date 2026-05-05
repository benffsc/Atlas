/* ============================================================================
   Beacon Gala Walkthrough — Navigation Only

   All content lives in index.html — edit slides there.
   This file handles keyboard nav, button clicks, and scroll-snap sync.
   ============================================================================ */

var container = document.getElementById("slides");
var slides = Array.from(container.children);
var prevBtn = document.getElementById("nav-prev");
var nextBtn = document.getElementById("nav-next");
var counter = document.getElementById("nav-counter");
var nav = document.getElementById("nav");
var TOTAL = slides.length;
var current = 0;

// Content slides are 1-based (skip title, skip CTA)
var CONTENT_SLIDES = TOTAL - 2; // e.g. 5 content slides out of 6 total

function goToSlide(idx) {
  current = Math.max(0, Math.min(TOTAL - 1, idx));
  slides[current].scrollIntoView({ behavior: "smooth" });
  updateUI();
}

// Expose globally for onclick in HTML
window.goToSlide = goToSlide;

function updateUI() {
  // Counter shows content slide number (1-based, excludes title)
  if (current === 0) {
    nav.style.display = "none";
  } else {
    nav.style.display = "flex";
    var contentIdx = current; // 1-based since title is 0
    counter.textContent = contentIdx + "/" + (TOTAL - 1);
  }

  prevBtn.disabled = current <= 1; // Can't go before first content slide
  nextBtn.disabled = current >= TOTAL - 1;
}

// Keyboard
document.addEventListener("keydown", function (e) {
  if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
    e.preventDefault();
    goToSlide(current + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    goToSlide(current - 1);
  } else if (e.key === "Escape") {
    history.back();
  }
});

// Buttons
prevBtn.addEventListener("click", function () { goToSlide(current - 1); });
nextBtn.addEventListener("click", function () { goToSlide(current + 1); });
document.getElementById("exit-btn").addEventListener("click", function () { history.back(); });

// Scroll-snap sync
var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      var idx = slides.indexOf(entry.target);
      if (idx >= 0) { current = idx; updateUI(); }
    }
  });
}, { root: container, threshold: 0.6 });
slides.forEach(function (s) { observer.observe(s); });

// Init
updateUI();
