// Runs once when the Next.js server starts: a missing or invalid variable
// stops startup with a readable error instead of failing on the first request.
export async function register() {
  await import("./lib/env");
}
