import type { InvitationPreview, MemberErrorCode } from "@/server/members";

/**
 * What `/invite/[token]` shows for a previewed invitation:
 * - `accept`: pending and addressed to the signed-in email;
 * - `mismatch`: pending but for another email → sign out and switch account;
 * - `error`: used / revoked / expired (the same codes `acceptInvitation` would fail with).
 */
export type InvitationView =
  | { kind: "accept" }
  | { kind: "mismatch" }
  | { kind: "error"; code: MemberErrorCode; canOpenSpace: boolean };

export function invitationView(
  preview: Pick<InvitationPreview, "status" | "emailMatches">,
): InvitationView {
  switch (preview.status) {
    case "accepted":
      // Probably accepted by this person earlier: offer the Space (not found if it was someone else).
      return { kind: "error", code: "INVITATION_ALREADY_USED", canOpenSpace: preview.emailMatches };
    case "revoked":
      return { kind: "error", code: "INVITATION_REVOKED", canOpenSpace: false };
    case "expired":
      return { kind: "error", code: "INVITATION_EXPIRED", canOpenSpace: false };
    case "pending":
      return preview.emailMatches ? { kind: "accept" } : { kind: "mismatch" };
  }
}
