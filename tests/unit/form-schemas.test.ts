import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isoToLocalInput } from "@/lib/datetime";
import {
  bookingFormSchema,
  createConsultationSchema,
  rescheduleConsultationSchema,
  rescheduleFormSchema,
} from "@/lib/validation/consultation";

const localIn = (hours: number) => isoToLocalInput(new Date(Date.now() + hours * 3_600_000));

function fieldErrors(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return z.flattenError(result.error!).fieldErrors as Record<string, string[] | undefined>;
}

describe("bookingFormSchema", () => {
  const form = { firstName: " Alice ", lastName: "Anders", reason: "Essay", scheduledAt: localIn(48) };

  it("turns the datetime-local value into the exact body the API accepts", () => {
    const body = bookingFormSchema.parse(form);
    expect(body.firstName).toBe("Alice");
    expect(body.scheduledAt).toMatch(/Z$/);
    // The output passes the API's own schema unchanged.
    expect(createConsultationSchema.parse(body)).toEqual(body);
  });

  it("keeps the API's name and reason rules", () => {
    const errors = fieldErrors(bookingFormSchema, { ...form, firstName: " ", reason: "x".repeat(1001) });
    expect(errors.firstName).toEqual(["First name is required"]);
    expect(errors.reason).toEqual(["Reason must be at most 1000 characters"]);
  });

  it("rejects a past time", () => {
    expect(fieldErrors(bookingFormSchema, { ...form, scheduledAt: localIn(-1) }).scheduledAt).toEqual([
      "Must be in the future",
    ]);
  });

  it("asks for a time when the field is empty", () => {
    expect(fieldErrors(bookingFormSchema, { ...form, scheduledAt: "" }).scheduledAt).toEqual([
      "Date and time are required",
    ]);
  });

  it("rejects a value that is not a datetime-local", () => {
    expect(fieldErrors(bookingFormSchema, { ...form, scheduledAt: "tomorrow" }).scheduledAt).toEqual([
      "Enter a valid date and time",
    ]);
  });
});

describe("rescheduleFormSchema", () => {
  it("produces a body the API accepts", () => {
    const body = rescheduleFormSchema.parse({ scheduledAt: localIn(72) });
    expect(rescheduleConsultationSchema.parse(body)).toEqual(body);
  });

  it("rejects a past time", () => {
    expect(fieldErrors(rescheduleFormSchema, { scheduledAt: localIn(-24) }).scheduledAt).toEqual([
      "Must be in the future",
    ]);
  });
});
