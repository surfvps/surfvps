import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeApi, type Api } from "./client.js";

const DEPOSIT_COINS = ["BTC", "XMR", "ETH", "LTC", "SOL", "USDT_TRX", "LN"] as const;

// Wrap a tool body so any thrown error (network, or an API error CODE like instance_limit / ssh_key_required /
// min_deposit) comes back as a readable, NON-throwing tool result an agent can act on, rather than a transport error.
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }] };
}
function tool<T>(fn: (a: T) => Promise<unknown>) {
  return async (a: T) => { try { return ok(await fn(a)); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); } };
}

export function buildServer(api: Api): McpServer {
  const server = new McpServer({ name: "surfvps", version: "0.1.0" });
  const R = (title: string) => ({ title, readOnlyHint: true, openWorldHint: true });
  const W = (title: string, destructive = false) => ({ title, readOnlyHint: false, destructiveHint: destructive, openWorldHint: true });

  // ─────────────── read-only ───────────────
  server.registerTool("get_balance", { description: "Get the account's prepaid USD balance.", annotations: R("Get balance") },
    tool(async () => api.balance()));

  server.registerTool("list_ledger", {
    description: "Recent ledger activity (deposits, server charges, adjustments).",
    inputSchema: { limit: z.number().int().min(1).max(100).optional().describe("max entries (default 25)") },
    annotations: R("List ledger"),
  }, tool(async ({ limit }) => api.ledger(limit ?? 25)));

  server.registerTool("list_catalog", {
    description: "List a provider's deployable regions, plan sizes (with monthly price) and OS images. ALWAYS call this before deploy_server to get valid refs — they are provider-specific and cannot be guessed.",
    inputSchema: { provider: z.enum(["digitalocean", "vultr"]).default("digitalocean").describe("cloud provider — digitalocean is the public one; vultr is currently restricted to admin accounts and returns bad_provider for everyone else") },
    annotations: R("List catalog"),
  }, tool(async ({ provider }) => api.catalog(provider)));

  server.registerTool("list_servers", { description: "List the account's servers (id, hostname, provider, region, status, IP, hourly rate).", annotations: R("List servers") },
    tool(async () => api.servers()));

  server.registerTool("get_server", {
    description: "Get one server's current status and IP. status is one of provisioning, running, stopped, suspended, error, destroying, destroyed — a freshly deployed box goes provisioning -> running (there is no \"active\").",
    inputSchema: { id: z.string().describe("server id from list_servers or deploy_server") },
    annotations: R("Get server"),
  }, tool(async ({ id }) => api.getServer(id)));

  server.registerTool("get_root_password", {
    description: "Reveal the initial root password for a server deployed WITHOUT an SSH key. This returns a live credential in plaintext, which will remain in the conversation transcript — only call it when the user has asked for the password, and set reveal=true to confirm. Returns null if the server was deployed with an SSH key (use the key instead).",
    inputSchema: { id: z.string(), reveal: z.literal(true).describe("must be true — explicit acknowledgement that a live plaintext credential will be shown") },
    annotations: R("Get root password"),
  }, tool(async ({ id }) => api.password(id)));

  server.registerTool("list_ssh_keys", { description: "List SSH keys on the account (id, name, fingerprint).", annotations: R("List SSH keys") },
    tool(async () => api.sshKeys()));

  server.registerTool("deposit_status", {
    description: "Check a crypto top-up: whether it has been credited, and how many confirmations it has so far. Poll this after create_deposit; the balance updates once it is credited.",
    inputSchema: { id: z.string().describe("the deposit id returned by create_deposit") },
    annotations: R("Deposit status"),
  }, tool(async ({ id }) => api.depositStatus(id)));

  // ─────────────── writes ───────────────
  server.registerTool("add_ssh_key", {
    description: "Register an SSH PUBLIC key on the account so servers can be deployed with it. Never send a private key.",
    inputSchema: { name: z.string().max(60).optional(), public_key: z.string().describe("openssh public key, e.g. 'ssh-ed25519 AAAA... user@host'") },
    annotations: W("Add SSH key"),
  }, tool(async ({ name, public_key }) => api.addSshKey(name ?? "agent", public_key)));

  server.registerTool("remove_ssh_key", {
    description: "Remove an SSH key from the account. Servers already deployed with it keep working — this only stops it being offered for new deploys.",
    inputSchema: { id: z.string().describe("key id from list_ssh_keys") },
    annotations: W("Remove SSH key"),
  }, tool(async ({ id }) => api.removeSshKey(id)));

  server.registerTool("deploy_server", {
    description: "Deploy a new VPS. Get valid provider/region/size/image refs from list_catalog first — they are provider-specific. If no ssh_key_ids are given, a root password is generated (read it later with get_root_password). Deploying spends real money from the prepaid balance: charging starts immediately with a 1-hour minimum (and a $0.02 minimum per server), so a box destroyed after 30 seconds still costs an hour. The new server starts as status \"provisioning\" and becomes \"running\" — poll get_server. Give each server a distinct hostname; it is how you and the user tell them apart.",
    inputSchema: {
      provider: z.enum(["digitalocean", "vultr"]).default("digitalocean").describe("digitalocean is the public provider; vultr is admin-only right now and returns bad_provider"),
      region: z.string().describe("region ref from list_catalog"),
      size: z.string().describe("plan size ref from list_catalog"),
      image: z.string().describe("OS image ref from list_catalog"),
      hostname: z.string().max(60).optional().describe("DNS-safe name; pick a distinct, meaningful one per server (defaults to surfvps-<random>)"),
      ssh_key_ids: z.array(z.string()).optional().describe("ids from list_ssh_keys; omit to get a root password instead"),
    },
    annotations: W("Deploy server"),
  }, tool(async (a) => api.deploy(a)));

  server.registerTool("server_action", {
    description: "Reboot, stop, or start a server. IMPORTANT: stopping does NOT stop billing — a stopped server still holds its resources at the provider and bills at the full hourly rate. destroy_server is the only way to stop charges.",
    inputSchema: { id: z.string(), action: z.enum(["reboot", "stop", "start"]) },
    // Disruptive to a live machine (a reboot or power-off interrupts whatever it is serving), so hosts should
    // prompt — even though nothing is permanently lost.
    annotations: { title: "Server action", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, tool(async ({ id, action }) => api.action(id, action)));

  server.registerTool("create_deposit", {
    description: "Start a crypto top-up. With a coin, returns a payment ADDRESS and exact crypto AMOUNT to send (no browser); without a coin, returns a hosted checkout URL. Minimum $20. The agent cannot send the payment — surface the address/amount to the human, then poll deposit_status.",
    inputSchema: {
      // The API rejects sub-cent amounts (bad_amount); catch it here so the agent is told the rule instead of the code.
      usd: z.number().min(20).max(100000)
        .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "at most 2 decimal places")
        .describe("amount in USD (min 20, max 100000, at most 2 decimals)"),
      coin: z.enum(DEPOSIT_COINS).optional().describe("pre-select a coin for an address+amount; omit for a hosted checkout link"),
    },
    annotations: W("Create deposit"),
  }, tool(async ({ usd, coin }) => api.createDeposit(coin ? { usd, coin } : { usd })));

  server.registerTool("estimate_cost", {
    description: "Quote what a plan will cost before deploying it: total for a given number of hours, plus the hourly rate and the monthly ceiling. Use this to answer \"how much will this cost me?\" instead of guessing from the monthly price. Licensed images (cPanel/Plesk/Windows) add a surcharge on top and are not included.",
    inputSchema: {
      provider: z.enum(["digitalocean", "vultr"]).default("digitalocean"),
      size: z.string().describe("plan size ref from list_catalog"),
      hours: z.number().positive().max(8760).default(730).describe("how long the server will run (default 730 = one month)"),
    },
    annotations: R("Estimate cost"),
  }, tool(async ({ provider, size, hours }) => {
    const cat: any = await api.catalog(provider);
    const plan = (cat.sizes ?? []).find((s: any) => s.ref === size);
    if (!plan) throw new Error(`unknown_size: "${size}" is not a ${provider} plan — call list_catalog for valid refs`);
    // Mirrors the real billing rules: whole hours with a 1-hour minimum, capped per calendar month, and a $0.02
    // per-server floor. Rates come from the catalog, which computes them with the same function the deploy path
    // locks onto the server — so this quote matches the bill.
    const hourlyMicro = Number(plan.hourly_micro ?? 0);
    const monthlyMicro = Number(plan.monthly_micro ?? 0);
    const billedHours = Math.max(1, Math.ceil(hours));
    const months = Math.ceil(billedHours / 730);
    const raw = billedHours * hourlyMicro;
    const capped = Math.min(raw, months * monthlyMicro);
    const totalMicro = Math.max(capped, 20_000); // $0.02 per-server minimum
    // Under $1 show 4 decimals (an hourly rate of $0.0151 must not read as "$0.02") and trim trailing zeros;
    // at or above $1 keep the plain 2-decimal money form.
    const usd = (m: number) => m < 1e6
      ? `$${(m / 1e6).toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}`
      : `$${(m / 1e6).toFixed(2)}`;
    return {
      plan: plan.ref, label: plan.label, provider,
      hours_billed: billedHours,
      hourly_usd: plan.hourly_usd, monthly_cap_usd: plan.monthly_usd,
      estimated_total_usd: usd(totalMicro),
      capped_at_monthly: capped < raw,
      note: "Whole hours, 1-hour minimum, capped at the monthly price per calendar month. Bandwidth beyond the plan's included transfer bills separately at $0.02/GB.",
    };
  }));

  // DESTRUCTIVE — irreversible
  server.registerTool("destroy_server", {
    description: "PERMANENTLY destroy a server. Irreversible — all data is lost. Billing stops at destroy, but the hour already started is still charged (1-hour minimum, $0.02 minimum per server). To confirm you have the right box you must pass its exact current hostname; if two of your servers share that hostname, you must also pass its IPv4.",
    inputSchema: {
      id: z.string(),
      confirm_hostname: z.string().describe("the target server's exact current hostname (from get_server / list_servers)"),
      confirm_ipv4: z.string().optional().describe("the target server's IPv4 — required when more than one of your servers has this hostname"),
    },
    annotations: { title: "Destroy server", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, tool(async ({ id, confirm_hostname, confirm_ipv4 }) => {
    // The confirmation only means something if it identifies ONE box. Echoing a hostname proves nothing when
    // several servers share it, so in that case demand the IPv4 too. Failures THROW (never a plain object) so the
    // host marks the result isError — an agent must not read a refusal as "destroyed".
    const s: any = await api.getServer(id); // 404/network errors propagate with their own code
    if ((s.hostname ?? "") !== confirm_hostname) {
      throw new Error(`hostname_mismatch: server ${id} is named "${s.hostname ?? ""}", not "${confirm_hostname}"`);
    }
    const { servers = [] }: any = await api.servers().catch(() => ({ servers: [] }));
    const sameName = servers.filter((x: any) => x.hostname === confirm_hostname);
    if (sameName.length > 1) {
      if (!confirm_ipv4) {
        throw new Error(
          `ambiguous_hostname: ${sameName.length} of your servers are named "${confirm_hostname}" ` +
          `(${sameName.map((x: any) => `${x.id}=${x.ipv4 ?? "ip pending"}`).join(", ")}). ` +
          `Re-call with confirm_ipv4 set to the IPv4 of the one you mean.`,
        );
      }
      if (!s.ipv4) throw new Error("ip_pending: this server has no IPv4 yet, so it cannot be disambiguated — wait for it to finish provisioning");
      if (s.ipv4 !== confirm_ipv4) throw new Error(`ipv4_mismatch: server ${id} is ${s.ipv4}, not ${confirm_ipv4}`);
    }
    return api.destroy(id);
  }));

  return server;
}

export { makeApi };
