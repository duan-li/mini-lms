import { readJson } from "@/lib/api/errors";
import { withStudent } from "@/lib/api/with-auth";
import { updateConsultation } from "@/lib/services/consultations";
import { updateConsultationSchema } from "@/lib/validation/consultation";

export const PATCH = withStudent<{ id: string }>(async ({ req, supabase, user, params }) => {
  const { id } = await params;
  const input = updateConsultationSchema.parse(await readJson(req));
  return Response.json({ data: await updateConsultation(supabase, user.id, id, input) });
});
