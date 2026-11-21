import { ZodError, z } from "zod";

// Typed errors thrown by services and wrappers, and the single place that
// turns any error into an HTTP response. No server-only imports, so the
// mapping is unit-tested directly.

export type FieldErrors = Record<string, string[]>;

export type ErrorBody = {
  error: { code: string; message: string; fields?: FieldErrors };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }

  // Written out, not taken from the constructor: production builds minify
  // class names, and the logs need a readable error class.
  override name = "ApiError";
}

export class ValidationError extends ApiError {
  override name = "ValidationError";

  constructor(message = "Invalid input", fields?: FieldErrors) {
    super(400, "invalid_input", message, fields);
  }
}

export class Unauthorized extends ApiError {
  override name = "Unauthorized";

  constructor(message = "Please sign in.") {
    super(401, "unauthenticated", message);
  }
}

export class Forbidden extends ApiError {
  override name = "Forbidden";

  constructor(message = "You do not have access to this resource.") {
    super(403, "forbidden", message);
  }
}

export class NotFound extends ApiError {
  override name = "NotFound";

  constructor(message = "Consultation not found.") {
    super(404, "not_found", message);
  }
}

export class Conflict extends ApiError {
  override name = "Conflict";

  constructor(message = "You already have a consultation at this time.") {
    super(409, "conflict", message);
  }
}

export class InvalidState extends ApiError {
  override name = "InvalidState";

  constructor(message: string) {
    super(422, "invalid_state", message);
  }
}

/** An unexpected database error. Carries only the code, never the message. */
export class DatabaseError extends Error {
  constructor(readonly code: string | undefined) {
    super(`Unexpected database error${code ? ` (${code})` : ""}`);
    this.name = "DatabaseError";
  }
}

/** A Postgres or PostgREST error as returned by supabase-js. */
export type DbError = { code?: string; message?: string };

/**
 * Translates a database error into a typed error. Codes the app expects come
 * from the unique index (23505), the state trigger (PT422, PT400), grants and
 * RLS (42501), and `.single()` finding no row (PGRST116). Anything else is
 * unexpected and returned as is, to become a 500.
 */
export function fromDbError(error: DbError): Error {
  switch (error.code) {
    case "23505":
      return new Conflict();
    case "PT422":
      return new InvalidState(error.message || "This change is not allowed in the consultation's current state.");
    case "PT400":
      return new ValidationError("Invalid input", { scheduledAt: ["Must be in the future"] });
    case "42501":
      return new Forbidden();
    case "PGRST116":
      return new NotFound();
    default:
      return new DatabaseError(error.code);
  }
}

/** Personal data must never be stored by a browser or proxy cache. */
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function fail(status: number, code: string, message: string, fields?: FieldErrors): Response {
  const body: ErrorBody = { error: fields ? { code, message, fields } : { code, message } };
  return Response.json(body, { status, headers: NO_STORE });
}

/** Zod issues keyed by field path; issues on the whole body go under `_`. */
export function zodFields(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return fail(400, "invalid_input", "Invalid input", zodFields(err));
  }
  if (err instanceof ApiError) {
    return fail(err.status, err.code, err.message, err.fields);
  }
  return fail(500, "internal_error", "Something went wrong. Please try again.");
}

/** Parses a JSON body; a missing or malformed body is a 400, not a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Request body must be JSON");
  }
}

/** Route ids must be UUIDs; anything else cannot exist, so it is a 404. */
export function parseId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new NotFound();
  return id;
}
