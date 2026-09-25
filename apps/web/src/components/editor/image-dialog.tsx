"use client";

import { normalizeImageSrc } from "@kb/editor/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Asks for an image URL (slash item "Image"). Uploads (drag & drop, paste) arrive with T3.6b;
 * only absolute http(s) URLs are accepted — never base64.
 */
export function ImageDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (src: string) => void;
}) {
  const t = useTranslations("editor");
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const src = normalizeImageSrc(value);
    if (!src) {
      setInvalid(true);
      return;
    }
    onInsert(src);
    setValue("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("");
          setInvalid(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t("close")}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("image.title")}</DialogTitle>
            <DialogDescription>{t("image.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {t("image.label")}
            </label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              autoFocus
              value={value}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setInvalid(false);
              }}
            />
            {invalid && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {t("image.invalid")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("image.cancel")}
            </Button>
            <Button type="submit">{t("image.insert")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
