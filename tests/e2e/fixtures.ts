import { randomUUID } from "node:crypto";
import { type Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Test data for the browser tests: users made with the secret key (tests
// only), bookings inserted as they are stored, and the UI steps every spec
// shares. playwright.config.ts puts the Supabase values in the environment.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

/** Bypasses RLS. Tests only. */
export const service = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export const PASSWORD = "e2e-test-password";

export type E2EUser = { id: string; email: string };

const created: string[] = [];

export async function createUser(label: string, role: "student" | "admin" = "student"): Promise<E2EUser> {
  const email = `e2e-${label}-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  if (role === "admin") await promote(data.user.id);
  return { id: data.user.id, email };
}

/** Promotes with SQL-level access, the only way an admin is ever made. */
export async function promote(id: string): Promise<void> {
  const { error } = await service.from("profiles").update({ role: "admin" }).eq("id", id);
  if (error) throw error;
}

/** Remembers a user created through the UI, so it is deleted at the end. */
export async function trackByEmail(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`No user ${email}`);
  created.push(user.id);
  return user.id;
}

export async function deleteCreatedUsers(): Promise<void> {
  const ids = created.splice(0);
  await Promise.all(ids.map((id) => service.auth.admin.deleteUser(id)));
}

/** Inserts a booking as stored (the triggers still run). Returns its ID. */
export async function insertBooking(
  studentId: string,
  scheduledAt: string,
  reason: string,
  name: { first: string; last: string } = { first: "E2E", last: "Student" },
): Promise<string> {
  const { data, error } = await service
    .from("consultations")
    .insert({ student_id: studentId, first_name: name.first, last_name: name.last, reason, scheduled_at: scheduledAt })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * A time `days` from today at `hour`:00 UTC (the browser runs in UTC): the
 * `datetime-local` value to type, and the same instant as ISO.
 */
export function futureSlot(days: number, hour: number): { local: string; iso: string } {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  const iso = date.toISOString();
  return { local: iso.slice(0, 16), iso };
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
}

/** The student table row whose text includes `reason`. */
export function row(page: Page, reason: string) {
  return page.getByRole("row").filter({ hasText: reason });
}

export async function book(page: Page, reason: string, local: string): Promise<void> {
  await page.getByRole("button", { name: "Book a consultation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name").fill("Erin");
  await dialog.getByLabel("Last name").fill("Example");
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByLabel("Date and time").fill(local);
  await dialog.getByRole("button", { name: "Book", exact: true }).click();
}

/** The caller's bookings straight from the API, with the page's session cookies. */
export async function apiList(page: Page) {
  const res = await page.request.get("/api/consultations");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { id: string; reason: string; scheduledAt: string; status: string }[] }).data;
}

export const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();
