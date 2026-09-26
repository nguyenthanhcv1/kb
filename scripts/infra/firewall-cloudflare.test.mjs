// Tests for infra/scripts/{cloudflare-ips,firewall-cloudflare}.sh in --dry-run / --input mode
// (no root, no network, nothing applied).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const FIREWALL = join(root, "infra/scripts/firewall-cloudflare.sh");
const CF_IPS = join(root, "infra/scripts/cloudflare-ips.sh");

const dir = mkdtempSync(join(tmpdir(), "kb-firewall-"));
/** @param {string} name @param {string} content */
const file = (name, content) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

const GOOD = file(
  "cf.txt",
  [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "",
    "# comment",
    "2400:cb00::/32",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "2606:4700::/32",
    "2803:f800::/32",
  ].join("\n"),
);

/** @param {string} script @param {string[]} args */
const run = (script, args) => {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

describe("cloudflare-ips.sh", () => {
  it("prints IPv4 then IPv6, one per line or comma-separated", () => {
    const lines = run(CF_IPS, ["--input", GOOD]);
    assert.equal(lines.code, 0, lines.err);
    const list = lines.out.trim().split("\n");
    assert.equal(list.length, 8);
    assert.equal(list[0], "173.245.48.0/20");
    assert.equal(list[5], "2400:cb00::/32");

    const csv = run(CF_IPS, ["--input", GOOD, "--format", "csv"]);
    assert.equal(csv.out.trim(), list.join(","));
  });

  it("rejects garbage and truncated lists", () => {
    const html = run(CF_IPS, ["--input", file("html.txt", "<html>error</html>\n")]);
    assert.notEqual(html.code, 0);
    assert.match(html.err, /invalid range/);

    const badOctet = run(CF_IPS, ["--input", file("octet.txt", "300.1.1.1/20\n")]);
    assert.match(badOctet.err, /invalid range '300\.1\.1\.1\/20'/);

    const short = run(CF_IPS, ["--input", file("short.txt", "173.245.48.0/20\n2400:cb00::/32\n")]);
    assert.notEqual(short.code, 0);
    assert.match(short.err, /expected ≥ 5 IPv4/);
  });
});

describe("firewall-cloudflare.sh --dry-run", () => {
  const base = ["--dry-run", "--cf-ips-file", GOOD, "--iface", "eth0"];

  it("allows 80/443 only from Cloudflare and SSH/Coolify only from admins", () => {
    const { code, out, err } = run(FIREWALL, [...base, "--admin", "203.0.113.4/32"]);
    assert.equal(code, 0, err);
    assert.match(out, /\+ ipset add -exist kb-cf4-new 173\.245\.48\.0\/20/);
    assert.match(out, /\+ ipset add -exist kb-cf6-new 2400:cb00::\/32/);
    assert.match(out, /\+ ipset add -exist kb-admin4-new 203\.0\.113\.4\/32/);
    assert.match(out, /\+ ipset swap kb-cf4-new kb-cf4/);
    for (const port of ["80", "443"]) {
      assert.match(
        out,
        new RegExp(
          `iptables -w -A KB-DOCKER -p tcp -m conntrack --ctorigdstport ${port} --ctdir ORIGINAL -m set --match-set kb-cf4 src -j RETURN`,
        ),
      );
    }
    assert.match(
      out,
      /--ctorigdstport 8000 --ctdir ORIGINAL -m set --match-set kb-admin4 src -j RETURN/,
    );
    assert.match(out, /ip6tables -w -A KB-DOCKER .* --match-set kb-cf6 src -j RETURN/);
    assert.match(out, /iptables -w -A KB-DOCKER ! -i eth0 -j RETURN/);
    // Everything else new from the Internet is dropped, after the allow rules.
    const drop = out.indexOf("iptables -w -A KB-DOCKER -m conntrack --ctstate NEW,INVALID -j DROP");
    assert.ok(drop > out.indexOf("--ctorigdstport 6002"));
    assert.match(out, /iptables -w -I DOCKER-USER 1 -j KB-DOCKER/);
    assert.match(
      out,
      /ufw allow proto tcp from 203\.0\.113\.4\/32 to any port 22 comment kb-admin-ssh/,
    );
    assert.match(
      out,
      /ufw allow proto tcp from 2606:4700::\/32 to any port 80,443 comment kb-cloudflare/,
    );
    assert.match(out, /ufw --force enable/);
    assert.doesNotMatch(out, /systemctl/);
  });

  it("honours --ssh-port and --coolify-ports none", () => {
    const { code, out } = run(FIREWALL, [
      ...base,
      "--admin",
      "2001:db8::1",
      "--ssh-port",
      "2222",
      "--coolify-ports",
      "none",
    ]);
    assert.equal(code, 0);
    assert.match(out, /ufw allow proto tcp from 2001:db8::1 to any port 2222/);
    assert.doesNotMatch(out, /ctorigdstport 8000/);
  });

  it("refuses to lock SSH down without an admin CIDR, and invalid input", () => {
    const none = run(FIREWALL, base);
    assert.notEqual(none.code, 0);
    assert.match(none.err, /at least one --admin/);

    for (const bad of ["203.0.113.256", "0.0.0.0/0", "10.0.0.0/33", "example.com"]) {
      const result = run(FIREWALL, [...base, "--admin", bad]);
      assert.notEqual(result.code, 0, bad);
      assert.match(result.err, /--admin/);
    }
    const port = run(FIREWALL, [...base, "--admin", "203.0.113.4", "--coolify-ports", "443"]);
    assert.match(port.err, /must not contain 80\/443/);
  });

  it("fails closed when Cloudflare's list is invalid", () => {
    const { code, err, out } = run(FIREWALL, [
      "--dry-run",
      "--iface",
      "eth0",
      "--admin",
      "203.0.113.4",
      "--cf-ips-file",
      file("bad.txt", "<html>\n"),
    ]);
    assert.notEqual(code, 0);
    assert.match(err, /nothing changed/);
    assert.equal(out, "");
  });

  it("--install saves the options for the systemd service", () => {
    const { code, out } = run(FIREWALL, [...base, "--admin", "203.0.113.4", "--install"]);
    assert.equal(code, 0);
    assert.match(out, /KB_FIREWALL_ARGS="--cf-ips-file .* --iface eth0 --admin 203\.0\.113\.4"/);
    assert.match(out, /systemctl enable kb-firewall\.service kb-firewall\.timer/);
  });
});
