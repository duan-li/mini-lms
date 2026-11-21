import type { Tables } from "@/lib/database.types";
import { statusOf, type ConsultationStatus } from "@/lib/services/consultation-rules";

// Row → DTO mappers. snake_case rows become camelCase API fields, `status` is
// derived from the timestamps, and columns the client does not need stay out.
// Type-only imports from the UI are safe: this file has no server-only code.

type Row = Tables<"consultations">;

export type ConsultationDTO = {
  id: string;
  firstName: string;
  lastName: string;
  reason: string;
  scheduledAt: string;
  status: ConsultationStatus;
};

/** Admins also see whose booking it is. Students never receive `studentId`. */
export type AdminConsultationDTO = ConsultationDTO & { studentId: string };

/** The columns the mappers read: services select only these. */
export const CONSULTATION_COLUMNS =
  "id, student_id, first_name, last_name, reason, scheduled_at, completed_at, cancelled_at" as const;

export type ConsultationRecord = Pick<
  Row,
  "id" | "student_id" | "first_name" | "last_name" | "reason" | "scheduled_at" | "completed_at" | "cancelled_at"
>;

export function toConsultationDTO(row: ConsultationRecord): ConsultationDTO {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: statusOf(row),
  };
}

export function toAdminConsultationDTO(row: ConsultationRecord): AdminConsultationDTO {
  return { ...toConsultationDTO(row), studentId: row.student_id };
}
