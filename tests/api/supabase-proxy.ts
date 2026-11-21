import http from "node:http";

// A pass-through proxy between the test app and local Supabase, so tests can
// make Supabase fail on purpose. The app's Supabase URL is fixed at build
// time, so the failure has to be injected on the network path, not in the app.
//
// Control (from tests, over HTTP):
//   PUT    <proxy>/__test__/auth-outage   GoTrue's /auth/v1/user answers 503
//   DELETE <proxy>/__test__/auth-outage   back to normal

export const AUTH_OUTAGE_PATH = "/__test__/auth-outage";

export type SupabaseProxy = { url: string; close: () => Promise<void> };

export function startSupabaseProxy(upstreamUrl: string, port: number): Promise<SupabaseProxy> {
  const upstream = new URL(upstreamUrl);
  let authOutage = false;

  const server = http.createServer((req, res) => {
    const path = req.url ?? "/";

    if (path === AUTH_OUTAGE_PATH) {
      authOutage = req.method === "PUT";
      res.writeHead(204).end();
      return;
    }

    // The shape GoTrue sends when it is unhealthy.
    if (authOutage && path.startsWith("/auth/v1/user")) {
      res
        .writeHead(503, { "content-type": "application/json" })
        .end(JSON.stringify({ code: 503, error_code: "unexpected_failure", msg: "Auth outage (test)" }));
      return;
    }

    const forward = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path,
        headers: { ...req.headers, host: upstream.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    forward.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(forward);
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) =>
      reject(new Error(`API tests: could not start the Supabase proxy on port ${port}: ${err.message}`)),
    );
    server.listen(port, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    );
  });
}
