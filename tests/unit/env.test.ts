import { afterEach, describe, expect, it, vi } from "vitest";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

// lib/env validates on import, the same way it runs at server startup,
// so each test sets the environment first and then imports a fresh copy.
async function loadEnv(vars: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.resetModules();
  return import("@/lib/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lib/env", () => {
  it("exposes the validated values", async () => {
    const { env } = await loadEnv(VALID);

    expect(env).toEqual(VALID);
  });

  it("names a missing variable and says how to fix it", async () => {
    const load = loadEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: undefined });

    await expect(load).rejects.toThrow(
      /Invalid environment variables:\n {2}- NEXT_PUBLIC_SUPABASE_URL: is missing/,
    );
    await expect(load).rejects.toThrow(/\.env\.example/);
    await expect(load).rejects.toThrow(/npx supabase status/);
  });

  it("treats an empty value as missing", async () => {
    const load = loadEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" });

    await expect(load).rejects.toThrow(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: is missing",
    );
  });

  it("lists every problem at once", async () => {
    const load = loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });

    await expect(load).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL: is missing\n {2}- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: is missing/,
    );
  });

  it("rejects a placeholder that is not a URL, without echoing the value", async () => {
    const load = loadEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "your-project-url" });

    await expect(load).rejects.toThrow("NEXT_PUBLIC_SUPABASE_URL: must be a URL");
    await expect(load).rejects.not.toThrow("your-project-url");
  });
});
