import { describe, expect, it } from "vitest";
import { formatDateTime, isoToLocalInput, localInputToIso } from "@/lib/datetime";

// Written to pass in any time zone the tests run in (CI is UTC; laptops are not).

describe("localInputToIso", () => {
  it("adds the browser's offset and keeps the same instant", () => {
    const iso = localInputToIso("2030-06-15T10:30");
    expect(iso).toMatch(/^2030-06-15T10:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso!).getTime()).toBe(new Date(2030, 5, 15, 10, 30).getTime());
  });

  it("uses the offset in force on that date, not today's", () => {
    for (const value of ["2030-01-15T09:00", "2030-07-15T09:00"]) {
      const iso = localInputToIso(value)!;
      const [y, m, d] = [2030, Number(value.slice(5, 7)) - 1, 15];
      expect(new Date(iso).getTime()).toBe(new Date(y, m, d, 9, 0).getTime());
    }
  });

  it("accepts seconds", () => {
    expect(localInputToIso("2030-06-15T10:30:45")).toMatch(/^2030-06-15T10:30:45[+-]/);
  });

  it.each(["", "2030-06-15", "10:30", "2030-06-15T10:30Z", "2030-06-15T10:30+11:00", "not a date", "2030-13-45T99:99"])(
    "rejects %j",
    (value) => {
      expect(localInputToIso(value)).toBeNull();
    },
  );
});

describe("isoToLocalInput", () => {
  it("round-trips with localInputToIso", () => {
    const local = "2030-06-15T10:30";
    expect(isoToLocalInput(localInputToIso(local)!)).toBe(local);
  });

  it("shows a UTC time in local time", () => {
    const date = new Date(Date.UTC(2030, 0, 2, 3, 4));
    expect(isoToLocalInput(date.toISOString())).toBe(isoToLocalInput(date));
    expect(isoToLocalInput(date)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("formatDateTime", () => {
  it("renders a fallback for legacy times the browser cannot display", () => {
    expect(formatDateTime("infinity")).toBe("Time unavailable");
    expect(formatDateTime("294276-01-01T00:00:00+00:00")).toBe("Time unavailable");
    expect(formatDateTime("2030-01-01T10:00:00Z")).toContain("2030");
  });
});
