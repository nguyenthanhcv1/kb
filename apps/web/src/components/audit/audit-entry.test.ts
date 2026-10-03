import enAudit from "@kb/i18n/messages/en/audit.json";
import viAudit from "@kb/i18n/messages/vi/audit.json";
import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/server/audit";

import {
  SPACE_AUDIT_ACTIONS,
  SPACE_AUDIT_ACTION_GROUPS,
  auditActionLabel,
  auditEntityTypeKey,
  auditPageHref,
  describeAuditEntry,
  nameInitials,
  parseAuditCursor,
  parseSpaceAuditAction,
} from "./audit-entry";

function lookup(messages: object, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, messages);
}

const person = { id: "7c1e0000-0000-4000-8000-000000000003", email: "b@x.vn", fullName: "Bình" };

describe("action labels", () => {
  it("maps every action code to a label present in vi and en", () => {
    for (const action of AUDIT_ACTIONS) {
      const { key, values } = auditActionLabel(action);
      expect(values).toBeUndefined();
      expect(typeof lookup(viAudit, key), `vi ${key}`).toBe("string");
      expect(typeof lookup(enAudit, key), `en ${key}`).toBe("string");
    }
    expect(auditActionLabel("member.role_change").key).toBe("actions.member_role_change");
  });

  it("falls back to the unknown label with the raw code for new actions", () => {
    expect(auditActionLabel("comment.create")).toEqual({
      key: "actions.unknown",
      values: { action: "comment.create" },
    });
  });

  it("maps known entity types only", () => {
    expect(auditEntityTypeKey("member")).toBe("entityTypes.member");
    expect(auditEntityTypeKey("comment")).toBeNull();
  });
});

describe("Space filter", () => {
  it("offers only Space-level actions, grouped by entity", () => {
    expect(SPACE_AUDIT_ACTION_GROUPS.map((g) => g.group)).toEqual([
      "space",
      "member",
      "invitation",
      "page",
      "version",
    ]);
    expect(SPACE_AUDIT_ACTIONS).toContain("member.role_change");
    expect(SPACE_AUDIT_ACTIONS).not.toContain("access.add");
    expect(SPACE_AUDIT_ACTIONS).not.toContain("settings.update");
    expect(SPACE_AUDIT_ACTIONS).not.toContain("user.deactivate");
    for (const { group } of SPACE_AUDIT_ACTION_GROUPS) {
      expect(typeof lookup(viAudit, `entityTypes.${group}`)).toBe("string");
    }
  });

  it("parses ?action= and ignores unknown or system-wide codes", () => {
    expect(parseSpaceAuditAction("member.add")).toBe("member.add");
    expect(parseSpaceAuditAction(["space.create", "member.add"])).toBe("space.create");
    expect(parseSpaceAuditAction("access.add")).toBeNull();
    expect(parseSpaceAuditAction("nope")).toBeNull();
    expect(parseSpaceAuditAction(undefined)).toBeNull();
    expect(parseAuditCursor("")).toBeNull();
    expect(parseAuditCursor("abc")).toBe("abc");
  });

  it("builds page URLs with filter and cursor", () => {
    const base = "/s/design/settings/audit";
    expect(auditPageHref(base, {})).toBe(base);
    expect(auditPageHref(base, { action: "member.add" })).toBe(`${base}?action=member.add`);
    expect(auditPageHref(base, { action: null, cursor: "abc" })).toBe(`${base}?cursor=abc`);
    expect(auditPageHref(base, { action: "member.add", cursor: "a=b" })).toBe(
      `${base}?action=member.add&cursor=a%3Db`,
    );
  });
});

