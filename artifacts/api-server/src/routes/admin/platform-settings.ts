import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

const updateSchema = z.object({
  vatRegistered: z.boolean().optional(),
  vatRateBps: z.number().int().min(0).max(10000).optional(),
  defaultReservationPercentBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional(),
  defaultBookingCommissionPercentBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .nullable()
    .optional(),
  currency: z
    .string()
    .regex(/^[a-z]{3}$/, "currency must be a 3-letter ISO 4217 lowercase code")
    .optional(),
  defaultInvoicePaymentTermsDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional(),
  cancellationPolicyText: z.string().max(10_000).nullable().optional(),
});

async function handleGetSettings(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, "singleton"))
    .limit(1);
  if (rows.length === 0) {
    return next(
      new HttpError(
        500,
        "platform_settings_missing",
        "platform_settings singleton row not found — run schema seed",
      ),
    );
  }
  res.status(200).json(rows[0]);
}

async function handleUpdateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(req.body);
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
    .update(platformSettingsTable)
    .set(body)
    .where(eq(platformSettingsTable.id, "singleton"))
    .returning();
  if (updated.length === 0) {
    return next(
      new HttpError(
        500,
        "platform_settings_missing",
        "platform_settings singleton row not found — run schema seed",
      ),
    );
  }
  res.status(200).json(updated[0]);
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;
router.get("/admin/platform-settings", ...gates, handleGetSettings);
router.patch("/admin/platform-settings", ...gates, handleUpdateSettings);

export default router;
