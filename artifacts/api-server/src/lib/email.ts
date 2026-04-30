import { Resend } from "resend";
import { getEnv } from "./env";

// Lazy singleton so `Resend` isn't instantiated at module-load time
// (which happens before tests have a chance to set RESEND_API_KEY in
// the test-setup file). The first send call materialises the client.
let cached: Resend | null = null;

function getResend(): Resend {
  if (cached) return cached;
  const env = getEnv();
  cached = new Resend(env.RESEND_API_KEY);
  return cached;
}

interface SendMagicLinkArgs {
  toEmail: string;
  magicLink: string;
}

/**
 * Send a magic-link email. The plaintext body always carries the URL so
 * users with HTML disabled can still authenticate. The HTML version
 * adds a styled button for everyone else.
 *
 * Throws on Resend errors. The caller should catch and decide what to
 * surface to the user — for the magic-link route, anti-enumeration
 * means we return a generic success message regardless.
 */
export async function sendMagicLinkEmail(
  args: SendMagicLinkArgs,
): Promise<void> {
  const env = getEnv();
  const resend = getResend();

  const { toEmail, magicLink } = args;

  const html = renderMagicLinkHtml(magicLink);
  const text = renderMagicLinkText(magicLink);

  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    replyTo: env.EMAIL_REPLY_TO,
    subject: "Your Club Kudo sign-in link",
    html,
    text,
  });

  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name}: ${result.error.message}`,
    );
  }
}

function renderMagicLinkText(magicLink: string): string {
  return [
    "Sign in to Club Kudo",
    "",
    "Click the link below to sign in. The link expires in 15 minutes",
    "and can only be used once.",
    "",
    magicLink,
    "",
    "If you didn't request this email, you can safely ignore it.",
  ].join("\n");
}

function renderMagicLinkHtml(magicLink: string): string {
  // Inline styles only — many email clients strip <style> blocks. Keep
  // the markup defensive and the link prominent in case the button
  // doesn't render.
  const escaped = escapeHtml(magicLink);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Your Club Kudo sign-in link</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:32px 40px 16px 40px;">
          <h1 style="font-size:20px;font-weight:600;margin:0 0 16px 0;">Sign in to Club Kudo</h1>
          <p style="font-size:14px;line-height:1.5;margin:0 0 24px 0;">Click the button below to sign in. The link expires in 15 minutes and can only be used once.</p>
          <p style="margin:0 0 24px 0;"><a href="${escaped}" style="display:inline-block;padding:12px 20px;background:#111;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Sign in</a></p>
          <p style="font-size:12px;line-height:1.5;color:#666;margin:0 0 8px 0;">Or copy and paste this URL into your browser:</p>
          <p style="font-size:12px;line-height:1.5;color:#666;margin:0;word-break:break-all;"><a href="${escaped}" style="color:#666;">${escaped}</a></p>
        </td></tr>
        <tr><td style="padding:16px 40px 32px 40px;border-top:1px solid #eee;">
          <p style="font-size:11px;line-height:1.5;color:#888;margin:0;">If you didn't request this email, you can safely ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SendSupplierOnboardingArgs {
  toEmail: string;
  tradingName: string;
  onboardingUrl: string;
}

/**
 * Email a supplier their Stripe Connect onboarding link. Sent the
 * first time an admin generates an onboarding link via
 * POST /api/admin/suppliers/:id/stripe-onboarding-link.
 *
 * Throws on Resend errors; the caller (the admin endpoint) should
 * surface a clean error to the operator so they know to retry or
 * deliver the link by another means.
 */
export async function sendSupplierOnboardingEmail(
  args: SendSupplierOnboardingArgs,
): Promise<void> {
  const env = getEnv();
  const resend = getResend();

  const { toEmail, tradingName, onboardingUrl } = args;
  const html = renderSupplierOnboardingHtml(tradingName, onboardingUrl);
  const text = renderSupplierOnboardingText(tradingName, onboardingUrl);

  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: toEmail,
    replyTo: env.EMAIL_REPLY_TO,
    subject: `${tradingName} — set up payouts with Club Kudo`,
    html,
    text,
  });

  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name}: ${result.error.message}`,
    );
  }
}

function renderSupplierOnboardingText(
  tradingName: string,
  url: string,
): string {
  return [
    `Hi ${tradingName},`,
    "",
    "Club Kudo has set you up as a supplier on our booking platform.",
    "To receive payouts directly when clients pay for gigs you're booked",
    "on, you'll need to complete Stripe's secure onboarding (a few",
    "minutes — bank details, ID verification).",
    "",
    "Open this link to start:",
    "",
    url,
    "",
    "The link expires after a short while. If it does, just reply to",
    "this email and we'll send a fresh one.",
    "",
    "Thanks,",
    "The Club Kudo team",
  ].join("\n");
}

function renderSupplierOnboardingHtml(
  tradingName: string,
  url: string,
): string {
  const escapedName = escapeHtml(tradingName);
  const escapedUrl = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Set up payouts with Club Kudo</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:32px 40px 16px 40px;">
          <h1 style="font-size:20px;font-weight:600;margin:0 0 16px 0;">Hi ${escapedName},</h1>
          <p style="font-size:14px;line-height:1.6;margin:0 0 16px 0;">Club Kudo has set you up as a supplier on our booking platform. To receive payouts directly when clients pay for gigs you're booked on, you'll need to complete Stripe's secure onboarding — a few minutes for bank details and ID verification.</p>
          <p style="margin:24px 0;"><a href="${escapedUrl}" style="display:inline-block;padding:12px 20px;background:#111;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Set up payouts</a></p>
          <p style="font-size:12px;line-height:1.5;color:#666;margin:0 0 8px 0;">Or copy and paste this URL into your browser:</p>
          <p style="font-size:12px;line-height:1.5;color:#666;margin:0;word-break:break-all;"><a href="${escapedUrl}" style="color:#666;">${escapedUrl}</a></p>
        </td></tr>
        <tr><td style="padding:16px 40px 32px 40px;border-top:1px solid #eee;">
          <p style="font-size:11px;line-height:1.5;color:#888;margin:0;">The link expires after a short while. If it does, just reply to this email and we'll send a fresh one. Thanks — the Club Kudo team.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
