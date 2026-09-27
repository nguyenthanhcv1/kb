"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createSpace } from "@/server/space/actions";

import { EMPTY_SPACE_FORM, formValuesToInput } from "./space-form";
import { SpaceFormFields } from "./space-form-fields";
import { useSpaceForm } from "./use-space-form";

type CreateSpaceDialogProps = {
  /** Styling of the trigger button (the sidebar uses a small ghost button). */
  triggerVariant?: ComponentProps<typeof Button>["variant"];
  triggerSize?: ComponentProps<typeof Button>["size"];
  triggerClassName?: string;
};

/**
 * "Create space" button + dialog. Render it only for internal users (`canCreateSpace`); RLS
 * rejects guests anyway (`FORBIDDEN`). The slug follows the name until edited; on success the
 * user lands on the new Space and the server components (sidebar list) re-render.
 */
export function CreateSpaceDialog({
  triggerVariant = "default",
  triggerSize = "default",
  triggerClassName,
}: CreateSpaceDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useSpaceForm(EMPTY_SPACE_FORM, { autoSlug: true });

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) form.reset();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.beginSubmit()) return;
    startTransition(async () => {
      const result = await createSpace(formValuesToInput(form.values));
      if (!result.ok) {
        form.setServerError(result.error);
        return;
      }
      setOpen(false);
      form.reset();
      router.push(`/s/${result.data.slug}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={triggerClassName}>
          <PlusIcon aria-hidden />
          {t("space.create")}
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("common.actions.cancel")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("space.create")}</DialogTitle>
            <DialogDescription>{t("space.createDialog.description")}</DialogDescription>
          </DialogHeader>
          {form.formError && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {form.formError}
            </p>
          )}
          <SpaceFormFields
            idPrefix={idPrefix}
            values={form.values}
            onChange={form.onChange}
            errors={form.errors}
            disabled={pending}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("space.createDialog.submitting") : t("space.createDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
