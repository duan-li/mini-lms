// Conversions between a `datetime-local` input and the API's ISO times.
// A `datetime-local` value ("2026-11-23T10:00") has no time zone: it means
// the browser's local time. The API needs an explicit offset, so the value is
// sent as "2026-11-23T10:00:00+11:00". No imports: used by forms and tests.

const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/**
 * "2026-11-23T10:00" (local) → "2026-11-23T10:00:00+11:00". Returns null for
 * anything that is not a valid `datetime-local` value.
 */
export function localInputToIso(value: string): string | null {
  if (!LOCAL_INPUT.test(value)) return null;
  // Without an offset, the ECMAScript date-time form is read as local time.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const offset = -date.getTimezoneOffset(); // minutes east of UTC, at that date (DST-aware)
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** An ISO time → "2026-11-23T10:00" in local time, for a `datetime-local` value. */
export function isoToLocalInput(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** How a consultation time is shown: the browser's locale and time zone. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
