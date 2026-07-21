# surfvps

Deploy a VPS on DigitalOcean, Vultr & more — pay with crypto. Command-line client for [surfvps.com](https://surfvps.com).

No card, no KYC forms: fund a prepaid balance with Bitcoin, Monero, USDT, Ethereum, Solana, Litecoin or Lightning, then deploy servers that bill by the hour against it.

## Install

```bash
npm install -g surfvps
```

## Log in

Create an API token in your dashboard under **Settings → API tokens**, then:

```bash
surfvps login          # paste the sk_live_… token; stored in ~/.surfvps/config.json (0600)
```

Or set it per-shell instead:

```bash
export SURFVPS_TOKEN=sk_live_...
```

## Use

```bash
# account
surfvps balance                       # prepaid balance
surfvps deposit --usd 50 --coin XMR   # top up — prints an address + amount to pay, no browser
surfvps deposit --usd 50 --coin XMR --wait   # …and watch confirmations land
surfvps deposit --status <id>         # confirmations for an existing deposit
surfvps ledger                        # recent charges & deposits

# servers
surfvps catalog --provider digitalocean       # regions / sizes / images to deploy with
surfvps deploy \
  --provider digitalocean \
  --region nyc1 \
  --image ubuntu-24-04-x64 \
  --size s-1vcpu-1gb \
  --hostname web-1 \
  --ssh-key <key-id>                  # optional — omit and a root password is generated
surfvps ls                            # list your servers
surfvps get <id>                      # status + IP
surfvps password <id>                 # initial root password (if deployed without a key)
surfvps reboot|stop|start <id>
surfvps ssh <id>                      # ssh root@<ip>
surfvps rm <id>                       # destroy (billing stops immediately)

# ssh keys
surfvps keys                          # list
surfvps keys add --file ~/.ssh/id_ed25519.pub
surfvps keys rm <id>
```

`deposit` supports `--coin BTC|XMR|ETH|LTC|SOL|USDT_TRX|LN`. Omit `--coin` and you get a hosted checkout link where you pick the coin in a browser. Omit `--wait` and check later with `surfvps deposit --status <id>`.

Region, image and size refs are provider-specific — list them with `surfvps catalog --provider <p>` (or the raw API):

```bash
curl -H "Authorization: Bearer $SURFVPS_TOKEN" \
  "https://surfvps.com/v1/catalog?provider=digitalocean"
```

## Notes

- **Billing** is hourly with a one-hour minimum (and a $0.02 per-server minimum), capped at each plan's monthly price. Destroy a server and billing stops immediately.
- **Access**: attach an SSH key in the dashboard, or deploy without one and a root password is generated for you and shown on the server's page.
- `SURFVPS_API` overrides the API base (default `https://surfvps.com`).

MIT © surfvps
