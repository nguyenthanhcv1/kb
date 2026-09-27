"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MemberRole } from "@/server/members";

/**
 * Role picker (shadcn Select). `roles` limits the choices — guests and invitations never offer
 * `admin` (the DB refuses it anyway: `GUEST_CANNOT_BE_SPACE_ADMIN`).
 */
export function RoleSelect<R extends MemberRole>({
  value,
  roles,
  onChange,
  label,
  id,
  disabled,
  size = "default",
}: {
  value: R;
  roles: readonly R[];
  onChange: (role: R) => void;
  /** Accessible name (visible label elsewhere or `aria-label`). */
  label: string;
  id?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const t = useTranslations("space.roles");
  const tHint = useTranslations("members.roleHint");
  return (
    <Select value={value} onValueChange={(next) => onChange(next as R)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} size={size} className="w-full sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role} textValue={t(role as MemberRole)}>
            <span className="flex flex-col items-start">
              <span>{t(role as MemberRole)}</span>
              <span className="text-xs text-muted-foreground">{tHint(role as MemberRole)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
