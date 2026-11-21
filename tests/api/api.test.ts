import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";
import { deleteCreatedUsers, msFromNow, readRow, sameInstant, service, sleep } from "../integration/helpers";
import {
  Api,
  type ApiUser,
  type DataBody,
  type ErrorBody,
  anonymous,
  apiAdmin,
  apiStudent,
  bookingBody,
  duringAuthOutage,
} from "./http";

// Every row of the API column in the design's Test coverage table, over HTTP
// against a real Next.js server, with real session cookies.

afterAll(deleteCreatedUsers);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

/** Books through the API and returns the new consultation. */
async function book(user: ApiUser, hours: number): Promise<ConsultationDTO> {
  const res = await user.api.book(bookingBody(hours));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect((res.body as ErrorBody).error.code).toBe(code);
  expect(typeof (res.body as ErrorBody).error.message).toBe("string");
}

describe("signed out", () => {
  it.each([
    ["GET", "/api/consultations", undefined],
    ["POST", "/api/consultations", bookingBody(24)],
    ["PATCH", `/api/consultations/${MISSING_ID}`, { completed: true }],
    ["POST", `/api/consultations/${MISSING_ID}/cancel`, undefined],
    ["GET", "/api/admin/consultations", undefined],
  ])("%s %s returns 401, not a login redirect", async (method, path, body) => {
    expectError(await anonymous.request(method, path, body), 401, "unauthenticated");
  });

  it("an invalid session cookie is still 401", async () => {
    const forged = new Api("sb-127-auth-token=base64-eyJmb3JnZWQiOnRydWV9");
    expectError(await forged.list(), 401, "unauthenticated");
  });
});

