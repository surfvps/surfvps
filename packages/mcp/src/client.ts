// Thin wrapper over the surfvps /v1 REST API. Same surface the CLI uses; the MCP tools call these.
export interface ApiConfig { apiBase: string; token: string; fetchImpl?: typeof fetch; }

export function makeApi(cfg: ApiConfig) {
  const f = cfg.fetchImpl ?? fetch;
  async function call(path: string, init?: RequestInit) {
    const res = await f(`${cfg.apiBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init?.headers as any) },
    });
    const text = await res.text();
    let j: any = {};
    let parsed = true;
    try { j = text ? JSON.parse(text) : {}; } catch { parsed = false; }
    // Surface the API's own error CODE verbatim (e.g. instance_limit, min_deposit, ssh_key_required, bad_coin) so an
    // agent can read it and self-correct rather than guessing from a generic HTTP failure.
    if (!res.ok) throw new Error(parsed && j?.error ? String(j.error) : `request_failed_${res.status}`);
    // A 2xx that isn't JSON is a proxy/error page, not data. Fail loudly — handing it back as a successful result
    // would let an agent act on an empty object as though the call had worked.
    if (!parsed) throw new Error(`bad_response: expected JSON from ${path}, got ${res.status} ${res.headers.get("content-type") ?? "unknown"}`);
    return j;
  }
  return {
    balance: () => call("/v1/balance"),
    ledger: (limit = 25) => call(`/v1/deposits?limit=${limit}`),
    catalog: (provider: string) => call(`/v1/catalog?provider=${encodeURIComponent(provider)}`),
    servers: () => call("/v1/servers"),
    getServer: (id: string) => call(`/v1/servers/${id}`),
    deploy: (spec: Record<string, unknown>) => call("/v1/servers", { method: "POST", body: JSON.stringify(spec) }),
    destroy: (id: string) => call(`/v1/servers/${id}`, { method: "DELETE" }),
    action: (id: string, action: string) => call(`/v1/servers/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }),
    password: (id: string) => call(`/v1/servers/${id}/password`),
    createDeposit: (body: Record<string, unknown>) => call("/v1/deposits", { method: "POST", body: JSON.stringify(body) }),
    depositStatus: (id: string) => call(`/v1/deposits/${id}`),
    sshKeys: () => call("/v1/ssh-keys"),
    addSshKey: (name: string, public_key: string) => call("/v1/ssh-keys", { method: "POST", body: JSON.stringify({ name, public_key }) }),
    removeSshKey: (id: string) => call(`/v1/ssh-keys/${id}`, { method: "DELETE" }),
  };
}
export type Api = ReturnType<typeof makeApi>;
