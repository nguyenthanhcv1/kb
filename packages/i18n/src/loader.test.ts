import { describe, expect, it } from "vitest";

import { type Locale } from "./config";
import { createMessageLoader } from "./loader";

const files: Record<string, unknown> = {
  "vi/common": { default: { save: "Lưu" } },
  "en/common": { default: { save: "Save" } },
  "vi/auth": { default: { signIn: "Đăng nhập" } },
};

const loader = createMessageLoader(async (locale: Locale, ns) => {
  const mod = files[`${locale}/${ns}`];
  if (!mod)
    throw Object.assign(new Error(`Cannot find module '${ns}.json'`), { code: "MODULE_NOT_FOUND" });
  return mod;
});

describe("createMessageLoader", () => {
  it("merges namespaces keyed by name and skips missing files", async () => {
    expect(await loader("vi")).toEqual({ auth: { signIn: "Đăng nhập" }, common: { save: "Lưu" } });
    expect(await loader("en")).toEqual({ common: { save: "Save" } });
  });

  it("loads only the requested namespaces", async () => {
    expect(await loader("vi", ["common"])).toEqual({ common: { save: "Lưu" } });
  });

  it("rejects unsupported locales and rethrows unexpected errors", async () => {
    await expect(loader("fr" as Locale)).rejects.toThrow(/Unsupported locale/);
    const broken = createMessageLoader(async () => {
      throw new SyntaxError("Unexpected token } in JSON");
    });
    await expect(broken("vi", ["common"])).rejects.toThrow(SyntaxError);
  });
});
