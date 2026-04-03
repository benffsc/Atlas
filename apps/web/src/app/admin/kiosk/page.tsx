"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { useAppConfig, useAllConfigs } from "@/hooks/useAppConfig";
import { postApi, fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { KioskDailyStatsRow } from "@/lib/types/view-contracts";
import {
  DEFAULT_TIPPY_TREE,
  getNodes,
  getScoring,
  type TippyTree,
  type TippyNode,
} from "@/lib/tippy-tree";
import {
  CLINIC_CAT_TREE,
  CLINIC_SCORING_CONFIG,
} from "@/lib/clinic-cat-tree";

export default function AdminKioskPage() {
  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
        Kiosk Configuration
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 2rem" }}>
        Configure modules, session timeouts, staff picker, and the help form question set.
      </p>
      <LiveStatusSection />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <LobbyPathsConfig />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <ClinicFlowSettings />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <CheckoutDefaultsConfig />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <StaffPickerConfig />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <TippyTreePreview />
      <hr style={{ border: "none", borderTop: "1px solid var(--card-border)", margin: "2rem 0" }} />
      <ClinicTreePreview />
    </div>
  );
}

// ── Live Status Section (FFS-1056) ───────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function LiveStatusSection() {
  const { data } = useSWR<KioskDailyStatsRow>(
    "/api/equipment/stats/today",
    (url: string) => fetchApi<KioskDailyStatsRow>(url),
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );

  if (!data) return null;

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.75rem" }}>
        <Icon name="activity" size={18} color="var(--primary)" /> Today&apos;s Activity
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <StatCard label="Checkouts" value={data.checkouts_today} valueColor="var(--warning-text)" />
        <StatCard label="Check-ins" value={data.checkins_today} valueColor="var(--success-text)" />
        <StatCard label="Deposits" value={data.deposits_today} valueColor="var(--info-text)" />
        <StatCard
          label="Overdue"
          value={data.overdue_count}
          valueColor={data.overdue_count > 0 ? "var(--danger-text)" : "var(--muted)"}
        />
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "var(--muted)", flexWrap: "wrap" }}>
        {data.last_activity_at && (
          <span>Last activity: <strong style={{ color: "var(--text-secondary)" }}>{timeAgo(data.last_activity_at)}</strong></span>
        )}
        {data.active_staff_today.length > 0 && (
          <span>
            Staff today:{" "}
            <strong style={{ color: "var(--text-secondary)" }}>
              {data.active_staff_today.join(", ")}
            </strong>
          </span>
        )}
        {!data.last_activity_at && data.active_staff_today.length === 0 && (
          <span>No kiosk activity recorded today.</span>
        )}
      </div>
    </div>
  );
}

// ── Checkout Defaults Config (FFS-1057) ──────────────────────────────────────

