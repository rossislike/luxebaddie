import { invalid } from "../shared/errors";

/**
 * List endpoints page through an item collection. The cursor is DynamoDB's
 * "last evaluated key", wrapped so callers can pass it back without knowing
 * anything about keys. A cursor only ever resumes the query it came from:
 * DynamoDB rejects one that points outside the partition being read.
 */
export function encodeCursor(lastEvaluatedKey: Record<string, unknown> | undefined): string | null {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (key && typeof key === "object" && !Array.isArray(key)) return key as Record<string, unknown>;
  } catch {
    // fall through to the error below
  }
  throw invalid("Invalid cursor");
}
