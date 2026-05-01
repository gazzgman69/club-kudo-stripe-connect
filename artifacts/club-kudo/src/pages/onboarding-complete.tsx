/**
 * Public landing page that suppliers see after returning from Stripe
 * Connect onboarding. NOT auth-gated — the supplier is just a Stripe
 * Connect onboardee, they don't have a Club Kudo login (yet — that
 * lands in Phase 6 with the supplier portal).
 *
 * Stripe's return_url for the V2 onboarding link points here. The page
 * tells them they're done and what to expect next.
 */
export default function OnboardingCompletePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <svg
            className="h-6 w-6 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          You're all set
        </h1>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          Thanks for completing the Stripe onboarding. Stripe will verify
          your details over the next few minutes — once that's done, payments
          for your bookings will route directly to your account.
        </p>
        <p className="mt-4 text-sm text-gray-600 leading-relaxed">
          You can close this tab. We'll be in touch the next time you're
          booked for a gig.
        </p>
        <p className="mt-6 text-xs text-gray-500">
          Questions? Reply to the email that brought you here.
        </p>
      </div>
    </div>
  );
}
