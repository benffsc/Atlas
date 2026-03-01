"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  mapToPrimaryStatus,
  isTerminalStatus,
  type RequestStatus,
} from "@/lib/request-status";

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  variant: "primary" | "secondary" | "warning" | "success";
  tooltip?: string;
}

interface RequestState {
  status: string;
  priority: string;
  has_place: boolean;
  has_trappers: boolean;
  has_kittens: boolean;
  estimated_cat_count: number | null;
  source_system: string | null;
}

interface CatState {
  altered_status: string | null;
  has_microchip: boolean;
  has_owner: boolean;
  has_place: boolean;
}

interface PersonState {
  has_email: boolean;
  has_phone: boolean;
  is_trapper: boolean;
  cat_count: number;
  request_count: number;
}

interface PlaceState {
  has_coordinates: boolean;
  has_requests: boolean;
  cat_count: number;
  needs_observation: boolean;
  colony_estimate: number | null;
}

type EntityState = RequestState | CatState | PersonState | PlaceState;

interface QuickActionsProps {
  entityType: "request" | "cat" | "person" | "place";
  entityId: string;
  state: EntityState;
  onActionComplete?: () => void;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    background: "var(--primary)",
    color: "white",
    border: "1px solid var(--primary)",
  },
  secondary: {
    background: "var(--section-bg)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
  },
  warning: {
    background: "#ffc107",
    color: "#000",
    border: "1px solid #ffc107",
  },
  success: {
    background: "#198754",
    color: "white",
    border: "1px solid #198754",
  },
};

/**
 * Get quick actions for a request based on its current status.
 *
 * Uses the simplified 4-state system (MIG_2530):
 * - new: Awaiting initial review
 * - working: Actively being handled (combines legacy scheduled, in_progress)
 * - paused: On hold (combines legacy on_hold)
 * - completed: Finished
 *
 * Legacy statuses are mapped to their primary equivalent for action logic.
 */
function getRequestActions(
  state: RequestState,
  entityId: string,
  router: ReturnType<typeof useRouter>,
  onComplete?: () => void
): QuickAction[] {
  const actions: QuickAction[] = [];

  // Map legacy status to primary for action logic
  const primaryStatus = mapToPrimaryStatus(state.status as RequestStatus);
  const isTerminal = isTerminalStatus(state.status as RequestStatus);

  // Based on primary status
  switch (primaryStatus) {
    case "new":
      // New requests need triage/review
      actions.push({
        id: "start_working",
        label: "Start Working",
        icon: "▶️",
        onClick: async () => {
          try {
            const response = await fetch(`/api/requests/${entityId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "working" }),
            });
            if (response.ok && onComplete) {
              onComplete();
            }
          } catch (err) {
            console.error("Failed to update status:", err);
          }
        },
        variant: "primary",
        tooltip: "Begin working on this request",
      });
      if (!state.has_trappers) {
        actions.push({
          id: "assign",
          label: "Assign Trapper",
          icon: "👤",
          onClick: () => {
            const assignBtn = document.querySelector("[data-assign-trapper]");
            if (assignBtn instanceof HTMLButtonElement) {
              assignBtn.click();
            }
          },
          variant: "secondary",
          tooltip: "Assign a trapper to this request",
        });
      }
      break;

    case "working":
      // Working requests can log visits or be completed
      actions.push({
        id: "site_visit",
        label: "Log Visit",
        icon: "📝",
        onClick: () => {
          const visitBtn = document.querySelector("[data-log-visit]");
          if (visitBtn instanceof HTMLButtonElement) {
            visitBtn.click();
          }
        },
        variant: "secondary",
        tooltip: "Log a site visit observation",
      });
      actions.push({
        id: "complete",
        label: "Complete",
        icon: "✅",
        onClick: () => {
          const completeBtn = document.querySelector("[data-complete-request]");
          if (completeBtn instanceof HTMLButtonElement) {
            completeBtn.click();
          }
        },
        variant: "success",
        tooltip: "Mark request as completed",
      });
      if (!state.has_trappers) {
        actions.push({
          id: "assign",
          label: "Assign Trapper",
          icon: "👤",
          onClick: () => {
            const assignBtn = document.querySelector("[data-assign-trapper]");
            if (assignBtn instanceof HTMLButtonElement) {
              assignBtn.click();
            }
          },
          variant: "secondary",
          tooltip: "Assign a trapper to this request",
        });
      }
      break;

    case "paused":
      // Paused requests can be resumed
      actions.push({
        id: "resume",
        label: "Resume",
        icon: "▶️",
        onClick: async () => {
          try {
            const response = await fetch(`/api/requests/${entityId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "working", hold_reason: null }),
            });
            if (response.ok && onComplete) {
              onComplete();
            }
          } catch (err) {
            console.error("Failed to update status:", err);
          }
        },
        variant: "primary",
        tooltip: "Remove from hold and resume working",
      });
      actions.push({
        id: "complete",
        label: "Complete",
        icon: "✅",
        onClick: () => {
          const completeBtn = document.querySelector("[data-complete-request]");
          if (completeBtn instanceof HTMLButtonElement) {
            completeBtn.click();
          }
        },
        variant: "secondary",
        tooltip: "Mark request as completed",
      });
      break;

    case "completed":
      // No actions for completed requests
      break;
  }

  // Context-based suggestions (only for active requests)
  if (!isTerminal) {
    if (state.has_kittens) {
      actions.push({
        id: "kitten_assess",
        label: "Assess Kittens",
        icon: "🐱",
        onClick: () => {
          const kittenBtn = document.querySelector("[data-kitten-assessment]");
          if (kittenBtn instanceof HTMLButtonElement) {
            kittenBtn.click();
          }
        },
        variant: "warning",
        tooltip: "Complete kitten assessment",
      });
    }

    if (!state.has_place) {
      actions.push({
        id: "add_place",
        label: "Add Location",
        icon: "📍",
        onClick: () => {
          const editBtn = document.querySelector("[data-edit-request]");
          if (editBtn instanceof HTMLButtonElement) {
            editBtn.click();
          }
        },
        variant: "warning",
        tooltip: "Request needs a location",
      });
    }
  }

  return actions;
}

