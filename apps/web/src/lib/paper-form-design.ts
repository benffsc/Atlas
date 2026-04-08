/**
 * Paper Form Design Tokens
 *
 * Canonical sizing, typography, and color values for printable forms
 * generated from Atlas. Built from the trap-checkout-slip redesign on
 * 2026-04-08 using research-backed accessibility minimums for senior
 * users, big-handwriting writers, and low-vision readers.
 *
 * Use these tokens in any new print route — checkout slips, call sheets,
 * intake confirmations, lost-cat flyers, foster waivers — so paper output
 * stays consistent and accessible across the org.
 *
 * See docs/PAPER_FORM_DESIGN.md for the full design language, rationale,
 * and source citations.
 *
 * Source minimums these tokens are calibrated against:
 * - 12pt body text (clear-print accessibility floor)
 * - 0.34" field write line (wide-rule notebook, comfortable for adult
 *   handwriting and chunky pens)
 * - 0.20" checkbox (tappable / pen-mark target without overflow)
 * - 1.5× line height
 * - High-contrast pure black on white (drops cleanly to photocopy)
 *
 * The Atlas defaults below sit a comfortable margin ABOVE each minimum.
 */

export const PAPER_FORM = {
  // ── Typography ────────────────────────────────────────────────────────────
  font: {
    family: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    /** Body / write-line text. Above 12pt accessibility floor. */
    body: "13pt",
    /** Field labels. Always bold, always above the field. */
    label: "11pt",
    /** Section headings. Optional — only when grouping needs explicit cueing. */
    section: "12pt",
    /** Page header (org name). */
    h1: "14pt",
    /** Footer / fine-print reference text. */
    footer: "8pt",
  },

  weight: {
    body: 400,
    label: 700,
    section: 700,
    h1: 700,
  },

  lineHeight: {
    body: 1.4,
    label: 1.2,
    h1: 1.1,
  },

  // ── Color ─────────────────────────────────────────────────────────────────
  // High contrast on white. Single accent color (green) for the page-header
  // rule only — everything else is black/gray so the form survives photocopying
  // without losing meaning.
  color: {
    /** Pure black for body text, labels, checkbox borders. */
    text: "#000",
    /** Mid-gray for footer + de-emphasized text. */
    muted: "#555",
    /** Green accent — used ONLY for the rule under the page header. */
    rule: "#1a7f3a",
    /** Field underlines + hairline group separators. */
    border: "#888",
    /** Even lighter — internal hairline rules between sections. */
    hairline: "#ccc",
    checkboxBorder: "#000",
  },

  // ── Spacing ───────────────────────────────────────────────────────────────
  spacing: {
    /** Page left/right padding. Generous so writing has clearance. */
    pageMarginX: "0.45in",
    /** Page top/bottom padding. */
    pageMarginY: "0.40in",
    /** Vertical space between adjacent fields. */
    fieldGap: "0.10in",
    /** Vertical space between adjacent grid rows in a multi-column row. */
    rowGap: "0.06in",
    /** Vertical space around hairline rules between groups. */
    sectionRule: "0.08in",
    /** Horizontal gap between columns in a multi-column row. */
    columnGap: "0.30in",
  },

  // ── Field write line ──────────────────────────────────────────────────────
  // The actual handwriting target. The 0.45in height is the most important
  // single number in this whole tokens file — it's the difference between
  // "fits a senior's penmanship" and "can't write your own name in this box".
  field: {
    /** Vertical height of the writable area. Above the 0.34" wide-rule floor. */
    writeLineHeight: "0.45in",
    /** Underline at the bottom of the writable area. */
    writeLineUnderline: "1.5px solid #888",
    /** Gap between the field label and the underline. */
    labelMarginBottom: "0.04in",
    /** Inset the value text from the underline so it's not sitting on the line. */
    valuePadBottom: "3px",
  },

  // ── Checkboxes ────────────────────────────────────────────────────────────
  // 0.22in is large enough for a chunky pen check without overflowing the box,
  // and visible from across a counter when staff hands the slip back.
  checkbox: {
    size: "0.22in",
    border: "1.5px solid #000",
    /** Gap between the checkbox and its label text. */
    labelGap: "0.06in",
    /** Gap between adjacent checkboxes in a row. */
    rowGap: "0.18in",
  },

  // ── Page sizing ───────────────────────────────────────────────────────────
  // Two canonical page targets — half-sheet (cuts 2-up from letter portrait)
  // and full-sheet (one form per letter portrait page). Pick based on whether
  // the form needs to fit on a paper handoff or be a full document.
  page: {
    halfSheet: { width: "8.5in", height: "5.0in" },
    fullSheet: { width: "8.5in", height: "11.0in" },
  },

  // ── Print mode helpers ────────────────────────────────────────────────────
  // CSS rule snippets for common print layouts. Reference these when writing
  // @media print blocks for new forms.
  print: {
    /**
     * 2-up half-sheet centering. Apply to the print-page wrapper div so
     * two slips share a letter portrait page with equal whitespace, and
     * the dashed cut line lands at the exact paper midpoint.
     *
     * Requires html, body { height: 100% } in @media print so 100vh
     * resolves correctly.
     */
    twoUpHalfSheetWrapper: {
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-around",
      position: "relative",
    },
    /** Letter portrait, no @page margin (browser may override). */
    page: "size: letter portrait; margin: 0;",
    /** Force background color rendering (for accent rules and badges). */
    forceColor: {
      WebkitPrintColorAdjust: "exact",
      printColorAdjust: "exact",
    },
  },
} as const;

/**
 * Type-safe access to the design tokens.
 *
 * Example:
 *   const labelStyle: React.CSSProperties = {
 *     fontSize: PAPER_FORM.font.label,
 *     fontWeight: PAPER_FORM.weight.label,
 *     color: PAPER_FORM.color.text,
 *   };
 */
export type PaperFormDesign = typeof PAPER_FORM;
