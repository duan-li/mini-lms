import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  apiList,
  book,
  deleteCreatedUsers,
  futureSlot,
  insertBooking,
  logout,
  row,
  sameInstant,
  trackByEmail,
} from "./fixtures";

// Review path steps 2 to 7 in a browser: sign up, book, complete and mark
// incomplete, reschedule and rebook the old time, cancel and rebook, complete
// a past booking, log out. Each step is checked in the UI and, where the UI
// cannot show it exactly, against the API.

test.afterAll(deleteCreatedUsers);

test("a new student books and manages consultations", async ({ page }) => {
  const t1 = futureSlot(1, 10);
  const t2 = futureSlot(1, 11);
  const email = `e2e-signup-${randomUUID()}@example.com`;

  await test.step("sign up lands on an empty dashboard", async () => {
    await page.goto("/auth/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Repeat Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("No consultations yet")).toBeVisible();
  });
  const userId = await trackByEmail(email);

  await test.step("book T1, mark it complete, then incomplete", async () => {
    await book(page, "First booking", t1.local);
    const first = row(page, "First booking");
    await expect(first.getByText("Scheduled", { exact: true })).toBeVisible();

    await first.getByRole("checkbox").click();
    await expect(first.getByText("Completed", { exact: true })).toBeVisible();
    await expect(first.getByRole("button", { name: "Reschedule" })).toHaveCount(0);

    await first.getByRole("checkbox").click();
    await expect(first.getByText("Scheduled", { exact: true })).toBeVisible();
    await expect(first.getByRole("button", { name: "Reschedule" })).toBeVisible();
  });

  await test.step("reschedule T1 to T2, then book T1 again", async () => {
    await row(page, "First booking").getByRole("button", { name: "Reschedule" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New date and time").fill(t2.local);
    await dialog.getByRole("button", { name: "Reschedule" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const at = (await apiList(page)).find((c) => c.reason === "First booking")?.scheduledAt;
        return at !== undefined && sameInstant(at, t2.iso);
      })
      .toBe(true);

    await book(page, "Rebook T1", t1.local);
    await expect(row(page, "Rebook T1").getByText("Scheduled", { exact: true })).toBeVisible();
  });

  await test.step("a second booking at T2 is refused", async () => {
    await book(page, "Duplicate T2", t2.local);
    await expect(page.getByRole("dialog").getByText("You already have a consultation at this time.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  await test.step("cancel T2, then book T2 again", async () => {
    await row(page, "First booking").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel consultation" }).click();
    await expect(row(page, "First booking").getByText("Cancelled", { exact: true })).toBeVisible();
    // A cancelled booking offers no actions.
    await expect(row(page, "First booking").getByRole("button")).toHaveCount(0);
    await expect(row(page, "First booking").getByRole("checkbox")).toBeDisabled();

    await book(page, "Rebook T2", t2.local);
    await expect(row(page, "Rebook T2").getByText("Scheduled", { exact: true })).toBeVisible();
  });

  await test.step("a past booking can be completed", async () => {
    // Created a moment ahead (the database refuses past times), then left to pass.
    await insertBooking(userId, new Date(Date.now() + 1_500).toISOString(), "Past booking");
    await page.waitForTimeout(2_000);
    await page.reload();

    const past = row(page, "Past booking");
    await expect(past.getByText("(past)")).toBeVisible();
    await past.getByRole("checkbox").click();
    await expect(past.getByText("Completed", { exact: true })).toBeVisible();
  });

  await test.step("the API agrees with the table", async () => {
    const byReason = Object.fromEntries((await apiList(page)).map((c) => [c.reason, c.status]));
    expect(byReason).toEqual({
      "First booking": "cancelled",
      "Rebook T1": "scheduled",
      "Rebook T2": "scheduled",
      "Past booking": "completed",
    });
  });

  await test.step("after logout, pages redirect to login and the API answers 401", async () => {
    await logout(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
    expect((await page.request.get("/api/consultations")).status()).toBe(401);
  });
});