function getCatActions(
  state: CatState,
  entityId: string,
  router: ReturnType<typeof useRouter>,
  onComplete?: () => void
): QuickAction[] {
  const actions: QuickAction[] = [];

  if (!state.has_microchip) {
    actions.push({
      id: "add_microchip",
      label: "Add Microchip",
      icon: "💉",
      onClick: () => {
        const editBtn = document.querySelector("[data-edit-cat]");
        if (editBtn instanceof HTMLButtonElement) {
          editBtn.click();
        }
      },
      variant: "primary",
      tooltip: "Add microchip number for this cat",
    });
  }

  if (!state.has_owner) {
    actions.push({
      id: "link_owner",
      label: "Link Owner",
      icon: "👤",
      onClick: () => {
        const linkBtn = document.querySelector("[data-link-owner]");
        if (linkBtn instanceof HTMLButtonElement) {
          linkBtn.click();
        }
      },
      variant: "secondary",
      tooltip: "Link this cat to an owner/caretaker",
    });
  }

  if (!state.has_place) {
    actions.push({
      id: "link_place",
      label: "Link Place",
      icon: "📍",
      onClick: () => {
        const linkBtn = document.querySelector("[data-link-place]");
        if (linkBtn instanceof HTMLButtonElement) {
          linkBtn.click();
        }
      },
      variant: "secondary",
      tooltip: "Link this cat to a location",
    });
  }

  if (state.altered_status === "intact" || state.altered_status === "unknown") {
    actions.push({
      id: "view_appointments",
      label: "View Appointments",
      icon: "🏥",
      onClick: () => router.push(`/cats/${entityId}?tab=appointments`),
      variant: "secondary",
      tooltip: "Check clinic appointment history",
    });
  }

  return actions;
}

function getPersonActions(
  state: PersonState,
  entityId: string,
  router: ReturnType<typeof useRouter>,
  onComplete?: () => void
): QuickAction[] {
  const actions: QuickAction[] = [];

  if (state.is_trapper) {
    actions.push({
      id: "view_assignments",
      label: "View Assignments",
      icon: "📋",
      onClick: () => router.push(`/people/${entityId}?tab=requests`),
      variant: "primary",
      tooltip: "View trapper's assigned requests",
    });
  }

  if (state.cat_count > 0) {
    actions.push({
      id: "view_cats",
      label: `View Cats (${state.cat_count})`,
      icon: "🐱",
      onClick: () => router.push(`/people/${entityId}?tab=cats`),
      variant: "secondary",
      tooltip: "View associated cats",
    });
  }

  if (!state.has_email && !state.has_phone) {
    actions.push({
      id: "add_contact",
      label: "Add Contact Info",
      icon: "📞",
      onClick: () => {
        const editBtn = document.querySelector("[data-edit-person]");
        if (editBtn instanceof HTMLButtonElement) {
          editBtn.click();
        }
      },
      variant: "warning",
      tooltip: "Add email or phone number",
    });
  }

  actions.push({
    id: "create_request",
    label: "New Request",
    icon: "➕",
    onClick: () => router.push(`/requests/new?person_id=${entityId}`),
    variant: "secondary",
    tooltip: "Create a new request for this person",
  });

  return actions;
}

