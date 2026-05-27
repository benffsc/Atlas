"use client";

/**
 * DemoPlaceCard — fabricated place detail card for the screensaver tour.
 *
 * Renders instantly (no API call). Shows polished demo data with:
 * - Neighborhood-level location (no street numbers)
 * - Cat breed/weight/microchip (last 3 digits masked)
 * - Disease status visible (not PII)
 * - Alteration rate that makes sense
 *
 * LABELED: This is demo/showcase data only.
 */

export interface DemoPlace {
  name: string;
  neighborhood: string;
  catCount: number;
  alteredCount: number;
  people: number;
  requests: number;
  lastActive: string;
  cats: Array<{
    name: string;
    breed: string;
    sex: string;
    weight: string;
    microchip: string;
    altered: boolean;
    disease?: string;
    present: boolean;
  }>;
}

// ── Fabricated demo places ──

export const DEMO_PLACES: Record<string, DemoPlace> = {
  countyOverview: {
    name: "Colony Site",
    neighborhood: "Selvage Road area, Santa Rosa",
    catCount: 24,
    alteredCount: 17,
    people: 3,
    requests: 1,
    lastActive: "2w ago",
    cats: [
      { name: "Shadow", breed: "DSH Black", sex: "M", weight: "9.2 lbs", microchip: "985***********214", altered: true, present: true },
      { name: "Patches", breed: "DSH Calico", sex: "F", weight: "7.8 lbs", microchip: "985***********087", altered: true, present: true },
      { name: "Smokey", breed: "DMH Gray Tabby", sex: "M", weight: "10.1 lbs", microchip: "985***********341", altered: true, present: true },
      { name: "Mama Cat", breed: "DSH Orange Tabby", sex: "F", weight: "8.4 lbs", microchip: "985***********156", altered: true, present: true },
      { name: "Tux", breed: "DSH Tuxedo", sex: "M", weight: "11.3 lbs", microchip: "985***********492", altered: false, present: true },
      { name: "Ghost", breed: "DSH White", sex: "F", weight: "6.9 lbs", microchip: "—", altered: false, present: true },
    ],
  },
  corridor: {
    name: "Corridor Hub",
    neighborhood: "Montecito Ave area, Santa Rosa",
    catCount: 17,
    alteredCount: 14,
    people: 4,
    requests: 1,
    lastActive: "3d ago",
    cats: [
      { name: "Oreo", breed: "DSH Tuxedo", sex: "M", weight: "10.5 lbs", microchip: "985***********718", altered: true, present: true },
      { name: "Ginger", breed: "DSH Orange", sex: "F", weight: "7.2 lbs", microchip: "985***********203", altered: true, present: true },
      { name: "Mittens", breed: "DSH Gray/White", sex: "F", weight: "8.1 lbs", microchip: "985***********445", altered: true, present: true },
      { name: "Bandit", breed: "DMH Brown Tabby", sex: "M", weight: "12.0 lbs", microchip: "985***********661", altered: true, present: true },
      { name: "Luna", breed: "DSH Black", sex: "F", weight: "6.5 lbs", microchip: "—", altered: false, present: true },
    ],
  },
  disease: {
    name: "Monitoring Site",
    neighborhood: "Fulton Road area, Fulton",
    catCount: 12,
    alteredCount: 9,
    people: 2,
    requests: 0,
    lastActive: "1mo ago",
    cats: [
      { name: "Felix", breed: "DSH Black/White", sex: "M", weight: "9.8 lbs", microchip: "985***********127", altered: true, disease: "FIV+", present: true },
      { name: "Whiskers", breed: "DSH Brown Tabby", sex: "M", weight: "11.2 lbs", microchip: "985***********384", altered: true, present: true },
      { name: "Bella", breed: "DSH Tortoiseshell", sex: "F", weight: "7.4 lbs", microchip: "985***********509", altered: true, disease: "FeLV+", present: true },
      { name: "Dusty", breed: "DMH Gray", sex: "M", weight: "10.0 lbs", microchip: "985***********275", altered: true, present: true },
      { name: "Noodle", breed: "DSH Orange Tabby", sex: "F", weight: "6.8 lbs", microchip: "—", altered: false, present: true },
    ],
  },
};

// ── Component ──

interface DemoPlaceCardProps {
  place: DemoPlace;
  onClose: () => void;
}

const STATUS_DOT = { altered: "#16a34a", intact: "#dc2626", disease: "#d97706" };

export function DemoPlaceCard({ place, onClose }: DemoPlaceCardProps) {
  const altPct = Math.round((place.alteredCount / place.catCount) * 100);
  const altColor = altPct >= 75 ? "#16a34a" : altPct >= 50 ? "#d97706" : "#dc2626";

  return (
    <div className="demo-place-card">
      {/* Header */}
      <div className="demo-place-card__header">
        <div>
          <div className="demo-place-card__name">{place.name}</div>
          <div className="demo-place-card__neighborhood">{place.neighborhood}</div>
        </div>
        <button onClick={onClose} className="demo-place-card__close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* FFR Progress — the hero stat */}
      <div className="demo-place-card__ffr">
        <div className="demo-place-card__ffr-label">FFR Progress</div>
        <div className="demo-place-card__ffr-pct" style={{ color: altColor }}>{altPct}%</div>
        <div className="demo-place-card__ffr-detail">
          {place.alteredCount} of {place.catCount} altered
        </div>
        <div className="demo-place-card__ffr-bar">
          <div style={{ width: `${altPct}%`, background: altColor }} />
        </div>
      </div>

      {/* Quick stats */}
      <div className="demo-place-card__stats">
        <div className="demo-place-card__stat">
          <span className="demo-place-card__stat-value">{place.catCount}</span>
          <span className="demo-place-card__stat-label">Present</span>
        </div>
        <div className="demo-place-card__stat">
          <span className="demo-place-card__stat-value">{place.people}</span>
          <span className="demo-place-card__stat-label">People</span>
        </div>
        <div className="demo-place-card__stat">
          <span className="demo-place-card__stat-value">{place.requests}</span>
          <span className="demo-place-card__stat-label">Requests</span>
        </div>
        <div className="demo-place-card__stat">
          <span className="demo-place-card__stat-value">{place.lastActive}</span>
          <span className="demo-place-card__stat-label">Last Active</span>
        </div>
      </div>

      {/* Cat list */}
      <div className="demo-place-card__cats">
        <div className="demo-place-card__cats-header">
          Cat Presence ({place.cats.length} shown)
        </div>
        {place.cats.map((cat, i) => (
          <div key={i} className="demo-place-card__cat">
            <span
              className="demo-place-card__cat-dot"
              style={{ background: cat.disease ? STATUS_DOT.disease : cat.altered ? STATUS_DOT.altered : STATUS_DOT.intact }}
              title={cat.disease || (cat.altered ? "Altered" : "Intact")}
            />
            <div className="demo-place-card__cat-info">
              <span className="demo-place-card__cat-name">{cat.name}</span>
              <span className="demo-place-card__cat-detail">
                {cat.breed} · {cat.sex} · {cat.weight}
                {cat.microchip !== "—" && <> · <span style={{ fontFamily: "monospace", fontSize: "0.85em" }}>{cat.microchip}</span></>}
              </span>
            </div>
            <div className="demo-place-card__cat-badges">
              {cat.disease && (
                <span className="demo-place-card__badge demo-place-card__badge--disease">{cat.disease}</span>
              )}
              <span className={`demo-place-card__badge ${cat.altered ? "demo-place-card__badge--altered" : "demo-place-card__badge--intact"}`}>
                {cat.altered ? "Altered" : "Intact"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
