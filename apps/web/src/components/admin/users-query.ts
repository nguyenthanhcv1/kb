import { USER_STATUS_FILTERS, type UserStatusFilter } from "@/server/admin";

/** Users per page of `/admin/users` (the contract accepts up to 200). */
export const USERS_PAGE_SIZE = 50;

export type UsersQuery = { query: string; status: UserStatusFilter; offset: number };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?q=&status=&offset=` of `/admin/users`, with anything invalid falling back to the default. */
export function parseUsersSearchParams(params: SearchParams): UsersQuery {
  const query = (first(params.q) ?? "").trim().slice(0, 200);
  const rawStatus = first(params.status);
  const status = USER_STATUS_FILTERS.includes(rawStatus as UserStatusFilter)
    ? (rawStatus as UserStatusFilter)
    : "all";
  const rawOffset = Number.parseInt(first(params.offset) ?? "", 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { query, status, offset };
}

/** Link to `/admin/users` for a query; default values are left out of the URL. */
export function usersHref({ query, status, offset }: UsersQuery): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status !== "all") params.set("status", status);
  if (offset > 0) params.set("offset", String(offset));
  const search = params.toString();
  return search ? `/admin/users?${search}` : "/admin/users";
}
