"use client";

import { BotIcon, KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { ConfirmAction } from "@/components/members/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { McpConnection, McpErrorCode } from "@/server/mcp/connections";
import { createPersonalTokenAction, revokeConnectionAction } from "@/server/mcp/actions";
import { type McpScope, PERSONAL_TOKEN_TTL_DAYS } from "@/server/mcp/constants";

import { CopyField } from "./copy-field";
import { FieldError, SectionCard } from "./form-parts";

/** Command line for clients configured by hand (not translated: it is code). */
export function claudeCodeCommand(mcpUrl: string): string {
  return `claude mcp add --transport http kb ${mcpUrl} --header "Authorization: Bearer <TOKEN>"`;
}

/**
 * Settings › AI assistants (MCP): server address and how to connect Claude / ChatGPT, the
 * user's active connections (revocable) and personal tokens for header-based clients.
 */
export function AiConnectionsSection({
  mcpUrl,
  configured,
  connections,
}: {
  mcpUrl: string;
  configured: boolean;
  connections: McpConnection[];
}) {
  const t = useTranslations("mcp");

  return (
    <SectionCard
      titleId="settings-mcp"
      title={t("section.title")}
      description={t("section.description")}
    >
      <div className="flex flex-col gap-6">
        {!configured && (
          <p
            role="status"
            className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
          >
            {t("section.notConfigured")}
          </p>
        )}
        <CopyField
          label={t("serverUrl.label")}
          value={mcpUrl}
          copyLabel={t("serverUrl.copyLabel")}
        />

        <div className="grid gap-2 text-sm">
          <h3 className="font-medium">{t("guide.title")}</h3>
          <ul className="grid min-w-0 list-disc gap-2 pl-5 text-muted-foreground">
            <li>{t("guide.claude")}</li>
            <li>{t("guide.chatgpt")}</li>
            <li className="min-w-0">
              {t("guide.claudeCode")}
              <pre className="mt-1 rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
                {claudeCodeCommand(mcpUrl)}
              </pre>
            </li>
          </ul>
        </div>

        <ConnectionList connections={connections} />
        {configured && <CreateTokenForm />}
      </div>
    </SectionCard>
  );
}

function ConnectionList({ connections }: { connections: McpConnection[] }) {
  const t = useTranslations("mcp.connections");
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{t("title")}</h3>
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionRow({ connection }: { connection: McpConnection }) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const Icon = connection.kind === "assistant" ? BotIcon : KeyRoundIcon;

  const revoke = () =>
    startTransition(async () => {
      const result = await revokeConnectionAction(connection.id);
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-start gap-3 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{connection.name}</span>
          <Badge variant="secondary">{t(`mcp.connections.kinds.${connection.kind}`)}</Badge>
          <Badge variant="outline">{t(`mcp.scopes.${connection.scope}`)}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {[
            t("mcp.connections.created", { date: date(connection.createdAt) }),
            connection.lastUsedAt
              ? t("mcp.connections.lastUsed", { date: date(connection.lastUsedAt) })
              : t("mcp.connections.neverUsed"),
            ...(connection.expiresAt
              ? [t("mcp.connections.expires", { date: date(connection.expiresAt) })]
              : []),
          ].join(" · ")}
        </p>
      </div>
      <ConfirmAction
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("mcp.connections.revokeLabel", { name: connection.name })}
          >
            <Trash2Icon aria-hidden />
            <span className="hidden sm:inline">{t("mcp.connections.revoke")}</span>
          </Button>
        }
        title={t("mcp.connections.revokeTitle")}
        description={t("mcp.connections.revokeDescription", { name: connection.name })}
        confirmLabel={t("mcp.connections.revokeConfirm")}
        pendingLabel={t("mcp.connections.revokeConfirm")}
        pending={pending}
        error={error}
        onConfirm={revoke}
      />
    </li>
  );
}

function CreateTokenForm() {
  const t = useTranslations();
  const router = useRouter();
  const ids = { name: useId(), nameError: useId(), expiry: useId(), scope: useId() };
  const [name, setName] = useState("");
  const [scope, setScope] = useState<McpScope>("write");
  const [days, setDays] = useState<(typeof PERSONAL_TOKEN_TTL_DAYS)[number]>(90);
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<McpErrorCode | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (token) {
    return (
      <div className="grid gap-3 rounded-md border bg-muted/40 p-3">
        <h3 className="text-sm font-medium">{t("mcp.token.createdTitle")}</h3>
        <p role="alert" className="text-sm text-muted-foreground">
          {t("mcp.token.createdWarning")}
        </p>
        <CopyField
          label={t("mcp.token.value")}
          value={token}
          copyLabel={t("mcp.token.copyLabel")}
          monospace
        />
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() => setToken(null)}
        >
          {t("mcp.token.done")}
        </Button>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(t("mcp.token.nameRequired"));
      return;
    }
    setNameError(undefined);
    startTransition(async () => {
      const result = await createPersonalTokenAction({ name, scope, expiresInDays: days });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setName("");
      setToken(result.data.token);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <h3 className="text-sm font-medium">{t("mcp.token.title")}</h3>
      <div className="grid gap-2">
        <Label htmlFor={ids.name}>{t("mcp.token.name")}</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={100}
          placeholder={t("mcp.token.namePlaceholder")}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? ids.nameError : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("mcp.token.nameHint")}</p>
        <FieldError id={ids.nameError} message={nameError} />
      </div>
      <ScopeChoice id={ids.scope} value={scope} onChange={setScope} />
      <div className="grid gap-2">
        <Label htmlFor={ids.expiry}>{t("mcp.token.expiry")}</Label>
        <NativeSelect
          id={ids.expiry}
          value={String(days)}
          onChange={(event) => setDays(Number(event.target.value) as typeof days)}
        >
          {PERSONAL_TOKEN_TTL_DAYS.map((value) => (
            <option key={value} value={value}>
              {t("mcp.token.expiryDays", { days: value })}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button type="submit" className="justify-self-start" disabled={pending}>
        {pending ? t("mcp.token.creating") : t("mcp.token.create")}
      </Button>
    </form>
  );
}

/** Read only / read and edit radio group (personal token form and consent screen). */
export function ScopeChoice({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: McpScope;
  onChange: (scope: McpScope) => void;
  label?: string;
}) {
  const t = useTranslations("mcp");
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label ?? t("consent.scopeLabel")}</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next === "read" ? "read" : "write")}
      >
        {(["read", "write"] as const).map((scope) => (
          <div key={scope} className="flex items-start gap-2">
            <RadioGroupItem id={`${id}-${scope}`} value={scope} className="mt-0.5" />
            <Label
              htmlFor={`${id}-${scope}`}
              className="flex flex-col items-start gap-0.5 font-normal"
            >
              <span className="font-medium">{t(`scopes.${scope}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`scopes.${scope}Hint`)}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
