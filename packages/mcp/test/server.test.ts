import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { makeApi } from "../src/client.js";

/** A fake surfvps API: routes are `${method} ${path}` → [status, body]. Records every request made. */
function fakeApi(routes: Record<string, [number, unknown]>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.test", "");
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes[`${method} ${path}`];
    if (!hit) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  }) as unknown as typeof fetch;
  return { api: makeApi({ apiBase: "https://api.test", token: "sk_live_test", fetchImpl }), calls };
}

async function connect(routes: Record<string, [number, unknown]>) {
  const { api, calls } = fakeApi(routes);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([client.connect(clientT), buildServer(api).connect(serverT)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text = r.content[0].text as string;
    // Tool bodies return JSON; SDK-level schema rejections return a plain-text validation message.
    let data: any;
    try { data = JSON.parse(text); } catch { data = { text }; }
    return { isError: !!r.isError, data, text };
  };
  return { client, call, calls };
}

// Mirrors the real /v1 DTO (apps/web/app/v1/servers/route.ts dto()): ipv4, and a status from the DB enum.
const SRV = { id: "srv-1", hostname: "web-1", provider: "digitalocean", region: "nyc1", status: "running", ipv4: "1.2.3.4", hourly_usd: "$0.0181", monthly_cap_usd: "$11.00" };

describe("tool surface", () => {
  it("exposes every documented tool", async () => {
    const { client } = await connect({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_ssh_key", "create_deposit", "deploy_server", "deposit_status", "destroy_server",
      "estimate_cost", "get_balance", "get_root_password", "get_server", "list_catalog",
      "list_ledger", "list_servers", "list_ssh_keys", "remove_ssh_key", "server_action",
    ]);
  });

  it("marks only destroy_server as destructive, and reads as read-only where it is", async () => {
    const { client } = await connect({});
    const tools = (await client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));
    // destroy_server is irreversible; server_action interrupts a live machine — both should make hosts prompt.
    expect(byName.destroy_server.destructiveHint).toBe(true);
    expect(byName.server_action.destructiveHint).toBe(true);
    for (const n of ["deploy_server", "create_deposit", "add_ssh_key"]) {
      expect(byName[n].destructiveHint, n).toBeFalsy();
      expect(byName[n].readOnlyHint, n).toBe(false);
    }
    for (const n of ["get_balance", "list_servers", "list_catalog", "get_root_password"]) {
      expect(byName[n].readOnlyHint, n).toBe(true);
    }
  });
});

