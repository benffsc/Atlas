"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const CAPABILITIES = [
  { value: "trapping", label: "Trapping", desc: "Set traps, handle cats, transport to clinic" },
  { value: "transport", label: "Transport", desc: "Pick up/drop off trapped cats" },
  { value: "recon", label: "Recon / Scouting", desc: "Scout locations, count cats, report back" },
  { value: "colony_care", label: "Colony Care", desc: "Ongoing feeding, monitoring, newcomer detection" },
  { value: "mentoring", label: "Mentoring", desc: "Shadow new trappers, teach field skills" },
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const EXPERIENCE_OPTIONS = [
  { value: "none", label: "No prior experience" },
  { value: "some", label: "Some experience (helped with a few trappings)" },
  { value: "experienced", label: "Experienced (regular trapping)" },
];

interface TrapperData {
  first_name: string;
  last_name: string;
  survey_completed_at: string | null;
  capabilities: string[];
  availability_notes: string | null;
  geographic_range: string | null;
  has_own_traps: boolean;
  has_vehicle: boolean;
  trapping_experience: string | null;
  languages_spoken: string[] | null;
}

export default function TrapperSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [trapper, setTrapper] = useState<TrapperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [timePreference, setTimePreference] = useState("");
  const [geographicRange, setGeographicRange] = useState("");
  const [hasOwnTraps, setHasOwnTraps] = useState(false);
  const [hasVehicle, setHasVehicle] = useState(false);
  const [experience, setExperience] = useState("");
  const [languages, setLanguages] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  useEffect(() => {
    fetch(`/api/trapper-survey/${token}`)
      .then((res) => res.json())
      .then((raw) => {
        const data = raw?.data || raw;
        if (data?.trapper) {
          const t = data.trapper;
          setTrapper(t);
          // Pre-fill if they've already completed it
          if (t.capabilities?.length) setCapabilities(t.capabilities);
          if (t.has_own_traps) setHasOwnTraps(true);
          if (t.has_vehicle) setHasVehicle(true);
          if (t.geographic_range) setGeographicRange(t.geographic_range);
          if (t.trapping_experience) setExperience(t.trapping_experience);
          if (t.availability_notes) {
            // Try to parse days from notes
            setTimePreference(t.availability_notes);
          }
          if (t.languages_spoken?.length) setLanguages(t.languages_spoken.join(", "));
          if (t.survey_completed_at) setSubmitted(true);
        } else {
          setError("Survey link not found or expired.");
        }
      })
      .catch(() => setError("Unable to load survey. Please try again later."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (capabilities.length === 0) {
      setError("Please select at least one capability.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const availabilityParts: string[] = [];
    if (selectedDays.length > 0) availabilityParts.push(`Days: ${selectedDays.join(", ")}`);
    if (timePreference) availabilityParts.push(timePreference);
    const availabilityNotes = availabilityParts.join(". ") || null;

    const langArray = languages
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/trapper-survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilities,
          availability_notes: availabilityNotes,
          geographic_range: geographicRange || null,
          has_own_traps: hasOwnTraps,
          has_vehicle: hasVehicle,
          trapping_experience: experience || null,
          languages_spoken: langArray.length > 0 ? langArray : null,
          additional_notes: additionalNotes || null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(data?.error?.message || data?.error || "Submission failed");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={{ textAlign: "center", color: "var(--text-secondary)" }}>Loading survey...</p>
        </div>
      </div>
    );
  }

  if (error && !trapper) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Survey Not Found</h1>
          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: "center" }}>
            <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, height: "auto", marginBottom: "1rem" }} />
            <h1 style={styles.title}>Thank you, {trapper?.first_name}!</h1>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", lineHeight: 1.6 }}>
              Your trapper profile has been updated. We&apos;ll use this info to match you with
              trapping opportunities in your area.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <img src="/beacon-logo.jpeg" alt="Beacon" style={{ width: 160, height: "auto", marginBottom: "0.75rem" }} />
          <h1 style={styles.title}>Trapper Capabilities Survey</h1>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            Hi {trapper?.first_name} — help us understand how you can help!
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Capabilities */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>What can you help with? *</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {CAPABILITIES.map((cap) => (
                <label
                  key={cap.value}
                  style={{
                    ...styles.checkboxLabel,
                    background: capabilities.includes(cap.value) ? "var(--info-bg, #cce5ff)" : "var(--card-bg, #f8f9fa)",
                    borderColor: capabilities.includes(cap.value) ? "var(--info-border, #0d6efd)" : "var(--border, #e5e5e5)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={capabilities.includes(cap.value)}
                    onChange={() => toggleCapability(cap.value)}
                    style={{ marginRight: "0.75rem", width: 18, height: 18 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{cap.label}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2 }}>{cap.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Availability */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Availability</legend>
            <label style={styles.label}>Days you&apos;re typically available</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: "1px solid var(--border)",
                    background: selectedDays.includes(day) ? "var(--primary)" : "var(--card-bg, #f8f9fa)",
                    color: selectedDays.includes(day) ? "#fff" : "var(--foreground)",
                    fontSize: "0.85rem",
                    fontWeight: selectedDays.includes(day) ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
            <label style={styles.label}>Time preference or other scheduling notes</label>
            <input
              type="text"
              value={timePreference}
              onChange={(e) => setTimePreference(e.target.value)}
              placeholder="e.g., Mornings only, available for Monday clinics"
              style={styles.input}
            />
          </fieldset>

          {/* Geographic Range */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Area you can cover</legend>
            <input
              type="text"
              value={geographicRange}
              onChange={(e) => setGeographicRange(e.target.value)}
              placeholder="e.g., Windsor, West Sonoma County, Petaluma area"
              style={styles.input}
            />
          </fieldset>

          {/* Equipment */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Equipment & Transport</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={styles.toggleLabel}>
                <input type="checkbox" checked={hasOwnTraps} onChange={(e) => setHasOwnTraps(e.target.checked)} style={{ width: 18, height: 18, marginRight: "0.75rem" }} />
                I have my own traps
              </label>
              <label style={styles.toggleLabel}>
                <input type="checkbox" checked={hasVehicle} onChange={(e) => setHasVehicle(e.target.checked)} style={{ width: 18, height: 18, marginRight: "0.75rem" }} />
                I have a vehicle that can transport traps
              </label>
            </div>
          </fieldset>

          {/* Experience */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Trapping experience</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {EXPERIENCE_OPTIONS.map((opt) => (
                <label key={opt.value} style={styles.toggleLabel}>
                  <input
                    type="radio"
                    name="experience"
                    value={opt.value}
                    checked={experience === opt.value}
                    onChange={(e) => setExperience(e.target.value)}
                    style={{ width: 18, height: 18, marginRight: "0.75rem" }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Languages */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Languages spoken</legend>
            <input
              type="text"
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              placeholder="e.g., English, Spanish"
              style={styles.input}
            />
          </fieldset>

          {/* Additional Notes */}
          <fieldset style={styles.fieldset}>
            <legend style={styles.legend}>Anything else?</legend>
            <textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Anything else we should know about your availability, preferences, or experience..."
              rows={3}
              style={{ ...styles.input, resize: "vertical" }}
            />
          </fieldset>

          {error && (
            <div style={{ padding: "0.75rem 1rem", background: "var(--danger-bg)", color: "var(--danger-text)", borderRadius: 8, marginBottom: "1rem", fontSize: "0.9rem" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "0.875rem",
              background: submitting ? "var(--text-secondary)" : "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: "1rem",
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit Survey"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "2rem 1rem",
    background: "radial-gradient(ellipse at top, rgba(66, 145, 223, 0.08) 0%, var(--background, #fff) 55%)",
  },
  card: {
    width: "100%",
    maxWidth: 540,
    background: "var(--background, #fff)",
    border: "1px solid var(--border, #e5e5e5)",
    borderRadius: 12,
    padding: "2rem",
  },
  title: {
    fontSize: "1.35rem",
    fontWeight: 700,
    margin: 0,
    color: "var(--text-primary, #111)",
  },
  fieldset: {
    border: "none",
    padding: 0,
    margin: "0 0 1.5rem 0",
  },
  legend: {
    fontSize: "0.95rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
    color: "var(--text-primary, #111)",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 500,
    marginBottom: "0.5rem",
    color: "var(--text-secondary, #6b7280)",
  },
  input: {
    width: "100%",
    padding: "0.75rem 1rem",
    border: "1px solid var(--border, #e5e5e5)",
    borderRadius: 8,
    fontSize: "0.95rem",
    background: "var(--background, #fff)",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "flex-start",
    padding: "0.75rem 1rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
};
