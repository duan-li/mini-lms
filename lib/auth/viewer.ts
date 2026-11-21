import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Who is looking at a page. Server Components use this to decide what to
// render and where to redirect; it is not what protects data. The Route
// Handlers check the session and role again, and RLS checks every row.

export type Viewer = { id: string; email: string | null; role: "student" | "admin" };

/**
 * The signed-in user and their role, or null when signed out. getClaims()
 * verifies the JWT (getSession() would not); the role comes from
 * profiles.role through is_admin(), never from user metadata. Cached for one
 * request, so the header and the page share one lookup.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Could not load the role (${error.code ?? "unknown"})`);

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    role: isAdmin ? "admin" : "student",
  };
});
