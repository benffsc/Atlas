"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "kiosk_active_staff";

export interface StaffSelection {
  staff_id: string;
  person_id: string;
  display_name: string;
  initials: string;
}

interface KioskStaffContextValue {
  activeStaff: StaffSelection | null;
  setActiveStaff: (staff: StaffSelection) => void;
  clearStaff: () => void;
}

const KioskStaffContext = createContext<KioskStaffContextValue>({
  activeStaff: null,
  setActiveStaff: () => {},
  clearStaff: () => {},
});

export function useKioskStaff() {
  return useContext(KioskStaffContext);
}

export function KioskStaffProvider({ children }: { children: React.ReactNode }) {
  const [activeStaff, setActiveStaffState] = useState<StaffSelection | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.staff_id && parsed?.person_id) {
          setActiveStaffState(parsed);
        }
      }
    } catch {
      // Corrupted storage — ignore
    }
  }, []);

  const setActiveStaff = useCallback((staff: StaffSelection) => {
    setActiveStaffState(staff);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
    } catch {
      // Storage full — still works in-memory
    }
  }, []);

  const clearStaff = useCallback(() => {
    setActiveStaffState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <KioskStaffContext.Provider value={{ activeStaff, setActiveStaff, clearStaff }}>
      {children}
    </KioskStaffContext.Provider>
  );
}
