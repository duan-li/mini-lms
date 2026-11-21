import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ERR,
  type ConsultationRow,
  type TestUser,
  anonClient,
  book,
  bookingInput,
  createAdmin,
  createStudent,
  deleteCreatedUsers,
  expectErrorCode,
  hoursFromNow,
  readRow,
  service,
} from "./helpers";

afterAll(deleteCreatedUsers);

describe("profiles", () => {
  it("sign-up creates a student profile", async () => {
    const a = await createStudent();

    const { data, error } = await a.client.from("profiles").select("id, role");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.id, role: "student" }]);
  });

  it("a student sees only their own profile; an admin sees all", async () => {
    const a = await createStudent();
    const b = await createStudent();
    const admin = await createAdmin();

    const asA = await a.client.from("profiles").select("id").in("id", [a.id, b.id]);
    const asAdmin = await admin.client.from("profiles").select("id").in("id", [a.id, b.id]);

    expect(asA.data?.map((p) => p.id)).toEqual([a.id]);
    expect(asAdmin.data?.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("a student cannot change their role", async () => {
    const a = await createStudent();

    const { error } = await a.client.from("profiles").update({ role: "admin" }).eq("id", a.id);

    expectErrorCode(error, ERR.forbidden);
    const { data } = await service.from("profiles").select("role").eq("id", a.id).single();
    expect(data?.role).toBe("student");
  });

  it("a student cannot insert or delete profiles", async () => {
    const a = await createStudent();

    const insert = await a.client.from("profiles").insert({ id: a.id, role: "admin" });
    const remove = await a.client.from("profiles").delete().eq("id", a.id);

    expectErrorCode(insert.error, ERR.forbidden);
    expectErrorCode(remove.error, ERR.forbidden);
  });

  it("is_admin() is true only for admins", async () => {
    const a = await createStudent();
    const admin = await createAdmin();

    expect((await a.client.rpc("is_admin")).data).toBe(false);
    expect((await admin.client.rpc("is_admin")).data).toBe(true);
  });
});

describe("consultations: students", () => {
  let a: TestUser;
  let b: TestUser;
  let aRow: ConsultationRow;
  let bRow: ConsultationRow;

  beforeAll(async () => {
    a = await createStudent("a");
    b = await createStudent("b");
    aRow = await book(a, hoursFromNow(24));
    bRow = await book(b, hoursFromNow(24));
  });

  it("student_id comes from the session", () => {
    expect(aRow.student_id).toBe(a.id);
    expect(bRow.student_id).toBe(b.id);
  });

  it("a student reads only their own bookings", async () => {
    const { data, error } = await a.client.from("consultations").select("id");

    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([aRow.id]);
  });

  it("signed out, nothing can be read or written", async () => {
    const anon = anonClient();

    const read = await anon.from("consultations").select("id");
    const insert = await anon.from("consultations").insert(bookingInput(hoursFromNow(30)));

    expectErrorCode(read.error, ERR.forbidden);
    expectErrorCode(insert.error, ERR.forbidden);
  });

  it("A can update A's booking", async () => {
    const { data, error } = await a.client
      .from("consultations")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", aRow.id)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].completed_at).not.toBeNull();
  });

  it("the same update on B's booking changes nothing", async () => {
    const { data, error } = await a.client
      .from("consultations")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", bRow.id)
      .select();

    // RLS hides B's row from A, so the update matches 0 rows without an error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readRow(bRow.id)).toEqual(bRow);
  });

  it("A cannot cancel or reschedule B's booking", async () => {
    await a.client.from("consultations").update({ cancelled_at: new Date().toISOString() }).eq("id", bRow.id);
    await a.client.from("consultations").update({ scheduled_at: hoursFromNow(48) }).eq("id", bRow.id);

    expect(await readRow(bRow.id)).toEqual(bRow);
  });

  it("a student cannot change student_id", async () => {
    const { error } = await a.client.from("consultations").update({ student_id: b.id }).eq("id", aRow.id);

    expectErrorCode(error, ERR.forbidden);
    expect((await readRow(aRow.id)).student_id).toBe(a.id);
  });

  it("a student cannot book for someone else", async () => {
    const { error } = await a.client
      .from("consultations")
      .insert({ ...bookingInput(hoursFromNow(36)), student_id: b.id });

    // student_id is not in the insert grant.
    expectErrorCode(error, ERR.forbidden);
  });

  it("a student cannot set state or timestamp columns on insert", async () => {
    const now = new Date().toISOString();
    for (const extra of [{ completed_at: now }, { cancelled_at: now }, { created_at: now }, { id: crypto.randomUUID() }]) {
      const { error } = await a.client
        .from("consultations")
        .insert({ ...bookingInput(hoursFromNow(40)), ...extra });
      expectErrorCode(error, ERR.forbidden);
    }
  });

  it("a student cannot change names, reason or timestamps after booking", async () => {
    const attempts = [
      { first_name: "Changed" },
      { reason: "Changed" },
      { created_at: new Date().toISOString() },
      { updated_at: new Date().toISOString() },
    ];
    for (const change of attempts) {
      const { error } = await a.client.from("consultations").update(change).eq("id", aRow.id);
      expectErrorCode(error, ERR.forbidden);
    }
  });

  it("a student cannot delete a booking", async () => {
    const { error } = await a.client.from("consultations").delete().eq("id", aRow.id);

    expectErrorCode(error, ERR.forbidden);
    await expect(readRow(aRow.id)).resolves.toMatchObject({ id: aRow.id });
  });
});

describe("consultations: admin", () => {
  let a: TestUser;
  let b: TestUser;
  let admin: TestUser;
  let aRow: ConsultationRow;
  let bCancelled: ConsultationRow;
  let adminOwnRow: ConsultationRow;

  beforeAll(async () => {
    a = await createStudent("a");
    b = await createStudent("b");
    aRow = await book(a, hoursFromNow(24));
    const bRow = await book(b, hoursFromNow(24));
    await b.client.from("consultations").update({ cancelled_at: new Date().toISOString() }).eq("id", bRow.id);
    bCancelled = await readRow(bRow.id);
    admin = await createAdmin(async (asStudent) => {
      adminOwnRow = await book(asStudent, hoursFromNow(26));
    });
  });

  it("sees A's, B's (cancelled included) and its own pre-promotion bookings", async () => {
    const { data, error } = await admin.client
      .from("consultations")
      .select("id, student_id")
      .in("student_id", [a.id, b.id, admin.id]);

    expect(error).toBeNull();
    expect(data?.map((r) => r.id).sort()).toEqual([aRow.id, bCancelled.id, adminOwnRow.id].sort());
  });

  it("an update to its own old booking changes nothing", async () => {
    const { data, error } = await admin.client
      .from("consultations")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", adminOwnRow.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readRow(adminOwnRow.id)).toEqual(adminOwnRow);
  });

  it("an update to a student's booking changes nothing", async () => {
    const { data, error } = await admin.client
      .from("consultations")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", aRow.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readRow(aRow.id)).toEqual(aRow);
  });

  it("cannot book", async () => {
    const { error } = await admin.client.from("consultations").insert(bookingInput(hoursFromNow(50)));

    expectErrorCode(error, ERR.forbidden);
  });

  it("control: the same update as a student on its own booking succeeds", async () => {
    // Shows the admin is blocked by its role, not by the shape of the update.
    const student = await createStudent();
    const row = await book(student, hoursFromNow(24));

    const { data } = await student.client
      .from("consultations")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", row.id)
      .select();

    expect(data).toHaveLength(1);
  });
});
