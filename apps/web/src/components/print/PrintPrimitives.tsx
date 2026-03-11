"use client";

import React from "react";

/* ── Bubble (radio-style circle) ── */
export function Bubble({ filled, label }: { filled: boolean; label: string }) {
  return (
    <span className="option">
      <span className={`bubble ${filled ? "filled" : ""}`}></span> {label}
    </span>
  );
}

/* ── Check (checkbox) ── */
export function Check({
  checked,
  crossed,
  label,
}: {
  checked?: boolean;
  crossed?: boolean;
  label: string;
}) {
  return (
    <span className="option">
      <span
        className={`checkbox ${checked ? "checked" : crossed ? "crossed" : ""}`}
      >
        {checked ? "✓" : crossed ? "✗" : ""}
      </span>{" "}
      {label}
    </span>
  );
}

/* ── EditableField (single-line typeable input) ── */
export function EditableField({
  label,
  value,
  placeholder,
  size = "sm",
  style,
}: {
  label?: string;
  value?: string | null;
  placeholder?: string;
  size?: "sm" | "md" | "lg" | "xl";
  style?: React.CSSProperties;
}) {
  const hasValue = !!value;
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      <div className={`field-input ${size} ${hasValue ? "prefilled" : ""}`}>
        <input
          type="text"
          defaultValue={value || ""}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

/* ── EditableTextArea (multi-line typeable textarea) ── */
export function EditableTextArea({
  label,
  value,
  placeholder,
  size = "md",
  style,
}: {
  label?: string;
  value?: string | null;
  placeholder?: string;
  size?: "sm" | "md" | "lg" | "xl";
  style?: React.CSSProperties;
}) {
  const hasValue = !!value;
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      <div className={`field-input ${size} ${hasValue ? "prefilled" : ""}`}>
        <textarea defaultValue={value || ""} placeholder={placeholder} />
      </div>
    </div>
  );
}

/* ── PrintSection (wraps a titled group of fields) ── */
export function PrintSection({
  title,
  className,
  style,
  children,
}: {
  title: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className={`section ${className || ""}`} style={style}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

/* ── FieldRow (horizontal group of fields) ── */
export function FieldRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="field-row" style={style}>
      {children}
    </div>
  );
}

/* ── OptionsRow (horizontal group of bubbles/checkboxes) ── */
export function OptionsRow({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="options-row">
      {label && <span className="options-label">{label}</span>}
      {children}
    </div>
  );
}

/* ── PrintHeader ── */
export function PrintHeader({
  title,
  subtitle,
  rightContent,
}: {
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
}) {
  return (
    <div className="print-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      <div className="header-right">
        {rightContent}
        <img src="/logo.png" alt="FFSC" className="header-logo" />
      </div>
    </div>
  );
}

/* ── PrintFooter ── */
export function PrintFooter({
  left,
  right,
}: {
  left: string;
  right: string;
}) {
  return (
    <div className="page-footer">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/* ── PrintControlsPanel ── */
export function PrintControlsPanel({
  title,
  description,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  description?: string;
  backHref: string;
  backLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="print-controls">
      <h3>{title}</h3>
      {description && (
        <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
          {description}
        </p>
      )}
      {children}
      <button className="print-btn" onClick={() => window.print()}>
        Print / Save PDF
      </button>
      <a href={backHref} style={{ textDecoration: "none" }}>
        <button className="back-btn" style={{ width: "100%" }}>
          {backLabel}
        </button>
      </a>
    </div>
  );
}
