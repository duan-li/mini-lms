import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// withAuth with a fake Supabase client: every way getUser() and is_admin()
// can answer, and what the caller and the log see for each.

const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { withAdmin, withAuth, withStudent } = await import("@/lib/api/with-auth");

const user = { id: "6f1d1c9e-8d5b-4f3e-9a51-3c2b1a0f9e8d" } as User;
const req = new Request("http://localhost/api/consultations", { method: "GET" }) as NextRequest;
const ctx = { params: Promise.resolve({}) };
const ok = async () => Response.json({ data: "ok" });

const signedIn = () => getUser.mockResolvedValue({ data: { user }, error: null });
const authFails = (error: AuthError) => getUser.mockResolvedValue({ data: { user: null }, error });

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(line));
  vi.spyOn(console, "warn").mockImplementation((line: string) => void logs.push(line));
  rpc.mockResolvedValue({ data: false, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  getUser.mockReset();
  rpc.mockReset();
});

async function call(handler = withAuth(ok)) {
  const res = await handler(req, ctx);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("withAuth: who is calling", () => {
  it("runs the handler for a verified user", async () => {
    signedIn();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["no session cookie", new AuthSessionMissingError()],
    ["a token Auth rejects (403 bad_jwt)", new AuthApiError("invalid JWT", 403, "bad_jwt")],
    ["a user that no longer exists (404)", new AuthApiError("User not found", 404, "user_not_found")],
    ["a refresh token that is gone (400)", new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found")],
  ])("401 for %s", async (_, error) => {
    authFails(error);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("401 when Auth returns neither a user nor an error", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call()).status).toBe(401);
  });

  it.each([
    ["Auth answering 503", new AuthRetryableFetchError("Service Unavailable", 503)],
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["rate limiting (429)", new AuthApiError("Too many requests", 429, "over_request_rate_limit")],
    ["an unreadable Auth response", new AuthUnknownError("Unexpected token <", null)],
  ])("500, not 401, for %s", async (_, error) => {
    authFails(error);
    const res = await call();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong. Please try again." },
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("logs an Auth outage as an error with its class and code, not its message", async () => {
    authFails(new AuthRetryableFetchError("upstream said: secret detail", 503));
    await call();

    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0]);
    expect(entry).toMatchObject({
      level: "error",
      status: 500,
      errorClass: "AuthUnavailable",
      route: "/api/consultations",
      userId: null,
    });
    expect(entry.code).toContain("AuthRetryableFetchError");
    expect(logs[0]).not.toContain("secret detail");
  });

  it("an error thrown by the handler is a generic 500, logged with the user ID", async () => {
    signedIn();
    const res = await call(
      withAuth(async () => {
        throw new Error("reason: private consultation text");
      }),
    );

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
    const entry = JSON.parse(logs[0]);
    expect(entry).toMatchObject({ level: "error", errorClass: "Error", userId: user.id });
    expect(logs[0]).not.toContain("private consultation text");
  });
});

describe("withStudent and withAdmin: the role", () => {
  it("withStudent: a student passes, an admin gets 403", async () => {
    signedIn();
    expect((await call(withStudent(ok))).status).toBe(200);
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await call(withStudent(ok))).status).toBe(403);
  });

  it("withAdmin: an admin passes, a student gets 403", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await call(withAdmin(ok))).status).toBe(200);
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await call(withAdmin(ok))).status).toBe(403);
  });

  it("a failing role check is a 500, not a pass", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    expect((await call(withStudent(ok))).status).toBe(500);
    expect((await call(withAdmin(ok))).status).toBe(500);
  });
});
