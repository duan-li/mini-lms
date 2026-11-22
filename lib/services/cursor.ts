import { z } from "zod";

// Keyset cursor for the admin list, ordered by (scheduled_at, id). The cursor
// carries both values, so two bookings at the same time never repeat or go
// missing between pages. `scheduledAt` keeps Postgres's own text, with
// microseconds: rounding it through a JS Date (milliseconds) could repeat a row.

export type Cursor = { scheduledAt: string; id: string };

// Pre-range-migration rows may contain PostgreSQL's positive infinity or an
// extended UTC year. Preserve the exact sort key when paging over their rows.
const legacyTimestamp = z.string().regex(/^[1-9]\d{4,5}-/).refine((value) => {
  const yearEnd = value.indexOf("-");
  const year = Number(value.slice(0, yearEnd));
  // ISO validators expect four digits. A 400-year cycle preserves leap days.
  const calendarYear = 2000 + year % 400;
  return year <= 294276 && z.iso.datetime({ offset: true }).safeParse(calendarYear + value.slice(yearEnd)).success;
});

const cursorSchema = z.object({
  // Timestamp characters only: the value is placed inside a PostgREST filter.
  s: z
    .string()
    .regex(/^[0-9T:.+\- Z]+$/)
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .or(z.literal("infinity"))
    .or(legacyTimestamp),
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
