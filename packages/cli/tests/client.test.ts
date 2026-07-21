import { describe, it, expect } from "vitest";
import { makeApi } from "../src/client";

function fake(capture: any, resp: any) {
  return async (url: string, init: any = {}) => { capture.url = url; capture.init = init; return new Response(JSON.stringify(resp), { status: resp.__status ?? 200 }); };
}

describe("cli api client", () => {
  it("deploy posts the spec with the bearer token", async () => {
    const cap: any = {};
    const api = makeApi({ apiBase: "https://surfvps.com", token: "sk_live_x", fetchImpl: fake(cap, { id: "s1", status: "provisioning", ipv4: null }) as any });
    const r = await api.deploy({ provider: "vultr", region: "sgp1", size: "vc2-2c-4gb", image: "ubuntu-24.04" });
    expect(cap.url).toBe("https://surfvps.com/v1/servers");
    expect(cap.init.method).toBe("POST");
    expect(cap.init.headers.Authorization).toBe("Bearer sk_live_x");
    expect(JSON.parse(cap.init.body)).toMatchObject({ provider: "vultr", region: "sgp1", size: "vc2-2c-4gb", image: "ubuntu-24.04" });
    expect(r.id).toBe("s1");
  });
  it("balance + list hit the right endpoints", async () => {
    const cap: any = {};
    const api = makeApi({ apiBase: "https://surfvps.com", token: "t", fetchImpl: fake(cap, { servers: [] }) as any });
    await api.servers(); expect(cap.url).toBe("https://surfvps.com/v1/servers");
    await api.balance(); expect(cap.url).toBe("https://surfvps.com/v1/balance");
  });
  it("throws the API error message on non-2xx", async () => {
    const api = makeApi({ apiBase: "https://x", token: "t", fetchImpl: (async () => new Response(JSON.stringify({ error: "insufficient_balance" }), { status: 400 })) as any });
    await expect(api.deploy({ provider: "v", region: "r", size: "s", image: "i" })).rejects.toThrow(/insufficient_balance/);
  });
});
