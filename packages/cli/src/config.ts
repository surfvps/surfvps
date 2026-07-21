import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".surfvps");
const FILE = join(DIR, "config.json");
export interface CliConfig { apiBase: string; token: string; }

export function loadConfig(): CliConfig {
  try { return { apiBase: "https://surfvps.com", ...JSON.parse(readFileSync(FILE, "utf8")) }; }
  catch { return { apiBase: process.env.SURFVPS_API ?? "https://surfvps.com", token: process.env.SURFVPS_TOKEN ?? "" }; }
}
export function saveConfig(c: CliConfig) { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); }
