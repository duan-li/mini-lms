import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ERR,
  type ConsultationRow,
  type TestUser,
  book,
  bookingInput,
  createStudent,
  deleteCreatedUsers,
  expectErrorCode,
  hoursFromNow,
  msFromNow,
  readRow,
  sameInstant,
  sleep,
} from "./helpers";

afterAll(deleteCreatedUsers);

let student: TestUser;

beforeEach(async () => {
  student = await createStudent();
});

/** Sends one update as the student and returns the stored row or the error. */
async function update(id: string, change: Partial<ConsultationRow>) {
  return student.client.from("consultations").update(change).eq("id", id).select().single();
}

const complete = (id: string) => update(id, { completed_at: new Date().toISOString() });
const markIncomplete = (id: string) => update(id, { completed_at: null });
const cancel = (id: string) => update(id, { cancelled_at: new Date().toISOString() });
const reschedule = (id: string, scheduledAt: string) => update(id, { scheduled_at: scheduledAt });

/** Within a few seconds of now: the database set it, not the client. */
function expectDatabaseNow(value: string | null) {
  expect(value).not.toBeNull();
  expect(Math.abs(new Date(value!).getTime() - Date.now())).toBeLessThan(5_000);
}

describe("booking", () => {
  it("a new booking starts as scheduled", async () => {
    const row = await book(student, hoursFromNow(24));

    expect(row.completed_at).toBeNull();
    expect(row.cancelled_at).toBeNull();
    expectDatabaseNow(row.created_at);
  });

  it("a booking in the past is rejected", async () => {
    const { error } = await student.client.from("consultations").insert(bookingInput(hoursFromNow(-1)));

    expectErrorCode(error, ERR.notFuture);
  });

  it.each([
    ["first_name", { first_name: "   " }],
    ["last_name", { last_name: "" }],
    ["reason", { reason: " " }],
    ["first_name too long", { first_name: "x".repeat(101) }],
    ["reason too long", { reason: "x".repeat(1001) }],
  ])("check constraint rejects %s", async (_name, override) => {
    const { error } = await student.client
      .from("consultations")
      .insert({ ...bookingInput(hoursFromNow(24)), ...override });

    expectErrorCode(error, ERR.check);
  });

  it("accepts names and reason at their maximum length", async () => {
    const { error } = await student.client.from("consultations").insert({
      ...bookingInput(hoursFromNow(24)),
      first_name: "x".repeat(100),
      last_name: "y".repeat(100),
      reason: "z".repeat(1000),
    });

    expect(error).toBeNull();
  });

  it("the same student cannot book the same time twice", async () => {
    const time = hoursFromNow(24);
    await book(student, time);

    const { error } = await student.client.from("consultations").insert(bookingInput(time));

    expectErrorCode(error, ERR.duplicate);
  });
});

