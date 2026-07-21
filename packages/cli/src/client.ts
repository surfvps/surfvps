export interface ApiConfig { apiBase: string; token: string; fetchImpl?: typeof fetch; }
export interface DeploySpec { provider: string; region: string; size: string; image: string; hostname?: string; ssh_key_ids?: string[]; }

export function makeApi(cfg: ApiConfig) {
  const f = cfg.fetchImpl ?? fetch;
  async function call(path: string, init?: RequestInit) {
    const res = await f(`${cfg.apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init?.headers as any) } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as any).error ? `${(j as any).error}` : `request failed: ${res.status}`);
    return j as any;
  }
  return {
    balance: () => call("/v1/balance"),
    catalog: (provider: string) => call(`/v1/catalog?provider=${encodeURIComponent(provider)}`),
    servers: () => call("/v1/servers"),
    deploy: (spec: DeploySpec) => call("/v1/servers", { method: "POST", body: JSON.stringify(spec) }),
    get: (id: string) => call(`/v1/servers/${id}`),
    destroy: (id: string) => call(`/v1/servers/${id}`, { method: "DELETE" }),
    action: (id: string, action: string) => call(`/v1/servers/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }),
    password: (id: string) => call(`/v1/servers/${id}/password`),
    deposit: (usd: number, coin?: string) => call("/v1/deposits", { method: "POST", body: JSON.stringify(coin ? { usd, coin } : { usd }) }),
    depositStatus: (id: string) => call(`/v1/deposits/${id}`),
    ledger: (limit = 25) => call(`/v1/deposits?limit=${limit}`),
    keys: () => call("/v1/ssh-keys"),
    addKey: (name: string, public_key: string) => call("/v1/ssh-keys", { method: "POST", body: JSON.stringify({ name, public_key }) }),
    rmKey: (id: string) => call(`/v1/ssh-keys/${id}`, { method: "DELETE" }),
  };
}
