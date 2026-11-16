#!/usr/bin/env node
// Cloudflare edge security settings for the evade.health zone (evade.health and api.evade.health).
//
//   node scripts/cloudflare-security.mjs            dry run: prints the current value and the planned change
//   node scripts/cloudflare-security.mjs --apply    applies the plan (run the dry run first)
//   node scripts/cloudflare-security.mjs --revert   restores everything recorded in the state file
//
// Options: --rl-requests=N  requests per 10 s per IP for the main rate limiting rule (default 100).
//
// Environment:
//   CLOUDFLARE_API_TOKEN    required. Read from the environment only; never printed, logged or written to disk.
//   CLOUDFLARE_ALERT_EMAIL  optional. Recipient for account notifications; without it, notifications are skipped.
//
// Token (least privilege, see SECURITY.md "Cloudflare edge settings"):
//   Zone: Zone Read, Zone Settings Edit, Zone WAF Edit, Bot Management Read (zone evade.health only)
//   Account: Notifications Edit (account EVAde only)
//
// The script changes zone settings, WAF rules (custom, rate limiting, managed) and notification policies only.
// It never touches DNS, Workers, Access, D1, KV, R2 or billing. Previous values go to
// scripts/.cloudflare-security-state.json (git-ignored) before every change, so --revert can undo them.
// Re-running is idempotent: settings and rules that already match are left alone.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ZONE_NAME = "evade.health";
const API_HOST = "api.evade.health";
const CF = "https://api.cloudflare.com/client/v4";
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".cloudflare-security-state.json");
const MANAGED_RULESET_NAMES = { free: "Cloudflare Managed Free Ruleset", paid: "Cloudflare Managed Ruleset" };
const RATE_LIMIT_RULES_BY_PLAN = { free: 1, pro: 2, business: 5, enterprise: 100 };

const argv = process.argv.slice(2);
const MODE = argv.includes("--revert") ? "revert" : argv.includes("--apply") ? "apply" : "dry-run";
const RL_REQUESTS = Number((argv.find((a) => a.startsWith("--rl-requests=")) ?? "--rl-requests=100").split("=")[1]);
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ALERT_EMAIL = (process.env.CLOUDFLARE_ALERT_EMAIL ?? "").trim();

if (!TOKEN) {
  console.error("CLOUDFLARE_API_TOKEN is not set. Set it in your shell; this script never asks for or stores it.");
  process.exit(1);
}
if (!Number.isInteger(RL_REQUESTS) || RL_REQUESTS < 1) {
  console.error("--rl-requests must be a positive integer.");
  process.exit(1);
}