describe("state changes", () => {
  it("complete sets completed_at from the database clock, ignoring the client's time", async () => {
    const row = await book(student, hoursFromNow(24));

    const { data, error } = await update(row.id, { completed_at: "2000-01-01T00:00:00Z" });

    expect(error).toBeNull();
    expectDatabaseNow(data!.completed_at);
  });

  it("mark incomplete clears completed_at", async () => {
    const row = await book(student, hoursFromNow(24));
    await complete(row.id);

    const { data, error } = await markIncomplete(row.id);

    expect(error).toBeNull();
    expect(data!.completed_at).toBeNull();
  });

  it("reschedule moves a scheduled booking to a future time", async () => {
    const row = await book(student, hoursFromNow(24));
    const next = hoursFromNow(48);

    const { data, error } = await reschedule(row.id, next);

    expect(error).toBeNull();
    expect(sameInstant(data!.scheduled_at, next)).toBe(true);
  });

  it("reschedule to a past time fails", async () => {
    const row = await book(student, hoursFromNow(24));

    const { error } = await reschedule(row.id, hoursFromNow(-2));

    expectErrorCode(error, ERR.notFuture);
  });

  it("cancel sets cancelled_at from the database clock", async () => {
    const row = await book(student, hoursFromNow(24));

    const { data, error } = await update(row.id, { cancelled_at: "2000-01-01T00:00:00Z" });

    expect(error).toBeNull();
    expectDatabaseNow(data!.cancelled_at);
  });

  it("a real change moves updated_at", async () => {
    const row = await book(student, hoursFromNow(24));
    await sleep(20);

    const { data } = await complete(row.id);

    expect(new Date(data!.updated_at).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
  });

  it("completing a cancelled booking fails", async () => {
    const row = await book(student, hoursFromNow(24));
    await cancel(row.id);

    const { error } = await complete(row.id);

    expectErrorCode(error, ERR.invalidState);
  });

  it("rescheduling a completed booking fails", async () => {
    const row = await book(student, hoursFromNow(24));
    await complete(row.id);

    const { error } = await reschedule(row.id, hoursFromNow(48));

    expectErrorCode(error, ERR.invalidState);
  });

  it("cancelling a completed booking fails", async () => {
    const row = await book(student, hoursFromNow(24));
    await complete(row.id);

    const { error } = await cancel(row.id);

    expectErrorCode(error, ERR.invalidState);
  });

  it("rescheduling a cancelled booking fails", async () => {
    const row = await book(student, hoursFromNow(24));
    await cancel(row.id);

    const { error } = await reschedule(row.id, hoursFromNow(48));

    expectErrorCode(error, ERR.invalidState);
  });

  it("a completed booking can be rescheduled after it is marked incomplete", async () => {
    const row = await book(student, hoursFromNow(24));
    await complete(row.id);
    await markIncomplete(row.id);

    const { error } = await reschedule(row.id, hoursFromNow(48));

    expect(error).toBeNull();
  });

  it("two changes in one update fail", async () => {
    const row = await book(student, hoursFromNow(24));
    const now = new Date().toISOString();

    const cancelAndMove = await update(row.id, { cancelled_at: now, scheduled_at: hoursFromNow(48) });
    const completeAndMove = await update(row.id, { completed_at: now, scheduled_at: hoursFromNow(48) });
    const completeAndCancel = await update(row.id, { completed_at: now, cancelled_at: now });

    expectErrorCode(cancelAndMove.error, ERR.invalidState);
    expectErrorCode(completeAndMove.error, ERR.invalidState);
    expectErrorCode(completeAndCancel.error, ERR.invalidState);
    expect(await readRow(row.id)).toEqual(row);
  });
});

describe("repeat requests", () => {
  it("a repeat complete keeps both completed_at and updated_at", async () => {
    const row = await book(student, hoursFromNow(24));
    const first = (await complete(row.id)).data!;
    await sleep(20);

    const { data, error } = await complete(row.id);

    expect(error).toBeNull();
    expect(data!.completed_at).toBe(first.completed_at);
    expect(data!.updated_at).toBe(first.updated_at);
  });

  it("mark incomplete on a scheduled booking changes nothing", async () => {
    const row = await book(student, hoursFromNow(24));

    const { data, error } = await markIncomplete(row.id);

    expect(error).toBeNull();
    expect(data).toEqual(row);
  });

  it("a second cancel fails", async () => {
    const row = await book(student, hoursFromNow(24));
    const first = (await cancel(row.id)).data!;

    const { error } = await cancel(row.id);

    expectErrorCode(error, ERR.invalidState);
    expect(await readRow(row.id)).toEqual(first);
  });
});

describe("past bookings", () => {
  it("a booking made a few seconds ahead can be completed once that time has passed", async () => {
    const row = await book(student, msFromNow(2_000));
    await sleep(3_000);

    const completed = await complete(row.id);
    const incomplete = await markIncomplete(row.id);

    expect(completed.error).toBeNull();
    expectDatabaseNow(completed.data!.completed_at);
    expect(incomplete.error).toBeNull();
    expect(incomplete.data!.completed_at).toBeNull();
  });

  it("a past booking cannot move to another past time", async () => {
    const row = await book(student, msFromNow(2_000));
    await sleep(3_000);

    const { error } = await reschedule(row.id, hoursFromNow(-1));

    expectErrorCode(error, ERR.notFuture);
  });
});

describe("freeing a time", () => {
  it("rescheduling frees the old time while the new one stays taken", async () => {
    const t1 = hoursFromNow(24);
    const t2 = hoursFromNow(48);
    const row = await book(student, t1);
    await reschedule(row.id, t2);

    const rebookT1 = await student.client.from("consultations").insert(bookingInput(t1));
    const rebookT2 = await student.client.from("consultations").insert(bookingInput(t2));

    expect(rebookT1.error).toBeNull();
    expectErrorCode(rebookT2.error, ERR.duplicate);
  });

  it("cancelling frees that time, and the cancelled row stays", async () => {
    const t = hoursFromNow(24);
    const row = await book(student, t);
    await cancel(row.id);

    const rebook = await book(student, t);

    expect(rebook.id).not.toBe(row.id);
    expect((await readRow(row.id)).cancelled_at).not.toBeNull();
  });

  it("rescheduling onto a time already booked fails", async () => {
    const t1 = hoursFromNow(24);
    const t2 = hoursFromNow(48);
    await book(student, t1);
    const other = await book(student, t2);

    const { error } = await reschedule(other.id, t1);

    expectErrorCode(error, ERR.duplicate);
  });
});
