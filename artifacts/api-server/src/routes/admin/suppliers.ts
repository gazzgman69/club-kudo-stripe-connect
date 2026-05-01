import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import {
  db,
  suppliersTable,
  usersTable,
  userRolesTable,
} from "@workspace/db";
import { getStripe } from "../../lib/stripe";
import { sendSupplierOnboardingEmail } from "../../lib/email";
import { getEnv } from "../../lib/env";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createSupplierSchema = z.object({
  tradingName: z.string().min(1).max(200),
  contactEmail: z.string().email().toLowerCase().trim(),
  instrument: z.array(z.string().min(1)).max(20).optional(),
  bio: z.string().max(2000).optional(),
  vatRegistered: z.boolean().optional().default(false),
  vatRateBps: z.number().int().min(0).max(10000).optional().default(0),
});

const updateSupplierSchema = z.object({
  tradingName: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().toLowerCase().trim().optional(),
  instrument: z.array(z.string().min(1)).max(20).optional(),
  bio: z.string().max(2000).optional(),
  vatRegistered: z.boolean().optional(),
  vatRateBps: z.number().int().min(0).max(10000).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default("25"),
  cursor: z.string().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CursorPayload {
  v: 1;
  k: string; // ISO timestamp
  id: string; // tie-breaker UUID
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "cursor_invalid", "Cursor could not be decoded");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { k?: unknown }).k !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    throw new HttpError(400, "cursor_invalid", "Cursor schema unrecognised");
  }
  return parsed as CursorPayload;
}

function buildBaseUrl(req: Request): string {
  const env = getEnv();
  return (
    env.APP_BASE_URL ?? `${req.protocol}://${req.get("host") ?? "localhost"}`
  );
}

// Find or create the user that backs a supplier. If a user with the
// same email already exists, we attach the `supplier` role to them
// (idempotently). Otherwise we create a fresh user row.
async function ensureSupplierUser(args: {
  email: string;
  displayName: string;
}): Promise<{ userId: string; created: boolean }> {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, args.email))
    .limit(1);

  let userId: string;
  let created = false;
  if (existing.length > 0) {
    userId = existing[0].id;
  } else {
    const inserted = await db
      .insert(usersTable)
      .values({ email: args.email, displayName: args.displayName })
      .returning({ id: usersTable.id });
    userId = inserted[0].id;
    created = true;
  }

  // Idempotent role grant via composite PK.
  await db
    .insert(userRolesTable)
    .values({ userId, role: "supplier" })
    .onConflictDoNothing();

  return { userId, created };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleCreateSupplier(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let body: z.infer<typeof createSupplierSchema>;
  try {
    body = createSupplierSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    const { userId } = await ensureSupplierUser({
      email: body.contactEmail,
      displayName: body.tradingName,
    });

    const inserted = await db
      .insert(suppliersTable)
      .values({
        userId,
        tradingName: body.tradingName,
        contactEmail: body.contactEmail,
        instrument: body.instrument ?? null,
        bio: body.bio ?? null,
        vatRegistered: body.vatRegistered,
        vatRateBps: body.vatRateBps,
      })
      .returning();

    res.status(201).json(inserted[0]);
  } catch (err) {
    next(err);
  }
}

