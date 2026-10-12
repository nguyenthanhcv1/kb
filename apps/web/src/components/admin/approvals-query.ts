import { ACCOUNT_REVIEW_STATUSES, type AccountReviewStatus } from "@/server/admin";

/** Accounts per page of `/admin/approvals` (the contract accepts up to 200). */
export const APPROVALS_PAGE_SIZE = 50;

export type ApprovalsQuery = { status: AccountReviewStatus; offset: number };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?status=&offset=` of `/admin/approvals`, with anything invalid falling back to the default. */
export function parseApprovalsSearchParams(params: SearchParams): ApprovalsQuery {
  const rawStatus = first(params.status);
  const status = ACCOUNT_REVIEW_STATUSES.includes(rawStatus as AccountReviewStatus)
    ? (rawStatus as AccountReviewStatus)
    : "pending";
  const rawOffset = Number.parseInt(first(params.offset) ?? "", 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { status, offset };
}

/** Link to `/admin/approvals` for a query; default values are left out of the URL. */
export function approvalsHref({ status, offset }: ApprovalsQuery): string {
  const params = new URLSearchParams();
  if (status !== "pending") params.set("status", status);
  if (offset > 0) params.set("offset", String(offset));
  const search = params.toString();
  return search ? `/admin/approvals?${search}` : "/admin/approvals";
}
