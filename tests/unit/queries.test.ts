import { describe, expect, it } from "vitest";
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
