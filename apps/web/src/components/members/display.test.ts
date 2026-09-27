import { describe, expect, it } from "vitest";

import { isValidEmail, memberDisplayName, memberInitials, sortMembers } from "./display";
import { invitationView } from "./invitation-view";

describe("member display helpers", () => {
  it("falls back from the name to the email to null", () => {
    expect(memberDisplayName({ fullName: " Lê Bình ", email: "binh@x.vn" })).toBe("Lê Bình");
    expect(memberDisplayName({ fullName: null, email: "binh@x.vn" })).toBe("binh@x.vn");
    expect(memberDisplayName({ fullName: null, email: null })).toBeNull();
  });

  it("builds initials from the first and last word, else the email", () => {
    expect(memberInitials({ fullName: "Nguyễn Văn An", email: null })).toBe("NA");
    expect(memberInitials({ fullName: "Ánh", email: null })).toBe("Á");
    expect(memberInitials({ fullName: null, email: "khach@partner.vn" })).toBe("K");
    expect(memberInitials({ fullName: null, email: null })).toBe("?");
  });

  it("sorts admins first, then by name ignoring accents", () => {
    const members = [
      { role: "viewer", fullName: "Đặng Cường", email: "c@x.vn" },
      { role: "editor", fullName: "Bình", email: "b@x.vn" },
      { role: "viewer", fullName: "An", email: "a@x.vn" },
      { role: "admin", fullName: "Zoe", email: "z@x.vn" },
    ] as const;
    expect(sortMembers(members, "vi").map((m) => m.fullName)).toEqual([
      "Zoe",
      "Bình",
      "An",
      "Đặng Cường",
    ]);
  });

  it("checks email shape loosely", () => {
    expect(isValidEmail(" guest@partner.vn ")).toBe(true);
    expect(isValidEmail("guest@partner")).toBe(false);
    expect(isValidEmail("not an email")).toBe(false);
  });
});

describe("invitationView", () => {
  it("accepts a pending invitation for the signed-in email", () => {
    expect(invitationView({ status: "pending", emailMatches: true })).toEqual({ kind: "accept" });
  });

  it("asks to switch account when the email differs", () => {
    expect(invitationView({ status: "pending", emailMatches: false })).toEqual({
      kind: "mismatch",
    });
  });

  it.each([
    ["expired", "INVITATION_EXPIRED"],
    ["revoked", "INVITATION_REVOKED"],
    ["accepted", "INVITATION_ALREADY_USED"],
  ] as const)("reports a %s invitation as %s", (status, code) => {
    expect(invitationView({ status, emailMatches: false })).toEqual({
      kind: "error",
      code,
      canOpenSpace: false,
    });
  });

  it("offers to open the Space when the invitee already accepted it", () => {
    expect(invitationView({ status: "accepted", emailMatches: true })).toMatchObject({
      canOpenSpace: true,
    });
  });
});
