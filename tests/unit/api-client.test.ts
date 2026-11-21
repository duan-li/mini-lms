import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, adminConsultationsApi, consultationsApi } from "@/lib/api/client";

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("consultationsApi", () => {
  it("returns `data` on success", async () => {
    mockFetch(200, { data: [{ id: "1" }] });
    await expect(consultationsApi.list()).resolves.toEqual([{ id: "1" }]);
  });

  it("sends JSON to the right route", async () => {
    const fetchMock = mockFetch(200, { data: { id: "1" } });
    await consultationsApi.setCompleted("abc", true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/consultations/abc",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("posts cancel without a body", async () => {
    const fetchMock = mockFetch(200, { data: { id: "1" } });
    await consultationsApi.cancel("abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/consultations/abc/cancel",
      expect.objectContaining({ method: "POST", body: undefined }),
    );
  });

  it("throws the API's error with status, code and field errors", async () => {
    mockFetch(400, { error: { code: "invalid_input", message: "Invalid input", fields: { scheduledAt: ["Must be in the future"] } } });
    const error = await consultationsApi.create({
      firstName: "A",
      lastName: "B",
      reason: "C",
      scheduledAt: "2030-01-01T00:00:00.000Z",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_input",
      fields: { scheduledAt: ["Must be in the future"] },
    });
  });

  it("gives a generic error for a body that is not JSON", async () => {
    mockFetch(502, "<html>Bad gateway</html>");
    await expect(consultationsApi.list()).rejects.toMatchObject({ status: 502, code: "unknown_error" });
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(consultationsApi.list()).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("adminConsultationsApi", () => {
  it("returns the whole page, nextCursor included", async () => {
    mockFetch(200, { data: [{ id: "1" }], nextCursor: "abc" });
    await expect(adminConsultationsApi.list()).resolves.toEqual({ data: [{ id: "1" }], nextCursor: "abc" });
  });

  it("asks for the first page without a query string", async () => {
    const fetchMock = mockFetch(200, { data: [], nextCursor: null });
    await adminConsultationsApi.list();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/consultations", expect.objectContaining({ method: "GET" }));
  });

  it("sends the cursor and page size, encoded", async () => {
    const fetchMock = mockFetch(200, { data: [], nextCursor: null });
    await adminConsultationsApi.list({ cursor: "a+b/c=", limit: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/consultations?cursor=a%2Bb%2Fc%3D&limit=5",
      expect.anything(),
    );
  });

  it("throws the API's error, such as 403 for a student", async () => {
    mockFetch(403, { error: { code: "forbidden", message: "Admins only." } });
    await expect(adminConsultationsApi.list()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
