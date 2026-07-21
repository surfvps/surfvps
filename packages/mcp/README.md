# surfvps-mcp

MCP server for [surfvps.com](https://surfvps.com) — let an AI agent deploy VPS servers, paid with crypto.

Your agent gets typed tools for the whole account: check the balance, browse the catalog, deploy and destroy servers, read root passwords, and start a Bitcoin/Monero/USDT top-up that returns a payment address right in the conversation.

## Setup

1. Create an API token at **surfvps.com → Settings → API tokens**.
2. Add the server to your MCP host.

**Claude Desktop** (`claude_desktop_config.json`) / **Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "surfvps": {
      "command": "npx",
      "args": ["-y", "surfvps-mcp"],
      "env": { "SURFVPS_TOKEN": "sk_live_..." }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add surfvps -e SURFVPS_TOKEN=sk_live_... -- npx -y surfvps-mcp
```

## Tools

| Tool | What it does |
| --- | --- |
| `get_balance` | Prepaid USD balance |
| `list_ledger` | Recent deposits & charges |
| `list_catalog` | Regions, sizes (with monthly price) and images for a provider |
| `list_servers` / `get_server` | Your servers, status and IP |
| `deploy_server` | Deploy a VPS |
| `server_action` | Reboot / stop / start |
| `destroy_server` | Destroy a server (irreversible) |
| `get_root_password` | Initial root password, if deployed without an SSH key |
| `list_ssh_keys` / `add_ssh_key` / `remove_ssh_key` | Manage SSH public keys |
| `estimate_cost` | Quote a plan before deploying — total for N hours, hourly rate, monthly ceiling |
| `create_deposit` | Start a crypto top-up — returns an address + exact amount |
| `deposit_status` | Poll a deposit's confirmations |

DigitalOcean is the provider open to all accounts; Vultr is currently restricted to admin accounts and returns `bad_provider` for everyone else.

## Safety

- `destroy_server` is annotated **destructive**, so hosts prompt before it runs — and it additionally requires the server's exact current `hostname` as `confirm_hostname`. If two of your servers share that hostname, it refuses with `ambiguous_hostname` until you also pass `confirm_ipv4`, so a confirmation always identifies exactly one box.
- `server_action` is annotated destructive too: a reboot or power-off interrupts a live machine.
- Every refusal comes back as a tool **error**, never as a successful-looking result — an agent cannot mistake a blocked destroy for a completed one.
- Deploying spends real money from your prepaid balance. Balance is a hard floor: with no funds, `deploy_server` returns `insufficient_balance` instead of running up a bill. Concurrent servers are capped by balance (under $20 → 1, $20 → 2, $50 → 3, $100 → 4; suspended servers still occupy a slot).
- The agent can *start* a deposit but can never move funds — `create_deposit` only returns an address for a human to pay.
- `get_root_password` requires an explicit `reveal: true`, because it puts a live credential in the transcript. Prefer deploying with an SSH key.
- Errors are the API's own codes — `insufficient_balance`, `instance_limit`, `bad_provider`, `ssh_key_not_found`, `bad_coin`, `bad_amount`, `hostname_mismatch`, `ambiguous_hostname`, `rate_limited` — so agents can read them and self-correct.

## Typical flow

```
list_catalog(provider="digitalocean")   → pick a region / size / image
estimate_cost(size=…, hours=…)          → what it will cost
get_balance()                           → confirm funds
deploy_server(...)                      → returns the server id
get_server(id)                          → poll until status "running", read the IP
get_root_password(id, reveal=true)      → if deployed without an SSH key
destroy_server(id, confirm_hostname=…)  → stops further charges
```

`status` is one of `provisioning`, `running`, `stopped`, `suspended`, `error`, `destroying`, `destroyed`.

## Billing

Hourly, with a **one-hour minimum** and a **$0.02 minimum per server** — a box destroyed 30 seconds after deploy still costs an hour. Charges never exceed the plan's monthly price for the calendar month (plus the license surcharge if you deploy a licensed image such as cPanel, Plesk or Windows). **A stopped server keeps billing at the full rate** — it still holds its resources at the provider. Only `destroy_server` stops charges.

## Config

| Env | Default | |
| --- | --- | --- |
| `SURFVPS_TOKEN` | *(required)* | API token from the dashboard |
| `SURFVPS_API` | `https://surfvps.com` | API base URL |

Prefer a terminal? The same account works with the [`surfvps` CLI](https://www.npmjs.com/package/surfvps).

MIT © surfvps
