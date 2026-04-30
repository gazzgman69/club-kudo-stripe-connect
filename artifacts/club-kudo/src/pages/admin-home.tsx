import { useSearch } from "wouter";
import { useSession } from "@/lib/use-session";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminHomePage() {
  const session = useSession();
  const search = useSearch();
  const justSignedIn = new URLSearchParams(search).get("signed_in") === "1";

  return (
    <AdminShell>
      <div className="space-y-6">
        {justSignedIn ? (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            Welcome back. You're signed in.
          </div>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Admin home</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">Signed in as</dt>
                <dd className="text-gray-900 font-medium">
                  {session.data?.user.displayName ?? session.data?.user.email}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Email</dt>
                <dd className="text-gray-900 font-mono text-xs">
                  {session.data?.user.email}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Roles</dt>
                <dd className="text-gray-900">
                  {session.data?.roles.join(", ") ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">User ID</dt>
                <dd className="text-gray-900 font-mono text-xs">
                  {session.data?.user.id}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What's here</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 space-y-2">
            <p>
              You're signed in to the Club Kudo admin app. Phase 1 Step 10a
              (this page) proves the auth flow works end-to-end through the
              real UI rather than browser-console snippets.
            </p>
            <p>
              Step 10b adds the supplier, client, and gig management screens.
              Until then, those nav links are stubs and the existing admin
              endpoints can still be hit via curl or fetch from DevTools.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