describe("destroy_server guard", () => {
  it("refuses when the hostname does not match — as an ERROR result, and never calls DELETE", async () => {
    const { call, calls } = await connect({ "GET /v1/servers/srv-1": [200, SRV] });
    const r = await call("destroy_server", { id: "srv-1", confirm_hostname: "web-2" });
    // isError matters as much as the message: an agent that only checks isError must not read this as "destroyed".
    expect(r.isError).toBe(true);
    expect(r.data.error).toMatch(/hostname_mismatch/);
    expect(r.data.error).toContain("web-1");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("propagates a lookup failure as an error instead of masking it as not-found", async () => {
    const { call, calls } = await connect({});
    const r = await call("destroy_server", { id: "ghost", confirm_hostname: "ghost" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toBe("not_found");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("refuses when two servers share the hostname, until the IPv4 disambiguates", async () => {
    const twins = {
      "GET /v1/servers/srv-1": [200, SRV],
      "GET /v1/servers": [200, { servers: [SRV, { ...SRV, id: "srv-2", ipv4: "5.6.7.8" }] }],
      "DELETE /v1/servers/srv-1": [200, { id: "srv-1", status: "destroyed" }],
    } as Record<string, [number, unknown]>;

    const a = await connect(twins);
    const amb = await a.call("destroy_server", { id: "srv-1", confirm_hostname: "web-1" });
    expect(amb.isError).toBe(true);
    expect(amb.data.error).toMatch(/ambiguous_hostname/);
    expect(a.calls.some((c) => c.method === "DELETE")).toBe(false);

    const b = await connect(twins);
    const wrong = await b.call("destroy_server", { id: "srv-1", confirm_hostname: "web-1", confirm_ipv4: "5.6.7.8" });
    expect(wrong.isError).toBe(true);
    expect(wrong.data.error).toMatch(/ipv4_mismatch/);
    expect(b.calls.some((c) => c.method === "DELETE")).toBe(false);

    const c = await connect(twins);
    const right = await c.call("destroy_server", { id: "srv-1", confirm_hostname: "web-1", confirm_ipv4: "1.2.3.4" });
    expect(right.isError).toBe(false);
    expect(c.calls.filter((x) => x.method === "DELETE")).toHaveLength(1);
  });

  it("destroys when the hostname matches exactly", async () => {
    const { call, calls } = await connect({
      "GET /v1/servers/srv-1": [200, SRV],
      "DELETE /v1/servers/srv-1": [200, { ok: true, charged_usd: "$0.02" }],
    });
    const r = await call("destroy_server", { id: "srv-1", confirm_hostname: "web-1" });
    expect(r.isError).toBe(false);
    expect(r.data.ok).toBe(true);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });
});

describe("error semantics", () => {
  it("surfaces the API error code verbatim so an agent can self-correct", async () => {
    const { call } = await connect({ "POST /v1/servers": [402, { error: "insufficient_balance" }] });
    const r = await call("deploy_server", { provider: "digitalocean", region: "nyc1", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toBe("insufficient_balance");
  });

  it("returns an error result rather than throwing the transport", async () => {
    const { call } = await connect({ "POST /v1/servers": [403, { error: "instance_limit" }] });
    const r = await call("deploy_server", { provider: "vultr", region: "ewr", size: "vc2-1c-1gb", image: "ubuntu" });
    expect(r.data.error).toBe("instance_limit");
  });
});

describe("deposits", () => {
  it("passes a pre-selected coin through so the agent gets an address + amount", async () => {
    const { call, calls } = await connect({
      "POST /v1/deposits": [200, { id: "ch_1", pay_address: "8Bx…", pay_amount: "0.31", coin: "XMR" }],
    });
    const r = await call("create_deposit", { usd: 50, coin: "XMR" });
    expect(r.data.pay_address).toBe("8Bx…");
    expect(calls.at(-1)!.body).toEqual({ usd: 50, coin: "XMR" });
  });

  it("omits coin entirely when unspecified (hosted checkout)", async () => {
    const { call, calls } = await connect({ "POST /v1/deposits": [200, { id: "ch_2", url: "https://pay/…" }] });
    await call("create_deposit", { usd: 25 });
    expect(calls.at(-1)!.body).toEqual({ usd: 25 });
  });

  it("rejects a below-minimum deposit at the schema, before any HTTP call", async () => {
    const { call, calls } = await connect({ "POST /v1/deposits": [200, { id: "nope" }] });
    const r = await call("create_deposit", { usd: 5 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(">=20");   // agent-readable: it can retry with a valid amount
    expect(calls).toHaveLength(0);
  });
});

describe("deploy", () => {
  it("forwards the full spec including ssh keys", async () => {
    const { call, calls } = await connect({ "POST /v1/servers": [200, { id: "srv-9", hostname: "box" }] });
    await call("deploy_server", {
      provider: "digitalocean", region: "nyc1", size: "s-1vcpu-1gb",
      image: "ubuntu-24-04-x64", hostname: "box", ssh_key_ids: ["k1"],
    });
    expect(calls.at(-1)!.body).toEqual({
      provider: "digitalocean", region: "nyc1", size: "s-1vcpu-1gb",
      image: "ubuntu-24-04-x64", hostname: "box", ssh_key_ids: ["k1"],
    });
  });

  it("rejects an unknown provider at the schema", async () => {
    const { call, calls } = await connect({});
    const r = await call("deploy_server", { provider: "aws", region: "x", size: "y", image: "z" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("digitalocean");  // tells the agent the valid options
    expect(calls).toHaveLength(0);
  });
});

describe("estimate_cost", () => {
  // $11/mo plan: hourly = ceil(11e6 / 730) = 15069 micro
  const CATALOG: [number, unknown] = [200, { provider: "digitalocean", sizes: [
    { ref: "s-1vcpu-1gb", label: "1 vCPU / 1 GB", monthly_usd: "$11.00", monthly_micro: "11000000", hourly_usd: "$0.0151", hourly_micro: "15069" },
  ] }];

  it("quotes whole hours with a one-hour minimum, floored at $0.02", async () => {
    const { call } = await connect({ "GET /v1/catalog?provider=digitalocean": CATALOG });
    const r = await call("estimate_cost", { provider: "digitalocean", size: "s-1vcpu-1gb", hours: 0.5 });
    expect(r.data.hours_billed).toBe(1);                 // 30 minutes still bills an hour...
    expect(r.data.estimated_total_usd).toBe("$0.02");    // ...and one hour ($0.0151) is topped up to the $0.02 floor
    expect(r.data.hourly_usd).toBe("$0.0151");           // the rate itself is still shown honestly
  });

  it("quotes a multi-hour run at the true hourly rate once it clears the floor", async () => {
    const { call } = await connect({ "GET /v1/catalog?provider=digitalocean": CATALOG });
    const r = await call("estimate_cost", { provider: "digitalocean", size: "s-1vcpu-1gb", hours: 24 });
    expect(r.data.estimated_total_usd).toBe("$0.3617");  // 24 x 15069 micro
    expect(r.data.capped_at_monthly).toBe(false);
  });

  it("never quotes below the $0.02 per-server minimum", async () => {
    const { call } = await connect({ "GET /v1/catalog?provider=digitalocean": [200, { sizes: [
      { ref: "tiny", label: "tiny", monthly_usd: "$1.00", monthly_micro: "1000000", hourly_usd: "$0.0014", hourly_micro: "1370" },
    ] }] });
    const r = await call("estimate_cost", { provider: "digitalocean", size: "tiny", hours: 1 });
    expect(r.data.estimated_total_usd).toBe("$0.02");
  });

  it("caps a full month at the monthly price rather than hourly x 730", async () => {
    const { call } = await connect({ "GET /v1/catalog?provider=digitalocean": CATALOG });
    const r = await call("estimate_cost", { provider: "digitalocean", size: "s-1vcpu-1gb", hours: 730 });
    expect(r.data.estimated_total_usd).toBe("$11.00");    // 730 x 15069 = $11.0004 -> capped
    expect(r.data.capped_at_monthly).toBe(true);
  });

  it("tells the agent which refs are valid when the size is wrong", async () => {
    const { call } = await connect({ "GET /v1/catalog?provider=digitalocean": CATALOG });
    const r = await call("estimate_cost", { provider: "digitalocean", size: "nope" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toMatch(/unknown_size/);
    expect(r.data.error).toMatch(/list_catalog/);
  });
});

describe("remove_ssh_key", () => {
  it("DELETEs the key by id", async () => {
    const { call, calls } = await connect({ "DELETE /v1/ssh-keys/k1": [200, { id: "k1", deleted: true }] });
    const r = await call("remove_ssh_key", { id: "k1" });
    expect(r.isError).toBe(false);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/ssh-keys/k1" });
  });
});
