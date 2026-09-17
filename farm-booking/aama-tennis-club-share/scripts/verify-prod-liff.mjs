#!/usr/bin/env node
// Runs immediately after `npm run deploy` (npm "postdeploy" hook).
// Confirms the value actually shipped to production matches what
// wrangler.jsonc says it should be — not just that wrangler printed a
// success message. Fetches the live site, not a local build artifact,
// so it also catches CDN/cache staleness.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = JSON.parse(
  readFileSync(join(root, "wrangler.jsonc"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
);
const siteUrl = wrangler?.env?.production?.vars?.NEXT_PUBLIC_SITE_URL;
const expectedLiffId = wrangler?.env?.production?.vars?.NEXT_PUBLIC_LIFF_ID;

if (!siteUrl || !expectedLiffId) {
  console.error("✖ verify-prod-liff: wrangler.jsonc env.production.vars missing NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_LIFF_ID");
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function extractChunkUrls(html, base) {
  const re = /\/_next\/static\/chunks\/[^"'()]+\.js/g;
  return [...new Set(html.match(re) ?? [])].map((p) => new URL(p, base).toString());
}

async function checkPage(path) {
  const url = new URL(path, siteUrl).toString();
  const html = await fetchText(url);
  const hits = { placeholder: 0, real: 0 };
  const scan = (text) => {
    if (text.includes("<LIFF_ID>") || /liffId["\\]*:["\\]*<[A-Z_]+>/.test(text)) hits.placeholder++;
    if (text.includes(expectedLiffId)) hits.real++;
  };
  scan(html);
  for (const chunkUrl of extractChunkUrls(html, url)) {
    try {
      scan(await fetchText(chunkUrl));
    } catch {
      // asset may be an unrelated shared chunk with no LIFF reference at all; ignore fetch errors here
    }
  }
  return hits;
}

let failed = false;
for (const path of ["/", "/login"]) {
  const hits = await checkPage(path);
  const label = `${siteUrl}${path}`;
  if (hits.placeholder > 0) {
    console.error(`✖ verify-prod-liff: ${label} still serves a LIFF ID placeholder (${hits.placeholder} hit(s))`);
    failed = true;
  } else if (hits.real === 0) {
    console.error(`✖ verify-prod-liff: ${label} does not reference the expected LIFF ID at all — check the page still uses LIFF`);
    failed = true;
  } else {
    console.log(`✓ verify-prod-liff: ${label} serves the real LIFF ID (${expectedLiffId})`);
  }
}

if (failed) {
  console.error("\n✖ verify-prod-liff: production does NOT match wrangler.jsonc. Treat the deploy as broken.\n");
  process.exit(1);
}