function getPlaceActions(
  state: PlaceState,
  entityId: string,
  router: ReturnType<typeof useRouter>,
  onComplete?: () => void
): QuickAction[] {
  const actions: QuickAction[] = [];

  if (state.needs_observation) {
    actions.push({
      id: "add_observation",
      label: "Add Observation",
      icon: "👁️",
      onClick: () => {
        const observeBtn = document.querySelector("[data-add-observation]");
        if (observeBtn instanceof HTMLButtonElement) {
          observeBtn.click();
        }
      },
      variant: "primary",
      tooltip: "Colony data is outdated - add a new observation",
    });
  }

  if (!state.has_requests) {
    actions.push({
      id: "create_request",
      label: "Create Request",
      icon: "➕",
      onClick: () => router.push(`/requests/new?place_id=${entityId}`),
      variant: "secondary",
      tooltip: "Create a new request for this location",
    });
  } else {
    actions.push({
      id: "view_requests",
      label: "View Requests",
      icon: "📋",
      onClick: () => router.push(`/places/${entityId}?tab=requests`),
      variant: "secondary",
      tooltip: "View requests at this location",
    });
  }

  if (state.cat_count > 0) {
    actions.push({
      id: "view_cats",
      label: `View Cats (${state.cat_count})`,
      icon: "🐱",
      onClick: () => router.push(`/places/${entityId}?tab=cats`),
      variant: "secondary",
      tooltip: "View cats at this location",
    });
  }

  if (!state.has_coordinates) {
    actions.push({
      id: "add_coordinates",
      label: "Add Coordinates",
      icon: "📍",
      onClick: () => {
        const editBtn = document.querySelector("[data-edit-place]");
        if (editBtn instanceof HTMLButtonElement) {
          editBtn.click();
        }
      },
      variant: "warning",
      tooltip: "Location needs coordinates for mapping",
    });
  }

  return actions;
}

export function QuickActions({ entityType, entityId, state, onActionComplete }: QuickActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const getActions = (): QuickAction[] => {
    switch (entityType) {
      case "request":
        return getRequestActions(state as RequestState, entityId, router, onActionComplete);
      case "cat":
        return getCatActions(state as CatState, entityId, router, onActionComplete);
      case "person":
        return getPersonActions(state as PersonState, entityId, router, onActionComplete);
      case "place":
        return getPlaceActions(state as PlaceState, entityId, router, onActionComplete);
      default:
        return [];
    }
  };

  const actions = getActions();

  if (actions.length === 0) {
    return null;
  }

  const handleClick = async (action: QuickAction) => {
    setLoading(action.id);
    try {
      await action.onClick();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.75rem 0",
        borderTop: "1px solid var(--border)",
        marginTop: "0.5rem",
      }}
    >
      <span
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          fontWeight: 500,
          marginRight: "0.25rem",
        }}
      >
        Quick:
      </span>
      {actions.slice(0, 4).map((action) => (
        <button
          key={action.id}
          onClick={() => handleClick(action)}
          disabled={loading !== null}
          title={action.tooltip}
          style={{
            ...variantStyles[action.variant],
            padding: "0.35rem 0.75rem",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 500,
            cursor: loading !== null ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            opacity: loading !== null && loading !== action.id ? 0.6 : 1,
            transition: "opacity 0.15s, transform 0.1s",
          }}
          onMouseOver={(e) => {
            if (loading === null) {
              e.currentTarget.style.transform = "scale(1.02)";
            }
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <span style={{ fontSize: "0.9rem" }}>{action.icon}</span>
          <span>{loading === action.id ? "..." : action.label}</span>
        </button>
      ))}
    </div>
  );
}

// Convenience hook for building entity state from API data
export function useRequestQuickActionState(request: {
  status: string;
  priority: string;
  place_id: string | null;
  has_kittens: boolean;
  estimated_cat_count: number | null;
  source_system: string | null;
  trapper_count?: number;
}): RequestState {
  return {
    status: request.status,
    priority: request.priority,
    has_place: !!request.place_id,
    has_trappers: (request.trapper_count ?? 0) > 0,
    has_kittens: request.has_kittens,
    estimated_cat_count: request.estimated_cat_count,
    source_system: request.source_system,
  };
}

export function useCatQuickActionState(cat: {
  altered_status: string | null;
  microchip?: string | null;
  owner_person_id?: string | null;
  place_id?: string | null;
}): CatState {
  return {
    altered_status: cat.altered_status,
    has_microchip: !!cat.microchip,
    has_owner: !!cat.owner_person_id,
    has_place: !!cat.place_id,
  };
}

export function usePersonQuickActionState(person: {
  email?: string | null;
  phone?: string | null;
  is_trapper?: boolean;
  cat_count?: number;
  request_count?: number;
}): PersonState {
  return {
    has_email: !!person.email,
    has_phone: !!person.phone,
    is_trapper: !!person.is_trapper,
    cat_count: person.cat_count ?? 0,
    request_count: person.request_count ?? 0,
  };
}

export function usePlaceQuickActionState(place: {
  lat?: number | null;
  lng?: number | null;
  request_count?: number;
  cat_count?: number;
  colony_estimate?: number | null;
  last_observation_days?: number | null;
}): PlaceState {
  const needsObservation = (place.last_observation_days ?? 999) > 180;

  return {
    has_coordinates: !!place.lat && !!place.lng,
    has_requests: (place.request_count ?? 0) > 0,
    cat_count: place.cat_count ?? 0,
    needs_observation: needsObservation,
    colony_estimate: place.colony_estimate ?? null,
  };
}
