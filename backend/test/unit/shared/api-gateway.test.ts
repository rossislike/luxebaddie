import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { header, httpRouter, parseBody } from "../../../src/shared/adapters/api-gateway";
import { conflict, notFound } from "../../../src/shared/errors";

const request = (overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent =>
  ({ httpMethod: "GET", resource: "/thing", headers: {}, body: null, ...overrides }) as APIGatewayProxyEvent;

const router = httpRouter({
  "GET /thing": async () => ({ body: { ok: true } }),
  "POST /thing": async (event) => ({ statusCode: 201, body: parseBody(event, z.object({ name: z.string() })) }),
  "DELETE /thing": async () => ({ statusCode: 204, body: null }),
  "GET /missing": async () => {
    throw notFound("Thing");
  },
  "GET /taken": async () => {
    throw conflict("Already taken", { reason: "duplicate" });
  },
  "GET /broken": async () => {
    throw new Error("database password is hunter2");
  },
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("httpRouter", () => {
  it("returns JSON for a matching route", async () => {
    const response = await router(request({}));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 404 for a route that does not exist", async () => {
    expect((await router(request({ resource: "/nope" }))).statusCode).toBe(404);
  });

  it("sends an empty body with 204", async () => {
    expect(await router(request({ httpMethod: "DELETE" }))).toMatchObject({ statusCode: 204, body: "" });
  });

  it("rejects bodies that are not JSON or do not match the schema", async () => {
    const post = (body: string) => router(request({ httpMethod: "POST", body }));
    expect((await post(JSON.stringify({ name: "wig" }))).statusCode).toBe(201);
    expect((await post("{not json")).statusCode).toBe(400);
    expect((await post(JSON.stringify({ name: 5 }))).statusCode).toBe(400);
  });

  it("maps business errors to status codes and passes their details on", async () => {
    expect((await router(request({ resource: "/missing" }))).statusCode).toBe(404);

    const taken = await router(request({ resource: "/taken" }));
    expect(taken.statusCode).toBe(409);
    expect(JSON.parse(taken.body)).toEqual({ message: "Already taken", details: { reason: "duplicate" } });
  });

  it("hides the details of unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await router(request({ resource: "/broken" }));
    expect(broken.statusCode).toBe(500);
    expect(broken.body).not.toContain("hunter2");
  });

  it("sends CORS headers to allowed origins only", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://luxebaddy.com,http://localhost:3000");

    const allowed = await router(request({ headers: { origin: "http://localhost:3000" } }));
    expect(allowed.headers?.["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");

    const denied = await router(request({ headers: { origin: "https://evil.example" } }));
    expect(denied.headers?.["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("header", () => {
  it("finds a header whatever its capitalisation", () => {
    expect(header(request({ headers: { "Stripe-Signature": "abc" } }), "stripe-signature")).toBe("abc");
    expect(header(request({}), "stripe-signature")).toBeUndefined();
  });
});
