import { describe, expect, it } from "vitest";
import { toAdminConsultationDTO, toConsultationDTO } from "@/lib/services/consultation-dto";

const row = {
  id: "6f1d1c9e-8d5b-4f3e-9a51-3c2b1a0f9e8d",
  student_id: "00000000-0000-4000-8000-00000000000a",
  first_name: "Alice",
  last_name: "Anders",
  reason: "Review my essay outline",
  scheduled_at: "2026-11-23T10:00:00+00:00",
  completed_at: null,
  cancelled_at: null,
};

describe("toConsultationDTO", () => {
  it("maps snake_case columns to camelCase fields", () => {
    expect(toConsultationDTO(row)).toEqual({
      id: row.id,
      firstName: "Alice",
      lastName: "Anders",
      reason: "Review my essay outline",
      scheduledAt: "2026-11-23T10:00:00+00:00",
      status: "scheduled",
    });
  });

  it("derives status from the timestamps", () => {
    expect(toConsultationDTO({ ...row, completed_at: "2026-11-23T11:00:00+00:00" }).status).toBe("completed");
    expect(toConsultationDTO({ ...row, cancelled_at: "2026-11-22T11:00:00+00:00" }).status).toBe("cancelled");
  });

  it("never gives a student the studentId or the raw timestamps", () => {
    const dto = toConsultationDTO({ ...row, completed_at: "2026-11-23T11:00:00+00:00" });
    expect(dto).not.toHaveProperty("studentId");
    expect(dto).not.toHaveProperty("student_id");
    expect(dto).not.toHaveProperty("completed_at");
  });
});

describe("toAdminConsultationDTO", () => {
  it("adds studentId so the admin knows whose booking it is", () => {
    expect(toAdminConsultationDTO(row)).toEqual({ ...toConsultationDTO(row), studentId: row.student_id });
  });
});