// ---------- API ----------
async function cf(method, path, body) {
  const res = await fetch(CF + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const detail = (data.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    const error = new Error(`${method} ${path} -> HTTP ${res.status} ${detail}`);
    error.status = res.status;
    throw error;
  }
  return data.result;
}
const tryCf = async (...a) => {
  try {
    return { ok: true, value: await cf(...a) };
  } catch (error) {
    return { ok: false, error };
  }
};

// ---------- state (previous values, for --revert) ----------
const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : { zone: ZONE_NAME, settings: {}, rules: {}, policies: {} };
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

// ---------- output ----------
const rows = [];
const show = (v) => (v === undefined ? "-" : typeof v === "string" ? v : JSON.stringify(v));
function report(item, current, planned, status, note = "") {
  rows.push({ item, current: show(current), planned: show(planned), status, note });
}
function printReport() {
  const label = { ok: "no change", change: MODE === "apply" ? "CHANGED" : "WILL CHANGE", skip: "SKIPPED", manual: "MANUAL", error: "ERROR" };
  for (const r of rows) {
    console.log(`\n[${label[r.status] ?? r.status}] ${r.item}`);
    console.log(`  current: ${r.current}`);
    if (r.status !== "ok") console.log(`  planned: ${r.planned}`);
    if (r.note) console.log(`  note:    ${r.note}`);
  }
}

// Deep "want is contained in have" comparison, so fields Cloudflare adds on its own don't count as drift.
function contains(have, want) {
  if (want === null || typeof want !== "object") return have === want;
  if (Array.isArray(want)) return Array.isArray(have) && have.length === want.length && want.every((w, i) => contains(have[i], w));
  return have !== null && typeof have === "object" && Object.entries(want).every(([k, v]) => contains(have[k], v));
}
const RULE_FIELDS = ["ref", "description", "expression", "action", "action_parameters", "ratelimit", "enabled", "logging"];
const pickRule = (rule) => Object.fromEntries(RULE_FIELDS.filter((k) => rule[k] !== undefined).map((k) => [k, rule[k]]));

// ---------- zone settings ----------
async function setting(zone, id, want, item, note = "") {
  const read = await tryCf("GET", `/zones/${zone.id}/settings/${id}`);
  if (!read.ok) return report(item, undefined, want, "error", read.error.message);
  const current = read.value.value;
  if (contains(current, want)) return report(item, current, want, "ok", note);
  if (read.value.editable === false) return report(item, current, want, "skip", "Not editable on this plan.");
  report(item, current, want, "change", note);
  if (MODE !== "apply") return;
  if (!(id in state.settings)) state.settings[id] = current;
  saveState();
  await cf("PATCH", `/zones/${zone.id}/settings/${id}`, { value: want });
}

// ---------- rules (custom, rate limiting, managed), tracked by `ref` ----------
async function entrypoint(zone, phase) {
  const r = await tryCf("GET", `/zones/${zone.id}/rulesets/phases/${phase}/entrypoint`);
  if (r.ok) return r.value;
  if (r.error.status === 404) return null;
  throw r.error;
}

async function ensureRule(zone, phase, rule, item, { first = false, note = "" } = {}) {
  const rs = await entrypoint(zone, phase);
  const existing = rs?.rules?.find((r) => r.ref === rule.ref);
  const want = { enabled: true, ...rule };
  if (existing && contains(existing, want)) return report(item, pickRule(existing), want, "ok", note);
  report(item, existing ? pickRule(existing) : "absent", want, "change", note);
  if (MODE !== "apply") return;
  const track = (rulesetId, ruleId, created, previous = null) => {
    state.rules[rule.ref] ??= { phase, rulesetId, ruleId, created, previous };
    saveState();
  };
  if (!rs) {
    const created = await cf("POST", `/zones/${zone.id}/rulesets`, { name: `Zone-level ${phase}`, kind: "zone", phase, rules: [want] });
    track(created.id, created.rules.find((r) => r.ref === rule.ref).id, true);
  } else if (existing) {
    track(rs.id, existing.id, false, pickRule(existing));
    await cf("PATCH", `/zones/${zone.id}/rulesets/${rs.id}/rules/${existing.id}`, want);
  } else {
    const body = first && rs.rules?.length ? { ...want, position: { index: 1 } } : want;
    const updated = await cf("POST", `/zones/${zone.id}/rulesets/${rs.id}/rules`, body);
    track(rs.id, updated.rules.find((r) => r.ref === rule.ref).id, true);
  }
}

// ---------- the plan ----------
async function plan() {
  const zones = await cf("GET", `/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  if (!zones.length) throw new Error(`Zone ${ZONE_NAME} is not visible to this token.`);
  const zone = zones[0];
  const planId = zone.plan?.legacy_id ?? "free";
  const free = planId === "free";
  console.log(`Zone ${zone.name} (${zone.id}), plan: ${zone.plan?.name ?? planId}, mode: ${MODE}`);

  // a. Bot Fight Mode
  const bot = await tryCf("GET", `/zones/${zone.id}/bot_management`);
  const fight = bot.ok ? bot.value.fight_mode : undefined;
  if (free) {
    report("a. Bot Fight Mode", fight ?? "unreadable (needs Bot Management Read)", fight === true ? "turn off by hand" : "leave off", fight === true ? "manual" : "skip",
      "Bot Fight Mode cannot be skipped by any rule on Free, and it may challenge non-browser clients. Twilio's webhook POSTs to " +
      "/voice/incoming and the mobile app's API calls are exactly that traffic, so turning it on could silently break the phone line. " +
      "Super Bot Fight Mode (Pro and above) can be skipped for /voice/*.");
  } else {
    report("a. Super Bot Fight Mode", fight ?? "unreadable", "configure by hand with a skip rule for /voice/*", "manual",
      "Available on this plan with Skip support; this script does not change bot settings (its token has Bot Management Read only).");
  }

  // b. Rate limiting
  const slots = RATE_LIMIT_RULES_BY_PLAN[planId] ?? 1;
  const rl = await entrypoint(zone, "http_ratelimit");
  const others = (rl?.rules ?? []).filter((r) => !String(r.ref ?? "").startsWith("evade_"));
  let free_slots = slots - others.length;
  const voiceAndAssets = 'not (http.request.uri.path contains "/voice/" or http.request.uri.path contains "/assets/")';
  const mainRule = {
    ref: "evade_rl_all",
    description: free
      ? `EVAde: more than ${RL_REQUESTS} requests in 10 s per IP (zone-wide: Free cannot filter by host)`
      : `EVAde: more than ${RL_REQUESTS} requests in 10 s per IP on ${API_HOST}`,
    expression: free ? voiceAndAssets : `(http.host eq "${API_HOST}")`,
    action: "block",
    ratelimit: { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: RL_REQUESTS, mitigation_timeout: 10 },
  };
  const authRule = {
    ref: "evade_rl_auth",
    description: `EVAde: more than 20 requests in 10 s per IP to ${API_HOST}/auth/*`,
    expression: `(http.host eq "${API_HOST}" and starts_with(http.request.uri.path, "/auth/"))`,
    action: "block",
    ratelimit: { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 20, mitigation_timeout: 10 },
  };
  if (free_slots >= 2) {
    await ensureRule(zone, "http_ratelimit", authRule, "b2. Rate limit: /auth/* on api.evade.health");
    free_slots--;
  } else {
    report("b2. Rate limit: /auth/*", "absent", authRule, "skip", `The ${planId} plan allows ${slots} rate limiting rule(s); the tighter /auth/* rule needs a second one (Pro and above).`);
  }
  if (free_slots >= 1) {
    await ensureRule(zone, "http_ratelimit", mainRule, "b1. Rate limit: main rule", {
      note: free
        ? "Free rate limiting can only match on the URL path, so this rule also counts evade.health. /voice/* (Twilio, WebSockets) and " +
          "/assets/* (site files) are excluded. Several users behind one shared IP (event Wi-Fi) add up; raise it with --rl-requests=N if needed."
        : "",
    });
  } else {
    report("b1. Rate limit: main rule", "absent", mainRule, "skip", `All ${slots} rate limiting slot(s) are used by existing rules: ${others.map((r) => r.description || r.id).join(", ")}.`);
  }

  // c. Security level and Browser Integrity Check, with a skip rule for the voice paths
  const skipVoice = {
    ref: "evade_skip_voice",
    description: "EVAde: Twilio webhooks and voice WebSockets skip Browser Integrity Check and Security Level",
    expression: `(http.host eq "${ZONE_NAME}" and starts_with(http.request.uri.path, "/voice/"))`,
    action: "skip",
    action_parameters: { products: ["bic", "securityLevel"] },
  };
  await ensureRule(zone, "http_request_firewall_custom", skipVoice, "c1. Custom rule: skip BIC and Security Level for evade.health/voice/*", {
    first: true,
    note: "Covers /voice/incoming, /voice/stream, /voice/web*, /voice/alert and /voice/api/*. Custom rules with Skip are available on every plan.",
  });
  await setting(zone, "security_level", "medium", "c2. Security level");
  await setting(zone, "browser_check", "on", "c3. Browser Integrity Check", "Skipped for /voice/* by rule c1.");

  // d. SSL/TLS
  await setting(zone, "always_use_https", "on", "d1. Always Use HTTPS");
  await setting(zone, "min_tls_version", "1.2", "d2. Minimum TLS version");
  await setting(zone, "automatic_https_rewrites", "on", "d3. Automatic HTTPS Rewrites");
  const hsts = await tryCf("GET", `/zones/${zone.id}/settings/security_header`);
  report("d4. HSTS", hsts.ok ? hsts.value.value?.strict_transport_security : "unreadable", "not changed by this script", "manual",
    "Recommendation: enable HSTS by hand once both hosts are HTTPS-only for good (start with max-age 300, no preload). Browsers cache it, so it is hard to undo.");

  // e. Managed WAF ruleset
  const available = await cf("GET", `/zones/${zone.id}/rulesets`);
  const managedName = free ? MANAGED_RULESET_NAMES.free : MANAGED_RULESET_NAMES.paid;
  const managed = available.find((r) => r.kind === "managed" && r.phase === "http_request_firewall_managed" && r.name === managedName);
  const managedEp = await entrypoint(zone, "http_request_firewall_managed");
  const deployed = managed && managedEp?.rules?.find((r) => r.action === "execute" && r.action_parameters?.id === managed.id);
  if (!managed) {
    report("e. Managed WAF ruleset", "not listed for this zone", managedName, "skip", "The ruleset is not available to this zone or token.");
  } else if (deployed) {
    report("e. Managed WAF ruleset", `${managedName} deployed (enabled: ${deployed.enabled !== false})`, "deployed", deployed.enabled === false ? "manual" : "ok",
      deployed.enabled === false ? "Deployed but disabled by someone else; enable it in the dashboard if intended." : "");
  } else {
    await ensureRule(zone, "http_request_firewall_managed", {
      ref: "evade_managed_waf",
      description: `EVAde: ${managedName}`,
      expression: "true",
      action: "execute",
      action_parameters: { id: managed.id },
    }, `e. Managed WAF ruleset (${managedName})`);
  }

  // f. Notifications
  await notifications(zone, planId);
  return zone;
}

async function notifications(zone, planId) {
  const account = zone.account?.id;
  const avail = await tryCf("GET", `/accounts/${account}/alerting/v3/available_alerts`);
  if (!avail.ok) return report("f. Notifications", "unreadable", "-", "skip", `${avail.error.message} (needs Account Notifications Edit)`);
  const types = Object.values(avail.value).flat();
  const has = (t) => types.some((a) => a.type === t);
  const policies = (await cf("GET", `/accounts/${account}/alerting/v3/policies`)) ?? [];
  const wanted = [];
  if (has("clickhouse_alert_fw_anomaly")) {
    wanted.push({ name: `EVAde: Security Events for ${ZONE_NAME}`, alert_type: "clickhouse_alert_fw_anomaly", filters: { zones: [zone.id] } });
  } else {
    report("f1. Security Events alert", "not available", "-", "skip", `Security Events alerts need Business or Enterprise; this zone is on ${planId}.`);
  }
  const workerTypes = types.filter((a) => /worker|usage|budget|billing/i.test(`${a.type} ${a.display_name}`));
  report("f2. Workers usage / billing alerts", workerTypes.map((a) => a.type).join(", ") || "none offered", "set up by hand", "manual",
    "These alert types need product-specific thresholds (or a Pay-as-you-go budget), so the script lists them instead of guessing values. " +
    "Create them under Notifications > Add (Budget Alert or Usage Based Billing).");
  if (!wanted.length) return;
  if (!ALERT_EMAIL) {
    for (const w of wanted) report(`f. ${w.name}`, "absent", w, "skip", "Set CLOUDFLARE_ALERT_EMAIL to the account email to create it.");
    return;
  }
  const masked = ALERT_EMAIL.replace(/^(.{4})[^@]*/, "$1****");
  for (const w of wanted) {
    const body = { ...w, enabled: true, mechanisms: { email: [{ id: ALERT_EMAIL }] } };
    const existing = policies.find((p) => p.name === w.name);
    const shown = { ...w, email: masked };
    if (existing) {
      report(`f. ${w.name}`, "present", shown, "ok");
      continue;
    }
    report(`f. ${w.name}`, "absent", shown, "change");
    if (MODE !== "apply") continue;
    const created = await cf("POST", `/accounts/${account}/alerting/v3/policies`, body);
    state.policies[w.name] = { account, id: created.id };
    saveState();
  }
}

// ---------- revert ----------
async function revert() {
  if (!existsSync(STATE_FILE)) {
    console.log(`Nothing to revert: ${STATE_FILE} does not exist.`);
    return;
  }
  const zones = await cf("GET", `/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones[0];
  for (const [name, p] of Object.entries(state.policies)) {
    await cf("DELETE", `/accounts/${p.account}/alerting/v3/policies/${p.id}`);
    console.log(`Deleted notification policy: ${name}`);
    delete state.policies[name];
    saveState();
  }
  for (const [ref, r] of Object.entries(state.rules).reverse()) {
    if (r.created) {
      await cf("DELETE", `/zones/${zone.id}/rulesets/${r.rulesetId}/rules/${r.ruleId}`);
      console.log(`Deleted rule ${ref} (${r.phase})`);
    } else if (r.previous) {
      await cf("PATCH", `/zones/${zone.id}/rulesets/${r.rulesetId}/rules/${r.ruleId}`, r.previous);
      console.log(`Restored rule ${ref} (${r.phase})`);
    }
    delete state.rules[ref];
    saveState();
  }
  for (const [id, value] of Object.entries(state.settings)) {
    await cf("PATCH", `/zones/${zone.id}/settings/${id}`, { value });
    console.log(`Restored ${id} = ${show(value)}`);
    delete state.settings[id];
    saveState();
  }
  console.log("Revert complete.");
}

try {
  if (MODE === "revert") {
    await revert();
  } else {
    await plan();
    printReport();
    const pending = rows.filter((r) => r.status === "change").length;
    console.log(MODE === "apply"
      ? `\nApplied ${pending} change(s). Previous values: ${STATE_FILE}`
      : `\nDry run: ${pending} change(s) planned. Nothing was changed. Re-run with --apply to apply them.`);
  }
} catch (error) {
  if (rows.length) printReport();
  console.error(`\nStopped: ${error.message}`);
  process.exit(1);
}
