import { createApiClient } from "@luxebaddie/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the API client's timeout", () => {
  it("starts once the caller's headers are ready, so it covers the call alone", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const startClock = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      order.push("clock started");
      return startClock(ms);
    });
    const tokenAfterAMoment = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("headers ready");
      return { Authorization: "Bearer t" };
    };

    await createApiClient({ baseUrl: () => "https://api.example.com", headers: tokenAfterAMoment })("/order");

    expect(order).toEqual(["headers ready", "clock started"]);
  });

  it("sends the caller's headers with every call", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const apiFetch = createApiClient({ baseUrl: () => "https://api.example.com", headers: async () => ({ Authorization: "Bearer t" }) });

    await apiFetch("/order", { method: "PUT", json: { a: 1 } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/order",
      expect.objectContaining({ headers: { Authorization: "Bearer t", "Content-Type": "application/json" } }),
    );
  });
});
