import { describe, expect, it } from "vitest";

import { ACCESS_BULK_MAX, addAccessEntriesExample } from "@/server/admin";

import { accessInputProblem, notAddedResults, summarizeAccessInput } from "./access-input";
import { adminErrorKey } from "./errors";
import { userActionInput, userActions } from "./user-actions";
import { parseUsersSearchParams, usersHref } from "./users-query";

describe("summarizeAccessInput", () => {
  it("counts valid emails/domains, invalid and duplicate tokens, and flags public domains", () => {
    const summary = summarizeAccessInput(
      "An <An@Ahamove.com>; ahamove.com, gmail.com\nnope an@ahamove.com",
    );
    expect(summary).toMatchObject({
      valid: 3,
      emails: 1,
      domains: 2,
      invalid: 1,
      duplicate: 1,
      publicDomains: ["gmail.com"],
      tooMany: false,
    });
  });

  it("is empty for blank input", () => {
    const summary = summarizeAccessInput("  \n ,; ");
    expect(summary.tokens).toHaveLength(0);
    expect(accessInputProblem(summary, false)).toBe("empty");
  });

  it("flags more tokens than one call accepts", () => {
    const input = Array.from({ length: ACCESS_BULK_MAX + 1 }, (_, i) => `u${i}@a.vn`).join(",");
    const summary = summarizeAccessInput(input);
    expect(summary.tooMany).toBe(true);
    expect(accessInputProblem(summary, true)).toBe("tooMany");
  });
});

describe("accessInputProblem", () => {
  it("requires the confirmation for public email domains only", () => {
    expect(accessInputProblem(summarizeAccessInput("gmail.com"), false)).toBe(
      "publicConfirmRequired",
    );
    expect(accessInputProblem(summarizeAccessInput("gmail.com"), true)).toBeNull();
    // An email at a public domain is fine.
    expect(accessInputProblem(summarizeAccessInput("an@gmail.com"), false)).toBeNull();
  });

  it("rejects input without any valid token", () => {
    expect(accessInputProblem(summarizeAccessInput("nope, @@"), true)).toBe("empty");
  });
});

describe("notAddedResults", () => {
  it("keeps every token that was not inserted", () => {
    expect(notAddedResults(addAccessEntriesExample.results).map((row) => row.status)).toEqual([
      "publicDomainUnconfirmed",
      "invalid",
    ]);
  });
});

describe("adminErrorKey", () => {
  it("maps codes to errors.<CODE> with a fallback for unknown codes", () => {
    expect(adminErrorKey("ACCESS_CANNOT_REMOVE_SELF")).toBe("errors.ACCESS_CANNOT_REMOVE_SELF");
    expect(adminErrorKey("NOPE" as never)).toBe("errors.ADMIN_ACTION_FAILED");
  });
});

describe("userActions", () => {
  const base = { isSelf: false, isGuest: false, isSuperAdmin: false, deactivatedAt: null };

  it("offers lock + grant for an active internal user", () => {
    expect(userActions(base)).toEqual([
      { action: "lock", disabled: false },
      { action: "grant", disabled: false },
    ]);
  });

  it("never lets you lock yourself or revoke your own super admin", () => {
    expect(userActions({ ...base, isSelf: true, isSuperAdmin: true })).toEqual([
      { action: "lock", disabled: true },
      { action: "revoke", disabled: true },
    ]);
  });

  it("offers unlock for a locked user and no super admin grant for guests or locked users", () => {
    expect(userActions({ ...base, deactivatedAt: "2026-09-27T00:00:00+00:00" })).toEqual([
      { action: "unlock", disabled: false },
      { action: "grant", disabled: true },
    ]);
    expect(userActions({ ...base, isGuest: true })[1]).toEqual({ action: "grant", disabled: true });
  });

  it("builds the Server Action input", () => {
    expect(userActionInput("lock", "u1")).toEqual({
      kind: "deactivate",
      input: { userId: "u1", deactivated: true },
    });
    expect(userActionInput("unlock", "u1").input).toEqual({ userId: "u1", deactivated: false });
    expect(userActionInput("grant", "u1")).toEqual({
      kind: "superAdmin",
      input: { userId: "u1", superAdmin: true },
    });
    expect(userActionInput("revoke", "u1").input).toEqual({ userId: "u1", superAdmin: false });
  });
});

describe("users search params", () => {
  it("parses q/status/offset and falls back on invalid values", () => {
    expect(parseUsersSearchParams({ q: "  an ", status: "deactivated", offset: "50" })).toEqual({
      query: "an",
      status: "deactivated",
      offset: 50,
    });
    expect(parseUsersSearchParams({ status: "weird", offset: "-3" })).toEqual({
      query: "",
      status: "all",
      offset: 0,
    });
    expect(parseUsersSearchParams({ q: ["a", "b"], offset: "x" }).query).toBe("a");
  });

  it("builds links without default values", () => {
    expect(usersHref({ query: "", status: "all", offset: 0 })).toBe("/admin/users");
    expect(usersHref({ query: "an b", status: "active", offset: 50 })).toBe(
      "/admin/users?q=an+b&status=active&offset=50",
    );
  });
});
