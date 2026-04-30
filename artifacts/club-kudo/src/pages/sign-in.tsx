import { useState } from "react";
import { Link } from "wouter";
import { useRequestMagicLink, useSession } from "@/lib/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  const session = useSession();
  const requestLink = useRequestMagicLink();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Already signed in → redirect to /admin via a soft refresh.
  if (session.data) {
    window.location.replace("/admin");
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await requestLink.mutateAsync(email.trim());
      setSubmitted(true);
    } catch {
      // useMutation already exposes the error via requestLink.error /
      // .isError; the JSX below renders a contextual message. Catch
      // here so the rejection doesn't reach Vite's runtime overlay.
    }
  }

  function errorMessage(): string | null {
    if (!requestLink.isError) return null;
    const err = requestLink.error as
      | { status?: number; code?: string; message?: string }
      | undefined;
    if (err?.status === 429) {
      return "Too many sign-in attempts. Try again in 15 minutes, or use a different email.";
    }
    return "Couldn't send the sign-in link. Try again in a moment.";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in to Club Kudo</CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                If <span className="font-medium">{email}</span> is registered,
                we've sent a sign-in link to that inbox. The link expires in
                15 minutes.
              </p>
              <p className="text-xs text-gray-500">
                Didn't receive it?{" "}
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => setSubmitted(false)}
                >
                  Try a different email
                </button>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {requestLink.isError ? (
                <p className="text-sm text-red-600">{errorMessage()}</p>
              ) : null}
              <Button
                type="submit"
                disabled={requestLink.isPending || !email.trim()}
                className="w-full"
              >
                {requestLink.isPending ? "Sending…" : "Send sign-in link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Link href="/" className="sr-only">
        Home
      </Link>
    </div>
  );
}
