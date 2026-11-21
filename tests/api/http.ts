import { createServerClient } from "@supabase/ssr";
import { inject } from "vitest";
import type { AdminConsultationDTO, ConsultationDTO } from "@/lib/services/consultation-dto";
import { TEST_PASSWORD, type TestUser, createAdmin, createStudent } from "../integration/helpers";

import { AUTH_OUTAGE_PATH } from "./supabase-proxy";

const baseUrl = inject("apiBaseUrl");
const supabaseProxyUrl = inject("supabaseProxyUrl");
const supabase = inject("supabase");

export type ApiUser = TestUser & { api: Api };

export type ApiResponse<T> = {
  status: number;
  headers: Headers;
  body: T;
};

export type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string[]> } };
export type DataBody<T> = { data: T };
export type AdminPageBody = { data: AdminConsultationDTO[]; nextCursor: string | null };

/** A tiny HTTP client that sends the given cookies with every request. */
export class Api {
  constructor(private readonly cookieHeader: string | null) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload, redirect: "manual" });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as T };
  }

  list() {
    return this.request<DataBody<ConsultationDTO[]>>("GET", "/api/consultations");
  }

  book(body: unknown) {
    return this.request<DataBody<ConsultationDTO>>("POST", "/api/consultations", body);
  }

  update(id: string, body: unknown) {
    return this.request<DataBody<ConsultationDTO>>("PATCH", `/api/consultations/${id}`, body);
  }

  cancel(id: string) {
    return this.request<DataBody<ConsultationDTO>>("POST", `/api/consultations/${id}/cancel`);
  }

  adminList(params: { cursor?: string | null; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const qs = query.size ? `?${query}` : "";
    return this.request<AdminPageBody>("GET", `/api/admin/consultations${qs}`);
  }
}

/** Not signed in. */
export const anonymous = new Api(null);

/**
 * Signs in the way the browser does, with @supabase/ssr writing the session
 * into cookies. The cookies live in memory and go out with each request.
 */
export async function signInCookies(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(supabase.url, supabase.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  if (jar.size === 0) throw new Error("Sign-in wrote no session cookies");
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function withApi(user: TestUser): Promise<ApiUser> {
  return { ...user, api: new Api(await signInCookies(user.email)) };
}

/** A fresh student with an API client carrying their session cookies. */
export async function apiStudent(label = "api-student"): Promise<ApiUser> {
  return withApi(await createStudent(label));
}

/** A fresh admin. `before` runs while it is still a student, for example to book. */
export async function apiAdmin(before?: (asStudent: TestUser) => Promise<void>): Promise<ApiUser> {
  return withApi(await createAdmin(before));
}

/** A valid booking body `hours` from now, on a whole minute. */
export function bookingBody(hours: number, change: Record<string, unknown> = {}) {
  const at = new Date(Date.now() + hours * 3_600_000);
  at.setUTCSeconds(0, 0);
  return {
    firstName: "Api",
    lastName: "Tester",
    reason: "API test booking",
    scheduledAt: at.toISOString(),
    ...change,
  };
}

/**
 * Runs `fn` while Supabase Auth's user endpoint answers 503 to the app.
 * Tests in a file run one at a time, so no other test sees the outage.
 */
export async function duringAuthOutage<T>(fn: () => Promise<T>): Promise<T> {
  await fetch(`${supabaseProxyUrl}${AUTH_OUTAGE_PATH}`, { method: "PUT" });
  try {
    return await fn();
  } finally {
    await fetch(`${supabaseProxyUrl}${AUTH_OUTAGE_PATH}`, { method: "DELETE" });
  }
}
