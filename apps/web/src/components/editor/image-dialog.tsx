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
 * Asks for an image URL (slash item "Image"). With `onUpload` it also offers
 * picking image files to upload (T3.6b); typed URLs must be absolute http(s) — never base64.
 */
export function ImageDialog({
  open,
  onOpenChange,
  onInsert,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (src: string) => void;
  /** Set when the page can store files: shows "Upload from your computer". */
  onUpload?: (files: File[]) => void;
}) {
  const t = useTranslations("editor");
  const inputId = useId();
  const errorId = useId();
  const fileId = useId();
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
          {onUpload && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <label htmlFor={fileId} className="text-sm font-medium">
                {t("image.upload")}
              </label>
              <Input
                id={fileId}
                type="file"
                accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) onUpload(files);
                }}
              />
            </div>
          )}
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
