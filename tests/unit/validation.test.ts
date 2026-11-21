import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ADMIN_PAGE_SIZE,
  adminListQuerySchema,
  completeConsultationSchema,
  createConsultationSchema,
  rescheduleConsultationSchema,
  updateConsultationSchema,
} from "@/lib/validation/consultation";

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

const valid = {
  firstName: "Alice",
  lastName: "Anders",
  reason: "Review my essay outline",
  scheduledAt: inHours(24),
};

function fieldErrors(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return z.flattenError(result.error!).fieldErrors as Record<string, string[] | undefined>;
}

describe("createConsultationSchema", () => {
  it("accepts a valid booking and trims the text", () => {
    const parsed = createConsultationSchema.parse({ ...valid, firstName: "  Alice  ", reason: " Essay " });
    expect(parsed.firstName).toBe("Alice");
    expect(parsed.reason).toBe("Essay");
  });

  it("checks the year after applying the offset", () => {
    expect(rescheduleConsultationSchema.safeParse({ scheduledAt: "9999-12-31T23:59:59Z" }).success).toBe(true);
    expect(fieldErrors(createConsultationSchema, { ...valid, scheduledAt: "9999-12-31T23:59:59-01:00" }).scheduledAt)
      .toContain("Consultation time must be within UTC year 9999");
  });

  it("normalises the time to UTC", () => {
    const local = new Date(Date.now() + 86_400_000);
    local.setUTCSeconds(0, 0);
    // The same instant written with a +11:00 offset.
    const shifted = new Date(local.getTime() + 11 * 3_600_000).toISOString().replace("Z", "+11:00");
    expect(createConsultationSchema.parse({ ...valid, scheduledAt: shifted }).scheduledAt).toBe(local.toISOString());
  });

  it.each([
    ["firstName", { firstName: "   " }],
    ["lastName", { lastName: "" }],
    ["reason", { reason: " " }],
  ])("rejects an empty %s", (field, change) => {
    expect(fieldErrors(createConsultationSchema, { ...valid, ...change })[field]).toBeDefined();
  });

  it.each([
    ["firstName", { firstName: "x".repeat(101) }],
    ["lastName", { lastName: "x".repeat(101) }],
    ["reason", { reason: "x".repeat(1001) }],
  ])("rejects a %s that is too long", (field, change) => {
    expect(fieldErrors(createConsultationSchema, { ...valid, ...change })[field]).toBeDefined();
  });

  it("accepts the longest allowed values", () => {
    expect(
      createConsultationSchema.safeParse({ ...valid, firstName: "x".repeat(100), reason: "x".repeat(1000) }).success,
    ).toBe(true);
  });

  it("rejects missing fields", () => {
    const errors = fieldErrors(createConsultationSchema, {});
    expect(Object.keys(errors).sort()).toEqual(["firstName", "lastName", "reason", "scheduledAt"]);
  });

  it("rejects a past time", () => {
    expect(fieldErrors(createConsultationSchema, { ...valid, scheduledAt: inHours(-1) }).scheduledAt).toEqual([
      "Must be in the future",
    ]);
  });

  it("rejects a time without an offset, as a datetime-local input sends it", () => {
    expect(
      fieldErrors(createConsultationSchema, { ...valid, scheduledAt: "2099-01-01T10:00" }).scheduledAt,
    ).toBeDefined();
  });

  it("drops student_id and role from the body", () => {
    const parsed = createConsultationSchema.parse({ ...valid, student_id: "someone", studentId: "x", role: "admin" });
    expect(parsed).not.toHaveProperty("student_id");
    expect(parsed).not.toHaveProperty("studentId");
    expect(parsed).not.toHaveProperty("role");
  });
});

describe("completeConsultationSchema and rescheduleConsultationSchema", () => {
  it("complete takes a boolean only", () => {
    expect(completeConsultationSchema.safeParse({ completed: true }).success).toBe(true);
    expect(completeConsultationSchema.safeParse({ completed: "yes" }).success).toBe(false);
  });

  it("reschedule takes a future time only", () => {
    expect(rescheduleConsultationSchema.safeParse({ scheduledAt: inHours(2) }).success).toBe(true);
    expect(rescheduleConsultationSchema.safeParse({ scheduledAt: inHours(-2) }).success).toBe(false);
  });
});

describe("updateConsultationSchema", () => {
  it("parses { completed }", () => {
    expect(updateConsultationSchema.parse({ completed: false })).toEqual({ completed: false });
  });

  it("parses { scheduledAt }", () => {
    const at = inHours(3);
    expect(updateConsultationSchema.parse({ scheduledAt: at })).toEqual({ scheduledAt: at });
  });

  it("rejects both at once, and neither", () => {
    expect(updateConsultationSchema.safeParse({ completed: true, scheduledAt: inHours(3) }).success).toBe(false);
    expect(updateConsultationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a past reschedule with a field error", () => {
    expect(fieldErrors(updateConsultationSchema, { scheduledAt: inHours(-3) }).scheduledAt).toBeDefined();
  });

  it("ignores fields it does not know", () => {
    expect(updateConsultationSchema.parse({ completed: true, completed_at: "2000-01-01T00:00:00Z" })).toEqual({
      completed: true,
    });
  });
});

describe("adminListQuerySchema", () => {
  it("defaults the page size", () => {
    expect(adminListQuerySchema.parse({})).toEqual({ limit: ADMIN_PAGE_SIZE.default });
  });

  it("coerces limit from the query string", () => {
    expect(adminListQuerySchema.parse({ limit: "5", cursor: "abc" })).toEqual({ limit: 5, cursor: "abc" });
  });

  it.each(["0", "101", "1.5", "ten"])("rejects limit=%s", (limit) => {
    expect(adminListQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});
