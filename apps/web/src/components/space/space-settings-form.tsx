"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { Space } from "@/server/space";
import { updateSpace } from "@/server/space/actions";

import { formValuesToInput, spaceToFormValues } from "./space-form";
import { SpaceFormFields } from "./space-form-fields";
import { useSpaceForm } from "./use-space-form";

/**
 * General settings of a Space (admins only — the page checks `canManageSpace`, RLS enforces it).
 * A changed slug moves the settings page to the new URL.
 */
export function SpaceSettingsForm({ space }: { space: Space }) {
  const t = useTranslations();
  const router = useRouter();
  const idPrefix = useId();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const form = useSpaceForm(spaceToFormValues(space), { autoSlug: false });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    if (!form.beginSubmit()) return;
    startTransition(async () => {
      const result = await updateSpace({ id: space.id, ...formValuesToInput(form.values) });
      if (!result.ok) {
        form.setServerError(result.error);
        return;
      }
      form.reset(spaceToFormValues(result.data));
      setSaved(true);
      if (result.data.slug !== space.slug) router.replace(`/s/${result.data.slug}/settings`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t("space.settingsPage.general")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("space.settingsPage.generalDescription")}
        </p>
      </div>
      {form.formError && (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {form.formError}
        </p>
      )}
      <SpaceFormFields
        idPrefix={idPrefix}
        values={form.values}
        onChange={(field, value) => {
          setSaved(false);
          form.onChange(field, value);
        }}
        errors={form.errors}
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("space.settingsPage.saving") : t("space.settingsPage.save")}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {saved ? t("space.settingsPage.saved") : null}
        </p>
      </div>
    </form>
  );
}
