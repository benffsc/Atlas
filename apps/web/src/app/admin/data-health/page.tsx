"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

interface HealthCategory {
  title: string;
  items: { label: string; href: string; icon: string; description: string }[];
}

const DATA_HEALTH_CATEGORIES: HealthCategory[] = [
  {
    title: "Deduplication",
    items: [
      { label: "Person Dedup", href: "/admin/person-dedup", icon: "users", description: "Merge duplicate person records" },
      { label: "Cat Dedup", href: "/admin/cat-dedup", icon: "cat", description: "Merge duplicate cat records" },
      { label: "Place Dedup", href: "/admin/place-dedup", icon: "map-pin", description: "Merge duplicate place records" },
      { label: "Address Dedup", href: "/admin/address-dedup", icon: "crosshair", description: "Merge duplicate addresses" },
      { label: "Request Dedup", href: "/admin/request-dedup", icon: "clipboard-list", description: "Merge duplicate requests" },
    ],
  },
  {
    title: "Review Queues",
    items: [
      { label: "Merge Review", href: "/admin/merge-review", icon: "git-merge", description: "Approve or reject pending merges" },
      { label: "Needs Review", href: "/admin/needs-review", icon: "eye", description: "Records flagged for manual review" },
      { label: "Owner Changes", href: "/admin/owner-changes", icon: "pencil", description: "Review owner info changes" },
      { label: "Cat Presence Review", href: "/admin/cat-presence-review", icon: "cat", description: "Verify cat-place associations" },
      { label: "Classification Review", href: "/admin/classification-review", icon: "tag", description: "Review name classifications" },
    ],
  },
  {
    title: "Quality & Health",
    items: [
      { label: "Data Quality", href: "/admin/data-quality", icon: "activity", description: "Overall data quality metrics" },
      { label: "Identity Health", href: "/admin/identity-health", icon: "shield-check", description: "Identity resolution coverage" },
      { label: "Anomalies", href: "/admin/anomalies", icon: "alert-triangle", description: "Outliers and unusual patterns" },
      { label: "Classification Clusters", href: "/admin/classification-clusters", icon: "layers", description: "Name classification groupings" },
    ],
  },
  {
    title: "Data Engine",
    items: [
      { label: "Dashboard", href: "/admin/data-engine", icon: "database-zap", description: "Data engine overview and status" },
      { label: "Households", href: "/admin/data-engine/households", icon: "home", description: "Household detection and grouping" },
      { label: "Processors", href: "/admin/data-engine/processors", icon: "zap", description: "Processing pipeline status" },
    ],
  },
  {
    title: "Maintenance",
    items: [
      { label: "Orphan Places", href: "/admin/orphan-places", icon: "map-pin", description: "Places with no linked entities" },
      { label: "Trapper Linking", href: "/admin/trapper-linking", icon: "snail", description: "Fix trapper-appointment links" },
      { label: "Data Improvements", href: "/admin/data-improvements", icon: "trending-up", description: "Suggested data corrections" },
      { label: "AI Extraction", href: "/admin/ai-extraction", icon: "flask-conical", description: "AI-parsed data review" },
    ],
  },
];

export default function DataHealthHubPage() {
  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Data Health</h1>
        <p className="text-muted">Deduplication, quality review, and data maintenance tools</p>
      </div>

      <div style={{ display: "grid", gap: "2rem" }}>
        {DATA_HEALTH_CATEGORIES.map((category) => (
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
