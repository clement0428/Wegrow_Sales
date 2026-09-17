#!/usr/bin/env node
// Runs as the `postdeploy` npm hook, right after `wrangler deploy` reports
// success. Uses a real Chromium (puppeteer), not string-scanning: it loads
// the live production pages, lets the real @line/liff SDK execute, and
// fails loudly on anything a plain `curl`/regex check would miss —
// a 404'd JS chunk, an uncaught init error, or the live site quietly still
// serving a previous build.
//
// What this script CANNOT do, and does not pretend to: complete a real LINE
// login (no test account credentials exist in this environment), or drive
// an actual iPhone LINE in-app WKWebView (puppeteer is Chromium). Those are
// reported as BLOCKED, not PASS.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import puppeteer from "puppeteer";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8"), [], { allowTrailingComma: true });
const prodVars = config?.env?.production?.vars ?? {};
const siteUrl = prodVars.NEXT_PUBLIC_SITE_URL;
const expectedLiffId = prodVars.NEXT_PUBLIC_LIFF_ID;

if (!siteUrl || !expectedLiffId) {
  console.error("✖ verify-prod-liff: wrangler.jsonc env.production.vars missing NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_LIFF_ID");
  process.exit(1);
}

const localBuildIdPath = join(root, ".next", "BUILD_ID");
const localBuildId = existsSync(localBuildIdPath) ? readFileSync(localBuildIdPath, "utf8").trim() : null;

const results = []; // { name, status: PASS|FAIL|BLOCKED, detail }
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "BLOCKED" ? "•" : "✖";
  console.log(`${icon} [${status}] ${name}${detail ? " — " + detail : ""}`);
};

async function checkBuildIdMatches() {
  if (!localBuildId) {
    record("build-id-match", "BLOCKED", "no local .next/BUILD_ID found (script not run right after a build)");
    return;
  }
  try {
    const res = await fetch(new URL("/BUILD_ID", siteUrl), { cache: "no-store" });
    if (!res.ok) return record("build-id-match", "FAIL", `GET /BUILD_ID -> HTTP ${res.status}`);
    const liveBuildId = (await res.text()).trim();
    if (liveBuildId !== localBuildId) {
      return record(
        "build-id-match",
        "FAIL",
        `production is serving BUILD_ID ${liveBuildId}, not this build's ${localBuildId} — deploy did not take effect or is cached`
      );
    }
    record("build-id-match", "PASS", `production serves this exact build (${liveBuildId})`);
  } catch (e) {
    record("build-id-match", "FAIL", `could not fetch /BUILD_ID: ${e.message}`);
  }
}

