import { useReducer, useCallback } from "react";

export type ModalName =
  | "observation"
  | "complete"
  | "hold"
  | "redirect"
  | "handoff"
  | "email"
  | "colony"
  | "upgradeWizard";

interface ModalState {
  active: ModalName | null;
  /** When true, completing the observation modal triggers the completion flow */
  pendingCompletion: boolean;
  completionTargetStatus: "completed" | "cancelled";
}

type ModalAction =
  | { type: "open"; modal: ModalName }
  | { type: "close" }
  | { type: "startCompletionFlow"; targetStatus: "completed" | "cancelled" }
  | { type: "advanceCompletionFlow" };

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case "open":
      return { ...state, active: action.modal };
    case "close":
      return { ...state, active: null, pendingCompletion: false };
    case "startCompletionFlow":
      // Open observation modal first, then complete modal after
      return {
        active: "observation",
        pendingCompletion: true,
        completionTargetStatus: action.targetStatus,
      };
    case "advanceCompletionFlow":
      // After observation, advance to complete modal
      if (state.pendingCompletion) {
        return { ...state, active: "complete", pendingCompletion: false };
      }
      return { ...state, active: null, pendingCompletion: false };
    default:
      return state;
  }
}

const initialState: ModalState = {
  active: null,
  pendingCompletion: false,
  completionTargetStatus: "completed",
};

export function useRequestModals() {
  const [state, dispatch] = useReducer(modalReducer, initialState);

  const openModal = useCallback((modal: ModalName) => {
    dispatch({ type: "open", modal });
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: "close" });
  }, []);

  const startCompletionFlow = useCallback(
    (targetStatus: "completed" | "cancelled") => {
      dispatch({ type: "startCompletionFlow", targetStatus });
    },
    []
  );

  const advanceCompletionFlow = useCallback(() => {
    dispatch({ type: "advanceCompletionFlow" });
  }, []);

  return {
    activeModal: state.active,
    pendingCompletion: state.pendingCompletion,
    completionTargetStatus: state.completionTargetStatus,
    openModal,
    closeModal,
    startCompletionFlow,
    advanceCompletionFlow,
  };
}
