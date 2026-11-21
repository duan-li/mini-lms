import { withStudent } from "@/lib/api/with-auth";
import { cancelConsultation } from "@/lib/services/consultations";

export const POST = withStudent<{ id: string }>(async ({ supabase, user, params }) => {
  const { id } = await params;
  return Response.json({ data: await cancelConsultation(supabase, user.id, id) });
});
