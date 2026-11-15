#!/usr/bin/env node
// Build the web app + voice Worker and deploy both to https://evade.health.
//
//   node deploy/deploy.mjs              # build and deploy
//   node deploy/deploy.mjs --dry-run    # build and validate, no upload
//
// Env overrides:
//   WEB_DIR     web app folder to build (default: EVAde, i.e. this checkout)
//   WORKER_REF  git ref for the Worker + /voice page (default: origin/feature/twilio-grok-voice-agent)
//
// Needs: git, Node 20+, and `npx wrangler login` with access to the "EVAde" Cloudflare account.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const sh = (cmd, cwd) => {
  console.log(`\n$ ${cmd}${cwd ? `   (in ${cwd})` : ""}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const webDir = resolve(root, process.env.WEB_DIR || "EVAde");
const workerRef = process.env.WORKER_REF || "origin/feature/twilio-grok-voice-agent";
const stage = join(root, ".deploy");
const workerSrc = join(stage, "worker-src");
const site = join(stage, "site");
const config = join(root, "deploy", "wrangler.jsonc");

mkdirSync(stage, { recursive: true });

// 1. Check out the Worker branch into .deploy/worker-src (a detached git worktree).
sh("git fetch origin", root);
if (!existsSync(join(workerSrc, ".git"))) {
  sh("git worktree prune", root);
  sh(`git worktree add --detach "${workerSrc}" ${workerRef}`, root);
} else {
  sh(`git checkout --detach ${workerRef}`, workerSrc);
}

// 2. Build the web app.
sh("npm ci --no-audit --no-fund", webDir);
sh("npm run build", webDir);

// 3. Assemble the static site: web app at /, voice chat page at /voice/.
rmSync(site, { recursive: true, force: true });
cpSync(join(webDir, "dist"), site, { recursive: true });
if (existsSync(join(site, "voice"))) throw new Error("web app build has a /voice folder; it would clobber the voice chat page");
cpSync(join(workerSrc, "frontend", "voice"), join(site, "voice"), { recursive: true });

// 4. Deploy the Worker with wrangler from the Worker's own dependencies.
const workerDir = join(workerSrc, "worker");
sh("npm ci --no-audit --no-fund", workerDir);
sh(`npx wrangler deploy -c "${config}"${dryRun ? " --dry-run" : ""}`, workerDir);

console.log(dryRun ? "\nDry run OK (nothing uploaded)." : "\nDeployed: https://evade.health  (voice chat: https://evade.health/voice/)");
