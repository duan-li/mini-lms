import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiClientError } from "@/lib/api/client";

/**
 * Puts an API error on the form: field errors from a 400 go next to their
 * fields, a 409 goes on the time, anything else on the form as a whole.
 * Returns the message shown at the top of the form, if any.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
): string | null {
  if (!(error instanceof ApiClientError)) return "Something went wrong. Please try again.";

  if (error.status === 409 && fields.includes("scheduledAt" as Path<T>)) {
    setError("scheduledAt" as Path<T>, { type: "server", message: error.message });
    return null;
  }

  let placed = false;
  for (const [name, messages] of Object.entries(error.fields ?? {})) {
    if (fields.includes(name as Path<T>) && messages[0]) {
      setError(name as Path<T>, { type: "server", message: messages[0] });
      placed = true;
    }
  }
  return placed ? null : error.message;
}
