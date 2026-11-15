import type { APIGatewayProxyEvent } from "aws-lambda";
import { z } from "zod";
import { invalid } from "../errors";
import type { PageRequest } from "../paging";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const pageSizeSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

/**
 * The page a list request asks for: ?limit= (default 25, at most 100) and the
 * previous response's nextCursor as ?cursor=.
 */
export function pageRequest(event: APIGatewayProxyEvent): PageRequest {
  const limit = pageSizeSchema.safeParse(event.queryStringParameters?.limit);
  if (!limit.success) throw invalid(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  return { limit: limit.data, cursor: event.queryStringParameters?.cursor };
}
