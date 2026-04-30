import { type ReactNode } from "react";
import { Link } from "wouter";
import { useSession, useLogout } from "@/lib/use-session";
import { Button } from "@/components/ui/button";

/**
 * Authenticated admin shell: top header with nav links and a sign-out
 * button. Used by all /admin/* pages once Step 10b lands more screens.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const logout = useLogout();

  async function onSignOut() {
    await logout.mutateAsync();
    window.location.replace("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold text-gray-900">
              Club Kudo
            </Link>
            <nav className="flex items-center gap-4 text-sm text-gray-600">
              <Link href="/admin" className="hover:text-gray-900">
                Home
              </Link>
              <Link href="/admin/suppliers" className="hover:text-gray-900">
                Suppliers
              </Link>
              <Link href="/admin/clients" className="hover:text-gray-900">
                Clients
              </Link>
              <Link href="/admin/gigs" className="hover:text-gray-900">
                Gigs
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {session.data ? (
              <>
                <span className="text-gray-600">
                  {session.data.user.displayName ?? session.data.user.email}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSignOut}
                  disabled={logout.isPending}
                >
                  {logout.isPending ? "Signing out…" : "Sign out"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
