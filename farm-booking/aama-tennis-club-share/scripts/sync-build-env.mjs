#!/usr/bin/env node
// Single source of truth for public (NEXT_PUBLIC_*) build-time config: wrangler.jsonc.
//
// Background: NEXT_PUBLIC_* vars are inlined into the client bundle at
// `next build` time from .env.production (Next.js env file loading), NOT
// from wrangler.jsonc's `vars` block (that only becomes a Cloudflare Worker
// *runtime* binding). On 2026-09-16 only wrangler.jsonc was updated with the
// real LIFF ID; .env.production kept the literal placeholder "<LIFF_ID>" for
// two days and shipped a broken LIFF init to every platform. This script
// closes that gap AND a second, more serious gap found in code review on
// 2026-09-18: wrangler.jsonc's top-level (default/"preview") environment had
// DEV_FAKE_LOGIN=1 bound to the SAME D1 database as production — meaning
// anyone who deployed or discovered that Worker's default URL could
// authenticate as any user (including admin) against real production data.
// Both classes of bug are now hard build-time failures, not something a
// human has to remember to check.
//
// Which wrangler.jsonc environment this build is for is NOT knowable from
// inside `next build` alone (opennextjs-cloudflare's build step is
// environment-agnostic; only the later `wrangler deploy --env X` step knows
// the target). The calling npm script must say so explicitly via
// BUILD_TARGET_ENV=production|preview (see package.json, set with
// `cross-env` so it works the same on bash/PowerShell/cmd).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerPath = join(root, "wrangler.jsonc");
const envProdPath = join(root, ".env.production");

// Only these are allowed to be public. Anything else in wrangler.jsonc vars
// (secrets, DB ids, etc.) must never be inlined into a client bundle.
const PUBLIC_VAR_ALLOWLIST = ["NEXT_PUBLIC_LIFF_ID", "NEXT_PUBLIC_SITE_URL"];
const VALID_TARGETS = ["production", "preview"];

function fail(message) {
  console.error(`\n✖ sync-build-env: ${message}\n`);
  process.exit(1);
}

function loadWrangler() {
  if (!existsSync(wranglerPath)) fail(`missing ${wranglerPath}`);
  const text = readFileSync(wranglerPath, "utf8");
  const errors = [];
  const config = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    fail(
      `wrangler.jsonc failed to parse (${errors.length} error(s)): ` +
        errors.map((e) => `offset ${e.offset} errorCode ${e.error}`).join("; ")
    );
  }
  return config;
}

function varsFor(config, target) {
  // Cloudflare semantics: an env block's `vars` REPLACES top-level `vars`
  // entirely, it is not merged (wrangler itself warns about this).
  if (target === "preview") return config.vars ?? {};
  const block = config.env?.[target];
  if (!block) fail(`wrangler.jsonc has no env.${target} block`);
  return block.vars ?? {};
}

function d1DatabaseId(config, target, binding = "DB") {
  const list = target === "preview" ? config.d1_databases : config.env?.[target]?.d1_databases;
  return (list ?? []).find((d) => d.binding === binding)?.database_id ?? null;
}

function looksLikePlaceholder(value) {
  if (typeof value !== "string") return true;
  const v = value.trim();
  if (v === "") return true;
  if (/^<.*>$/.test(v)) return true;
  if (/^(TODO|CHANGEME|REPLACE_ME|x{6,})/i.test(v)) return true;
  return false;
}

const config = loadWrangler();

// ---- P0: no environment may combine a fake-login backdoor with the production database ----
// Scans EVERY environment block actually present in wrangler.jsonc (top-level "preview"
// plus every key under `env`), not just the ones this script currently knows how to build
// for (VALID_TARGETS). A future "staging" block added to wrangler.jsonc without a matching
// entry in this script's target list must still be caught here — unknown environments are
// not assumed safe.
const prodDbId = d1DatabaseId(config, "production");
if (!prodDbId) fail("could not resolve env.production's D1 database_id — refusing to proceed blind");
const allEnvNames = ["preview", ...Object.keys(config.env ?? {})].filter((v, i, a) => a.indexOf(v) === i);
for (const envName of allEnvNames) {
  const vars = varsFor(config, envName);
  const dbId = d1DatabaseId(config, envName);
  const fakeLoginOn = String(vars.DEV_FAKE_LOGIN ?? "").trim() === "1";
  if (fakeLoginOn && dbId === prodDbId) {
    fail(
      `env "${envName}" has DEV_FAKE_LOGIN=1 AND is bound to the PRODUCTION D1 database (${prodDbId}). ` +
        `Anyone who can reach that Worker could authenticate as any user against real production data. Refusing to build.`
    );
  }
}

