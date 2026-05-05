/* ============================================================================
   Beacon Gala Walkthrough — Navigation

   This file ONLY handles navigation (keyboard, dots, scroll-snap sync).
   All content lives in index.html — edit slides there directly.
   ============================================================================ */

(function () {
  var container = document.getElementById("slides");
  var slides = Array.from(container.children);
  var prevBtn = document.getElementById("nav-prev");
  var nextBtn = document.getElementById("nav-next");
  var progress = document.getElementById("progress");
  var pills = Array.from(progress.children);
  var dotsContainer = document.getElementById("dots");
  var TOTAL = slides.length;
  var current = 0;

  // Build dots from slide count
  slides.forEach(function (_, i) {
    var dot = document.createElement("button");
    dot.className = "dot";
    dot.setAttribute("aria-label", "Slide " + (i + 1));
    dot.addEventListener("click", function () { goTo(i); });
    dotsContainer.appendChild(dot);
  });

  var dots = Array.from(dotsContainer.children);

  function goTo(idx) {
    current = Math.max(0, Math.min(TOTAL - 1, idx));
    slides[current].scrollIntoView({ behavior: "smooth" });
    updateUI();
  }

  function updateUI() {
    // Dots
    dots.forEach(function (dot, i) {
      dot.classList.toggle("dot--active", i === current);
      var color = slides[i].dataset.color;
      dot.style.background = (i === current && color) ? color : "";
    });

    // Prev/Next
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === TOTAL - 1;

    // Progress pills
    var label = slides[current].dataset.label;
    if (label) {
      progress.style.display = "flex";
      pills.forEach(function (pill) {
        var match = pill.dataset.step === label;
        pill.classList.toggle("progress-pill--active", match);
        pill.style.background = match ? pill.dataset.color : "";
      });
    } else {
      progress.style.display = "none";
    }
  }

  // Keyboard
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
      e.preventDefault();
      goTo(current + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === "Escape") {
      history.back();
    }
  });

  // Buttons
  prevBtn.addEventListener("click", function () { goTo(current - 1); });
  nextBtn.addEventListener("click", function () { goTo(current + 1); });
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
})();
