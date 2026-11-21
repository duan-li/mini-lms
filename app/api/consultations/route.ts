import { readJson } from "@/lib/api/errors";
import { withStudent } from "@/lib/api/with-auth";
import { createConsultation, listConsultations } from "@/lib/services/consultations";
import { createConsultationSchema } from "@/lib/validation/consultation";

export const GET = withStudent(async ({ supabase, user }) => {
  return Response.json({ data: await listConsultations(supabase, user.id) });
});

export const POST = withStudent(async ({ req, supabase, user }) => {
  const input = createConsultationSchema.parse(await readJson(req));
  return Response.json({ data: await createConsultation(supabase, user.id, input) }, { status: 201 });
});
