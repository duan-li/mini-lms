import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

// Refreshes the Supabase session cookie and redirects signed-out visitors
// from pages to the login screen. It is not an authorization layer: pages
// check the session and role themselves, Route Handlers check them again
// (withStudent / withAdmin), and RLS checks every row.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
