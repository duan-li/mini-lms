import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, inject, it } from "vitest";
import { Conflict, DatabaseError, InvalidState, NotFound, ValidationError } from "@/lib/api/errors";
import type { Database } from "@/lib/database.types";
import {
  cancelConsultation,
  createConsultation,
  listAllConsultations,
  listConsultations,
  updateConsultation,
} from "@/lib/services/consultations";
import { encodeCursor } from "@/lib/services/cursor";
import {
  type Db,
  book,
  createAdmin,
  createStudent,
  deleteCreatedUsers,
  hoursFromNow,
  msFromNow,
  readRow,
  sameInstant,
  service,
  sleep,
} from "./helpers";

// The service layer called directly with a client signed in as each role, the
// way a Route Handler calls it. The HTTP tests prove the status codes; these
// prove the use cases themselves, and give lib/services its line coverage.

afterAll(deleteCreatedUsers);

const input = (scheduledAt: string) => ({
  firstName: "Service",
  lastName: "Test",
  reason: "Service layer test",
  scheduledAt,
});

/** A client whose token PostgREST rejects: every query returns an error. */
function brokenClient(): Db {
  const env = inject("supabase");
  return createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer not-a-jwt" } },
  });
}

describe("createConsultation", () => {
  it("books as the caller and returns a scheduled DTO without studentId", async () => {
    const a = await createStudent();

    const dto = await createConsultation(a.client, a.id, input(hoursFromNow(24)));

    expect(dto).toMatchObject({ firstName: "Service", lastName: "Test", status: "scheduled" });
    expect(dto).not.toHaveProperty("studentId");
    expect((await readRow(dto.id)).student_id).toBe(a.id);
  });

  it("throws Conflict for the same student and time", async () => {
    const a = await createStudent();
    const at = hoursFromNow(25);
    await createConsultation(a.client, a.id, input(at));

    await expect(createConsultation(a.client, a.id, input(at))).rejects.toBeInstanceOf(Conflict);
  });

  it("refuses a booking whose owner is not the session user", async () => {
    const a = await createStudent();
    const b = await createStudent();

    // The database sets student_id from the session (A), not from the caller's claim (B).
    await expect(createConsultation(a.client, b.id, input(hoursFromNow(26)))).rejects.toThrow(
      "Booking owner does not match the session user",
    );
  });

  it("turns a database error into a typed error", async () => {
    await expect(
      createConsultation(brokenClient(), "00000000-0000-4000-8000-000000000000", input(hoursFromNow(27))),
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe("listConsultations", () => {
  it("lists only the caller's rows, cancelled included, by consultation time", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const later = await book(a, hoursFromNow(30));
    const earlier = await book(a, hoursFromNow(29));
    await cancelConsultation(a.client, a.id, later.id);
    await book(b, hoursFromNow(29));

    const list = await listConsultations(a.client, a.id);

    expect(list.map((c) => [c.id, c.status])).toEqual([
      [earlier.id, "scheduled"],
      [later.id, "cancelled"],
    ]);
  });

  it("returns an empty list for a student with no bookings", async () => {
    const a = await createStudent();
    await expect(listConsultations(a.client, a.id)).resolves.toEqual([]);
  });

  it("reads past the 1,000-row response cap", async () => {
    const a = await createStudent();
    const start = Date.now() + 48 * 3_600_000;
    const rows = Array.from({ length: 1_005 }, (_, i) => ({
      student_id: a.id,
      first_name: "Many",
      last_name: "Rows",
      reason: "Paging test",
      scheduled_at: new Date(start + i * 60_000).toISOString(),
    }));
    const { error } = await service.from("consultations").insert(rows);
    expect(error).toBeNull();

    const list = await listConsultations(a.client, a.id);

    expect(list).toHaveLength(1_005);
    expect(new Set(list.map((c) => c.id)).size).toBe(1_005);
  });

  it("turns a database error into a typed error", async () => {
    await expect(listConsultations(brokenClient(), "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
      DatabaseError,
    );
  });
});

describe("updateConsultation", () => {
  it("completes, repeats without writing, then marks incomplete", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(31));

    const done = await updateConsultation(a.client, a.id, row.id, { completed: true });
    const first = await readRow(row.id);
    const repeat = await updateConsultation(a.client, a.id, row.id, { completed: true });
    const second = await readRow(row.id);
    const undone = await updateConsultation(a.client, a.id, row.id, { completed: false });

    expect(done.status).toBe("completed");
    expect(repeat.status).toBe("completed");
    expect(sameInstant(second.completed_at, first.completed_at)).toBe(true);
    expect(sameInstant(second.updated_at, first.updated_at)).toBe(true);
    expect(undone.status).toBe("scheduled");
    expect((await readRow(row.id)).completed_at).toBeNull();
  });

  it("completes a booking whose time has passed", async () => {
    const a = await createStudent();
    const row = await book(a, msFromNow(1_500));
    await sleep(2_000);

    await expect(updateConsultation(a.client, a.id, row.id, { completed: true })).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("reschedules a scheduled booking to a future time", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(32));
    const to = hoursFromNow(33);

    const moved = await updateConsultation(a.client, a.id, row.id, { scheduledAt: to });

    expect(sameInstant(moved.scheduledAt, to)).toBe(true);
  });

  it("rejects a past reschedule as invalid input on scheduledAt", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(34));

    const error = await updateConsultation(a.client, a.id, row.id, { scheduledAt: hoursFromNow(-1) }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ fields: { scheduledAt: [expect.any(String)] } });
  });

  it("rejects rescheduling a completed booking", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(35));
    await updateConsultation(a.client, a.id, row.id, { completed: true });

    await expect(
      updateConsultation(a.client, a.id, row.id, { scheduledAt: hoursFromNow(36) }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("rejects completing a cancelled booking", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(37));
    await cancelConsultation(a.client, a.id, row.id);

    await expect(updateConsultation(a.client, a.id, row.id, { completed: true })).rejects.toBeInstanceOf(
      InvalidState,
    );
  });

  it("throws Conflict when the new time is already booked", async () => {
    const a = await createStudent();
    const taken = hoursFromNow(38);
    await book(a, taken);
    const row = await book(a, hoursFromNow(39));

    await expect(updateConsultation(a.client, a.id, row.id, { scheduledAt: taken })).rejects.toBeInstanceOf(
      Conflict,
    );
  });

  it("treats another student's booking, an unknown ID and a malformed ID as not found", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const bRow = await book(b, hoursFromNow(40));

    await expect(updateConsultation(a.client, a.id, bRow.id, { completed: true })).rejects.toBeInstanceOf(NotFound);
    await expect(
      updateConsultation(a.client, a.id, "00000000-0000-4000-8000-000000000000", { completed: true }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(updateConsultation(a.client, a.id, "not-a-uuid", { completed: true })).rejects.toBeInstanceOf(
      NotFound,
    );
    expect((await readRow(bRow.id)).completed_at).toBeNull();
  });

  it("turns a database error into a typed error", async () => {
    await expect(
      updateConsultation(brokenClient(), "00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001", {
        completed: true,
      }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it("an admin cannot change a booking it made before promotion", async () => {
    let own = "";
    const admin = await createAdmin(async (asStudent) => {
      own = (await book(asStudent, hoursFromNow(41))).id;
    });

    // RLS lets the admin read the row, but no write policy matches it.
    await expect(updateConsultation(admin.client, admin.id, own, { completed: true })).rejects.toBeInstanceOf(
      NotFound,
    );
    expect((await readRow(own)).completed_at).toBeNull();
  });
});

describe("cancelConsultation", () => {
  it("cancels a scheduled booking and keeps the row", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(42));

    const dto = await cancelConsultation(a.client, a.id, row.id);

    expect(dto.status).toBe("cancelled");
    expect((await readRow(row.id)).cancelled_at).not.toBeNull();
  });

  it("rejects a second cancel", async () => {
    const a = await createStudent();
    const row = await book(a, hoursFromNow(43));
    await cancelConsultation(a.client, a.id, row.id);

    await expect(cancelConsultation(a.client, a.id, row.id)).rejects.toBeInstanceOf(InvalidState);
  });
});

describe("listAllConsultations", () => {
  it("pages through every booking; two at the same time land on different pages", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const admin = await createAdmin();
    // Years ahead, so these sort after every other test's bookings.
    const at = new Date(Date.UTC(2099, 0, 1, 10)).toISOString();
    const rowA = await book(a, at);
    const rowB = await book(b, at);
    const [first, second] = [rowA, rowB].sort((x, y) => x.id.localeCompare(y.id));

    // A cursor just before the shared time, so the test sees only these rows.
    const start = encodeCursor({ scheduledAt: "2098-12-31T00:00:00+00:00", id: "00000000-0000-4000-8000-000000000000" });
    const page1 = await listAllConsultations(admin.client, { cursor: start, limit: 1 });
    const page2 = await listAllConsultations(admin.client, { cursor: page1.nextCursor!, limit: 1 });

    expect(page1.data.map((c) => c.id)).toEqual([first.id]);
    expect(page2.data.map((c) => c.id)).toEqual([second.id]);
    expect(page1.data[0].studentId).toBe(first.student_id);
    expect(page1.nextCursor).not.toBeNull();
    expect(page2.nextCursor).toBeNull();
  });

  it("the first page has no cursor and ends with nextCursor null when everything fits", async () => {
    const admin = await createAdmin();

    const page = await listAllConsultations(admin.client, { limit: 100 });

    expect(page.data.length).toBeGreaterThan(0);
    if (page.data.length < 100) expect(page.nextCursor).toBeNull();
  });

  it("rejects a cursor it did not issue", async () => {
    const admin = await createAdmin();

    const error = await listAllConsultations(admin.client, { cursor: "garbage", limit: 10 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ fields: { cursor: ["Invalid cursor"] } });
  });

  it("turns a database error into a typed error", async () => {
    await expect(listAllConsultations(brokenClient(), { limit: 10 })).rejects.toBeInstanceOf(DatabaseError);
  });
});
