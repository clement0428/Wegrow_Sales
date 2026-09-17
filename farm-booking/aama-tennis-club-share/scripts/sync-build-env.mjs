#!/usr/bin/env node
// Single source of truth for NEXT_PUBLIC_LIFF_ID: wrangler.jsonc's env.production.vars.
//
// Why this exists: NEXT_PUBLIC_* vars are inlined into the client bundle at
// `next build` time from .env.production. wrangler.jsonc's `vars` block only
// becomes a Cloudflare Worker *runtime* binding — it is never read by `next
// build`. Editing wrangler.jsonc alone silently leaves the old/placeholder
// value baked into the deployed frontend (this happened in production on
// 2026-09-18: NEXT_PUBLIC_LIFF_ID stayed as the literal placeholder
// "<LIFF_ID>" for two days because only wrangler.jsonc had been updated).
//
// This script reads the real value out of wrangler.jsonc and writes it into
// .env.production before every build, so there is exactly one place a human
// ever edits (wrangler.jsonc). It then hard-fails the build if the resulting
// value is missing or still looks like a placeholder.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerPath = join(root, "wrangler.jsonc");
const envProdPath = join(root, ".env.production");

const REQUIRED_PUBLIC_VARS = ["NEXT_PUBLIC_LIFF_ID"];

function stripJsonComments(text) {
  // wrangler.jsonc allows // and /* */ comments; this repo's file has none
  // today, but strip them defensively so this script doesn't rot if someone
  // adds one later.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function looksLikePlaceholder(value) {
  if (!value) return true;
  const v = value.trim();
  if (v === "") return true;
  if (/^<.*>$/.test(v)) return true; // e.g. <LIFF_ID>
  if (/^(TODO|CHANGEME|REPLACE_ME|xxxxxxxx)/i.test(v)) return true;
  return false;
}

function fail(message) {
  console.error(`\n✖ sync-build-env: ${message}\n`);
  process.exit(1);
}

if (!existsSync(wranglerPath)) fail(`missing ${wranglerPath}`);

let wrangler;
try {
  wrangler = JSON.parse(stripJsonComments(readFileSync(wranglerPath, "utf8")));
} catch (e) {
  fail(`could not parse wrangler.jsonc: ${e.message}`);
}

const prodVars = wrangler?.env?.production?.vars ?? {};
const topVars = wrangler?.vars ?? {};

const resolved = {};
for (const key of REQUIRED_PUBLIC_VARS) {
  const value = prodVars[key] ?? topVars[key];
  if (looksLikePlaceholder(value)) {
    fail(
      `wrangler.jsonc env.production.vars.${key} is missing or still a placeholder ` +
        `(saw ${JSON.stringify(value)}). Set the real value in wrangler.jsonc before building.`
    );
  }
  resolved[key] = value;
}

const existingLines = existsSync(envProdPath)
  ? readFileSync(envProdPath, "utf8").split(/\r?\n/).filter(Boolean)
  : [];
const otherLines = existingLines.filter(
  (line) => !REQUIRED_PUBLIC_VARS.some((key) => line.startsWith(`${key}=`))
);
const newLines = [
  ...otherLines,
  ...REQUIRED_PUBLIC_VARS.map((key) => `${key}=${resolved[key]}`),
];
writeFileSync(envProdPath, newLines.join("\n") + "\n");

for (const key of REQUIRED_PUBLIC_VARS) {
  console.log(`✓ sync-build-env: ${key} = ${resolved[key]} (from wrangler.jsonc, written to .env.production)`);
}
