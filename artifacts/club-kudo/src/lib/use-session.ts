import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiFetch, resetCsrfTokenCache } from "./api";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Session {
  user: SessionUser;
  roles: string[];
}

const SESSION_QUERY_KEY = ["session"] as const;

/**
 * Read the current session from /api/auth/me. Returns:
 *   - data === null      → not signed in (401 from API)
 *   - data === Session   → signed in
 *   - isPending === true → first-load
 */
export function useSession() {
  return useQuery<Session | null>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await apiFetch<Session>("/api/auth/me");
      } catch (err) {
        const e = err as { status?: number };
        if (e.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Request a magic-link email. Always resolves the same shape on
 * success (anti-enumeration: the API returns the same response for
 * known and unknown emails). Component is responsible for showing
 * the generic "if that email exists..." message.
 */
export function useRequestMagicLink() {
  return useMutation({
    mutationFn: async (email: string) =>
      apiFetch<{ ok: boolean; message: string }>("/api/auth/magic-link", {
        method: "POST",
        body: { email },
      }),
  });
}

/**
 * Sign out: POST /api/auth/logout, then invalidate the session
 * cached query so the UI re-renders as signed-out, then reset the
 * CSRF cache so the next state-changing request fetches a fresh
 * token bound to the new session.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: async () => {
      resetCsrfTokenCache();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });
}