// ---- resolve the target this specific build is for ----
const target = process.env.BUILD_TARGET_ENV;
if (!VALID_TARGETS.includes(target)) {
  fail(
    `BUILD_TARGET_ENV must be set to one of ${JSON.stringify(VALID_TARGETS)} (got ${JSON.stringify(target)}). ` +
      `Set it in the calling npm script with cross-env so this script knows which wrangler.jsonc environment is authoritative.`
  );
}

const vars = varsFor(config, target);
const resolved = {};
for (const key of PUBLIC_VAR_ALLOWLIST) {
  const value = vars[key];
  // NEXT_PUBLIC_LIFF_ID is intentionally blank on preview (it relies on
  // DEV_FAKE_LOGIN instead of a real LIFF app) — everything else must be real.
  if (key === "NEXT_PUBLIC_LIFF_ID" && target === "preview" && value === "") {
    resolved[key] = "";
    continue;
  }
  if (looksLikePlaceholder(value)) {
    fail(`wrangler.jsonc env.${target}.vars.${key} is missing/placeholder (saw ${JSON.stringify(value)})`);
  }
  resolved[key] = value;
}

if (target === "production") {
  if (!/^\d+-[A-Za-z0-9]+$/.test(resolved.NEXT_PUBLIC_LIFF_ID)) {
    fail(
      `production NEXT_PUBLIC_LIFF_ID ${JSON.stringify(resolved.NEXT_PUBLIC_LIFF_ID)} doesn't match the expected ` +
        `"<digits>-<id>" LIFF ID shape. This only checks the format — it cannot confirm LINE has actually registered it.`
    );
  }
  let siteUrlParsed;
  try {
    siteUrlParsed = new URL(resolved.NEXT_PUBLIC_SITE_URL);
  } catch {
    fail(`production NEXT_PUBLIC_SITE_URL ${JSON.stringify(resolved.NEXT_PUBLIC_SITE_URL)} is not a valid URL`);
  }
  if (siteUrlParsed.protocol !== "https:") {
    fail(`production NEXT_PUBLIC_SITE_URL ${JSON.stringify(resolved.NEXT_PUBLIC_SITE_URL)} must use https:`);
  }
  if (siteUrlParsed.username || siteUrlParsed.password) {
    fail(`production NEXT_PUBLIC_SITE_URL must not contain userinfo (username/password in the URL)`);
  }
  if (siteUrlParsed.hash) {
    fail(`production NEXT_PUBLIC_SITE_URL must not contain a fragment (#...)`);
  }
}

// ---- write .env.production (only the allowlisted keys; leave any other lines untouched) ----
const existingLines = existsSync(envProdPath)
  ? readFileSync(envProdPath, "utf8").split(/\r?\n/).filter(Boolean)
  : [];
const otherLines = existingLines.filter((line) => !PUBLIC_VAR_ALLOWLIST.some((key) => line.startsWith(`${key}=`)));
const newLines = [...otherLines, ...PUBLIC_VAR_ALLOWLIST.map((key) => `${key}=${resolved[key]}`)];
writeFileSync(envProdPath, newLines.join("\n") + "\n");

// ---- verify nothing with higher precedence silently overrides what we just wrote ----
// Delegates to Next.js's OWN env loader (@next/env, the exact code `next build` itself
// uses) instead of hand-parsing .env.local/.env.production.local — that hand-rolled
// version missed `export KEY=`, quoted values, leading whitespace and duplicate keys.
// This checks the real effective value, whatever produced it (process.env,
// .env.production.local, .env.local, or a stale value we somehow failed to overwrite).
const { combinedEnv, loadedEnvFiles } = loadEnvConfig(root, false, {
  info: () => {},
  error: (...args) => console.error(...args),
});
for (const key of PUBLIC_VAR_ALLOWLIST) {
  const effective = combinedEnv?.[key];
  if (effective !== resolved[key]) {
    fail(
      `after writing .env.production, Next.js's own env loader still resolves ${key} to ${JSON.stringify(effective)}, ` +
        `not the intended ${JSON.stringify(resolved[key])}. Something with higher precedence is overriding it — check ` +
        `process.env, and these loaded files: ${loadedEnvFiles.map((f) => f.path).join(", ") || "(none)"}.`
    );
  }
}

for (const key of PUBLIC_VAR_ALLOWLIST) {
  console.log(`✓ sync-build-env[${target}]: ${key} = ${JSON.stringify(resolved[key])} (from wrangler.jsonc, verified via @next/env)`);
}
