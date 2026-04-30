import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useSession } from "@/lib/use-session";

/**
 * Wrapper that:
 *  - Shows nothing while the session is loading.
 *  - Redirects to /sign-in if no session.
 *  - Optionally enforces a required role.
 *  - Renders children if the session passes both checks.
 */
export function AuthGate({
  children,
  requireRole,
}: {
  children: ReactNode;
  requireRole?: "admin" | "supplier";
}) {
  const session = useSession();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!session.isPending && !session.isError && session.data === null) {
      setLocation("/sign-in");
    }
  }, [session.isPending, session.isError, session.data, setLocation]);

  if (session.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-600">
            Couldn't load your session. Refresh the page or sign in again.
          </p>
          <a
            href="/sign-in"
            className="inline-block text-sm text-blue-600 hover:underline"
          >
            Go to sign-in
          </a>
        </div>
      </div>
    );
  }

  if (!session.data) return null; // useEffect will redirect

  if (requireRole && !session.data.roles.includes(requireRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">No access</h1>
          <p className="text-sm text-gray-600">
            You don't have the {requireRole} role on this account.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
