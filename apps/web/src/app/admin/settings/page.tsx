"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

interface SettingsCategory {
  title: string;
  items: { label: string; href: string; icon: string; description: string }[];
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    title: "General",
    items: [
      { label: "App Config", href: "/admin/config", icon: "settings", description: "Core application settings" },
      { label: "Theme", href: "/admin/theme", icon: "paintbrush", description: "Colors, fonts, branding" },
      { label: "Display Labels", href: "/admin/labels", icon: "tag", description: "UI text and terminology" },
      { label: "Map Colors", href: "/admin/map-colors", icon: "palette", description: "Map pin and overlay colors" },
    ],
  },
  {
    title: "Access",
    items: [
      { label: "Staff", href: "/admin/staff", icon: "user-cog", description: "Staff accounts and permissions" },
      { label: "Roles", href: "/admin/roles", icon: "shield", description: "Role definitions and access levels" },
      { label: "AI Access", href: "/admin/ai-access", icon: "shield-check", description: "AI feature permissions" },
      { label: "Blacklist", href: "/admin/blacklist", icon: "ban", description: "Blocked emails and identifiers" },
    ],
  },
  {
    title: "Forms",
    items: [
      { label: "Intake Fields", href: "/admin/intake-fields", icon: "form-input", description: "Custom intake form fields" },
      { label: "Intake Questions", href: "/admin/intake-questions", icon: "help-circle", description: "Public intake survey questions" },
      { label: "Form Layouts", href: "/admin/forms/layouts", icon: "file-stack", description: "Section-based form configuration" },
      { label: "Triage Flags", href: "/admin/triage-flags", icon: "flag", description: "Auto-triage rules and flags" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Organizations", href: "/admin/organizations", icon: "building-2", description: "Partner orgs, shelters, clinics" },
      { label: "Ecology Config", href: "/admin/ecology", icon: "leaf", description: "Colony parameters and modeling" },
      { label: "Automations", href: "/admin/automations", icon: "zap", description: "Automated workflows and triggers" },
      { label: "Source Confidence", href: "/admin/source-confidence", icon: "gauge", description: "Data source trust levels" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Navigation", href: "/admin/nav", icon: "compass", description: "Sidebar navigation builder" },
      { label: "Equipment", href: "/admin/equipment", icon: "wrench", description: "Equipment types and tracking" },
      { label: "Departments", href: "/admin/departments", icon: "layers", description: "Internal teams and structure" },
    ],
  },
];

export default function SettingsHubPage() {
  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Settings</h1>
        <p className="text-muted">All configuration in one place</p>
      </div>

      <div style={{ display: "grid", gap: "2rem" }}>
        {SETTINGS_CATEGORIES.map((category) => (
          <section key={category.title}>
            <h2 style={{ fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", fontSize: "0.8rem" }}>
              {category.title}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
              {category.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="card card-elevated"
                  style={{
                    padding: "1rem",
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "flex-start",
                    textDecoration: "none",
                    color: "inherit",
                    transition: "transform 0.15s, box-shadow 0.15s",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "var(--shadow-md)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "";
                  }}
                >
                  <div style={{ color: "var(--primary)", flexShrink: 0, marginTop: "2px" }}>
                    <Icon name={item.icon} size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>{item.label}</h3>
                    <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>{item.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
