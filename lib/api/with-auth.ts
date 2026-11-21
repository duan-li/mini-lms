import "server-only";

import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ApiError, Forbidden, NO_STORE, Unauthorized, fromDbError, toErrorResponse } from "@/lib/api/errors";
import { createClient, type Db } from "@/lib/supabase/server";

// Every API route goes through withAuth: it verifies the user, builds the
// user's session client (never the service role, so RLS always applies),
// checks the role, maps errors to HTTP codes in one place, logs failures and
// marks every response as private.

export type AuthContext<P> = {
  req: NextRequest;
  supabase: Db;
  user: User;
  params: Promise<P>;
};

type Role = "student" | "admin";
type Handler<P> = (ctx: AuthContext<P>) => Promise<Response>;
type RouteHandler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

export function withAuth<P = Record<string, never>>(handler: Handler<P>, role?: Role): RouteHandler<P> {
  return async (req, { params }) => {
    const requestId = crypto.randomUUID();
    let userId: string | undefined;
    let response: Response;
    try {
      const supabase = await createClient();
      // getUser() checks the token with Supabase Auth; getSession() would not.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Unauthorized();
      userId = user.id;
      if (role) await requireRole(supabase, role);
      response = await handler({ req, supabase, user, params });
    } catch (err) {
      log(err, { requestId, req, userId });
      response = toErrorResponse(err);
    }
    for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
    response.headers.set("X-Request-Id", requestId);
    return response;
  };
}

/** Student routes, reads included: an admin gets 403. */
export function withStudent<P = Record<string, never>>(handler: Handler<P>): RouteHandler<P> {
  return withAuth(handler, "student");
}

/** Admin routes: a student gets 403. */
export function withAdmin<P = Record<string, never>>(handler: Handler<P>): RouteHandler<P> {
  return withAuth(handler, "admin");
}

/** Roles live in profiles.role; is_admin() reads it for the signed-in user. */
async function requireRole(supabase: Db, role: Role): Promise<void> {
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw fromDbError(error);
  if ((role === "admin") !== isAdmin) {
    throw new Forbidden(
      role === "admin" ? "Only admins can use this route." : "Admins have read-only access to consultations.",
    );
  }
}

/**
 * One line per failed request: request ID, route, user ID and error class.
 * Never the body (it holds the consultation reason), cookies, tokens or
 * error messages from the database.
 */
function log(err: unknown, ctx: { requestId: string; req: Request; userId?: string }): void {
  const status = err instanceof ApiError ? err.status : 500;
  const entry = {
    level: status >= 500 ? "error" : "warn",
    requestId: ctx.requestId,
    method: ctx.req.method,
    route: new URL(ctx.req.url).pathname,
    userId: ctx.userId ?? null,
    status,
    errorClass: err instanceof Error ? err.name : typeof err,
    code: err instanceof ApiError ? err.code : ((err as { code?: string } | null)?.code ?? null),
  };
  if (status >= 500) console.error(JSON.stringify(entry));
  else console.warn(JSON.stringify(entry));
}
