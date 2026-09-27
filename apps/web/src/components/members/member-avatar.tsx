import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SpaceMember } from "@/server/members";

import { memberInitials } from "./display";

/** Decorative avatar (the name is next to it): Google picture, else initials. */
export function MemberAvatar({
  member,
}: {
  member: Pick<SpaceMember, "avatarUrl" | "fullName" | "email">;
}) {
  return (
    <Avatar className="size-9" aria-hidden>
      {member.avatarUrl && (
        <AvatarImage src={member.avatarUrl} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback className="text-xs font-medium">{memberInitials(member)}</AvatarFallback>
    </Avatar>
  );
}
