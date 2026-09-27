#!/usr/bin/env node
// Deploy to Coolify from GitHub Actions (T0.8, .github/workflows/deploy.yml, docs/PLAN.md §7.5).
//
//   node scripts/deploy/coolify.mjs deploy --tag sha-<40 hex>
//     env COOLIFY_API_URL (https://kb-coolify.thanhgo.com or …/api/v1), COOLIFY_API_TOKEN,
//         COOLIFY_APP_UUID, optional CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
//     1. sets the resource's KB_IMAGE_TAG variable (infra/coolify/staging/docker-compose.yml)
//     2. starts a deployment, 3. waits until Coolify reports it finished (fails on failed/cancelled)
//
//   node scripts/deploy/coolify.mjs wait-health --url https://kb-staging.thanhgo.com/api/health --sha <40 hex>
//     polls a health endpoint until it answers {"status":"ok","sha":<sha>} (the new image is live)
//
// Coolify API v4 (checked against Coolify 4.0.0-beta.4xx; field names change between betas —
// docs/runbooks/staging.md says how to verify them): PATCH /applications/{uuid}/envs,
// GET /deploy?uuid=…, GET /deployments/{deployment_uuid}.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Variable of the Coolify resource holding the image tag. */
export const IMAGE_TAG_VARIABLE = "KB_IMAGE_TAG";

const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} url */
export function apiBase(url) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new Error(`COOLIFY_API_URL must be a URL, got "${url}"`);
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

/**
 * @typedef {object} ClientOptions
 * @property {string} apiUrl
 * @property {string} token
 * @property {string} [accessClientId] Cloudflare Access service token (when the Coolify
 *   dashboard sits behind Cloudflare Access)
 * @property {string} [accessClientSecret]
 * @property {typeof fetch} [fetch]
 */

