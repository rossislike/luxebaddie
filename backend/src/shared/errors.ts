/**
 * Errors the business logic raises on purpose. They say what went wrong in
 * business terms; each delivery adapter decides how to present it (the HTTP
 * adapter maps `kind` to a status code).
 */
export type AppErrorKind = "invalid" | "not_found" | "conflict";

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message: string,
    /** Extra data for the caller, e.g. the refreshed basket on a conflict. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const invalid = (message: string, details?: unknown) => new AppError("invalid", message, details);
export const notFound = (what: string) => new AppError("not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError("conflict", message, details);
