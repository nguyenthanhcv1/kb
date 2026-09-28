import {
  ACCESS_BULK_MAX,
  parseAccessEntries,
  type AddAccessEntriesOutput,
  type ParsedAccessEntry,
} from "@/server/admin";

/** Live preview of the bulk "add to allowlist" input (same parser as the server). */
export type AccessInputSummary = {
  tokens: ParsedAccessEntry[];
  /** New valid entries (first occurrence of each kind+value). */
  valid: number;
  emails: number;
  domains: number;
  invalid: number;
  duplicate: number;
  /** Valid public email domains (gmail.com…) — need the explicit confirmation. */
  publicDomains: string[];
  /** More tokens than one call accepts ({@link ACCESS_BULK_MAX}). */
  tooMany: boolean;
};

export function summarizeAccessInput(input: string): AccessInputSummary {
  const tokens = parseAccessEntries(input);
  const valid = tokens.filter((token) => token.status === "valid");
  return {
    tokens,
    valid: valid.length,
    emails: valid.filter((token) => token.kind === "email").length,
    domains: valid.filter((token) => token.kind === "domain").length,
    invalid: tokens.filter((token) => token.status === "invalid").length,
    duplicate: tokens.filter((token) => token.status === "duplicate").length,
    publicDomains: valid
      .filter((token) => token.publicDomain && token.value !== null)
      .map((token) => token.value as string),
    tooMany: tokens.length > ACCESS_BULK_MAX,
  };
}

export type AccessInputProblem = "empty" | "tooMany" | "publicConfirmRequired";

/** Why the form must not be sent as is, or `null` when it can be. */
export function accessInputProblem(
  summary: AccessInputSummary,
  publicConfirmed: boolean,
): AccessInputProblem | null {
  if (summary.tooMany) return "tooMany";
  if (summary.valid === 0) return "empty";
  if (summary.publicDomains.length > 0 && !publicConfirmed) return "publicConfirmRequired";
  return null;
}

/** Tokens of an add result that were not inserted, to list under the success message. */
export function notAddedResults(
  results: AddAccessEntriesOutput["results"],
): AddAccessEntriesOutput["results"] {
  return results.filter((result) => result.status !== "added");
}
