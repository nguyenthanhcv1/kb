import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiBase,
  createClient,
  setImageTag,
  tailLogs,
  triggerDeploy,
  waitForDeployment,
  waitForHealth,
} from "./coolify.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * Fake fetch answering from a list of handlers, recording every call.
 * @param {((url: string, init: RequestInit) => {status?: number, body?: unknown} | Error)[]} replies
 */
function fakeFetch(replies) {
  /** @type {{url: string, init: RequestInit}[]} */
  const calls = [];
  const fn = /** @type {typeof fetch} */ (
    async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const handler = replies[Math.min(calls.length - 1, replies.length - 1)];
      const reply = handler(url, init);
      if (reply instanceof Error) throw reply;
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? "");
      return new Response(text, { status: reply.status ?? 200 });
    }
  );
  return { fn, calls };
}

const quiet = { sleep: async () => {}, log: () => {} };

describe("apiBase", () => {
  it("adds /api/v1 once and strips trailing slashes", () => {
    assert.equal(
      apiBase("https://kb-coolify.thanhgo.com/"),
      "https://kb-coolify.thanhgo.com/api/v1",
    );
    assert.equal(apiBase("https://x.test/api/v1/"), "https://x.test/api/v1");
    assert.throws(() => apiBase("kb-coolify.thanhgo.com"), /must be a URL/);
  });
});

describe("Coolify client", () => {
  it("sends the bearer token, the Access service token and a JSON body", async () => {
    const { fn, calls } = fakeFetch([() => ({ status: 201, body: { uuid: "env" } })]);
    const client = createClient({
      apiUrl: "https://c.test",
      token: "tok",
      accessClientId: "id.access",
      accessClientSecret: "secret",
      fetch: fn,
    });
    await setImageTag(client, "app-uuid", `sha-${SHA}`);
    assert.equal(calls[0].url, "https://c.test/api/v1/applications/app-uuid/envs");
    assert.equal(calls[0].init.method, "PATCH");
    const headers = /** @type {Record<string, string>} */ (calls[0].init.headers);
    assert.equal(headers.authorization, "Bearer tok");
    assert.equal(headers["cf-access-client-id"], "id.access");
    assert.equal(headers["cf-access-client-secret"], "secret");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      key: "KB_IMAGE_TAG",
      value: `sha-${SHA}`,
      is_preview: false,
    });
  });

  it("rejects bad tags before calling the API", async () => {
    const { fn, calls } = fakeFetch([() => ({ body: {} })]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    await assert.rejects(setImageTag(client, "a", "sha-x;rm -rf"), /invalid image tag/);
    assert.equal(calls.length, 0);
  });

  it("reports HTTP errors with status and body", async () => {
    const { fn } = fakeFetch([() => ({ status: 404, body: { message: "Env not found." } })]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    await assert.rejects(setImageTag(client, "a", "main"), /HTTP 404: .*Env not found/);
  });
});

describe("triggerDeploy", () => {
  it("returns the deployment uuid", async () => {
    const { fn, calls } = fakeFetch([
      () => ({
        body: {
          deployments: [{ message: "queued", resource_uuid: "app", deployment_uuid: "dep-1" }],
        },
      }),
    ]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    assert.equal(await triggerDeploy(client, "app"), "dep-1");
    assert.equal(calls[0].url, "https://c.test/api/v1/deploy?uuid=app&force=false");
  });

  it("fails when Coolify starts nothing", async () => {
    const { fn } = fakeFetch([() => ({ body: { message: "No resources found." } })]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    await assert.rejects(triggerDeploy(client, "app"), /did not start a deployment/);
  });
});

describe("waitForDeployment", () => {
  it("polls until finished", async () => {
    const statuses = ["queued", "in_progress", "in_progress", "finished"];
    const { fn, calls } = fakeFetch(statuses.map((status) => () => ({ body: { status } })));
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    const result = await waitForDeployment(client, "dep-1", quiet);
    assert.equal(result.status, "finished");
    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, "https://c.test/api/v1/deployments/dep-1");
  });

  it("fails with the visible log tail", async () => {
    const logs = JSON.stringify([
      { output: "docker login …", hidden: true },
      { output: "kb-migrate exited with code 1", hidden: false },
    ]);
    const { fn } = fakeFetch([() => ({ body: { status: "failed", logs } })]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    await assert.rejects(waitForDeployment(client, "dep-1", quiet), (error) => {
      assert.match(String(error), /dep-1 failed:\nkb-migrate exited with code 1/);
      assert.doesNotMatch(String(error), /docker login/);
      return true;
    });
  });

  it("times out", async () => {
    let t = 0;
    const { fn } = fakeFetch([() => ({ body: { status: "in_progress" } })]);
    const client = createClient({ apiUrl: "https://c.test", token: "t", fetch: fn });
    await assert.rejects(
      waitForDeployment(client, "dep-1", {
        ...quiet,
        timeoutMs: 30_000,
        intervalMs: 10_000,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      }),
      /still "in_progress" after 30s/,
    );
  });
});

describe("tailLogs", () => {
  it("tolerates missing or malformed logs", () => {
    assert.deepEqual(tailLogs(undefined), []);
    assert.deepEqual(tailLogs("not json"), []);
    assert.deepEqual(tailLogs(JSON.stringify([{ output: "a\nb" }, { output: "c" }]), 2), [
      "b",
      "c",
    ]);
  });
});

describe("waitForHealth", () => {
  it("waits through errors and the old version until the new sha answers", async () => {
    const { fn, calls } = fakeFetch([
      () => new Error("connect ECONNREFUSED"),
      () => ({ status: 502, body: "<html>Bad gateway</html>" }),
      () => ({ body: { status: "ok", sha: "f".repeat(40), version: "0.1.0-fffffff" } }),
      () => ({ body: { status: "ok", sha: SHA, version: "0.1.0-0123456" } }),
    ]);
    const body = await waitForHealth({
      url: "https://kb.test/api/health",
      sha: SHA,
      fetch: fn,
      ...quiet,
    });
    assert.equal(body.sha, SHA);
    assert.equal(calls.length, 4);
  });

  it("rejects a short sha and times out on a stale deployment", async () => {
    await assert.rejects(
      waitForHealth({ url: "https://x", sha: "abc", ...quiet }),
      /full commit sha/,
    );
    let t = 0;
    const { fn } = fakeFetch([() => ({ body: { status: "ok", sha: "f".repeat(40) } })]);
    await assert.rejects(
      waitForHealth({
        url: "https://kb.test/api/health",
        sha: SHA,
        fetch: fn,
        ...quiet,
        timeoutMs: 10_000,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      }),
      /did not report .* within 10s \(last: HTTP 200 status=ok sha=fffffff\)/,
    );
  });
});
