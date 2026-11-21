import { describe, expect, it } from "vitest";
import { adminConsultationKeys, cursorChain, flattenPages } from "@/lib/queries/admin-consultations";
import { shouldClearCache } from "@/lib/queries/auth-cache";
import { applyCompleted, consultationKeys } from "@/lib/queries/consultations";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";

describe("consultationKeys", () => {
  it("includes the user ID, so two students never share a cache entry", () => {
    expect(consultationKeys.list("user-a")).toEqual(["consultations", "user-a"]);
    expect(consultationKeys.list("user-a")).not.toEqual(consultationKeys.list("user-b"));
  });
});

describe("shouldClearCache", () => {
  it("clears on sign-out", () => {
    expect(shouldClearCache("user-a", "SIGNED_OUT", null)).toBe(true);
    expect(shouldClearCache(undefined, "SIGNED_OUT", null)).toBe(true);
  });

  it("clears when a different user signs in", () => {
    expect(shouldClearCache("user-a", "SIGNED_IN", "user-b")).toBe(true);
    expect(shouldClearCache(null, "SIGNED_IN", "user-b")).toBe(true);
  });

  it("keeps the cache on a token refresh or a repeat sign-in for the same user", () => {
    expect(shouldClearCache("user-a", "TOKEN_REFRESHED", "user-a")).toBe(false);
    expect(shouldClearCache("user-a", "SIGNED_IN", "user-a")).toBe(false);
    expect(shouldClearCache("user-a", "USER_UPDATED", "user-a")).toBe(false);
  });

  it("keeps the cache on the first event of a page load", () => {
    expect(shouldClearCache(undefined, "INITIAL_SESSION", "user-a")).toBe(false);
  });
});

describe("applyCompleted", () => {
  const row: ConsultationDTO = {
    id: "1",
    firstName: "Alice",
    lastName: "Anders",
    reason: "Essay",
    scheduledAt: "2030-01-01T00:00:00.000Z",
    status: "scheduled",
  };

  it("flips scheduled and completed", () => {
    expect(applyCompleted(row, true).status).toBe("completed");
    expect(applyCompleted({ ...row, status: "completed" }, false).status).toBe("scheduled");
  });

  it("leaves a cancelled row alone", () => {
    const cancelled = { ...row, status: "cancelled" as const };
    expect(applyCompleted(cancelled, true)).toBe(cancelled);
  });
});

describe("adminConsultationKeys", () => {
  it("includes the admin's user ID and the page's cursor", () => {
    expect(adminConsultationKeys.page("admin-1", null, 20)).toEqual(["admin-consultations", "admin-1", null, { limit: 20 }]);
    expect(adminConsultationKeys.page("admin-1", "c1", 20)).not.toEqual(adminConsultationKeys.page("admin-2", "c1", 20));
    expect(adminConsultationKeys.page("admin-1", "c1", 20)).not.toEqual(adminConsultationKeys.page("admin-1", "c2", 20));
  });

  it("never shares an entry with the student list", () => {
    expect(adminConsultationKeys.all[0]).not.toBe(consultationKeys.all[0]);
  });
});

describe("cursorChain", () => {
  const next: Record<string, string | null> = { first: "c1", c1: "c2", c2: null };
  const lookup = (cursor: string | null) => next[cursor ?? "first"];

  it("starts with the first page, which has no cursor", () => {
    expect(cursorChain(1, lookup)).toEqual([null]);
  });

  it("follows each page's nextCursor", () => {
    expect(cursorChain(3, lookup)).toEqual([null, "c1", "c2"]);
  });

  it("stops at the last page", () => {
    expect(cursorChain(5, lookup)).toEqual([null, "c1", "c2"]);
  });

  it("stops at a page that has not loaded yet", () => {
    expect(cursorChain(3, () => undefined)).toEqual([null]);
  });

  it("moves later pages when an earlier page now ends elsewhere", () => {
    // Page one was refetched and now ends on a different row.
    const moved: Record<string, string | null> = { first: "c1-new", "c1-new": null };
    expect(cursorChain(2, (cursor) => moved[cursor ?? "first"])).toEqual([null, "c1-new"]);
  });
});

describe("flattenPages", () => {
  const row = (id: string, studentId: string) => ({
    id,
    studentId,
    firstName: "A",
    lastName: "B",
    reason: "R",
    scheduledAt: "2030-01-01T10:00:00+00:00",
    status: "scheduled" as const,
  });

  it("keeps rows in page order, so two bookings at the same time on different pages both appear", () => {
    const a = row("a", "student-a");
    const b = row("b", "student-b");
    expect(flattenPages([{ data: [a], nextCursor: "c1" }, { data: [b], nextCursor: null }])).toEqual([a, b]);
  });

  it("adds nothing for a page still loading", () => {
    const a = row("a", "student-a");
    expect(flattenPages([{ data: [a], nextCursor: "c1" }, undefined])).toEqual([a]);
  });
});
