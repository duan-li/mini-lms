import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Conflict,
  DatabaseError,
  Forbidden,
  InvalidState,
  NotFound,
  ValidationError,
  fromDbError,
  parseId,
  readJson,
  toErrorResponse,
} from "@/lib/api/errors";

async function body(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; fields?: Record<string, string[]> } };
}

describe("fromDbError", () => {
  it.each([
    ["23505", Conflict, 409],
    ["PT422", InvalidState, 422],
    ["PT400", ValidationError, 400],
    ["42501", Forbidden, 403],
    ["PGRST116", NotFound, 404],
  ])("maps %s to %s", (code, type, status) => {
    const err = fromDbError({ code, message: "from the database" });
    expect(err).toBeInstanceOf(type);
    expect(toErrorResponse(err).status).toBe(status);
  });

  it("keeps the trigger's message for an illegal change", () => {
    expect(fromDbError({ code: "PT422", message: "A cancelled consultation cannot change" }).message).toBe(
      "A cancelled consultation cannot change",
    );
  });

  it("turns anything else into a DatabaseError that keeps only the code", () => {
    const err = fromDbError({ code: "XX000", message: "secret detail" });
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.message).not.toContain("secret detail");
  });
});

describe("toErrorResponse", () => {
  it("returns zod issues as field errors with 400", async () => {
    const result = z.object({ firstName: z.string().min(1, "required") }).safeParse({ firstName: "" });
    const response = toErrorResponse(result.error);
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: { code: "invalid_input", message: "Invalid input", fields: { firstName: ["required"] } },
    });
  });

  it("puts whole-body zod issues under _", async () => {
    const result = z.object({}).refine(() => false, "Send one").safeParse({});
    expect((await body(toErrorResponse(result.error))).error.fields).toEqual({ _: ["Send one"] });
  });

  it("uses each typed error's status and code", async () => {
    const response = toErrorResponse(new InvalidState("Only a scheduled consultation can be cancelled"));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({
      error: { code: "invalid_state", message: "Only a scheduled consultation can be cancelled" },
    });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const response = toErrorResponse(new Error("connection string with a password"));
    expect(response.status).toBe(500);
    const { error } = await body(response);
    expect(error.code).toBe("internal_error");
    expect(error.message).not.toContain("password");
  });

  it("marks every error response private", () => {
    expect(toErrorResponse(new NotFound()).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("readJson", () => {
  it("parses a JSON body", async () => {
    expect(await readJson(new Request("http://x", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
  });

  it("turns a malformed body into a 400", async () => {
    await expect(readJson(new Request("http://x", { method: "POST", body: "{" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("parseId", () => {
  it("accepts a UUID and treats anything else as not found", () => {
    const id = "6f1d1c9e-8d5b-4f3e-9a51-3c2b1a0f9e8d";
    expect(parseId(id)).toBe(id);
    expect(() => parseId("42")).toThrow(NotFound);
  });
});

describe("error names", () => {
  it("are written out, so logs stay readable after minification", () => {
    expect(new NotFound().name).toBe("NotFound");
    expect(new InvalidState("x").name).toBe("InvalidState");
    expect(new ValidationError().name).toBe("ValidationError");
    expect(new DatabaseError("XX000").name).toBe("DatabaseError");
  });
});
