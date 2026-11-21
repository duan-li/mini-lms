import { expect, test } from "@playwright/test";
import { createUser, deleteCreatedUsers, futureSlot, insertBooking, login, promote, service } from "./fixtures";

// Review path step 9 and the Load more check: the admin sees every booking,
// cancelled ones and its own pre-promotion booking included, with no edit
// controls; two bookings at the same time on different pages both appear;
// a student is kept out of /admin.

test.afterAll(deleteCreatedUsers);

test("a student is kept out of /admin and sees no admin link", async ({ page }) => {
  const student = await createUser("not-admin");
  await login(page, student.email);

  await page.goto("/admin");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  expect((await page.request.get("/api/admin/consultations")).status()).toBe(403);
});

test("the admin pages through every booking, read-only", async ({ page }) => {
  const a = await createUser("admin-view-a");
  const b = await createUser("admin-view-b");
  const admin = await createUser("admin-view-admin");
  // The same time for A and B: with one row per page they must land on different pages.
  const sameTime = futureSlot(3, 12).iso;
  const rowA = await insertBooking(a.id, sameTime, "Same time, student A", { first: "Ann", last: "A" });
  const rowB = await insertBooking(b.id, sameTime, "Same time, student B", { first: "Ben", last: "B" });
  const cancelled = await insertBooking(b.id, futureSlot(3, 13).iso, "Cancelled by B", { first: "Ben", last: "B" });
  const { error } = await service
    .from("consultations")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", cancelled);
  expect(error).toBeNull();
  // Booked as a student, then promoted: read-only from now on.
  const own = await insertBooking(admin.id, futureSlot(3, 14).iso, "Admin's own earlier booking", {
    first: "Ada",
    last: "Admin",
  });
  await promote(admin.id);

  await login(page, admin.email);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();

  // One row per page, so every Load more is a new page fetched with nextCursor.
  await page.goto("/admin?limit=1");
  const rows = page.getByTestId("admin-consultation-row");
  await expect(rows).toHaveCount(1);
  const loadMore = page.getByRole("button", { name: "Load more" });
  const pageOf = new Map<string, number>();
  for (let pageNo = 1; ; pageNo++) {
    for (const id of await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-consultation-id")!))) {
      if (!pageOf.has(id)) pageOf.set(id, pageNo);
    }
    if (!(await loadMore.isVisible())) break;
    await loadMore.click();
    await expect(rows).toHaveCount(pageNo + 1);
  }
  await expect(page.getByText(/all loaded/)).toBeVisible();

  // Both same-time bookings appear, on different pages, and nothing repeats.
  expect(pageOf.get(rowA)).toBeDefined();
  expect(pageOf.get(rowB)).toBeDefined();
  expect(pageOf.get(rowA)).not.toBe(pageOf.get(rowB));
  expect(await rows.count()).toBe(pageOf.size);

  for (const id of [cancelled, own]) {
    await expect(page.locator(`[data-consultation-id="${id}"]`)).toBeVisible();
  }
  await expect(page.locator(`[data-consultation-id="${cancelled}"]`).getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-consultation-id="${rowA}"]`).getByText(a.id)).toBeVisible();

  // Read-only: no checkbox and no button inside the table, the admin's own row included.
  const table = page.getByRole("table");
  await expect(table.getByRole("checkbox")).toHaveCount(0);
  await expect(table.getByRole("button")).toHaveCount(0);

  // The API refuses an admin write on its own booking, too.
  const write = await page.request.patch(`/api/consultations/${own}`, { data: { completed: true } });
  expect(write.status()).toBe(403);
});
