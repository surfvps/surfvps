#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { makeApi } from "./client";
import { loadConfig, saveConfig } from "./config";

const G = "\x1b[38;5;48m", DIM = "\x1b[2m", R = "\x1b[0m", AMBER = "\x1b[38;5;214m";
const ok = (s: string) => console.log(`${G}✓${R} ${s}`);
const die = (s: string) => { console.error(`${AMBER}✗ ${s}${R}`); process.exit(1); };

// Poll one deposit and show its confirmations as they land, so a paying customer sees progress instead of a silent
// spinner. `once` prints a single snapshot (surfvps deposit --status <id>) rather than waiting.
async function watchDeposit(api: ReturnType<typeof makeApi>, id: string, once = false) {
  let lastLine = "";
  for (let i = 0; i < 240; i++) { // ~20 min at 5s
    const d = await api.depositStatus(id);
    if (d.credited) {
      const bal = await api.balance().catch(() => null);
      if (lastLine) console.log("");
      return ok(`credited — ${d.amount_usd}${bal ? `, balance ${bal.balance_usd}` : ""}`);
    }
    if (d.status === "expired") { if (lastLine) console.log(""); return die("this deposit expired — start a new one"); }
    const conf = d.confirmations ?? 0, need = d.required_confirmations ?? 0;
    const line = need
      ? `  ${DIM}${d.status}${R} ${conf}/${need} confirmation(s)${d.tx_hash ? ` ${DIM}${d.tx_hash.slice(0, 16)}…${R}` : ""}`
      : `  ${DIM}${d.status} — no payment seen yet${R}`;
    if (once) return console.log(line);
    if (line !== lastLine) { if (lastLine) console.log(""); process.stdout.write(line); lastLine = line; }
    else process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("");
  return console.log(`${DIM}still pending — check later: surfvps deposit --status ${id}${R}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();

  if (cmd === "login") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const token = (await rl.question("API token (sk_live_…): ")).trim();
    rl.close();
    saveConfig({ apiBase: cfg.apiBase, token });
    return ok("saved to ~/.surfvps/config.json");
  }
  if (!cfg.token && cmd !== "help") die("not logged in — run: surfvps login");
  const api = makeApi(cfg);

  switch (cmd) {
    case "balance": { const b = await api.balance(); return console.log(`${G}balance${R} ${b.balance_usd}`); }
    case "ls": case "servers": {
      const { servers } = await api.servers();
      if (!servers.length) return console.log(`${DIM}no servers${R}`);
      for (const s of servers) console.log(`${G}●${R} ${s.hostname}  ${DIM}${s.provider} ${s.region}${R}  ${s.ipv4 ?? "ip pending"}  ${s.status}  ${s.hourly_usd}/hr`);
      return;
    }
    case "deploy": {
      const { values } = parseArgs({ args: rest, options: { provider: { type: "string" }, region: { type: "string" }, size: { type: "string" }, image: { type: "string" }, hostname: { type: "string" }, "ssh-key": { type: "string", multiple: true } } });
      if (!values.provider || !values.region || !values.size || !values.image) die("usage: surfvps deploy --provider <p> --region <r> --size <s> --image <i> [--hostname <h>] [--ssh-key <id>]");
      const keys = values["ssh-key"] as string[] | undefined;
      const s = await api.deploy({ provider: values.provider, region: values.region, size: values.size, image: values.image, hostname: values.hostname, ...(keys?.length ? { ssh_key_ids: keys } : {}) } as any);
      ok(`provisioning ${s.id} (${s.status})`);
      console.log(`${DIM}poll: surfvps get ${s.id}${keys?.length ? "" : `  ·  password: surfvps password ${s.id}`}${R}`);
      return;
    }
    case "catalog": {
      const { values } = parseArgs({ args: rest, options: { provider: { type: "string" }, kind: { type: "string" } } });
      if (!values.provider) die("usage: surfvps catalog --provider <p> [--kind regions|sizes|images]");
      const c = await api.catalog(values.provider);
      const kinds = values.kind ? [values.kind] : ["regions", "sizes", "images"];
      for (const k of kinds) {
        const rows = (c as any)[k] ?? [];
        console.log(`${G}${k}${R} ${DIM}(${rows.length})${R}`);
        for (const r of rows) console.log(`  ${r.ref}${r.monthly_usd ? `  ${DIM}${r.monthly_usd}/mo${R}` : ""}${r.label && r.label !== r.ref ? `  ${DIM}${r.label}${R}` : ""}`);
      }
      return;
    }
    case "deposit": {
      const { values } = parseArgs({ args: rest, options: { usd: { type: "string" }, coin: { type: "string" }, wait: { type: "boolean" }, status: { type: "string" } } });
      if (values.status) return watchDeposit(api, values.status, true); // one-shot status of an existing deposit
      const usd = Number(values.usd);
      if (!Number.isFinite(usd)) die("usage: surfvps deposit --usd <amount> [--coin BTC|XMR|ETH|LTC|SOL|USDT_TRX|LN] [--wait]   (minimum $20)");
      const d = await api.deposit(usd, values.coin);
      ok(`deposit created — $${d.amount_usd}`);
      if (d.pay_address) {
        // coin chosen → show the exact address + amount so no browser is needed
        console.log(`  ${G}send${R}  ${d.pay_amount} ${d.coin}${d.network ? ` ${DIM}(${d.network})${R}` : ""}`);
        console.log(`  ${G}to${R}    ${d.payment_request ?? d.pay_address}`);
        if (d.required_confirmations) console.log(`  ${DIM}needs ${d.required_confirmations} confirmation(s)${R}`);
      } else {
        console.log(`${DIM}pay here:${R} ${d.hosted_url}`);
      }
      if (!values.wait) return console.log(`${DIM}then: surfvps deposit --status ${d.id}   (or re-run with --wait)${R}`);
      console.log(`${DIM}waiting for the payment to confirm (ctrl-c to stop)…${R}`);
      return watchDeposit(api, d.id);
    }
    case "ledger": case "history": {
      const { entries } = await api.ledger(25);
      if (!entries.length) return console.log(`${DIM}no activity${R}`);
      for (const e of entries) console.log(`${DIM}${new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ")}${R}  ${e.amount_usd.padStart(10)}  ${e.type}`);
      return;
    }
    case "keys": {
      const [sub, ...a] = rest;
      if (sub === "add") {
        const { values } = parseArgs({ args: a, options: { name: { type: "string" }, file: { type: "string" } } });
        const { readFileSync } = await import("node:fs");
        const path = values.file ?? `${process.env.HOME}/.ssh/id_ed25519.pub`;
        let pub = ""; try { pub = readFileSync(path, "utf8").trim(); } catch { die(`can't read ${path} — pass --file <path/to/key.pub>`); }
        const k = await api.addKey(values.name ?? "cli", pub);
        return ok(`added ${k.name}  ${DIM}${k.fingerprint}${R}  id ${k.id}`);
      }
      if (sub === "rm" || sub === "remove") { if (!a[0]) die("usage: surfvps keys rm <id>"); await api.rmKey(a[0]); return ok(`removed ${a[0]}`); }
      const { ssh_keys } = await api.keys();
      if (!ssh_keys.length) return console.log(`${DIM}no ssh keys — add one: surfvps keys add --file ~/.ssh/id_ed25519.pub${R}`);
      for (const k of ssh_keys) console.log(`${G}●${R} ${k.name}  ${DIM}${k.fingerprint}${R}  ${k.id}`);
      return;
    }
    case "password": {
      if (!rest[0]) die("usage: surfvps password <server-id>");
      const p = await api.password(rest[0]);
      if (!p.root_password) return console.log(`${DIM}${p.note ?? "no password on this server"}${R}`);
      return console.log(p.root_password);
    }
    case "get": { const s = await api.get(rest[0]); return console.log(`${s.status}  ${s.ipv4 ?? "ip pending"}  ${s.hourly_usd}/hr`); }
    case "rm": case "destroy": { await api.destroy(rest[0]); return ok(`destroyed ${rest[0]}`); }
    case "reboot": case "stop": case "start": { const s = await api.action(rest[0], cmd); return ok(`${cmd} → ${s.status}`); }
    case "ssh": { const s = await api.get(rest[0]); if (!s.ipv4) die("no IP yet"); const { spawnSync } = await import("node:child_process"); return void spawnSync("ssh", [`root@${s.ipv4}`], { stdio: "inherit" }); }
    default: console.log([
      "surfvps — deploy VPS, pay with crypto",
      "",
      `${DIM}account${R}`,
      "  login                          save your API token",
      "  balance                        prepaid balance",
      "  deposit --usd <n> [--wait]     top up with crypto (prints the payment link)",
      "  ledger                         recent charges & deposits",
      "",
      `${DIM}servers${R}`,
      "  catalog --provider <p>         regions / sizes / images to deploy with",
      "  deploy --provider <p> --region <r> --size <s> --image <i> [--hostname <h>] [--ssh-key <id>]",
      "  ls                             list servers",
      "  get <id>                       status + IP",
      "  password <id>                  initial root password",
      "  reboot|stop|start <id>",
      "  ssh <id>                       ssh into a server",
      "  rm <id>                        destroy (billing stops immediately)",
      "",
      `${DIM}ssh keys${R}`,
      "  keys                           list your keys",
      "  keys add [--name <n>] [--file <path.pub>]",
      "  keys rm <id>",
      "",
      `${DIM}deposits${R}`,
      "  deposit --usd <n> [--coin BTC|XMR|ETH|LTC|SOL|USDT_TRX|LN] [--wait]",
      "  deposit --status <id>          confirmations for an existing deposit",
    ].join("\n"));
  }
}
main().catch((e) => die(e instanceof Error ? e.message : String(e)));
