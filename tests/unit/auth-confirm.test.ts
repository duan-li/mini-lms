import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/confirm/route";

const { verifyOtp, redirect } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  redirect: vi.fn(() => { throw new Error("redirect"); }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { verifyOtp } }) }));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
});

it.each([
  ["/dashboard", "/dashboard"],
  ["/auth/update-password", "/auth/update-password"],
  ["https://example.org", "/"],
  ["//example.org", "/"],
  ["/unrecognised", "/"],
  [null, "/"],
])("sends a verified confirmation with next=%s to %s", async (next, expected) => {
  const url = new URL("https://lms.example/auth/confirm?type=email&token_hash=test");
  if (next !== null) url.searchParams.set("next", next);
  await expect(GET(new NextRequest(url))).rejects.toThrow("redirect");
  expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "test" });
  expect(redirect).toHaveBeenCalledExactlyOnceWith(expected);
});
