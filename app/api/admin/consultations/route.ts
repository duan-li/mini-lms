import { withAdmin } from "@/lib/api/with-auth";
import { listAllConsultations } from "@/lib/services/consultations";
import { adminListQuerySchema } from "@/lib/validation/consultation";

export const GET = withAdmin(async ({ req, supabase }) => {
  const query = adminListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return Response.json(await listAllConsultations(supabase, query));
});
