#!/usr/bin/env node
// Run from the repository root. See DEPLOY.md for the production deploy order.
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targets = args.filter(arg => arg !== "--dry-run");
const target = targets[0] ?? "site";
if (targets.length > 1 || !["--api", "--gateway", "site"].includes(target)) {
  throw new Error("Usage: node deploy/deploy.mjs [--api | --gateway] [--dry-run]");
}

const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const sh = (command, cwd) => {
  console.log(`\n$ ${command}   (in ${cwd})`);
  execSync(command, { cwd, stdio: "inherit" });
};

function assertProductionCheckout() {
  if (git(["branch", "--show-current"]) !== "main") throw new Error("Production deploys require main.");
  if (git(["status", "--porcelain", "--ignore-submodules=all"]) ||
      git(["diff", "--cached", "--name-only", "--ignore-submodules=none"])) {
    throw new Error("Production deploys require a clean checkout.");
  }
  git(["fetch", "origin", "main"]);
  if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "FETCH_HEAD"])) {
    throw new Error("Production deploys require HEAD to match origin/main. Pull main and retry.");
  }
}

if (!dryRun) assertProductionCheckout();
const dryArgs = dryRun ? " --dry-run" : "";

if (target === "--api") {
  const apiDir = join(root, "cloud", "worker");
  sh("npm ci --no-audit --no-fund", apiDir);
  sh(`npx wrangler deploy${dryArgs}`, apiDir);
} else if (target === "--gateway") {
  sh("docker info --format {{.ServerVersion}}", root);
  git(["submodule", "update", "--init", "--checkout", "--", "backend-models"]);
  const modelDir = join(root, "backend-models");
  if (git(["rev-parse", "HEAD"], modelDir) !== git(["rev-parse", "HEAD:backend-models"]) ||
      git(["status", "--porcelain", "--untracked-files=all", "--ignored"], modelDir)) {
    throw new Error("The backend-models checkout must be clean and at the commit pinned in EVAde.");
  }
  const gatewayDir = join(root, "cloud", "model-gateway");
  sh("npm ci --no-audit --no-fund", gatewayDir);
  sh(`npx wrangler deploy${dryArgs}`, gatewayDir);
} else {
  const webDir = join(root, "EVAde");
  sh("npm ci --no-audit --no-fund", webDir);
  sh("npm run build", webDir);

  const site = join(root, ".deploy", "site");
  mkdirSync(join(root, ".deploy"), { recursive: true });
  rmSync(site, { recursive: true, force: true });
  cpSync(join(webDir, "dist"), site, { recursive: true });

  const workerDir = join(root, "worker");
  sh("npm ci --no-audit --no-fund", workerDir);
  sh(`npx wrangler deploy -c ../deploy/wrangler.jsonc${dryArgs}`, workerDir);
  if (!dryRun) console.log("\nDeployed: https://evade.health  (voice check-in: https://evade.health/journal)");
}

if (dryRun) console.log("\nDry run OK (nothing uploaded).");