describe("Supabase Auth unavailable", () => {
  it("a signed-in caller gets a generic 500, not 401 'Please sign in'", async () => {
    const student = await apiStudent();

    const [list, booking] = await duringAuthOutage(() =>
      Promise.all([student.api.list(), student.api.book(bookingBody(24))]),
    );

    for (const res of [list, booking]) {
      expectError(res, 500, "internal_error");
      expect((res.body as unknown as ErrorBody).error.message).toBe("Something went wrong. Please try again.");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    // Nothing was written, and the same cookies work once Auth is back.
    const after = await student.api.list();
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual([]);
  });

  it("a signed-out caller is still 401 during the outage (no session to check)", async () => {
    await duringAuthOutage(async () => {
      expectError(await anonymous.list(), 401, "unauthenticated");
    });
  });
});

describe("GET /api/consultations", () => {
  let a: ApiUser;
  let b: ApiUser;

  beforeAll(async () => {
    [a, b] = await Promise.all([apiStudent("a"), apiStudent("b")]);
    await book(a, 48);
    await book(a, 24);
    await book(b, 24);
  });

  it("200 with only the caller's own bookings, by consultation time", async () => {
    const res = await a.api.list();

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const times = res.body.data.map((c) => new Date(c.scheduledAt).getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("includes cancelled bookings", async () => {
    const student = await apiStudent();
    const booking = await book(student, 30);
    await student.api.cancel(booking.id);

    const res = await student.api.list();
    expect(res.body.data).toEqual([expect.objectContaining({ id: booking.id, status: "cancelled" })]);
  });

  it("returns DTOs: camelCase, derived status, no studentId", async () => {
    const [first] = (await a.api.list()).body.data;

    expect(Object.keys(first).sort()).toEqual(["firstName", "id", "lastName", "reason", "scheduledAt", "status"]);
    expect(first.status).toBe("scheduled");
  });

  it("sends Cache-Control: private, no-store", async () => {
    expect((await a.api.list()).headers.get("cache-control")).toBe("private, no-store");
  });

  it("403 for an admin, even one with bookings of its own", async () => {
    const admin = await apiAdmin(async (asStudent) => {
      const { error } = await asStudent.client.from("consultations").insert({
        first_name: "Ada",
        last_name: "Admin",
        reason: "Before promotion",
        scheduled_at: bookingBody(24).scheduledAt,
      });
      if (error) throw error;
    });

    expectError(await admin.api.list(), 403, "forbidden");
  });
});

describe("POST /api/consultations", () => {
  let student: ApiUser;

  beforeAll(async () => {
    student = await apiStudent();
  });

  it("201 with a scheduled booking in { data }", async () => {
    const body = bookingBody(72, { firstName: "  Alice ", reason: " Essay " });
    const res = await student.api.book(body);

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.data).toMatchObject({ firstName: "Alice", lastName: "Tester", reason: "Essay", status: "scheduled" });
    expect(sameInstant(res.body.data.scheduledAt, body.scheduledAt)).toBe(true);
  });

  it("400 with field errors for empty names and a long reason", async () => {
    const res = await student.api.book(bookingBody(73, { firstName: " ", lastName: "", reason: "x".repeat(1001) }));

    expectError(res, 400, "invalid_input");
    expect(Object.keys((res.body as unknown as ErrorBody).error.fields!).sort()).toEqual([
      "firstName",
      "lastName",
      "reason",
    ]);
  });

  it("400 for a past time", async () => {
    const res = await student.api.book(bookingBody(-1));

    expectError(res, 400, "invalid_input");
    expect((res.body as unknown as ErrorBody).error.fields).toHaveProperty("scheduledAt");
  });

  it("400 for a time without an offset", async () => {
    expectError(await student.api.book(bookingBody(74, { scheduledAt: "2099-01-01T10:00" })), 400, "invalid_input");
  });

  it("400 for a body that is not JSON", async () => {
    expectError(await student.api.request("POST", "/api/consultations", "{not json"), 400, "invalid_input");
  });

  it("409 when the same student books the same time again", async () => {
    await book(student, 75);
    expectError(await student.api.book(bookingBody(75)), 409, "conflict");
  });

  it("ignores student_id and role in the body", async () => {
    const other = await apiStudent("victim");
    const res = await student.api.book(
      bookingBody(76, { student_id: other.id, studentId: other.id, role: "admin" }),
    );

    expect(res.status).toBe(201);
    expect((await readRow(res.body.data.id)).student_id).toBe(student.id);
    const { data: profile } = await service.from("profiles").select("role").eq("id", student.id).single();
    expect(profile?.role).toBe("student");
  });

  it("403 for an admin", async () => {
    const admin = await apiAdmin();
    expectError(await admin.api.book(bookingBody(24)), 403, "forbidden");
  });
});

describe("PATCH /api/consultations/:id", () => {
  let student: ApiUser;

  beforeAll(async () => {
    student = await apiStudent();
  });

  it("200 to complete, then 200 to mark incomplete", async () => {
    const booking = await book(student, 100);

    const done = await student.api.update(booking.id, { completed: true });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("completed");
    expect((await readRow(booking.id)).completed_at).not.toBeNull();

    const undone = await student.api.update(booking.id, { completed: false });
    expect(undone.status).toBe(200);
    expect(undone.body.data.status).toBe("scheduled");
    expect((await readRow(booking.id)).completed_at).toBeNull();
  });

  it("a repeat { completed: true } returns 200 and changes nothing", async () => {
    const booking = await book(student, 101);
    await student.api.update(booking.id, { completed: true });
    const before = await readRow(booking.id);
    await sleep(50);

    const again = await student.api.update(booking.id, { completed: true });

    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("completed");
    const after = await readRow(booking.id);
    expect(sameInstant(after.completed_at, before.completed_at)).toBe(true);
    expect(sameInstant(after.updated_at, before.updated_at)).toBe(true);
  });

  it("{ completed: false } on a scheduled booking returns 200 and changes nothing", async () => {
    const booking = await book(student, 102);
    const before = await readRow(booking.id);

    const res = await student.api.update(booking.id, { completed: false });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("scheduled");
    expect(sameInstant((await readRow(booking.id)).updated_at, before.updated_at)).toBe(true);
  });

  it("422 to complete a cancelled booking", async () => {
    const booking = await book(student, 103);
    await student.api.cancel(booking.id);

    expectError(await student.api.update(booking.id, { completed: true }), 422, "invalid_state");
  });

  it("200 to reschedule a scheduled booking", async () => {
    const booking = await book(student, 104);
    const to = bookingBody(105).scheduledAt;

    const res = await student.api.update(booking.id, { scheduledAt: to });

    expect(res.status).toBe(200);
    expect(sameInstant(res.body.data.scheduledAt, to)).toBe(true);
    expect(res.body.data.status).toBe("scheduled");
  });

  it("409 to reschedule onto a time the student already has", async () => {
    const first = await book(student, 106);
    await book(student, 107);

    expectError(await student.api.update(first.id, { scheduledAt: bookingBody(107).scheduledAt }), 409, "conflict");
  });

  it("422 to reschedule a completed booking", async () => {
    const booking = await book(student, 108);
    await student.api.update(booking.id, { completed: true });

    expectError(
      await student.api.update(booking.id, { scheduledAt: bookingBody(109).scheduledAt }),
      422,
      "invalid_state",
    );
  });

  it("400 to reschedule to a past time", async () => {
    const booking = await book(student, 110);
    const res = await student.api.update(booking.id, { scheduledAt: bookingBody(-2).scheduledAt });

    expectError(res, 400, "invalid_input");
    expect((res.body as unknown as ErrorBody).error.fields).toHaveProperty("scheduledAt");
  });

  it("400 for both fields at once, or neither", async () => {
    const booking = await book(student, 111);

    expectError(
      await student.api.update(booking.id, { completed: true, scheduledAt: bookingBody(112).scheduledAt }),
      400,
      "invalid_input",
    );
    expectError(await student.api.update(booking.id, {}), 400, "invalid_input");
  });

  it("200 to complete a booking whose time has passed", async () => {
    const res = await student.api.book({ ...bookingBody(0), scheduledAt: msFromNow(2_000) });
    expect(res.status).toBe(201);
    await sleep(2_500);

    const done = await student.api.update(res.body.data.id, { completed: true });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("completed");

    const undone = await student.api.update(res.body.data.id, { completed: false });
    expect(undone.status).toBe(200);
  });

  it("404 for another student's booking, which stays unchanged", async () => {
    const other = await apiStudent("other");
    const theirs = await book(other, 24);

    expectError(await student.api.update(theirs.id, { completed: true }), 404, "not_found");
    expectError(
      await student.api.update(theirs.id, { scheduledAt: bookingBody(30).scheduledAt }),
      404,
      "not_found",
    );
    const row = await readRow(theirs.id);
    expect(row.completed_at).toBeNull();
    expect(sameInstant(row.scheduled_at, theirs.scheduledAt)).toBe(true);
  });

  it("404 for an id that does not exist or is not a UUID", async () => {
    expectError(await student.api.update(MISSING_ID, { completed: true }), 404, "not_found");
    expectError(await student.api.update("42", { completed: true }), 404, "not_found");
  });

  it("ignores completed_at sent by the client", async () => {
    const booking = await book(student, 113);
    await student.api.update(booking.id, { completed: true, completed_at: "2000-01-01T00:00:00Z" });

    const row = await readRow(booking.id);
    expect(Math.abs(new Date(row.completed_at!).getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("403 for an admin, including on the admin's own pre-promotion booking", async () => {
    let ownId = "";
    const admin = await apiAdmin(async (asStudent) => {
      const { data, error } = await asStudent.client
        .from("consultations")
        .insert({ first_name: "Ada", last_name: "Admin", reason: "Before promotion", scheduled_at: bookingBody(24).scheduledAt })
        .select("id")
        .single();
      if (error) throw error;
      ownId = data.id;
    });

    expectError(await admin.api.update(ownId, { completed: true }), 403, "forbidden");
    expect((await readRow(ownId)).completed_at).toBeNull();
  });
});

describe("POST /api/consultations/:id/cancel", () => {
  let student: ApiUser;

  beforeAll(async () => {
    student = await apiStudent();
  });

  it("200 and the row stays, cancelled", async () => {
    const booking = await book(student, 200);

    const res = await student.api.cancel(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: booking.id, status: "cancelled" });
    expect((await readRow(booking.id)).cancelled_at).not.toBeNull();
  });

  it("422 for an already cancelled booking", async () => {
    const booking = await book(student, 201);
    await student.api.cancel(booking.id);

    expectError(await student.api.cancel(booking.id), 422, "invalid_state");
  });

  it("422 for a completed booking", async () => {
    const booking = await book(student, 202);
    await student.api.update(booking.id, { completed: true });

    expectError(await student.api.cancel(booking.id), 422, "invalid_state");
  });

  it("404 for another student's booking", async () => {
    const other = await apiStudent("other");
    const theirs = await book(other, 24);

    expectError(await student.api.cancel(theirs.id), 404, "not_found");
    expect((await readRow(theirs.id)).cancelled_at).toBeNull();
  });

  it("frees the time to book again", async () => {
    const booking = await book(student, 203);
    await student.api.cancel(booking.id);

    expect((await student.api.book(bookingBody(203))).status).toBe(201);
  });

  it("403 for an admin", async () => {
    const admin = await apiAdmin();
    expectError(await admin.api.cancel(MISSING_ID), 403, "forbidden");
  });
});

describe("GET /api/admin/consultations", () => {
  let admin: ApiUser;

  beforeAll(async () => {
    admin = await apiAdmin();
  });

  it("200 for an admin, with studentId on every row", async () => {
    const student = await apiStudent();
    const booking = await book(student, 300);

    const res = await admin.api.adminList({ limit: 100 });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.studentId).toEqual(expect.any(String));
    const all = await walkAll(admin, 100);
    expect(all.find((row) => row.id === booking.id)).toMatchObject({ studentId: student.id, status: "scheduled" });
  });

  it("includes cancelled bookings", async () => {
    const student = await apiStudent();
    const booking = await book(student, 301);
    await student.api.cancel(booking.id);

    const all = await walkAll(admin, 100);
    expect(all.find((row) => row.id === booking.id)?.status).toBe("cancelled");
  });

  it("403 for a student", async () => {
    const student = await apiStudent();
    expectError(await student.api.adminList(), 403, "forbidden");
  });

  it("pages with nextCursor; two bookings at the same time fall on different pages and both appear once", async () => {
    const [a, b] = await Promise.all([apiStudent("a"), apiStudent("b")]);
    // The same instant for both students: a tie on scheduled_at.
    const body = bookingBody(24 * 365 * 50 + Math.floor(Math.random() * 1000));
    const [ra, rb] = await Promise.all([a.api.book(body), b.api.book(body)]);
    expect([ra.status, rb.status]).toEqual([201, 201]);

    const pages: string[][] = [];
    const seen: { id: string; scheduledAt: string }[] = [];
    let cursor: string | null = null;
    do {
      const res = await admin.api.adminList({ cursor, limit: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
      pages.push(res.body.data.map((row) => row.id));
      seen.push(...res.body.data);
      cursor = res.body.nextCursor;
    } while (cursor);

    // Ends with nextCursor null; no row twice; ordered by (scheduledAt, id).
    const ids = seen.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < seen.length; i++) {
      const [prev, next] = [seen[i - 1], seen[i]];
      const order = new Date(prev.scheduledAt).getTime() - new Date(next.scheduledAt).getTime();
      expect(order < 0 || (order === 0 && prev.id < next.id), `${prev.id} before ${next.id}`).toBe(true);
    }
    const pageOf = (id: string) => pages.findIndex((page) => page.includes(id));
    expect(pageOf(ra.body.data.id)).toBeGreaterThanOrEqual(0);
    expect(pageOf(rb.body.data.id)).toBeGreaterThanOrEqual(0);
    expect(pageOf(ra.body.data.id)).not.toBe(pageOf(rb.body.data.id));
  });

  it("400 for a cursor it did not issue, or a bad limit", async () => {
    expectError(await admin.api.adminList({ cursor: "not-a-cursor" }), 400, "invalid_input");
    expectError(await admin.api.adminList({ limit: 0 }), 400, "invalid_input");
    expectError(await admin.api.adminList({ limit: 1000 }), 400, "invalid_input");
  });
});

describe("concurrent requests", () => {
  it("two identical bookings at once: one 201, one 409", async () => {
    const student = await apiStudent();
    const body = bookingBody(400);

    const results = await Promise.all([student.api.book(body), student.api.book(body)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe("one booking through its whole life, with a student's cookies", () => {
  it("book T1, complete, mark incomplete, reschedule to T2, rebook T1, cancel T2, rebook T2", async () => {
    const student = await apiStudent();
    const t1 = bookingBody(500);
    const t2 = bookingBody(501).scheduledAt;

    const booked = await student.api.book(t1);
    expect(booked.status).toBe(201);
    const id = booked.body.data.id;

    expect((await student.api.update(id, { completed: true })).body.data.status).toBe("completed");
    expect((await student.api.update(id, { completed: false })).body.data.status).toBe("scheduled");

    const moved = await student.api.update(id, { scheduledAt: t2 });
    expect(moved.status).toBe(200);
    expect(sameInstant(moved.body.data.scheduledAt, t2)).toBe(true);

    // Rescheduling freed T1.
    expect((await student.api.book(t1)).status).toBe(201);

    const cancelled = await student.api.cancel(id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");

    // Cancelling freed T2; the cancelled row stays in the list.
    expect((await student.api.book({ ...t1, scheduledAt: t2 })).status).toBe(201);
    const list = (await student.api.list()).body as DataBody<ConsultationDTO[]>;
    expect(list.data.map((c) => c.status).sort()).toEqual(["cancelled", "scheduled", "scheduled"]);
  });
});

/** Every row the admin can see, following nextCursor to the end. */
async function walkAll(admin: ApiUser, limit: number) {
  const rows = [];
  let cursor: string | null = null;
  do {
    const res = await admin.api.adminList({ cursor, limit });
    expect(res.status).toBe(200);
    rows.push(...res.body.data);
    cursor = res.body.nextCursor;
  } while (cursor);
  return rows;
}
