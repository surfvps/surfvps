# surfvps — crypto VPS hosting from your terminal or your AI agent

Deploy a VPS and pay with **Bitcoin, Monero, USDT, Ethereum, Solana, Litecoin or Lightning**. No credit card, no invoices — prepay a balance, spend it by the hour, destroy the server when you're done.

These are the official open-source clients for [surfvps.com](https://surfvps.com): a **command-line tool** and a **Model Context Protocol (MCP) server** that lets an AI agent run the whole account.

| Package | npm | What it is |
| --- | --- | --- |
| [`surfvps`](packages/cli) | [![npm](https://img.shields.io/npm/v/surfvps?label=surfvps)](https://www.npmjs.com/package/surfvps) | CLI — deploy, manage and pay for servers from your shell |
| [`surfvps-mcp`](packages/mcp) | [![npm](https://img.shields.io/npm/v/surfvps-mcp?label=surfvps-mcp)](https://www.npmjs.com/package/surfvps-mcp) | MCP server — let Claude, Cursor or any agent deploy servers |

---

## Deploy a VPS from the command line

```bash
npm install -g surfvps
surfvps login                                  # paste an API token from the dashboard
surfvps deposit --usd 20 --coin XMR --wait     # pay in Monero, watch it confirm
surfvps catalog --provider vultr               # list regions, plans, images
surfvps deploy --provider vultr --region ewr \
  --size vc2-1c-1gb --image ubuntu-24-04-x64   # live in ~60 seconds
surfvps ssh <id>                               # connect
surfvps rm <id>                                # destroy — billing stops immediately
```

Plans start at **$11.00/mo (~$0.015/hr)**. Billing is hourly with a one-hour minimum and capped at the plan's monthly price, so a box you run for an afternoon costs cents.

## Let an AI agent deploy your servers (MCP)

`surfvps-mcp` is an [MCP](https://modelcontextprotocol.io) server, so **Claude Desktop, Claude Code, Cursor** or any MCP-compatible agent can manage real infrastructure — check the balance, browse the catalog, deploy, destroy, read root passwords, and start a crypto top-up that returns a payment address right in the conversation.

```bash
claude mcp add surfvps -e SURFVPS_TOKEN=sk_live_... -- npx -y surfvps-mcp
```

<details>
<summary>Claude Desktop / Cursor config</summary>

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
</details>

**15 tools:** `get_balance` · `list_ledger` · `list_catalog` · `list_servers` · `get_server` · `deploy_server` · `server_action` · `destroy_server` · `get_root_password` · `list_ssh_keys` · `add_ssh_key` · `remove_ssh_key` · `estimate_cost` · `create_deposit` · `deposit_status`

Built for agents that spend real money safely:

- **`destroy_server` is annotated destructive** and requires the server's exact hostname to confirm — plus its IPv4 if two servers share a name. A hallucinated id can't delete the wrong box.
- **Every refusal is an error result**, never a successful-looking one, so an agent can't report "destroyed" when nothing was.
- **`estimate_cost` quotes before you spend**, using the same rate the deploy path actually bills at.
- **Balance is a hard floor** — with no funds you get `insufficient_balance`, not a surprise bill.

## Pay with crypto, not a card

Fund a prepaid balance with **Bitcoin (BTC), Monero (XMR), USDT (TRON), Ethereum (ETH), Solana (SOL), Litecoin (LTC) or Bitcoin Lightning**. Each deposit gets a fresh single-use address, and the $20 minimum credits automatically once it confirms.

Signup takes an email and a password — no card on file, no billing address, no ID. Your infrastructure isn't tied to a real-world identity. That is a privacy property of paying in crypto, not a claim that anything evades lawful process: abuse reports are still acted on and offending servers terminated.

## Providers and regions

| Provider | From | Regions |
| --- | --- | --- |
| **Vultr** | $11.00/mo | 33 worldwide |
| **DigitalOcean** | $13.20/mo | 15 worldwide |

Linux (Ubuntu, Debian, AlmaLinux, Rocky, CentOS) plus Windows Server and cPanel/Plesk images where the provider offers them. Call `list_catalog` for live plans and prices — never hard-code them.

## Use the REST API directly

Both clients speak the same public API, so anything they do you can do with `curl`:

```bash
curl -H "Authorization: Bearer $SURFVPS_TOKEN" https://surfvps.com/v1/balance
curl -H "Authorization: Bearer $SURFVPS_TOKEN" "https://surfvps.com/v1/catalog?provider=vultr"
```

Endpoints: `/v1/balance` · `/v1/catalog` · `/v1/servers` · `/v1/servers/:id` · `/v1/servers/:id/actions` · `/v1/servers/:id/password` · `/v1/ssh-keys` · `/v1/deposits`

## Billing, precisely

- **Hourly**, with a one-hour minimum and a $0.02 per-server minimum
- **Capped** at the plan's monthly price for the calendar month
- **A stopped server still bills** — it holds its resources at the provider. Only destroying it stops charges
- Run out of balance and servers are suspended, then deleted after a grace period. Keep your own backups

## Development

```bash
cd packages/cli   # or packages/mcp
npm install && npm run build && npm test
```

Issues and pull requests welcome. For account or billing questions use [surfvps.com/contact](https://surfvps.com/contact).

MIT
