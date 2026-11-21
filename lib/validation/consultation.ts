import { z } from "zod";

// Shared by the API and (from M4) the forms, so this file must stay free of
// server-only imports. Input types come from z.infer: no separate input DTOs.

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} must be at most 100 characters`);

/**
 * An ISO 8601 date-time with an offset (`Z` or `+11:00`), strictly in the
 * future. A `datetime-local` value has no offset, so the client converts it
 * before sending. Normalised to UTC.
 */
export const futureDateTime = z
  .iso.datetime({ offset: true, error: "Must be a date and time with a time zone offset" })
  .refine((value) => new Date(value).getTime() > Date.now(), "Must be in the future")
  .transform((value) => new Date(value).toISOString());

/** POST /api/consultations. Unknown keys (`student_id`, `role`, …) are dropped. */
export const createConsultationSchema = z.object({
  firstName: name("First name"),
  lastName: name("Last name"),
  reason: z
    .string({ error: "Reason is required" })
    .trim()
    .min(1, "Reason is required")
    .max(1000, "Reason must be at most 1000 characters"),
  scheduledAt: futureDateTime,
});

/** PATCH /api/consultations/:id with `{ completed }`: names the target state. */
export const completeConsultationSchema = z.object({
  completed: z.boolean({ error: "completed must be true or false" }),
});

/** PATCH /api/consultations/:id with `{ scheduledAt }`. */
export const rescheduleConsultationSchema = z.object({
  scheduledAt: futureDateTime,
});

export type CreateConsultationInput = z.infer<typeof createConsultationSchema>;
export type CompleteConsultationInput = z.infer<typeof completeConsultationSchema>;
export type RescheduleConsultationInput = z.infer<typeof rescheduleConsultationSchema>;
export type UpdateConsultationInput = CompleteConsultationInput | RescheduleConsultationInput;

/** PATCH body: exactly one of `completed` or `scheduledAt`. */
export const updateConsultationSchema = z
  .object({
    completed: completeConsultationSchema.shape.completed.optional(),
    scheduledAt: futureDateTime.optional(),
  })
  .refine((body) => (body.completed === undefined) !== (body.scheduledAt === undefined), {
    message: "Send either completed or scheduledAt, not both",
  })
  .transform(
    (body): UpdateConsultationInput =>
      body.scheduledAt !== undefined
        ? { scheduledAt: body.scheduledAt }
        : { completed: body.completed! },
  );

export const ADMIN_PAGE_SIZE = { default: 20, max: 100 } as const;

/** GET /api/admin/consultations query string. */
export const adminListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(ADMIN_PAGE_SIZE.max, `limit must be at most ${ADMIN_PAGE_SIZE.max}`)
    .default(ADMIN_PAGE_SIZE.default),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
