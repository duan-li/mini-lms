import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, inject } from "vitest";
import type { Database, Tables } from "@/lib/database.types";

export type Db = SupabaseClient<Database>;
export type ConsultationRow = Tables<"consultations">;

export type TestUser = {
  id: string;
  email: string;
  /** A client signed in as this user: every query goes through RLS. */
  client: Db;
};

const env = inject("supabase");
const PASSWORD = "integration-test-password";

function makeClient(key: string): Db {
  return createClient<Database>(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Bypasses RLS. Tests only: to create users, promote admins and read rows as stored. */
export const service = makeClient(env.secretKey);

/** Not signed in: the public `anon` role. */
export function anonClient(): Db {
  return makeClient(env.publishableKey);
}

const createdUserIds: string[] = [];

/** A fresh, signed-in student. Fresh users per test keep tests independent. */
export async function createStudent(label = "student"): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw signIn.error;

  return { id: data.user.id, email, client };
}

/** Promotes a user the way a real admin is made: with SQL, outside the app. */
export async function promoteToAdmin(user: TestUser): Promise<TestUser> {
  const { error } = await service.from("profiles").update({ role: "admin" }).eq("id", user.id);
  if (error) throw error;
  return user;
}

/** A fresh admin. Pass `before` to act as a student first (for example, to book). */
export async function createAdmin(before?: (asStudent: TestUser) => Promise<void>): Promise<TestUser> {
  const user = await createStudent("admin");
  if (before) await before(user);
  return promoteToAdmin(user);
}

/** Deletes every user this file created; profiles and bookings cascade. */
export async function deleteCreatedUsers(): Promise<void> {
  const ids = createdUserIds.splice(0);
  await Promise.all(ids.map((id) => service.auth.admin.deleteUser(id)));
}

/** An ISO time `hours` from now, rounded to the minute. */
export function hoursFromNow(hours: number): string {
  const time = new Date(Date.now() + hours * 3_600_000);
  time.setUTCSeconds(0, 0);
  return time.toISOString();
}

/** An ISO time `ms` from now, unrounded: for bookings that must pass soon. */
export function msFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function bookingInput(scheduledAt: string) {
  return {
    first_name: "Test",
    last_name: "Student",
    reason: "Integration test booking",
    scheduled_at: scheduledAt,
  };
}

/** Books as `user` through RLS and returns the stored row. */
export async function book(user: TestUser, scheduledAt: string): Promise<ConsultationRow> {
  const { data, error } = await user.client
    .from("consultations")
    .insert(bookingInput(scheduledAt))
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Reads a row as stored, bypassing RLS. */
export async function readRow(id: string): Promise<ConsultationRow> {
  const { data, error } = await service.from("consultations").select().eq("id", id).single();
  if (error) throw error;
  return data;
}

/** Same instant, whatever the text format Postgres returned. */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Asserts a Postgres or PostgREST error code, such as 42501, 23505 or PT422. */
export function expectErrorCode(error: { code?: string } | null, code: string): void {
  expect(error, `expected error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

export const ERR = {
  /** insufficient_privilege: no grant, or an RLS check failed on insert */
  forbidden: "42501",
  /** unique_violation: double booking */
  duplicate: "23505",
  /** check_violation */
  check: "23514",
  /** trigger: illegal state change */
  invalidState: "PT422",
  /** trigger: time is not in the future */
  notFuture: "PT400",
} as const;
