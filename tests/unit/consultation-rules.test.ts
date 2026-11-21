import { describe, expect, it } from "vitest";
import {
  allowedActions,
  decideCancel,
  decideReschedule,
  decideSetCompleted,
  statusOf,
} from "@/lib/services/consultation-rules";

const now = new Date("2026-11-22T12:00:00Z");
const future = new Date("2026-11-23T12:00:00Z");
const past = new Date("2026-11-21T12:00:00Z");

describe("statusOf", () => {
  it("derives the state from the timestamps", () => {
    expect(statusOf({ completed_at: null, cancelled_at: null })).toBe("scheduled");
    expect(statusOf({ completed_at: "2026-11-22T00:00:00Z", cancelled_at: null })).toBe("completed");
    expect(statusOf({ completed_at: null, cancelled_at: "2026-11-22T00:00:00Z" })).toBe("cancelled");
  });
});

describe("decideSetCompleted", () => {
  it("completes a scheduled booking and marks a completed one incomplete", () => {
    expect(decideSetCompleted("scheduled", true)).toEqual({ kind: "write" });
    expect(decideSetCompleted("completed", false)).toEqual({ kind: "write" });
  });

  it("treats a repeat of the current state as a no-op", () => {
    expect(decideSetCompleted("completed", true)).toEqual({ kind: "noop" });
    expect(decideSetCompleted("scheduled", false)).toEqual({ kind: "noop" });
  });

  it("rejects any change to a cancelled booking", () => {
    for (const completed of [true, false]) {
      expect(decideSetCompleted("cancelled", completed)).toMatchObject({ kind: "reject", reason: "invalid_state" });
    }
  });
});

describe("decideReschedule", () => {
  it("moves a scheduled booking to a future time", () => {
    expect(decideReschedule("scheduled", future, now)).toEqual({ kind: "write" });
  });

  it("rejects a past or present time", () => {
    expect(decideReschedule("scheduled", past, now)).toMatchObject({ kind: "reject", reason: "not_future" });
    expect(decideReschedule("scheduled", now, now)).toMatchObject({ kind: "reject", reason: "not_future" });
  });

  it.each(["completed", "cancelled"] as const)("rejects a %s booking", (status) => {
    expect(decideReschedule(status, future, now)).toMatchObject({ kind: "reject", reason: "invalid_state" });
  });
});

describe("decideCancel", () => {
  it("cancels a scheduled booking", () => {
    expect(decideCancel("scheduled")).toEqual({ kind: "write" });
  });

  it.each(["completed", "cancelled"] as const)("rejects a %s booking (cancel is an action, not a state)", (status) => {
    expect(decideCancel(status)).toMatchObject({ kind: "reject", reason: "invalid_state" });
  });
});

describe("allowedActions", () => {
  it("matches the state diagram", () => {
    expect(allowedActions("scheduled")).toEqual({ complete: true, markIncomplete: false, reschedule: true, cancel: true });
    expect(allowedActions("completed")).toEqual({ complete: false, markIncomplete: true, reschedule: false, cancel: false });
    expect(allowedActions("cancelled")).toEqual({ complete: false, markIncomplete: false, reschedule: false, cancel: false });
  });
});
