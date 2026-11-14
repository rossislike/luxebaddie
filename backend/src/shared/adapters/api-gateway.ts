import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { z } from "zod";
import { AppError, type AppErrorKind, invalid } from "../errors";

const STATUS_BY_ERROR_KIND: Record<AppErrorKind, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
};

export type RouteResult = { statusCode?: number; body: unknown };
export type Route = (event: APIGatewayProxyEvent) => Promise<RouteResult>;
export type HttpHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Builds an API Gateway handler from a route table keyed by
 * "<METHOD> <resource>", e.g. "GET /product/{id}". Routes translate the HTTP
 * request into a use-case call; JSON encoding, CORS and error responses are
 * handled here, once.
 */
export function httpRouter(routes: Record<string, Route>): HttpHandler {
  return async (event) => {
    const headers = { "Content-Type": "application/json", ...corsHeaders(event) };
    const routeKey = `${event.httpMethod} ${event.resource}`;
    try {
      const route = routes[routeKey];
      if (!route) throw new AppError("not_found", `No route for ${routeKey}`);
      const { statusCode = 200, body } = await route(event);
      return { statusCode, headers, body: body === null ? "" : JSON.stringify(body) };
    } catch (error) {
      return { headers, ...errorResponse(routeKey, error) };
    }
  };
}

function errorResponse(routeKey: string, error: unknown): Pick<APIGatewayProxyResult, "statusCode" | "body"> {
  if (error instanceof AppError) {
    return {
      statusCode: STATUS_BY_ERROR_KIND[error.kind],
      body: JSON.stringify({ message: error.message, details: error.details }),
    };
  }
  // Unexpected: log everything, tell the caller nothing about our internals.
  console.error("Unhandled error", { routeKey, error });
  return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
}

function corsHeaders(event: APIGatewayProxyEvent): Record<string, string> {
  const origin = allowedOrigin(event);
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

/** The storefront the browser called from, if it is one of ours. Undefined for any other caller. */
export function allowedOrigin(event: APIGatewayProxyEvent): string | undefined {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  const origin = header(event, "origin");
  return origin && allowedOrigins.includes(origin) ? origin : undefined;
}

/** Reads a header regardless of the capitalisation the client used. */
export function header(event: APIGatewayProxyEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const match = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === wanted);
  return match?.[1];
}

/** The request body exactly as the client sent it. */
export function rawBody(event: APIGatewayProxyEvent): string {
  const body = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
}

export function parseBody<T>(event: APIGatewayProxyEvent, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(rawBody(event));
  } catch {
    throw invalid("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalid("Invalid request body", parsed.error.issues);
  return parsed.data;
}

export function pathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw invalid(`Missing path parameter ${name}`);
  return decodeURIComponent(value);
}