async function handleListSuppliers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let query: z.infer<typeof listQuerySchema>;
  try {
    query = listQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const limit = query.limit;
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

  // Soft-delete filter is always applied. Sort by created_at DESC,
  // id DESC for a stable tie-break. Cursor pagination uses keyset
  // semantics: "where (created_at, id) < (cursor.k, cursor.id)".
  const baseConditions = [isNull(suppliersTable.deletedAt)];
  if (cursor) {
    baseConditions.push(
      sql`(${suppliersTable.createdAt}, ${suppliersTable.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select()
    .from(suppliersTable)
    .where(and(...baseConditions))
    .orderBy(desc(suppliersTable.createdAt), desc(suppliersTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          v: 1,
          k: items[items.length - 1].createdAt.toISOString(),
          id: items[items.length - 1].id,
        })
      : null;

  res.status(200).json({ items, nextCursor });
}

async function handleGetSupplier(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const rows = await db
    .select()
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.id, params.id),
        isNull(suppliersTable.deletedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return next(
      new HttpError(404, "supplier_not_found", "Supplier not found"),
    );
  }

  res.status(200).json(rows[0]);
}

async function handleUpdateSupplier(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  let body: z.infer<typeof updateSupplierSchema>;
  try {
    params = idParamSchema.parse(req.params);
    body = updateSupplierSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  if (Object.keys(body).length === 0) {
    return next(
      new HttpError(
        400,
        "no_fields_to_update",
        "PATCH body must contain at least one updatable field",
      ),
    );
  }

  const updated = await db
    .update(suppliersTable)
    .set({
      ...(body.tradingName !== undefined
        ? { tradingName: body.tradingName }
        : {}),
      ...(body.contactEmail !== undefined
        ? { contactEmail: body.contactEmail }
        : {}),
      ...(body.instrument !== undefined ? { instrument: body.instrument } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.vatRegistered !== undefined
        ? { vatRegistered: body.vatRegistered }
        : {}),
      ...(body.vatRateBps !== undefined ? { vatRateBps: body.vatRateBps } : {}),
    })
    .where(
      and(
        eq(suppliersTable.id, params.id),
        isNull(suppliersTable.deletedAt),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return next(
      new HttpError(404, "supplier_not_found", "Supplier not found"),
    );
  }

  res.status(200).json(updated[0]);
}

async function handleDeleteSupplier(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const deletedByUserId = req.session?.userId;
  const updated = await db
    .update(suppliersTable)
    .set({
      deletedAt: new Date(),
      deletedByUserId: deletedByUserId ?? null,
    })
    .where(
      and(
        eq(suppliersTable.id, params.id),
        isNull(suppliersTable.deletedAt),
      ),
    )
    .returning({ id: suppliersTable.id });

  if (updated.length === 0) {
    return next(
      new HttpError(404, "supplier_not_found", "Supplier not found"),
    );
  }

  res.status(204).end();
}

/**
 * POST /api/admin/suppliers/:id/stripe-onboarding-link
 *
 * Creates (or reuses) a Stripe V2 connected account for the supplier
 * and returns a hosted onboarding URL the supplier can use to complete
 * KYC. Also emails the link to the supplier's contact_email via Resend
 * so the admin doesn't have to forward it manually.
 */
async function handleCreateOnboardingLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const stripe = getStripe();

  const rows = await db
    .select()
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.id, params.id),
        isNull(suppliersTable.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return next(
      new HttpError(404, "supplier_not_found", "Supplier not found"),
    );
  }
  const supplier = rows[0];

  if (!supplier.contactEmail) {
    return next(
      new HttpError(
        400,
        "supplier_missing_email",
        "Supplier has no contact_email; can't email the onboarding link",
      ),
    );
  }

  // Create the V2 connected account if we don't have one yet. The
  // exact shape below is locked by the HANDOVER architecture brief —
  // do NOT use top-level type:"express" (V1 pattern) and do NOT
  // remove fees_collector / losses_collector defaults.
  let stripeAccountId = supplier.stripeAccountId;
  if (!stripeAccountId) {
    try {
      const account = await stripe.v2.core.accounts.create({
        display_name: supplier.tradingName,
        contact_email: supplier.contactEmail,
        identity: { country: "gb" },
        dashboard: "express",
        defaults: {
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
      });
      stripeAccountId = account.id;
      await db
        .update(suppliersTable)
        .set({
          stripeAccountId,
          stripeOnboardingStatus: "onboarding",
        })
        .where(eq(suppliersTable.id, supplier.id));
    } catch (err) {
      req.log.error(
        { err, supplierId: supplier.id },
        "stripe v2 accounts.create failed",
      );
      return next(
        new HttpError(
          502,
          "stripe_account_create_failed",
          (err as Error).message,
        ),
      );
    }
  }

  // V2 account links use a different shape from V1: the destination
  // info goes inside `use_case.account_onboarding`, and `configurations`
  // names the V2 configurations (recipient) being onboarded for.
  const baseUrl = buildBaseUrl(req);
  let onboardingUrl: string;
  try {
    const link = await stripe.v2.core.accountLinks.create({
      account: stripeAccountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          // Both must be the React admin pages, NOT the JSON API. Stripe
          // sends the user's browser to these — landing on a raw JSON
          // payload is what we just fixed.
          refresh_url: `${baseUrl}/admin/suppliers/${supplier.id}?onboarding=expired`,
          return_url: `${baseUrl}/admin/suppliers/${supplier.id}?onboarding=complete`,
        },
      },
    });
    onboardingUrl = link.url;
  } catch (err) {
    req.log.error(
      { err, stripeAccountId },
      "stripe v2 accountLinks.create failed",
    );
    return next(
      new HttpError(
        502,
        "stripe_onboarding_link_failed",
        (err as Error).message,
      ),
    );
  }

  // Fire off the email. Failure here is logged but we still return
  // the link so the admin can deliver it manually if Resend's down.
  let emailedAt: string | null = null;
  try {
    await sendSupplierOnboardingEmail({
      toEmail: supplier.contactEmail,
      tradingName: supplier.tradingName,
      onboardingUrl,
    });
    emailedAt = new Date().toISOString();
  } catch (err) {
    req.log.error(
      { err, supplierId: supplier.id },
      "supplier onboarding email send failed",
    );
  }

  res.status(200).json({
    stripeAccountId,
    onboardingUrl,
    emailedAt,
  });
}

async function handleGetStripeStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const rows = await db
    .select({
      id: suppliersTable.id,
      stripeAccountId: suppliersTable.stripeAccountId,
      stripeOnboardingStatus: suppliersTable.stripeOnboardingStatus,
      stripeCapabilitiesJson: suppliersTable.stripeCapabilitiesJson,
    })
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.id, params.id),
        isNull(suppliersTable.deletedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return next(
      new HttpError(404, "supplier_not_found", "Supplier not found"),
    );
  }

  res.status(200).json(rows[0]);
}

const router: IRouter = Router();

// Apply requireAuth + requireRole inline on each route. A bare
// router.use(requireAuth, ...) at the top would gate every request
// that enters this router (including ones that don't match any of
// its routes), which makes Express never fall through to the next
// router — that breaks unrelated paths like /api/healthz. Inline
// per-route is verbose but unambiguous: gates apply only when the
// path actually matches.
const gates = [requireAuth, requireRole("admin")] as const;

router.post("/admin/suppliers", ...gates, handleCreateSupplier);
router.get("/admin/suppliers", ...gates, handleListSuppliers);
router.get("/admin/suppliers/:id", ...gates, handleGetSupplier);
router.patch("/admin/suppliers/:id", ...gates, handleUpdateSupplier);
router.delete("/admin/suppliers/:id", ...gates, handleDeleteSupplier);
router.post(
  "/admin/suppliers/:id/stripe-onboarding-link",
  ...gates,
  handleCreateOnboardingLink,
);
router.get(
  "/admin/suppliers/:id/stripe-status",
  ...gates,
  handleGetStripeStatus,
);

export default router;
