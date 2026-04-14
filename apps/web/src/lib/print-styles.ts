/**
 * Shared print stylesheet constants for all FFSC print documents.
 *
 * Accent colors use CSS custom properties so individual pages can override:
 *   --print-accent:      Main accent (default: #27ae60 green)
 *   --print-accent-dark: Dark accent for headers/text (default: #166534)
 *   --print-accent-bg:   Light accent background (default: #f0fdf4)
 *   --print-accent-border: Light accent border (default: #86efac)
 *   --print-screen-bg:   Screen preview background (default: #f0f9f4)
 *
 * Override in your page's <style jsx global>:
 *   .print-wrapper {
 *     --print-accent: #2563eb;
 *     --print-accent-dark: #1e40af;
 *     --print-accent-bg: #eff6ff;
 *     --print-accent-border: #93c5fd;
 *     --print-screen-bg: #eff6ff;
 *   }
 *
 * Usage: interpolate into <style jsx global>{`${PRINT_BASE_CSS} ...overrides...`}</style>
 */

export const PRINT_FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Raleway:wght@600;700&display=swap');`;

export const PRINT_BASE_CSS = `
  ${PRINT_FONT_IMPORT}

  /* ── Accent color defaults (green) — override via --print-accent-* ── */
  .print-wrapper {
    --print-accent: #27ae60;
    --print-accent-dark: #166534;
    --print-accent-bg: #f0fdf4;
    --print-accent-border: #86efac;
    --print-screen-bg: #f0f9f4;
  }

  @media print {
    @page { size: letter; margin: 0.3in; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    .print-controls, .tippy-fab, .tippy-chat-panel { display: none !important; }
    .print-wrapper { width: 100% !important; padding: 0 !important; }
    .print-page {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      padding: 0 !important;
      box-shadow: none !important;
      margin: 0 !important;
      page-break-after: always;
      overflow: visible !important;
    }
    .print-page:last-child { page-break-after: auto; }
  }

  body { margin: 0; padding: 0; }

  .print-wrapper {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.25;
    color: #2c3e50;
  }

  .print-page {
    width: 8.5in;
    padding: 0.3in;
    box-sizing: border-box;
    background: #fff;
  }

  h1, h2, h3, .section-title {
    font-family: 'Raleway', Helvetica, sans-serif;
    font-weight: 700;
  }

  /* ── Header ── */
  .print-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 6px;
    margin-bottom: 6px;
    border-bottom: 3px solid var(--print-accent);
  }
  .print-header h1 {
    font-size: 15pt;
    margin: 0;
    color: var(--print-accent);
  }
  .print-header .subtitle {
    font-size: 8.5pt;
    color: #7f8c8d;
    margin-top: 1px;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header-logo {
    height: 36px;
    width: auto;
  }

  /* ── Priority ── */
  .priority-badge {
    padding: 3px 10px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 9.5pt;
    text-transform: uppercase;
  }
  .priority-urgent { background: #dc2626; color: #fff; }
  .priority-high { background: #ea580c; color: #fff; }
  .priority-normal { background: #16a34a; color: #fff; }
  .priority-low { background: #6b7280; color: #fff; }

  /* ── Sections ── */
  .section { margin-bottom: 6px; }
  .section-title {
    font-size: 10pt;
    color: var(--print-accent);
    border-bottom: 1.5px solid #ecf0f1;
    padding-bottom: 2px;
    margin-bottom: 4px;
  }

  /* ── Fields ── */
  .field-row {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }
  .field { flex: 1; min-width: 0; }
  .field.w2 { flex: 2; }
  .field.w3 { flex: 3; }
  .field.half { flex: 0.5; }
  .field label {
    display: block;
    font-size: 7.5pt;
    font-weight: 600;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 1px;
  }
  .field-input {
    border: 1px solid #bdc3c7;
    border-radius: 3px;
    padding: 3px 5px;
    min-height: 20px;
    background: #fff;
    font-size: 9.5pt;
  }
  .field-input.prefilled {
    background: var(--print-accent-bg);
    color: #2c3e50;
  }
  .field-input.sm { min-height: 18px; padding: 2px 5px; }
  .field-input.md { min-height: 40px; }
  .field-input.lg { min-height: 70px; }
  .field-input.xl { min-height: 100px; }

  /* ── Bubbles & Checkboxes ── */
  .options-row {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 9pt;
    margin-bottom: 3px;
    flex-wrap: wrap;
  }
  .options-label {
    font-weight: 600;
    color: #2c3e50;
    min-width: 75px;
    font-size: 9pt;
  }
  .option {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-right: 8px;
  }
  .bubble {
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--print-accent);
    border-radius: 50%;
    background: #fff;
    flex-shrink: 0;
  }
  .bubble.filled { background: var(--print-accent); }
  .checkbox {
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--print-accent);
    border-radius: 2px;
    background: #fff;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    font-weight: 700;
  }
  .checkbox.checked { background: var(--print-accent); color: #fff; }
  .checkbox.crossed { border-color: #dc2626; color: #dc2626; }

  /* ── Layout helpers ── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  /* ── Alert boxes ── */
  .emergency-box {
    border: 1.5px solid #e74c3c;
    background: #fdedec;
    padding: 5px 8px;
    margin-bottom: 6px;
    border-radius: 5px;
  }
  .emergency-box .title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
    color: #e74c3c;
    font-size: 9pt;
  }
  .emergency-box .checkbox { border-color: #e74c3c; }
  .emergency-box .checkbox.checked { background: #e74c3c; border-color: #e74c3c; }

  .warning-box {
    background: #fef3c7;
    border: 1.5px solid #fcd34d;
    border-radius: 5px;
    padding: 4px 8px;
    margin-bottom: 6px;
  }
  .warning-box .title {
    font-weight: 600;
    color: #92400e;
    font-size: 9pt;
    margin-bottom: 3px;
  }

  .info-card {
    background: #f8f9fa;
    border-radius: 4px;
    padding: 4px 8px;
    margin-bottom: 4px;
    border-left: 3px solid var(--print-accent);
  }

  .info-box {
    background: var(--print-accent-bg);
    border: 1.5px solid var(--print-accent-border);
    border-radius: 5px;
    padding: 4px 8px;
    margin-bottom: 6px;
  }
  .info-box .title {
    font-weight: 600;
    color: var(--print-accent-dark);
    font-size: 9pt;
    margin-bottom: 3px;
  }

  /* ── Staff box ── */
  .staff-box {
    border: 1.5px dashed #94a3b8;
    border-radius: 5px;
    padding: 6px 8px;
    background: #f8fafc;
  }
  .staff-box .section-title {
    color: #7f8c8d;
    border-bottom-color: #bdc3c7;
  }

  /* ── Quick notes ── */
  .quick-notes {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
  }
  .quick-note {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5pt;
  }

  /* ── Footer ── */
  .page-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 4px;
    margin-top: 6px;
    border-top: 1px solid #ecf0f1;
    font-size: 7.5pt;
    color: #95a5a6;
  }

  .hint {
    font-size: 7pt;
    color: #95a5a6;
  }

  /* ── Screen preview ── */
  @media screen {
    body { background: var(--print-screen-bg) !important; }
    .print-wrapper { padding: 20px; }
    .print-page {
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      margin: 0 auto 30px auto;
      border-radius: 8px;
      height: auto;
      min-height: 10in;
    }
    .tippy-fab, .tippy-chat-panel { display: none !important; }
    .print-controls {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 1000;
      width: 280px;
    }
    .print-controls h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: var(--print-accent);
    }
    .print-controls button {
      display: block;
      width: 100%;
      padding: 10px 16px;
      margin-bottom: 8px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .print-controls .print-btn {
      background: linear-gradient(135deg, var(--print-accent) 0%, var(--print-accent-dark) 100%);
      color: #fff;
    }
    .print-controls .print-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .print-controls .back-btn {
      background: #f0f0f0;
      color: #333;
    }
    .print-controls .ctrl-hint {
      font-size: 11px;
      color: #888;
      margin-top: 10px;
      line-height: 1.4;
    }
    .print-controls label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      cursor: pointer;
    }
    .print-controls input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: var(--print-accent);
    }
    .version-selector {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .version-selector button {
      flex: 1;
      padding: 10px;
      border: 2px solid #ddd;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .version-selector button.active {
      border-color: var(--print-accent);
      background: var(--print-accent-bg);
      color: var(--print-accent-dark);
    }
    .version-selector button:hover:not(.active) {
      border-color: #bbb;
    }
    .mode-selector {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .mode-selector button {
      flex: 1;
      padding: 8px;
      border: 2px solid #ddd;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .mode-selector button.active {
      border-color: var(--print-accent);
      background: var(--print-accent-bg);
      color: var(--print-accent-dark);
    }
  }
`;

/**
 * Additional CSS for editable print fields.
 * Makes <input> and <textarea> inside .field-input transparent for print,
 * visible for screen interaction.
 */
export const PRINT_EDITABLE_CSS = `
  .field-input input,
  .field-input textarea {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: inherit;
    width: 100%;
    padding: 0;
    margin: 0;
    resize: none;
  }
  .field-input textarea {
    min-height: inherit;
    height: 100%;
  }
  .field-input input::placeholder,
  .field-input textarea::placeholder {
    color: #bdc3c7;
    font-style: italic;
  }
  @media print {
    .field-input input::placeholder,
    .field-input textarea::placeholder {
      color: transparent;
    }
  }
`;