async function checkPageWithRealBrowser(browser, path, { expectRedirectToLineLogin }) {
  const name = `browser:${path}`;
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/15.5.0 Mobile/15E148 Safari/604.1"
  );
  const pageErrors = [];
  const criticalFailures = []; // same-origin static asset load failures
  const thirdPartyFailures = []; // cross-origin — reported, not auto-fail
  const url = new URL(path, siteUrl).toString();
  const origin = new URL(siteUrl).origin;

  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (req) => {
    const failUrl = req.url();
    const entry = `${req.method()} ${failUrl} -> ${req.failure()?.errorText}`;
    (failUrl.startsWith(origin) ? criticalFailures : thirdPartyFailures).push(entry);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().startsWith(origin)) {
      criticalFailures.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (e) {
    await page.close();
    return record(name, "FAIL", `page.goto failed: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 4000));

  if (criticalFailures.length > 0) {
    await page.close();
    return record(name, "FAIL", `same-origin resource load failure(s): ${criticalFailures.join(" | ")}`);
  }
  if (pageErrors.length > 0) {
    await page.close();
    return record(name, "FAIL", `uncaught page error(s): ${pageErrors.join(" | ")}`);
  }
  if (thirdPartyFailures.length > 0) {
    console.log(`  (third-party resource failures, not blocking: ${thirdPartyFailures.join(" | ")})`);
  }

  const finalUrl = page.url();
  if (expectRedirectToLineLogin) {
    let parsed;
    try {
      parsed = new URL(finalUrl);
    } catch {
      await page.close();
      return record(name, "FAIL", `final URL is not parseable: ${finalUrl}`);
    }
    const isLineHost = parsed.hostname === "access.line.me";
    // LINE nests the real params (app_id, redirect_uri, ...) inside the `returnUri` query
    // value, which is itself percent-encoded — a literal `app_id=` substring match on the
    // raw URL never matches (it's `app_id%3D` at that layer). Decode before checking.
    let decodedUrl = finalUrl;
    try {
      // one pass is enough here (LINE double-encodes redirect_uri specifically, but app_id
      // itself is only single-encoded inside returnUri) — decode until it stops changing,
      // capped, so we don't loop forever on malformed input.
      for (let i = 0; i < 3; i++) {
        const next = decodeURIComponent(decodedUrl);
        if (next === decodedUrl) break;
        decodedUrl = next;
      }
    } catch {
      // leave decodedUrl as the last successfully decoded value
    }
    const appIdMatches = decodedUrl.includes(`app_id=${expectedLiffId}`);
    const redirectUriMatches = decodedUrl.includes(`redirect_uri=${siteUrl}`);
    await page.close();
    if (!isLineHost) return record(name, "FAIL", `liff.login() did not reach access.line.me — final URL: ${finalUrl}`);
    if (!appIdMatches) return record(name, "FAIL", `access.line.me request does not carry the expected app_id=${expectedLiffId} — decoded final URL: ${decodedUrl}`);
    if (!redirectUriMatches) return record(name, "FAIL", `access.line.me request's redirect_uri does not point back to ${siteUrl} — decoded final URL: ${decodedUrl}`);
    return record(name, "PASS", `liff.init() succeeded and liff.login() reached LINE's real OAuth endpoint with the correct app_id and redirect_uri`);
  }

  const liffState = await page
    .evaluate(() => {
      if (typeof liff === "undefined") return { liffGlobalPresent: false };
      const safe = (fn) => {
        try {
          return fn();
        } catch (e) {
          return `ERR:${e.message}`;
        }
      };
      return {
        liffGlobalPresent: true,
        id: liff.id ?? null,
        isLoggedIn: safe(() => liff.isLoggedIn()),
      };
    })
    .catch((e) => ({ evalError: e.message }));
  await page.close();

  if (!liffState.liffGlobalPresent) return record(name, "FAIL", "window.liff never initialized (SDK global absent)");
  if (liffState.id !== expectedLiffId) {
    return record(
      name,
      "FAIL",
      `live liff.id is ${JSON.stringify(liffState.id)}, expected exactly ${JSON.stringify(expectedLiffId)}`
    );
  }
  record(name, "PASS", `liff.init() succeeded, SDK reports the exact expected liff.id (${liffState.id})`);
}

async function main() {
  await checkBuildIdMatches();

  const browser = await puppeteer.launch();
  await checkPageWithRealBrowser(browser, "/login", { expectRedirectToLineLogin: true });
  await checkPageWithRealBrowser(browser, "/", { expectRedirectToLineLogin: false });
  await browser.close();

  record(
    "real-line-account-login",
    "BLOCKED",
    "no test LINE account credentials available in this environment — cannot complete liff.login()/token exchange/session. Requires a controlled test account, real iPhone LINE in-app browser, or a human tester."
  );
  record(
    "iphone-wkwebview",
    "BLOCKED",
    "this script drives Chromium via puppeteer, not iOS WKWebView inside the LINE app — real-device LINE testing is still required and is not replaced by this check."
  );

  const failed = results.filter((r) => r.status === "FAIL");
  const blocked = results.filter((r) => r.status === "BLOCKED");
  console.log(
    `\nSummary: ${results.length - failed.length - blocked.length}/${results.length} PASS, ${failed.length} FAIL, ${blocked.length} BLOCKED`
  );
  if (failed.length > 0) {
    console.error("\n✖ verify-prod-liff: production has FAIL result(s) above. Treat the deploy as broken.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("✖ verify-prod-liff: unexpected error:", e);
  process.exit(1);
});
