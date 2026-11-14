import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let apiFetch: typeof import("@/lib/api").apiFetch;
let ApiError: typeof import("@/lib/api").ApiError;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/dev");
  vi.spyOn(Math, "random").mockReturnValue(0); // no waiting between retries
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  ({ apiFetch, ApiError } = await import("@/lib/api"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("returns the parsed body of a successful call", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { products: [] }));

    expect(await apiFetch("/product")).toEqual({ products: [] });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/dev/product", expect.anything());
  });

  it("retries an idempotent call after a transient failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(json(503, { message: "busy" }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    expect(await apiFetch("/basket/1", { method: "PUT", json: { items: [] } })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three attempts", async () => {
    fetchMock.mockImplementation(async () => json(503, { message: "busy" }));

    await expect(apiFetch("/product")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a real answer such as a validation error", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { message: "Invalid request body" }));

    await expect(apiFetch("/basket/1", { method: "PUT", json: {} })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries starting a checkout, which is not idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { message: "busy" }));

    await expect(apiFetch("/basket/1/checkout", { method: "POST" })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries the details the API attached to an error", async () => {
    fetchMock.mockResolvedValueOnce(json(409, { message: "Your bag is empty", details: { lines: [] } }));

    await expect(apiFetch("/basket/1/checkout", { method: "POST" })).rejects.toMatchObject({
      status: 409,
      message: "Your bag is empty",
      details: { lines: [] },
    });
  });
});
