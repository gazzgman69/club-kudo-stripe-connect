/**
 * Thin fetch wrapper for talking to the Club Kudo API from the
 * frontend. Handles three things our API expects:
 *
 *  1. `credentials: 'include'` so the session cookie travels with
 *     every request.
 *  2. CSRF token: lazily fetches `/api/csrf-token` once per page
 *     load, caches the value, and attaches `x-csrf-token` to every
 *     state-changing request.
 *  3. Idempotency-Key: generates a fresh UUID v4 for each
 *     state-changing call so the server's idempotency middleware can
 *     replay the cached response on retry.
 *
 * Mirrors the contracts established in Phase 1 Steps 3, 5a, 5c.
 *
 * For dev we rely on Vite's `/api` proxy (see vite.config.ts) so
 * this fetch wrapper can talk to relative `/api/...` URLs without
 * CORS friction. In production the SPA is served from the same
 * origin as the API.
 */

let csrfTokenPromise: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfTokenPromise) return csrfTokenPromise;
  csrfTokenPromise = (async () => {
    const res = await fetch("/api/csrf-token", { credentials: "include" });
    if (!res.ok) {
      // Reset so the next call retries.
      csrfTokenPromise = null;
      throw new Error(`csrf-token fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as { csrfToken?: string };
    if (!body.csrfToken) {
      csrfTokenPromise = null;
      throw new Error("csrf-token response missing csrfToken");
    }
    return body.csrfToken;
  })();
  return csrfTokenPromise;
}

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export interface ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
}

function makeApiError(
  status: number,
  message: string,
  code?: string,
  details?: unknown,
): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string" || options.body instanceof FormData) {
      body = options.body as BodyInit;
    } else {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  if (STATE_CHANGING.has(method)) {
    const csrf = await getCsrfToken();
    headers.set("x-csrf-token", csrf);
    if (!headers.has("idempotency-key")) {
      headers.set("idempotency-key", crypto.randomUUID());
    }
  }

  const res = await fetch(path, {
    ...options,
    method,
    headers,
    body,
    credentials: options.credentials ?? "include",
  });

  // Try to parse a JSON error body. Some 204s have no body - handle.
  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  let parsed: unknown = undefined;
  if (contentType.includes("application/json")) {
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
  } else {
    try {
      parsed = await res.text();
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const errBody = parsed as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | undefined;
    throw makeApiError(
      res.status,
      errBody?.error?.message ?? `Request failed: ${res.status}`,
      errBody?.error?.code,
      errBody?.error?.details,
    );
  }

  return parsed as T;
}

// Resets the cached CSRF token. Call after sign-out so the next
// state-changing request gets a fresh token bound to the new session.
export function resetCsrfTokenCache(): void {
  csrfTokenPromise = null;
}
