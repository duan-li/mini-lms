import { z } from "zod";

// Keyset cursor for the admin list, ordered by (scheduled_at, id). The cursor
// carries both values, so two bookings at the same time never repeat or go
// missing between pages. `scheduledAt` keeps Postgres's own text, with
// microseconds: rounding it through a JS Date (milliseconds) could repeat a row.

export type Cursor = { scheduledAt: string; id: string };

const cursorSchema = z.object({
  // Timestamp characters only: the value is placed inside a PostgREST filter.
  s: z
    .string()
    .regex(/^[0-9T:.+\- Z]+$/)
    .refine((value) => !Number.isNaN(Date.parse(value))),
  i: z.uuid(),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.scheduledAt, i: cursor.id })).toString("base64url");
}

/** The decoded cursor, or null if it is not one this API issued. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? { scheduledAt: parsed.data.s, id: parsed.data.i } : null;
  } catch {
    return null;
  }
}