describe("describeAuditEntry", () => {
  const people = { [person.id]: person };

  it("shows the member and the role change", () => {
    expect(
      describeAuditEntry(
        {
          action: "member.role_change",
          entityType: "member",
          metadata: { user_id: person.id.toUpperCase(), from_role: "viewer", to_role: "editor" },
        },
        people,
      ),
    ).toEqual({
      target: { kind: "person", person },
      details: [{ kind: "roleChange", from: "viewer", to: "editor" }],
    });
  });

  it("marks members who left by themselves and unknown people", () => {
    expect(
      describeAuditEntry(
        {
          action: "member.remove",
          entityType: "member",
          metadata: { user_id: "7c1e0000-0000-4000-8000-00000000ffff", role: "viewer", self: true },
        },
        people,
      ),
    ).toEqual({
      target: { kind: "person", person: null },
      details: [{ kind: "role", role: "viewer" }, { kind: "left" }],
    });
  });

  it("shows invitation email, role and expiry", () => {
    expect(
      describeAuditEntry(
        {
          action: "invitation.create",
          entityType: "invitation",
          metadata: { email: "khach@x.vn", role: "viewer", expires_at: "2026-10-09T00:00:00Z" },
        },
        {},
      ),
    ).toEqual({
      target: { kind: "text", text: "khach@x.vn" },
      details: [
        { kind: "role", role: "viewer" },
        { kind: "expiresAt", at: "2026-10-09T00:00:00Z" },
      ],
    });
  });

  it("lists changed Space fields", () => {
    expect(
      describeAuditEntry(
        {
          action: "space.update",
          entityType: "space",
          metadata: {
            changes: {
              name: { from: "Design", to: "Thiết kế" },
              visibility: { from: "restricted", to: "internal" },
              broken: "x",
            },
          },
        },
        {},
      ),
    ).toEqual({
      target: { kind: "entity", entityType: "space" },
      details: [
        { kind: "fieldChange", field: "name", from: "Design", to: "Thiết kế" },
        { kind: "fieldChange", field: "visibility", from: "restricted", to: "internal" },
      ],
    });
  });

  it("uses the name for space entries and the entity type as last resort", () => {
    expect(
      describeAuditEntry(
        { action: "space.create", entityType: "space", metadata: { name: "D" } },
        {},
      ),
    ).toEqual({ target: { kind: "text", text: "D" }, details: [] });
    expect(
      describeAuditEntry({ action: "comment.create", entityType: "comment", metadata: {} }, {}),
    ).toEqual({ target: { kind: "entity", entityType: "comment" }, details: [] });
  });
});

describe("nameInitials", () => {
  it("takes the first and last word", () => {
    expect(nameInitials("Nguyễn Văn An")).toBe("NA");
    expect(nameInitials("an@x.vn")).toBe("A");
    expect(nameInitials("  ")).toBe("");
  });
});

describe("audit filters (T6.4b)", () => {
  const ACTOR = "5d2f0000-0000-4000-8000-000000000002";

  it("parses valid filters and ignores invalid ones", async () => {
    const { parseAuditFilters } = await import("./audit-entry");
    expect(
      parseAuditFilters({
        type: "page",
        action: "page.create",
        actor: ACTOR.toUpperCase(),
        from: "2026-09-01",
        to: "2026-09-30",
      }),
    ).toEqual({
      type: "page",
      action: "page.create",
      actor: ACTOR,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(
      parseAuditFilters({
        type: "access_entry",
        action: "access.add",
        actor: "x",
        from: "2026-02-31",
        to: "nope",
      }),
    ).toEqual({ type: null, action: null, actor: null, from: null, to: null });
  });

  it("drops an inverted range's upper bound", async () => {
    const { parseAuditFilters } = await import("./audit-entry");
    expect(parseAuditFilters({ from: "2026-09-10", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-10",
      to: null,
    });
  });

  it("turns days into Vietnam-time instants, `to` exclusive", async () => {
    const { auditRange } = await import("./audit-entry");
    expect(auditRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({
      from: "2026-09-01T00:00:00+07:00",
      to: "2026-10-01T00:00:00+07:00",
    });
    expect(auditRange({ from: null, to: null })).toEqual({ from: undefined, to: undefined });
  });

  it("builds page and export URLs", async () => {
    const { auditPageHref, auditExportHref, NO_AUDIT_FILTERS } = await import("./audit-entry");
    const f = { ...NO_AUDIT_FILTERS, type: "page" as const, from: "2026-09-01" };
    expect(auditPageHref("/b", { ...f, cursor: "c" })).toBe(
      "/b?type=page&from=2026-09-01&cursor=c",
    );
    const url = new URL(auditExportHref("sp", f), "http://x");
    expect(url.pathname).toBe("/api/audit/export");
    expect(url.searchParams.get("space")).toBe("sp");
    expect(url.searchParams.get("type")).toBe("page");
    expect(url.searchParams.get("from")).toBe("2026-09-01T00:00:00+07:00");
  });
});
