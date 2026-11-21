import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { resolveSupabaseEnv } from "../integration/global-setup";
import { type SupabaseProxy, startSupabaseProxy } from "./supabase-proxy";

// The API tests talk to a real Next.js server over HTTP. This setup builds the
// app into its own directory, starts it on its own port, waits until it
// answers, and at the end stops only the process it started. A reviewer's
// `npm run dev` on port 3000 (and its .next directory) is never touched.
//
// The app reaches Supabase through a pass-through proxy on the next port up
// (3101), so tests can simulate a Supabase Auth outage (see supabase-proxy.ts).
//
//   API_TEST_PORT=3100        port for the test server; the proxy uses PORT + 1
//   API_TEST_SKIP_BUILD=1     reuse the last build in .next-test (faster reruns)

declare module "vitest" {
  export interface ProvidedContext {
    apiBaseUrl: string;
    /** The Supabase proxy the app talks to; tests use it to inject failures. */
    supabaseProxyUrl: string;
  }
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST_DIR = ".next-test";
const NEXT_BIN = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
const PORT = Number(process.env.API_TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;
let proxy: SupabaseProxy | undefined;

export default async function setup(project: TestProject) {
  const supabase = resolveSupabaseEnv();
  project.provide("supabase", supabase);
  project.provide("apiBaseUrl", BASE_URL);

  if (await responds(BASE_URL)) {
    throw new Error(`API tests: port ${PORT} is already in use. Stop that process or set API_TEST_PORT.`);
  }

  // Fixed port: the URL is built into the app, so a reused build must find it again.
  proxy = await startSupabaseProxy(supabase.url, PORT + 1);
  project.provide("supabaseProxyUrl", proxy.url);

  // The app gets only the public values. The secret key stays in this
  // process, which uses it to create test users.
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: proxy.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
  };
  delete appEnv.SUPABASE_SECRET_KEY;

  // A build is reusable only if it was made for the same Supabase URL, which
  // is built into the app. The URL is recorded next to the build.
  const marker = `${ROOT}/${DIST_DIR}/api-test-supabase-url`;
  const reusable =
    process.env.API_TEST_SKIP_BUILD === "1" &&
    existsSync(`${ROOT}/${DIST_DIR}/BUILD_ID`) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8") === proxy.url;
  if (!reusable) {
    try {
      await run(["build"], appEnv);
    } catch (err) {
      await teardown();
      throw err;
    }
    writeFileSync(marker, proxy.url);
  }

  server = spawn(process.execPath, [NEXT_BIN, "start", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    cwd: ROOT,
    env: appEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitUntilReady(server);
  } catch (err) {
    await teardown();
    throw new Error(`${(err as Error).message}\n--- next start output ---\n${output.join("")}`);
  }

  return teardown;
}

async function teardown() {
  const child = server;
  server = undefined;
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  }
  await proxy?.close();
  proxy = undefined;
}

/** Runs `next <args>` to completion, failing with its output on a non-zero exit. */
function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT_BIN, ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const output: string[] = [];
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`next ${args.join(" ")} failed (exit ${code}):\n${output.join("")}`)),
    );
  });
}

/** Ready when a signed-out request to the API gets its 401. */
async function waitUntilReady(child: ChildProcess, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early (code ${child.exitCode}).`);
    const res = await fetch(`${BASE_URL}/api/consultations`, { redirect: "manual" }).catch(() => null);
    if (res?.status === 401) return;
    if (res) throw new Error(`Test server answered ${res.status} instead of 401 on GET /api/consultations.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Test server did not start on ${BASE_URL} within ${timeoutMs / 1000}s.`);
}

async function responds(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(1_000) }).then(
    () => true,
    () => false,
  );
}
