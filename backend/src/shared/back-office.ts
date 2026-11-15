/**
 * The back-office functions (managing the catalog, working orders) are
 * reachable two ways, and API Gateway decides who gets through each door
 * before any Lambda runs:
 *
 *   /admin/...       requests signed with AWS credentials: scripts, automation, tests
 *   /backoffice/...  requests carrying the owner's sign-in token: the back-office site
 *
 * Behind either door the route is the same, so a service declares each
 * back-office route once and it is served under both.
 */
export const AWS_SIGNED_PREFIX = "/admin";
export const OWNER_SIGNED_IN_PREFIX = "/backoffice";

export const BACK_OFFICE_PREFIXES = [AWS_SIGNED_PREFIX, OWNER_SIGNED_IN_PREFIX] as const;
