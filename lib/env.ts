import { z } from "zod";

// Public values only: they are inlined into the browser bundle.
// Server-only secrets must never get the NEXT_PUBLIC_ prefix.
const required = (message: string) => ({
  error: (issue: { input: unknown }) =>
    issue.input === undefined || issue.input === "" ? "is missing" : message,
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(required("must be a URL")),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string(required("must be a string")).min(1, "is missing"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function parsePublicEnv(source: Record<keyof PublicEnv, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (result.success) return result.data;

  // Messages name the variable and the problem, never the value.
  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment variables:\n${problems}\n\n` +
      "Copy .env.example to .env.local and fill it in from `npx supabase status`.",
  );
}

// Each variable is read by its full name so Next.js can inline it in client code.
export const env = parsePublicEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
