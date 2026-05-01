/**
 * Public landing page Stripe redirects suppliers to when their onboarding
 * link is no longer valid (expired, already used, etc). NOT auth-gated.
 *
 * No "click here for a new link" button — the supplier doesn't have a
 * Club Kudo login. They contact the booking manager who can resend.
 * Phase 6 / supplier portal will fix this.
 */
export default function OnboardingExpiredPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <svg
            className="h-6 w-6 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Link expired</h1>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          The onboarding link you used has expired or already been completed.
        </p>
        <p className="mt-4 text-sm text-gray-600 leading-relaxed">
          Reply to the email that brought you here and we'll send a fresh
          link.
        </p>
      </div>
    </div>
  );
}