function CheckoutDefaultsConfig() {
  const { mutate } = useAllConfigs();
  const { value: depositPresets } = useAppConfig<number[]>("kiosk.deposit_presets");
  const { value: purposeOffsets } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");
  const { value: countdownSecs } = useAppConfig<number>("kiosk.inactivity_countdown");
  const { success: showSuccess, error: showError } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      setSaving(key);
      try {
        await postApi("/api/admin/config", { key, value }, { method: "PUT" });
        await mutate();
        showSuccess(`Updated ${key}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [mutate, showSuccess, showError],
  );

  const [depositDraft, setDepositDraft] = useState("");
  const [editingDeposit, setEditingDeposit] = useState(false);

  // Initialize draft when data loads
  useEffect(() => {
    if (depositPresets) setDepositDraft(depositPresets.join(", "));
  }, [depositPresets]);

  const saveDeposit = () => {
    const parsed = depositDraft.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n >= 0);
    if (parsed.length === 0) {
      showError("Enter at least one valid deposit amount");
      return;
    }
    saveKey("kiosk.deposit_presets", parsed);
    setEditingDeposit(false);
  };

  const PURPOSE_LABELS: Record<string, string> = {
    tnr_appointment: "TNR Appointment",
    kitten_rescue: "Kitten Rescue",
    colony_check: "Colony Check",
    feeding_station: "Feeding Station",
    personal_pet: "Personal Pet",
    ffr: "Find Fix Return",
    well_check: "Well Check",
    rescue_recovery: "Rescue/Recovery",
    trap_training: "Trap Training",
    transport: "Transport",
  };

  return (
    <div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 1rem" }}>Checkout Defaults</h2>

      {/* Deposit Presets */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label style={smallLabelStyle}>Deposit Presets ($)</label>
        {editingDeposit ? (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={depositDraft}
              onChange={(e) => setDepositDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDeposit();
                if (e.key === "Escape") setEditingDeposit(false);
              }}
              placeholder="0, 50, 75"
              autoFocus
              style={{
                flex: 1, padding: "0.5rem 0.75rem", border: "1px solid var(--primary)",
                borderRadius: 8, fontSize: "0.9rem", outline: "none", background: "var(--card-bg)",
              }}
            />
            <Button variant="primary" size="sm" loading={saving === "kiosk.deposit_presets"} onClick={saveDeposit}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingDeposit(false)}>Cancel</Button>
          </div>
        ) : (
          <div
            onClick={() => setEditingDeposit(true)}
            style={{
              padding: "0.5rem 0.75rem", background: "var(--card-bg)", border: "1px solid var(--card-border)",
              borderRadius: 8, fontSize: "0.9rem", cursor: "pointer", display: "flex", alignItems: "center",
            }}
          >
            {depositPresets?.map((v) => `$${v}`).join(", ") || "Click to edit"}
          </div>
        )}
      </div>

      {/* Due Date Offsets */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label style={smallLabelStyle}>Due Date Offsets (days by purpose)</label>
        <div style={{
          background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, overflow: "hidden",
        }}>
          {purposeOffsets && Object.entries(purposeOffsets).map(([purpose, days]) => (
            <div
              key={purpose}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border-light, #f0f0f0)",
              }}
            >
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                {PURPOSE_LABELS[purpose] || purpose}
              </span>
              <input
                type="number"
                value={days}
                onChange={(e) => {
                  const newVal = Number(e.target.value) || 0;
                  saveKey("kiosk.purpose_due_offsets", { ...purposeOffsets, [purpose]: newVal });
                }}
                min={1}
                style={{
                  width: 60, padding: "0.25rem 0.5rem", textAlign: "center",
                  border: "1px solid var(--card-border)", borderRadius: 4, fontSize: "0.85rem",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Inactivity Countdown */}
      <InlineEditField
        label="Inactivity Countdown (seconds)"
        value={String(countdownSecs)}
        onSave={(v) => saveKey("kiosk.inactivity_countdown", Number(v))}
        saving={saving === "kiosk.inactivity_countdown"}
        type="number"
      />
    </div>
  );
}

// ── Lobby Paths Config ────────────────────────────────────────────────────────

const LOBBY_MODULES = [
  { id: "clinic", label: "Spay / Neuter Clinic", icon: "scissors", subtitle: "Free surgery for community cats", configKey: null, primary: true },
  { id: "volunteer", label: "Volunteering", icon: "users", subtitle: "Join our volunteer team", configKey: "kiosk.volunteer_qr_url" },
  { id: "barn_cat", label: "Barn Cat Program", icon: "warehouse", subtitle: "Adopt a working cat", configKey: "kiosk.barn_cat_qr_url" },
  { id: "adopt", label: "Adopt a Cat", icon: "heart", subtitle: "Find your new friend", configKey: "kiosk.adopt_qr_url" },
  { id: "rehome", label: "Rehome a Cat", icon: "home", subtitle: "Resources for rehoming", configKey: "kiosk.rehome_url" },
];

function LobbyPathsConfig() {
  const { mutate } = useAllConfigs();
  const { value: splashTitle } = useAppConfig<string>("kiosk.splash_title");
  const { value: splashSubtitle } = useAppConfig<string>("kiosk.splash_subtitle");
  const { value: publicTimeout } = useAppConfig<number>("kiosk.session_timeout_public");
  const { value: equipmentTimeout } = useAppConfig<number>("kiosk.session_timeout_equipment");
  const { value: volunteerUrl } = useAppConfig<string>("kiosk.volunteer_qr_url");
  const { value: barnCatUrl } = useAppConfig<string>("kiosk.barn_cat_qr_url");
  const { value: adoptUrl } = useAppConfig<string>("kiosk.adopt_qr_url");
  const { value: rehomeUrl } = useAppConfig<string>("kiosk.rehome_url");
  const { success: showSuccess, error: showError } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const qrUrls: Record<string, string> = {
    "kiosk.volunteer_qr_url": volunteerUrl || "",
    "kiosk.barn_cat_qr_url": barnCatUrl || "",
    "kiosk.adopt_qr_url": adoptUrl || "",
    "kiosk.rehome_url": rehomeUrl || "",
  };

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      setSaving(key);
      try {
        await postApi("/api/admin/config", { key, value }, { method: "PUT" });
        await mutate();
        showSuccess(`Updated ${key}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [mutate, showSuccess, showError],
  );

  return (
    <div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
        Lobby Paths
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        The 5-card digital lobby shown on the kiosk splash screen.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {LOBBY_MODULES.map((mod) => (
          <div
            key={mod.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--card-bg)",
              border: mod.primary ? "2px solid var(--primary)" : "1px solid var(--card-border)",
              borderRadius: 10,
            }}
          >
            <Icon name={mod.icon} size={20} color={mod.primary ? "var(--primary)" : "var(--text-secondary)"} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {mod.label}
                {mod.primary && (
                  <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--primary)", marginLeft: "0.5rem", textTransform: "uppercase" }}>
                    PRIMARY
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{mod.subtitle}</div>
            </div>
            {mod.configKey && (
              <span style={{ fontSize: "0.7rem", color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {qrUrls[mod.configKey] || "No URL set"}
              </span>
            )}
            {!mod.configKey && (
              <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>→ /kiosk/clinic</span>
            )}
          </div>
        ))}
      </div>

      {/* QR/URL configuration */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {LOBBY_MODULES.filter((m) => m.configKey).map((mod) => (
          <InlineEditField
            key={mod.id}
            label={`${mod.label} URL`}
            value={qrUrls[mod.configKey!] || ""}
            onSave={(v) => saveKey(mod.configKey!, v)}
            saving={saving === mod.configKey}
          />
        ))}
      </div>

      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 1rem" }}>Settings</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <InlineEditField
          label="Public Timeout (seconds)"
          value={String(publicTimeout)}
          onSave={(v) => saveKey("kiosk.session_timeout_public", Number(v))}
          saving={saving === "kiosk.session_timeout_public"}
          type="number"
        />
        <InlineEditField
          label="Equipment Timeout (seconds)"
          value={String(equipmentTimeout)}
          onSave={(v) => saveKey("kiosk.session_timeout_equipment", Number(v))}
          saving={saving === "kiosk.session_timeout_equipment"}
          type="number"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <InlineEditField
          label="Splash Title"
          value={splashTitle}
          onSave={(v) => saveKey("kiosk.splash_title", v)}
          saving={saving === "kiosk.splash_title"}
        />
        <InlineEditField
          label="Splash Subtitle"
          value={splashSubtitle}
          onSave={(v) => saveKey("kiosk.splash_subtitle", v)}
          saving={saving === "kiosk.splash_subtitle"}
        />
      </div>
    </div>
  );
}

// ── Clinic Flow Settings ──────────────────────────────────────────────────────

function ClinicFlowSettings() {
  const { mutate } = useAllConfigs();
  const { value: clinicEnabled } = useAppConfig<boolean>("kiosk.clinic_enabled");
  const { value: missionHeadline } = useAppConfig<string>("kiosk.mission_headline");
  const { value: petRedirectMsg } = useAppConfig<string>("kiosk.pet_redirect_message");
  const { value: clinicSuccessMsg } = useAppConfig<string>("kiosk.clinic_success_message");
  const { value: trapperWaitMsg } = useAppConfig<string>("kiosk.trapper_wait_message");
  const { value: welcomeBackEnabled } = useAppConfig<boolean>("kiosk.welcome_back_enabled");
  const { success: showSuccess, error: showError } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const saveKey = useCallback(
    async (key: string, value: unknown) => {
      setSaving(key);
      try {
        await postApi("/api/admin/config", { key, value }, { method: "PUT" });
        await mutate();
        showSuccess(`Updated ${key}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [mutate, showSuccess, showError],
  );

  return (
    <div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
        Clinic Flow Settings
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        Configure messaging and behavior for the clinic lobby kiosk path.
      </p>

      {/* Toggles */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 10,
            cursor: "pointer",
            opacity: saving === "kiosk.clinic_enabled" ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={clinicEnabled || false}
            onChange={() => saveKey("kiosk.clinic_enabled", !clinicEnabled)}
            disabled={saving === "kiosk.clinic_enabled"}
            style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
          />
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>Clinic path enabled</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Shows the &quot;Spay / Neuter Clinic&quot; card on the lobby screen
            </div>
          </div>
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 10,
            cursor: "pointer",
            opacity: saving === "kiosk.welcome_back_enabled" ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={welcomeBackEnabled || false}
            onChange={() => saveKey("kiosk.welcome_back_enabled", !welcomeBackEnabled)}
            disabled={saving === "kiosk.welcome_back_enabled"}
            style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
          />
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>Welcome back screen</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Shows personalized greeting when a known contact checks in again
            </div>
          </div>
        </label>
      </div>

      {/* Editable messages */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <InlineEditField
          label="Mission Headline"
          value={missionHeadline}
          onSave={(v) => saveKey("kiosk.mission_headline", v)}
          saving={saving === "kiosk.mission_headline"}
        />
        <InlineEditField
          label="Pet Redirect Message"
          value={petRedirectMsg}
          onSave={(v) => saveKey("kiosk.pet_redirect_message", v)}
          saving={saving === "kiosk.pet_redirect_message"}
        />
        <InlineEditField
          label="Clinic Success Message"
          value={clinicSuccessMsg}
          onSave={(v) => saveKey("kiosk.clinic_success_message", v)}
          saving={saving === "kiosk.clinic_success_message"}
        />
        <InlineEditField
          label="Trapper Wait Message"
          value={trapperWaitMsg}
          onSave={(v) => saveKey("kiosk.trapper_wait_message", v)}
          saving={saving === "kiosk.trapper_wait_message"}
        />
      </div>
    </div>
  );
}

// ── Staff Picker Config ───────────────────────────────────────────────────────

interface StaffRow {
  staff_id: string;
  first_name: string;
  last_name: string | null;
  display_name: string;
  department: string | null;
  role: string | null;
  is_active: boolean;
  show_in_kiosk?: boolean;
}

function StaffPickerConfig() {
  const { success: showSuccess, error: showError } = useToast();
  const { mutate } = useAllConfigs();
  const { value: required } = useAppConfig<boolean>("kiosk.staff_selection_required");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [savingRequired, setSavingRequired] = useState(false);

  useEffect(() => {
    fetchApi<{ staff: StaffRow[] }>("/api/staff?active=true")
      .then((data) => {
        setStaff(data.staff || []);
      })
      .catch(() => setStaff([]))
      .finally(() => setLoading(false));
  }, []);

  const toggleKiosk = useCallback(
    async (staffId: string, current: boolean) => {
      setToggling(staffId);
      try {
        await postApi(`/api/admin/staff/${staffId}`, { show_in_kiosk: !current }, { method: "PUT" });
        setStaff((prev) =>
          prev.map((s) =>
            s.staff_id === staffId ? { ...s, show_in_kiosk: !current } : s
          )
        );
        showSuccess(`Updated kiosk visibility`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setToggling(null);
      }
    },
    [showSuccess, showError]
  );

  const toggleRequired = useCallback(async () => {
    setSavingRequired(true);
    try {
      await postApi("/api/admin/config", { key: "kiosk.staff_selection_required", value: !required }, { method: "PUT" });
      await mutate();
      showSuccess(
        !required ? "Staff selection is now required" : "Staff selection is now optional"
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingRequired(false);
    }
  }, [required, mutate, showSuccess, showError]);

  const enabledCount = staff.filter((s) => s.show_in_kiosk).length;

  return (
    <div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
        Staff Picker
      </h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
        Select which staff appear in the kiosk &quot;Who&apos;s at the desk?&quot; picker.
        {enabledCount > 0 && (
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
            {" "}{enabledCount} staff enabled.
          </span>
        )}
      </p>

      {/* Require toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 10,
          cursor: "pointer",
          marginBottom: "1rem",
          opacity: savingRequired ? 0.6 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={required || false}
          onChange={toggleRequired}
          disabled={savingRequired}
          style={{ width: 18, height: 18, accentColor: "var(--primary)" }}
        />
        <div>
          <div style={{ fontWeight: 500, color: "var(--text-primary)", fontSize: "0.9rem" }}>
            Require staff selection
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            When enabled, hides the &quot;Skip&quot; option — every session must identify the staff member.
          </div>
        </div>
      </label>

      {/* Staff checklist */}
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "1rem 0" }}>
          Loading staff...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {staff.map((s) => (
            <label
              key={s.staff_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 1rem",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
                cursor: toggling === s.staff_id ? "wait" : "pointer",
                opacity: toggling === s.staff_id ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={s.show_in_kiosk || false}
                onChange={() => toggleKiosk(s.staff_id, s.show_in_kiosk || false)}
                disabled={toggling === s.staff_id}
                style={{ width: 16, height: 16, accentColor: "var(--primary)" }}
              />
              <span style={{ flex: 1, fontWeight: 500, fontSize: "0.9rem", color: "var(--text-primary)" }}>
                {s.display_name}
              </span>
              {s.department && (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {s.department}
                </span>
              )}
              {s.role && (
                <span style={{ fontSize: "0.7rem", color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.role}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline Edit Field ─────────────────────────────────────────────────────────

function InlineEditField({
  label,
  value,
  onSave,
  saving,
  type = "text",
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  saving: boolean;
  type?: "text" | "number";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </label>
      {editing ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onSave(draft); setEditing(false); }
              if (e.key === "Escape") { setDraft(value); setEditing(false); }
            }}
            autoFocus
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--primary)",
              borderRadius: 8,
              fontSize: "0.9rem",
              outline: "none",
              background: "var(--card-bg)",
            }}
          />
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={() => { onSave(draft); setEditing(false); }}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(false); }}>
            Cancel
          </Button>
        </div>
      ) : (
        <div
          onClick={() => { setDraft(value); setEditing(true); }}
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 8,
            fontSize: "0.9rem",
            cursor: "pointer",
            minHeight: 38,
            display: "flex",
            alignItems: "center",
          }}
        >
          {value || <span style={{ color: "var(--muted)" }}>Click to edit</span>}
        </div>
      )}
    </div>
  );
}

// ── Tippy Tree Preview ─────────────────────────────────────────────────────────

const OUTCOME_TYPE_LABELS: Record<string, string> = {
  ffsc_ffr: "FFR Intake",
  emergency_vet: "Emergency Vet",
  pet_spay_redirect: "Pet Redirect",
  kitten_intake: "Kitten Intake",
  general_info: "General Info",
  hybrid: "Hybrid (Pet + Intake)",
};

function TippyTreePreview() {
  const { value: customTree } = useAppConfig<TippyTree | null>("kiosk.help_tree");
  const tree = customTree && typeof customTree === "object"
    ? customTree
    : DEFAULT_TIPPY_TREE;

  const nodes = getNodes(tree);
  const scoring = getScoring(tree);
  const nodeCount = Object.keys(nodes).length;
  const outcomeNodes = Object.values(nodes).filter((n) => n.outcome);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
          Tippy Decision Tree ({nodeCount} nodes)
        </h2>
        <a
          href="/kiosk/help"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          Preview as User →
        </a>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        The branching decision tree that guides kiosk visitors to the right outcome.
        Visual tree editor coming in a future update.
      </p>

      {/* Tree visualization */}
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: "1.5rem",
        }}
      >
        <TreeNode node={nodes["root"]} tree={nodes} depth={0} />
      </div>

      {/* Outcome summary */}
      <div
        style={{
          background: "var(--muted-bg, #f9fafb)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          <Icon name="target" size={16} color="var(--primary)" /> Outcomes ({outcomeNodes.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {outcomeNodes.map((node) => (
            <div
              key={node.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: node.outcome?.creates_intake ? "var(--success-text)" : "var(--warning-text)",
                  letterSpacing: "0.03em",
                  whiteSpace: "nowrap",
                }}
              >
                {node.outcome?.creates_intake ? "INTAKE" : "INFO ONLY"}
              </span>
              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 500 }}>
                {node.outcome?.headline}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                {OUTCOME_TYPE_LABELS[node.outcome?.type || ""] || node.outcome?.type}
                {" · "}
                {node.outcome?.resources.length} resource{node.outcome?.resources.length !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Scoring config summary */}
      <div
        style={{
          background: "var(--muted-bg, #f9fafb)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
          marginTop: "1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          <Icon name="calculator" size={16} color="var(--primary)" /> Scoring Rules ({scoring.scoring_rules.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8rem" }}>
          {scoring.scoring_rules.map((rule, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", color: "var(--text-secondary)" }}>
              <code style={{ fontWeight: 600, color: "var(--text-primary)", minWidth: 140 }}>{rule.tag}</code>
              <span>{rule.op === "truthy" ? "is truthy" : rule.op === "numeric" ? `× ${rule.points}` : `= ${rule.match?.join(" | ")}`}</span>
              <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--primary)" }}>+{rule.points}pts</span>
            </div>
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "1rem", marginBottom: "0.5rem" }}>
          Field Mappings ({scoring.field_mappings.length})
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.6 }}>
          {scoring.field_mappings.map((m) => `${m.tag} → tippy_${m.field}`).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function TreeNode({ node, tree, depth }: { node: TippyNode; tree: Record<string, TippyNode>; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.options.some((o) => o.next_node_id !== null);

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.625rem 1rem",
          paddingLeft: `${1 + depth * 1.25}rem`,
          cursor: "pointer",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
          background: depth === 0 ? "var(--muted-bg, #f9fafb)" : undefined,
        }}
      >
        {(hasChildren || node.outcome) && (
          <Icon
            name={expanded ? "chevron-down" : "chevron-right"}
            size={14}
            color="var(--muted)"
          />
        )}
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--muted)",
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}
        >
          {node.branch}
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
          {node.tippy_text}
        </span>
        {node.show_when && (
          <span
            style={{
              fontSize: "0.6rem",
              fontWeight: 600,
              padding: "0.1rem 0.3rem",
              borderRadius: 3,
              background: "var(--info-bg, rgba(59,130,246,0.08))",
              color: "var(--info-text, #2563eb)",
            }}
          >
            conditional
          </span>
        )}
        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
          {node.options.length} opt
        </span>
        {node.outcome && (
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              padding: "0.125rem 0.375rem",
              borderRadius: 4,
              background: node.outcome.creates_intake ? "var(--success-bg)" : "var(--warning-bg)",
              color: node.outcome.creates_intake ? "var(--success-text)" : "var(--warning-text)",
            }}
          >
            {OUTCOME_TYPE_LABELS[node.outcome.type] || node.outcome.type}
          </span>
        )}
      </div>

      {expanded && (
        <div>
          {node.options.map((opt) => (
            <div key={opt.value}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.375rem 1rem",
                  paddingLeft: `${1.75 + depth * 1.25}rem`,
                  fontSize: "0.8rem",
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--card-border, #f0f0f0)",
                  background: "var(--card-bg)",
                }}
              >
                <span style={{ color: "var(--muted)" }}>→</span>
                {opt.icon && <Icon name={opt.icon} size={14} color="var(--muted)" />}
                <span style={{ fontWeight: 500 }}>{opt.label}</span>
                <span style={{ display: "flex", gap: "0.375rem", marginLeft: "auto", alignItems: "center" }}>
                  {opt.tags && Object.keys(opt.tags).length > 0 && (
                    <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>
                      {Object.keys(opt.tags).length} tags
                    </span>
                  )}
                  {opt.next_node_id === null && (
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                      terminal
                    </span>
                  )}
                </span>
              </div>
              {opt.next_node_id && tree[opt.next_node_id] && (
                <TreeNode node={tree[opt.next_node_id]} tree={tree} depth={depth + 1} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Clinic Tree Preview ───────────────────────────────────────────────────────

const CLINIC_CLASSIFICATION_THRESHOLDS = [
  { label: "Pet Redirect", range: "net_score >= 7", color: "var(--warning-text)" },
  { label: "Ambiguous", range: "net_score >= 3", color: "var(--info-text, #2563eb)" },
  { label: "Community Cat", range: "net_score >= 0", color: "var(--success-text)" },
  { label: "Feral / Colony", range: "net_score < 0", color: "var(--danger-text)" },
];

function ClinicTreePreview() {
  const { value: customTree } = useAppConfig<TippyTree | null>("kiosk.clinic_tree");
  const tree = customTree && typeof customTree === "object"
    ? customTree
    : CLINIC_CAT_TREE;

  const nodes = getNodes(tree);
  const scoring = CLINIC_SCORING_CONFIG;
  const nodeCount = Object.keys(nodes).length;
  const outcomeNodes = Object.values(nodes).filter((n) => n.outcome);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
          Clinic Decision Tree ({nodeCount} nodes)
        </h2>
        <a
          href="/kiosk/clinic"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          Preview as User →
        </a>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
        The clinic lobby tree classifies cats as pet vs community via behavioral questions.
        Two paths: behavioral (1-5 cats) and colony (6+ cats).
      </p>

      {/* Tree visualization */}
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: "1.5rem",
        }}
      >
        <TreeNode node={nodes["clinic_root"]} tree={nodes} depth={0} />
      </div>

      {/* Outcomes */}
      <div
        style={{
          background: "var(--muted-bg, #f9fafb)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          <Icon name="target" size={16} color="var(--primary)" /> Outcomes ({outcomeNodes.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {outcomeNodes.map((node) => (
            <div
              key={node.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: node.outcome?.creates_intake ? "var(--success-text)" : "var(--warning-text)",
                  letterSpacing: "0.03em",
                  whiteSpace: "nowrap",
                }}
              >
                {node.outcome?.creates_intake ? "INTAKE" : "INFO ONLY"}
              </span>
              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 500 }}>
                {node.outcome?.headline}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                {OUTCOME_TYPE_LABELS[node.outcome?.type || ""] || node.outcome?.type}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Classification thresholds */}
      <div
        style={{
          background: "var(--muted-bg, #f9fafb)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          <Icon name="sliders" size={16} color="var(--primary)" /> Classification Thresholds
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8rem" }}>
          {CLINIC_CLASSIFICATION_THRESHOLDS.map((t) => (
            <div key={t.label} style={{ display: "flex", gap: "0.5rem", color: "var(--text-secondary)" }}>
              <span style={{ fontWeight: 600, color: t.color, minWidth: 120 }}>{t.label}</span>
              <code style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{t.range}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Scoring rules */}
      <div
        style={{
          background: "var(--muted-bg, #f9fafb)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          <Icon name="calculator" size={16} color="var(--primary)" /> Scoring Rules ({scoring.scoring_rules.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.8rem" }}>
          {scoring.scoring_rules.map((rule, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", color: "var(--text-secondary)" }}>
              <code style={{ fontWeight: 600, color: "var(--text-primary)", minWidth: 140 }}>{rule.tag}</code>
              <span>{rule.op === "truthy" ? "is truthy" : rule.op === "numeric" ? `× ${rule.points}` : `= ${rule.match?.join(" | ")}`}</span>
              <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--primary)" }}>+{rule.points}pts</span>
            </div>
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "1rem", marginBottom: "0.5rem" }}>
          Field Mappings ({scoring.field_mappings.length})
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.6 }}>
          {scoring.field_mappings.map((m) => `${m.tag} → tippy_${m.field}`).join(" · ")}
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const smallLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.25rem",
};

