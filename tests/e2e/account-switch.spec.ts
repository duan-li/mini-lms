import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiList, createUser, deleteCreatedUsers, futureSlot, insertBooking, login, logout, row } from "./fixtures";

// Review path step 8: on a shared computer, student B must never see student
// A's bookings, not even for a moment while the page loads. A watcher in the
// page records every time A's booking text is visible, from the moment A logs
// out until B's list has loaded.

test.afterAll(deleteCreatedUsers);

declare global {
  interface Window {
    __marker?: string;
    __seen?: string[];
  }
}

test("student B never sees student A's bookings in the same browser", async ({ page }) => {
  const marker = `A-only-${randomUUID()}`;
  const a = await createUser("switch-a");
  const b = await createUser("switch-b");
  await insertBooking(a.id, futureSlot(2, 9).iso, marker);
  await insertBooking(b.id, futureSlot(2, 9).iso, "B's own booking");

  // Runs in every document: checks the visible text after every DOM change.
  await page.addInitScript(() => {
    window.__seen = [];
    new MutationObserver(() => {
      const marker = window.__marker;
      if (marker && document.body?.innerText.includes(marker)) window.__seen!.push(location.pathname);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });

  await login(page, a.email);
  await expect(row(page, marker)).toBeVisible();

  await logout(page);
  // Watch from here on: A's text must not be visible again.
  await page.evaluate((m) => {
    window.__marker = m;
    window.__seen = [];
  }, marker);

  await page.getByLabel("Email").fill(b.email);
  await page.getByLabel("Password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(row(page, "B's own booking")).toBeVisible();

  expect(await page.evaluate(() => window.__seen)).toEqual([]);
  await expect(page.getByText(marker)).toHaveCount(0);
  expect((await apiList(page)).map((c) => c.reason)).toEqual(["B's own booking"]);
});
