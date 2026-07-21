# surfvps clients

Official command-line and [MCP](https://modelcontextprotocol.io) clients for [surfvps.com](https://surfvps.com) — deploy VPS servers on DigitalOcean and Vultr, paid with Bitcoin, Monero, USDT, Ethereum, Solana, Litecoin or Lightning.

| Package | npm | What it is |
| --- | --- | --- |
| [`surfvps`](packages/cli) | [![npm](https://img.shields.io/npm/v/surfvps)](https://www.npmjs.com/package/surfvps) | CLI — deploy, manage and pay from your terminal |
| [`surfvps-mcp`](packages/mcp) | [![npm](https://img.shields.io/npm/v/surfvps-mcp)](https://www.npmjs.com/package/surfvps-mcp) | MCP server — let an AI agent run your account |

## Quick start

```bash
npm install -g surfvps
surfvps login                     # paste an API token from surfvps.com → Settings → API tokens
surfvps catalog --provider digitalocean
surfvps deploy --provider digitalocean --region nyc1 --size s-1vcpu-1gb --image ubuntu-24-04-x64
```

For an AI agent (Claude Desktop, Claude Code, Cursor, …):

```bash
claude mcp add surfvps -e SURFVPS_TOKEN=sk_live_... -- npx -y surfvps-mcp
```

## Why

Prepay a balance in crypto, then spend it by the hour. No card on file. Billing is hourly with a one-hour minimum, capped at each plan's monthly price, and destroying a server stops the charges immediately.

Both clients speak the same public REST API (`https://surfvps.com/v1`), so anything they do, you can do with `curl`:

```bash
curl -H "Authorization: Bearer $SURFVPS_TOKEN" https://surfvps.com/v1/balance
```

## Development

```bash
cd packages/cli   # or packages/mcp
npm install
npm run build
npm test
```

Issues and PRs welcome. For account or billing questions, use [surfvps.com/contact](https://surfvps.com/contact).

MIT