/** @param {ClientOptions} options */
export function createClient({ apiUrl, token, accessClientId, accessClientSecret, fetch: f }) {
  const base = apiBase(apiUrl);
  const doFetch = f ?? globalThis.fetch;
  if (!token) throw new Error("COOLIFY_API_TOKEN is empty");
  /** @type {Record<string, string>} */
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  if (accessClientId && accessClientSecret) {
    headers["cf-access-client-id"] = accessClientId;
    headers["cf-access-client-secret"] = accessClientSecret;
  }

  /**
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async function request(method, path, body) {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      // 3xx here usually means Cloudflare Access redirecting to its login page.
      throw new Error(`Coolify ${method} ${path} → HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Coolify ${method} ${path} → not JSON: ${text.slice(0, 300)}`);
    }
  }

  return { request };
}

/** @typedef {ReturnType<typeof createClient>} CoolifyClient */

/** @param {string} tag */
export function assertTag(tag) {
  if (!TAG_PATTERN.test(tag)) throw new Error(`invalid image tag "${tag}"`);
}

/**
 * Sets KB_IMAGE_TAG. The variable must already exist on the resource (Coolify creates it from
 * `${KB_IMAGE_TAG:?}` in the compose file); a 404 means it does not.
 * @param {CoolifyClient} client @param {string} appUuid @param {string} tag
 */
export async function setImageTag(client, appUuid, tag) {
  assertTag(tag);
  await client.request("PATCH", `/applications/${encodeURIComponent(appUuid)}/envs`, {
    key: IMAGE_TAG_VARIABLE,
    value: tag,
    is_preview: false,
  });
}

/**
 * @param {CoolifyClient} client @param {string} appUuid
 * @returns {Promise<string>} deployment uuid
 */
export async function triggerDeploy(client, appUuid) {
  const result = await client.request(
    "GET",
    `/deploy?uuid=${encodeURIComponent(appUuid)}&force=false`,
  );
  // {"deployments":[{"message","resource_uuid","deployment_uuid"}]}
  const deployment = result?.deployments?.[0];
  if (!deployment?.deployment_uuid) {
    throw new Error(`Coolify did not start a deployment: ${JSON.stringify(result).slice(0, 300)}`);
  }
  return deployment.deployment_uuid;
}

/**
 * Last visible lines of a Coolify deployment log (`logs` is a JSON string of
 * `{output, hidden, type}` entries; hidden entries are commands Coolify keeps private).
 * @param {unknown} logs @param {number} [max]
 */
export function tailLogs(logs, max = 40) {
  let entries = [];
  try {
    entries = typeof logs === "string" ? JSON.parse(logs) : Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && !entry.hidden && typeof entry.output === "string")
    .flatMap((entry) => entry.output.split("\n"))
    .filter((line) => line.trim() !== "")
    .slice(-max);
}

const DONE = new Set(["finished"]);
const FAILED = new Set(["failed", "cancelled-by-user", "cancelled"]);

/**
 * @typedef {object} WaitOptions
 * @property {number} [timeoutMs]
 * @property {number} [intervalMs]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [now]
 * @property {(line: string) => void} [log]
 */

/**
 * @param {CoolifyClient} client @param {string} deploymentUuid @param {WaitOptions} [options]
 */
export async function waitForDeployment(client, deploymentUuid, options = {}) {
  const {
    timeoutMs = 20 * 60_000,
    intervalMs = 10_000,
    sleep = defaultSleep,
    now = Date.now,
    log = console.log,
  } = options;
  const deadline = now() + timeoutMs;
  let last = "";
  for (;;) {
    const deployment = await client.request(
      "GET",
      `/deployments/${encodeURIComponent(deploymentUuid)}`,
    );
    const status = String(deployment?.status ?? "unknown");
    if (status !== last) log(`deployment ${deploymentUuid}: ${status}`);
    last = status;
    if (DONE.has(status)) return deployment;
    if (FAILED.has(status)) {
      const tail = tailLogs(deployment?.logs);
      throw new Error(
        `deployment ${deploymentUuid} ${status}${tail.length ? `:\n${tail.join("\n")}` : ""}`,
      );
    }
    if (now() >= deadline) {
      throw new Error(`deployment ${deploymentUuid} still "${status}" after ${timeoutMs / 1000}s`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Polls a health endpoint (kb-web /api/health, kb-collab /health) until it reports the
 * expected commit — i.e. the new containers answer through Cloudflare and Traefik.
 * @param {{url: string, sha: string, fetch?: typeof fetch} & WaitOptions} options
 */
export async function waitForHealth({
  url,
  sha,
  fetch: f,
  timeoutMs = 5 * 60_000,
  intervalMs = 5_000,
  sleep = defaultSleep,
  now = Date.now,
  log = console.log,
}) {
  if (!SHA_PATTERN.test(sha)) throw new Error(`--sha must be a full commit sha, got "${sha}"`);
  const doFetch = f ?? globalThis.fetch;
  const deadline = now() + timeoutMs;
  let last = "";
  for (;;) {
    let seen;
    try {
      const response = await doFetch(url, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // HTML error page (Cloudflare 52x, Traefik 404) while containers restart.
      }
      if (response.ok && body?.status === "ok" && body?.sha === sha) {
        log(`${url}: ok ${body.version ?? ""} ${sha.slice(0, 7)}`);
        return body;
      }
      seen = `HTTP ${response.status} status=${body?.status ?? "-"} sha=${String(body?.sha ?? "-").slice(0, 7)}`;
    } catch (error) {
      seen = `error ${error instanceof Error ? error.message : String(error)}`;
    }
    if (seen !== last) log(`${url}: ${seen} (waiting for ${sha.slice(0, 7)})`);
    last = seen;
    if (now() >= deadline)
      throw new Error(`${url} did not report ${sha} within ${timeoutMs / 1000}s (last: ${seen})`);
    await sleep(intervalMs);
  }
}

/** @param {string} name */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

/** @param {string[]} argv */
export async function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      tag: { type: "string" },
      url: { type: "string" },
      sha: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const timeoutMs = values.timeout ? Number(values.timeout) * 1000 : undefined;
  if (timeoutMs !== undefined && !(timeoutMs > 0)) throw new Error("--timeout must be seconds > 0");

  if (command === "deploy") {
    if (!values.tag) throw new Error("deploy needs --tag");
    const appUuid = requireEnv("COOLIFY_APP_UUID");
    const client = createClient({
      apiUrl: requireEnv("COOLIFY_API_URL"),
      token: requireEnv("COOLIFY_API_TOKEN"),
      accessClientId: process.env.CF_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    });
    await setImageTag(client, appUuid, values.tag);
    console.log(`${IMAGE_TAG_VARIABLE}=${values.tag}`);
    const deploymentUuid = await triggerDeploy(client, appUuid);
    await waitForDeployment(client, deploymentUuid, { timeoutMs });
    return;
  }
  if (command === "wait-health") {
    if (!values.url || !values.sha) throw new Error("wait-health needs --url and --sha");
    await waitForHealth({ url: values.url, sha: values.sha, timeoutMs });
    return;
  }
  throw new Error("usage: coolify.mjs deploy --tag <tag> | wait-health --url <url> --sha <sha>");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
