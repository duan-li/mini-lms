import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

export type SupabaseTestEnv = {
  url: string;
  publishableKey: string;
  secretKey: string;
};

declare module "vitest" {
  export interface ProvidedContext {
    supabase: SupabaseTestEnv;
  }
}

// Reads `npx supabase status -o env` into a map, so the integration tests
// work after `npx supabase start` without copying any key by hand.
function readSupabaseStatus(): Record<string, string> {
  let output: string;
  try {
    output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "Local Supabase is not running. Start it with `npx supabase start`, then `npx supabase db reset`.",
    );
  }
  const values: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

// The secret key stays in the test process: it is used only to create users
// and to read rows as they really are, never by the app.
export default function setup(project: TestProject) {
  const fromEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  };
  const status =
    fromEnv.url && fromEnv.publishableKey && fromEnv.secretKey ? {} : readSupabaseStatus();

  const env: SupabaseTestEnv = {
    url: fromEnv.url || status.API_URL,
    publishableKey: fromEnv.publishableKey || status.PUBLISHABLE_KEY,
    secretKey: fromEnv.secretKey || status.SECRET_KEY,
  };
  for (const [name, value] of Object.entries(env)) {
    if (!value) throw new Error(`Integration tests: could not find the Supabase ${name}.`);
  }
  project.provide("supabase", env);
}
