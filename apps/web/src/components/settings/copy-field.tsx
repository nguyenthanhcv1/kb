"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Read-only value with a copy button (MCP server address, a new token). */
export function CopyField({
  label,
  value,
  copyLabel,
  monospace = false,
}: {
  label: string;
  value: string;
  copyLabel: string;
  monospace?: boolean;
}) {
  const t = useTranslations("mcp.serverUrl");
  const id = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className={monospace ? "font-mono text-xs" : undefined}
        />
        <Button
          type="button"
          variant="outline"
          aria-label={copyLabel}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          <span className="hidden sm:inline">{copied ? t("copied") : t("copy")}</span>
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? t("copied") : ""}
      </p>
    </div>
  );
}
