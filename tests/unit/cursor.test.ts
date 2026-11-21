import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/services/cursor";

const id = "6f1d1c9e-8d5b-4f3e-9a51-3c2b1a0f9e8d";

describe("cursor", () => {
  const cursor = { scheduledAt: "2026-11-23T10:00:00.123456+00:00", id: id };

  it("round-trips, keeping microseconds", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(["infinity", "10000-01-01T00:00:00.123456+00:00"])("round-trips a legacy database time %s", (scheduledAt) => {
    const legacy = { scheduledAt, id };
    expect(decodeCursor(encodeCursor(legacy))).toEqual(legacy);
  });

  it("is URL-safe", () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64 JSON", "!!!"],
    ["JSON of the wrong shape", Buffer.from('{"x":1}').toString("base64url")],
    ["a bad id", Buffer.from(JSON.stringify({ s: cursor.scheduledAt, i: "1" })).toString("base64url")],
    ["a bad time", Buffer.from(JSON.stringify({ s: "soon", i: id })).toString("base64url")],
    [
      "filter syntax in the time",
      Buffer.from(JSON.stringify({ s: "2026-11-23),id.gt.(0", i: id })).toString("base64url"),
    ],
  ])("rejects %s", (_, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
