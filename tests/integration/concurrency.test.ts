import { afterAll, describe, expect, it } from "vitest";
import {
  ERR,
  bookingInput,
  createStudent,
  deleteCreatedUsers,
  hoursFromNow,
  service,
} from "./helpers";

afterAll(deleteCreatedUsers);

describe("concurrent bookings", () => {
  it("the same student booking the same time twice at once leaves one active row", async () => {
    const a = await createStudent();
    const time = hoursFromNow(24);

    const results = await Promise.all([
      a.client.from("consultations").insert(bookingInput(time)),
      a.client.from("consultations").insert(bookingInput(time)),
    ]);

    const errors = results.map((r) => r.error?.code ?? null).sort();
    expect(errors).toEqual([ERR.duplicate, null].sort());

    const { data } = await service
      .from("consultations")
      .select("id")
      .eq("student_id", a.id)
      .is("cancelled_at", null);
    expect(data).toHaveLength(1);
  });

  it("two different students booking the same time both succeed", async () => {
    const [a, b] = await Promise.all([createStudent("a"), createStudent("b")]);
    const time = hoursFromNow(24);

    const results = await Promise.all([
      a.client.from("consultations").insert(bookingInput(time)),
      b.client.from("consultations").insert(bookingInput(time)),
    ]);

    expect(results.map((r) => r.error)).toEqual([null, null]);
  });
});
