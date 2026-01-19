"use client";

import { useState, useEffect, useCallback } from "react";

interface StaffUser {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: "admin" | "staff" | "volunteer";
  password_change_required: boolean;
}

interface UseCurrentUserResult {
  user: StaffUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Cache the user data to avoid repeated API calls
let cachedUser: StaffUser | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Hook to get the current authenticated user
 * Uses caching to minimize API calls
 */
export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<StaffUser | null>(cachedUser);
  const [isLoading, setIsLoading] = useState(!cachedUser);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async (force = false) => {
    // Use cache if fresh
    if (!force && cachedUser && Date.now() - cacheTime < CACHE_DURATION) {
      setUser(cachedUser);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();

      if (data.authenticated && data.staff) {
        cachedUser = data.staff;
        cacheTime = Date.now();
        setUser(data.staff);
      } else {
        cachedUser = null;
        setUser(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch user");
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const refetch = useCallback(async () => {
    await fetchUser(true);
  }, [fetchUser]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    refetch,
  };
}

/**
 * Clear the user cache (call on logout)
 */
export function clearUserCache(): void {
  cachedUser = null;
  cacheTime = 0;
}

export default useCurrentUser;
